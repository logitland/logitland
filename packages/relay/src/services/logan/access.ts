import type { Owner } from '@logitland/contracts';
import { DiscordError, type GuildChannel, type GuildMember } from '@logitland/discord';
import type { Relay } from '../../context';
import { RelayError, forbidden, invalid, unavailable } from '../../errors';
import { adminStanding } from '../admins';
import { getOwner } from '../identity';
import {
  computeEffectivePermissions,
  getOperation,
  namesToBits,
  requiredPermissions,
  type OperationEntry,
  type PermissionGrant,
  type PermissionName,
  type RoleLike,
} from './catalog';

// Who may have Logan do what (the Logan admin MCP). Logan holds more permissions than most people, and Discord only checks
// Logan's, so the relay checks the person's own before every call, from scratch: their admin standing and roles fetched from
// Discord just now along with who owns the server, the server's roles from the Gateway, and the target channel fetched too. It follows the required-permissions
// table's own rules (packages/discord-catalog): a grant whose condition can't be verified doesn't hold, a condition that can't be
// decided is assumed to hold, and hierarchy is enforced here because Discord compares only Logan's roles. Anything this can't
// check is refused: stricter than Discord, never looser.

const SNOWFLAKE = /^\d{17,20}$/;
/** Discord's channel types the rules ask about. */
const THREAD_TYPES = new Set([10, 11, 12]);
const PRIVATE_THREAD = 12;
const VOICE_TYPES = new Set([2, 13]);
const FORUM_TYPES = new Set([15, 16]);
const TEXT_TYPES = new Set([0, 5]);
/** The message_reference type that forwards a message rather than replying to it. */
const FORWARD = 1;
/** Scheduled event entity types, by the names the table uses. */
const ENTITY_TYPES: Record<string, number> = { STAGE_INSTANCE: 1, VOICE: 2, EXTERNAL: 3 };
/** What a timed-out member keeps: Discord takes everything else until the timeout ends. */
const TIMED_OUT = namesToBits(['ViewChannel', 'ReadMessageHistory']);
const ALL = namesToBits(['Administrator']);

/** The person behind a call, as Discord sees them right now. */
export interface Caller {
  owner: Owner;
  guildId: string;
  member: GuildMember;
  isGuildOwner: boolean;
  guildOwnerId: string;
  /** The server's roles, as the Gateway reported them. */
  roles: RoleLike[];
  /** Their highest role's position; the server owner outranks everyone. */
  highest: number;
  /** Their server-wide permissions, with a timeout applied. */
  guildBits: bigint;
  timedOut: boolean;
}

/** What one call asks: the path parameters, the query and the JSON body. */
export interface CallInput {
  params: Record<string, string>;
  query: Record<string, string | number | boolean>;
  body?: unknown;
}

type Body = Record<string, unknown>;
const isObject = (v: unknown): v is Body => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Loads the person afresh, for every MCP call: they must still be in the server and hold the `logan` power (full admins hold
 * every power). Their roles come straight from Discord, not from the admin pages' one-minute cache.
 */
export async function loadCaller(relay: Relay, ownerId: string): Promise<Caller> {
  const guildId = relay.config.discord.guildId;
  if (!guildId) throw new RelayError(503, 'misconfigured', 'The relay has no Discord server configured (DISCORD_GUILD_ID).');
  const owner = await getOwner(relay, ownerId);
  let member: GuildMember;
  try {
    member = await relay.discord.getGuildMember(guildId, owner.discord_user_id);
  } catch (err) {
    if (err instanceof DiscordError && err.status === 404) throw forbidden('You aren’t in the server, so Logan can’t act for you.');
    throw unavailable('Discord can’t be reached to check your roles. Try again in a minute.', 60);
  }
  const standing = await adminStanding(relay, owner.discord_user_id, member.roles);
  if (!standing.permissions.includes('logan')) throw forbidden('Acting through Logan needs the logan admin power.');

  // Not cached: the owner holds every permission, so someone who hands the server over must lose that at once.
  const guildOwnerId = (await relay.discord.getGuild(guildId)).owner_id;
  const { results } = await relay.db.prepare('SELECT id, name, permissions, position FROM guild_roles WHERE guild_id = ?').bind(guildId).all<RoleLike>();
  const isGuildOwner = owner.discord_user_id === guildOwnerId;
  const held = new Set(member.roles);
  const highest = isGuildOwner ? Infinity : Math.max(0, ...results.filter((r) => held.has(r.id)).map((r) => r.position));
  const until = member.communication_disabled_until;
  const caller: Caller = {
    owner,
    guildId,
    member,
    isGuildOwner,
    guildOwnerId,
    roles: results,
    highest,
    guildBits: 0n,
    timedOut: Boolean(until && Date.parse(until) > relay.now().getTime()),
  };
  caller.guildBits = permissionsIn(caller);
  return caller;
}

