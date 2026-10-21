import { afterAll, describe, expect, it } from 'vitest';
import { DEV } from '../../../../packages/discord-fake/src/index.ts';
import { E2E, eventually, sleep, startStack, type Stack } from './harness.ts';

// The Gateway Durable Object under the conditions Discord creates: refusals, a connection that stops answering, a request to
// reconnect, and the object being evicted. Each group has its own Worker, so a stopped Gateway doesn't affect the others.
describe.skipIf(!E2E)('the Gateway Durable Object on workerd', () => {
  const stacks: Stack[] = [];
  const start = async (...args: Parameters<typeof startStack>) => {
    const s = await startStack(...args);
    stacks.push(s);
    return s;
  };
  afterAll(async () => {
    const blocked = stacks.flatMap((s) => s.outbound.blocked);
    await Promise.all(stacks.map((s) => s.dispose()));
    expect(blocked).toEqual([]);
  });

  const intake = async (s: Stack) =>
    (
      await s.sql<{ status: string; last_error: string | null; session_id: string | null }>(
        "SELECT status, last_error, session_id FROM intake_state WHERE source = 'gateway'",
      )
    )[0];
  const status = (s: Stack, wanted: string | RegExp) => async () => {
    const row = await intake(s);
    return row && (typeof wanted === 'string' ? row.status === wanted : wanted.test(row.status)) ? row : null;
  };

  it('stops, and says why in plain words, when the Message Content intent is not enabled (4014)', async () => {
    const s = await start({ fake: { messageContent: 'off' } });
    await s.cron();
    const row = await eventually(status(s, /^stopped/), { what: 'the Gateway to stop' });
    expect(row.status).toBe('stopped: enable the Message Content intent in the Developer Portal (Bot, Privileged Gateway Intents)');
    expect(s.fake.gateway.received('IDENTIFY')).toHaveLength(1);
    expect(s.fake.gateway.info()).toHaveLength(0);

    const owner = await s.adminOwner();
    const health = await s.dashboard('GET', '/internal/admin/health', { owner });
    expect(health.body.intake.status).toMatch(/^stopped: enable the Message Content intent/);
    // The checklist says the same, from the application's own flags.
    const checks = (await s.dashboard('GET', '/internal/admin/setup', { owner })).body.checks as { id: string; status: string }[];
    expect(checks.find((c) => c.id === 'message-content-intent')!.status).toBe('fail');

    // Cron keeps asking, but doesn't hammer Discord with new sessions while the stop stands.
    await s.cron();
    await sleep(500);
    expect(s.fake.gateway.received('IDENTIFY')).toHaveLength(1);
  });

  it('stops when Discord rejects the bot token, without ever opening a socket', async () => {
    // Not ready: with the token refused, Discord can't say who the admins are, so nobody can do an admin's setup.
    const s = await start({ env: { DISCORD_BOT_TOKEN: 'not-the-token' }, ready: false });
    await s.cron();
    const row = await eventually(status(s, /^stopped/), { what: 'the Gateway to stop' });
    expect(row.status).toBe('stopped: Discord rejected the bot token. Check DISCORD_BOT_TOKEN');
    expect(s.fake.requestsTo('gateway.bot')[0]).toMatchObject({ status: 401, headers: { authorization: 'Bot not-the-token' } });
    expect(s.outbound.sockets).toBe(0);
    expect(JSON.stringify(row)).not.toContain('not-the-token');
  });

  it('waits when Discord says the day’s allowance of new sessions is used up', async () => {
    const s = await start();
    s.fake.gateway.sessionStartLimit.remaining = 0;
    s.fake.gateway.sessionStartLimit.resetAt = Date.now() + 15 * 60_000;
    await s.cron();
    const row = await eventually(status(s, /^waiting/), { what: 'the Gateway to wait' });
    expect(row.status).toMatch(/^waiting: Discord’s limit on new sessions is used up, trying again in 15 min/);
    expect(s.fake.gateway.received('IDENTIFY')).toHaveLength(0);
    expect(s.outbound.sockets).toBe(0);
  });

  describe('a healthy connection', () => {
    let s: Stack;
    const messages = (id: string) => async () => (await s.sql('SELECT 1 FROM conversation WHERE message_id = ?', id)).length === 1;
    const ready = async () => {
      s = await start({ fake: { gateway: { heartbeatIntervalMs: 400 } } });
      await s.cron();
      await eventually(status(s, 'connected'), { what: 'the Gateway to connect' });
    };

    it('resumes when Discord asks it to reconnect (opcode 7)', async () => {
      await ready();
      const before = s.fake.gateway.received('RESUME').length;
      s.fake.gateway.reconnect();
      await eventually(() => s.fake.gateway.received('RESUME').length === before + 1, { what: 'the Gateway to resume' });
      await eventually(() => s.fake.gateway.info()[0]!.connected && s.fake.gateway.info()[0]!.resumes === 1, { what: 'the session to be back' });
      expect(s.fake.gateway.received('IDENTIFY')).toHaveLength(1);
      expect(s.fake.gateway.received('RESUME')[0]!.d).toMatchObject({ token: s.fake.botToken, session_id: s.fake.gateway.info()[0]!.id });
      const sent = s.fake.say(s.channels.lounge, { as: DEV.newsbot, content: 'after the reconnect' });
      await eventually(messages(sent.id), { what: 'the message after the reconnect' });
    });

    it('sends heartbeats on the interval Discord asked for, with the last sequence number', async () => {
      const sent = s.fake.say(s.channels.lounge, { as: DEV.newsbot, content: 'to move the sequence' });
      await eventually(messages(sent.id), { what: 'the message' });
      const mark = s.fake.gateway.received('HEARTBEAT').length;
      await eventually(() => s.fake.gateway.received('HEARTBEAT').length >= mark + 3, { what: 'three more heartbeats' });
      const beats = s.fake.gateway.received('HEARTBEAT');
      const last = s.fake.gateway.info()[0]!.seq;
      expect(beats.at(-1)!.d).toBe(last);
      const gaps = beats
        .slice(-3)
        .map((b, i, all) => (i ? Date.parse(b.at) - Date.parse(all[i - 1]!.at) : 0))
        .slice(1);
      for (const gap of gaps) expect(gap).toBeGreaterThan(250);
      expect(await intake(s)).toMatchObject({ status: 'connected' });
    });

    it('treats a connection that stops answering heartbeats as dead, and resumes on a new one', async () => {
      const before = s.fake.gateway.received('RESUME').length;
      s.fake.gateway.ackHeartbeats = false;
      await eventually(() => s.fake.gateway.received('RESUME').length > before, { what: 'the Gateway to give up on the silent connection', timeoutMs: 20_000 });
      s.fake.gateway.ackHeartbeats = true;
      await eventually(status(s, 'connected'), { what: 'the Gateway to be back', timeoutMs: 20_000 });
      expect(s.fake.gateway.received('IDENTIFY')).toHaveLength(1);
    });

    it('picks the session up again from storage after a restart, when the Durable Object has lost its memory', async () => {
      const [session] = s.fake.gateway.info();
      const before = s.fake.gateway.received('RESUME').length;
      const live = s.fake.say(s.channels.lounge, { as: DEV.newsbot, content: 'before the restart' });
      await eventually(messages(live.id), { what: 'the message before the restart' });

      await s.restart();
      // The runtime dropped the socket and the object forgot everything it held in memory.
      await eventually(() => !s.fake.gateway.info()[0]!.connected, { what: 'the socket to close' });
      const missed = s.fake.say(s.channels.lounge, { as: DEV.newsbot, content: 'while the object was gone' });

      // Cron (or the alarm) wakes it; it reads the stored session and resumes it, replaying the message it missed.
      await s.cron();
      await eventually(() => s.fake.gateway.received('RESUME').length === before + 1, { what: 'a resume after the restart' });
      expect(s.fake.gateway.received('RESUME').at(-1)!.d).toMatchObject({ session_id: session!.id });
      expect(s.fake.gateway.received('IDENTIFY')).toHaveLength(1);
      await eventually(messages(missed.id), { what: 'the missed message to be replayed' });
      expect((await s.sql('SELECT 1 FROM events WHERE source_key = ?', `create:${live.id}`)).length).toBe(1);
      expect((await s.sql('SELECT 1 FROM events WHERE source_key = ?', `create:${missed.id}`)).length).toBe(1);
      await eventually(status(s, 'connected'), { what: 'the Gateway to be connected again' });
    });
  });
});
