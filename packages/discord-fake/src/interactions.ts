// Discord calling the relay's interactions endpoint: signed requests for slash commands and button clicks, and the
// follow-up webhook calls (`PATCH /webhooks/:application/:token/messages/@original`) the relay makes in answer. A click
// answered with UPDATE_MESSAGE (type 7) changes the message the button is on, and so does a later edit of `@original`.
// https://docs.discord.com/developers/interactions/receiving-and-responding

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { DiscordHttpError, errors, formBody, type Member, type Message } from './model.ts';
import type { DiscordFake } from './fake.ts';
import { messageEdit, type Reply } from './rest.ts';

const UPDATE_MESSAGE = 7;

const TOKEN_LIFETIME_MS = 15 * 60_000;
const EPHEMERAL = 64;

export interface InteractionSpec {
  /** The ID of a member of the guild. */
  user: string;
  guildId?: string;
  channelId?: string;
  /** A slash command such as /mirror agree. */
  command?: { name: string; subcommand?: string };
  /** A click on a message button; `messageId` is a message in `channelId`, which an UPDATE_MESSAGE answer changes. */
  button?: { customId: string; messageId?: string };
  ping?: boolean;
  /** Where to send it. Defaults to the application's interactions endpoint URL. */
  endpoint?: string;
  /** What to do with the signature: sign properly (default), send a wrong one, or leave the headers off. */
  signature?: 'valid' | 'invalid' | 'missing';
  /** The timestamp header, in epoch seconds. Default: now. */
  timestamp?: number;
}

export interface FollowUp {
  id: string;
  kind: 'original' | 'followup';
  content: string;
  flags: number;
  at: string;
}

export interface InteractionRecord {
  id: string;
  token: string;
  type: number;
  user: string;
  payload: Record<string, unknown>;
  createdAt: number;
  /** The relay answered with a 2xx, so follow-ups for this token are accepted. */
  acknowledged: boolean;
  response: { status: number; body: unknown } | null;
  /** What the relay said through follow-up calls, oldest first. */
  followUps: FollowUp[];
}

export interface InteractionResult {
  status: number;
  body: unknown;
  interaction: InteractionRecord;
}

/** Raw Ed25519 public keys are the last 32 bytes of the SubjectPublicKeyInfo encoding. */
export function rawPublicKeyHex(key: KeyObject): string {
  return createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
}

export class Interactions {
  readonly records = new Map<string, InteractionRecord>();
  readonly privateKey: KeyObject;
  readonly publicKeyHex: string;
  private readonly fake: DiscordFake;

  constructor(fake: DiscordFake, privateKeyPem?: string) {
    this.fake = fake;
    if (privateKeyPem) {
      this.privateKey = createPrivateKey(privateKeyPem);
    } else {
      this.privateKey = generateKeyPairSync('ed25519').privateKey;
    }
    this.publicKeyHex = rawPublicKeyHex(this.privateKey);
  }

  all(): InteractionRecord[] {
    return [...this.records.values()];
  }

