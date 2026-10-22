// The relay end to end on workerd. Every scenario asserts both sides: what the relay's API says, and what the fake
// Discord received (or sent). One Worker, one database and one fake Discord serve the whole file, so the scenarios
// run in order and later ones can rely on earlier ones (the Gateway is connected from (c) on).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEV } from '../../../../packages/discord-fake/src/index.ts';
import { verify } from '../../../../packages/webhooks/src/index.ts';
import { E2E, JWT_BEARER, eventually, sleep, solve, startStack, type Agent, type Reply, type Stack } from './harness.ts';

const MESSAGE_CONTENT = 1 << 15;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

describe.skipIf(!E2E)('the relay on workerd, against a fake Discord', () => {
  let s: Stack;
  let atlas: Agent;
  /** Atlas's avatar as the relay reports it: its sigil, which Discord is told to show with every post. */
  let atlasSigil: string;
  let vesper: Agent;
  let orrery: Agent;
  /** Vesper's live subscription to the lounge, from the long-poll scenario on. */
  let vesperLounge: string;
  let counter = 0;
  const visitor = DEV.visitor;

  const unique = (what: string) => `${what} (${Date.now().toString(36)}-${counter++})`;
  const idem = () => `e2e-${Date.now().toString(36)}-${counter++}`;
  const post = (who: Agent, body: Record<string, unknown>) =>
    s.call('POST', '/v1/messages', { token: who.token, body, headers: { 'idempotency-key': idem() } });
  const channelPage = (who: Agent, channel: string, query = '') => s.call('GET', `/v1/channels/${channel}/messages${query}`, { token: who.token });
  const find = (res: Reply, messageId: string) => res.body.messages.find((m: { message_id: string }) => m.message_id === messageId);
  const seen = (who: Agent, channel: string, messageId: string) => async () => find(await channelPage(who, channel), messageId);
  const executions = () => s.fake.requestsTo('webhook.execute');

  beforeAll(async () => {
    s = await startStack();
  });
  afterAll(async () => {
    // Nothing the suite did may have left the machine.
    const blocked = s?.outbound.blocked ?? [];
    await s?.dispose();
    expect(blocked).toEqual([]);
  });

  /* ---------- (b) Registration ---------- */

  it('(b) registers an agent with a real proof of work, trades its identity assertion for an access token, and reads it back', async () => {
    const headers = { 'cf-connecting-ip': '203.0.113.10' };
    const challenge = await s.call('GET', '/agent/identity/challenge', { headers });
    expect(challenge.status).toBe(200);
    expect(challenge.body).toMatchObject({ algorithm: 'sha256-leading-zero-bits', difficulty: 20, challenge: expect.stringMatching(/^pow_/) });

    const pow = { challenge: challenge.body.challenge, nonce: solve(challenge.body.challenge, challenge.body.difficulty) };
    const registered = await s.call('POST', '/agent/identity', { headers, body: { type: 'anonymous', name: 'Atlas-7', pow } });
    expect(registered.status).toBe(200);
    expect(registered.body).toMatchObject({
      registration_id: expect.stringMatching(/^agt_/),
      registration_type: 'anonymous',
      identity_assertion: expect.any(String),
      claim_token: expect.stringMatching(/^clm_/),
      name: 'Atlas-7',
    });

    const exchanged = await s.call('POST', '/oauth2/token', {
      headers,
      form: { grant_type: JWT_BEARER, assertion: registered.body.identity_assertion },
    });
    expect(exchanged.status).toBe(200);
    expect(exchanged.body).toMatchObject({
      access_token: expect.stringMatching(/^lat_/),
      token_type: 'Bearer',
      expires_in: 3600,
      identity_assertion: expect.any(String),
    });
    atlas = { agent_id: registered.body.registration_id, token: exchanged.body.access_token, name: 'Atlas-7' };

    // Every agent starts on probation, unadopted, with its sigil as its avatar.
    const me = await s.call('GET', '/v1/me', { token: atlas.token });
    expect(me.status).toBe(200);
    expect(me.body.agent).toMatchObject({ id: atlas.agent_id, name: 'Atlas-7', status: 'active', adopted: false, custom_avatar: false });
    expect(me.body.level).toMatchObject({ level: 0, xp: 0 });
    atlasSigil = me.body.agent.avatar_url;
    expect(new URL(atlasSigil).pathname).toBe(`/v1/avatars/${atlas.agent_id}.png`);
    const sigil = await fetch(`${s.base}/v1/avatars/${atlas.agent_id}.png`);
    expect(sigil.status).toBe(200);
    expect(sigil.headers.get('content-type')).toBe('image/png');
    expect([...new Uint8Array(await sigil.arrayBuffer()).slice(0, 4)]).toEqual(PNG_SIGNATURE);

    // The token is stored as a hash, the proof of work can't be used twice, and none of this touched Discord.
    const [stored] = await s.sql<{ hash: string }>('SELECT hash FROM access_tokens WHERE agent_id = ?', atlas.agent_id);
    expect(stored!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored!.hash).not.toContain(atlas.token);
    const again = await s.call('POST', '/agent/identity', { headers, body: { type: 'anonymous', name: 'Atlas-8', pow } });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: 'invalid_request', error_description: expect.stringContaining('already used') });
    expect(s.fake.requests).toHaveLength(0);
    expect((await s.call('GET', '/v1/me')).status).toBe(401);

    // The other agents in this file register with a cheap proof of work, which an admin can ask for.
    await s.db
      .prepare("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('pow_difficulty', '8', 'e2e', ?)")
      .bind(new Date().toISOString())
      .run();
    vesper = await s.register('Vesper', '198.51.100.20');
    orrery = await s.register('Orrery', '192.0.2.30');
  });

  /* ---------- (c) Cron wakes the Gateway ---------- */

  it('(c) cron wakes the Gateway Durable Object, which connects to Discord and identifies with the Message Content intent', async () => {
    expect(s.fake.gateway.info()).toHaveLength(0);
    const cron = await s.cron();
    expect(cron.status).toBe(200);

    await eventually(() => s.fake.gateway.received('IDENTIFY').length === 1, { what: 'the Gateway to identify' });
    const [identify] = s.fake.gateway.received('IDENTIFY');
    expect(identify!.d).toMatchObject({ token: s.fake.botToken, properties: expect.any(Object) });
    expect((identify!.d as { intents: number }).intents & MESSAGE_CONTENT).toBe(MESSAGE_CONTENT);

    await eventually(async () => (await s.sql<{ status: string }>("SELECT status FROM intake_state WHERE source = 'gateway'"))[0]?.status === 'connected', {
      what: 'intake_state to say connected',
    });
    const [state] = await s.sql<{ session_id: string; resume_url: string }>("SELECT session_id, resume_url FROM intake_state WHERE source = 'gateway'");
    expect(state!.session_id).toBe(s.fake.gateway.info()[0]!.id);
    expect(state!.resume_url).toBe(s.fake.gatewayUrl);

    // The same, as the admin console reads it.
    const owner = await s.adminOwner();
    const health = await s.dashboard('GET', '/internal/admin/health', { owner });
    expect(health.status).toBe(200);
    expect(health.body.intake.status).toBe('connected');
    // Running cron again changes nothing: still one session.
    await s.cron();
    await sleep(300);
    expect(s.fake.gateway.received('IDENTIFY')).toHaveLength(1);
    expect(s.outbound.sockets).toBe(1);
  });

  /* ---------- (d) Posting ---------- */

  describe('(d) posting', () => {
    it('sends an agent’s post through the channel’s Durable Object to the webhook, and the Gateway echo is attributed to the agent', async () => {
      const content = unique('Hello from Atlas');
      const sent = await post(atlas, { channel_id: s.channels.lounge, content });
      expect(sent.status).toBe(201);
      expect(sent.body).toMatchObject({
        status: 'sent',
        channel_id: s.channels.lounge,
        content,
        agent_id: atlas.agent_id,
        discord_message_id: expect.stringMatching(/^\d{17,20}$/),
      });
      const did: string = sent.body.discord_message_id;

      // The fake Discord: one webhook post as the agent, wearing its sigil, never parsing mentions.
      const requests = executions().filter((r) => (r.body as { content: string }).content === content);
      expect(requests).toHaveLength(1);
      expect(requests[0]!.body).toEqual({ content, username: 'Atlas-7', avatar_url: atlasSigil, allowed_mentions: { parse: [] } });
      expect(requests[0]!.query).toEqual({ wait: 'true' });
      expect(requests[0]!.params.id).toBe((await s.relayWebhook(s.channels.lounge))!.id);
      expect(requests[0]!.headers['user-agent']).toMatch(/^DiscordBot \(/);
      expect(s.fake.messages(s.channels.lounge).find((m) => m.id === did)).toMatchObject({
        content,
        webhook_id: expect.any(String),
        author: { username: 'Atlas-7', bot: true },
      });

      // The relay: the Gateway told it about the message, and it is one message by one agent.
      const mine = await eventually(seen(atlas, s.channels.lounge, did), { what: 'the post in the channel' });
      expect(mine).toMatchObject({ content, deleted: false, author: { kind: 'agent', agent_id: atlas.agent_id, display_name: 'Atlas-7' } });
      await eventually(async () => s.fake.gateway.sent('MESSAGE_CREATE').some((f) => (f.d as { id: string }).id === did), { what: 'the Gateway dispatch' });
      await sleep(300);
      expect((await s.sql('SELECT 1 FROM conversation WHERE message_id = ?', did)).length).toBe(1);
      expect((await s.sql('SELECT 1 FROM events WHERE source_key = ?', `create:${did}`)).length).toBe(1);

      // There is no public view of the channels.
      expect((await s.call('GET', '/public/channels')).status).toBe(404);

      // And in the agent's own record of the send.
      const record = await s.call('GET', `/v1/messages/${sent.body.id}`, { token: atlas.token });
      expect(record.body).toMatchObject({ status: 'sent', discord_message_id: did });
    });

    it('lets a long poll on /v1/events return a digest the moment a message lands in a subscribed channel', async () => {
      const subscribed = await s.call('POST', '/v1/subscriptions', {
        token: vesper.token,
        body: { kind: 'channel', channel_id: s.channels.lounge, frequency: 'live' },
      });
      expect(subscribed.status).toBe(201);
      vesperLounge = subscribed.body.id;
      // Take whatever is already waiting, so the poll below has nothing until the message arrives.
      expect((await s.call('GET', '/v1/events', { token: vesper.token })).status).toBe(200);

      const started = Date.now();
      const poll = s.call('GET', '/v1/events?wait=20', { token: vesper.token });
      await sleep(400);
      const said = s.fake.say(s.channels.lounge, { as: DEV.newsbot, content: unique('Newsbot wakes the poll') });

      const page = (await poll).body;
      expect(Date.now() - started).toBeLessThan(10_000);
      const digest = page.digests.find((d: { subscription_id: string }) => d.subscription_id === vesperLounge);
      expect(digest).toMatchObject({ type: 'digest', more: false, cursor: expect.stringMatching(/^\d+$/) });
      const created = digest.events.find((e: { type: string; data: { message_id: string } }) => e.type === 'message.created' && e.data.message_id === said.id);
      expect(created).toMatchObject({
        schema_version: 1,
        channel_id: s.channels.lounge,
        guild_id: s.community.guildId,
        data: { content: said.content, author: { kind: 'bot', display_name: 'newsbot' } },
      });
      // Taking it moved the subscription on: it isn't given again.
      const again = (await s.call('GET', '/v1/events', { token: vesper.token })).body.digests as { events: { data: { message_id?: string } }[] }[];
      expect(again.flatMap((d) => d.events).some((e) => e.data.message_id === said.id)).toBe(false);
    });

    it('the Gateway can beat the HTTP answer: the post is attributed to the agent anyway', async () => {
      const content = unique('Orrery outruns its own answer');
      s.fake.fail({ route: 'webhook.execute' }, { type: 'slow', ms: 900, phase: 'after' });
      const sending = post(orrery, { channel_id: s.channels.lounge, content });
      const early = await eventually(
        async () => {
          const row = (
            await s.sql<{ author_kind: string; agent_id: string | null; content: string }>(
              'SELECT author_kind, agent_id, content FROM conversation WHERE channel_id = ? AND content = ?',
              s.channels.lounge,
              content,
            )
          )[0];
          return row;
        },
        { what: 'the Gateway echo before the HTTP answer' },
      );
      expect(early).toMatchObject({ author_kind: 'agent', agent_id: orrery.agent_id });
      const sent = await sending;
      expect(sent.status).toBe(201);
      expect(sent.body.status).toBe('sent');
      expect((await s.sql('SELECT 1 FROM conversation WHERE content = ?', content)).length).toBe(1);
    });

    it('treats a message posted straight to the webhook, outside the relay, as a webhook and not as any agent', async () => {
      const hook = (await s.relayWebhook(s.channels.lounge))!;
      const content = unique('Posted around the relay');
      const res = await fetch(`${s.fake.apiBase}/webhooks/${hook.id}/${hook.token}?wait=true`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, username: 'Atlas-7' }),
      });
      const message = (await res.json()) as { id: string };
      const row = await eventually(seen(vesper, s.channels.lounge, message.id), { what: 'the webhook message' });
      expect(row.author).toMatchObject({ kind: 'webhook', agent_id: null, display_name: 'Atlas-7' });
    });

    it('keeps agents out of read-only channels and still lets them read', async () => {
      const before = executions().length;
      const refused = await post(atlas, { channel_id: s.channels.announcements, content: unique('Not allowed here') });
      expect(refused.status).toBe(403);
      expect(executions()).toHaveLength(before);

      // Agents can still read here, through bots and webhooks; a person's own message is never relayed unless it's a consenting reply.
      const news = s.fake.say(s.channels.announcements, { as: DEV.newsbot, content: unique('Release day') });
      const row = await eventually(seen(atlas, s.channels.announcements, news.id), { what: 'the announcement' });
      expect(row).toMatchObject({ author: { kind: 'bot', display_name: 'newsbot' } });
    });
  });

  /* ---------- (e) People and consent ---------- */

  it('(e) relays only a consenting person’s messages, agrees only on the button, and deletes them on /consent withdraw', async () => {
    const agentPost = await post(atlas, { channel_id: s.channels.lounge, content: unique('Anyone know where the lanterns are?') });
    expect(agentPost.status).toBe(201);
    const target: string = agentPost.body.discord_message_id;
    const notStored = async (id: string) => (await s.sql('SELECT 1 FROM conversation WHERE message_id = ?', id)).length === 0;

    // Before agreeing: neither a plain message nor a reply to an agent is kept, not even as a marker.
    const before = unique('A person says hello before agreeing');
    const early = s.fake.say(s.channels.lounge, { as: visitor, content: before });
    const earlyReply = s.fake.say(s.channels.lounge, { as: visitor, content: unique('An early reply'), replyTo: target });
    const marker = s.fake.say(s.channels.lounge, { as: DEV.admin, content: unique('The admin says something after them') });
    // The admin agreed before the suite, so this is kept; once it is, the visitor's messages, sent before it, have been looked at.
    await eventually(async () => !(await notStored(marker.id)), { what: 'intake to pass the messages' });
    for (const m of [early, earlyReply]) expect(await notStored(m.id)).toBe(true);
    expect(await s.sql('SELECT 1 FROM events WHERE message_id IN (?, ?)', early.id, earlyReply.id)).toEqual([]);

    // /consent agree shows the notice and a button, and agrees to nothing.
    const notice = await s.fake.interact({ user: visitor, command: { name: 'consent', subcommand: 'agree' }, channelId: s.channels.lounge });
    expect(notice.status).toBe(200);
    expect(notice.body).toMatchObject({
      type: 4,
      data: {
        flags: 64,
        content: expect.stringContaining('Talking with agents in Logitland'),
        components: [{ type: 1, components: [{ type: 2, style: 1, custom_id: expect.stringMatching(/^consent_agree:\d{4}-\d{2}-\d{2}$/) }] }],
      },
    });
    expect((notice.body as { data: { content: string } }).data.content.length).toBeLessThanOrEqual(2000);
    expect(await s.sql('SELECT 1 FROM consents WHERE discord_user_id = ?', visitor)).toEqual([]);

    // Pressing the button agrees, at once. No Discord role is involved.
    const press = await s.fake.interact({
      user: visitor,
      button: { customId: (notice.body as { data: { components: { components: { custom_id: string }[] }[] } }).data.components[0]!.components[0]!.custom_id },
      channelId: s.channels.lounge,
    });
    expect(press.status).toBe(200);
    // The answer replaces the ephemeral notice instead of adding a message.
    expect(press.body).toMatchObject({ type: 7, data: { components: [], content: expect.stringContaining('You agreed') } });
    expect(s.fake.requestsTo('guild.member.role.add')).toHaveLength(0);
    expect(
      (
        await s.sql<{ method: string; revoked_at: string | null; interaction_id: string }>(
          'SELECT method, revoked_at, interaction_id FROM consents WHERE discord_user_id = ?',
          visitor,
        )
      )[0],
    ).toEqual({ method: 'command', revoked_at: null, interaction_id: press.interaction.id });

    // Now what they write is relayed, a reply to an agent or not.
    const text = unique('In the cellar, I think');
    const reply = s.fake.say(s.channels.lounge, { as: visitor, content: text, replyTo: target });
    const chatter = s.fake.say(s.channels.lounge, { as: visitor, content: unique('Just chatting') });
    const row = await eventually(
      async () => {
        const r = find(await channelPage(orrery, s.channels.lounge), reply.id);
        return r?.content ? r : null;
      },
      { what: 'the person’s reply' },
    );
    expect(row).toMatchObject({ content: text, reply_to: target, author: { kind: 'human', display_name: 'A visitor', agent_id: null } });
    expect(row.author.author_id).toMatch(/^p_/);
    expect(JSON.stringify(row)).not.toContain(visitor);
    await eventually(async () => !(await notStored(chatter.id)), { what: 'the person’s plain message' });

    // /consent withdraw: the agreement ends at once and the held messages go.
    const withdraw = await s.fake.interact({ user: visitor, command: { name: 'consent', subcommand: 'withdraw' }, channelId: s.channels.lounge });
    expect(withdraw.status).toBe(200);
    expect(withdraw.body).toMatchObject({ type: 5, data: { flags: 64 } });
    const gone = await eventually(
      async () => {
        const r = find(await channelPage(orrery, s.channels.lounge), reply.id);
        return r?.deleted ? r : null;
      },
      { what: 'the reply to be deleted' },
    );
    expect(gone).toMatchObject({ content: null, deleted: true });
    const created = await s.sql<{ text: string | null }>(
      "SELECT json_extract(payload, '$.data.content') AS text FROM events WHERE message_id = ? AND type = 'message.created'",
      reply.id,
    );
    expect(created.map((r) => r.text)).toEqual(['']);
    expect(
      (await s.sql('SELECT action FROM consent_history WHERE discord_user_id = ? ORDER BY id', visitor)).map((r) => (r as { action: string }).action),
    ).toEqual(['granted', 'revoked']);
    const record = s.fake.interactions.all().find((i) => i.id === withdraw.interaction.id)!;
    await eventually(() => record.followUps.length > 0, { what: 'the follow-up to /consent withdraw' });
    expect(record.followUps[0]).toMatchObject({ kind: 'original', content: expect.stringContaining('You withdrew'), flags: 64 });
    // Nothing the person wrote is anywhere in the relay's stores, before or after.
    for (const word of [before, text]) {
      expect(JSON.stringify(await s.sql('SELECT payload FROM events'))).not.toContain(word);
      expect(JSON.stringify(await s.sql('SELECT content FROM conversation'))).not.toContain(word);
    }
  });

  // Interaction follow-ups use DISCORD_API_BASE in development, so /consent withdraw never reaches the real Discord.
  it('(e) sends interaction follow-ups to DISCORD_API_BASE, never to the real discord.com', () => {
    expect(s.outbound.redirected.filter((r) => r.includes('/messages/@original'))).toEqual([]);
  });

  /* ---------- (f) Forum posts ---------- */

  it('(f) starts a forum post with thread_name and replies into it with thread_id', async () => {
    const title = 'Idea: lanterns for the quiet corners';
    const opening = unique('What if the lanterns remembered who lit them?');
    const tag = s.fake.world.channel(s.channels.forum).available_tags![0]!;
    const started = await post(vesper, { channel_id: s.channels.forum, content: opening, thread_name: title, tag_ids: [tag.id] });
    expect(started.status).toBe(201);
    const threadId: string = started.body.thread_id;
    expect(threadId).toMatch(/^\d{17,20}$/);
    expect(started.body.discord_message_id).toBe(threadId);

    const execute = executions().find((r) => (r.body as { content: string }).content === opening)!;
    expect(execute.body).toMatchObject({ thread_name: title, applied_tags: [tag.id], username: 'Vesper', allowed_mentions: { parse: [] } });
    expect(execute.query).toEqual({ wait: 'true' });
    expect(s.fake.world.channel(threadId)).toMatchObject({ type: 11, parent_id: s.channels.forum, name: title, applied_tags: [tag.id] });

    const reply = unique('Replying in the thread');
    const replied = await post(orrery, { channel_id: s.channels.forum, content: reply, thread_id: threadId });
    expect(replied.status).toBe(201);
    expect(replied.body.thread_id).toBe(threadId);
    const replyRequest = executions().find((r) => (r.body as { content: string }).content === reply)!;
    expect(replyRequest.query).toEqual({ wait: 'true', thread_id: threadId });
    expect(replyRequest.body).not.toHaveProperty('thread_name');
    expect(s.fake.messages(threadId).map((m) => m.content)).toEqual([opening, reply]);

    const page = await eventually(
      async () => {
        const res = await channelPage(atlas, s.channels.forum, `?thread_id=${threadId}`);
        return res.body.messages.length === 2 ? res : null;
      },
      { what: 'the thread to be readable' },
    );
    expect(page.body.messages.map((m: { content: string }) => m.content)).toEqual([reply, opening]);
    expect(page.body.messages.every((m: { thread_id: string; channel_id: string }) => m.thread_id === threadId && m.channel_id === s.channels.forum)).toBe(
      true,
    );
    expect(page.body.messages.map((m: { author: { display_name: string } }) => m.author.display_name)).toEqual(['Orrery', 'Vesper']);
    // The Gateway's THREAD_CREATE is written in the next batch.
    const thread = await eventually(
      async () => (await s.sql<{ parent_id: string; name: string }>('SELECT parent_id, name FROM threads WHERE id = ?', threadId))[0],
      { what: 'the thread to be recorded' },
    );
    expect(thread).toEqual({ parent_id: s.channels.forum, name: title });

    // A forum post needs a thread, and the relay checks tags before Discord does.
    const before = executions().length;
    expect((await post(vesper, { channel_id: s.channels.forum, content: unique('No thread') })).status).toBe(400);
    const badTag = await post(vesper, { channel_id: s.channels.forum, content: unique('Odd tag'), thread_name: 'Odd', tag_ids: ['100000000000000000'] });
    expect(badTag.status).toBe(400);
    expect(badTag.body.detail).toContain('no tag with ID');
    expect(executions()).toHaveLength(before);
  });

  it('(f) opens a thread from a message in a text channel, and replies into it', async () => {
    const content = unique('Let us take this to a thread');
    const started = await post(atlas, { channel_id: s.channels.lounge, content, thread_name: 'Side conversation', auto_archive_minutes: 60 });
    expect(started.status).toBe(201);
    const did: string = started.body.discord_message_id;
    // A webhook can't start a thread in a text channel, so the bot opens one on the message it just posted.
    const execute = executions().find((r) => (r.body as { content: string }).content === content)!;
    expect(execute.body).not.toHaveProperty('thread_name');
    const [open] = s.fake.requestsTo('channel.messages.thread').slice(-1);
    expect(open).toMatchObject({
      params: { channel: s.channels.lounge, message: did },
      body: { name: 'Side conversation', auto_archive_duration: 60 },
      status: 201,
    });
    expect(open!.headers.authorization).toBe(`Bot ${s.fake.botToken}`);
    expect(s.fake.world.channel(did)).toMatchObject({
      type: 11,
      parent_id: s.channels.lounge,
      name: 'Side conversation',
      thread_metadata: { auto_archive_duration: 60 },
    });
    const record = await eventually(async () => (await s.call('GET', `/v1/messages/${started.body.id}`, { token: atlas.token })).body.thread_id === did, {
      what: 'the relay to note the thread',
    });
    expect(record).toBe(true);

    const reply = unique('First reply in the side thread');
    const replied = await post(vesper, { channel_id: s.channels.lounge, content: reply, thread_id: did });
    expect(replied.status).toBe(201);
    expect(executions().find((r) => (r.body as { content: string }).content === reply)!.query).toEqual({ wait: 'true', thread_id: did });
    expect(s.fake.messages(did).map((m) => m.content)).toEqual([reply]);

    const threads = await eventually(
      async () => {
        const res = await s.call('GET', `/v1/channels/${s.channels.lounge}/threads`, { token: orrery.token });
        return res.body.threads?.find((t: { id: string }) => t.id === did) ? res : null;
      },
      { what: 'the thread in the channel’s thread list' },
    );
    expect(threads.body.threads.find((t: { id: string }) => t.id === did)).toMatchObject({
      id: did,
      channel_id: s.channels.lounge,
      name: 'Side conversation',
      archived: false,
      starter_message_id: did,
    });
    await eventually(seen(orrery, s.channels.lounge, replied.body.discord_message_id), { what: 'the reply in the channel' });
    const inThread = await channelPage(orrery, s.channels.lounge, `?thread_id=${did}`);
    expect(inThread.body.messages.map((m: { content: string }) => m.content)).toEqual([reply]);

    // The starter message lives in the channel: editing it must not name the thread.
    const edited = await s.call('PATCH', `/v1/messages/${started.body.id}`, {
      token: atlas.token,
      body: { content: unique('Let us take this to a thread, edited') },
    });
    expect(edited.status).toBe(200);
    expect(s.fake.requestsTo('webhook.message.edit').at(-1)!.query).toEqual({});
  });

  it('(f) sends a reply that points at the message it answers', async () => {
    const question = await post(vesper, { channel_id: s.channels.lounge, content: unique('Does anyone know where the lanterns are kept?') });
    expect(question.status).toBe(201);
    const qid: string = question.body.discord_message_id;
    await eventually(seen(atlas, s.channels.lounge, qid), { what: 'the question' });
    const answer = unique('In the cellar, I believe');
    const replied = await post(orrery, { channel_id: s.channels.lounge, content: answer, reply_to: qid });
    expect(replied.status).toBe(201);
    expect(replied.body.reply_to).toBe(qid);
    const shown = s.fake.messages(s.channels.lounge).find((m) => m.id === replied.body.discord_message_id)!;
    const [line, ...text] = shown.content.split('\n');
    expect(line).toMatch(/^-# > replying to \[Vesper: "Does anyone know where the lanterns are kept\? [^"\]]+"\]\(/);
    expect(line!.endsWith(`](https://discord.com/channels/${s.community.guildId}/${s.channels.lounge}/${qid})`)).toBe(true);
    expect(text.join('\n')).toBe(answer);
    expect((await post(orrery, { channel_id: s.channels.lounge, content: unique('Reply to nothing'), reply_to: '100000000000000000' })).status).toBe(400);
    // Agents read the text and reply_to, never the line.
    const row2 = await eventually(seen(atlas, s.channels.lounge, shown.id), { what: 'the reply' });
    expect(row2).toMatchObject({ content: answer, reply_to: qid });
  });

  it('(f) lets an agent edit and delete what it posted, through the webhook', async () => {
    const content = unique('Draft that will change');
    const sent = await post(atlas, { channel_id: s.channels.lounge, content });
    const did: string = sent.body.discord_message_id;
    await eventually(seen(vesper, s.channels.lounge, did), { what: 'the message' });

    const next = unique('Final wording');
    const edited = await s.call('PATCH', `/v1/messages/${sent.body.id}`, { token: atlas.token, body: { content: next } });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ id: sent.body.id, content: next, status: 'sent' });
    const request = s.fake.requestsTo('webhook.message.edit').at(-1)!;
    expect(request).toMatchObject({ params: { message: did }, body: { content: next, allowed_mentions: { parse: [] } }, status: 200 });
    expect(s.fake.messages(s.channels.lounge).find((m) => m.id === did)).toMatchObject({ content: next, edited_timestamp: expect.any(String) });
    const row = await eventually(
      async () => {
        const r = find(await channelPage(vesper, s.channels.lounge), did);
        return r?.edited_at ? r : null;
      },
      { what: 'the edit in the channel' },
    );
    expect(row.content).toBe(next);

    // Someone else's message can't be touched, and a blocked edit leaves the text alone.
    expect((await s.call('PATCH', `/v1/messages/${sent.body.id}`, { token: vesper.token, body: { content: unique('Hijack') } })).status).toBe(404);
    const refused = await s.call('PATCH', `/v1/messages/${sent.body.id}`, { token: atlas.token, body: { content: 'now [block] this' } });
    expect(refused.status).toBe(422);
    expect(s.fake.messages(s.channels.lounge).find((m) => m.id === did)!.content).toBe(next);

    const deleted = await s.call('DELETE', `/v1/messages/${sent.body.id}`, { token: atlas.token });
    expect(deleted.status).toBe(200);
    expect(s.fake.requestsTo('webhook.message.delete').at(-1)).toMatchObject({ params: { message: did }, status: 204 });
    expect(s.fake.messages(s.channels.lounge).some((m) => m.id === did)).toBe(false);
    const gone = await eventually(
      async () => {
        const r = find(await channelPage(vesper, s.channels.lounge), did);
        return r?.deleted ? r : null;
      },
      { what: 'the deletion in the channel' },
    );
    expect(gone.content).toBeNull();
    expect((await s.call('GET', `/v1/messages/${sent.body.id}`, { token: atlas.token })).body.status).toBe('removed');
  });

  /* ---------- (g) Deletion ---------- */

  it('(g) removes a message’s text everywhere when it is deleted in Discord', async () => {
    const content = unique('Soon to be deleted');
    const sent = await post(atlas, { channel_id: s.channels.lounge, content });
    const did: string = sent.body.discord_message_id;
    await eventually(seen(vesper, s.channels.lounge, did), { what: 'the message' });
    const feed = `/v1/subscriptions/${vesperLounge}/events`;
    const tail = (await s.call('GET', feed, { token: vesper.token })).body.cursor;

    s.fake.remove(s.channels.lounge, did);

    const row = await eventually(
      async () => {
        const r = find(await channelPage(vesper, s.channels.lounge), did);
        return r?.deleted ? r : null;
      },
      { what: 'the deletion' },
    );
    expect(row).toMatchObject({ content: null, deleted: true, removed_by: 'discord', author: { kind: 'agent' } });
    expect((await s.sql<{ content: string | null }>('SELECT content FROM conversation WHERE message_id = ?', did))[0]!.content).toBeNull();
    expect(
      (
        await s.sql<{ text: string }>(
          "SELECT json_extract(payload, '$.data.content') AS text FROM events WHERE message_id = ? AND type = 'message.created'",
          did,
        )
      )[0]!.text,
    ).toBe('');
    expect(JSON.stringify(await s.sql('SELECT payload FROM events WHERE message_id = ?', did))).not.toContain(content);

    const events = (await s.call('GET', `${feed}?after=${tail}`, { token: vesper.token })).body.events;
    expect(events).toContainEqual(expect.objectContaining({ type: 'message.deleted', data: { message_id: did, removed_by: 'discord' } }));
    // The relay's own record of the send is unchanged: it did send it.
    expect((await s.call('GET', `/v1/messages/${sent.body.id}`, { token: atlas.token })).body.status).toBe('sent');
  });

  /* ---------- (h) Moderation ---------- */

  it('(h) the development moderator’s [hold] and [block] markers never reach Discord', async () => {
    const before = executions().length;
    const blocked = await post(orrery, { channel_id: s.channels.lounge, content: unique('This is [block]ed') });
    expect(blocked.status).toBe(200);
    expect(blocked.body).toMatchObject({ status: 'blocked', verdict: 'block', discord_message_id: null });

    const held = await post(orrery, { channel_id: s.channels.lounge, content: unique('This is [hold]ing') });
    expect(held.status).toBe(202);
    expect(held.body).toMatchObject({ status: 'held', verdict: 'hold', discord_message_id: null });

    await sleep(500);
    expect(executions()).toHaveLength(before);
    expect(s.fake.messages(s.channels.lounge).some((m) => /\[(block|hold)\]|\[block\]ed|\[hold\]ing/.test(m.content))).toBe(false);
    expect((await s.call('GET', `/v1/messages/${held.body.id}`, { token: orrery.token })).body.status).toBe('held');
    expect(
      (
        await s.sql<{ verdict: string; layer: string }>(
          'SELECT verdict, layer FROM moderation_log WHERE message_id = ? ORDER BY id DESC LIMIT 1',
          blocked.body.id,
        )
      )[0],
    ).toMatchObject({ verdict: 'block', layer: 'classifier' });
    // Nobody saw them in the conversation either.
    expect(
      (await channelPage(atlas, s.channels.lounge)).body.messages.some((m: { content: string | null }) => /\[block\]ed|\[hold\]ing/.test(m.content ?? '')),
    ).toBe(false);
  });

  /* ---------- (i) Rate limits ---------- */

  it('(i) queues a post when Discord answers 429 and sends it after the wait', async () => {
    const content = unique('Waiting my turn');
    const rule = s.fake.fail({ route: 'webhook.execute' }, { type: 'rate_limit', retryAfter: 1 });
    const queued = await post(atlas, { channel_id: s.channels.lounge, content });
    expect(queued.status).toBe(202);
    expect(queued.body).toMatchObject({ status: 'queued', discord_message_id: null });
    expect(rule.hits).toBe(1);
    expect(s.fake.messages(s.channels.lounge).some((m) => m.content === content)).toBe(false);

    const done = await eventually(
      async () => {
        const r = await s.call('GET', `/v1/messages/${queued.body.id}`, { token: atlas.token });
        return r.body.status === 'sent' ? r : null;
      },
      { what: 'the queued post to be sent', timeoutMs: 20_000 },
    );
    expect(done.body.discord_message_id).toMatch(/^\d{17,20}$/);
    const attempts = executions().filter((r) => (r.body as { content: string }).content === content);
    expect(attempts.map((r) => r.status)).toEqual([429, 200]);
    expect(attempts[0]!.injected).toBe('rate_limit');
    expect(Date.parse(attempts[1]!.at) - Date.parse(attempts[0]!.at)).toBeGreaterThanOrEqual(900);
    expect(s.fake.messages(s.channels.lounge).filter((m) => m.content === content)).toHaveLength(1);
    await eventually(seen(vesper, s.channels.lounge, done.body.discord_message_id), { what: 'the late post in the channel' });
  });

  it('(i) reads Discord’s rate-limit headers: a used-up bucket pauses the next post', async () => {
    s.fake.setRateLimits({ webhook: { limit: 1, windowMs: 1500 } });
    try {
      const first = await post(vesper, { channel_id: s.channels.lounge, content: unique('One') });
      const second = await post(vesper, { channel_id: s.channels.lounge, content: unique('Two') });
      expect(first.status).toBe(201);
      // The first answer said "0 remaining, 1.5 s to reset": the second waits its turn instead of being refused.
      expect(second.status).toBe(202);
      expect(second.body.status).toBe('queued');
      await eventually(async () => (await s.call('GET', `/v1/messages/${second.body.id}`, { token: vesper.token })).body.status === 'sent', {
        what: 'the second post',
        timeoutMs: 20_000,
      });
      const [a, b] = executions().slice(-2);
      expect(Date.parse(b!.at) - Date.parse(a!.at)).toBeGreaterThanOrEqual(1000);
    } finally {
      s.fake.setRateLimits({ webhook: { limit: 1000, windowMs: 1000 } });
    }
  });

  /* ---------- (n) Uncertain sends ---------- */

  it('(n) an answer that never arrives leaves the post uncertain, and the Gateway settles it', async () => {
    const content = unique('Posted, but nobody told the relay');
    s.fake.fail({ route: 'webhook.execute' }, { type: 'drop', phase: 'after' });
    const sent = await post(orrery, { channel_id: s.channels.lounge, content });
    // The connection died after Discord saved the message: the relay can't know.
    expect([202, 201]).toContain(sent.status);
    // (It may wait behind the previous test's rate-limit pause before it reaches Discord.)
    const did = (
      await eventually(() => s.fake.messages(s.channels.lounge).find((m) => m.content === content), { what: 'Discord to save the message', timeoutMs: 20_000 })
    ).id;
    const settled = await eventually(
      async () => {
        const r = await s.call('GET', `/v1/messages/${sent.body.id}`, { token: orrery.token });
        return r.body.status === 'sent' ? r : null;
      },
      { what: 'the Gateway to settle the send', timeoutMs: 20_000 },
    );
    expect(settled.body.discord_message_id).toBe(did);
    expect(find(await channelPage(atlas, s.channels.lounge), did)).toMatchObject({ content, author: { kind: 'agent', agent_id: orrery.agent_id } });
    expect(executions().filter((r) => (r.body as { content: string }).content === content)).toHaveLength(1);
  });

  /* ---------- Edits and system messages ---------- */

  it('shows edits, and ignores system messages', async () => {
    const said = s.fake.say(s.channels.lounge, { as: DEV.newsbot, content: unique('First draft') });
    await eventually(seen(atlas, s.channels.lounge, said.id), { what: 'the message' });
    const edited = s.fake.edit(s.channels.lounge, said.id, unique('Second draft'));
    const row = await eventually(
      async () => {
        const r = find(await channelPage(atlas, s.channels.lounge), said.id);
        return r?.edited_at ? r : null;
      },
      { what: 'the edit' },
    );
    expect(row.content).toBe(edited.content);

    const join = s.fake.say(s.channels.lounge, { as: visitor, content: '', type: 7 });
    const starter = s.fake.say(s.channels.lounge, { as: visitor, content: '', type: 21 });
    const reply = s.fake.say(s.channels.lounge, { as: DEV.newsbot, content: unique('A reply'), replyTo: said.id });
    await eventually(seen(atlas, s.channels.lounge, reply.id), { what: 'the reply' });
    const page = await channelPage(atlas, s.channels.lounge);
    expect(find(page, join.id)).toBeUndefined();
    expect(find(page, starter.id)).toBeUndefined();
  });

  /* ---------- (j) Gateway close and resume ---------- */

  it('(j) a Gateway close and resume backfills nothing twice, and a lost session recovers the gap over REST without duplicates', async () => {
    const say = (content: string) => s.fake.say(s.channels.lounge, { as: DEV.newsbot, content: unique(content) });
    const count = async (id: string) => ({
      conversation: (await s.sql('SELECT 1 FROM conversation WHERE message_id = ?', id)).length,
      events: (await s.sql('SELECT 1 FROM events WHERE source_key = ?', `create:${id}`)).length,
    });
    const session = () => s.fake.gateway.info().at(-1)!;

    // 1. Closed with code 4000 while messages keep arriving: the relay resumes and Discord replays what it missed.
    const live = say('Before the drop');
    await eventually(seen(atlas, s.channels.lounge, live.id), { what: 'the live message' });
    const resumedBefore = session().resumes;
    s.fake.reset();
    s.fake.gateway.close(4000, 'Unknown error');
    const missed = [say('Missed one'), say('Missed two')];
    await eventually(() => session().resumes === resumedBefore + 1 && session().connected, { what: 'the relay to resume', timeoutMs: 20_000 });
    for (const m of missed) await eventually(seen(atlas, s.channels.lounge, m.id), { what: 'a replayed message' });
    for (const m of [live, ...missed]) expect(await count(m.id)).toEqual({ conversation: 1, events: 1 });
    expect(s.fake.gateway.received('RESUME')).toHaveLength(1);
    expect(s.fake.gateway.received('IDENTIFY')).toHaveLength(0);
    expect(s.fake.requestsTo('channel.messages.list')).toHaveLength(0);
    expect((await s.sql<{ status: string }>("SELECT status FROM intake_state WHERE source = 'gateway'"))[0]!.status).toBe('connected');

    // 2. The session is lost on the way back (INVALID_SESSION): a new session, and the gap is read over REST.
    const cursorBefore = (
      await s.sql<{ last: string }>('SELECT CAST(last_message_id AS TEXT) AS last FROM channel_cursors WHERE channel_id = ?', s.channels.lounge)
    )[0]!.last;
    s.fake.reset();
    s.fake.gateway.nextResume = 'invalid';
    s.fake.gateway.close(4000, 'Unknown error');
    const gap = say('During the lost session');
    await eventually(() => s.fake.gateway.received('IDENTIFY').length === 1 && session().connected, { what: 'the relay to identify again', timeoutMs: 30_000 });
    await eventually(seen(atlas, s.channels.lounge, gap.id), { what: 'the backfilled message', timeoutMs: 30_000 });

    const listings = s.fake.requestsTo('channel.messages.list').filter((r) => r.params.channel === s.channels.lounge);
    expect(listings.length).toBeGreaterThanOrEqual(1);
    expect(listings[0]!.query.after).toBe(cursorBefore);
    for (const m of [live, ...missed, gap]) expect(await count(m.id)).toEqual({ conversation: 1, events: 1 });
    expect((await s.sql('SELECT 1 FROM events WHERE type = ? AND channel_id = ?', 'subscription.gap', s.channels.lounge)).length).toBeGreaterThanOrEqual(1);
  });

  /* ---------- (k) Ed25519 on workerd ---------- */

  it('(k) verifies Discord’s Ed25519 signatures with the raw public key on workerd', async () => {
    const ping = await s.fake.interact({ user: visitor, ping: true });
    expect(ping.status).toBe(200);
    expect(ping.body).toEqual({ type: 1 });

    for (const signature of ['invalid', 'missing'] as const) {
      const res = await s.fake.interact({ user: visitor, ping: true, signature });
      expect(res.status, signature).toBe(401);
    }
    const stale = await s.fake.interact({ user: visitor, ping: true, timestamp: Math.floor(Date.now() / 1000) - 3600 });
    expect(stale.status).toBe(401);

    // A body signed for another body doesn't pass: the signature covers the raw text.
    const status = await s.fake.interact({ user: visitor, command: { name: 'consent', subcommand: 'status' } });
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ type: 4, data: { flags: 64, content: expect.stringContaining('haven’t agreed') } });
    const unknown = await s.fake.interact({ user: visitor, command: { name: 'nonsense' } });
    expect(unknown.body).toMatchObject({ type: 4, data: { content: expect.stringContaining('don’t know that command') } });
  });

  /* ---------- (l) D1 ---------- */

  it('(l) UPDATE … RETURNING with .first() works on D1: the rate limiter really counts and refuses', async () => {
    const headers = { 'cf-connecting-ip': '198.18.0.77' };
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push((await s.call('GET', '/agent/identity/challenge', { headers })).status);
    expect(statuses.slice(0, 60).every((x) => x === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
    const limited = await s.call('GET', '/agent/identity/challenge', { headers });
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(limited.body).toMatchObject({ error: 'rate_limited' });

    const rows = await s.sql<{ key: string; count: number }>("SELECT key, count FROM rate_counters WHERE key LIKE 'pow:net:%' ORDER BY count DESC LIMIT 1");
    // A full window is left alone, so refused requests cost no writes: the count stops at the limit.
    expect(rows[0]!.count).toBe(60);

    // The statements themselves, straight on the database.
    await s.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('probe', '1', ?)").bind('x').run();
    const updated = await s.db.prepare("UPDATE settings SET value = '2' WHERE key = 'probe' RETURNING value").first<{ value: string }>();
    expect(updated).toEqual({ value: '2' });
    const upserted = await s.db
      .prepare(
        'INSERT INTO rate_counters (key, window_start, count) VALUES (?, 1, 1) ON CONFLICT (key, window_start) DO UPDATE SET count = count + excluded.count RETURNING count',
      )
      .bind('probe')
      .first<{ count: number }>();
    expect(upserted).toEqual({ count: 1 });
    const swept = await s.db.prepare("UPDATE settings SET value = '3' WHERE key = 'probe' RETURNING key").all();
    expect(swept.results).toEqual([{ key: 'probe' }]);
  });

  /* ---------- (m) Surfaces ---------- */

  it('(m) keeps the dashboard API off the public entrypoint, and reachable only through the service binding', async () => {
    const owner = await s.adminOwner();
    for (const path of ['/internal/admin/health', '/internal/admin/channels', `/internal/owners/${owner}/agents`, '/internal/people/123/removal']) {
      const res = await s.call(path.includes('removal') ? 'POST' : 'GET', path, {
        headers: { 'x-logitland-internal': s.internalToken, 'x-logitland-owner': owner },
      });
      expect(res.status, path).toBe(404);
      expect(res.body).toMatchObject({ code: 'not_found' });
    }
    // Through the binding the same routes answer, and still need the token and the owner.
    expect((await s.dashboard('GET', '/internal/admin/channels', { owner })).status).toBe(200);
    expect((await s.dashboard('GET', '/internal/admin/health')).status).toBe(401);
    const channels = (await s.dashboard('GET', '/internal/admin/channels', { owner })).body.channels;
    expect(channels.map((c: { id: string }) => c.id).sort()).toEqual(Object.values(s.channels).sort());
    // No route on the public side hands out a webhook.
    expect(JSON.stringify(channels)).not.toMatch(/discord\.com\/api\/webhooks/);
    expect(
      (await s.call('GET', '/v1/channels', { token: atlas.token })).body.channels.every(
        (c: Record<string, unknown>) => !('webhook' in c) && !('webhook_ciphertext' in c),
      ),
    ).toBe(true);
  });

  /* ---------- (o) Webhook delivery ---------- */

  it('(o) refuses a webhook that fails its challenge, and posts a live subscription’s digest, signed, to one that passes', async () => {
    const received: { headers: Headers; body: string }[] = [];
    s.outbound.receive('hooks.orrery.example.net', async (request) => {
      const body = await request.text();
      // The request comes from miniflare's own fetch implementation; verify() expects this realm's Headers.
      received.push({ headers: new Headers([...request.headers]), body });
      const sent = JSON.parse(body) as { type: string; challenge?: string };
      return Response.json(sent.type === 'delivery.challenge' ? { challenge: sent.challenge } : {});
    });
    s.outbound.receive('hooks.forgetful.example.net', () => Response.json({ challenge: 'not the one it was sent' }));

    const refused = await s.call('PUT', '/v1/delivery', { token: orrery.token, body: { url: 'https://hooks.forgetful.example.net/logitland' } });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'destination_refused', detail: expect.stringContaining('didn’t echo the challenge') });
    expect((await s.call('GET', '/v1/delivery', { token: orrery.token })).body).toEqual({ kind: 'none' });

    const set = await s.call('PUT', '/v1/delivery', { token: orrery.token, body: { url: 'https://hooks.orrery.example.net/logitland' } });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({
      delivery: { kind: 'webhook', url_host: 'hooks.orrery.example.net', status: 'active' },
      secret: expect.stringMatching(/^whsec_/),
    });
    const secret: string = set.body.secret;
    // The receiver proved it holds the URL before any conversation reached it, and the challenge was signed with the new secret.
    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0]!.body)).toMatchObject({ type: 'delivery.challenge', agent_id: orrery.agent_id });
    await verify(received[0]!.headers, received[0]!.body, secret);

    const subscribed = await s.call('POST', '/v1/subscriptions', {
      token: orrery.token,
      body: { kind: 'channel', channel_id: s.channels.lounge, frequency: 'live' },
    });
    expect(subscribed.status).toBe(201);
    const said = s.fake.say(s.channels.lounge, { as: DEV.newsbot, content: unique('Straight to the webhook') });

    type Digest = { type: string; subscription_id: string; more: boolean; events: { type: string; data: { message_id?: string; content?: string } }[] };
    const carries = (r: { body: string }) => {
      const d = JSON.parse(r.body) as Digest;
      return d.subscription_id === subscribed.body.id && d.events.some((e) => e.data.message_id === said.id);
    };
    const delivered = await eventually(() => received.find(carries), { what: 'the digest at the webhook' });
    await verify(delivered.headers, delivered.body, secret);
    const digest = JSON.parse(delivered.body) as Digest;
    expect(digest).toMatchObject({ type: 'digest', subscription_id: subscribed.body.id, more: false });
    expect(digest.events).toContainEqual(
      expect.objectContaining({
        type: 'message.created',
        channel_id: s.channels.lounge,
        data: expect.objectContaining({ message_id: said.id, content: said.content }),
      }),
    );
    expect(received.filter(carries)).toHaveLength(1);

    // The agent's own record of it, under the id the receiver dedupes on.
    const ledger = await eventually(
      async () => {
        const page = await s.call('GET', '/v1/delivery/deliveries', { token: orrery.token });
        const row = page.body.deliveries.find((d: { id: string }) => d.id === delivered.headers.get('webhook-id'));
        return row?.status === 'delivered' ? row : null;
      },
      { what: 'the delivery in the ledger' },
    );
    expect(ledger).toMatchObject({ subscription_id: subscribed.body.id, last_status_code: 200, delivered_at: expect.any(String) });
  });

  it('(p) streams a live subscription’s digest over a hibernating WebSocket, and answers ping', async () => {
    const lumen = await s.register('Lumen', '192.0.2.40');
    const subscribed = await s.call('POST', '/v1/subscriptions', {
      token: lumen.token,
      body: { kind: 'channel', channel_id: s.channels.lounge, frequency: 'live' },
    });
    expect(subscribed.status).toBe(201);

    // Node's WebSocket (undici) takes headers, so the token goes where every other call sends it.
    const Socket = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket;
    const ws = new Socket(`${s.base.replace(/^http/, 'ws')}/v1/stream`, { headers: { authorization: `Bearer ${lumen.token}` } });
    const frames: string[] = [];
    ws.addEventListener('message', (e) => frames.push(String(e.data)));
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    try {
      await eventually(async () => (await s.sql('SELECT 1 FROM agent_streams WHERE agent_id = ?', lumen.agent_id)).length > 0 || null, {
        what: 'the stream recorded',
      });
      const said = s.fake.say(s.channels.lounge, { as: DEV.newsbot, content: unique('Down the stream') });
      const digest = await eventually(
        () =>
          frames
            .map((f) => JSON.parse(f))
            .find((d) => d.type === 'digest' && d.events.some((e: { data: { message_id?: string } }) => e.data.message_id === said.id)),
        { what: 'the digest on the stream' },
      );
      expect(digest).toMatchObject({ subscription_id: subscribed.body.id, more: false });

      ws.send('ping');
      await eventually(() => frames.includes('pong') || null, { what: 'pong' });
    } finally {
      ws.close();
    }
  });

  /* ---------- Built but not tested here yet ---------- */

  it.todo(
    'classifier outage: hold, automatic re-check and release. Needs JEV_LAYA_URL pointed at a fake classifier on loopback (allowed by the suite’s outbound bridge) and a controllable clock for the re-check backoff',
  );
  it.todo('quarter-hour cron jobs (retention, raw-IP purge, counter sweep): cron only fires them at minute 0/15/30/45 of the Worker’s real clock');
  it.todo('owner claim by Discord sign-in: the dashboard’s OAuth talks to the real discord.com');
});
