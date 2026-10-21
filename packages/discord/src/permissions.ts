// Channel permission computation, following Discord's documented algorithm:
// https://docs.discord.com/developers/topics/permissions#permission-overwrites

export const Permission = {
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  VIEW_AUDIT_LOG: 1n << 7n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
} as const;

export const ALL_PERMISSIONS = (1n << 64n) - 1n;

export interface Role {
  id: string;
  /** Discord serialises permissions as decimal strings in API v8+. */
  permissions: string;
}

export interface Overwrite {
  id: string;
  /** 0 = role, 1 = member */
  type: 0 | 1;
  allow: string;
  deny: string;
}

export interface MemberContext {
  userId: string;
  roleIds: string[];
  isGuildOwner?: boolean;
}

export function basePermissions(guildId: string, roles: Role[], member: MemberContext): bigint {
  if (member.isGuildOwner) return ALL_PERMISSIONS;
  const byId = new Map(roles.map((r) => [r.id, BigInt(r.permissions)]));
  let perms = byId.get(guildId) ?? 0n; // @everyone shares the guild's ID
  for (const id of member.roleIds) perms |= byId.get(id) ?? 0n;
  if ((perms & Permission.ADMINISTRATOR) === Permission.ADMINISTRATOR) return ALL_PERMISSIONS;
  return perms;
}

export function applyOverwrites(base: bigint, guildId: string, member: MemberContext, overwrites: Overwrite[]): bigint {
  if ((base & Permission.ADMINISTRATOR) === Permission.ADMINISTRATOR) return ALL_PERMISSIONS;
  const byId = new Map(overwrites.map((o) => [o.id, { allow: BigInt(o.allow), deny: BigInt(o.deny), type: o.type }]));
  let perms = base;

  const everyone = byId.get(guildId);
  if (everyone) {
    perms &= ~everyone.deny;
    perms |= everyone.allow;
  }

  let allow = 0n;
  let deny = 0n;
  for (const roleId of member.roleIds) {
    const o = byId.get(roleId);
    if (o && o.type === 0) {
      allow |= o.allow;
      deny |= o.deny;
    }
  }
  perms &= ~deny;
  perms |= allow;

  const own = byId.get(member.userId);
  if (own && own.type === 1) {
    perms &= ~own.deny;
    perms |= own.allow;
  }
  return perms;
}

export function channelPermissions(guildId: string, roles: Role[], member: MemberContext, overwrites: Overwrite[]): bigint {
  return applyOverwrites(basePermissions(guildId, roles, member), guildId, member, overwrites);
}

export function has(perms: bigint, flag: bigint): boolean {
  return (perms & flag) === flag;
}

/** Without VIEW_CHANNEL every other channel permission is implicitly denied. */
export function canView(perms: bigint): boolean {
  return has(perms, Permission.VIEW_CHANNEL);
}

export function canReadHistory(perms: bigint): boolean {
  return canView(perms) && has(perms, Permission.READ_MESSAGE_HISTORY);
}

export function canSend(perms: bigint): boolean {
  return canView(perms) && has(perms, Permission.SEND_MESSAGES);
}
