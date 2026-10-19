import { DiscordRest } from '@logitland/discord';
import { ConfigError, buildConfig, checkConfig, parseOldKeys, type RelayBindings } from './config';
import type { ChannelSenderClient, GatewayClient, Relay } from './context';
import { SecretBox } from './crypto';
import { consoleLogger, type Logger } from './log';
import { dohResolver, type Resolver } from './services/destinations';
import { devModerator, httpModerator, workersAiModerator, type Moderator } from './services/moderation/classifier';

export { internalApp, relayApp } from './app';
export { authMd } from './authmd';
export { ConfigError, checkConfig, type RelayBindings } from './config';
export type { AiBinding, ChannelSenderClient, Db, DeliveryQueue, GatewayClient, Relay, RelayConfig, Stmt } from './context';
export { SecretBox, hmac, randomToken, sha256 } from './crypto';
export { RelayError } from './errors';
export { handleScheduled } from './jobs';
export { consoleLogger, memoryLogger, type Logger } from './log';
export { attemptDelivery, drainDue, fanOut, handleDeliveryBatch, replayDelivery, type AttemptResult } from './services/deliveries';
export { checkUrl, isPublicAddress, preflightDestination, dohResolver, DestinationRefused, type Resolver } from './services/destinations';
export { ingest, type IntakeBatch } from './services/intake';
export { devModerator, httpModerator, workersAiModerator, type Moderator } from './services/moderation/classifier';
export { processSend } from './services/sending';
export type { AgentPrincipal, AgentRecord, ClientInfo } from './types';

export interface RelayOverrides {
  fetch?: typeof fetch;
  now?: () => Date;
  moderator?: Moderator;
  fallbackModerator?: Moderator | null;
  resolver?: Resolver;
  discord?: DiscordRest;
  sender?: ChannelSenderClient | null;
  gateway?: GatewayClient | null;
  log?: Logger;
}

/** Builds the relay, or throws ConfigError naming every missing or unsafe setting. Never starts half-configured. */
export function createRelay(env: RelayBindings, overrides: RelayOverrides = {}): Relay {
  const problems = checkConfig(env);
  if (problems.length) throw new ConfigError(problems);
  const config = buildConfig(env);
  const f = overrides.fetch ?? fetch.bind(globalThis);
  const discord = overrides.discord ?? new DiscordRest({ botToken: env.DISCORD_BOT_TOKEN, fetch: f });
  let moderator = overrides.moderator;
  if (!moderator) {
    if (env.JEV_LAYA_URL && env.JEV_LAYA_TOKEN) moderator = httpModerator(env.JEV_LAYA_URL, env.JEV_LAYA_TOKEN, f);
    else if (config.development) moderator = devModerator();
    else moderator = { review: async () => ({ verdict: null, unavailable: true as const, reason: 'Jev/Laya isn’t configured' }) };
  }
  return {
    db: env.DB,
    config,
    secrets: new SecretBox({ id: env.RELAY_SECRET_KEY_ID ?? 'k1', key: env.RELAY_SECRET_KEY }, parseOldKeys(env.RELAY_SECRET_KEYS_OLD)),
    discord,
    moderator,
    fallbackModerator: overrides.fallbackModerator !== undefined ? overrides.fallbackModerator : env.AI ? workersAiModerator(env.AI) : null,
    resolver: overrides.resolver ?? dohResolver(f),
    queue: env.DELIVERIES ?? null,
    sender: overrides.sender ?? null,
    gateway: overrides.gateway ?? null,
    fetch: f,
    now: overrides.now ?? (() => new Date()),
    log: overrides.log ?? consoleLogger({ service: 'relay' }),
  };
}
