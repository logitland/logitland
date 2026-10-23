// Discord's REST API as the relay uses it, under /api/v10. Each route has a name, which is what request records,
// failure rules and tests refer to. Shapes and error codes follow https://docs.discord.com/developers.

import type { IncomingHttpHeaders } from 'node:http';
import { isSnowflake } from './ids.ts';
import {
  ChannelType,
  Permission,
  errors,
  formBody,
  isForum,
  isThread,
  type ApplicationCommand,
  type Channel,
  type Message,
  type Poll,
  type Webhook,
} from './model.ts';
import type { DiscordFake } from './fake.ts';
import type { AllowedMentions } from './world.ts';

export interface RouteRequest {
  fake: DiscordFake;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  headers: IncomingHttpHeaders;
}

export interface Reply {
  status: number;
  json?: unknown;
}

export interface Route {
  name: string;
  method: string;
  /** The path after /api/v10. */
  path: string;
  auth: 'bot' | 'none';
  /** Which parameter names the rate-limit bucket ("major parameter"). */
  bucket: string;
  handler: (req: RouteRequest) => Reply | Promise<Reply>;
}

const ok = (json: unknown): Reply => ({ status: 200, json });
const noContent: Reply = { status: 204 };

/* ---------- Validation helpers ---------- */

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function objectBody(body: unknown): Record<string, unknown> {
  if (!isObject(body)) throw errors.invalidJson();
  return body;
}

function text(o: Record<string, unknown>, key: string, opts: { max: number; min?: number; required?: boolean }): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) {
    if (opts.required) throw formBody([key], 'BASE_TYPE_REQUIRED', 'This field is required');
    return undefined;
  }
  if (typeof v !== 'string') throw formBody([key], 'BASE_TYPE_STRING', 'Not a well formed string.');
  // A field with a minimum is a range: Discord words both ends as one (seen for username on the staging server, #61).
  if (v.length > opts.max && opts.min === undefined) throw formBody([key], 'BASE_TYPE_MAX_LENGTH', `Must be ${opts.max} or fewer in length.`);
  if (v.length < (opts.min ?? 0) || v.length > opts.max)
    throw formBody([key], 'BASE_TYPE_BAD_LENGTH', `Must be between ${opts.min} and ${opts.max} in length.`);
  return v;
}

function allowedMentions(o: Record<string, unknown>): AllowedMentions | undefined {
  const v = o.allowed_mentions;
  if (v === undefined || v === null) return undefined;
  if (!isObject(v)) throw formBody(['allowed_mentions'], 'MODEL_TYPE_CONVERT', 'Only dictionaries may be used in a ModelType');
  const list = (key: string) => {
    const x = v[key];
    if (x === undefined) return undefined;
    if (!Array.isArray(x) || !x.every((i) => typeof i === 'string')) throw formBody(['allowed_mentions', key], 'LIST_TYPE_INVALID', 'Not a list of strings');
    return x as string[];
  };
  const parse = list('parse');
  for (const p of parse ?? [])
    if (!['roles', 'users', 'everyone'].includes(p))
      throw formBody(['allowed_mentions', 'parse'], 'ENUM_TYPE_INVALID', `Value "${p}" is not a valid enum value.`);
  return { parse, users: list('users'), roles: list('roles'), replied_user: typeof v.replied_user === 'boolean' ? v.replied_user : undefined };
}

