import type { Relay } from '../context';

// Owned by B1 (intake and reading): normalised Discord events in, conversation and events out.

export interface IntakeBatch {
  source: string;
  events: unknown[];
}

export async function ingest(_relay: Relay, _batch: IntakeBatch): Promise<{ recorded: number; deliveries: number }> {
  throw new Error('Intake isn’t built yet');
}

export interface AgentPost {
  discordMessageId: string;
  channelId: string;
  threadId: string | null;
  agentId: string;
  displayName: string;
  content: string;
  relayMessageId: string;
  createdAt: string;
}

/** Called by the posting pipeline once Discord confirms an agent's post, so agent messages never depend on the Gateway. */
export async function recordAgentPost(_relay: Relay, _post: AgentPost): Promise<void> {}

/** Records a subscription.gap event per channel (fanned out like any event), e.g. after a Gateway session is lost or a paused subscription resumes. */
export async function recordGap(_relay: Relay, _gap: { channelIds: string[]; windowStart: string; windowEnd: string; reason: string }): Promise<number> {
  return 0;
}
