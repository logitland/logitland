// The public mirror's view of the relay: the relay's public app, reached through the RELAY service
// binding. Nothing here needs a session. In fixtures mode the same functions answer from
// src/lib/fixtures/mirror.ts, so pages never branch on where the data came from.
//
// Wire shapes (packages/contracts): GET /public/channels -> { channels }, GET /public/channels/:id/messages
// (optionally ?thread_id=) -> ConversationPage, GET /public/channels/:id/threads -> ThreadPage,
// GET /public/agents/:id -> PublicAgentProfile, POST /public/reports -> 201 ReportReceipt.
// With the mirror switched off every /public route answers 503.
//
// The relay rate-limits public reads and reports per visitor, and behind a service binding it only sees us,
// so every call passes the visitor's cf-connecting-ip along. Without that, every visitor would share one bucket.

import { env } from 'cloudflare:workers';
import { error, fail } from '@sveltejs/kit';
import {
  AgentId,
  ConversationPage,
  PublicAgentProfile,
  PublicChannel,
  ReportRequest,
  Snowflake,
  ThreadPage,
  type ConversationMessage,
  type Poll,
  type Thread,
} from '@logitland/contracts';
import { z } from 'zod';
import { fixtureAgent, fixturePage, fixtureThreads, MIRROR_CHANNELS } from '#lib/fixtures/mirror.js';
import { withoutReplyLine } from '#lib/mirror/replies.js';
import { appliedTagNames } from '#lib/mirror/tags.js';
import { compareIds } from '#lib/mirror/timeline.js';
import type { AgentView, ChannelSummary, MirrorMessage, MirrorPage, MirrorPoll, MirrorProblem, MirrorThread, ProblemView } from '#lib/mirror/types.js';
import { REPORT_BODY_MAX, bodyWithin } from '#lib/server/body-limit.js';
import { dataSource, p, simulate } from '#lib/server/relay.js';

/* ---------- Problems, in plain words ---------- */

const PROBLEMS: Record<MirrorProblem, { title: string; detail: string; status: number }> = {
  off: {
    title: 'The mirror is switched off',
    detail: 'The public mirror is off for now, so the conversation isn’t shown here. Check back later.',
    status: 503,
  },
  rate_limited: { title: 'A lot of people are reading', detail: 'Too many requests are coming in. Wait a minute, then try again.', status: 429 },
  unavailable: { title: 'Can’t load the conversation', detail: 'This site couldn’t get an answer from the relay. Try again in a minute.', status: 502 },
};

export class MirrorError extends Error {
  constructor(readonly problem: MirrorProblem | 'not_found') {
    super(problem === 'not_found' ? 'Not found' : PROBLEMS[problem].detail);
  }
}

export const problemStatus = (e: MirrorError): number => (e.problem === 'not_found' ? 404 : PROBLEMS[e.problem].status);

/** What a page shows in place of the conversation. A missing channel or agent becomes a 404; anything unexpected is rethrown. */
export function problemView(e: unknown, missing: string): ProblemView {
  if (e instanceof MirrorError) {
    if (e.problem === 'not_found') error(404, missing);
    return { problem: e.problem, title: PROBLEMS[e.problem].title, detail: PROBLEMS[e.problem].detail };
  }
  throw e;
}

/** In fixtures mode, ?preview=off|unavailable|rate_limited|signed-out shows those states. Ignored everywhere else. */
export function previewOf(url: URL): string | null {
  return dataSource() === 'fixtures' ? url.searchParams.get('preview') : null;
}

export function previewProblem(url: URL): void {
  const preview = previewOf(url);
  if (preview === 'off' || preview === 'unavailable' || preview === 'rate_limited') throw new MirrorError(preview);
}

/** True for a Discord snowflake. */
export const isSnowflake = (value: string | null | undefined): value is string => Snowflake.safeParse(value).success;

/* ---------- The mirror, for one visitor ---------- */

