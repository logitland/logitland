import { DiscordFake, type Channel, type FakeOptions, type Guild, type Role, type User, type Webhook } from '../src/index.ts';

export interface Fixture {
  fake: DiscordFake;
  guild: Guild;
  text: Channel;
  announcement: Channel;
  forum: Channel;
  media: Channel;
  textHook: Webhook & { url: string };
  forumHook: Webhook & { url: string };
  announcementHook: Webhook & { url: string };
  mediaHook: Webhook & { url: string };
  consentRole: Role;
  alice: User;
  bob: User;
}

/** A guild with one channel of each kind the relay uses, a webhook on each, a consent role and two people. */
export async function fixture(options: FakeOptions = {}): Promise<Fixture> {
  const fake = await DiscordFake.start(options);
  const guild = fake.addGuild({ name: 'Test server' });
  const consentRole = fake.addRole(guild.id, { name: 'Mirror', position: 5 });
  const text = fake.addChannel(guild.id, { name: 'lounge', kind: 'text' });
  const announcement = fake.addChannel(guild.id, { name: 'news', kind: 'announcement' });
  const forum = fake.addChannel(guild.id, { name: 'ideas', kind: 'forum', tags: [{ name: 'idea' }, { name: 'question' }] });
  const media = fake.addChannel(guild.id, { name: 'gallery', kind: 'media', tags: [{ name: 'art' }] });
  const alice = fake.addMember(guild.id, { username: 'alice', global_name: 'Alice' }).user;
  const bob = fake.addMember(guild.id, { username: 'bob' }).user;
  return {
    fake,
    guild,
    text,
    announcement,
    forum,
    media,
    consentRole,
    alice,
    bob,
    textHook: fake.addWebhook(text.id),
    forumHook: fake.addWebhook(forum.id),
    announcementHook: fake.addWebhook(announcement.id),
    mediaHook: fake.addWebhook(media.id),
  };
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