  /** Builds, signs and sends one interaction to the relay, and waits for the answer. */
  async send(spec: InteractionSpec): Promise<InteractionResult> {
    const { fake } = this;
    const world = fake.world;
    const guild = spec.guildId ? world.guild(spec.guildId) : [...world.guilds.values()][0];
    if (!guild) throw new Error('Add a guild before sending interactions');
    const member = guild.members.get(spec.user);
    if (!member && !spec.ping) throw new Error(`User ${spec.user} is not a member of guild ${guild.id}`);
    const endpoint = spec.endpoint ?? fake.application.interactions_endpoint_url;
    if (!endpoint) throw new Error('Set application.interactions_endpoint_url, or pass endpoint');
    const channelId = spec.channelId ?? world.guildChannels(guild.id).find((c) => c.type === 0)?.id ?? null;

    const id = world.newId();
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString('base64url');
    const base = { id, application_id: fake.application.id, token, version: 1 };
    let payload: Record<string, unknown>;
    if (spec.ping) payload = { ...base, type: 1 };
    else {
      const m = member!;
      const common = {
        ...base,
        guild_id: guild.id,
        guild: { id: guild.id, features: [], locale: 'en-US' },
        ...(channelId ? { channel_id: channelId, channel: { id: channelId, type: world.channels.get(channelId)?.type ?? 0, guild_id: guild.id } } : {}),
        member: this.memberPayload(guild.id, m),
        app_permissions: '0',
        locale: 'en-US',
        guild_locale: 'en-US',
        entitlements: [],
        authorizing_integration_owners: { '0': guild.id },
        context: 0,
        attachment_size_limit: 10_485_760,
      };
      if (spec.command) {
        const registered = world.commands.get(guild.id)?.find((c) => c.name === spec.command!.name);
        payload = {
          ...common,
          type: 2,
          data: {
            id: registered?.id ?? world.newId(),
            name: spec.command.name,
            type: 1,
            guild_id: guild.id,
            ...(spec.command.subcommand ? { options: [{ name: spec.command.subcommand, type: 1 }] } : {}),
          },
        };
      } else if (spec.button) {
        const message = spec.button.messageId && channelId ? world.findMessage(channelId, spec.button.messageId) : undefined;
        payload = { ...common, type: 3, data: { custom_id: spec.button.customId, component_type: 2 }, ...(message ? { message: { ...message } } : {}) };
      } else throw new Error('Pass command, button or ping');
    }

    const record: InteractionRecord = {
      id,
      token,
      type: payload.type as number,
      user: spec.user,
      payload,
      createdAt: fake.now(),
      acknowledged: false,
      response: null,
      followUps: [],
    };
    this.records.set(token, record);

    const body = JSON.stringify(payload);
    const timestamp = String(spec.timestamp ?? Math.floor(fake.now() / 1000));
    const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': 'Discord-Interactions/1.0 (+https://discord.com)' };
    if (spec.signature !== 'missing') {
      const signature = sign(null, Buffer.from(timestamp + body), this.privateKey);
      if (spec.signature === 'invalid') signature[0] = signature[0]! ^ 0xff;
      headers['x-signature-ed25519'] = signature.toString('hex');
      headers['x-signature-timestamp'] = timestamp;
    }
    const res = await fetch(endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(15_000) });
    const raw = await res.text();
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Not JSON: keep the text.
    }
    record.response = { status: res.status, body: parsed };
    record.acknowledged = res.ok;
    const answer = parsed as { type?: number; data?: Record<string, unknown> };
    if (res.ok && answer.type === UPDATE_MESSAGE && payload.message) {
      try {
        this.editButtonMessage(record, answer.data ?? {});
      } catch (err) {
        // Discord shows "This interaction failed" and leaves the message as it was.
        if (err instanceof DiscordHttpError) throw new Error(`Discord would refuse this UPDATE_MESSAGE: ${err.message} ${JSON.stringify(err.errors ?? {})}`);
        throw err;
      }
    }
    return { status: res.status, body: parsed, interaction: record };
  }

  /** Changes the message a clicked button is on, as UPDATE_MESSAGE and edits of `@original` do. */
  private editButtonMessage(record: InteractionRecord, body: Record<string, unknown>): Message {
    const channelId = record.payload.channel_id as string;
    const message = this.fake.world.findMessage(channelId, (record.payload.message as Message).id);
    return this.fake.world.editMessage(channelId, message.id, messageEdit(message, body));
  }

  private memberPayload(guildId: string, m: Member): Record<string, unknown> {
    return { ...m, permissions: String(this.fake.world.permissionsOf(guildId, m.user.id)) };
  }

  /* ---------- What the relay may call back ---------- */

  private lookup(token: string): InteractionRecord {
    const record = this.records.get(token);
    if (!record) throw errors.invalidWebhookToken();
    if (this.fake.now() - record.createdAt > TOKEN_LIFETIME_MS) throw errors.invalidWebhookToken();
    // The token only works once Discord has Discord's own acknowledgement: our POST has to have been answered.
    if (!record.acknowledged) throw errors.unknownWebhook();
    return record;
  }

  private content(body: Record<string, unknown>): { content: string; flags: number } {
    const content = body.content;
    if (content !== undefined && content !== null && typeof content !== 'string') throw formBody(['content'], 'BASE_TYPE_STRING', 'Not a well formed string.');
    if (typeof content === 'string' && content.length > 2000) throw formBody(['content'], 'BASE_TYPE_MAX_LENGTH', 'Must be 2000 or fewer in length.');
    return { content: (content as string | undefined) ?? '', flags: typeof body.flags === 'number' ? body.flags : 0 };
  }

  private message(record: InteractionRecord, f: FollowUp): Record<string, unknown> {
    return {
      id: f.id,
      type: 0,
      content: f.content,
      channel_id: (record.payload.channel_id as string | undefined) ?? null,
      author: this.fake.world.botUser,
      timestamp: f.at,
      edited_timestamp: null,
      flags: f.flags,
      application_id: this.fake.application.id,
      interaction_metadata: { id: record.id },
      tts: false,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [],
      embeds: [],
      pinned: false,
      components: [],
    };
  }

  editOriginal(token: string, messageId: string, body: Record<string, unknown>): Reply {
    const record = this.lookup(token);
    // A click's original is the message its button is on.
    if (messageId === '@original' && record.payload.message) return { status: 200, json: this.editButtonMessage(record, body) };
    const { content, flags } = this.content(body);
    const at = new Date(this.fake.now()).toISOString();
    if (messageId !== '@original') {
      const existing = record.followUps.find((f) => f.id === messageId);
      if (!existing) throw errors.unknownMessage();
      existing.content = content;
      return { status: 200, json: this.message(record, existing) };
    }
    // The first edit of the deferred answer is the message itself; later ones change it.
    let original = record.followUps.find((f) => f.kind === 'original');
    if (!original) record.followUps.push((original = { id: record.id, kind: 'original', content, flags: flags || EPHEMERAL, at }));
    else {
      original.content = content;
      original.flags = flags || original.flags;
    }
    return { status: 200, json: this.message(record, original) };
  }

  followUp(token: string, body: Record<string, unknown>): Reply {
    const record = this.lookup(token);
    const { content, flags } = this.content(body);
    const f: FollowUp = { id: this.fake.world.newId(), kind: 'followup', content, flags, at: new Date(this.fake.now()).toISOString() };
    record.followUps.push(f);
    return { status: 200, json: this.message(record, f) };
  }

  deleteOriginal(token: string, messageId: string): Reply {
    const record = this.lookup(token);
    const at = record.followUps.findIndex((f) => (messageId === '@original' ? f.kind === 'original' : f.id === messageId));
    if (at < 0) throw errors.unknownMessage();
    record.followUps.splice(at, 1);
    return { status: 204 };
  }
}
