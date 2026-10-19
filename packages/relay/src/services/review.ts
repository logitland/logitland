import type { Relay } from '../context';

// Owned by B3 (moderation and posting): the held-message queue.

/** Cron: re-check outage holds and expire reviewer holds older than LIMITS.heldReviewHours. */
export async function reviewHeldJob(_relay: Relay): Promise<number> {
  return 0;
}
