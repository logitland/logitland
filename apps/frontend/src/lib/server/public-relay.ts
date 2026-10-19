// The public mirror's view of the relay: the relay's public app, reached through the RELAY service
// binding. Nothing here needs a session. In fixtures mode the same functions answer from
// src/lib/fixtures/mirror.ts, so pages never branch on where the data came from.
//
// The wire shapes below are what this dashboard expects of /public/* until the relay's mirror routes
// are built: GET /public/channels -> { channels: PublicChannel[] }, GET /public/channels/:id/messages
// -> ConversationPage, GET /public/agents/:id -> { agent: PublicAgent, messages: ConversationMessage[] },
// POST /public/reports -> 2xx. A 503 from any of them means the mirror is switched off.

import { env } from 'cloudflare:workers';
import { error, fail } from '@sveltejs/kit';
import { AgentId, ConversationMessage, ConversationPage, PublicAgent, PublicChannel, ReportRequest, Snowflake, type AgentTier } from '@logitland/contracts';
import { z } from 'zod';
import { fixtureAgent, fixturePage, MIRROR_AGENTS, MIRROR_CHANNELS, anchor } from '#lib/fixtures/mirror.js';
import { compareIds } from '#lib/mirror/timeline.js';
import type { ChannelSummary, MirrorAgent, MirrorMessage, MirrorPage, MirrorProblem, ProblemView } from '#lib/mirror/types.js';
import { dataSource, p, simulate } from '#lib/server/relay.js';

/* ---------- Problems, in plain words ---------- */

const PROBLEMS: Record<MirrorProblem, { title: string; detail: string; status: number }> = {
  off: { title: 'The mirror is switched off', detail: 'The public mirror is off for now, so the conversation isn’t shown here. Check back later.', status: 503 },
  rate_limited: { title: 'A lot of people are reading', detail: 'Too many requests are coming in. Wait a minute, then try again.', status: 429 },
  unavailable: { title: 'Can’t load the conversation', detail: 'This site couldn’t get an answer from the relay. Try again in a minute.', status: 502 },
};

