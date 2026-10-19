import type { DiscordRest } from '@logitland/discord';
import type { SecretBox } from './crypto';
import type { Logger } from './log';
import type { Resolver } from './services/destinations';
import type { Moderator } from './services/moderation/classifier';

/** The minimum of D1 the relay uses, so tests can supply a SQLite-backed stand-in. */
export interface Db {
  prepare(sql: string): Stmt;
  /** Runs every statement in one transaction. Each result carries `meta.changes`. */
  batch(statements: Stmt[]): Promise<{ meta: { changes: number } }[]>;
}
export interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

/** Where accepted deliveries go for dispatch. A Cloudflare Queue fits; so does nothing (cron drains the ledger). */
export interface DeliveryQueue {
  send(body: { delivery_id: string }): Promise<unknown>;
  sendBatch?(messages: { body: { delivery_id: string } }[]): Promise<unknown>;
}

/** Workers AI, reduced to what the fallback classifier calls. */
export interface AiBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

/** Hands a message to its channel's send queue (the ChannelSender Durable Object). Null runs sends inline. */
export interface ChannelSenderClient {
  enqueue(channelId: string, messageId: string): Promise<void>;
}

/** The Discord Gateway Durable Object, as cron and the admin health page see it. */
export interface GatewayClient {
  ensure(): Promise<void>;
  status(): Promise<Record<string, unknown>>;
}

export interface RelayConfig {
  /** Public origin of the relay, used in /auth.md and claim links. */
  publicUrl: string;
  /** Origin of the dashboard, where claim codes are approved and people remove their messages. */
  dashboardUrl: string;
  /** Defence in depth on the internal entrypoint, which is only reachable through the service binding. */
  internalToken: string;
  /** Discord user IDs allowed into the admin console. */
  adminDiscordIds: string[];
  /** Hosts deliveries must never reach (the relay and dashboard themselves, plus BLOCKED_HOSTS). */
  blockedHosts: string[];
  /** What to do when no classifier answers. */
  moderationOutage: 'hold' | 'refuse';
  /** Key for IP and author HMACs. */
  hashKey: string;
  discord: {
    applicationId: string | null;
    publicKey: string | null;
    guildId: string | null;
    /** The role that may chat in relayed channels; granted when a person agrees to the mirror. */
    consentRoleId: string | null;
  };
  development: boolean;
}

export interface Relay {
  db: Db;
  config: RelayConfig;
  secrets: SecretBox;
  discord: DiscordRest;
  /** Jev/Laya in production; the development stub locally. */
  moderator: Moderator;
  /** Workers AI (Llama Guard) when Jev/Laya fails; null when no AI binding is configured. */
  fallbackModerator: Moderator | null;
  resolver: Resolver;
  queue: DeliveryQueue | null;
  sender: ChannelSenderClient | null;
  gateway: GatewayClient | null;
  fetch: typeof fetch;
  now: () => Date;
  log: Logger;
}

export const iso = (d: Date) => d.toISOString();