/** The caller's permissions server-wide, or in a channel with these overwrites. A timeout leaves only viewing and reading. */
function permissionsIn(caller: Caller, overwrites?: GuildChannel['permission_overwrites']): bigint {
  const bits = BigInt(
    computeEffectivePermissions({
      guildId: caller.guildId,
      guildOwnerId: caller.guildOwnerId,
      memberId: caller.owner.discord_user_id,
      memberRoleIds: caller.member.roles,
      roles: caller.roles,
      ...(overwrites ? { overwrites } : {}),
    }).bits,
  );
  const exempt = caller.isGuildOwner || (bits & ALL) === ALL;
  return caller.timedOut && !exempt ? bits & TIMED_OUT : bits;
}

const holdsBits = (held: bigint, permissions: readonly PermissionName[]) => {
  const need = namesToBits([...permissions]);
  return (held & need) === need;
};

/* ---------- What Logan offers at all ---------- */

/**
 * Whether Logan offers an operation to anyone: one Logan can run with its bot token on this server or one of its channels,
 * not on Logan's own account (`@me`), and that Discord documents a permission for. Credentials are never offered.
 */
export function offered(op: OperationEntry): boolean {
  if (!op.auth.includes('bot') || op.risk === 'credential' || op.path.includes('@me')) return false;
  if (!op.pathParams.includes('guild_id') && !op.pathParams.includes('channel_id')) return false;
  if (op.requestBody && !op.requestBody.contentTypes.includes('application/json')) return false;
  return requiredPermissions(op.operationId).requires === 'any-of';
}

/**
 * Whether the caller could perform an operation somewhere in the server, for search: a base grant holds server-wide, or in at
 * least one channel the relay knows. The exact target, the body's conditions and the hierarchy are checked when it is called.
 */
export function performable(caller: Caller, op: OperationEntry, anyChannelBits: bigint): boolean {
  const entry = requiredPermissions(op.operationId);
  if (!offered(op) || entry.requires !== 'any-of') return false;
  return entry.anyOf.some((grant) => {
    if (grant.only !== undefined || !grant.scope) return false;
    if (grant.scope.level === 'guild') return holdsBits(caller.guildBits, grant.permissions);
    return channelLookup(grant) !== null && holdsBits(anyChannelBits, grant.permissions);
  });
}

/** Everything the caller may do in some channel the Gateway reported, or server-wide where no overwrite says otherwise. */
export async function anyChannelPermissions(relay: Relay, caller: Caller): Promise<bigint> {
  const { results } = await relay.db
    .prepare('SELECT overwrites FROM channels WHERE guild_id = ? AND hidden = 0 AND deleted_at IS NULL')
    .bind(caller.guildId)
    .all<{ overwrites: string }>();
  return results.reduce((bits, c) => bits | permissionsIn(caller, JSON.parse(c.overwrites)), permissionsIn(caller, []));
}

/* ---------- One call ---------- */

/** A call that passed: the path to send, filled in and with its query. */
export interface Checked {
  op: OperationEntry;
  path: string;
}

/** Where a channel grant's channel comes from: a path parameter, or a body field (`body channel_id`). Null: can't be found. */
function channelLookup(grant: PermissionGrant): { param: string } | { field: string } | null {
  if (!grant.scope) return null;
  if (grant.scope.pathParam) return { param: grant.scope.pathParam };
  const m = /^body (\w+)/.exec(grant.scope.lookup ?? '');
  return m ? { field: m[1]! } : null;
}

class CallCheck {
  private readonly channels = new Map<string, Promise<{ channel: GuildChannel; bits: bigint }>>();
  private readonly members = new Map<string, Promise<GuildMember | null>>();

