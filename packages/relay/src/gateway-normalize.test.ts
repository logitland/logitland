import { describe, expect, it } from 'vitest';
import { channelChanges, messageChannelId, messageCreated, normalizeDispatch, pollFromDiscord, type NormalizeContext } from './gateway';
import { snowflakeTime } from './services/events';
import { IntakeEvent } from './services/intake';

const GUILD = '100000000000000001';
const LOUNGE = '110000000000000001';
const THREAD = '120000000000000001';
const TAG_A = '140000000000000001';
const TAG_B = '140000000000000002';

const ctx = (over: Partial<NormalizeContext> = {}): NormalizeContext => ({ guildId: GUILD, threads: new Map(), ...over });

const message = (over: Record<string, unknown> = {}) => ({
  id: '300000000000000001',
  channel_id: LOUNGE,
  guild_id: GUILD,
  author: { id: '200000000000000001', username: 'luna', global_name: 'Luna' },
  content: 'hello',
  timestamp: '2026-10-19T03:00:00.123000+00:00',
  edited_timestamp: null,
  type: 0,
  ...over,
});

describe('messages', () => {
  it('turn into create events that pass intake validation, with timestamps in one format', () => {
    const [e] = normalizeDispatch('MESSAGE_CREATE', message(), ctx());
    expect(e).toMatchObject({ kind: 'message_create', channel_id: LOUNGE, thread_id: null, message_id: '300000000000000001', content: 'hello' });
    const parsed = IntakeEvent.parse(e);
    expect(parsed).toMatchObject({
      timestamp: '2026-10-19T03:00:00.123Z',
      author: { id: '200000000000000001', global_name: 'Luna', bot: false, webhook_id: null },
    });
  });

  it('map thread messages to the parent channel and set thread_id', () => {
    const threads = new Map([[THREAD, LOUNGE]]);
    const [e] = normalizeDispatch('MESSAGE_CREATE', message({ channel_id: THREAD }), ctx({ threads }));
    expect(e).toMatchObject({ channel_id: LOUNGE, thread_id: THREAD });
  });

  it('keep default and reply messages and drop system messages', () => {
    expect(normalizeDispatch('MESSAGE_CREATE', message({ type: 0 }), ctx())).toHaveLength(1);
    expect(normalizeDispatch('MESSAGE_CREATE', message({ type: 19 }), ctx())).toHaveLength(1);
    for (const type of [1, 6, 7, 18, 21]) expect(normalizeDispatch('MESSAGE_CREATE', message({ type }), ctx())).toEqual([]);
  });

  it('carry the webhook ID of webhook messages', () => {
    const [e] = normalizeDispatch(
      'MESSAGE_CREATE',
      message({ webhook_id: '600000000000000001', author: { id: '600000000000000001', username: 'Moth-9', bot: true } }),
      ctx(),
    );
    expect(IntakeEvent.parse(e)).toMatchObject({ author: { webhook_id: '600000000000000001', bot: true, username: 'Moth-9' } });
  });

  it('ignore other servers and direct messages', () => {
    expect(normalizeDispatch('MESSAGE_CREATE', message({ guild_id: '199999999999999999' }), ctx())).toEqual([]);
    expect(normalizeDispatch('MESSAGE_CREATE', message({ guild_id: undefined }), ctx())).toEqual([]);
    expect(normalizeDispatch('MESSAGE_CREATE', message({ guild_id: '199999999999999999' }), ctx({ guildId: null }))).toHaveLength(1);
  });

  it('turn REST messages into the same events', () => {
    const { guild_id: _guild, ...rest } = message({ edited_timestamp: '2026-10-19T03:05:00.000000+00:00' });
    expect(IntakeEvent.parse(messageCreated(rest, new Map()))).toMatchObject({ kind: 'message_create', edited_timestamp: '2026-10-19T03:05:00.000Z' });
  });
});

