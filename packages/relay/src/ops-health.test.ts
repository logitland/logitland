import type { AdminHealth } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { BOT_ROLE, P, admin, bits, connectGateway, discordWorld } from './mirror.testkit';
import { ANNOUNCE, down, mod, pass, post, say, world } from './posting-fixtures';
import { alertsJob } from './services/alerts';
import { reviewHeldJob } from './services/review';
import { updateSettings } from './services/settings';
import { GUILD, cardButtons, cardText, type Harness } from './testing';

const STAFF = '110000000000000099';
const HEALTH = '110000000000000097';
const SECRET = '110000000000000098';

async function getHealth(h: Harness): Promise<AdminHealth> {
  const { as } = await admin(h);
  const res = await h.internal('GET', '/internal/admin/health', undefined, as);
  expect(res.status).toBe(200);
  return (await res.json()) as AdminHealth;
}

describe('GET /internal/admin/health', () => {
  it('reports the Gateway, TypeSafe, the held queue, the delivery backlog and the bot’s permissions', async () => {
    const { h, a } = await world({ moderator: mod(down) });
    discordWorld(h);
    await connectGateway(h);
    // The bot's role, as the Gateway stores it, may manage webhooks; in #news it is denied Send Messages.
    await h.db
      .prepare("INSERT INTO guild_roles (id, guild_id, name, permissions, updated_at) VALUES (?, ?, 'Logitland Relay', ?, ?)")
      .bind(BOT_ROLE, GUILD, bits(P.MANAGE_WEBHOOKS), h.now().toISOString())
      .run();
    await h.db
      .prepare('UPDATE channels SET overwrites = ? WHERE id = ?')
      .bind(JSON.stringify([{ id: BOT_ROLE, type: 0, allow: '0', deny: bits(P.SEND_MESSAGES) }]), ANNOUNCE)
      .run();
    await h.db
      .prepare("INSERT INTO channels (id, guild_id, name, hidden, updated_at) VALUES (?, ?, 'secret', 1, ?)")
      .bind(SECRET, GUILD, h.now().toISOString())
      .run();

    // TypeSafe is down, so the message waits in the held queue.
    const heldAt = h.now().toISOString();
    expect((await post(h, a, say('hello there'))).status).toBe(202);

    // Two deliveries waiting, one retrying, and a paused webhook.
    const due = '2026-10-19T02:58:00.000Z';
    for (const [id, status, at] of [
      ['dlv_1', 'pending', due],
      ['dlv_2', 'pending', '2026-10-19T03:05:00.000Z'],
      ['dlv_3', 'retrying', '2026-10-19T03:01:00.000Z'],
      ['dlv_4', 'delivered', null],
    ] as const)
      await h.db
        .prepare(
          "INSERT INTO deliveries (id, agent_id, subscription_id, event_count, body, status, next_attempt_at, created_at) VALUES (?, ?, 'sub_1', 1, '{}', ?, ?, ?)",
        )
        .bind(id, a.id, status, at, h.now().toISOString())
        .run();
    await h.db
      .prepare(
        "INSERT INTO agent_webhooks (agent_id, url_ciphertext, url_host, secret_ciphertext, status, created_at, updated_at) VALUES (?, 'x', 'hooks.orrery.dev', 'x', 'paused', ?, ?)",
      )
      .bind(a.id, h.now().toISOString(), h.now().toISOString())
      .run();

    const health = await getHealth(h);
    expect(health.intake.status).toBe('connected');
    expect(health.typesafe).toMatchObject({ failing: true, last_failure_at: heldAt, last_answer_at: null });
    expect(health.typesafe.last_failure).toContain('it is down');
    expect(health.moderation).toMatchObject({ held_for_outage: 1, held_for_review: 0, oldest_held_at: heldAt });
    expect(health.deliveries).toMatchObject({ due: 1, pending: 2, retrying: 1, oldest_due_at: due, paused_webhooks: 1 });
    const can = { can_view: true, can_send: true, can_manage_webhooks: true, can_read_history: true };
    expect(health.bot_permissions).toEqual([
      { channel_id: expect.any(String), name: 'forum', ...can },
      { channel_id: expect.any(String), name: 'lounge', ...can },
      { channel_id: expect.any(String), name: 'media', ...can },
      { channel_id: ANNOUNCE, name: 'news', ...can, can_send: false },
      { channel_id: SECRET, name: 'secret', can_view: false, can_send: false, can_manage_webhooks: false, can_read_history: false },
    ]);
  });

  it('says the bot’s permissions are unknown when Discord can’t be asked', async () => {
    const { h } = await world();
    discordWorld(h).overrides['GET /users/@me'] = () => new Response(null, { status: 500 });
    expect((await getHealth(h)).bot_permissions).toBeNull();
  });
});

describe('alerts in the staff channel', () => {
  it('posts each alert once when it starts and once when it clears, in #relay-health or else the alerts channel, and nothing without either', async () => {
    let answer = down;
    const { h, a } = await world({ moderator: mod(() => answer) });
    await connectGateway(h);
    /** The cards posted in a channel so far: their text, accent and buttons. */
    const posts = async (channel = STAFF) => {
      await alertsJob(h.relay);
      const sent = h.discordCalls.filter((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith(`/channels/${channel}/messages`));
      const bodies = await Promise.all(sent.map(async (r) => (await r.clone().json()) as { flags: number; components: { accent_color: number }[] }));
      return bodies.map((b) => ({ flags: b.flags, text: cardText(b), accent: b.components[0]!.accent_color, buttons: cardButtons(b) }));
    };
    const health = [{ label: 'Open Health', url: 'https://logitland.test/admin/health' }];

    expect((await post(h, a, say('hello there'))).status).toBe(202);
    expect(await posts()).toEqual([]);

    await updateSettings(h.relay, 'adm_test', { alerts_channel_id: STAFF });
    expect(await posts()).toEqual([
      { flags: 1 << 15, text: expect.stringMatching(/^Jev on TypeSafe is failing\. 1 message is held/), accent: 0xf66d67, buttons: health },
    ]);
    expect(await posts()).toHaveLength(1);

    // The Gateway drops: only after 5 minutes is it alerted, now in #relay-health.
    await updateSettings(h.relay, 'adm_test', { relay_health_channel_id: HEALTH });
    await connectGateway(h, 'reconnecting');
    h.advance(60_000);
    expect(await posts(HEALTH)).toHaveLength(0);
    h.advance(5 * 60_000);
    expect((await posts(HEALTH)).map((p) => p.text)).toEqual([expect.stringMatching(/^The Gateway has been disconnected for over 5 minutes \(reconnecting\)/)]);
    expect(await posts(HEALTH)).toHaveLength(1);

    // TypeSafe answers again, the held message goes out, and the Gateway reconnects.
    answer = pass;
    await reviewHeldJob(h.relay, 10_000);
    await h.db
      .prepare("UPDATE intake_state SET status = 'connected', last_heartbeat_at = ?, updated_at = ? WHERE source = 'gateway'")
      .bind(h.now().toISOString(), h.now().toISOString())
      .run();
    const cleared = (await posts(HEALTH)).slice(1);
    expect(cleared.map((p) => p.text).sort()).toEqual(['Jev on TypeSafe is answering again.', 'The Gateway is connected again.']);
    expect(cleared.map((p) => p.accent)).toEqual([0x6fd087, 0x6fd087]);
    expect(await posts()).toHaveLength(1);
  });
});
