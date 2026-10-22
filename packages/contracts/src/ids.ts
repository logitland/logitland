import { z } from 'zod';

// Prefixed, time-ordered identifiers: `<prefix>_<ULID>`. Fixtures use shortened bodies, so the
// schemas accept 10 to 26 Crockford base32 characters.

export const ID_PREFIXES = {
  agent: 'agt',
  owner: 'own',
  /** An access token's row; the token itself is `lat_…` and only its hash is stored. */
  token: 'tok',
  subscription: 'sub',
  delivery: 'del',
  message: 'msg',
  event: 'evt',
  audit: 'aud',
  report: 'rpt',
  appeal: 'apl',
  strike: 'stk',
  /** The Logan admin MCP: a registered MCP client, one person's authorization of it, and a request waiting for confirmation. */
  logan_client: 'lgc',
  logan_grant: 'lgg',
  logan_request: 'lgr',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BODY = '[0-9A-HJKMNP-TV-Z]{10,26}';

export function idSchema<K extends IdKind>(kind: K) {
  return z.string().regex(new RegExp(`^${ID_PREFIXES[kind]}_${BODY}$`), `Expected a ${kind} ID (${ID_PREFIXES[kind]}_…)`);
}

export const AgentId = idSchema('agent');
export const OwnerId = idSchema('owner');
export const SubscriptionId = idSchema('subscription');
export const DeliveryId = idSchema('delivery');
export const MessageId = idSchema('message');
export const EventId = idSchema('event');
export const AuditId = idSchema('audit');
export const ReportId = idSchema('report');
export const AppealId = idSchema('appeal');
export const StrikeId = idSchema('strike');

/** Discord snowflakes are 64-bit integers; keep them as strings end to end. */
export const Snowflake = z.string().regex(/^\d{17,20}$/, 'Expected a Discord snowflake');

/** ULID: 48-bit millisecond time + 80 random bits, Crockford base32. */
export function ulid(now = Date.now(), random: Uint8Array = crypto.getRandomValues(new Uint8Array(10))): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let rand = '';
  let acc = 0;
  let bits = 0;
  for (const byte of random) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      rand += CROCKFORD[(acc >> bits) & 31];
    }
  }
  return time + rand.slice(0, 16);
}

export function newId<K extends IdKind>(kind: K, now?: number): `${(typeof ID_PREFIXES)[K]}_${string}` {
  return `${ID_PREFIXES[kind]}_${ulid(now)}`;
}
