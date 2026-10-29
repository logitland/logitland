// The fake's Discord: guilds, channels, roles, members, webhooks and messages, with every change that Discord
// would announce on the Gateway passed to `emit`. The REST handlers, the control API and the tests all go through it.

import { compareSnowflakes } from './ids.ts';
import {
  ALL_BOT_PERMISSIONS,
  ChannelType,
  MessageFlag,
  MessageType,
  Permission,
  errors,
  isForum,
  isThread,
  type ApplicationCommand,
  type ApplicationEmoji,
  type Channel,
  type ChannelKind,
  type DmChannel,
  type Emit,
  type ForumTag,
  type Guild,
  type Member,
  type Message,
  type Poll,
  type Role,
  type ThreadMetadata,
  type User,
  type Webhook,
} from './model.ts';

export interface WorldOptions {
  now: () => number;
  ids: () => string;
  emit: Emit;
  botUser: User;
}

export interface AllowedMentions {
  parse?: string[];
  users?: string[];
  roles?: string[];
  replied_user?: boolean;
}

export interface NewMessage {
  id?: string;
  author: User;
  content?: string;
  webhook_id?: string;
  application_id?: string;
  type?: number;
  components?: unknown[];
  embeds?: unknown[];
  poll?: Poll;
  message_reference?: Message['message_reference'];
  allowed_mentions?: AllowedMentions;
  flags?: number;
  tts?: boolean;
  /** The first message of a thread: it doesn't count towards message_count. */
  starter?: boolean;
}

export interface NewChannel {
  id?: string;
  name: string;
  kind?: ChannelKind | number;
  parentId?: string | null;
  topic?: string | null;
  position?: number;
  /** Who may do what here, on top of their roles. */
  overwrites?: { id: string; type?: 'role' | 'member'; allow?: bigint; deny?: bigint }[];
  /** Forum and media channels. Each tag gets an ID unless one is given. */
  tags?: { id?: string; name: string; moderated?: boolean; emoji_name?: string | null }[];
}

const KIND_TYPE: Record<ChannelKind, number> = {
  text: ChannelType.text,
  announcement: ChannelType.announcement,
  forum: ChannelType.forum,
  media: ChannelType.media,
  category: ChannelType.category,
  voice: ChannelType.voice,
};

const ARCHIVE_DURATIONS = [60, 1440, 4320, 10080];

export class World {
  readonly guilds = new Map<string, Guild>();
  readonly channels = new Map<string, Channel>();
  readonly users = new Map<string, User>();
  readonly webhooks = new Map<string, Webhook>();
  readonly messages = new Map<string, Message[]>();
  readonly commands = new Map<string, ApplicationCommand[]>();
  /** Who has joined or been added to each thread, by user ID. Its creator is the first. */
  readonly threadMembers = new Map<string, Set<string>>();
  /** The bot's DM channels, by channel ID. Their messages are in `messages` like any channel's. */
  readonly dms = new Map<string, DmChannel>();
  /** People who take no DMs from the bot: posting to them fails with 50007. */
  readonly closedDms = new Set<string>();
  /** The application's emoji. */
  readonly emojis: ApplicationEmoji[] = [];
  readonly botUser: User;
  private readonly now: () => number;
  private readonly ids: () => string;
  private readonly emit: Emit;

  constructor(opts: WorldOptions) {
    this.now = opts.now;
    this.ids = opts.ids;
    this.emit = opts.emit;
    this.botUser = opts.botUser;
    this.users.set(opts.botUser.id, opts.botUser);
  }

  iso(): string {
    return new Date(this.now()).toISOString();
  }

  newId(): string {
    return this.ids();
  }

  /* ---------- Seeding ---------- */

  addUser(u: { id?: string; username: string; global_name?: string | null; bot?: boolean }): User {
    const id = u.id ?? this.ids();
    const existing = this.users.get(id);
    if (existing) return existing;
    const user: User = {
      id,
      username: u.username,
      discriminator: '0',
      global_name: u.global_name ?? null,
      avatar: null,
      ...(u.bot ? { bot: true } : {}),
      public_flags: 0,
    };
    this.users.set(id, user);
    return user;
  }

