import type { ConversationPage, EventsPage } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { agree } from './consent.testkit';
import { CONSENT_NOTICE_VERSION } from './services/consent';
import { ingest } from './services/intake';
import { AGREE_BUTTON, NOTICE_BUTTON, answerFromGateway } from './services/interactions';
import type { ModerationRequest } from './services/moderation/classifier';
import { GUILD, LOUNGE, harness, seedAgent, seedChannel, type HarnessOptions } from './testing';

// The /consent command and what it lets through intake: a person's messages, written after they agreed.

const PERSON = '700000000000000001';
const AGENT_POST = '810000000000000001';
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function setup(opts: HarnessOptions = {}) {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const h = harness({ ...opts, env: { DISCORD_PUBLIC_KEY: hex(await crypto.subtle.exportKey('raw', pair.publicKey)) } });
  await seedChannel(h.relay);
  /** Posts an interaction signed with Discord's key and waits for deferred work. */
  const send = async (payload: unknown) => {
    const raw = JSON.stringify(payload);
    const timestamp = String(Math.floor(h.now().getTime() / 1000));
    const signature = hex(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(timestamp + raw)));
    const res = await h.call('POST', '/v1/discord/interactions', payload, { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp });
    await h.settle();
    return {
      status: res.status,
      body: (await res.json()) as { type: number; data?: { content?: string; components?: { components: { custom_id: string }[] }[] } },
    };
  };
  return { h, send };
}

const base = { id: '800000000000000001', application_id: '400000000000000001', token: 'interaction-token', guild_id: GUILD, member: { user: { id: PERSON } } };
const command = (sub: string) => ({ ...base, type: 2, data: { name: 'consent', options: [{ name: sub, type: 1 }] } });
const press = (customId: string) => ({ ...base, type: 3, data: { custom_id: customId } });

let next = 820000000000000000n;
const message = (o: { author: { id: string; username: string; bot?: boolean; webhook_id?: string }; reply_to?: string; at?: string; content?: string }) => ({
  kind: 'message_create',
  channel_id: LOUNGE,
  message_id: String((next += 1n)),
  author: o.author,
  content: o.content ?? 'In the cellar, I think',
  timestamp: o.at ?? '2026-10-19T03:00:00.000Z',
  ...(o.reply_to ? { reply_to: o.reply_to } : {}),
});
const person = { id: PERSON, username: 'pat' };
const stored = (h: Awaited<ReturnType<typeof setup>>['h'], id: string) =>
  h.db.prepare('SELECT content, author_kind FROM conversation WHERE message_id = ?').bind(id).first<{ content: string | null; author_kind: string }>();

/** An agent's message in the lounge for people to reply to. */
async function agentMessage(h: Awaited<ReturnType<typeof setup>>['h']) {
  await h.db
    .prepare(
      "INSERT INTO conversation (message_id, channel_id, author_kind, agent_id, author_ref, display_name, content, created_at) VALUES (?, ?, 'agent', 'agt_0000000000AGENT', 'agt_0000000000AGENT', 'Atlas', 'Where are the lanterns?', ?)",
    )
    .bind(AGENT_POST, LOUNGE, '2026-10-19T02:00:00.000Z')
    .run();
}

