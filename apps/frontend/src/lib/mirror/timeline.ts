import type { MirrorMessage } from './types.js';

/** Snowflakes are time-ordered; compare them as numbers without losing precision. */
export const compareIds = (a: string, b: string): number => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

/** A message with a thread ID other than its own is a reply. A thread's first message shares the thread's ID. */
export const isReply = (m: MirrorMessage): boolean => m.threadId !== null && m.threadId !== m.id;

export type TimelineItem =
  | { key: string; kind: 'message'; message: MirrorMessage; replies: MirrorMessage[]; at: string }
  /** Replies whose first message isn't loaded yet. */
  | { key: string; kind: 'orphan'; threadId: string; replies: MirrorMessage[]; at: string };

/** Oldest first. Replies sit under their thread's first message, or under a stub when it hasn't been loaded. */
/** `flat` lists every message on its own, for a page that is one thread. */
export function buildTimeline(messages: MirrorMessage[], opts: { flat?: boolean } = {}): TimelineItem[] {
  const sorted = [...messages].sort((a, b) => compareIds(a.id, b.id));
  if (opts.flat) return sorted.map((m) => ({ key: m.id, kind: 'message' as const, message: m, replies: [], at: m.at }));
  const byThread = new Map<string, MirrorMessage[]>();
  const roots = new Set<string>();
  for (const m of sorted) {
    if (isReply(m)) byThread.set(m.threadId!, [...(byThread.get(m.threadId!) ?? []), m]);
    else roots.add(m.id);
  }
  const items: TimelineItem[] = [];
  const stubbed = new Set<string>();
  for (const m of sorted) {
    if (!isReply(m)) {
      items.push({ key: m.id, kind: 'message', message: m, replies: byThread.get(m.id) ?? [], at: m.at });
    } else if (!roots.has(m.threadId!) && !stubbed.has(m.threadId!)) {
      stubbed.add(m.threadId!);
      items.push({ key: `thread-${m.threadId}`, kind: 'orphan', threadId: m.threadId!, replies: byThread.get(m.threadId!)!, at: m.at });
    }
  }
  return items;
}

/** True when two messages differ in anything the page shows. */
export function changed(a: MirrorMessage, b: MirrorMessage): boolean {
  return (
    a.state !== b.state ||
    a.text !== b.text ||
    a.editedAt !== b.editedAt ||
    a.replyTo !== b.replyTo ||
    a.voice?.kind !== b.voice?.kind ||
    (a.voice?.kind === 'agent' && b.voice?.kind === 'agent' && a.voice.fresh !== b.voice.fresh) ||
    JSON.stringify(a.poll) !== JSON.stringify(b.poll)
  );
}

/** Add messages that aren't there yet. `replace` lets newer data win for ones that are. */
export function mergeMessages(into: MirrorMessage[], more: MirrorMessage[], replace = false): MirrorMessage[] {
  const byId = new Map(into.map((m) => [m.id, m]));
  for (const m of more) if (replace || !byId.has(m.id)) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => compareIds(a.id, b.id));
}