  /**
   * A guild with an @everyone role, a bot role and the bot as a member. The bot role is at position 10 and holds
   * `botPermissions` (everything the relay needs by default), so roles added later sit below it unless placed higher.
   */
  addGuild(g: { id?: string; name?: string; ownerId?: string; botPermissions?: bigint } = {}): Guild {
    const id = g.id ?? this.ids();
    const owner = g.ownerId ? (this.users.get(g.ownerId) ?? this.addUser({ id: g.ownerId, username: 'owner' })) : this.addUser({ username: 'guild-owner' });
    const everyone = Permission.viewChannel | Permission.sendMessages | Permission.readMessageHistory;
    const botRoleId = this.ids();
    const guild: Guild = {
      id,
      name: g.name ?? 'Test server',
      owner_id: owner.id,
      everyoneRoleId: id,
      botRoleId,
      roles: new Map(),
      members: new Map(),
      channelIds: new Set(),
      createdAt: this.iso(),
    };
    guild.roles.set(id, this.makeRole(id, { name: '@everyone', permissions: everyone, position: 0 }));
    guild.roles.set(botRoleId, this.makeRole(botRoleId, { name: 'Relay', permissions: g.botPermissions ?? ALL_BOT_PERMISSIONS, position: 10, managed: true }));
    this.guilds.set(id, guild);
    this.addMember(id, { id: owner.id, username: owner.username });
    this.addMember(id, { id: this.botUser.id, username: this.botUser.username, bot: true, roles: [botRoleId] });
    return guild;
  }

  guild(id: string): Guild {
    const g = this.guilds.get(id);
    if (!g) throw errors.unknownGuild();
    return g;
  }

  private makeRole(
    id: string,
    r: { name: string; permissions?: bigint; position?: number; color?: number; hoist?: boolean; managed?: boolean; mentionable?: boolean },
  ): Role {
    return {
      id,
      name: r.name,
      description: null,
      color: r.color ?? 0,
      hoist: r.hoist ?? false,
      position: r.position ?? 1,
      permissions: String(r.permissions ?? 0n),
      managed: r.managed ?? false,
      mentionable: r.mentionable ?? false,
      flags: 0,
      icon: null,
      unicode_emoji: null,
    };
  }

  addRole(
    guildId: string,
    r: { id?: string; name: string; permissions?: bigint; position?: number; color?: number; hoist?: boolean; mentionable?: boolean },
  ): Role {
    const guild = this.guild(guildId);
    const role = this.makeRole(r.id ?? this.ids(), r);
    guild.roles.set(role.id, role);
    this.emit(guildId, 'GUILD_ROLE_CREATE', { guild_id: guildId, role });
    return role;
  }

  addMember(
    guildId: string,
    m: { id?: string; username?: string; global_name?: string | null; bot?: boolean; roles?: string[]; nick?: string | null },
  ): Member {
    const guild = this.guild(guildId);
    const user = this.addUser({
      id: m.id,
      username: m.username ?? `user-${(m.id ?? '').slice(-4) || this.users.size}`,
      global_name: m.global_name,
      bot: m.bot,
    });
    const existing = guild.members.get(user.id);
    if (existing) return existing;
    const roles = m.roles ?? [];
    for (const r of roles) if (!guild.roles.has(r)) throw errors.unknownRole();
    const member: Member = {
      user,
      nick: m.nick ?? null,
      avatar: null,
      roles,
      joined_at: this.iso(),
      premium_since: null,
      deaf: false,
      mute: false,
      flags: 0,
      pending: false,
      communication_disabled_until: null,
    };
    guild.members.set(user.id, member);
    return member;
  }

  addChannel(guildId: string, c: NewChannel): Channel {
    const guild = this.guild(guildId);
    const type = typeof c.kind === 'number' ? c.kind : KIND_TYPE[c.kind ?? 'text'];
    const channel: Channel = {
      id: c.id ?? this.ids(),
      type,
      guild_id: guildId,
      name: c.name,
      position: c.position ?? guild.channelIds.size,
      parent_id: c.parentId ?? null,
      topic: c.topic ?? null,
      nsfw: false,
      last_message_id: null,
      rate_limit_per_user: 0,
      permission_overwrites: (c.overwrites ?? []).map((o) => ({
        id: o.id,
        type: o.type === 'member' ? 1 : 0,
        allow: String(o.allow ?? 0n),
        deny: String(o.deny ?? 0n),
      })),
      flags: 0,
    };
    if (isForum(type)) {
      channel.available_tags = (c.tags ?? []).map((t): ForumTag => ({
        id: t.id ?? this.ids(),
        name: t.name,
        moderated: t.moderated ?? false,
        emoji_id: null,
        emoji_name: t.emoji_name ?? null,
      }));
      channel.default_auto_archive_duration = 1440;
    }
    this.channels.set(channel.id, channel);
    guild.channelIds.add(channel.id);
    this.emit(guildId, 'CHANNEL_CREATE', { ...channel });
    return channel;
  }