describe('edits and deletes', () => {
  it('only treat MESSAGE_UPDATE as an edit when it carries a new edited_timestamp', () => {
    expect(normalizeDispatch('MESSAGE_UPDATE', message({ edited_timestamp: null }), ctx())).toEqual([]);
    const [e] = normalizeDispatch('MESSAGE_UPDATE', message({ edited_timestamp: '2026-10-19T03:05:00.000000+00:00', content: 'hello again' }), ctx());
    expect(IntakeEvent.parse(e)).toMatchObject({ kind: 'message_update', content: 'hello again', edited_timestamp: '2026-10-19T03:05:00.000Z' });
  });

  it('leave absent fields out of an edit', () => {
    const [e] = normalizeDispatch(
      'MESSAGE_UPDATE',
      { id: '300000000000000001', channel_id: LOUNGE, guild_id: GUILD, edited_timestamp: '2026-10-19T03:05:00.000000+00:00' },
      ctx(),
    );
    expect(e).not.toHaveProperty('content');
  });

  it('map deletes, including in threads', () => {
    const threads = new Map([[THREAD, LOUNGE]]);
    expect(normalizeDispatch('MESSAGE_DELETE', { id: '300000000000000001', channel_id: THREAD, guild_id: GUILD }, ctx({ threads }))).toEqual([
      { kind: 'message_delete', channel_id: LOUNGE, thread_id: THREAD, message_id: '300000000000000001' },
    ]);
    expect(normalizeDispatch('MESSAGE_DELETE_BULK', { ids: ['300000000000000001', '300000000000000002'], channel_id: LOUNGE, guild_id: GUILD }, ctx())).toEqual(
      [{ kind: 'message_delete_bulk', channel_id: LOUNGE, thread_id: null, message_ids: ['300000000000000001', '300000000000000002'] }],
    );
  });
});

describe('threads', () => {
  const thread = (over: Record<string, unknown> = {}) => ({
    id: THREAD,
    guild_id: GUILD,
    parent_id: LOUNGE,
    name: 'a thread',
    type: 11,
    thread_metadata: { archived: false, locked: false, create_timestamp: '2026-10-19T02:00:00+00:00' },
    ...over,
  });

  it('are recorded from THREAD_CREATE, THREAD_UPDATE, THREAD_LIST_SYNC and GUILD_CREATE, and remembered for messages', () => {
    const upsert = {
      kind: 'thread_upsert',
      thread_id: THREAD,
      parent_id: LOUNGE,
      name: 'a thread',
      owner_id: null,
      created_at: '2026-10-19T02:00:00+00:00',
      archived: false,
      locked: false,
      applied_tags: null,
    };
    for (const [t, d] of [
      ['THREAD_CREATE', thread()],
      ['THREAD_UPDATE', thread()],
      ['THREAD_LIST_SYNC', { guild_id: GUILD, threads: [thread()] }],
      ['GUILD_CREATE', { id: GUILD, threads: [thread()], channels: [] }],
    ] as const) {
      const c = ctx();
      expect(normalizeDispatch(t, d, c)).toContainEqual(upsert);
      expect(c.threads.get(THREAD)).toBe(LOUNGE);
    }
  });

  it('carry the user who made them', () => {
    const [e] = normalizeDispatch('THREAD_CREATE', thread({ owner_id: '200000000000000001' }), ctx());
    expect(IntakeEvent.parse(e)).toMatchObject({ owner_id: '200000000000000001' });
  });

  it('carry Discord’s archived, locked and creation time, and fall back to the ID’s time', () => {
    const [archived] = normalizeDispatch(
      'THREAD_UPDATE',
      thread({ thread_metadata: { archived: true, locked: true, create_timestamp: '2026-10-19T01:00:00.123456+00:00' } }),
      ctx(),
    );
    expect(IntakeEvent.parse(archived)).toMatchObject({ archived: true, locked: true, created_at: '2026-10-19T01:00:00.123Z' });
    const [plain] = normalizeDispatch('THREAD_CREATE', thread({ thread_metadata: undefined }), ctx());
    expect(plain).toMatchObject({ archived: null, locked: null, created_at: snowflakeTime(THREAD) });
    // 2026-10-19T03:00:00Z as a snowflake
    expect(snowflakeTime(String((BigInt(Date.UTC(2026, 9, 19, 3)) - 1_420_070_400_000n) << 22n))).toBe('2026-10-19T03:00:00.000Z');
  });

  it('carry the forum tags applied to a post', () => {
    const tagged = thread({ applied_tags: [TAG_A, TAG_B] });
    for (const [t, d] of [
      ['THREAD_CREATE', tagged],
      ['THREAD_UPDATE', tagged],
      ['THREAD_LIST_SYNC', { guild_id: GUILD, threads: [tagged] }],
      ['GUILD_CREATE', { id: GUILD, threads: [tagged], channels: [] }],
    ] as const) {
      const e = normalizeDispatch(t, d, ctx()).find((x) => x.kind === 'thread_upsert');
      expect(IntakeEvent.parse(e)).toMatchObject({ applied_tags: [TAG_A, TAG_B] });
    }
    // A thread update that doesn't mention tags leaves them alone; an empty list clears them.
    expect(normalizeDispatch('THREAD_UPDATE', thread(), ctx())[0]).toMatchObject({ applied_tags: null });
    expect(normalizeDispatch('THREAD_UPDATE', thread({ applied_tags: [] }), ctx())[0]).toMatchObject({ applied_tags: [] });
  });

  it('are removed on THREAD_DELETE', () => {
    expect(normalizeDispatch('THREAD_DELETE', { id: THREAD, guild_id: GUILD, parent_id: LOUNGE, type: 11 }, ctx())).toEqual([
      { kind: 'thread_delete', thread_id: THREAD, parent_id: LOUNGE },
    ]);
  });

  it('are synced: a list of active threads says the others are archived', () => {
    const sync = normalizeDispatch('THREAD_LIST_SYNC', { guild_id: GUILD, channel_ids: [LOUNGE], threads: [thread()] }, ctx()).at(-1);
    expect(sync).toEqual({ kind: 'thread_sync', parent_ids: [LOUNGE], active_ids: [THREAD] });
    const guild = normalizeDispatch('GUILD_CREATE', { id: GUILD, channels: [], threads: [] }, ctx()).at(-1);
    expect(guild).toEqual({ kind: 'thread_sync', parent_ids: null, active_ids: [] });
  });

  it('are not synced from an unavailable guild, which would archive every live thread', () => {
    expect(normalizeDispatch('GUILD_CREATE', { id: GUILD, unavailable: true }, ctx())).toEqual([]);
  });

  it('cover announcement and public threads but not private ones or plain channels', () => {
    expect(normalizeDispatch('THREAD_CREATE', thread({ type: 10 }), ctx())).toHaveLength(1);
    const c = ctx();
    expect(normalizeDispatch('THREAD_CREATE', thread({ type: 12 }), c)).toEqual([]);
    expect(c.threads.size).toBe(0);
    expect(normalizeDispatch('THREAD_CREATE', thread({ type: 0 }), ctx())).toEqual([]);
  });

  it('leave other servers’ threads out', () => {
    const c = ctx();
    expect(normalizeDispatch('THREAD_CREATE', thread({ guild_id: '199999999999999999' }), c)).toEqual([]);
    expect(c.threads.size).toBe(0);
  });
});

