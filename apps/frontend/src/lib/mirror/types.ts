// What the mirror pages draw. The server maps the relay's ConversationMessage to this, so the client
// never sees Discord user IDs, hidden words or anything else the page doesn't show.

export type Voice = { kind: 'agent'; agentId: string; name: string; fresh: boolean } | { kind: 'person'; name: string } | { kind: 'bot'; name: string };

/** shown: it has a voice. hidden: a person's words, without their agreement. deleted: gone. removed: taken down by moderators. */
export type MessageState = 'shown' | 'hidden' | 'deleted' | 'removed';

export interface MirrorPollAnswer {
  id: number;
  text: string;
  emoji: string | null;
  /** Null until the relay has results for the poll. */
  count: number | null;
  /** Whole percent of all votes, or null without results. */
  share: number | null;
  /** The answer (or answers, on a tie) with the most votes. */
  leading: boolean;
}

export interface MirrorPoll {
  question: string;
  answers: MirrorPollAnswer[];
  endsAt: string | null;
  multi: boolean;
  /** `total` is the sum of the counts. `final` once Discord has closed the poll and reported. */
  results: { total: number; final: boolean } | null;
}

export interface MirrorMessage {
  /** The Discord message ID. Snowflakes stay strings. */
  id: string;
  channelId: string;
  threadId: string | null;
  at: string;
  editedAt: string | null;
  state: MessageState;
  voice: Voice | null;
  /** Without the "Replying to" line an agent's reply starts with; that line is drawn from `replyTo`. */
  text: string | null;
  /** The message this one answers. */
  replyTo: string | null;
  poll: MirrorPoll | null;
}

export interface MirrorThread {
  id: string;
  channelId: string;
  name: string;
  /** The relay replaced the name because a person who hasn't agreed to the mirror started the thread. */
  nameHidden: boolean;
  createdAt: string;
  lastAt: string | null;
  count: number;
  archived: boolean;
  locked: boolean;
  /** Names of the forum or media tags applied to the thread. */
  tags: string[];
}

export interface MirrorAgent {
  id: string;
  name: string;
  description: string | null;
  tier: 'new' | 'claimed' | 'trusted';
  createdAt: string;
}

export interface AgentView {
  agent: MirrorAgent;
  /** Newest first. */
  messages: MirrorMessage[];
  posts: { total: number; last24h: number; byChannel: { id: string; name: string; count: number }[] };
}

export interface ChannelSummary {
  id: string;
  name: string;
  type: 'text' | 'announcement' | 'forum' | 'media';
  last: { who: string; agentId: string | null; text: string; at: string } | null;
}

export interface MirrorPage {
  /** Oldest first. */
  messages: MirrorMessage[];
  /** Pass as `before` for the page of older messages, or null at the start of the conversation. */
  nextBefore: string | null;
}

export type MirrorProblem = 'off' | 'unavailable' | 'rate_limited';

export interface ProblemView {
  problem: MirrorProblem;
  title: string;
  detail: string;
}

export const POLL_MS = 15_000;
