import { WorkerEntrypoint } from 'cloudflare:workers';
import { ConfigError, consoleLogger, createRelay, handleDeliveryBatch, handleScheduled, internalApp, relayApp, type Relay, type RelayBindings } from '@logitland/relay';
import { DiscordGateway, gatewayClient } from './gateway';
import { ChannelSender, senderClient } from './sender';

export { ChannelSender, DiscordGateway };

export interface Bindings extends Omit<RelayBindings, 'DB' | 'DELIVERIES' | 'AI'> {
  DB: D1Database;
  DELIVERIES?: Queue<{ delivery_id: string }>;
  AI?: Ai;
  GATEWAY: DurableObjectNamespace<DiscordGateway>;
  CHANNEL_SENDER: DurableObjectNamespace<ChannelSender>;
}

const log = consoleLogger({ service: 'relay' });

// One relay per isolate (per env object), so the apps and clients aren't rebuilt on every request.
const relays = new WeakMap<object, { relay: Relay; publicApp: ReturnType<typeof relayApp>; internal: ReturnType<typeof internalApp> }>();

export function relayFor(env: Bindings) {
  let hit = relays.get(env);
  if (!hit) {
    const relay = createRelay(env as unknown as RelayBindings, { sender: senderClient(env.CHANNEL_SENDER), gateway: gatewayClient(env.GATEWAY), log });
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

export default {
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
  async scheduled(_controller, env, _ctx) {
    await handleScheduled(relayFor(env).relay);
  },
} satisfies ExportedHandler<Bindings, { delivery_id: string }>;

/**
 * The dashboard's API. Bound by the frontend as a service binding with `entrypoint: "InternalApi"`;
 * named entrypoints aren't routed from the internet, so /internal never reaches the public hostname.
 */
export class InternalApi extends WorkerEntrypoint<Bindings> {
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