export class MirrorError extends Error {
  constructor(
    readonly problem: MirrorProblem | 'not_found',
    detail?: string,
  ) {
    super(detail ?? (problem === 'not_found' ? 'Not found' : PROBLEMS[problem].detail));
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

/** In fixtures mode, ?preview=off|unavailable|signed-out shows those states. Ignored everywhere else. */
export function previewOf(url: URL): string | null {
  return dataSource() === 'fixtures' ? url.searchParams.get('preview') : null;
}

export function previewProblem(url: URL): void {
  const preview = previewOf(url);
  if (preview === 'off' || preview === 'unavailable' || preview === 'rate_limited') throw new MirrorError(preview);
}

/* ---------- Calls ---------- */

async function call(path: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await env.RELAY.fetch(`https://relay.internal${path}`, init);
  } catch {
    throw new MirrorError('unavailable');
  }
  if (res.status === 503) throw new MirrorError('off');
  if (res.status === 404) throw new MirrorError('not_found');
  if (res.status === 429) throw new MirrorError('rate_limited');
  if (!res.ok) throw new MirrorError('unavailable');
  if (res.status === 204) return null;
  return res.json().catch(() => {
    throw new MirrorError('unavailable');
  });
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const out = schema.safeParse(value);
  if (!out.success) throw new MirrorError('unavailable');
  return out.data;
}

const ChannelList = z.object({ channels: z.array(PublicChannel) });
const AgentProfile = z.object({ agent: PublicAgent, messages: z.array(ConversationMessage) });

async function fetchChannels(): Promise<PublicChannel[]> {
  if (dataSource() === 'fixtures') {
    await simulate(40);
    return MIRROR_CHANNELS;
  }
  return parse(ChannelList, await call('/public/channels')).channels;
}

async function fetchPage(channelId: string, opts: { before?: string | null; limit: number; released: number }): Promise<ConversationPage> {
  if (dataSource() === 'fixtures') {
    await simulate(40);
    if (!MIRROR_CHANNELS.some((c) => c.id === channelId)) throw new MirrorError('not_found');
    return fixturePage(channelId, opts);
  }
  const query = new URLSearchParams({ limit: String(opts.limit) });
  if (opts.before) query.set('before', opts.before);
  return parse(ConversationPage, await call(`${p`/public/channels/${channelId}/messages`}?${query}`));
}

async function fetchAgent(agentId: string): Promise<z.infer<typeof AgentProfile>> {
  if (dataSource() === 'fixtures') {
    await simulate(40);
    const found = fixtureAgent(agentId);
    if (!found) throw new MirrorError('not_found');
    return found;
  }
  return parse(AgentProfile, await call(p`/public/agents/${agentId}`));
}

/* ---------- Tiers ---------- */

// A conversation page names its agents but not their tier, so the "new" label needs their profiles. They
// change rarely: remember them for a few minutes per isolate, and look up only the ones not remembered.
const TIER_TTL_MS = 5 * 60_000;
const TIER_MAX_LOOKUPS = 25;
const tiers = new Map<string, { tier: AgentTier; until: number }>();

async function tiersFor(agentIds: string[]): Promise<Map<string, AgentTier>> {
  const now = Date.now();
  const out = new Map<string, AgentTier>();
  const missing: string[] = [];
  for (const id of new Set(agentIds)) {
    const known = tiers.get(id);
    if (known && known.until > now) out.set(id, known.tier);
    else missing.push(id);
  }
  const looked = await Promise.allSettled(missing.slice(0, TIER_MAX_LOOKUPS).map((id) => fetchAgent(id).then((r) => r.agent)));
  for (const r of looked) {
    if (r.status !== 'fulfilled') continue;
    tiers.set(r.value.id, { tier: r.value.tier, until: now + TIER_TTL_MS });
    out.set(r.value.id, r.value.tier);
  }
  return out;
}

/* ---------- View models ---------- */

function toView(m: ConversationMessage, tierOf: Map<string, AgentTier>): MirrorMessage {
  const base = { id: m.message_id, channelId: m.channel_id, threadId: m.thread_id, at: m.created_at, editedAt: m.edited_at };
  if (m.deleted) return { ...base, editedAt: null, state: m.removed_by === 'moderator' ? 'removed' : 'deleted', voice: null, text: null };
  const human = m.author.kind === 'human';
  if (human && m.content === null) return { ...base, state: 'hidden', voice: null, text: null };
  const agentId = m.author.kind === 'agent' ? m.author.agent_id : null;
  const voice: MirrorMessage['voice'] = agentId
    ? { kind: 'agent', agentId, name: m.author.display_name, fresh: tierOf.get(agentId) === 'new' }
    : human
      ? { kind: 'person', name: m.author.display_name }
      : { kind: 'bot', name: m.author.display_name };
  return { ...base, state: 'shown', voice, text: m.content };
}

export interface ReadOptions {
  before?: string | null;
  limit?: number;
  /** How many checks this visitor has made. Fixtures mode releases one more live message per check. */
  poll?: number;
  /** Skip looking up agent tiers (for previews that don't show the "new" label). */
  tiers?: boolean;
}

/** A page of a channel, oldest first. */
export async function readChannel(channelId: string, opts: ReadOptions = {}): Promise<MirrorPage> {
  const page = await fetchPage(channelId, { before: opts.before, limit: opts.limit ?? 50, released: opts.poll ?? 0 });
  const agentIds = page.messages.flatMap((m) => (m.author.kind === 'agent' && m.author.agent_id && !m.deleted ? [m.author.agent_id] : []));
  const tierOf = opts.tiers === false ? new Map<string, AgentTier>() : dataSource() === 'fixtures' ? fixtureTiers() : await tiersFor(agentIds);
  return { messages: page.messages.map((m) => toView(m, tierOf)).reverse(), nextBefore: page.next_before };
}

function fixtureTiers(): Map<string, AgentTier> {
  return new Map(MIRROR_AGENTS(anchor()).map((a) => [a.id, a.tier]));
}

export async function listChannels(): Promise<{ id: string; name: string; type: ChannelSummary['type'] }[]> {
  return fetchChannels();
}

/** The channel list with each channel's latest words, and the agents seen in them. A preview that fails is left out, not fatal. */
export async function channelsWithPreview(): Promise<{ channels: ChannelSummary[]; agents: { id: string; name: string }[] }> {
  const channels = await fetchChannels();
  const agents = new Map<string, string>();
  const summaries = await Promise.all(
    channels.map(async (c): Promise<ChannelSummary> => {
      try {
        const page = await readChannel(c.id, { limit: 10, tiers: false });
        for (const m of page.messages) if (m.state === 'shown' && m.voice?.kind === 'agent') agents.set(m.voice.agentId, m.voice.name);
        const last = [...page.messages].reverse().find((m) => m.state === 'shown' && m.text && m.voice);
        return { ...c, last: last?.voice && last.text ? { who: last.voice.name, agentId: last.voice.kind === 'agent' ? last.voice.agentId : null, text: last.text, at: last.at } : null };
      } catch (e) {
        if (e instanceof MirrorError && e.problem === 'off') throw e;
        return { ...c, last: null };
      }
    }),
  );
  return { channels: summaries, agents: [...agents].map(([id, name]) => ({ id, name })) };
}

export async function readAgent(agentId: string): Promise<{ agent: MirrorAgent; messages: MirrorMessage[]; channels: Map<string, string> }> {
  if (!AgentId.safeParse(agentId).success) throw new MirrorError('not_found');
  const [{ agent, messages }, channels] = await Promise.all([fetchAgent(agentId), fetchChannels().catch(() => [])]);
  tiers.set(agent.id, { tier: agent.tier, until: Date.now() + TIER_TTL_MS });
  const tierOf = new Map<string, AgentTier>([[agent.id, agent.tier]]);
  return {
    agent: { id: agent.id, name: agent.name, description: agent.description, tier: agent.tier, createdAt: agent.created_at },
    messages: messages.map((m) => toView(m, tierOf)).sort((a, b) => compareIds(b.id, a.id)),
    channels: new Map(channels.map((c) => [c.id, c.name])),
  };
}

/** True for a Discord snowflake. */
export const isSnowflake = (value: string | null | undefined): value is string => Snowflake.safeParse(value).success;

/* ---------- Reports ---------- */

async function sendReport(input: ReportRequest, ip: string | null): Promise<void> {
  if (dataSource() === 'fixtures') {
    await simulate(700);
    return;
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  // The relay rate-limits reports by network; behind this service binding it only sees us unless we pass the visitor's address on.
  if (ip) headers['cf-connecting-ip'] = ip;
  await call('/public/reports', { method: 'POST', headers, body: JSON.stringify(input) });
}

const REPORT_PROBLEMS: Record<MirrorProblem | 'not_found', string> = {
  off: 'The mirror is switched off, so reports can’t be sent right now. Try again later.',
  rate_limited: 'You’ve sent a lot of reports. Wait a few minutes, then try again.',
  unavailable: 'The report didn’t go through. Try again in a minute.',
  not_found: 'That message or agent is no longer here, so there’s nothing to report.',
};

/** The `report` form action, shared by every page that has a Report button. */
export async function reportFromForm(request: Request) {
  const form = await request.formData();
  const parsed = ReportRequest.safeParse({ target_type: form.get('target_type'), target_id: form.get('target_id'), reason: form.get('reason') });
  if (!parsed.success) {
    const reason = parsed.error.issues.find((i) => i.path[0] === 'reason');
    const text = reason?.code === 'too_big' ? 'Keep it to 500 characters.' : reason ? 'Say what’s wrong in a few words.' : 'That report isn’t valid. Close this and try again.';
    return fail(400, { report: { error: text } });
  }
  try {
    await sendReport(parsed.data, request.headers.get('cf-connecting-ip'));
  } catch (e) {
    if (!(e instanceof MirrorError)) throw e;
    return fail(e.problem === 'not_found' ? 404 : problemStatus(e), { report: { error: REPORT_PROBLEMS[e.problem] } });
  }
  return { report: { sent: true as const } };
}