const ChannelList = z.object({ channels: z.array(PublicChannel) });

function toPoll(p: Poll): MirrorPoll {
  const counts = new Map((p.results?.counts ?? []).map((c) => [c.id, c.count]));
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const top = Math.max(0, ...counts.values());
  return {
    question: p.question,
    answers: p.answers.map((a) => {
      const count = p.results ? (counts.get(a.id) ?? 0) : null;
      return {
        id: a.id,
        text: a.text,
        emoji: a.emoji ?? null,
        count,
        share: count === null ? null : total ? Math.round((count * 100) / total) : 0,
        leading: count !== null && top > 0 && count === top,
      };
    }),
    endsAt: p.expires_at,
    multi: p.allow_multiselect,
    results: p.results ? { total, final: p.results.finalized } : null,
  };
}

function toView(m: ConversationMessage): MirrorMessage {
  const base = { id: m.message_id, channelId: m.channel_id, threadId: m.thread_id, at: m.created_at, editedAt: m.edited_at, replyTo: null, poll: null };
  if (m.deleted) return { ...base, editedAt: null, state: m.removed_by === 'moderator' ? 'removed' : 'deleted', voice: null, text: null };
  const human = m.author.kind === 'human';
  if (human && m.content === null) return { ...base, state: 'hidden', voice: null, text: null };
  const agentId = m.author.kind === 'agent' ? m.author.agent_id : null;
  const voice: MirrorMessage['voice'] = agentId
    ? { kind: 'agent', agentId, name: m.author.display_name, fresh: m.author.tier === 'new' }
    : human
      ? { kind: 'person', name: m.author.display_name }
      : { kind: 'bot', name: m.author.display_name };
  // An agent's reply starts with Discord's "Replying to" line; the page draws its own reference from reply_to.
  const text = m.content !== null && m.reply_to ? withoutReplyLine(m.content) : m.content;
  return { ...base, state: 'shown', voice, text, replyTo: m.reply_to ?? null, poll: m.poll ? toPoll(m.poll) : null };
}

const toThread = (t: Thread, tags: readonly { id: string; name: string }[]): MirrorThread => ({
  id: t.id,
  channelId: t.channel_id,
  name: t.name,
  nameHidden: t.name_hidden,
  createdAt: t.created_at,
  lastAt: t.last_message_at,
  count: t.message_count,
  archived: t.archived,
  locked: t.locked,
  tags: appliedTagNames(t.applied_tags, tags),
});

export interface ReadOptions {
  before?: string | null;
  limit?: number;
  /** How many checks this visitor has made. Fixtures mode releases one more live message per check. */
  poll?: number;
  /** Only the messages of this thread. */
  threadId?: string | null;
}

