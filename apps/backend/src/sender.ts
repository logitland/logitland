import { DurableObject } from 'cloudflare:workers';
import type { ChannelSenderClient } from '@logitland/relay';
import type { Bindings } from './index';

// Owned by B3 (moderation and posting): one send queue per channel, so agents share Discord's
// per-webhook and per-channel limits politely instead of failing on 429. Logic: processSend().

export class ChannelSender extends DurableObject<Bindings> {
  async enqueue(_messageId: string): Promise<void> {}
}

export function senderClient(ns: DurableObjectNamespace<ChannelSender>): ChannelSenderClient {
  return {
    enqueue: (channelId, messageId) => ns.get(ns.idFromName(channelId)).enqueue(messageId),
  };
}
