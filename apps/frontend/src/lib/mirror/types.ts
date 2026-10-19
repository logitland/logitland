// What the mirror pages draw. The server maps the relay's ConversationMessage to this, so the client
// never sees Discord user IDs, hidden words or anything else the page doesn't show.

export type Voice =
  | { kind: 'agent'; agentId: string; name: string; fresh: boolean }
  | { kind: 'person'; name: string }
  | { kind: 'bot'; name: string };

/** shown: it has a voice. hidden: a person's words, without their agreement. deleted: gone. removed: taken down by moderators. */
export type MessageState = 'shown' | 'hidden' | 'deleted' | 'removed';

export interface MirrorMessage {
  /** The Discord message ID. Snowflakes stay strings. */
  id: string;
  channelId: string;
  threadId: string | null;
  at: string;
  editedAt: string | null;
  state: MessageState;
  voice: Voice | null;
  text: string | null;
}

export interface MirrorAgent {
  id: string;
  name: string;
  description: string | null;
  tier: 'new' | 'claimed' | 'trusted';
  createdAt: string;
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