  constructor(
    private readonly relay: Relay,
    private readonly caller: Caller,
    private readonly op: OperationEntry,
    private readonly input: CallInput,
  ) {}

  private get body(): Body {
    return isObject(this.input.body) ? this.input.body : {};
  }

  /** A channel in this server, and the caller's permissions there. A thread takes its parent's; a private one needs Manage Threads too. */
  channel(id: string): Promise<{ channel: GuildChannel; bits: bigint }> {
    let found = this.channels.get(id);
    if (!found) {
      found = this.fetchChannel(id);
      this.channels.set(id, found);
    }
    return found;
  }

  private async fetchChannel(id: string): Promise<{ channel: GuildChannel; bits: bigint }> {
    if (!SNOWFLAKE.test(id)) throw invalid(`${id} isn’t a channel ID.`);
    const get = async (channelId: string) => {
      try {
        return await this.relay.discord.getChannel(channelId);
      } catch (err) {
        if (err instanceof DiscordError && (err.status === 404 || err.status === 403)) throw forbidden('Logan can’t see that channel.');
        throw err;
      }
    };
    const channel = await get(id);
    if (channel.guild_id !== this.caller.guildId) throw forbidden('That channel isn’t in this server. Logan only acts here.');
    if (!THREAD_TYPES.has(channel.type)) return { channel, bits: permissionsIn(this.caller, channel.permission_overwrites ?? []) };
    const parent = await get(channel.parent_id ?? '');
    const bits = permissionsIn(this.caller, parent.permission_overwrites ?? []);
    const seesPrivate = holdsBits(bits, ['ViewChannel', 'ManageThreads']);
    return { channel, bits: channel.type === PRIVATE_THREAD && !seesPrivate ? 0n : bits };
  }

  /** A member of the server, or null for someone who isn't one. */
  member(id: string): Promise<GuildMember | null> {
    let found = this.members.get(id);
    if (!found) {
      if (!SNOWFLAKE.test(id)) throw invalid(`${id} isn’t a user ID.`);
      found = this.relay.discord.getGuildMember(this.caller.guildId, id).catch((err) => {
        if (err instanceof DiscordError && err.status === 404) return null;
        throw err;
      });
      this.members.set(id, found);
    }
    return found;
  }

  private async grantHolds(grant: PermissionGrant): Promise<boolean> {
    if (grant.only !== undefined || !grant.scope) return false;
    if (grant.scope.level === 'guild') {
      // Guild grants name the guild by path parameter or as "the channel's guild": this server either way, checked before.
      return (grant.scope.pathParam === 'guild_id' || grant.scope.lookup === "the channel's guild") && holdsBits(this.caller.guildBits, grant.permissions);
    }
    const where = channelLookup(grant);
    const id = where === null ? undefined : 'param' in where ? this.input.params[where.param] : this.body[where.field];
    if (typeof id !== 'string') return false;
    return holdsBits((await this.channel(id)).bits, grant.permissions);
  }

  private async anyHolds(grants: readonly PermissionGrant[]): Promise<boolean> {
    for (const grant of grants) if (await this.grantHolds(grant)) return true;
    return false;
  }

  /** The target channel's type, when the path names one. */
  private async channelType(): Promise<number | undefined> {
    const id = this.input.params.channel_id;
    return id ? (await this.channel(id)).channel.type : undefined;
  }