describe('/consent', () => {
  it('shows the notice with a button and agrees only when the button is pressed', async () => {
    const { h, send } = await setup();
    const notice = await send(command('agree'));
    expect(notice.body).toMatchObject({ type: 4, data: { content: expect.stringContaining('Talking with agents in Logitland') } });
    expect(notice.body.data!.components![0]!.components[0]!.custom_id).toBe(AGREE_BUTTON);
    expect(await h.db.prepare('SELECT 1 FROM consents').first()).toBeNull();

    // The answer replaces the notice, button and all, instead of adding a message.
    const agreed = await send(press(AGREE_BUTTON));
    expect(agreed.body).toMatchObject({ type: 7, data: { content: expect.stringContaining('You agreed'), components: [] } });
    expect(await h.db.prepare('SELECT method, revoked_at FROM consents WHERE discord_user_id = ?').bind(PERSON).first()).toEqual({
      method: 'command',
      revoked_at: null,
    });
  });

  it('treats a button from an older notice, or on a turned-away message, as a request to see the current one', async () => {
    const { h, send } = await setup();
    for (const id of ['consent_agree:2020-01-01', NOTICE_BUTTON]) {
      const shown = await send(press(id));
      expect(shown.body).toMatchObject({ type: 4, data: { flags: 64 } });
      expect(shown.body.data!.components![0]!.components[0]!.custom_id).toBe(AGREE_BUTTON);
    }
    expect(await h.db.prepare('SELECT 1 FROM consents').first()).toBeNull();
  });

  it('on withdraw, stops relaying at once and keeps what was relayed: in reads, feeds and moderation context', async () => {
    const context: ModerationRequest['context'][] = [];
    const { h, send } = await setup({ moderator: { review: async (req) => (context.push(req.context), { verdict: 'pass' }) } });
    const agent = await seedAgent(h.relay);
    await h.call('POST', '/v1/subscriptions', { kind: 'channel', channel_id: LOUNGE, frequency: 'live' }, h.as(agent.token));
    await agree(h, PERSON);
    const before = message({ author: person, content: 'Said before withdrawing' });
    await ingest(h.relay, { source: 'test', events: [before] });

    const withdrawn = await send(command('withdraw'));
    expect(withdrawn.body).toMatchObject({
      type: 4,
      data: { content: 'Your agreement has ended: nothing you write from now on is relayed. Messages already relayed stay.' },
    });
    expect(await h.db.prepare('SELECT revoked_at FROM consents WHERE discord_user_id = ?').bind(PERSON).first()).toEqual({ revoked_at: h.now().toISOString() });
    const after = message({ author: person, content: 'Said after withdrawing', at: new Date(h.now().getTime() + 1000).toISOString() });
    await ingest(h.relay, { source: 'test', events: [after] });
    expect(await stored(h, after.message_id)).toBeNull();
    // Nor does an edit made after withdrawing reach what was relayed.
    const edited = { kind: 'message_update', channel_id: LOUNGE, message_id: before.message_id, content: 'Edited after withdrawing', edited_timestamp: after.timestamp };
    await ingest(h.relay, { source: 'test', events: [edited] });
    // Even when it arrives after they agree again.
    const later = new Date(h.now().getTime() + 2000).toISOString();
    await h.db.prepare('UPDATE consents SET revoked_at = NULL, granted_at = ? WHERE discord_user_id = ?').bind(later, PERSON).run();
    await ingest(h.relay, { source: 'replay', events: [edited] });
    await h.db.prepare('UPDATE consents SET revoked_at = ? WHERE discord_user_id = ?').bind(later, PERSON).run();

    const read = (await (await h.call('GET', `/v1/channels/${LOUNGE}/messages`, undefined, h.as(agent.token))).json()) as ConversationPage;
    expect(read.messages.map((m) => m.content)).toEqual(['Said before withdrawing']);
    const feed = (await (await h.call('GET', '/v1/events', undefined, h.as(agent.token))).json()) as EventsPage;
    expect(feed.digests.flatMap((d) => d.events).map((e) => e.type === 'message.created' && e.data.content)).toEqual(['Said before withdrawing']);
    await h.call('POST', '/v1/messages', { channel_id: LOUNGE, content: 'Noted.' }, { ...h.as(agent.token), 'idempotency-key': 'noted-0001' });
    expect(context).toEqual([[{ author: 'pat', content: 'Said before withdrawing' }]]);
  });

  it('withdraws at once however often the person has toggled', async () => {
    const { h, send } = await setup();
    for (let i = 0; i < 3; i++) {
      await send(press(AGREE_BUTTON));
      await send(command('withdraw'));
    }
    expect((await send(press(AGREE_BUTTON))).body.data!.content).toContain('a few times in a row');
    await h.db.prepare('UPDATE consents SET revoked_at = NULL WHERE discord_user_id = ?').bind(PERSON).run();
    expect((await send(command('withdraw'))).body.data!.content).toContain('Your agreement has ended');
    expect(await h.db.prepare('SELECT revoked_at FROM consents WHERE discord_user_id = ?').bind(PERSON).first()).not.toEqual({ revoked_at: null });
  });

  it('keeps what they wrote under an earlier agreement when they agree again', async () => {
    const { h, send } = await setup();
    const agent = await seedAgent(h.relay);
    await send(press(AGREE_BUTTON));
    const first = message({ author: person, content: 'Under the first agreement', at: new Date(h.now().getTime() + 1000).toISOString() });
    await ingest(h.relay, { source: 'test', events: [first] });
    h.advance(60_000);
    await send(command('withdraw'));
    h.advance(60_000);
    await send(press(AGREE_BUTTON));
    const read = (await (await h.call('GET', `/v1/channels/${LOUNGE}/messages`, undefined, h.as(agent.token))).json()) as ConversationPage;
    expect(read.messages.map((m) => m.content)).toEqual(['Under the first agreement']);
  });
});

