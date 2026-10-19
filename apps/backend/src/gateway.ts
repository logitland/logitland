import { DurableObject } from 'cloudflare:workers';
import type { GatewayClient } from '@logitland/relay';
import type { Bindings } from './index';

// Owned by B1 (intake and reading): the Discord Gateway client. One instance, named "discord".
// Protocol logic lives in packages/relay/src/gateway so it can be tested in Node.

export class DiscordGateway extends DurableObject<Bindings> {
  async ensure(): Promise<void> {}

  async status(): Promise<Record<string, unknown>> {
    return { state: 'not built' };
  }
}

export function gatewayClient(ns: DurableObjectNamespace<DiscordGateway>): GatewayClient {
  const stub = () => ns.get(ns.idFromName('discord'));
  return {
    ensure: () => stub().ensure(),
    status: () => stub().status(),
  };
}