  channel(id: string): Channel {
    const c = this.channels.get(id);
    if (!c) throw errors.unknownChannel();
    return c;
  }

  /** Changes a channel's overwrites, slowmode or flags, as an admin would in Discord, and announces CHANNEL_UPDATE. */
  updateChannel(id: string, patch: { overwrites?: NewChannel['overwrites']; slowmode?: number; flags?: number; name?: string }): Channel {
    const channel = this.channel(id);
    if (patch.overwrites)
      channel.permission_overwrites = patch.overwrites.map((o) => ({
        id: o.id,
        type: o.type === 'member' ? 1 : 0,
        allow: String(o.allow ?? 0n),
        deny: String(o.deny ?? 0n),
      }));
    if (patch.slowmode !== undefined) channel.rate_limit_per_user = patch.slowmode;
    if (patch.flags !== undefined) channel.flags = patch.flags;
    if (patch.name !== undefined) channel.name = patch.name;
    this.emit(channel.guild_id!, 'CHANNEL_UPDATE', { ...channel });
    return channel;
  }

  /** Deletes a channel and announces CHANNEL_DELETE. */
  deleteChannel(id: string): void {
    const channel = this.channel(id);
    this.channels.delete(id);
    this.guild(channel.guild_id!).channelIds.delete(id);
    this.emit(channel.guild_id!, 'CHANNEL_DELETE', { ...channel });
  }

  addWebhook(channelId: string, w: { id?: string; token?: string; name?: string } = {}): Webhook {
    const channel = this.channel(channelId);
    const webhook: Webhook = {
      id: w.id ?? this.ids(),
      type: 1,
      guild_id: channel.guild_id,
      channel_id: channelId,
      name: w.name ?? 'Logitland',
      avatar: null,
      token: w.token ?? randomToken(),
      application_id: null,
    };
    this.webhooks.set(webhook.id, webhook);
    return webhook;
  }

  /* ---------- Permissions ---------- */

  /** Guild-wide permissions: owner and administrators can do anything; others get the union of their roles. */
  permissionsOf(guildId: string, userId: string): bigint {
    const guild = this.guild(guildId);
    if (guild.owner_id === userId) return (1n << 50n) - 1n;
    const member = guild.members.get(userId);
    if (!member) return 0n;
    let bits = BigInt(guild.roles.get(guild.everyoneRoleId)?.permissions ?? 0);
    for (const id of member.roles) bits |= BigInt(guild.roles.get(id)?.permissions ?? 0);
    return bits & Permission.administrator ? (1n << 50n) - 1n : bits;
  }

  can(guildId: string, userId: string, permission: bigint): boolean {
    return (this.permissionsOf(guildId, userId) & permission) === permission;
  }

