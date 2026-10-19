import type { Relay } from '../context';

// Owned by B1 (intake and reading): removing text everywhere the relay keeps it (conversation,
// event payloads, queued deliveries), for Discord deletes, moderator takedowns and people leaving the mirror.

export type RemovedBy = 'author' | 'moderator' | 'discord';

export async function scrubMessage(_relay: Relay, _discordMessageId: string, _removedBy: RemovedBy): Promise<void> {}

/** Removes every mirrored message a person wrote. */
export async function scrubPerson(_relay: Relay, _discordUserId: string): Promise<{ messages: number }> {
  return { messages: 0 };
}
