import { ChannelList, ConversationPage, ThreadPage } from '@logitland/contracts';
import { Permission } from '@logitland/discord';
import { describe, expect, it } from 'vitest';
import { HUMAN, human, msg, push, thread, world } from './intake-fixtures';
import { GUILD, LOUNGE, seedAgent, seedChannel } from './testing';

// What the `@agents` role can read is open to anyone without a token, limited per address (#65).

const GATED = '110000000000000010';
const PRIVATE = '120000000000000001';
const AVATAR = 'https://relay.logitland.test/v1/avatars/custom.png';

/** A world with #gated, readable from level 3 (its role), and a private conversation under #lounge. */
async function open() {
  const w = await world();
  const role = '100000000000000022';
  await w.h.db
    .prepare('INSERT INTO guild_roles (id, guild_id, name, permissions, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(role, GUILD, 'level 3', '0', w.h.now().toISOString())
    .run();
  await w.h.db.prepare('UPDATE levels SET role_id = ? WHERE level = 3').bind(role).run();
  await seedChannel(w.h.relay, {
    id: GATED,
    name: 'gated',
    overwrites: [
      { id: GUILD, type: 0, deny: String(Permission.VIEW_CHANNEL), allow: '0' },
      { id: role, type: 0, deny: '0', allow: String(Permission.VIEW_CHANNEL | Permission.READ_MESSAGE_HISTORY) },
    ],
  });
  await w.h.db
    .prepare('INSERT INTO threads (id, parent_id, name, created_at, private, updated_at) VALUES (?, ?, ?, ?, 1, ?)')
    .bind(PRIVATE, LOUNGE, 'private', w.h.now().toISOString(), w.h.now().toISOString())
    .run();
  await push(w.h, human(1, { reply_to: null, content: 'in the open' }), human(2, { reply_to: null, thread_id: PRIVATE, content: 'just between us' }));
  /** A request from `ip` without a token. */
  const anyone = (path: string, ip = '203.0.113.7') => w.h.call('GET', path, undefined, { 'cf-connecting-ip': ip });
  return { ...w, anyone };
}

describe('reading without a token', () => {
  it('serves the channels every agent can read, their messages and their threads', async () => {
    const { h, anyone } = await open();
    await push(h, thread(msg(1), LOUNGE, { name: 'a thread' }));
    const channels = ChannelList.parse(await (await anyone('/v1/channels')).json());
    expect(channels.channels.map((c) => c.id)).toEqual([LOUNGE]);
    const page = ConversationPage.parse(await (await anyone(`/v1/channels/${LOUNGE}/messages`)).json());
    expect(page.messages.map((m) => m.content)).toEqual(['in the open', 'hello, people']);
    const threads = ThreadPage.parse(await (await anyone(`/v1/channels/${LOUNGE}/threads`)).json());
    expect(threads.threads.map((t) => [t.name, t.starter?.content])).toEqual([['a thread', 'in the open']]);
  });

  it('refuses channels only higher levels can read, and never shows a private conversation', async () => {
    const { h, anyone } = await open();
    expect((await anyone(`/v1/channels/${GATED}/messages`)).status).toBe(404);
    expect((await anyone(`/v1/channels/${GATED}/threads`)).status).toBe(404);
    const higher = await seedAgent(h.relay, { level: 3 });
    expect((await h.call('GET', `/v1/channels/${GATED}/messages`, undefined, h.as(higher.token))).status).toBe(200);

    const inPrivate = ConversationPage.parse(await (await anyone(`/v1/channels/${LOUNGE}/messages?thread_id=${PRIVATE}`)).json());
    expect(inPrivate.messages).toEqual([]);
    expect(JSON.stringify(await (await anyone(`/v1/channels/${LOUNGE}/threads`)).json())).not.toContain(PRIVATE);
    expect((await anyone('/v1/conversations')).status).toBe(401);
  });

  it('is limited per address, apart from agents’ own allowance', async () => {
    const { h, agent, anyone } = await open();
    for (let i = 0; i < 30; i++) expect((await anyone(`/v1/channels/${LOUNGE}/messages`)).status).toBe(200);
    const refused = await anyone(`/v1/channels/${LOUNGE}/messages`);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await anyone('/v1/channels', '198.51.100.9')).status).toBe(200);
    expect((await h.call('GET', '/v1/channels', undefined, h.as(agent.token))).status).toBe(200);
  });
});

describe('avatars', () => {
  it('come only when asked for, the same for agents and anyone', async () => {
    const { h, agent, anyone } = await open();
    await h.db.prepare('UPDATE agents SET avatar_url = ? WHERE id = ?').bind(AVATAR, agent.id).run();
    const other = await seedAgent(h.relay, { name: 'Lark' });
    await h.db
      .prepare(
        "INSERT INTO conversation (message_id, channel_id, author_kind, agent_id, author_ref, display_name, content, created_at) VALUES (?, ?, 'agent', ?, ?, 'Lark', 'no avatar of my own', ?)",
      )
      .bind(msg(3), LOUNGE, other.id, other.id, h.now().toISOString())
      .run();
    await push(
      h,
      human(4, { reply_to: null, author: { id: HUMAN, username: 'luna', global_name: 'Luna', avatar: 'a_1b2c', bot: false } }),
      human(5, { reply_to: null, author: { id: '200000000000000050', username: 'newsbot', bot: true } }),
    );

    const authors = async (res: Response) => ConversationPage.parse(await res.json()).messages.map((m) => m.author);
    expect((await authors(await anyone(`/v1/channels/${LOUNGE}/messages`))).some((a) => 'avatar_url' in a || 'username' in a)).toBe(false);

    const path = `/v1/channels/${LOUNGE}/messages?include_avatars=true`;
    const shown = await authors(await anyone(path));
    expect(shown.map(({ display_name, avatar_url, username }) => ({ display_name, avatar_url, username }))).toEqual([
      { display_name: 'newsbot', avatar_url: null, username: undefined },
      { display_name: 'Luna', avatar_url: `https://cdn.discordapp.com/avatars/${HUMAN}/a_1b2c.gif?size=64`, username: 'luna' },
      { display_name: 'Lark', avatar_url: `https://relay.logitland.test/v1/avatars/${other.id}.png`, username: undefined },
      { display_name: 'Luna', avatar_url: `https://cdn.discordapp.com/avatars/${HUMAN}/a_1b2c.gif?size=64`, username: 'luna' },
      { display_name: 'Moth-9', avatar_url: AVATAR, username: undefined },
    ]);
    expect(await authors(await h.call('GET', path, undefined, h.as(agent.token)))).toEqual(shown);
  });
});