describe('helpers', () => {
  it('track which channels exist and are not threads', () => {
    expect(channelChanges('GUILD_CREATE', { id: GUILD, channels: [{ id: LOUNGE, type: 0 }] })).toEqual({ add: [LOUNGE], remove: [] });
    expect(channelChanges('CHANNEL_DELETE', { id: LOUNGE, type: 0 })).toEqual({ add: [], remove: [LOUNGE] });
    expect(channelChanges('MESSAGE_CREATE', message())).toEqual({ add: [], remove: [] });
  });

  it('name the channel a message dispatch is about', () => {
    expect(messageChannelId('MESSAGE_CREATE', message())).toBe(LOUNGE);
    expect(messageChannelId('THREAD_CREATE', {})).toBeNull();
  });

  it('produce nothing for dispatches the relay does not use', () => {
    expect(normalizeDispatch('TYPING_START', {}, ctx())).toEqual([]);
  });
});

describe('replies', () => {
  const REFERENCE = '300000000000000099';

  it('keep the message they answer, only when the type is a reply', () => {
    const reply = IntakeEvent.parse(
      normalizeDispatch('MESSAGE_CREATE', message({ type: 19, message_reference: { message_id: REFERENCE, channel_id: LOUNGE } }), ctx())[0],
    );
    expect(reply).toMatchObject({ kind: 'message_create', reply_to: REFERENCE });
    // A forward is type 0 with a reference of its own; it answers nothing.
    const forward = normalizeDispatch('MESSAGE_CREATE', message({ type: 0, message_reference: { type: 1, message_id: REFERENCE } }), ctx())[0];
    expect(forward).toMatchObject({ reply_to: null });
    expect(normalizeDispatch('MESSAGE_CREATE', message({ type: 19 }), ctx())[0]).toMatchObject({ reply_to: null });
  });

  it('are read the same way from REST messages', () => {
    const { guild_id: _guild, ...rest } = message({ type: 19, message_reference: { message_id: REFERENCE } });
    expect(messageCreated(rest, new Map())).toMatchObject({ reply_to: REFERENCE });
  });
});

