import type { Showcase, Stats } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { agree } from './consent.testkit';
import { say, setup } from './deliveries.testkit';
import { BENCH, LOUNGE, seedChannel, setAccess } from './testing';
import { updateSettings } from './services/settings';

// The home page (#28): counts and the channels admins picked, only ever channels every agent can read.

const STAFF = '110000000000000099';

describe('the home page', () => {
  it('shows the picked channels in the order admins picked them, and the counts', async () => {
    const s = await setup();
    await updateSettings(s.relay, 'own_admin', { home_channel_ids: [LOUNGE, BENCH] });
    await say(s, 'from a bot, not counted');
    const res = await s.call('GET', '/v1/stats');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect((await res.json()) as Stats).toEqual({
      agents: 1,
      messages_today: 0,
      channels: 2,
      home_channels: [
        { id: LOUNGE, name: 'lounge' },
        { id: BENCH, name: 'lab-bench' },
      ],
    });
  });

  it('shows no channels until admins pick', async () => {
    const s = await setup();
    const { home_channels } = (await (await s.call('GET', '/v1/stats')).json()) as Stats;
    expect(home_channels).toEqual([]);
  });

  it('gives the web app the picked channels’ agent messages, oldest first, however much else was said since', async () => {
    const s = await setup();
    await updateSettings(s.relay, 'own_admin', { home_channel_ids: [LOUNGE] });
    const write = (id: string, kind: 'agent' | 'human', content: string | null) =>
      s.db
        .prepare(
          'INSERT INTO conversation (message_id, channel_id, author_kind, agent_id, author_ref, display_name, content, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          id,
          LOUNGE,
          kind,
          kind === 'agent' ? s.agent.id : null,
          kind === 'agent' ? s.agent.id : 'p_someone',
          kind === 'agent' ? s.agent.name : 'Someone',
          content,
          s.now().toISOString(),
          content ? null : s.now().toISOString(),
        )
        .run();
    await write('320000000000000001', 'agent', 'first');
    await write('320000000000000002', 'human', 'a person who agreed to reach agents');
    await write('320000000000000003', 'agent', null);
    await write('320000000000000004', 'agent', 'second');
    // More than a showcase's worth of people's replies after the agents' last word.
    for (let i = 10; i < 50; i++) await write(`3200000000000000${i}`, 'human', `reply ${i}`);

    expect((await s.call('GET', '/internal/showcase')).status).toBe(404);
    const res = await s.internal('GET', '/internal/showcase');
    const { home_channels } = (await res.json()) as Showcase;
    expect(home_channels.map((c) => [c.name, c.messages.map((m) => m.content)])).toEqual([['lounge', ['first', 'second']]]);
  });

  it('shows people who agreed to being shown, and nobody who agreed under the notice before it', async () => {
    const s = await setup();
    await updateSettings(s.relay, 'own_admin', { home_channel_ids: [LOUNGE] });
    const NOW = '200000000000000101';
    const BEFORE = '200000000000000102';
    await agree(s, NOW);
    await agree(s, BEFORE);
    await s.db.prepare("UPDATE consents SET notice_version = '2026-10-21' WHERE discord_user_id = ?").bind(BEFORE).run();
    const write = (id: string, person: string, content: string) =>
      s.db
        .prepare(
          "INSERT INTO conversation (message_id, channel_id, author_kind, author_ref, discord_user_id, display_name, content, created_at) VALUES (?, ?, 'human', ?, ?, 'Someone', ?, ?)",
        )
        .bind(id, LOUNGE, `p_${person}`, person, content, s.now().toISOString())
        .run();
    await write('330000000000000001', NOW, 'hello agents');
    await write('330000000000000002', BEFORE, 'agreed before the home page was mentioned');
    const { home_channels } = (await (await s.internal('GET', '/internal/showcase')).json()) as Showcase;
    expect(home_channels[0]!.messages.map((m) => m.content)).toEqual(['hello agents']);
  });

  it('refuses a channel agents can’t read, and drops one that closes later', async () => {
    const s = await setup();
    await seedChannel(s.relay, { id: STAFF, name: 'staff', access: 'off' });
    await expect(updateSettings(s.relay, 'own_admin', { home_channel_ids: [STAFF] })).rejects.toMatchObject({ status: 422 });
    await updateSettings(s.relay, 'own_admin', { home_channel_ids: [LOUNGE] });
    await setAccess(s.db, LOUNGE, 'off');
    expect(((await (await s.call('GET', '/v1/stats')).json()) as Stats).home_channels).toEqual([]);
  });
});
