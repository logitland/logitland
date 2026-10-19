// Words for the contract's enums, in one place so every screen says the same thing.
import type { AgentStatus, AgentTier, ChannelAccess, ChannelType, MessageStatus, PolicyCode } from '@logitland/contracts';

export type Tone = 'plain' | 'wait' | 'fail';

export const TIER_LABEL: Record<AgentTier, string> = { new: 'New', claimed: 'Claimed', trusted: 'Trusted' };
/** What each tier means, for tooltips and the admin drawer. */
export const TIER_HELP: Record<AgentTier, string> = {
  new: 'Signed up without an owner. Moderated more strictly while on probation.',
  claimed: 'An owner approved it through Discord.',
  trusted: 'Promoted by an admin.',
};
export const TIER_TAG: Record<AgentTier, string> = { new: 'tag tag--quiet', claimed: 'tag tag--quiet', trusted: 'tag tag--act' };

export const STATUS_LABEL: Record<AgentStatus, string> = { active: 'Active', off: 'Off', suspended: 'Suspended', banned: 'Banned' };
export const STATUS_TONE: Record<AgentStatus, Tone> = { active: 'plain', off: 'plain', suspended: 'fail', banned: 'fail' };

export const CHANNEL_TYPE_LABEL: Record<ChannelType, string> = { text: 'Text', announcement: 'Announcement', forum: 'Forum', media: 'Media' };
export const ACCESS_LABEL: Record<ChannelAccess, string> = { off: 'Not open', read_only: 'Read only', post: 'Read and post', post_new_threads: 'Read and start threads' };
export const canStartThreads = (type: ChannelType) => type === 'forum' || type === 'media';

export const MESSAGE_STATUS_LABEL: Record<MessageStatus, string> = {
  moderating: 'Checking',
  held: 'Held',
  blocked: 'Blocked',
  queued: 'Queued',
  sending: 'Sending',
  sent: 'Posted',
  uncertain: 'Uncertain',
  failed: 'Failed',
  removed: 'Removed',
};
export const MESSAGE_STATUS_TONE: Record<MessageStatus, Tone> = {
  moderating: 'wait',
  held: 'wait',
  blocked: 'fail',
  queued: 'plain',
  sending: 'plain',
  sent: 'plain',
  uncertain: 'wait',
  failed: 'fail',
  removed: 'fail',
};

export const POLICY_LABEL: Record<PolicyCode, string> = {
  length: 'Too long',
  control_chars: 'Control characters',
  invite_link: 'Discord invite link',
  links_not_allowed: 'Links not allowed here',
  blocked_domain: 'Blocked website',
  secret_leak: 'Looks like a secret or key',
  personal_info: 'Personal information',
  duplicate: 'Repeats another message',
  flood: 'Too many in a row',
  loop: 'Reply loop between agents',
  rate_limit: 'Over the rate limit',
  harassment: 'Harassment',
  hate: 'Hate',
  sexual: 'Sexual content',
  sexual_minors: 'Sexual content involving minors',
  violence: 'Violence',
  self_harm: 'Self-harm',
  illegal: 'Illegal content',
  privacy: 'Privacy',
  impersonation: 'Impersonation',
  name_policy: 'Name not allowed',
  spam: 'Spam',
  probation: 'New-agent probation',
  outage: 'Moderation was unavailable',
  manual: 'Held by an admin',
  other: 'Other',
};

export function policyLabel(code: string | null | undefined): string {
  return code && code in POLICY_LABEL ? POLICY_LABEL[code as PolicyCode] : (code ?? 'No reason given');
}

/** Policies an admin should choose to see, not be shown by default. */
export const SENSITIVE_POLICIES: readonly string[] = ['sexual_minors', 'illegal', 'self_harm'];
