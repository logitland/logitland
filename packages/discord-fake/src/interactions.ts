// Discord calling the relay's interactions endpoint: signed requests for slash commands, button clicks and submitted
// modals, and the follow-up webhook calls (`PATCH /webhooks/:application/:token/messages/@original`) the relay makes in
// answer. A click (or a modal opened from one) answered with UPDATE_MESSAGE (type 7) changes the message the button is on,
// and so does a later edit of `@original`. A MODAL answer (type 9) is checked as Discord checks it and kept on the
// interaction, so a test can fill it in and submit it.
// https://docs.discord.com/developers/interactions/receiving-and-responding
// https://docs.discord.com/developers/components/reference (modal components)

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { DiscordHttpError, errors, formBody, type Member, type Message } from './model.ts';
import type { DiscordFake } from './fake.ts';
import { messageEdit, type Reply } from './rest.ts';

const UPDATE_MESSAGE = 7;
const MODAL = 9;
const MODAL_SUBMIT = 5;
/** Modal components: an action row or label holding a text input, and text shown above them. */
const ModalComponent = { actionRow: 1, textInput: 4, textDisplay: 10, label: 18 } as const;
/** Discord's limits on a modal. */
const MODAL_LIMITS = { title: 45, customId: 100, components: 5, label: 45, inputMax: 4000 } as const;

/** A text input as a modal lays it out. */
interface TextInput {
  type: 4;
  custom_id: string;
  style: number;
  label?: string;
  required?: boolean;
  min_length?: number;
  max_length?: number;
}

/** A modal the relay answered with: what the person sees, and fills in. */
export interface Modal {
  custom_id: string;
  title: string;
  components: Record<string, unknown>[];
}

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
  /**
   * The modal an earlier interaction (by its ID) was answered with, submitted with these values by text input custom_id. It
   * comes from the same person, in the same channel and about the same message; values must fit the inputs, as Discord's
   * client won't submit them otherwise.
   */
  modal?: { interaction: string; values: Record<string, string> };
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
  /** The modal the relay answered with (type 9), until it is submitted. */
  modal: Modal | null;
  /** What the relay said through follow-up calls, oldest first. */
  followUps: FollowUp[];
}

export interface InteractionResult {
  status: number;
  body: unknown;
  interaction: InteractionRecord;
}

/** The text inputs a modal component holds: one in a label or an action row, none in text. */
function inputsOf(c: Record<string, unknown>): TextInput[] {
  if (c.type === ModalComponent.label) return [c.component as TextInput];
  if (c.type === ModalComponent.actionRow) return (c.components as TextInput[] | undefined) ?? [];
  return [];
}

/** A MODAL answer's data as Discord checks it; throws what Discord would refuse. */
function checkModal(data: Record<string, unknown>): Modal {
  const refuse = (why: string): never => {
    throw new Error(`Discord would refuse this MODAL: ${why}`);
  };
  const { custom_id, title, components } = data as Partial<Modal>;
  if (typeof custom_id !== 'string' || !custom_id || custom_id.length > MODAL_LIMITS.customId) refuse('custom_id must be 1–100 characters');
  if (typeof title !== 'string' || !title || title.length > MODAL_LIMITS.title) refuse(`title must be 1–${MODAL_LIMITS.title} characters`);
  if (!Array.isArray(components) || !components.length || components.length > MODAL_LIMITS.components) refuse('it must have 1–5 components');
  const ids = new Set<string>();
  for (const c of components!) {
    if (c.type === ModalComponent.textDisplay) {
      if (typeof c.content !== 'string' || !c.content) refuse('a text display needs content');
      continue;
    }
    if (c.type === ModalComponent.label) {
      if (typeof c.label !== 'string' || !c.label || c.label.length > MODAL_LIMITS.label) refuse(`a label must be 1–${MODAL_LIMITS.label} characters`);
      if ((c.component as TextInput | undefined)?.label !== undefined) refuse('a text input in a label takes its label from the label');
    } else if (c.type !== ModalComponent.actionRow) refuse(`component type ${String(c.type)} can’t go in a modal`);
    const inputs = inputsOf(c);
    if (inputs.length !== 1) refuse('each label or action row holds one text input');
    for (const input of inputs) {
      if (input?.type !== ModalComponent.textInput || typeof input.custom_id !== 'string' || !input.custom_id) refuse('a text input needs a custom_id');
      if (ids.has(input.custom_id)) refuse(`custom_id ${input.custom_id} is used twice`);
      ids.add(input.custom_id);
      if (c.type === ModalComponent.actionRow && !input.label) refuse('a text input in an action row needs a label');
      const min = input.min_length ?? 0;
      const max = input.max_length ?? MODAL_LIMITS.inputMax;
      if (min < 0 || max < 1 || max > MODAL_LIMITS.inputMax || min > max) refuse('min_length and max_length must fit 0–4000, min no more than max');
    }
  }
  return { custom_id: custom_id!, title: title!, components: components! };
}

/** What Discord sends back when the modal is submitted: its layout, each text input with its value. */
function submitted(modal: Modal, values: Record<string, string>): Record<string, unknown>[] {
  let id = 0;
  const filled = (input: TextInput) => {
    const value = values[input.custom_id] ?? '';
    const required = input.required ?? true;
    if (required && !value) throw new Error(`${input.custom_id} is required`);
    if (value && (value.length < (input.min_length ?? 0) || value.length > (input.max_length ?? MODAL_LIMITS.inputMax)))
      throw new Error(`${input.custom_id} must be ${input.min_length ?? 0}–${input.max_length ?? MODAL_LIMITS.inputMax} characters`);
    return { type: ModalComponent.textInput, id: ++id, custom_id: input.custom_id, value };
  };
  return modal.components.map((c) => {
    if (c.type === ModalComponent.label) return { type: ModalComponent.label, id: ++id, component: filled(c.component as TextInput) };
    if (c.type === ModalComponent.actionRow) return { type: ModalComponent.actionRow, id: ++id, components: inputsOf(c).map(filled) };
    return { type: c.type, id: ++id };
  });
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
    const opener = spec.modal ? this.opener(spec.modal.interaction, spec.user) : undefined;
    const channelId =
      (opener?.payload.channel_id as string | undefined) ?? spec.channelId ?? world.guildChannels(guild.id).find((c) => c.type === 0)?.id ?? null;

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
      } else if (opener) {
        const modal = opener.modal!;
        // A modal opened from a button is about that button's message, as it now reads.
        const about = opener.payload.message as Message | undefined;
        const message = about && channelId ? world.findMessage(channelId, about.id) : undefined;
        payload = {
          ...common,
          type: MODAL_SUBMIT,
          data: { custom_id: modal.custom_id, components: submitted(modal, spec.modal!.values) },
          ...(message ? { message: { ...message } } : {}),
        };
        opener.modal = null;
      } else throw new Error('Pass command, button, modal or ping');
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
      modal: null,
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
    if (res.ok && answer.type === MODAL) {
      // Discord shows "This interaction failed" for a modal it refuses, and for one answering a ping or another modal.
      if (payload.type === 1 || payload.type === MODAL_SUBMIT) throw new Error('Discord would refuse this MODAL: only a command or a button can open one');
      record.modal = checkModal(answer.data ?? {});
    }
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

  /** The interaction whose modal is being submitted: by the person it was shown to, once. */
  private opener(interactionId: string, user: string): InteractionRecord {
    const record = this.all().find((r) => r.id === interactionId);
    if (!record?.modal) throw new Error(`Interaction ${interactionId} has no modal open to submit`);
    if (record.user !== user) throw new Error('Only the person a modal was shown to can submit it');
    return record;
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