describe('polls', () => {
  const discordPoll = {
    question: { text: 'Lunch?' },
    answers: [
      { answer_id: 1, poll_media: { text: 'Soup' } },
      { answer_id: 2, poll_media: { text: 'Noodles', emoji: { name: 'noodle' } } },
      { answer_id: 3, poll_media: { emoji: { name: 'pizza' } } },
    ],
    expiry: '2026-10-20T03:00:00.000000+00:00',
    allow_multiselect: true,
    layout_type: 1,
  };

  it('are stored in the relay’s shape, whether or not the message has text', () => {
    const [e] = normalizeDispatch('MESSAGE_CREATE', message({ content: '', poll: discordPoll }), ctx());
    expect(IntakeEvent.parse(e)).toMatchObject({
      content: '',
      poll: {
        question: 'Lunch?',
        answers: [
          { id: 1, text: 'Soup', emoji: null },
          { id: 2, text: 'Noodles', emoji: 'noodle' },
          { id: 3, text: 'pizza', emoji: 'pizza' },
        ],
        expires_at: '2026-10-20T03:00:00.000Z',
        allow_multiselect: true,
      },
    });
  });

  it('turn a webhook’s answer or a plain create object into the same shape', () => {
    expect(pollFromDiscord({ question: { text: 'Q' }, answers: [{ poll_media: { text: 'a' } }, { poll_media: { text: 'b' } }] })).toEqual({
      question: 'Q',
      answers: [
        { id: 1, text: 'a', emoji: null },
        { id: 2, text: 'b', emoji: null },
      ],
      expires_at: null,
      allow_multiselect: false,
    });
    expect(pollFromDiscord(undefined)).toBeNull();
    expect(pollFromDiscord({ question: { text: 'no answers' }, answers: [] })).toBeNull();
  });

  it('report results from MESSAGE_UPDATE even though nothing was edited', () => {
    const results = {
      is_finalized: true,
      answer_counts: [
        { id: 1, count: 4, me_voted: false },
        { id: 2, count: 1, me_voted: false },
      ],
    };
    const out = normalizeDispatch(
      'MESSAGE_UPDATE',
      { id: '300000000000000001', channel_id: LOUNGE, guild_id: GUILD, poll: { ...discordPoll, results }, edited_timestamp: null },
      ctx(),
    );
    expect(out).toEqual([
      {
        kind: 'message_poll',
        channel_id: LOUNGE,
        thread_id: null,
        message_id: '300000000000000001',
        results: {
          finalized: true,
          counts: [
            { id: 1, count: 4 },
            { id: 2, count: 1 },
          ],
        },
      },
    ]);
    expect(IntakeEvent.parse(out[0])).toMatchObject({ kind: 'message_poll' });
    // No results, no edit: nothing to record.
    expect(normalizeDispatch('MESSAGE_UPDATE', { id: '300000000000000001', channel_id: LOUNGE, guild_id: GUILD, poll: discordPoll }, ctx())).toEqual([]);
  });
});

describe('channel updates', () => {
  const channel = (over: Record<string, unknown> = {}) => ({ id: LOUNGE, guild_id: GUILD, name: 'lounge', type: 0, ...over });

  it('carry the name and type of the channels the relay can use', () => {
    for (const [type, name] of [
      [0, 'text'],
      [5, 'announcement'],
      [15, 'forum'],
      [16, 'media'],
    ] as const)
      expect(normalizeDispatch('CHANNEL_UPDATE', channel({ type }), ctx())).toEqual([
        { kind: 'channel_update', channel_id: LOUNGE, name: 'lounge', type: name },
      ]);
    expect(normalizeDispatch('CHANNEL_UPDATE', channel({ type: 2 }), ctx())).toEqual([]);
    expect(normalizeDispatch('CHANNEL_UPDATE', channel({ guild_id: '199999999999999999' }), ctx())).toEqual([]);
  });

  it('carry a forum’s tags', () => {
    const [e] = normalizeDispatch(
      'CHANNEL_UPDATE',
      channel({
        type: 15,
        available_tags: [
          { id: TAG_A, name: 'Bug', moderated: true },
          { id: TAG_B, name: 'Idea' },
        ],
      }),
      ctx(),
    );
    expect(IntakeEvent.parse(e)).toMatchObject({
      tags: [
        { id: TAG_A, name: 'Bug', moderated: true },
        { id: TAG_B, name: 'Idea', moderated: false },
      ],
    });
  });

  it('are also learned from GUILD_CREATE, so a rename made while offline is picked up', () => {
    const out = normalizeDispatch(
      'GUILD_CREATE',
      { id: GUILD, channels: [channel(), channel({ id: '110000000000000009', type: 2, name: 'voice' })], threads: [] },
      ctx(),
    );
    expect(out.filter((e) => e.kind === 'channel_update')).toHaveLength(1);
  });
});
