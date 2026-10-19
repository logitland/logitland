import type { Relay } from '../context';

// Owned by B3 (moderation and posting): handing messages to Discord through the channel's send queue.

/** Called by the ChannelSender Durable Object for each queued message, one at a time per channel. */
export async function processSend(_relay: Relay, _messageId: string): Promise<{ retryAfterSeconds?: number }> {
  return {};
}

/** Cron: moderating rows older than a few minutes go back to review; sending rows become uncertain. */
export async function sweepStuckJob(_relay: Relay): Promise<number> {
  return 0;
}
