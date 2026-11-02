import { ConversationPage, RelayEvent } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { HUMAN, STRANGER, human, msg, push, subscribe, thread, world } from './intake-fixtures';
import { DIGEST_MAX, readFeed, readableChannels, type SubscriptionRow } from './services/feed';
import { BENCH, GUILD, LOUNGE } from './testing';

// Readers get the names behind Discord's tags in content, and no name the relay may not show.

const UNKNOWN_ROLE = '100000000000000077';
/** Luna (who agreed) tags themselves, a stranger, an open and a closed channel, @everyone and a role the relay never saw. */
const CONTENT = `hey <@${HUMAN}> <@!${STRANGER}>, see <#${LOUNGE}> <#${BENCH}>, <@&${GUILD}> <@&${UNKNOWN_ROLE}>`;
const NAMES = {
  users: { [HUMAN]: { name: 'Luna' } },
  roles: { [GUILD]: { name: 'everyone' } },
  channels: { [LOUNGE]: { name: 'lounge' } },
};

describe('mentions', () => {
  it('name the people who agreed, roles, and channels every agent can read, on the open read', async () => {
    const { h } = await world();
    await push(h, human(1, { reply_to: null, content: 'no tags here' }), human(2, { reply_to: null, content: CONTENT }));
    const res = await h.call('GET', `/v1/channels/${LOUNGE}/messages`, undefined, { 'cf-connecting-ip': '203.0.113.7' });
    const page = ConversationPage.parse(await res.json());
    expect(page.messages.find((m) => m.message_id === msg(2))!.mentions).toEqual(NAMES);
    expect(page.messages.find((m) => m.message_id === msg(1))).not.toHaveProperty('mentions');
  });

  it('name a thread in a channel every agent can read', async () => {
    const { h } = await world();
    await push(h, human(1), thread(msg(1), LOUNGE, { name: 'plans' }), human(2, { reply_to: null, content: `see <#${msg(1)}>` }));
    const res = await h.call('GET', `/v1/channels/${LOUNGE}/messages`, undefined, { 'cf-connecting-ip': '203.0.113.7' });
    const page = ConversationPage.parse(await res.json());
    expect(page.messages.find((m) => m.message_id === msg(2))!.mentions!.channels).toEqual({ [msg(1)]: { name: 'plans' } });
  });

  it('ride the events a subscription is given', async () => {
    const { h, agent } = await world();
    const id = await subscribe(h, agent.id);
    await push(h, human(1, { reply_to: null, content: CONTENT }));
    const sub = (await h.db
      .prepare('SELECT s.*, a.level, a.owner_id FROM subscriptions s JOIN agents a ON a.id = s.agent_id WHERE s.id = ?')
      .bind(id)
      .first<SubscriptionRow & { level: number; owner_id: string | null }>())!;
    const { events } = await readFeed(h.relay, sub, sub.cursor, DIGEST_MAX, await readableChannels(h.relay, sub));
    const created = RelayEvent.parse(events.find((e) => e.type === 'message.created'));
    expect(created.type === 'message.created' && created.data.mentions).toEqual(NAMES);
  });
});
