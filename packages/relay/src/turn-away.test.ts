import { afterEach, describe, expect, it, vi } from 'vitest';
import { agree } from './consent.testkit';
import { ingest } from './services/intake';
import { NOTICE_BUTTON } from './services/interactions';
import { updateSettings } from './services/settings';
import { TURN_AWAY_MS } from './services/turn-away';
import { BENCH, LOUNGE, harness, seedChannel } from './testing';

// In the talk channel, a person who hasn't agreed through /consent has their message removed and is told how to agree.

const PERSON = '700000000000000001';
const AGREED = '700000000000000002';

async function setup() {
  const h = harness();
  await seedChannel(h.relay, { id: LOUNGE, access: 'post' });
  await seedChannel(h.relay, { id: BENCH, name: 'lab-bench', access: 'post' });
  await agree(h, AGREED);
  await updateSettings(h.relay, 'own_admin', { talk_channel_id: LOUNGE });
  let next = 900000000000000000n;
  const say = (author: string, channel = LOUNGE) => ({
    kind: 'message_create',
    channel_id: channel,
    message_id: String((next += 1n)),
    author: { id: author, username: 'someone' },
    content: 'hello agents',
    timestamp: '2026-10-19T03:00:00.000Z',
  });
  /** Discord calls besides webhook posts, as `METHOD path`. */
  const calls = () => h.discordCalls.map((r) => `${r.method} ${new URL(r.url).pathname.replace('/api/v10', '')}`);
  return { h, say, calls };
}

afterEach(() => vi.useRealTimers());

describe('turning people away', () => {
  it('removes the message of someone who hasn’t agreed, and replies to them with a button that removes itself', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { h, say, calls } = await setup();
    const m = say(PERSON);
    await ingest(h.relay, { source: 'test', events: [m] });
    expect(calls()).toEqual([`DELETE /channels/${LOUNGE}/messages/${m.message_id}`, `POST /channels/${LOUNGE}/messages`]);
    const reply = (await h.discordCalls[1]!.json()) as { content: string; allowed_mentions: unknown; components: { components: { custom_id: string }[] }[] };
    expect(reply.content).toMatch(new RegExp(`^<@${PERSON}> To talk here, you need to \`/consent agree\``));
    expect(reply.allowed_mentions).toEqual({ parse: [], users: [PERSON] });
    expect(reply.components[0]!.components[0]!.custom_id).toBe(NOTICE_BUTTON);

    await vi.advanceTimersByTimeAsync(TURN_AWAY_MS);
    expect(calls()).toHaveLength(3);
    expect(calls()[2]).toMatch(new RegExp(`^DELETE /channels/${LOUNGE}/messages/\\d+$`));
  });

  it('leaves alone people who agreed, every other channel, and history', async () => {
    const { h, say, calls } = await setup();
    await ingest(h.relay, { source: 'test', events: [say(AGREED), say(PERSON, BENCH)] });
    await ingest(h.relay, { source: 'seed', events: [say(PERSON)], history: true });
    expect(calls()).toEqual([]);
  });

  it('turns nobody away until admins pick the talk channel', async () => {
    const { h, say, calls } = await setup();
    await updateSettings(h.relay, 'own_admin', { talk_channel_id: null });
    await ingest(h.relay, { source: 'test', events: [say(PERSON)] });
    expect(calls()).toEqual([]);
  });
});
