import { DiscordRest } from '@logitland/discord';
import { ConfigError, buildConfig, checkConfig, parseOldKeys, type RelayBindings } from './config';
import type { ChannelSenderClient, GatewayClient, Relay, ShowcaseHub, StreamHub } from './context';
import { SecretBox } from './crypto';
import { consoleLogger, type Logger } from './log';
import { dohResolver, type Resolver } from './services/destinations';
import { devModerator, unconfiguredModerator, type Moderator } from './services/moderation/classifier';
import { typesafeModerator } from './services/moderation/jev';

export { internalApp, relayApp } from './app';
export { authMd } from './docs/auth-doc';
export { skillMd } from './docs/skill-doc';
export { ConfigError, checkConfig, type RelayBindings } from './config';
export type {
  AvatarBucket,
  ChannelSenderClient,
  Db,
  DeliveryMessage,
  DeliveryQueue,
  GatewayClient,
  Relay,
  RelayConfig,
  ShowcaseHub,
  Stmt,
  StreamHub,
} from './context';
export { SecretBox, hmac, randomToken, sha256 } from './crypto';
export { RelayError } from './errors';
export * from './gateway';
export { handleScheduled } from './jobs';
export { consoleLogger, memoryLogger, type Logger } from './log';
export { attemptDelivery, drainDue, handleDeliveryBatch, pushDue, replayDelivery, wake, type AttemptResult } from './services/deliveries';
export { checkUrl, isPublicAddress, preflightDestination, dohResolver, DestinationRefused, type Resolver } from './services/destinations';
export { ingest, type IntakeBatch } from './services/intake';
export { devModerator, type Moderator } from './services/moderation/classifier';
export { typesafeModerator } from './services/moderation/jev';
export { processSend } from './services/sending';
export { CLOSE_NOT_ACTIVE, setStreamSockets, streamTake, type StreamTake } from './services/streams';
export type { AgentPrincipal, AgentRecord, ClientInfo } from './types';

export interface RelayOverrides {
  fetch?: typeof fetch;
  now?: () => Date;
  moderator?: Moderator;
  resolver?: Resolver;
  discord?: DiscordRest;
  sender?: ChannelSenderClient | null;
  gateway?: GatewayClient | null;
  streams?: StreamHub | null;
  showcase?: ShowcaseHub | null;
  log?: Logger;
}

/** Builds the relay, or throws ConfigError naming every missing or unsafe setting. Never starts half-configured. */
export function createRelay(env: RelayBindings, overrides: RelayOverrides = {}): Relay {
  const problems = checkConfig(env);
  if (problems.length) throw new ConfigError(problems);
  const config = buildConfig(env);
  const f = overrides.fetch ?? fetch.bind(globalThis);
  const discord =
    overrides.discord ??
    new DiscordRest({ botToken: env.DISCORD_BOT_TOKEN, fetch: f, ...(config.development && env.DISCORD_API_BASE ? { base: env.DISCORD_API_BASE } : {}) });
  const moderator =
    overrides.moderator ??
    (env.TYPESAFE_API_KEY
      ? typesafeModerator(env.TYPESAFE_API_KEY, env.JEV_MODEL || undefined, f)
      : config.development
        ? devModerator()
        : unconfiguredModerator());
  return {
    db: env.DB,
    config,
    secrets: new SecretBox({ id: env.RELAY_SECRET_KEY_ID ?? 'k1', key: env.RELAY_SECRET_KEY }, parseOldKeys(env.RELAY_SECRET_KEYS_OLD)),
    discord,
    moderator,
    resolver: overrides.resolver ?? dohResolver(f),
    queue: env.DELIVERIES ?? null,
    avatars: env.AVATARS ?? null,
    sender: overrides.sender ?? null,
    gateway: overrides.gateway ?? null,
    streams: overrides.streams ?? null,
    showcase: overrides.showcase ?? null,
    fetch: f,
    now: overrides.now ?? (() => new Date()),
    log: overrides.log ?? consoleLogger({ service: 'relay' }),
  };
}
