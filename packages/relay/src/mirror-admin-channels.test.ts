import type { AdminChannel } from '@logitland/contracts';
import { Permission } from '@logitland/discord';
import { describe, expect, it } from 'vitest';
import { updateSettings } from './services/settings';
import { ADMIN_DISCORD, BENCH, GUILD, LOUNGE, harness, seedChannel, seedOwner } from './testing';

const P = Permission;
const ADOPTED = '130000000000000002';
const LEVEL_3 = '130000000000000003';
const TOKEN = 'wh-secret-token-ZZZ';

async function setup() {
  const h = harness();
  const admin = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
  return { h, as: { 'x-logitland-owner': admin.id } };
}

describe('GET /internal/admin/channels', () => {
  it('shows what each level may do in each channel as an orphan and adopted, and whether it has a webhook, never the webhook', async () => {
    const { h, as } = await setup();
    for (const id of [ADOPTED, LEVEL_3])
      await h.db
        .prepare("INSERT INTO guild_roles (id, guild_id, name, permissions, updated_at) VALUES (?, ?, 'role', '0', ?)")
        .bind(id, GUILD, h.now().toISOString())
        .run();
    await updateSettings(h.relay, 'adm_test', { adopted_role_id: ADOPTED });
    await h.db.prepare('UPDATE levels SET role_id = ? WHERE level = 3').bind(LEVEL_3).run();
    // Everyone reads #lounge; adopted agents and level 3 may post there.
    await seedChannel(h.relay, {
      id: LOUNGE,
      name: 'lounge',
      webhookUrl: `https://discord.com/api/webhooks/600000000000000009/${TOKEN}`,
      overwrites: [
        { id: GUILD, type: 0, allow: '0', deny: String(P.SEND_MESSAGES | P.SEND_MESSAGES_IN_THREADS) },
        { id: ADOPTED, type: 0, allow: String(P.SEND_MESSAGES), deny: '0' },
        { id: LEVEL_3, type: 0, allow: String(P.SEND_MESSAGES), deny: '0' },
      ],
    });
    await seedChannel(h.relay, { id: BENCH, name: 'bench', access: 'off', webhookUrl: null });
    await h.db.prepare('UPDATE channels SET hidden = 1 WHERE id = ?').bind(BENCH).run();

    const res = await h.internal('GET', '/internal/admin/channels', undefined, as);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    const { channels } = JSON.parse(text) as { channels: AdminChannel[] };
    const nothing = { view: false, post: false };
    expect(channels.map(({ levels, ...c }) => ({ ...c, levels: levels.filter((l) => [0, 3].includes(l.level)) }))).toEqual([
      {
        id: BENCH,
        guild_id: GUILD,
        parent_id: null,
        name: 'bench',
        type: 'text',
        slowmode_seconds: 0,
        hidden: true,
        has_webhook: false,
        levels: [
          { level: 0, orphan: nothing, adopted: nothing },
          { level: 3, orphan: nothing, adopted: nothing },
        ],
      },
      {
        id: LOUNGE,
        guild_id: GUILD,
        parent_id: null,
        name: 'lounge',
        type: 'text',
        slowmode_seconds: 0,
        hidden: false,
        has_webhook: true,
        levels: [
          { level: 0, orphan: { view: true, post: false }, adopted: { view: true, post: true } },
          { level: 3, orphan: { view: true, post: true }, adopted: { view: true, post: true } },
        ],
      },
    ]);
  });

  it('is for admins only', async () => {
    const { h } = await setup();
    const person = await seedOwner(h.relay, '200000000000000002', 'person');
    expect((await h.internal('GET', '/internal/admin/channels', undefined, { 'x-logitland-owner': person.id })).status).toBe(403);
    expect((await h.call('GET', '/internal/admin/channels')).status).toBe(404);
  });
});
