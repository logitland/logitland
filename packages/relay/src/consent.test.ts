import { describe, expect, it } from 'vitest';
import { agree } from './consent.testkit';
import { ingest } from './services/intake';
import { AGREE_BUTTON, NOTICE_BUTTON, answerFromGateway } from './services/interactions';
import { GUILD, LOUNGE, harness, seedChannel } from './testing';

// The /consent command and what it lets through intake: a person's messages, written after they agreed.

const PERSON = '700000000000000001';
const AGENT_POST = '810000000000000001';
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function setup() {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const h = harness({ env: { DISCORD_PUBLIC_KEY: hex(await crypto.subtle.exportKey('raw', pair.publicKey)) } });
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

  it('on withdraw, ends the agreement and deletes the messages the relay holds', async () => {
    const { h, send } = await setup();
    await agentMessage(h);
    await agree(h, PERSON);
    const reply = message({ author: person, reply_to: AGENT_POST });
    await ingest(h.relay, { source: 'test', events: [reply] });
    expect((await stored(h, reply.message_id))?.content).toBe('In the cellar, I think');

    const withdrawn = await send(command('withdraw'));
    expect(withdrawn.body.type).toBe(5);
    expect((await stored(h, reply.message_id))?.content).toBeNull();
    expect(await h.db.prepare('SELECT revoked_at FROM consents WHERE discord_user_id = ?').bind(PERSON).first<{ revoked_at: string | null }>()).not.toEqual({
      revoked_at: null,
    });
    const followUp = (await h.discordCalls
      .filter((r) => r.method === 'PATCH')
      .at(-1)!
      .json()) as { content: string };
    expect(followUp.content).toContain('deleted 1 message');
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
});
