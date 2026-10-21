import * as Sentry from '@sentry/cloudflare';
import { WorkerEntrypoint } from 'cloudflare:workers';
import {
  ConfigError,
  consoleLogger,
  createRelay,
  handleDeliveryBatch,
  handleScheduled,
  internalApp,
  relayApp,
  type DeliveryMessage,
  type Relay,
  type RelayBindings,
} from '@logitland/relay';
import { DiscordGateway as GatewayObject, gatewayClient } from './gateway';
import { reportError, sentryOptions, type SentryBindings } from './sentry';
import { ChannelSender as SenderObject, senderClient } from './sender';
import { AgentStream as StreamObject, streamHub } from './stream';

// The Durable Objects as deployed: each wrapped so Sentry captures what its handlers and RPC methods throw.
export const DiscordGateway = Sentry.instrumentDurableObjectWithSentry(sentryOptions, GatewayObject);
export type DiscordGateway = GatewayObject;
export const ChannelSender = Sentry.instrumentDurableObjectWithSentry(sentryOptions, SenderObject);
export type ChannelSender = SenderObject;
export const AgentStream = Sentry.instrumentDurableObjectWithSentry(sentryOptions, StreamObject);
export type AgentStream = StreamObject;

export interface Bindings extends Omit<RelayBindings, 'DB' | 'DELIVERIES'>, SentryBindings {
  DB: D1Database;
  DELIVERIES?: Queue<DeliveryMessage>;
  GATEWAY: DurableObjectNamespace<DiscordGateway>;
  CHANNEL_SENDER: DurableObjectNamespace<ChannelSender>;
  AGENT_STREAM: DurableObjectNamespace<AgentStream>;
}

const log = consoleLogger({ service: 'relay' }, reportError);

// One relay per isolate (per env object), so the apps and clients aren't rebuilt on every request.
const relays = new WeakMap<object, { relay: Relay; publicApp: ReturnType<typeof relayApp>; internal: ReturnType<typeof internalApp> }>();

export function relayFor(env: Bindings) {
  let hit = relays.get(env);
  if (!hit) {
    const relay = createRelay(env as unknown as RelayBindings, {
      sender: senderClient(env.CHANNEL_SENDER),
      gateway: gatewayClient(env.GATEWAY),
      streams: streamHub(env.AGENT_STREAM),
      log,
    });
    hit = { relay, publicApp: relayApp(relay), internal: internalApp(relay) };
    relays.set(env, hit);
  }
  return hit;
}

/** A misconfigured relay answers 503 and logs which settings are wrong (names only), instead of running half-protected. */
function misconfigured(err: unknown): Response {
  if (!(err instanceof ConfigError)) throw err;
  log.error('config.invalid', { problems: err.problems.join('; ') });
  return Response.json(
    { type: 'https://logitland.invalid/problems/misconfigured', title: 'The relay is not configured correctly', status: 503, code: 'misconfigured' },
    { status: 503, headers: { 'content-type': 'application/problem+json' } },
  );
}

export default Sentry.withSentry(sentryOptions, {
  async fetch(request, env, ctx) {
    let app;
    try {
      app = relayFor(env).publicApp;
    } catch (err) {
      return misconfigured(err);
    }
    return app.fetch(request, env, ctx);
  },
  async queue(batch, env) {
    await handleDeliveryBatch(relayFor(env).relay, batch.messages);
  },
  async scheduled(controller, env, _ctx) {
    await handleScheduled(relayFor(env).relay, controller.scheduledTime);
  },
} satisfies ExportedHandler<Bindings, DeliveryMessage>);

/**
 * The dashboard's API. Bound by the web app as a service binding with `entrypoint: "InternalApi"`;
 * named entrypoints aren't routed from the internet, so /internal never reaches the public hostname.
 */
class InternalApiEntrypoint extends WorkerEntrypoint<Bindings> {
  override async fetch(request: Request): Promise<Response> {
    let app;
    try {
      app = relayFor(this.env).internal;
    } catch (err) {
      return misconfigured(err);
    }
    return app.fetch(request, this.env, this.ctx);
  }
}
export const InternalApi = Sentry.withSentry(sentryOptions, InternalApiEntrypoint);
