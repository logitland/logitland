import { Permission } from '@logitland/discord';
import { describe, expect, it } from 'vitest';
import { all, conversation, human, moreChannels, msg, one, push, remove, subscribe, thread, world } from './intake-fixtures';
import { AGENT_BASE, FORUM, GUILD, LOUNGE, setAccess } from './testing';

type Kind = 'text' | 'announcement' | 'forum' | 'media';
const update = (channel_id: string, name: string, type: Kind, extra: Record<string, unknown> = {}) => ({
  kind: 'channel_update' as const,
  channel_id,
  guild_id: GUILD,
  name,
  type,
  overwrites: [],
  slowmode_seconds: 0,
  ...extra,
});
const channel = (h: Awaited<ReturnType<typeof world>>['h'], id: string) =>
  one<Record<string, any>>(h, 'SELECT name, type, parent_id, overwrites, slowmode_seconds, hidden, tags FROM channels WHERE id = ?', id);

describe('a channel that changes in Discord', () => {
  it('is stored as Discord last described it: name, type, category, overwrites and slowmode', async () => {
    const { h } = await world();
    const GARDEN = '110000000000000031';
    const CATEGORY = '110000000000000030';
    const closed = [{ id: GUILD, type: 0, allow: '0', deny: String(Permission.VIEW_CHANNEL) }];
    await push(
      h,
      update(GARDEN, 'garden', 'text'),
      update(GARDEN, 'garden-2', 'announcement', { parent_id: CATEGORY, overwrites: closed, slowmode_seconds: 30 }),
    );
    expect(await channel(h, GARDEN)).toMatchObject({
      name: 'garden-2',
      type: 'announcement',
      parent_id: CATEGORY,
      overwrites: JSON.stringify(closed),
      slowmode_seconds: 30,
      hidden: 0,
    });
  });

  it('rejects types and names the relay can’t use', async () => {
    const { h } = await world();
    const r = await push(h, { ...update(LOUNGE, 'x', 'text'), type: 'voice' }, update(LOUNGE, '', 'text'));
    expect(r.invalid).toBe(2);
    expect((await channel(h, LOUNGE))!.name).toBe('lounge');
  });
});

describe('a role that changes in Discord', () => {
  it('changes what agents may do at once', async () => {
    const { h, agent } = await world();
    const visible = async () =>
      ((await (await h.call('GET', '/v1/channels', undefined, h.as(agent.token))).json()) as { channels: { id: string }[] }).channels.map((c) => c.id);
    expect(await visible()).toEqual([LOUNGE]);
    const permissions = String(AGENT_BASE & ~Permission.VIEW_CHANNEL);
    await push(h, { kind: 'role_update', role_id: GUILD, guild_id: GUILD, name: '@everyone', permissions, position: 0 });
    expect(await visible()).toEqual([]);
  });
});

describe('forum tags', () => {
  const tags = [
    { id: '140000000000000001', name: 'Bug', moderated: true },
    { id: '140000000000000002', name: 'Idea', moderated: false },
  ];
  const tagsOf = async (h: Awaited<ReturnType<typeof world>>['h']) => JSON.parse((await channel(h, FORUM))!.tags) as unknown[];

  it('follow each update, and are cleared when the channel stops being a forum', async () => {
    const { h } = await world();
    await moreChannels(h);
    await push(h, update(FORUM, 'forum', 'forum', { tags }));
    expect(await tagsOf(h)).toEqual(tags);
    await push(h, update(FORUM, 'forum', 'forum', { tags: [tags[0]] }));
    expect(await tagsOf(h)).toEqual([tags[0]]);
    await push(h, update(FORUM, 'forum', 'text'));
    expect(await tagsOf(h)).toEqual([]);
  });
});

describe('a channel closed to agents while people delete in Discord', () => {
  it('applies the deletes quietly, so the text does not come back when the channel opens again', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    await push(h, human(1), human(2), thread(msg(5)), human(6, { thread_id: msg(5) }));
    const before = (await one<{ n: number }>(h, 'SELECT COUNT(*) AS n FROM deliveries'))!.n;
    await setAccess(h.db, LOUNGE, 'off');
    await push(
      h,
      remove(1),
      { kind: 'message_delete_bulk', channel_id: LOUNGE, message_ids: [msg(2)] },
      { kind: 'thread_delete', thread_id: msg(5), parent_id: LOUNGE },
    );
    await setAccess(h.db, LOUNGE, 'post');
    for (const n of [1, 2, 6]) expect(await conversation(h, n)).toMatchObject({ content: null, removed_by: 'discord' });
    // Nobody was told while the channel was closed.
    expect((await one<{ n: number }>(h, 'SELECT COUNT(*) AS n FROM deliveries'))!.n).toBe(before);
    expect(await all(h, "SELECT 1 FROM events WHERE type LIKE '%deleted' AND fanned_out_at IS NULL")).toHaveLength(0);
  });
});
