import type { Relay } from '../context';
import { takeDigests } from './feed';
import { hintsFor } from './hints';
import { getAgent } from './identity';

// An agent's WebSocket stream (#11): a third way to receive digests, next to the webhook and GET /v1/events. Each agent's
// sockets live in one hibernating Durable Object (the StreamHub adapter, in the backend), which keeps no state of its own:
// it asks `streamTake` what to send and when to look again, and reports how many sockets it holds, so `wakeStreams` can
// find the agents to tell when their subscriptions fall due. Frames are the webhook's bodies, one digest each, plus a
// `hints` frame when there is a hint.

/** WebSocket close code for an agent that may no longer read (suspended, banned, off, revoked, or without messages:read). */
export const CLOSE_NOT_ACTIVE = 4003;

export type StreamTake =
  | { close: { code: number; reason: string } }
  | { frames: string[]; /** When to look again (epoch ms): the soonest subscription due later. */ nextDueMs: number | null };

/** What an agent's stream sends now: its due digests, or a reason to close when the agent may no longer read. */
export async function streamTake(relay: Relay, agentId: string): Promise<StreamTake> {
  const agent = await getAgent(relay, agentId).catch(() => null);
  if (!agent || agent.status !== 'active' || !agent.scopes.includes('messages:read'))
    return { close: { code: CLOSE_NOT_ACTIVE, reason: 'This agent can’t receive events now.' } };
  const { digests, capped } = await takeDigests(relay, agent, 'due');
  const { hints } = await hintsFor(relay, agent, { capped });
  const next = await relay.db
    .prepare('SELECT MIN(next_due_ms) AS due FROM subscriptions WHERE agent_id = ? AND next_due_ms IS NOT NULL')
    .bind(agentId)
    .first<{ due: number | null }>();
  return {
    frames: [...digests.map((d) => JSON.stringify(d)), ...(hints ? [JSON.stringify({ type: 'hints', hints })] : [])],
    nextDueMs: next?.due ?? null,
  };
}

/** Records how many sockets an agent's stream holds; 0 forgets it. */
export async function setStreamSockets(relay: Relay, agentId: string, sockets: number): Promise<void> {
  if (sockets <= 0) {
    await relay.db.prepare('DELETE FROM agent_streams WHERE agent_id = ?').bind(agentId).run();
    return;
  }
  await relay.db
    .prepare(
      'INSERT INTO agent_streams (agent_id, sockets, updated_at) VALUES (?, ?, ?) ON CONFLICT (agent_id) DO UPDATE SET sockets = excluded.sockets, updated_at = excluded.updated_at',
    )
    .bind(agentId, sockets, relay.now().toISOString())
    .run();
}

/** Tells connected streams whose subscriptions fall due within the minute; each takes what is due and alarms for the rest. */
export async function wakeStreams(relay: Relay): Promise<void> {
  if (!relay.streams) return;
  const { results } = await relay.db
    .prepare(
      `SELECT DISTINCT s.agent_id FROM subscriptions s JOIN agent_streams t ON t.agent_id = s.agent_id
       WHERE s.next_due_ms IS NOT NULL AND s.next_due_ms < ?`,
    )
    .bind(relay.now().getTime() + 60_000)
    .all<{ agent_id: string }>();
  await Promise.all(
    results.map(({ agent_id }) => relay.streams!.notify(agent_id).catch((error: unknown) => relay.log.error('streams.notify_failed', { agent_id, error }))),
  );
}
