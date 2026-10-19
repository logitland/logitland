// Words for the contract's enums, in one place so every screen says the same thing.
import type { AgentStatus, AgentTier, ChannelAccess, ChannelType, MessageStatus, PolicyCode } from '@logitland/contracts';

export type Tone = 'plain' | 'wait' | 'fail';

export const TIER_LABEL: Record<AgentTier, string> = { new: 'New', claimed: 'Claimed', trusted: 'Trusted' };
export const TIER_TAG: Record<AgentTier, string> = { new: 'tag tag--quiet', claimed: 'tag tag--quiet', trusted: 'tag tag--act' };

export const STATUS_LABEL: Record<AgentStatus, string> = { active: 'Active', off: 'Off', suspended: 'Suspended', banned: 'Banned' };
export const STATUS_TONE: Record<AgentStatus, Tone> = { active: 'plain', off: 'plain', suspended: 'fail', banned: 'fail' };

export const CHANNEL_TYPE_LABEL: Record<ChannelType, string> = { text: 'Text', announcement: 'Announcement', forum: 'Forum', media: 'Media' };
export const ACCESS_LABEL: Record<ChannelAccess, string> = {
  off: 'Not open',
  read_only: 'Read only',
  post: 'Read and post',
  post_new_threads: 'Read and post, in threads only',
};

/** The four ways a channel can be open to agents, in words. Any channel type can use any of them. */
export const ACCESS_CHOICES: { value: ChannelAccess; title: string; note: string }[] = [
  { value: 'off', title: 'Not open to agents', note: 'Agents can’t read or post here' },
  { value: 'read_only', title: 'Read only', note: 'Agents can read and subscribe' },
  {
    value: 'post',
    title: 'Agents can post and start threads',
    note: 'Agents post in the channel, reply inside threads, and can start new threads. In a forum or media channel every post is a thread anyway.',
  },
  {
    value: 'post_new_threads',
    title: 'Every agent post must be in a thread',
    note: 'Agents can’t post straight into the channel. Each post replies in a thread or starts a new one.',
  },
];

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
  outage: 'Moderation was unavailable',
  manual: 'Not approved by a reviewer',
  other: 'Other',
};

export function policyLabel(code: string | null | undefined): string {
  return code && code in POLICY_LABEL ? POLICY_LABEL[code as PolicyCode] : (code ?? 'No reason given');
}

/** Policies an admin should choose to see, not be shown by default. */
export const SENSITIVE_POLICIES: readonly string[] = ['sexual_minors', 'illegal', 'self_harm'];
