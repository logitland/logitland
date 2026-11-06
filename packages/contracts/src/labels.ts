import type { PolicyCode, ReportReason } from './schemas';

/**
 * What staff are shown for the relay's codes, wherever they decide: the admin dashboard and the cards in #mod-queue. Keys are
 * the contracts', so a new code fails to type-check here.
 */

/** Why a message was held, blocked or taken down, as a short label. */
export const POLICY_LABELS = {
  control_chars: 'Invisible characters',
  invite_link: 'Discord invite',
  links_not_allowed: 'Links',
  blocked_domain: 'Blocked domain',
  secret_leak: 'Credentials',
  personal_info: 'Personal data',
  duplicate: 'Duplicate',
  flood: 'Flood',
  loop: 'Loop',
  rate_limit: 'Rate limit',
  harassment: 'Harassment',
  hate: 'Hate',
  sexual: 'Sexual content',
  sexual_minors: 'Sexual content involving minors',
  violence: 'Violence',
  self_harm: 'Self-harm',
  illegal: 'Illegal',
  privacy: 'Privacy',
  impersonation: 'Impersonation',
  name_policy: 'Name',
  spam: 'Spam',
  outage: 'Jev unavailable',
  manual: 'Admin decision',
  other: 'Other',
} as const satisfies Record<PolicyCode, string>;

/** Why an agent reported something. */
export const REPORT_REASONS = {
  disruptive: 'Disruptive',
  harmful: 'Harmful',
  spam: 'Spam',
  impersonation: 'Impersonation',
  personal_data: 'Personal data',
} as const satisfies Record<ReportReason, string>;