function components(o: Record<string, unknown>): unknown[] | undefined {
  const v = o.components;
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw formBody(['components'], 'LIST_TYPE_INVALID', 'Not a list');
  if (v.length > 5) throw formBody(['components'], 'BASE_TYPE_MAX_LENGTH', 'Must be 5 or fewer in length.');
  v.forEach((row, i) => {
    if (!isObject(row) || row.type !== 1) throw formBody(['components', String(i), 'type'], 'ENUM_TYPE_INVALID', 'Value must be 1 for an action row.');
    const items = row.components;
    if (!Array.isArray(items) || items.length < 1 || items.length > 5)
      throw formBody(['components', String(i), 'components'], 'BASE_TYPE_BAD_LENGTH', 'Must be between 1 and 5 in length.');
    items.forEach((c, j) => {
      const at = ['components', String(i), 'components', String(j)];
      if (!isObject(c)) throw formBody(at, 'MODEL_TYPE_CONVERT', 'Only dictionaries may be used in a ModelType');
      if (c.type !== 2) return;
      const style = c.style;
      if (typeof style !== 'number' || ![1, 2, 3, 4, 5].includes(style)) throw formBody([...at, 'style'], 'BASE_TYPE_CHOICES', 'Must be one of 1, 2, 3, 4, 5.');
      if (typeof c.label === 'string' && c.label.length > 80) throw formBody([...at, 'label'], 'BASE_TYPE_MAX_LENGTH', 'Must be 80 or fewer in length.');
      if (c.label === undefined && c.emoji === undefined)
        throw formBody([...at, 'label'], 'BUTTON_COMPONENT_LABEL_OR_EMOJI_REQUIRED', 'Button must have a label or an emoji.');
      if (style === 5) {
        if (typeof c.url !== 'string') throw formBody([...at, 'url'], 'BUTTON_COMPONENT_URL_REQUIRED', 'A url is required for link buttons.');
        if (c.custom_id !== undefined)
          throw formBody([...at, 'custom_id'], 'BUTTON_COMPONENT_CUSTOM_ID_NOT_ALLOWED', 'A custom_id is not allowed on link buttons.');
      } else if (typeof c.custom_id !== 'string' || !c.custom_id) {
        throw formBody([...at, 'custom_id'], 'BUTTON_COMPONENT_CUSTOM_ID_REQUIRED', 'A custom_id is required for this button style.');
      } else if (c.custom_id.length > 100) {
        throw formBody([...at, 'custom_id'], 'BASE_TYPE_MAX_LENGTH', 'Must be 100 or fewer in length.');
      }
    });
  });
  return v;
}

function embeds(o: Record<string, unknown>): unknown[] | undefined {
  const v = o.embeds;
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length > 10) throw formBody(['embeds'], 'BASE_TYPE_MAX_LENGTH', 'Must be 10 or fewer in length.');
  return v;
}

function poll(fake: DiscordFake, o: Record<string, unknown>): Poll | undefined {
  const v = o.poll;
  if (v === undefined || v === null) return undefined;
  if (!isObject(v) || !isObject(v.question) || typeof v.question.text !== 'string')
    throw formBody(['poll', 'question'], 'BASE_TYPE_REQUIRED', 'This field is required');
  if (v.question.text.length < 1 || v.question.text.length > 300)
    throw formBody(['poll', 'question', 'text'], 'BASE_TYPE_BAD_LENGTH', 'Must be between 1 and 300 in length.');
  if (!Array.isArray(v.answers) || v.answers.length < 1 || v.answers.length > 10)
    throw formBody(['poll', 'answers'], 'BASE_TYPE_BAD_LENGTH', 'Must be between 1 and 10 in length.');
  const answers = v.answers.map((a, i) => {
    const t = isObject(a) && isObject(a.poll_media) ? a.poll_media.text : undefined;
    if (typeof t !== 'string' || t.length < 1 || t.length > 55)
      throw formBody(['poll', 'answers', String(i), 'poll_media', 'text'], 'BASE_TYPE_BAD_LENGTH', 'Must be between 1 and 55 in length.');
    return { answer_id: i + 1, poll_media: { text: t } };
  });
  const hours = v.duration === undefined ? 24 : v.duration;
  if (typeof hours !== 'number' || !Number.isInteger(hours) || hours < 1 || hours > 768)
    throw formBody(['poll', 'duration'], 'NUMBER_TYPE_MAX', 'Must be between 1 and 768.');
  return {
    question: { text: v.question.text },
    answers,
    expiry: new Date(fake.now() + hours * 3_600_000).toISOString(),
    allow_multiselect: v.allow_multiselect === true,
    layout_type: 1,
    results: { is_finalized: false, answer_counts: [] },
  };
}

