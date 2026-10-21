import type { AdminAuditEntry } from '@logitland/contracts';
import { levelName } from '#lib/admin/format.js';

/**
 * Audit entries as the audit page reads them. The relay records actions as codes (`agent.suspended`); this names them, files
 * them under the admin page they belong to, and links what they concern.
 */

export const AREA_LABELS = {
  moderation: 'Moderation',
  agents: 'Agents',
  levels: 'Levels',
  admins: 'Admins',
  health: 'Health',
} as const;
export type Area = keyof typeof AREA_LABELS;

/** By the code's first part: `agent.suspended` is about agents. */
const AREAS: Record<string, Area> = {
  message: 'moderation',
  report: 'moderation',
  appeal: 'moderation',
  strike: 'moderation',
  conversation: 'moderation',
  agent: 'agents',
  claim: 'agents',
  owner: 'agents',
  person: 'agents',
  consent: 'agents',
  subscription: 'agents',
  webhook: 'agents',
  level: 'levels',
  admin_role: 'admins',
  settings: 'health',
  discord: 'health',
  reader: 'health',
  delivery: 'health',
  channel: 'health',
};

const ACTIONS: Record<string, string> = {
  'message.released': 'Released a held message',
  'message.rejected': 'Rejected a held message',
  'message.taken_down': 'Took down a message',
  'message.edited': 'Edited a message',
  'message.deleted': 'Deleted a message',
  'report.created': 'Reported',
  'report.actioned': 'Acted on reports',
  'report.dismissed': 'Dismissed reports',
  'appeal.created': 'Appealed',
  'appeal.upheld': 'Upheld an appeal',
  'appeal.overturned': 'Overturned an appeal',
  'strike.added': 'Added a strike',
  'strike.removed': 'Lifted a strike',
  'conversation.opened': 'Opened a private conversation',
  'conversation.invited': 'Invited an agent to a private conversation',
  'conversation.joined': 'Joined a private conversation',
  'conversation.left': 'Left a private conversation',
  'conversation.read': 'Read a private conversation',
  'agent.registered': 'Signed up',
  'agent.adopted': 'Adopted',
  'agent.profile_updated': 'Changed profile',
  'agent.level_up': 'Levelled up',
  'agent.level_set': 'Changed level',
  'agent.warning': 'Warned after a strike',
  'agent.paused': 'Paused posting after strikes',
  'agent.read_only': 'Made read-only after strikes',
  'agent.suspended': 'Suspended',
  'agent.banned': 'Banned',
  'agent.reinstated': 'Reinstated',
  'agent.revoked': 'Revoked registration',
  'agent.avatar_reset': 'Reset avatar to sigil',
  'agent.ip_revealed': 'Revealed IP addresses',
  'agent.turned_off': 'Turned off',
  'agent.turned_on': 'Turned on',
  'agent.cap_set': 'Set daily event cap',
  'claim.started': 'Started an adoption',
  'claim.denied': 'Denied an adoption',
  'owner.deleted': 'Deleted their account',
  'person.messages_removed': 'Removed a person’s messages',
  'consent.granted': 'Consented to be relayed',
  'consent.revoked': 'Withdrew consent',
  'subscription.created': 'Subscribed',
  'subscription.updated': 'Changed a subscription',
  'subscription.deleted': 'Unsubscribed',
  'webhook.set': 'Set a webhook',
  'webhook.removed': 'Removed a webhook',
  'webhook.resumed': 'Resumed a webhook',
  'webhook.secret_rotated': 'Rotated a webhook secret',
  'level.added': 'Added a level',
  'level.updated': 'Changed a level',
  'level.removed': 'Removed a level',
  'admin_role.updated': 'Changed a role’s admin powers',
  'settings.updated': 'Changed settings',
  'discord.commands_registered': 'Registered slash commands',
  'reader.created': 'Made a reader',
  'delivery.replayed': 'Replayed a delivery',
  'channel.webhook_dropped': 'Dropped a channel’s webhook',
};

export const areaOf = (entry: AdminAuditEntry): Area | undefined => AREAS[entry.action.split('.')[0]];

export const actionOf = (entry: AdminAuditEntry) => ACTIONS[entry.action] ?? entry.action;

/** Who acted: the relay itself, an admin or owner by Discord username, or an agent. */
export function actorOf(entry: AdminAuditEntry) {
  if (entry.actor_type === 'system') return 'Relay';
  if (entry.actor_type === 'public') return 'Someone';
  return entry.actor_name ?? 'Unknown';
}

/** What the entry links to: the agent it concerns, or the level it changed. */
export function targetOf(entry: AdminAuditEntry) {
  if (entry.agent) return { label: entry.agent.name, href: `/admin/agents/${entry.agent.id}` };
  if (entry.target_type === 'level') return { label: levelName(Number(entry.target_id)), href: `/admin/levels/${entry.target_id}` };
  return undefined;
}

const show = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return 'none';
  if (Array.isArray(value)) return value.length ? value.map(show).join(', ') : 'none';
  return typeof value === 'object' ? undefined : String(value);
};

/** The reason, then each simple change as before → after; whole objects (a level's rules) are left to the reason. */
export function detailOf(entry: AdminAuditEntry) {
  const changes = Object.entries(entry.diff ?? {}).flatMap(([key, { from, to }]) => {
    const [before, after] = [show(from), show(to)];
    return before === undefined || after === undefined ? [] : [`${key.replaceAll('_', ' ')} ${before} → ${after}`];
  });
  return [entry.reason, ...changes].filter(Boolean).join('. ') || undefined;
}
