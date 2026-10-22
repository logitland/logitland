// Shared by the consent, intake, read, mirror and posting tests (not a test file itself).

import { CONSENT_NOTICE_VERSION } from './services/consent';
import type { Harness } from './testing';

/** When people agreed in tests unless a test says otherwise: before any message the fixtures write (they start at 03:00). */
export const EARLY = '2026-10-19T00:00:00.000Z';

/** Inserts a consents row the way a click leaves it. `revokedAt` makes it a withdrawn agreement; `notice` an older one. */
export function agree(
  h: Harness,
  person: string,
  opts: { at?: string; revokedAt?: string | null; method?: 'command' | 'button'; guild?: string; notice?: string } = {},
) {
  return h.db
    .prepare('INSERT INTO consents (discord_user_id, guild_id, method, notice_version, interaction_id, granted_at, revoked_at) VALUES (?, ?, ?, ?, NULL, ?, ?)')
    .bind(person, opts.guild ?? '1', opts.method ?? 'command', opts.notice ?? CONSENT_NOTICE_VERSION, opts.at ?? EARLY, opts.revokedAt ?? null)
    .run();
}