function hasBody(o: Record<string, unknown>, content: string | undefined, extras: { poll?: Poll; components?: unknown[]; embeds?: unknown[] }): boolean {
  return Boolean(content) || Boolean(extras.poll) || Boolean(extras.embeds?.length) || Boolean(extras.components?.length) || Array.isArray(o.sticker_ids);
}

const REFERENCE_KEYS = ['message_id', 'channel_id', 'guild_id'] as const;

function reference(o: Record<string, unknown>): Message['message_reference'] | undefined {
  const v = o.message_reference;
  if (v === undefined || v === null) return undefined;
  if (!isObject(v)) throw formBody(['message_reference'], 'MODEL_TYPE_CONVERT', 'Only dictionaries may be used in a ModelType');
  const out: NonNullable<Message['message_reference']> = {};
  for (const k of REFERENCE_KEYS) {
    if (v[k] === undefined) continue;
    if (!isSnowflake(v[k])) throw formBody(['message_reference', k], 'NUMBER_TYPE_COERCE', `Value "${String(v[k])}" is not snowflake.`);
    out[k] = v[k];
  }
  return out;
}

/* ---------- Shared lookups ---------- */

function botCan(fake: DiscordFake, channel: Channel, permission: bigint): void {
  if (!fake.world.canInChannel(channel.id, fake.world.botUser.id, permission)) throw errors.missingPermissions();
}

function webhookFor(fake: DiscordFake, id: string, token: string): Webhook {
  const hook = fake.world.webhooks.get(id);
  if (!hook) throw errors.unknownWebhook();
  if (hook.token !== token) throw errors.invalidWebhookToken();
  return hook;
}

/** The channel a webhook message lives in: the webhook's channel, or one of its threads when thread_id is given. */
function webhookTarget(fake: DiscordFake, hook: Webhook, threadId: string | null): Channel {
  if (!threadId) return fake.world.channel(hook.channel_id);
  const thread = fake.world.channels.get(threadId);
  if (!thread || !isThread(thread.type) || thread.parent_id !== hook.channel_id) throw errors.unknownChannel();
  return thread;
}

const presentWebhook = (hook: Webhook, user?: unknown) => ({ ...hook, ...(user ? { user } : {}) });

/* ---------- Routes ---------- */