  /**
   * What a member may do in a channel: their guild permissions, then the channel's overwrites in Discord's order
   * (@everyone, then the member's roles together, then the member). Threads use their parent's overwrites.
   * https://docs.discord.com/developers/topics/permissions#permission-overwrites
   */
  channelPermissions(channelId: string, userId: string): bigint {
    const channel = this.channel(channelId);
    const guild = this.guild(channel.guild_id);
    const base = this.permissionsOf(guild.id, userId);
    if (base & Permission.administrator || guild.owner_id === userId) return (1n << 50n) - 1n;
    const parent = isThread(channel.type) && channel.parent_id ? this.channels.get(channel.parent_id) : channel;
    const overwrites = parent?.permission_overwrites ?? [];
    const member = guild.members.get(userId);
    let bits = base;
    const everyone = overwrites.find((o) => o.type === 0 && o.id === guild.everyoneRoleId);
    if (everyone) bits = (bits & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
    let deny = 0n;
    let allow = 0n;
    for (const o of overwrites) {
      if (o.type === 0 && o.id !== guild.everyoneRoleId && member?.roles.includes(o.id)) {
        deny |= BigInt(o.deny);
        allow |= BigInt(o.allow);
      }
    }
    bits = (bits & ~deny) | allow;
    const own = overwrites.find((o) => o.type === 1 && o.id === userId);
    if (own) bits = (bits & ~BigInt(own.deny)) | BigInt(own.allow);
    // A private thread shows only to its members and to those with Manage Threads.
    // https://docs.discord.com/developers/topics/threads#permissions
    if (channel.type === ChannelType.privateThread && !(bits & Permission.manageThreads) && !this.threadMembers.get(channel.id)?.has(userId)) return 0n;
    // Without View Channel nothing else applies.
    return bits & Permission.viewChannel ? bits : 0n;
  }

  canInChannel(channelId: string, userId: string, permission: bigint): boolean {
    return (this.channelPermissions(channelId, userId) & permission) === permission;
  }

  /** The position of a member's highest role: what the role hierarchy compares. */
  topPosition(guildId: string, userId: string): number {
    const guild = this.guild(guildId);
    const member = guild.members.get(userId);
    return Math.max(0, ...(member?.roles ?? []).map((id) => guild.roles.get(id)?.position ?? 0));
  }

  setMemberRole(guildId: string, userId: string, roleId: string, on: boolean): void {
    const guild = this.guild(guildId);
    const member = guild.members.get(userId);
    if (!member) throw errors.unknownMember();
    if (!guild.roles.has(roleId)) throw errors.unknownRole();
    const has = member.roles.includes(roleId);
    if (on === has) return;
    member.roles = on ? [...member.roles, roleId] : member.roles.filter((r) => r !== roleId);
    this.emit(guildId, 'GUILD_MEMBER_UPDATE', {
      guild_id: guildId,
      roles: member.roles,
      user: member.user,
      nick: member.nick,
      avatar: member.avatar,
      banner: null,
      joined_at: member.joined_at,
      premium_since: member.premium_since,
      deaf: member.deaf,
      mute: member.mute,
      pending: member.pending,
      communication_disabled_until: member.communication_disabled_until,
      flags: member.flags,
    });
  }

  /* ---------- Messages ---------- */

  /** The bot's DM channel with a user, opened the first time. */
  openDm(userId: string): DmChannel {
    for (const dm of this.dms.values()) if (dm.recipients[0]!.id === userId) return dm;
    const user = this.users.get(userId);
    if (!user || user.id === this.botUser.id) throw errors.invalidRecipient();
    const dm: DmChannel = { id: this.ids(), type: 1, last_message_id: null, recipients: [user] };
    this.dms.set(dm.id, dm);
    return dm;
  }

  /** A message from the bot in a DM. No Gateway event: the relay asks for no DM intents. */
  postDm(channelId: string, input: Pick<NewMessage, 'author' | 'content' | 'components' | 'flags' | 'application_id'>): Message {
    const dm = this.dms.get(channelId);
    if (!dm) throw errors.unknownChannel();
    if (this.closedDms.has(dm.recipients[0]!.id)) throw errors.cannotMessageUser();
    const message: Message = {
      id: this.ids(),
      channel_id: dm.id,
      author: input.author,
      content: input.content ?? '',
      timestamp: this.iso(),
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [],
      embeds: [],
      pinned: false,
      type: MessageType.default,
      flags: input.flags ?? 0,
      components: input.components ?? [],
      ...(input.application_id ? { application_id: input.application_id } : {}),
    };
    this.messagesIn(dm.id).push(message);
    dm.last_message_id = message.id;
    return message;
  }

  messagesIn(channelId: string): Message[] {
    let list = this.messages.get(channelId);
    if (!list) this.messages.set(channelId, (list = []));
    return list;
  }

  findMessage(channelId: string, id: string): Message {
    const m = this.messagesIn(channelId).find((x) => x.id === id);
    if (!m) throw errors.unknownMessage();
    return m;
  }

  private mentionsOf(content: string, allowed: AllowedMentions | undefined): { users: User[]; roles: string[]; everyone: boolean } {
    const parse = allowed ? new Set(allowed.parse ?? []) : null;
    const users: User[] = [];
    for (const m of content.matchAll(/<@!?(\d{17,20})>/g)) {
      const id = m[1]!;
      const user = this.users.get(id);
      if (user && (parse === null || parse.has('users') || allowed?.users?.includes(id)) && !users.some((u) => u.id === id)) users.push(user);
    }
    const roles: string[] = [];
    for (const m of content.matchAll(/<@&(\d{17,20})>/g)) {
      const id = m[1]!;
      if ((parse === null || parse.has('roles') || allowed?.roles?.includes(id)) && !roles.includes(id)) roles.push(id);
    }
    const everyone = /@(everyone|here)\b/.test(content) && (parse === null || parse.has('everyone'));
    return { users, roles, everyone };
  }

  /** The Gateway form of a message: the REST form plus guild_id, the author's member and channel_type. */
  gatewayMessage(m: Message): Record<string, unknown> {
    const channel = this.channels.get(m.channel_id);
    const guildId = channel?.guild_id;
    const member = guildId ? this.guilds.get(guildId)?.members.get(m.author.id) : undefined;
    const partial = member ? (({ user: _user, ...rest }) => rest)(member) : undefined;
    return { ...m, ...(guildId ? { guild_id: guildId } : {}), ...(partial ? { member: partial } : {}), ...(channel ? { channel_type: channel.type } : {}) };
  }

  postMessage(channelId: string, input: NewMessage): Message {
    const channel = this.channel(channelId);
    const content = input.content ?? '';
    const mentions = this.mentionsOf(content, input.allowed_mentions);
    const message: Message = {
      id: input.id ?? this.ids(),
      channel_id: channelId,
      author: input.author,
      content,
      timestamp: this.iso(),
      edited_timestamp: null,
      tts: input.tts ?? false,
      mention_everyone: mentions.everyone,
      mentions: mentions.users,
      mention_roles: mentions.roles,
      attachments: [],
      embeds: input.embeds ?? [],
      pinned: false,
      type: input.type ?? (input.message_reference ? MessageType.reply : MessageType.default),
      flags: input.flags ?? 0,
      components: input.components ?? [],
      ...(input.webhook_id ? { webhook_id: input.webhook_id } : {}),
      ...(input.application_id ? { application_id: input.application_id } : {}),
      ...(input.message_reference ? { message_reference: input.message_reference } : {}),
      ...(input.poll ? { poll: input.poll } : {}),
    };
    this.messagesIn(channelId).push(message);
    channel.last_message_id = message.id;
    if (isThread(channel.type)) {
      channel.total_message_sent = (channel.total_message_sent ?? 0) + 1;
      if (!input.starter) channel.message_count = (channel.message_count ?? 0) + 1;
    }
    this.emit(channel.guild_id, 'MESSAGE_CREATE', this.gatewayMessage(message));
    return message;
  }

  editMessage(channelId: string, id: string, patch: { content?: string; components?: unknown[]; embeds?: unknown[] }): Message {
    const channel = this.channel(channelId);
    const message = this.findMessage(channelId, id);
    if (patch.content !== undefined) {
      message.content = patch.content;
      // Mentions are rebuilt from the new text; an edit never pings anyone.
      const m = this.mentionsOf(patch.content, { parse: [] });
      message.mentions = m.users;
      message.mention_roles = m.roles;
      message.mention_everyone = m.everyone;
    }
    if (patch.components !== undefined) message.components = patch.components;
    if (patch.embeds !== undefined) message.embeds = patch.embeds;
    message.edited_timestamp = this.iso();
    this.emit(channel.guild_id, 'MESSAGE_UPDATE', this.gatewayMessage(message));
    return message;
  }

  deleteMessage(channelId: string, id: string): void {
    const channel = this.channel(channelId);
    const list = this.messagesIn(channelId);
    const at = list.findIndex((m) => m.id === id);
    if (at < 0) throw errors.unknownMessage();
    list.splice(at, 1);
    this.emit(channel.guild_id, 'MESSAGE_DELETE', { id, channel_id: channelId, guild_id: channel.guild_id });
  }

  deleteMessages(channelId: string, ids: string[]): void {
    const channel = this.channel(channelId);
    const list = this.messagesIn(channelId);
    const gone = new Set(ids);
    const known = list.filter((m) => gone.has(m.id)).map((m) => m.id);
    if (known.length !== gone.size) throw errors.unknownMessage();
    this.messages.set(
      channelId,
      list.filter((m) => !gone.has(m.id)),
    );
    this.emit(channel.guild_id, 'MESSAGE_DELETE_BULK', { ids: known, channel_id: channelId, guild_id: channel.guild_id });
  }

  /** Newest first, like Discord. `after` returns the page closest to that message; `before` the page just before it. */
  page(channelId: string, q: { before?: string; after?: string; around?: string; limit: number }): Message[] {
    const all = [...this.messagesIn(channelId)].sort((a, b) => compareSnowflakes(a.id, b.id));
    let slice: Message[];
    if (q.after) slice = all.filter((m) => compareSnowflakes(m.id, q.after!) > 0).slice(0, q.limit);
    else if (q.before) slice = all.filter((m) => compareSnowflakes(m.id, q.before!) < 0).slice(-q.limit);
    else if (q.around) {
      const before = all.filter((m) => compareSnowflakes(m.id, q.around!) < 0).slice(-Math.floor(q.limit / 2));
      const rest = all.filter((m) => compareSnowflakes(m.id, q.around!) >= 0).slice(0, q.limit - before.length);
      slice = [...before, ...rest];
    } else slice = all.slice(-q.limit);
    return slice.reverse();
  }

  /* ---------- Threads ---------- */

  private threadMetadata(autoArchive: number): ThreadMetadata {
    const at = this.iso();
    return { archived: false, auto_archive_duration: autoArchive, archive_timestamp: at, locked: false, create_timestamp: at };
  }

  private newThread(id: string, parent: Channel, t: { name: string; type: number; ownerId: string; autoArchive: number; tags?: string[] }): Channel {
    const thread: Channel = {
      id,
      type: t.type,
      guild_id: parent.guild_id,
      name: t.name,
      position: 0,
      parent_id: parent.id,
      topic: null,
      nsfw: false,
      last_message_id: null,
      rate_limit_per_user: 0,
      permission_overwrites: [],
      flags: 0,
      owner_id: t.ownerId,
      thread_metadata: this.threadMetadata(t.autoArchive),
      message_count: 0,
      member_count: 1,
      total_message_sent: 0,
      ...(t.tags ? { applied_tags: t.tags } : {}),
    };
    this.channels.set(id, thread);
    this.guild(parent.guild_id).channelIds.add(id);
    this.threadMembers.set(id, new Set([t.ownerId]));
    return thread;
  }

  /**
   * A thread with no starter message (POST /channels/:id/threads): public (11) or private (12) in a text channel, or an
   * announcement thread (10) in an announcement channel. Only members and moderators see a private one.
   */
  createThread(parentId: string, t: { name: string; type: number; ownerId: string; autoArchive?: number; invitable?: boolean }): Channel {
    const parent = this.channel(parentId);
    const fits =
      parent.type === ChannelType.text
        ? t.type === ChannelType.publicThread || t.type === ChannelType.privateThread
        : parent.type === ChannelType.announcement && t.type === ChannelType.announcementThread;
    if (!fits) throw errors.wrongChannelType();
    const thread = this.newThread(this.ids(), parent, {
      name: t.name,
      type: t.type,
      ownerId: t.ownerId,
      autoArchive: t.autoArchive ?? parent.default_auto_archive_duration ?? 1440,
    });
    if (t.type === ChannelType.privateThread) thread.thread_metadata!.invitable = t.invitable ?? true;
    this.emit(parent.guild_id, 'THREAD_CREATE', { ...thread, newly_created: true });
    return thread;
  }

  /** Adds or removes a thread member. Discord refuses either on an archived thread, and adds only members of the server. */
  setThreadMember(threadId: string, userId: string, on: boolean): void {
    const thread = this.channel(threadId);
    if (!isThread(thread.type)) throw errors.wrongChannelType();
    if (thread.thread_metadata?.archived) throw errors.threadArchived();
    if (on && !this.guild(thread.guild_id).members.has(userId)) throw errors.unknownMember();
    const members = this.threadMembers.get(threadId) ?? new Set<string>();
    if (on) members.add(userId);
    else members.delete(userId);
    this.threadMembers.set(threadId, members);
    thread.member_count = members.size;
  }

  /** A thread started from a message in a text or announcement channel. Its ID is the message's ID. */
  createThreadFromMessage(channelId: string, messageId: string, t: { name: string; autoArchive?: number; ownerId: string }): Channel {
    const parent = this.channel(channelId);
    if (parent.type !== ChannelType.text && parent.type !== ChannelType.announcement) throw errors.wrongChannelType();
    const message = this.findMessage(channelId, messageId);
    if (this.channels.has(messageId)) throw errors.threadExists();
    const thread = this.newThread(messageId, parent, {
      name: t.name,
      type: parent.type === ChannelType.announcement ? ChannelType.announcementThread : ChannelType.publicThread,
      ownerId: t.ownerId,
      autoArchive: t.autoArchive ?? parent.default_auto_archive_duration ?? 1440,
    });
    this.emit(parent.guild_id, 'THREAD_CREATE', { ...thread, newly_created: true });
    message.flags |= MessageFlag.hasThread;
    message.thread = thread;
    this.emit(parent.guild_id, 'MESSAGE_UPDATE', this.gatewayMessage(message));
    return thread;
  }

  /**
   * A post in a forum or media channel: a thread whose ID is also the ID of its first message.
   * THREAD_CREATE is announced before MESSAGE_CREATE, as on Discord.
   */
  createForumPost(
    forumId: string,
    t: { name: string; ownerId: string; appliedTags?: string[]; autoArchive?: number },
    first: Omit<NewMessage, 'id' | 'starter'>,
  ): { thread: Channel; message: Message } {
    const forum = this.channel(forumId);
    if (!isForum(forum.type)) throw errors.threadNameOutsideForum();
    const known = new Set((forum.available_tags ?? []).map((x) => x.id));
    for (const tag of t.appliedTags ?? []) if (!known.has(tag)) throw errors.unknownTag();
    const id = this.ids();
    const thread = this.newThread(id, forum, {
      name: t.name,
      type: ChannelType.publicThread,
      ownerId: t.ownerId,
      autoArchive: t.autoArchive ?? forum.default_auto_archive_duration ?? 1440,
      tags: t.appliedTags ?? [],
    });
    this.emit(forum.guild_id, 'THREAD_CREATE', { ...thread, newly_created: true });
    const message = this.postMessage(id, { ...first, id, starter: true });
    return { thread, message };
  }

  updateThread(threadId: string, patch: { name?: string; archived?: boolean; locked?: boolean; appliedTags?: string[] }): Channel {
    const thread = this.channel(threadId);
    if (!isThread(thread.type) || !thread.thread_metadata) throw errors.wrongChannelType();
    if (patch.name !== undefined) thread.name = patch.name;
    if (patch.appliedTags !== undefined) thread.applied_tags = patch.appliedTags;
    if (patch.archived !== undefined && patch.archived !== thread.thread_metadata.archived) {
      thread.thread_metadata.archived = patch.archived;
      thread.thread_metadata.archive_timestamp = this.iso();
    }
    if (patch.locked !== undefined) thread.thread_metadata.locked = patch.locked;
    this.emit(thread.guild_id, 'THREAD_UPDATE', { ...thread });
    return thread;
  }

  deleteThread(threadId: string): void {
    const thread = this.channel(threadId);
    if (!isThread(thread.type)) throw errors.wrongChannelType();
    this.channels.delete(threadId);
    this.messages.delete(threadId);
    this.threadMembers.delete(threadId);
    this.guilds.get(thread.guild_id)?.channelIds.delete(threadId);
    this.emit(thread.guild_id, 'THREAD_DELETE', { id: thread.id, guild_id: thread.guild_id, parent_id: thread.parent_id, type: thread.type });
  }

  /** Active (not archived) threads of a guild, for GUILD_CREATE. */
  activeThreads(guildId: string): Channel[] {
    return [...this.guild(guildId).channelIds].map((id) => this.channels.get(id)!).filter((c) => isThread(c.type) && !c.thread_metadata?.archived);
  }

  /** Channels that are not threads, for GUILD_CREATE and GET /guilds/:id/channels. */
  guildChannels(guildId: string): Channel[] {
    return [...this.guild(guildId).channelIds].map((id) => this.channels.get(id)!).filter((c) => !isThread(c.type));
  }

  validArchiveDuration(n: unknown): n is number {
    return typeof n === 'number' && ARCHIVE_DURATIONS.includes(n);
  }

  /** Wipes messages and threads (not guilds, channels, roles, members or webhooks) so a test can start from a clean channel. */
  clearMessages(): void {
    for (const c of [...this.channels.values()]) if (isThread(c.type)) this.channels.delete(c.id);
    for (const g of this.guilds.values()) for (const id of [...g.channelIds]) if (!this.channels.has(id)) g.channelIds.delete(id);
    this.messages.clear();
    this.threadMembers.clear();
    for (const c of this.channels.values()) c.last_message_id = null;
    for (const dm of this.dms.values()) dm.last_message_id = null;
  }
}

function randomToken(): string {
  const bytes = new Uint8Array(34);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}