  /**
   * Whether a conditional requirement's `when` holds for this request. Undefined when it can't be told from the request, which
   * the table says to treat as holding.
   */
  private async decide(when: string): Promise<boolean | undefined> {
    const body = this.body;
    let m: RegExpExecArray | null;
    if ((m = /^the body sets (\w+) to true$/.exec(when))) return body[m[1]!] === true;
    if ((m = /^the body sets (\w+) to a channel$/.exec(when))) return typeof body[m[1]!] === 'string';
    if ((m = /^the body sets (\w+) to null$/.exec(when))) return body[m[1]!] === null;
    if ((m = /^the body sets (\w+)$/.exec(when))) return body[m[1]!] !== undefined;
    if ((m = /^an entry (?:changes|sets) (\w+)$/.exec(when)))
      return Array.isArray(this.input.body) && this.input.body.some((e) => isObject(e) && e[m![1]!] !== undefined);
    if ((m = /^body entity_type is (\w+)$/.exec(when))) return body.entity_type === ENTITY_TYPES[m[1]!];
    if (when === 'the body replies to a message (message_reference)') return body.message_reference !== undefined;
    if (when === 'the body attaches files') return body.attachments !== undefined;
    if (when === 'the body includes a poll') return body.poll !== undefined;
    if (when === 'body message includes a poll') return isObject(body.message) && body.message.poll !== undefined;
    if (when === 'sticker_ids include stickers from another guild') return Array.isArray(body.sticker_ids) && body.sticker_ids.length ? undefined : false;
    if (/mentions? @everyone, @here, or a role/.test(when)) return mayMentionEveryone(this.input.body);
    if (when === 'body permission_overwrites allow or deny ManageRoles') {
      const manageRoles = namesToBits(['ManageRoles']);
      return overwriteValues(body.permission_overwrites)?.some((v) => (v & manageRoles) !== 0n);
    }
    if (when.startsWith('channel_id is')) {
      const type = await this.channelType();
      if (type === undefined) return undefined;
      if (when === 'channel_id is a thread') return THREAD_TYPES.has(type);
      if (when === 'channel_id is not a thread') return !THREAD_TYPES.has(type);
      if (when === 'channel_id is a voice channel') return VOICE_TYPES.has(type);
      if (when === 'channel_id is a forum or media channel') return FORUM_TYPES.has(type);
      if (when.endsWith('body type is PRIVATE_THREAD or omitted')) return TEXT_TYPES.has(type) && (body.type === undefined || body.type === PRIVATE_THREAD);
      if (when.endsWith('body type is PUBLIC_THREAD or ANNOUNCEMENT_THREAD')) return TEXT_TYPES.has(type) && (body.type === 10 || body.type === 11);
    }
    return undefined;
  }

  /** Why a hierarchy rule refuses this call, or null when it allows it. */
  private async hierarchyProblem(rule: string, target: string): Promise<string | null> {
    const { caller, input, body } = this;
    if (caller.isGuildOwner) return null;
    if (rule === 'held-permissions-only') {
      const values =
        target === 'body permissions'
          ? body.permissions === undefined
            ? []
            : overwriteValues([{ allow: body.permissions, deny: '0' }])
          : target === 'body allow and deny'
            ? overwriteValues([{ allow: body.allow ?? '0', deny: body.deny ?? '0' }])
            : target === 'body permission_overwrites'
              ? body.permission_overwrites === undefined
                ? []
                : overwriteValues(body.permission_overwrites)
              : undefined;
      if (values === undefined) return 'Logan can’t check which permissions this grants, so it won’t.';
      const held = input.params.channel_id ? (await this.channel(input.params.channel_id)).bits : caller.guildBits;
      if ((held & ALL) === ALL) return null;
      return values.some((v) => (v & ~held) !== 0n) ? 'You can only allow or deny permissions you hold yourself.' : null;
    }
    if (rule === 'role-below') {
      let ids: unknown[];
      if (target === 'role_id') ids = [input.params.role_id];
      else if (target === 'body roles') ids = Array.isArray(body.roles) ? body.roles : [];
      else if (target === 'each role added to or removed from body roles') {
        if (!Array.isArray(body.roles)) ids = [];
        else {
          const now = new Set((await this.member(input.params.user_id ?? ''))?.roles ?? []);
          const next = new Set(body.roles);
          ids = [...[...next].filter((r) => !now.has(r as string)), ...[...now].filter((r) => !next.has(r))];
        }
      } else if (target === 'each role in the body, at its old and new position') {
        if (!Array.isArray(this.input.body)) return 'Send the roles to move as a list.';
        for (const entry of this.input.body) {
          if (!isObject(entry)) return 'Send each role as { id, position }.';
          const problem =
            this.roleProblem(entry.id) ??
            (typeof entry.position === 'number' && entry.position >= caller.highest ? 'You can only move roles to below your highest role.' : null);
          if (problem) return problem;
        }
        return null;
      } else return 'Logan can’t check which roles this changes, so it won’t.';
      for (const id of ids) {
        const problem = this.roleProblem(id);
        if (problem) return problem;
      }
      return null;
    }
    if (rule === 'member-below') {
      const ids = target.startsWith('user_id')
        ? [input.params.user_id]
        : target === 'each body user_ids entry that is a member' && Array.isArray(body.user_ids)
          ? body.user_ids
          : null;
      if (!ids) return 'Logan can’t check who this acts on, so it won’t.';
      for (const id of ids) {
        if (typeof id !== 'string') return 'User IDs must be strings.';
        if (id === caller.guildOwnerId) return 'Nobody can do that to the server owner.';
        const member = await this.member(id);
        if (!member) continue;
        if (this.highestOf(member.roles) >= caller.highest) return 'They have a role at or above your highest role.';
      }
      return null;
    }
    return 'Logan can’t check this rule, so it won’t.';
  }