export function routes(): Route[] {
  const r: Route[] = [];
  const add = (name: string, method: string, path: string, auth: Route['auth'], bucket: string, handler: Route['handler']) =>
    r.push({ name, method, path, auth, bucket, handler });

  add('gateway.get', 'GET', '/gateway', 'none', 'gateway', ({ fake }) => ok({ url: fake.gatewayUrl }));

  add('gateway.bot', 'GET', '/gateway/bot', 'bot', 'gateway', ({ fake }) => {
    const limit = fake.gateway.sessionStartLimit;
    return ok({
      url: fake.gatewayUrl,
      shards: 1,
      session_start_limit: {
        total: limit.total,
        remaining: limit.remaining,
        reset_after: Math.max(0, limit.resetAt - fake.now()),
        max_concurrency: limit.maxConcurrency,
      },
    });
  });

  add('users.me', 'GET', '/users/@me', 'bot', 'users', ({ fake }) => ok({ ...fake.world.botUser, verified: true, mfa_enabled: false, flags: 0 }));

  add('applications.me', 'GET', '/applications/@me', 'bot', 'applications', ({ fake }) => ok(fake.applicationObject()));

  /* ----- Guilds ----- */

  add('guild.channels', 'GET', '/guilds/:guild/channels', 'bot', 'guild', ({ fake, params }) => {
    const guild = fake.world.guild(params.guild!);
    if (!guild.members.has(fake.world.botUser.id)) throw errors.missingAccess();
    return ok(fake.world.guildChannels(guild.id).sort((a, b) => a.position - b.position));
  });

  add('guild.roles', 'GET', '/guilds/:guild/roles', 'bot', 'guild', ({ fake, params }) => {
    const guild = fake.world.guild(params.guild!);
    if (!guild.members.has(fake.world.botUser.id)) throw errors.missingAccess();
    return ok([...guild.roles.values()]);
  });

  add('guild.member.get', 'GET', '/guilds/:guild/members/:user', 'bot', 'guild', ({ fake, params }) => {
    const guild = fake.world.guild(params.guild!);
    const member = guild.members.get(params.user!);
    if (!member) throw errors.unknownMember();
    return ok(member);
  });

  const changeRole =
    (on: boolean): Route['handler'] =>
    ({ fake, params }) => {
      const world = fake.world;
      const guild = world.guild(params.guild!);
      const bot = world.botUser.id;
      if (!world.can(guild.id, bot, Permission.manageRoles)) throw errors.missingPermissions();
      if (!guild.members.has(params.user!)) throw errors.unknownMember();
      const role = guild.roles.get(params.role!);
      if (!role) throw errors.unknownRole();
      // A role can only be given or taken by someone whose own highest role is above it (the owner is exempt).
      if (guild.owner_id !== bot && (role.position >= world.topPosition(guild.id, bot) || role.managed)) throw errors.missingPermissions();
      world.setMemberRole(guild.id, params.user!, role.id, on);
      return noContent;
    };
  add('guild.member.role.add', 'PUT', '/guilds/:guild/members/:user/roles/:role', 'bot', 'guild', changeRole(true));
  add('guild.member.role.remove', 'DELETE', '/guilds/:guild/members/:user/roles/:role', 'bot', 'guild', changeRole(false));

  /* ----- Application commands ----- */

  const commandApp = (fake: DiscordFake, params: Record<string, string>) => {
    if (params.app !== fake.application.id) throw errors.missingAccess();
    fake.world.guild(params.guild!);
  };
  add('commands.list', 'GET', '/applications/:app/guilds/:guild/commands', 'bot', 'guild', ({ fake, params }) => {
    commandApp(fake, params);
    return ok(fake.world.commands.get(params.guild!) ?? []);
  });
  add('commands.put', 'PUT', '/applications/:app/guilds/:guild/commands', 'bot', 'guild', ({ fake, params, body }) => {
    commandApp(fake, params);
    if (!Array.isArray(body)) throw formBody([], 'MODEL_TYPE_CONVERT', 'Only dictionaries may be used in a ModelType');
    if (body.length > 100) throw formBody([], 'BASE_TYPE_MAX_LENGTH', 'Must be 100 or fewer in length.');
    const previous = fake.world.commands.get(params.guild!) ?? [];
    const version = fake.world.newId();
    const names = new Set<string>();
    const stored = body.map((c, i): ApplicationCommand => {
      if (!isObject(c)) throw formBody([String(i)], 'MODEL_TYPE_CONVERT', 'Only dictionaries may be used in a ModelType');
      const type = c.type === undefined ? 1 : c.type;
      if (![1, 2, 3].includes(type as number)) throw formBody([String(i), 'type'], 'ENUM_TYPE_INVALID', 'Value is not a valid command type.');
      const name = c.name;
      if (typeof name !== 'string' || !/^[-_'\p{L}\p{N}]{1,32}$/u.test(name) || (type === 1 && name !== name.toLowerCase()))
        throw formBody([String(i), 'name'], 'APPLICATION_COMMAND_INVALID_NAME', 'Command name is invalid');
      if (names.has(`${type}:${name}`)) throw formBody([String(i)], 'APPLICATION_COMMANDS_DUPLICATE_NAME', 'Application command names must be unique');
      names.add(`${type}:${name}`);
      const description = type === 1 ? c.description : '';
      if (type === 1 && (typeof description !== 'string' || description.length < 1 || description.length > 100))
        throw formBody([String(i), 'description'], 'BASE_TYPE_BAD_LENGTH', 'Must be between 1 and 100 in length.');
      checkOptions(c.options, [String(i), 'options']);
      return {
        id: previous.find((p) => p.name === name && p.type === type)?.id ?? fake.world.newId(),
        application_id: fake.application.id,
        guild_id: params.guild!,
        version,
        name,
        description: description as string,
        type: type as number,
        ...(Array.isArray(c.options) ? { options: c.options } : {}),
        default_member_permissions: typeof c.default_member_permissions === 'string' ? c.default_member_permissions : null,
        nsfw: c.nsfw === true,
        integration_types: [0],
        contexts: [0],
      };
    });
    fake.world.commands.set(params.guild!, stored);
    return ok(stored);
  });

  /* ----- Channels ----- */

  add('channel.get', 'GET', '/channels/:channel', 'bot', 'channel', ({ fake, params }) => ok(fake.world.channel(params.channel!)));

  add('channel.webhooks.create', 'POST', '/channels/:channel/webhooks', 'bot', 'channel', ({ fake, params, body }) => {
    const channel = fake.world.channel(params.channel!);
    botCan(fake, channel, Permission.manageWebhooks);
    if (channel.type === ChannelType.category || isThread(channel.type)) throw errors.wrongChannelType();
    const o = objectBody(body);
    const name = text(o, 'name', { max: 80, min: 1, required: true })!;
    if (/clyde|discord/i.test(name)) throw formBody(['name'], 'USERNAME_INVALID_CONTAINS', 'Webhook names cannot contain "clyde" or "discord"');
    const existing = [...fake.world.webhooks.values()].filter((w) => w.channel_id === channel.id).length;
    if (existing >= 15) throw errors.tooManyWebhooks();
    const hook = fake.world.addWebhook(channel.id, { name });
    return ok(presentWebhook(hook, fake.world.botUser));
  });

  add('channel.messages.list', 'GET', '/channels/:channel/messages', 'bot', 'channel', ({ fake, params, query }) => {
    const channel = fake.world.channel(params.channel!);
    const world = fake.world;
    if (!world.canInChannel(channel.id, world.botUser.id, Permission.viewChannel)) throw errors.missingAccess();
    const given = ['around', 'before', 'after'].filter((k) => query.has(k));
    if (given.length > 1) throw formBody([given[1]!], 'MUTUALLY_EXCLUSIVE', 'Only one of around, before and after may be used.');
    for (const k of given) if (!isSnowflake(query.get(k))) throw formBody([k], 'NUMBER_TYPE_COERCE', `Value "${query.get(k)}" is not snowflake.`);
    const rawLimit = query.get('limit');
    const limit = rawLimit === null ? 50 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw formBody(['limit'], 'NUMBER_TYPE_MAX', 'int value should be less than or equal to 100.');
    // Without Read Message History a channel reads as empty.
    if (!world.canInChannel(channel.id, world.botUser.id, Permission.readMessageHistory)) return ok([]);
    const page = world.page(channel.id, {
      before: query.get('before') ?? undefined,
      after: query.get('after') ?? undefined,
      around: query.get('around') ?? undefined,
      limit,
    });
    return ok(page.map((m) => fake.restMessage(m)));
  });

  add('channel.messages.create', 'POST', '/channels/:channel/messages', 'bot', 'channel', ({ fake, params, body }) => {
    const channel = fake.world.channel(params.channel!);
    botCan(fake, channel, isThread(channel.type) ? Permission.sendMessagesInThreads : Permission.sendMessages);
    if (isForum(channel.type)) throw errors.cannotPostInForum();
    if (channel.type === ChannelType.category) throw errors.wrongChannelType();
    const o = objectBody(body);
    const content = text(o, 'content', { max: 2000 });
    const comps = components(o);
    const emb = embeds(o);
    const pl = poll(fake, o);
    if (!hasBody(o, content, { poll: pl, components: comps, embeds: emb })) throw errors.emptyMessage();
    const message = fake.world.postMessage(channel.id, {
      author: fake.world.botUser,
      content,
      application_id: fake.application.id,
      components: comps,
      embeds: emb,
      poll: pl,
      message_reference: reference(o),
      allowed_mentions: allowedMentions(o),
      tts: o.tts === true,
    });
    return ok(message);
  });

  add('channel.messages.thread', 'POST', '/channels/:channel/messages/:message/threads', 'bot', 'channel', ({ fake, params, body }) => {
    const channel = fake.world.channel(params.channel!);
    botCan(fake, channel, Permission.createPublicThreads);
    if (channel.type !== ChannelType.text && channel.type !== ChannelType.announcement) throw errors.wrongChannelType();
    const o = objectBody(body);
    const name = text(o, 'name', { max: 100, min: 1, required: true })!;
    const autoArchive = o.auto_archive_duration;
    if (autoArchive !== undefined && !fake.world.validArchiveDuration(autoArchive))
      throw formBody(['auto_archive_duration'], 'BASE_TYPE_CHOICES', 'Must be one of 60, 1440, 4320, 10080.');
    fake.world.findMessage(channel.id, params.message!);
    const thread = fake.world.createThreadFromMessage(channel.id, params.message!, {
      name,
      autoArchive: autoArchive as number | undefined,
      ownerId: fake.world.botUser.id,
    });
    return { status: 201, json: thread };
  });

  add('channel.threads.create', 'POST', '/channels/:channel/threads', 'bot', 'channel', ({ fake, params, body }) => {
    const channel = fake.world.channel(params.channel!);
    const o = objectBody(body);
    // Discord's default since API v9 is a private thread.
    const type = o.type ?? ChannelType.privateThread;
    if (![ChannelType.announcementThread, ChannelType.publicThread, ChannelType.privateThread].includes(type as 10 | 11 | 12))
      throw formBody(['type'], 'BASE_TYPE_CHOICES', 'Must be one of 10, 11, 12.');
    botCan(fake, channel, type === ChannelType.privateThread ? Permission.createPrivateThreads : Permission.createPublicThreads);
    const name = text(o, 'name', { max: 100, min: 1, required: true })!;
    const autoArchive = o.auto_archive_duration;
    if (autoArchive !== undefined && !fake.world.validArchiveDuration(autoArchive))
      throw formBody(['auto_archive_duration'], 'BASE_TYPE_CHOICES', 'Must be one of 60, 1440, 4320, 10080.');
    const thread = fake.world.createThread(channel.id, {
      name,
      type: type as number,
      ownerId: fake.world.botUser.id,
      autoArchive: autoArchive as number | undefined,
      invitable: typeof o.invitable === 'boolean' ? o.invitable : undefined,
    });
    return { status: 201, json: thread };
  });

  const threadMember =
    (on: boolean): Route['handler'] =>
    ({ fake, params }) => {
      const thread = fake.world.channel(params.channel!);
      if (!isThread(thread.type)) throw errors.wrongChannelType();
      botCan(fake, thread, Permission.sendMessagesInThreads);
      fake.world.setThreadMember(thread.id, params.user!, on);
      return noContent;
    };
  add('channel.thread_members.add', 'PUT', '/channels/:channel/thread-members/:user', 'bot', 'channel', threadMember(true));
  add('channel.thread_members.remove', 'DELETE', '/channels/:channel/thread-members/:user', 'bot', 'channel', threadMember(false));

  // Only threads are modified here (name, archived, locked): the relay changes no other channel. A thread's creator may
  // archive it; anything else needs Manage Threads.
  add('channel.modify', 'PATCH', '/channels/:channel', 'bot', 'channel', ({ fake, params, body }) => {
    const thread = fake.world.channel(params.channel!);
    if (!isThread(thread.type)) throw errors.wrongChannelType();
    const o = objectBody(body);
    const name = text(o, 'name', { max: 100, min: 1 });
    const flag = (key: string) => {
      if (o[key] !== undefined && typeof o[key] !== 'boolean') throw formBody([key], 'BASE_TYPE_BOOLEAN', 'Must be either true or false.');
      return o[key] as boolean | undefined;
    };
    const archived = flag('archived');
    const locked = flag('locked');
    if (thread.owner_id !== fake.world.botUser.id || locked !== undefined || name !== undefined) botCan(fake, thread, Permission.manageThreads);
    return ok(fake.world.updateThread(thread.id, { name, archived, locked }));
  });

  /* ----- Webhooks ----- */

  add('webhook.get', 'GET', '/webhooks/:id/:token', 'none', 'webhook', ({ fake, params }) => {
    return ok(webhookFor(fake, params.id!, params.token!));
  });

  add('webhook.delete', 'DELETE', '/webhooks/:id/:token', 'none', 'webhook', ({ fake, params }) => {
    fake.world.webhooks.delete(webhookFor(fake, params.id!, params.token!).id);
    return noContent;
  });

  add('webhook.execute', 'POST', '/webhooks/:id/:token', 'none', 'webhook', ({ fake, params, query, body }) => {
    if (params.id === fake.application.id) return fake.interactions.followUp(params.token!, objectBody(body));
    const hook = webhookFor(fake, params.id!, params.token!);
    const o = objectBody(body);
    const world = fake.world;
    const channel = world.channel(hook.channel_id);
    const threadId = query.get('thread_id');
    if (threadId !== null && !isSnowflake(threadId)) throw formBody(['thread_id'], 'NUMBER_TYPE_COERCE', `Value "${threadId}" is not snowflake.`);

    const content = text(o, 'content', { max: 2000 });
    const username = text(o, 'username', { max: 80, min: 1 });
    // Measured on the staging server (#61): an all-space name is refused as empty, with both errors Discord gave, and each
    // reserved word is named on its own.
    if (username !== undefined && username.trim() === '')
      throw formBody(['username'], 'BASE_TYPE_BAD_LENGTH', 'Must be between 1 and 80 in length.', [
        { code: 'USERNAME_INVALID', message: 'Username cannot be ""' },
      ]);
    const reserved = username !== undefined && fake.strictUsernames ? /discord|clyde/i.exec(username) : null;
    if (reserved) throw formBody(['username'], 'USERNAME_INVALID_CONTAINS', `Username cannot contain "${reserved[0].toLowerCase()}"`);
    const threadName = text(o, 'thread_name', { max: 100, min: 1 });
    const tags = o.applied_tags;
    if (tags !== undefined && (!Array.isArray(tags) || tags.length > 5 || !tags.every(isSnowflake)))
      throw formBody(['applied_tags'], 'LIST_TYPE_INVALID', 'Must be a list of up to 5 snowflakes.');
    const comps = components(o);
    const emb = embeds(o);
    const pl = poll(fake, o);
    if (!hasBody(o, content, { poll: pl, components: comps, embeds: emb })) throw errors.emptyMessage();

    if (isForum(channel.type)) {
      if (threadId && threadName) throw errors.forumBothThreads();
      if (!threadId && !threadName) throw errors.forumNeedsThread();
    } else if (threadName !== undefined) throw errors.threadNameOutsideForum();
    else if (tags !== undefined && (tags as string[]).length > 0) throw errors.threadNameOutsideForum();

    const author = { id: hook.id, username: username ?? hook.name, discriminator: '0000', global_name: null, avatar: null, bot: true };
    const input = {
      author,
      content,
      webhook_id: hook.id,
      embeds: emb,
      poll: pl,
      allowed_mentions: allowedMentions(o),
      tts: o.tts === true,
      // Components on a webhook that no application owns are dropped unless with_components is set.
      components: query.get('with_components') === 'true' ? comps : undefined,
    };
    let message: Message;
    if (threadName !== undefined) {
      message = world.createForumPost(channel.id, { name: threadName, ownerId: hook.id, appliedTags: tags as string[] | undefined }, input).message;
    } else {
      const target = webhookTarget(fake, hook, threadId);
      // Posting to an archived thread brings it back.
      if (target.thread_metadata?.archived) world.updateThread(target.id, { archived: false });
      message = world.postMessage(target.id, input);
    }
    return query.get('wait') === 'true' ? ok(message) : noContent;
  });

  const webhookMessage = (fake: DiscordFake, hook: Webhook, messageId: string, threadId: string | null): { message: Message; channel: Channel } => {
    if (threadId !== null && !isSnowflake(threadId)) throw formBody(['thread_id'], 'NUMBER_TYPE_COERCE', `Value "${threadId}" is not snowflake.`);
    const channel = webhookTarget(fake, hook, threadId);
    const message = fake.world.messagesIn(channel.id).find((m) => m.id === messageId);
    // A webhook can only touch what it posted itself.
    if (!message || message.webhook_id !== hook.id) throw errors.unknownMessage();
    return { message, channel };
  };

  add('webhook.message.get', 'GET', '/webhooks/:id/:token/messages/:message', 'none', 'webhook', ({ fake, params, query }) => {
    const hook = webhookFor(fake, params.id!, params.token!);
    return ok(webhookMessage(fake, hook, params.message!, query.get('thread_id')).message);
  });

  add('webhook.message.edit', 'PATCH', '/webhooks/:id/:token/messages/:message', 'none', 'webhook', ({ fake, params, query, body }) => {
    if (params.id === fake.application.id) return fake.interactions.editOriginal(params.token!, params.message!, objectBody(body));
    const hook = webhookFor(fake, params.id!, params.token!);
    const { message, channel } = webhookMessage(fake, hook, params.message!, query.get('thread_id'));
    const o = objectBody(body);
    const content = text(o, 'content', { max: 2000 });
    const emb = embeds(o);
    const next = content ?? message.content;
    if (!next && !message.poll && !(emb ?? message.embeds).length) throw errors.emptyMessage();
    const edited = fake.world.editMessage(channel.id, message.id, { content, embeds: emb });
    return ok(edited);
  });

  add('webhook.message.delete', 'DELETE', '/webhooks/:id/:token/messages/:message', 'none', 'webhook', ({ fake, params, query }) => {
    if (params.id === fake.application.id) return fake.interactions.deleteOriginal(params.token!, params.message!);
    const hook = webhookFor(fake, params.id!, params.token!);
    const { message, channel } = webhookMessage(fake, hook, params.message!, query.get('thread_id'));
    fake.world.deleteMessage(channel.id, message.id);
    return noContent;
  });

  return r;
}

function checkOptions(options: unknown, path: string[]): void {
  if (options === undefined) return;
  if (!Array.isArray(options) || options.length > 25) throw formBody(path, 'BASE_TYPE_MAX_LENGTH', 'Must be 25 or fewer in length.');
  options.forEach((o, i) => {
    const at = [...path, String(i)];
    if (!isObject(o)) throw formBody(at, 'MODEL_TYPE_CONVERT', 'Only dictionaries may be used in a ModelType');
    if (typeof o.type !== 'number' || o.type < 1 || o.type > 11) throw formBody([...at, 'type'], 'ENUM_TYPE_INVALID', 'Value must be one of the option types.');
    if (typeof o.name !== 'string' || !/^[-_'\p{L}\p{N}]{1,32}$/u.test(o.name) || o.name !== o.name.toLowerCase())
      throw formBody([...at, 'name'], 'APPLICATION_COMMAND_INVALID_NAME', 'Command name is invalid');
    if (typeof o.description !== 'string' || o.description.length < 1 || o.description.length > 100)
      throw formBody([...at, 'description'], 'BASE_TYPE_BAD_LENGTH', 'Must be between 1 and 100 in length.');
    checkOptions(o.options, [...at, 'options']);
  });
}
