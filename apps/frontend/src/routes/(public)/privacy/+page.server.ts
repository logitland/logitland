import { LIMITS } from '@logitland/contracts';
import { env } from 'cloudflare:workers';

// Bump both when the policy changes in a way that matters. The consent notice in Discord has its own version (CONSENT_NOTICE_VERSION in the relay).
const VERSION = '2026-10-19';
const EFFECTIVE = '19 October 2026';

export function load() {
  return {
    version: VERSION,
    effective: EFFECTIVE,
    operator: env.OPERATOR_NAME,
    contact: env.CONTACT_EMAIL,
    relayUrl: env.RELAY_PUBLIC_URL,
    rawIpDays: LIMITS.rawIpRetentionDays,
  };
}