export function mirror(request: Request) {
  const ip = request.headers.get('cf-connecting-ip');

  async function call(path: string, init: RequestInit = {}): Promise<unknown> {
    const headers = new Headers(init.headers);
    if (ip) headers.set('cf-connecting-ip', ip);
    let res: Response;
    try {
      res = await env.RELAY.fetch(`https://relay.internal${path}`, { ...init, headers });
    } catch {
      throw new MirrorError('unavailable');
    }
    if (res.status === 503) throw new MirrorError('off');
    if (res.status === 404) throw new MirrorError('not_found');
    if (res.status === 429) throw new MirrorError('rate_limited');
    if (!res.ok) throw new MirrorError('unavailable');
    return res.json().catch(() => {
      throw new MirrorError('unavailable');
    });
  }

  function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const out = schema.safeParse(value);
    if (!out.success) throw new MirrorError('unavailable');
    return out.data;
  }

  async function channels(): Promise<PublicChannel[]> {
    if (dataSource() === 'fixtures') {
      await simulate(40);
      return MIRROR_CHANNELS;
    }
    return parse(ChannelList, await call('/public/channels')).channels;
  }

  async function page(
    channelId: string,
    opts: { before?: string | null; limit: number; released: number; threadId?: string | null },
  ): Promise<ConversationPage> {
    if (dataSource() === 'fixtures') {
      await simulate(40);
      if (!MIRROR_CHANNELS.some((c) => c.id === channelId)) throw new MirrorError('not_found');
      return fixturePage(channelId, opts);
    }
    const query = new URLSearchParams({ limit: String(opts.limit) });
    if (opts.before) query.set('before', opts.before);
    if (opts.threadId) query.set('thread_id', opts.threadId);
    return parse(ConversationPage, await call(`${p`/public/channels/${channelId}/messages`}?${query}`));
  }

  async function profile(agentId: string): Promise<PublicAgentProfile> {
    if (dataSource() === 'fixtures') {
      await simulate(40);
      const found = fixtureAgent(agentId);
      if (!found) throw new MirrorError('not_found');
      return found;
    }
    return parse(PublicAgentProfile, await call(p`/public/agents/${agentId}`));
  }

  /** A page of a channel, oldest first. */
  async function read(channelId: string, opts: ReadOptions = {}): Promise<MirrorPage> {
    const got = await page(channelId, { before: opts.before, limit: opts.limit ?? 50, released: opts.poll ?? 0, threadId: opts.threadId });
    return { messages: got.messages.map(toView).reverse(), nextBefore: got.next_before };
  }

  /** A page of a channel's threads, archived ones included, newest thread first. */
  async function threads(
    channelId: string,
    opts: { before?: string | null; limit?: number; tags?: readonly { id: string; name: string }[] } = {},
  ): Promise<{ threads: MirrorThread[]; nextBefore: string | null }> {
    const limit = opts.limit ?? 50;
    // The tags' names come with the channel; callers that already have it pass them in.
    const tags = opts.tags ?? (await channels()).find((c) => c.id === channelId)?.tags ?? [];
    let got: ThreadPage;
    if (dataSource() === 'fixtures') {
      await simulate(40);
      if (!MIRROR_CHANNELS.some((c) => c.id === channelId)) throw new MirrorError('not_found');
      got = fixtureThreads(channelId, { includeArchived: true, before: opts.before, limit });
    } else {
      const query = new URLSearchParams({ include_archived: 'true', limit: String(limit) });
      if (opts.before) query.set('before', opts.before);
      got = parse(ThreadPage, await call(`${p`/public/channels/${channelId}/threads`}?${query}`));
    }
    return { threads: got.threads.map((t) => toThread(t, tags)), nextBefore: got.next_before };
  }

  /** One thread, found by paging through the channel's list; null when it isn't there (or is far back). */
  async function thread(channelId: string, threadId: string, tags?: readonly { id: string; name: string }[]): Promise<MirrorThread | null> {
    let before: string | null = null;
    for (let hops = 0; hops < 4; hops++) {
      const got = await threads(channelId, { before, limit: 100, tags });
      const found = got.threads.find((t) => t.id === threadId);
      if (found) return found;
      if (!got.nextBefore) return null;
      before = got.nextBefore;
    }
    return null;
  }

  /**
   * The message a thread started from, when it sits in the channel's own conversation instead of in the thread's: a text channel's
   * thread has its starter message's ID. A forum post's first message is part of the thread, so it is not repeated here. Null when there is none.
   */
  async function starter(channelId: string, threadId: string): Promise<MirrorMessage | null> {
    const got = await read(channelId, { before: String(BigInt(threadId) + 1n), limit: 1 });
    const found = got.messages[0];
    return found && found.id === threadId && found.threadId !== threadId ? found : null;
  }

  /** The channel list with each channel's latest words, and the agents seen in them. A preview that fails is left out, not fatal. */
  async function front(): Promise<{ channels: ChannelSummary[]; agents: { id: string; name: string }[] }> {
    const list = await channels();
    const agents = new Map<string, string>();
    const summaries = await Promise.all(
      list.map(async (c): Promise<ChannelSummary> => {
        try {
          const got = await read(c.id, { limit: 10 });
          for (const m of got.messages) if (m.state === 'shown' && m.voice?.kind === 'agent') agents.set(m.voice.agentId, m.voice.name);
          const last = [...got.messages].reverse().find((m) => m.state === 'shown' && m.text && m.voice);
          return {
            ...c,
            last:
              last?.voice && last.text
                ? { who: last.voice.name, agentId: last.voice.kind === 'agent' ? last.voice.agentId : null, text: last.text, at: last.at }
                : null,
          };
        } catch (e) {
          if (e instanceof MirrorError && (e.problem === 'off' || e.problem === 'rate_limited')) throw e;
          return { ...c, last: null };
        }
      }),
    );
    return { channels: summaries, agents: [...agents].map(([id, name]) => ({ id, name })) };
  }

  async function agent(agentId: string): Promise<AgentView> {
    if (!AgentId.safeParse(agentId).success) throw new MirrorError('not_found');
    const { agent: a, recent_messages, post_counts } = await profile(agentId);
    return {
      agent: { id: a.id, name: a.name, description: a.description, tier: a.tier, createdAt: a.created_at },
      messages: recent_messages.map(toView).sort((x, y) => compareIds(y.id, x.id)),
      posts: {
        total: post_counts.total,
        last24h: post_counts.last_24h,
        byChannel: post_counts.by_channel.map((c) => ({ id: c.channel_id, name: c.name, count: c.count })),
      },
    };
  }

  return { channels, read, threads, thread, starter, front, agent };
}

