import { describe, expect, it } from 'vitest';
import { checkLoop, inLoop, recentConversation } from './services/moderation/loops';
import { FORUM, LOUNGE, harness, seedAgent, seedChannel } from './testing';

// The loop check and the classifier's context read the same rows: a person whose message was withheld still counts as someone
// having spoken, and nobody reads a whole forum to find the last twelve messages that aren't in a thread.

let n = 600000000000000000n;
async function say(h: ReturnType<typeof harness>, o: { agent?: string; withheld?: boolean; thread?: string | null; channel?: string; minutesAgo: number }) {
  n += 1n;
  const human = !o.agent;
  await h.db
    .prepare(
      'INSERT INTO conversation (message_id, channel_id, thread_id, author_kind, agent_id, author_ref, discord_user_id, display_name, content, created_at, withheld) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)',
    )
    .bind(
      String(n),
      o.channel ?? LOUNGE,
      o.thread ?? null,
      human ? 'human' : 'agent',
      o.agent ?? null,
      o.agent ?? 'p_withheld',
      human ? 'A person in Discord' : 'Agent',
      human ? null : 'blah',
      new Date(h.now().getTime() - o.minutesAgo * 60_000).toISOString(),
      Number(Boolean(o.withheld)),
    )
    .run();
}

describe('the loop breaker and people who had not agreed', () => {
  it('counts a withheld message as a person having spoken, so it ends a loop', async () => {
    const h = harness();
    await seedChannel(h.relay, { id: LOUNGE, access: 'post' });
    const a = await seedAgent(h.relay, { tier: 'claimed' });
    const b = await seedAgent(h.relay, { tier: 'claimed' });
    for (let i = 0; i < 11; i++) await say(h, { agent: i % 2 ? a.id : b.id, minutesAgo: 6 - i * 0.5 });
    expect(inLoop(await recentConversation(h.relay, LOUNGE, null), a.id, h.now())).toBe(true);
    await say(h, { withheld: true, minutesAgo: 0 });
    const rows = await recentConversation(h.relay, LOUNGE, null);
    expect(rows[0]).toMatchObject({ author_kind: 'human', withheld: 1, consented: 0, content: null });
    expect(inLoop(rows, a.id, h.now())).toBe(false);
    expect(inLoop(rows, b.id, h.now())).toBe(false);
  });

  it('reads nothing for a message that starts a thread', async () => {
    const h = harness();
    await seedChannel(h.relay, { id: FORUM, name: 'forum', type: 'forum', access: 'post_new_threads', webhookUrl: null });
    const a = await seedAgent(h.relay, { tier: 'claimed' });
    let queries = 0;
    const prepare = h.db.prepare.bind(h.db);
    h.db.prepare = (sql: string) => {
      queries++;
      return prepare(sql);
    };
    expect(await checkLoop(h.relay, { agentId: a.id, channelId: FORUM, threadId: null, startsThread: true })).toEqual([]);
    expect(queries).toBe(0);
    expect(await checkLoop(h.relay, { agentId: a.id, channelId: FORUM, threadId: null })).toEqual([]);
    expect(queries).toBe(1);
  });
});

describe('the conversation indexes', () => {
  const plan = async (h: ReturnType<typeof harness>, sql: string, ...args: unknown[]) =>
    (
      await h.db
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .bind(...args)
        .all<{ detail: string }>()
    ).results
      .map((r) => r.detail)
      .join(' | ');

  it('serve the loop check without scanning the channel, in a thread and out of one', async () => {
    const h = harness();
    const channel = plan(h, 'SELECT message_id FROM conversation c WHERE c.channel_id = ? AND c.thread_id IS NULL ORDER BY c.message_id DESC LIMIT 12', FORUM);
    const thread = plan(
      h,
      'SELECT message_id FROM conversation c WHERE c.channel_id = ? AND c.thread_id = ? ORDER BY c.message_id DESC LIMIT 12',
      FORUM,
      '120000000000000001',
    );
    expect(await channel).toContain('conversation_channel_thread');
    expect(await channel).not.toContain('TEMP B-TREE');
    expect(await thread).toContain('conversation_channel_thread');
    expect(await thread).not.toContain('TEMP B-TREE');
  });

  it('find the agent replies to a person’s messages without scanning the conversation', async () => {
    const h = harness();
    const text = await plan(
      h,
      "SELECT message_id FROM conversation r WHERE r.author_kind = 'agent' AND r.reply_to IN (SELECT CAST(p.message_id AS TEXT) FROM conversation p WHERE p.discord_user_id = ?)",
      '1',
    );
    expect(text).toContain('conversation_reply');
  });
});
