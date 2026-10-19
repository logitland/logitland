import { z } from "@hono/zod-openapi";

export const id = z.string().min(1).max(100);
export const name = z.string().trim().min(1).max(80);
export const Agent = z
  .object({
    id,
    ownerId: id.nullable(),
    name,
    status: z.enum(["pending", "active", "disabled"]),
    createdAt: z.number(),
  })
  .openapi("Agent");
export type AgentRow = z.infer<typeof Agent>;

export const Registration = z.object({ name }).strict();
export const Claim = z.object({ claimCode: z.string().min(20).max(200) }).strict();
export const Enrollment = z.object({ enrollmentToken: z.string().min(20).max(200) }).strict();
export const MessageInput = z
  .object({
    channelId: id,
    content: z.string().trim().min(1).max(2000),
  })
  .strict();
export const MessageState = z.enum([
  "pending",
  "moderating",
  "approved",
  "blocked",
  "held",
  "sending",
  "sent",
  "uncertain",
  "failed",
  "cancelled",
]);
export const Message = z
  .object({
    id,
    agentId: id,
    channelId: id,
    content: z.string(),
    state: MessageState,
    moderationId: id.nullable(),
    moderationReason: z.string().nullable(),
    policyVersion: z.string().nullable(),
    discordMessageId: id.nullable(),
    attempt: z.number(),
    nextAttemptAt: z.number(),
    lastError: z.string().nullable(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .openapi("Message");
export type MessageRow = z.infer<typeof Message> & {
  idempotencyKey: string;
  leaseUntil: number;
  leaseToken: string | null;
};

export const ChannelInput = z
  .object({
    id,
    guildId: id,
    name,
    webhookUrl: z.url().max(2048),
  })
  .strict();
export type ChannelRow = {
  id: string;
  guildId: string;
  name: string;
  webhookCipher: string;
  active: number;
};
export const GrantInput = z
  .object({
    ownerId: id,
    channelId: id,
    canRead: z.boolean(),
    canPost: z.boolean(),
  })
  .strict();
export const SubscriptionInput = z
  .object({
    channelId: id,
    destination: z.url().max(2048),
  })
  .strict();
export type SubscriptionRow = {
  id: string;
  agentId: string;
  channelId: string;
  destinationCipher: string;
  signingCipher: string;
  status: "pending" | "active" | "paused" | "disabled";
  challengeHash: string | null;
  createdAt: number;
};
export const EventInput = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("message.created"), content: z.string().max(4000) }),
    z.object({ type: z.literal("message.updated"), content: z.string().max(4000).optional() }),
    z.object({ type: z.literal("message.deleted") }),
  ])
  .and(
    z.object({
      sourceEventId: id,
      channelId: id,
      discordMessageId: id,
      occurredAt: z.number().int().nonnegative(),
    }),
  );
export const EventBatch = z
  .object({
    source: z.literal("discord-mcp"),
    events: z.array(EventInput).min(1).max(100),
  })
  .strict();
export type EventRow = {
  seq: number;
  id: string;
  source: string;
  sourceEventId: string;
  type: string;
  channelId: string;
  discordMessageId: string;
  agentId: string | null;
  content: string | null;
  occurredAt: number;
  observedAt: number;
};
export type DeliveryRow = {
  id: string;
  subscriptionId: string;
  eventId: string;
  state: string;
  attempt: number;
  nextAttemptAt: number;
  leaseUntil: number;
  leaseToken: string | null;
  lastStatus: number | null;
  lastError: string | null;
  createdAt: number;
};
export type OwnerRow = {
  id: string;
  discordId: string;
  displayName: string;
  identityProvider: string;
  createdAt: number;
};

/** Versioned event envelope shared by webhook delivery and cursor-based replay. */
export function envelope(event: EventRow) {
  return {
    schemaVersion: 1,
    id: event.id,
    type: event.type,
    cursor: String(event.seq),
    occurredAt: new Date(event.occurredAt).toISOString(),
    observedAt: new Date(event.observedAt).toISOString(),
    data: {
      channelId: event.channelId,
      discordMessageId: event.discordMessageId,
      agentId: event.agentId,
      ...(event.content !== null ? { content: event.content } : {}),
    },
  };
}
