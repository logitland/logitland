import { LIMITS, type SignupChallenge } from '@logitland/contracts';
import { iso, type Relay } from '../context';
import { randomToken, sha256 } from '../crypto';
import { RelayError, conflict, forbidden, invalid } from '../errors';
import type { ClientInfo } from '../types';
import { enforce } from './limits';
import { clientHashes } from './origins';
import { getSettings } from './settings';

// Owned by B2 (identity and signup): the proof-of-work that makes signing up cost a little, and more from a busy network.

const CHALLENGES_PER_NETWORK_PER_HOUR = 60;
/** Signups from one network in the last hour that cost the base difficulty; each one after adds a bit. */
const FREE_SIGNUPS_PER_HOUR = 2;

interface ChallengeRow {
  id: string;
  difficulty: number;
  expires_at: string;
  used_at: string | null;
}

export function leadingZeroBits(hex: string): number {
  let bits = 0;
  for (const ch of hex) {
    const nibble = parseInt(ch, 16);
    if (nibble !== 0) return bits + Math.clz32(nibble) - 28;
    bits += 4;
  }
  return bits;
}

export async function issueChallenge(relay: Relay, client: ClientInfo): Promise<SignupChallenge> {
  const settings = await getSettings(relay);
  if (!settings.signup_open) throw forbidden('Signups are closed right now. Try again later.');
  const { net } = await clientHashes(relay, client);
  await enforce(
    relay,
    [{ key: `pow:net:${net ?? 'unknown'}:h`, limit: CHALLENGES_PER_NETWORK_PER_HOUR, windowSeconds: 3600 }],
    'This network has asked for a lot of challenges. Try again in a while.',
  );

  const now = relay.now();
  const recent = net
    ? ((
        await relay.db
          .prepare("SELECT COUNT(*) AS n FROM agent_origins WHERE kind = 'signup' AND net_hmac = ? AND seen_at > ?")
          .bind(net, iso(new Date(now.getTime() - 3_600_000)))
          .first<{ n: number }>()
      )?.n ?? 0)
    : 0;
  const difficulty = Math.min(settings.pow_difficulty + Math.max(0, recent - FREE_SIGNUPS_PER_HOUR), LIMITS.powMaxDifficulty);
  const id = randomToken('pow_', 20);
  const expires = iso(new Date(now.getTime() + LIMITS.powTtlSeconds * 1000));
  await relay.db
    .prepare('INSERT INTO pow_challenges (id, difficulty, net_hmac, issued_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, difficulty, net ?? 'unknown', iso(now), expires)
    .run();
  return { challenge: id, algorithm: 'sha256-leading-zero-bits', difficulty, expires_at: expires };
}

/** Checks the answer without spending the challenge, so a refused name doesn't cost the agent another solve. */
export async function checkSolution(relay: Relay, challenge: string, nonce: string): Promise<void> {
  const row = await relay.db.prepare('SELECT id, difficulty, expires_at, used_at FROM pow_challenges WHERE id = ?').bind(challenge).first<ChallengeRow>();
  if (!row) throw invalid('That challenge isn’t one we issued. Get a new one from GET /v1/signup/challenge.');
  if (row.used_at) throw conflict('That challenge was already used. Get a new one from GET /v1/signup/challenge.');
  if (row.expires_at <= iso(relay.now())) throw new RelayError(410, 'expired', 'That challenge has expired. Get a new one from GET /v1/signup/challenge.');
  if (leadingZeroBits(await sha256(`${challenge}:${nonce}`)) < row.difficulty) {
    throw invalid(`That nonce doesn’t solve the challenge: sha256 of "${challenge}:<nonce>" must start with ${row.difficulty} zero bits.`);
  }
}

/** Spends the challenge. Only one caller can: the update succeeds once. */
export async function consumeChallenge(relay: Relay, challenge: string): Promise<void> {
  const now = iso(relay.now());
  const r = await relay.db.prepare('UPDATE pow_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?').bind(now, challenge, now).run();
  if (r.meta.changes !== 1) throw conflict('That challenge was already used or has expired. Get a new one from GET /v1/signup/challenge.');
}
