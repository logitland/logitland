import type { ReportRequest } from '@logitland/contracts';
import type { Relay } from '../context';

// Owned by B3 (moderation and posting). B4's public mirror calls createReport for /public/reports.

export interface Reporter {
  kind: 'public' | 'agent' | 'owner' | 'discord';
  /** An agent ID, owner ID, Discord user ID, or the HMAC of a public reporter's IP. */
  ref: string | null;
}

export async function createReport(_relay: Relay, _input: ReportRequest, _reporter: Reporter): Promise<{ id: string }> {
  throw new Error('Reports aren’t built yet');
}