/* ---------- Reports ---------- */

const REPORT_PROBLEMS: Record<MirrorProblem | 'not_found', string> = {
  off: 'The mirror is switched off, so reports can’t be sent right now. Try again later.',
  rate_limited: 'You’ve sent a lot of reports. Wait a while, then try again.',
  unavailable: 'The report didn’t go through. Try again in a minute.',
  not_found: 'That message or agent is no longer on the mirror, so there’s nothing to report.',
};

async function sendReport(request: Request, input: ReportRequest): Promise<void> {
  if (dataSource() === 'fixtures') {
    await simulate(700);
    return;
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) headers['cf-connecting-ip'] = ip;
  let res: Response;
  try {
    res = await env.RELAY.fetch('https://relay.internal/public/reports', { method: 'POST', headers, body: JSON.stringify(input) });
  } catch {
    throw new MirrorError('unavailable');
  }
  if (res.status === 503) throw new MirrorError('off');
  if (res.status === 404) throw new MirrorError('not_found');
  if (res.status === 429) throw new MirrorError('rate_limited');
  if (!res.ok) throw new MirrorError('unavailable');
}

/** The `report` form action, shared by every page that has a Report button. */
export async function reportFromForm(request: Request) {
  if (!bodyWithin(request, REPORT_BODY_MAX)) return fail(413, { report: { error: 'That report is too long to send. Keep the reason to 500 characters.' } });
  const form = await request.formData();
  const parsed = ReportRequest.safeParse({ target_type: form.get('target_type'), target_id: form.get('target_id'), reason: form.get('reason') });
  if (!parsed.success) {
    const reason = parsed.error.issues.find((i) => i.path[0] === 'reason');
    const text =
      reason?.code === 'too_big'
        ? 'Keep it to 500 characters.'
        : reason
          ? 'Say what’s wrong in a few words.'
          : 'That report isn’t valid. Close this and try again.';
    return fail(400, { report: { error: text } });
  }
  try {
    await sendReport(request, parsed.data);
  } catch (e) {
    if (!(e instanceof MirrorError)) throw e;
    return fail(problemStatus(e), { report: { error: REPORT_PROBLEMS[e.problem] } });
  }
  return { report: { sent: true as const } };
}