describe('/consent over the Gateway', () => {
  it('answers through the interaction callback, without a signature', async () => {
    const { h } = await setup();
    await answerFromGateway(h.relay, command('agree'));
    const call = h.discordCalls.find((r) => r.method === 'POST' && r.url.endsWith(`/interactions/${base.id}/${base.token}/callback`));
    expect(await call?.json()).toMatchObject({ type: 4, data: { content: expect.stringContaining('Talking with agents in Logitland') } });
  });
});

describe('people’s messages at intake', () => {
  it('keeps only a consenting person’s messages, written after they agreed', async () => {
    const { h } = await setup();
    await agentMessage(h);
    await agree(h, PERSON, { at: '2026-10-19T02:30:00.000Z' });
    const cases = [
      // [message, kept, why]
      [message({ author: person, reply_to: AGENT_POST }), true, 'a reply to an agent after agreeing'],
      [message({ author: person }), true, 'a plain message after agreeing'],
      [message({ author: person, reply_to: AGENT_POST, at: '2026-10-19T02:10:00.000Z' }), false, 'written before agreeing'],
      [message({ author: { id: '700000000000000002', username: 'sam' }, reply_to: AGENT_POST }), false, 'from someone who never agreed'],
      [message({ author: { id: '700000000000000003', username: 'newsbot', bot: true } }), true, 'a bot, which is not a person'],
    ] as const;
    await ingest(h.relay, { source: 'test', events: cases.map(([m]) => m) });
    for (const [m, kept, why] of cases) {
      expect(Boolean(await stored(h, m.message_id)), why).toBe(kept);
      expect(Boolean(await h.db.prepare('SELECT 1 FROM events WHERE message_id = ?').bind(m.message_id).first()), why).toBe(kept);
    }
  });

  it('keeps only replies to agents under the earlier notice, and every later message once the person agrees to the current one', async () => {
    const { h, send } = await setup();
    await agentMessage(h);
    await agree(h, PERSON, { notice: '2026-10-21' });
    const reply = message({ author: person, reply_to: AGENT_POST });
    const before = message({ author: person, at: '2026-10-19T03:00:00.000Z' });
    await ingest(h.relay, { source: 'test', events: [reply, before] });
    expect(await stored(h, reply.message_id)).not.toBeNull();
    expect(await stored(h, before.message_id)).toBeNull();

    expect((await send(press(AGREE_BUTTON))).body.data!.content).toContain('You agreed:');
    const row = await h.db
      .prepare('SELECT notice_version, granted_at FROM consents WHERE discord_user_id = ?')
      .bind(PERSON)
      .first<{ notice_version: string; granted_at: string }>();
    expect(row!.notice_version).toBe(CONSENT_NOTICE_VERSION);
    const history = await h.db.prepare("SELECT notice_version FROM consent_history WHERE discord_user_id = ? AND action = 'granted'").bind(PERSON).all();
    expect(history.results).toEqual([{ notice_version: CONSENT_NOTICE_VERSION }]);

    // A plain message from before the upgrade, arriving late, still isn't covered; one written after it is.
    const late = message({ author: person, at: new Date(h.now().getTime() - 60_000).toISOString() });
    const after = message({ author: person, at: new Date(h.now().getTime() + 1000).toISOString() });
    await ingest(h.relay, { source: 'test', events: [late, after] });
    expect(await stored(h, late.message_id)).toBeNull();
    expect(await stored(h, after.message_id)).not.toBeNull();
  });
});
