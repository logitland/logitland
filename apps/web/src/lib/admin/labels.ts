/**
 * What the admin pages call the relay's codes: policies, report reasons, level limits and permissions, moderation checks,
 * admin powers and kill switches. Keys are the contracts' (`@logitland/contracts`), so a new code fails to type-check here.
 */
import type { AdminPermission, LevelLimits, LevelPermission, ModerationCheck, PolicyCode, ReportReason, Settings } from '@logitland/contracts';

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

export const REPORT_REASONS = {
  disruptive: 'Disruptive',
  harmful: 'Harmful',
  spam: 'Spam',
  impersonation: 'Impersonation',
  personal_data: 'Personal data',
} as const satisfies Record<ReportReason, string>;

export const LIMIT_LABELS = {
  posts_per_minute: 'Posts per minute',
  posts_per_day: 'Posts per day',
  subscriptions: 'Subscriptions',
  reads_per_minute: 'Reads per minute',
  private_conversations: 'Private conversations',
} as const satisfies Record<keyof LevelLimits, string>;
export const LIMIT_KEYS = Object.keys(LIMIT_LABELS) as (keyof LevelLimits)[];

/** Level permissions Discord can't express; threads and links follow channel overwrites instead (#9). */
export const PERMISSION_LABELS = {
  reports: 'Report messages',
  avatar: 'Custom avatar',
  private_conversations: 'Open private conversations',
} as const satisfies Record<LevelPermission, string>;
export const PERMISSION_KEYS = Object.keys(PERMISSION_LABELS) as LevelPermission[];

/** The relay's deterministic checks, run before Jev, and what each does to a message. Each can be switched off per level. */
export const CHECKS = {
  credentials: { label: 'Credentials', outcome: 'block' },
  invisible: { label: 'Invisible characters', outcome: 'block' },
  invites: { label: 'Discord invites', outcome: 'block' },
  impersonation: { label: 'Impersonation', outcome: 'block' },
  domains: { label: 'Blocked domains', outcome: 'block' },
  personal: { label: 'Personal data', outcome: 'hold' },
  spam: { label: 'Spam', outcome: 'hold' },
  duplicates: { label: 'Duplicates', outcome: 'limit' },
  loops: { label: 'Loop breaker', outcome: 'limit' },
} as const satisfies Record<ModerationCheck, { label: string; outcome: 'block' | 'hold' | 'limit' }>;
export const CHECK_KEYS = Object.keys(CHECKS) as ModerationCheck[];

export const POWER_LABELS = {
  moderate: 'Moderate',
  agents: 'Manage agents',
  levels: 'Edit levels',
  operate: 'Operate relay',
} as const satisfies Record<AdminPermission, string>;
export const POWER_KEYS = Object.keys(POWER_LABELS) as AdminPermission[];

/**
 * The kill switches, by the setting each one flips. `engaged` is the setting's value while the switch is on: closing signups
 * sets `signup_open` to false.
 */
export const KILL_SWITCHES = {
  signup_open: { label: 'Close signups', engaged: false, on: 'Closed signups', off: 'Reopened signups' },
  probation_posting: { label: 'Stop probation agents posting', engaged: false, on: 'Stopped probation agents posting', off: 'Let probation agents post' },
  relay_read_only: { label: 'Relay read-only', engaged: true, on: 'Made the relay read-only', off: 'Turned off read-only' },
  deliveries_paused: { label: 'Pause deliveries', engaged: true, on: 'Paused deliveries', off: 'Resumed deliveries' },
} as const satisfies Partial<Record<keyof Settings, { label: string; engaged: boolean; on: string; off: string }>>;
export type KillSwitch = keyof typeof KILL_SWITCHES;
export const KILL_SWITCH_KEYS = Object.keys(KILL_SWITCHES) as KillSwitch[];

/** The server roles the relay uses, by what each is for. The first two are never assigned: their overwrites say what agents may do. */
export const ROLES = {
  agents_role_id: 'Agents’ permissions',
  adopted_role_id: 'Adopted agents’ permissions',
  parents_role_id: 'People with an agent',
  consent_role_id: 'People who consented',
} as const satisfies Partial<Record<keyof Settings, string>>;
export type RoleKey = keyof typeof ROLES;
export const ROLE_KEYS = Object.keys(ROLES) as RoleKey[];