  private highestOf(roleIds: string[]): number {
    const held = new Set(roleIds);
    return Math.max(0, ...this.caller.roles.filter((r) => held.has(r.id)).map((r) => r.position));
  }

  private roleProblem(id: unknown): string | null {
    const role = this.caller.roles.find((r) => r.id === id);
    if (!role) return `There’s no role ${String(id)} in the server.`;
    return role.position >= this.caller.highest ? `${role.name} is at or above your highest role.` : null;
  }

  /** Throws the reason the call is refused; answers the path to send. */
  async run(): Promise<Checked> {
    const { op, input, caller } = this;
    if (!offered(op)) throw forbidden(`Logan doesn’t offer ${op.operationId}.`);
    for (const name of op.pathParams) {
      const value = input.params[name];
      if (typeof value !== 'string' || !value) throw invalid(`Send params.${name}.`);
      if (name.endsWith('_id') ? !SNOWFLAKE.test(value) : value.length > 100 || /[/?#]|^\.\.?$/.test(value)) throw invalid(`params.${name} isn’t valid.`);
    }
    if (input.params.guild_id !== undefined && input.params.guild_id !== caller.guildId) throw forbidden('Logan only acts in this server.');
    if (input.params.channel_id) await this.channel(input.params.channel_id);
    const unknownQuery = Object.keys(input.query).filter((k) => !op.queryParams.includes(k));
    if (unknownQuery.length) throw invalid(`${op.operationId} takes no query ${unknownQuery.join(', ')}.`);
    for (const k of op.requiredQuery) if (input.query[k] === undefined) throw invalid(`Send query.${k}.`);
    if (!op.requestBody && input.body !== undefined) throw invalid(`${op.operationId} takes no body.`);
    if (op.requestBody?.required && input.body === undefined) throw invalid(`${op.operationId} needs a body.`);

    const entry = requiredPermissions(op.operationId);
    if (entry.requires !== 'any-of') throw forbidden(`Logan doesn’t offer ${op.operationId}.`);
    if (!(await this.anyHolds(entry.anyOf))) throw forbidden(`You don’t have the permissions ${op.operationId} needs here.`);
    for (const c of entry.conditional ?? []) {
      if ((await this.decide(c.when)) === false) continue;
      if (!(await this.anyHolds(c.anyOf))) throw forbidden(`You don’t have the permissions ${op.operationId} needs when ${c.when}.`);
    }
    // Discord forwards any message Logan can read, so the source channel is checked as the caller, like a target.
    const ref = this.body.message_reference;
    if (isObject(ref) && ref.type === FORWARD) {
      if (typeof ref.channel_id !== 'string') throw invalid('Send message_reference.channel_id to forward a message.');
      if (!holdsBits((await this.channel(ref.channel_id)).bits, ['ViewChannel', 'ReadMessageHistory']))
        throw forbidden('You can’t read the message you asked Logan to forward.');
    }
    for (const h of entry.hierarchy ?? []) {
      const problem = await this.hierarchyProblem(h.rule, h.target);
      if (problem) throw forbidden(problem);
    }
    const query = new URLSearchParams(Object.entries(input.query).map(([k, v]) => [k, String(v)])).toString();
    const path = op.path.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(input.params[name]!));
    return { op, path: query ? `${path}?${query}` : path };
  }

  /** The caller's permissions in each channel, for filtering what Logan read server-wide down to what the caller may see. */
  channelBits(channel: GuildChannel, parents: Map<string, GuildChannel>): bigint {
    if (!THREAD_TYPES.has(channel.type)) return permissionsIn(this.caller, channel.permission_overwrites ?? []);
    const parent = parents.get(channel.parent_id ?? '');
    if (!parent) return 0n;
    const bits = permissionsIn(this.caller, parent.permission_overwrites ?? []);
    return channel.type === PRIVATE_THREAD && !holdsBits(bits, ['ViewChannel', 'ManageThreads']) ? 0n : bits;
  }
}

/** Overwrite-like entries' allow and deny as bits; undefined when any isn't a permission bitfield. */
function overwriteValues(list: unknown): bigint[] | undefined {
  if (!Array.isArray(list)) return undefined;
  const out: bigint[] = [];
  for (const o of list) {
    if (!isObject(o)) return undefined;
    for (const v of [o.allow ?? '0', o.deny ?? '0']) {
      if ((typeof v !== 'string' && typeof v !== 'number') || !/^\d+$/.test(String(v))) return undefined;
      out.push(BigInt(v));
    }
  }
  return out;
}

/**
 * Whether a message body could ping @everyone, @here or a role: its text mentions one, and allowed_mentions (when set) doesn't
 * rule it out. Without allowed_mentions Discord parses every mention.
 */
function mayMentionEveryone(body: unknown): boolean {
  const text = JSON.stringify(body ?? {});
  if (!/@everyone|@here|<@&\d+>/.test(text)) return false;
  const holder = isObject(body) && isObject(body.message) ? body.message : body;
  const allowed = isObject(holder) ? holder.allowed_mentions : undefined;
  if (!isObject(allowed) || !Array.isArray(allowed.parse)) return true;
  const roles = Array.isArray(allowed.roles) && allowed.roles.length > 0;
  return allowed.parse.includes('everyone') || allowed.parse.includes('roles') || roles;
}

/** Checks one call for the caller and answers the path to send; throws a 400 or 403 with the reason otherwise. */
export function checkCall(relay: Relay, caller: Caller, operationId: string, input: CallInput): Promise<Checked> {
  const op = getOperation(operationId);
  if (!op) throw invalid(`There’s no operation ${operationId}. Find one with search_operations.`);
  return new CallCheck(relay, caller, op, input).run();
}

/** Operations whose answer spans channels, which Logan reads as itself: trimmed to what the caller may see. */
const SPANS_CHANNELS = new Set(['list_guild_channels', 'get_active_guild_threads', 'guild_search']);

/**
 * Discord answers server-wide reads with everything Logan can see. These drop what the caller couldn't see themselves:
 * channels they can't view, threads in them, and search results they couldn't read.
 */
export async function filterAnswer(relay: Relay, caller: Caller, operationId: string, answer: unknown): Promise<unknown> {
  if (!SPANS_CHANNELS.has(operationId)) return answer;
  const check = new CallCheck(relay, caller, getOperation(operationId)!, { params: {}, query: {} });
  const view = namesToBits(['ViewChannel']);
  const read = namesToBits(['ViewChannel', 'ReadMessageHistory']);
  if (operationId === 'list_guild_channels') {
    const channels = Array.isArray(answer) ? (answer as GuildChannel[]) : [];
    return channels.filter((c) => (check.channelBits(c, new Map()) & view) === view);
  }
  const parents = new Map((await relay.discord.getGuildChannels(caller.guildId)).map((c) => [c.id, c]));
  if (!isObject(answer)) return answer;
  const threads = Array.isArray(answer.threads) ? (answer.threads as GuildChannel[]) : [];
  for (const t of threads) if (!parents.has(t.id)) parents.set(t.id, t);
  const bitsOf = (id: unknown) => {
    const channel = parents.get(String(id));
    return channel ? check.channelBits(channel, parents) : 0n;
  };
  const visibleThreads = threads.filter((t) => (bitsOf(t.id) & view) === view);
  const ids = new Set(visibleThreads.map((t) => t.id));
  const members = Array.isArray(answer.members) ? answer.members.filter((m) => isObject(m) && (m.id === undefined || ids.has(String(m.id)))) : answer.members;
  if (operationId === 'get_active_guild_threads') return { ...answer, threads: visibleThreads, members };
  const messages = Array.isArray(answer.messages)
    ? answer.messages.filter((group) => {
        const first: unknown = Array.isArray(group) ? group[0] : group;
        return isObject(first) && (bitsOf(first.channel_id) & read) === read;
      })
    : answer.messages;
  return { ...answer, messages, threads: visibleThreads, members };
}
