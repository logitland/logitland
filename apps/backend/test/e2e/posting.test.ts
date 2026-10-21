import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_BOT_PERMISSIONS, DEV, Permission, type Webhook } from '../../../../packages/discord-fake/src/index.ts';
import { E2E, eventually, sleep, startStack, type Agent, type Stack } from './harness.ts';

// What happens around a post when things go wrong, repeat or pile up: repeats, many agents at once, a webhook or thread that
// has gone, an agent that is suspended, a channel closed to agents. A fresh Worker, database and fake Discord.
describe.skipIf(!E2E)('posting under stress, against a fake Discord', () => {
  let s: Stack;
  let agent: Agent;
  let n = 0;
  const unique = (what: string) => `${what} (${Date.now().toString(36)}-${n++})`;
  const post = (token: string, body: Record<string, unknown>, idem = `stress-${Date.now().toString(36)}-${n++}`) =>
    s.call('POST', '/v1/messages', { token, body, headers: { 'idempotency-key': idem } });
  const executions = () => s.fake.requestsTo('webhook.execute');

  beforeAll(async () => {
    s = await startStack();
    // A cheap proof of work for the many agents below; (b) in relay.test.ts registers at full price.
    await s.db
      .prepare("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('pow_difficulty', '8', 'e2e', ?)")
      .bind(new Date().toISOString())
      .run();
    agent = await s.register('Stressor', '198.51.100.10');
    await s.connect();
  });
  afterAll(async () => {
    const blocked = s?.outbound.blocked ?? [];
    await s?.dispose();
    expect(blocked).toEqual([]);
  });

  it('posts once for a repeated Idempotency-Key, however the repeats arrive', async () => {
    const content = unique('Say it once');
    const key = 'idem-repeat-0001';
    const first = await post(agent.token, { channel_id: s.channels.lounge, content }, key);
    expect(first.status).toBe(201);
    const again = await post(agent.token, { channel_id: s.channels.lounge, content }, key);
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.discord_message_id).toBe(first.body.discord_message_id);

    // At the same moment.
    const racing = unique('Say it once, racing');
    const results = await Promise.all(Array.from({ length: 4 }, () => post(agent.token, { channel_id: s.channels.lounge, content: racing }, 'idem-race-0001')));
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(results.every((r) => r.status === 201 || r.status === 202)).toBe(true);

    expect(executions().filter((r) => (r.body as { content: string }).content === content)).toHaveLength(1);
    expect(executions().filter((r) => (r.body as { content: string }).content === racing)).toHaveLength(1);
    // The same key for different text is a mistake the relay says so about.
    const clash = await post(agent.token, { channel_id: s.channels.lounge, content: unique('Something else') }, key);
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('idempotency_conflict');
  });

  it('sends many agents’ posts at once, each exactly once and in a single line per channel', async () => {
    const agents = await Promise.all(Array.from({ length: 5 }, (_, i) => s.register(`Chorus-${i + 1}`, `203.0.113.${40 + i * 4}`)));
    const texts = agents.map((a) => unique(`${a.name} speaks`));
    const results = await Promise.all(agents.map((a, i) => post(a.token, { channel_id: s.channels.lounge, content: texts[i]! })));
    // The first goes straight out; the rest wait their turn in the channel's line and are answered as queued.
    expect(results.map((r) => r.status).sort()).toEqual([201, 202, 202, 202, 202]);
    const sent = await Promise.all(
      results.map((r) =>
        eventually(
          async () => {
            const res = await s.call('GET', `/v1/messages/${r.body.id}`, { token: agents[results.indexOf(r)]!.token });
            return res.body.status === 'sent' ? res.body : null;
          },
          { what: 'every post to be sent' },
        ),
      ),
    );
    expect(new Set(sent.map((r) => r.discord_message_id)).size).toBe(agents.length);
    for (const [i, text] of texts.entries()) {
      expect(s.fake.messages(s.channels.lounge).filter((m) => m.content === text)).toHaveLength(1);
      expect(s.fake.messages(s.channels.lounge).find((m) => m.content === text)!.author.username).toBe(agents[i]!.name);
    }
    const page = await eventually(
      async () => {
        const res = await s.call('GET', `/v1/channels/${s.channels.lounge}/messages?limit=100`, { token: agent.token });
        return texts.every((t) => res.body.messages.filter((m: { content: string }) => m.content === t).length === 1) ? res : null;
      },
      { what: 'every post exactly once in the channel' },
    );
    for (const [i, text] of texts.entries()) {
      expect(page.body.messages.find((m: { content: string }) => m.content === text).author).toMatchObject({ kind: 'agent', agent_id: agents[i]!.agent_id });
    }
  });

  it('holds a link where Discord doesn’t let agents embed links, and says why', async () => {
    const before = executions().length;
    const held = await post(agent.token, { channel_id: s.channels.lounge, content: unique('See https://example.org/lanterns') });
    expect(held.status).toBe(202);
    expect(held.body).toMatchObject({ status: 'held', verdict: 'hold', policy_code: 'links_not_allowed' });
    expect(held.body.status_reason).toMatch(/can’t post links/);
    await sleep(300);
    expect(executions()).toHaveLength(before);
  });

  it('makes a new webhook when Discord has forgotten the old one, and never repeats Discord’s words or the webhook', async () => {
    const leaks = (body: unknown, hook: Webhook) => {
      const text = JSON.stringify(body);
      return [hook.token, 'Unknown Webhook', 'Invalid Webhook Token', 'discord.com/api/webhooks', hook.id].filter((x) => text.includes(x));
    };

    // The webhook was deleted in Discord.
    const first = (await s.relayWebhook(s.channels.lounge))!;
    s.fake.world.webhooks.delete(first.id);
    const deleted = await post(agent.token, { channel_id: s.channels.lounge, content: unique('Into the void') });
    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({ status: 'failed', discord_message_id: null });
    expect(deleted.body.status_reason).toMatch(/no longer knows this channel’s webhook/);
    expect(leaks(deleted.body, first)).toEqual([]);
    // Discord asks that a webhook it called unknown is never used again, so the relay forgets it and the next post makes a new one.
    expect(await s.sql('SELECT webhook_id FROM channels WHERE id = ?', s.channels.lounge)).toEqual([{ webhook_id: null }]);
    expect((await post(agent.token, { channel_id: s.channels.lounge, content: unique('Through a new webhook') })).status).toBe(201);
    const second = (await s.relayWebhook(s.channels.lounge))!;
    expect(second.id).not.toBe(first.id);
    expect(executions().at(-1)!.params.id).toBe(second.id);

    // Its token was changed: no good either.
    s.fake.world.webhooks.set(second.id, { ...second, token: 'a-different-token-entirely' });
    const wrong = await post(agent.token, { channel_id: s.channels.lounge, content: unique('Wrong key') });
    expect(wrong.body).toMatchObject({ status: 'failed' });
    expect(wrong.body.status_reason).toMatch(/no longer knows this channel’s webhook/);
    expect(leaks(wrong.body, second)).toEqual([]);

    // Discord is down.
    s.fake.fail({ route: 'webhook.execute' }, { type: 'status', status: 503 });
    const down = await post(agent.token, { channel_id: s.channels.lounge, content: unique('Is anyone there') });
    expect(down.status).toBe(202);
    expect(down.body.status).toBe('uncertain');
    expect(down.body.status_reason).toMatch(/may or may not have been posted/);
    expect(leaks(down.body, (await s.relayWebhook(s.channels.lounge))!)).toEqual([]);

    // Fixed again: the same text posts under a new key.
    const ok = await post(agent.token, { channel_id: s.channels.lounge, content: unique('Back again') });
    expect(ok.status).toBe(201);
  });

  it('tells an agent a thread is gone when Discord says so', async () => {
    const first = await post(agent.token, { channel_id: s.channels.forum, content: unique('A short-lived topic'), thread_name: 'Short-lived' });
    expect(first.status).toBe(201);
    const threadId: string = first.body.thread_id;
    s.fake.world.deleteThread(threadId);
    const reply = await post(agent.token, { channel_id: s.channels.forum, content: unique('Anyone still here?'), thread_id: threadId });
    expect(reply.body).toMatchObject({ status: 'failed' });
    expect(reply.body.status_reason).toBe('That thread no longer exists. Start a new one, or reply somewhere else.');
  });

  it('stops a suspended agent, and starts it again when it is reinstated', async () => {
    const victim = await s.register('Brief', '198.51.100.90');
    const owner = await s.adminOwner();
    const before = executions().length;
    const ok = await post(victim.token, { channel_id: s.channels.lounge, content: unique('Before the suspension') });
    expect(ok.status).toBe(201);

    const suspended = await s.dashboard('POST', `/internal/admin/agents/${victim.agent_id}/status`, {
      owner,
      body: { action: 'suspend', reason: 'testing the switch' },
    });
    expect(suspended.status).toBe(200);
    const refused = await post(victim.token, { channel_id: s.channels.lounge, content: unique('During the suspension') });
    expect([401, 403]).toContain(refused.status);
    expect((await s.call('GET', `/v1/channels/${s.channels.lounge}/messages`, { token: victim.token })).status).toBeGreaterThanOrEqual(401);
    expect(executions()).toHaveLength(before + 1);

    expect(
      (await s.dashboard('POST', `/internal/admin/agents/${victim.agent_id}/status`, { owner, body: { action: 'reinstate', reason: 'testing the switch' } }))
        .status,
    ).toBe(200);
    expect((await post(victim.token, { channel_id: s.channels.lounge, content: unique('After the suspension') })).status).toBe(201);
  });

  it('forgets a channel an admin closes to agents in Discord: agents can’t see it and its events stop', async () => {
    const visible = async () => ((await s.call('GET', '/v1/channels', { token: agent.token })).body.channels as { id: string }[]).map((c) => c.id);
    expect(await visible()).toContain(s.channels.media);

    // The admin takes View Channel away from @agents; people and the bot keep what they had.
    const chatting = Permission.sendMessages | Permission.sendMessagesInThreads | Permission.createPublicThreads;
    s.fake.world.updateChannel(s.channels.media, {
      overwrites: [
        { id: s.community.guildId, deny: chatting },
        { id: s.community.consentRoleId, allow: chatting },
        { id: s.community.agentsRoleId, deny: Permission.viewChannel },
        { id: s.fake.world.guild(s.community.guildId).botRoleId, allow: ALL_BOT_PERMISSIONS },
      ],
    });
    await eventually(async () => !(await visible()).includes(s.channels.media), { what: 'the relay to see the channel close' });
    expect((await s.call('GET', `/v1/channels/${s.channels.media}/messages`, { token: agent.token })).status).toBe(404);
    expect((await post(agent.token, { channel_id: s.channels.media, content: unique('Nobody home'), thread_name: 'x' })).status).toBe(404);

    const tail = (await s.call('GET', '/v1/events', { token: agent.token })).body.next_cursor;
    const said = s.fake.say(s.channels.media, { as: DEV.newsbot, content: unique('Shout into the unlisted channel'), threadName: 'Unlisted' });
    await sleep(1200);
    expect((await s.sql('SELECT 1 FROM conversation WHERE channel_id = ?', s.channels.media)).length).toBe(0);
    expect(
      (await s.call('GET', `/v1/events?after=${tail}`, { token: agent.token })).body.events.filter(
        (e: { channel_id: string }) => e.channel_id === s.channels.media,
      ),
    ).toEqual([]);
    expect(said.id).toBeTruthy();
  });

  it('ignores channels and threads it does not relay, without asking Discord about each message', async () => {
    // Private to staff: nobody else may view it, the bot may.
    const staff = s.fake.addChannel(s.community.guildId, {
      name: 'staff-room',
      overwrites: [
        { id: s.community.guildId, deny: Permission.viewChannel },
        { id: s.fake.world.guild(s.community.guildId).botRoleId, allow: ALL_BOT_PERMISSIONS },
      ],
    });
    const first = s.fake.say(staff.id, { as: DEV.newsbot, content: unique('Private business') });
    const thread = s.fake.startThread(staff.id, first.id, 'Private thread', DEV.admin);
    s.fake.say(thread.id, { as: DEV.newsbot, content: unique('More private business') });
    s.fake.reset();
    for (let i = 0; i < 3; i++) s.fake.say(staff.id, { as: DEV.newsbot, content: unique('Even more') });
    s.fake.say(thread.id, { as: DEV.newsbot, content: unique('Still private') });
    // A relayed message after them proves they were all handled.
    const marker = s.fake.say(s.channels.lounge, { as: DEV.newsbot, content: unique('Public business') });
    await eventually(async () => (await s.sql('SELECT 1 FROM conversation WHERE message_id = ?', marker.id)).length === 1, { what: 'the marker message' });
    expect((await s.sql('SELECT 1 FROM conversation WHERE channel_id = ?', staff.id)).length).toBe(0);
    expect((await s.sql('SELECT 1 FROM events WHERE channel_id = ?', staff.id)).length).toBe(0);
    expect(s.fake.requestsTo('channel.get').filter((r) => [staff.id, thread.id].includes(r.params.channel!))).toEqual([]);
  });

  it('serves events by channel and refuses a cursor it can’t read', async () => {
    const tail = (await s.call('GET', '/v1/events', { token: agent.token })).body.next_cursor;
    const a = await post(agent.token, { channel_id: s.channels.lounge, content: unique('For the lounge') });
    expect(a.status).toBe(201);
    await eventually(
      async () => (await s.call('GET', `/v1/events?after=${tail}&channel_id=${s.channels.lounge}`, { token: agent.token })).body.events.length >= 1,
      { what: 'the event' },
    );
    const lounge = await s.call('GET', `/v1/events?after=${tail}&channel_id=${s.channels.lounge}`, { token: agent.token });
    expect(lounge.body.events.every((e: { channel_id: string }) => e.channel_id === s.channels.lounge)).toBe(true);
    const forum = await s.call('GET', `/v1/events?after=${tail}&channel_id=${s.channels.forum}`, { token: agent.token });
    expect(forum.body.events).toEqual([]);
    expect(Number(forum.body.next_cursor)).toBeGreaterThanOrEqual(Number(lounge.body.events[0].cursor));
    expect((await s.call('GET', '/v1/events?after=not-a-cursor', { token: agent.token })).status).toBe(400);
    const started = Date.now();
    const quiet = await s.call('GET', `/v1/events?after=${forum.body.next_cursor}&channel_id=${s.channels.forum}&wait=2`, { token: agent.token });
    expect(quiet.body.events).toEqual([]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1500);
  });
});
