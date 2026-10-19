// Channel permission overwrites, applied in Discord's order: @everyone, then roles together, then the member.

import { DiscordError, DiscordRest } from '@logitland/discord';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_BOT_PERMISSIONS, Permission, type DiscordFake } from '../src/index.ts';
import { fixture, type Fixture } from './helpers.ts';

const CHAT = Permission.sendMessages | Permission.sendMessagesInThreads | Permission.createPublicThreads;

let f: Fixture;
let fake: DiscordFake;
let bot: DiscordRest;

beforeAll(async () => {
  f = await fixture();
  fake = f.fake;
  bot = new DiscordRest({ botToken: fake.botToken, base: fake.apiBase });
});
afterAll(() => fake.close());

const refusal = async (p: Promise<unknown>): Promise<DiscordError> => {
  try {
    await p;
  } catch (err) {
    if (err instanceof DiscordError) return err;
    throw err;
  }
  throw new Error('Expected Discord to refuse');
};

describe('channel permissions', () => {
  it('lets only the consent role chat where @everyone is denied, and lets the bot in through its own role', () => {
    const locked = fake.addChannel(f.guild.id, {
      name: 'locked',
      overwrites: [
        { id: f.guild.everyoneRoleId, deny: CHAT },
        { id: f.consentRole.id, allow: CHAT },
        { id: f.guild.botRoleId, allow: ALL_BOT_PERMISSIONS },
      ],
    });
    const can = (user: string) => fake.world.canInChannel(locked.id, user, Permission.sendMessages);
    expect(can(f.alice.id)).toBe(false);
    fake.world.setMemberRole(f.guild.id, f.alice.id, f.consentRole.id, true);
    expect(can(f.alice.id)).toBe(true);
    expect(can(f.bob.id)).toBe(false);
    expect(can(fake.application.id)).toBe(true);
    // Everyone can still read.
    expect(fake.world.canInChannel(locked.id, f.bob.id, Permission.viewChannel)).toBe(true);
    fake.world.setMemberRole(f.guild.id, f.alice.id, f.consentRole.id, false);
  });

  it('a member overwrite beats the roles, and a role allow beats @everyone’s deny', () => {
    const c = fake.addChannel(f.guild.id, {
      name: 'ordered',
      overwrites: [
        { id: f.guild.everyoneRoleId, deny: Permission.sendMessages },
        { id: f.bob.id, type: 'member', allow: Permission.sendMessages },
      ],
    });
    expect(fake.world.canInChannel(c.id, f.bob.id, Permission.sendMessages)).toBe(true);
    expect(fake.world.canInChannel(c.id, f.alice.id, Permission.sendMessages)).toBe(false);
  });

  it('without View Channel nothing else applies, and administrators see everything', () => {
    const hidden = fake.addChannel(f.guild.id, { name: 'hidden', overwrites: [{ id: f.guild.everyoneRoleId, deny: Permission.viewChannel }] });
    expect(fake.world.channelPermissions(hidden.id, f.alice.id)).toBe(0n);
    const admin = fake.addRole(f.guild.id, { name: 'Admin', permissions: Permission.administrator, position: 3 });
    fake.world.setMemberRole(f.guild.id, f.bob.id, admin.id, true);
    expect(fake.world.canInChannel(hidden.id, f.bob.id, Permission.manageWebhooks)).toBe(true);
    fake.world.setMemberRole(f.guild.id, f.bob.id, admin.id, false);
  });

  it('threads use their parent’s overwrites', () => {
    const parent = fake.addChannel(f.guild.id, {
      name: 'parent',
      overwrites: [
        { id: f.guild.everyoneRoleId, deny: Permission.sendMessagesInThreads },
        { id: f.guild.botRoleId, allow: Permission.sendMessagesInThreads },
      ],
    });
    const starter = fake.world.postMessage(parent.id, { author: fake.world.botUser, content: 'x' });
    const thread = fake.world.createThreadFromMessage(parent.id, starter.id, { name: 't', ownerId: fake.application.id });
    expect(fake.world.canInChannel(thread.id, f.alice.id, Permission.sendMessagesInThreads)).toBe(false);
    expect(fake.world.canInChannel(thread.id, fake.application.id, Permission.sendMessagesInThreads)).toBe(true);
  });

  it('the REST API applies them to the bot', async () => {
    const noSend = fake.addChannel(f.guild.id, { name: 'no-send', overwrites: [{ id: f.guild.botRoleId, deny: Permission.sendMessages }] });
    expect(await refusal(bot.createMessage(noSend.id, { content: 'x' }))).toMatchObject({ status: 403, code: 50013 });
    const noHooks = fake.addChannel(f.guild.id, { name: 'no-hooks', overwrites: [{ id: f.guild.botRoleId, deny: Permission.manageWebhooks }] });
    expect(await refusal(bot.createWebhook(noHooks.id, 'Relay', 'x'))).toMatchObject({ status: 403, code: 50013 });
    const noView = fake.addChannel(f.guild.id, { name: 'no-view', overwrites: [{ id: f.guild.botRoleId, deny: Permission.viewChannel }] });
    expect(await refusal(bot.getChannelMessages(noView.id))).toMatchObject({ status: 403, code: 50001 });
    const noHistory = fake.addChannel(f.guild.id, { name: 'no-history', overwrites: [{ id: f.guild.botRoleId, deny: Permission.readMessageHistory }] });
    fake.world.postMessage(noHistory.id, { author: f.alice, content: 'unseen' });
    expect(await bot.getChannelMessages(noHistory.id)).toEqual([]);
    const noThreads = fake.addChannel(f.guild.id, { name: 'no-threads', overwrites: [{ id: f.guild.botRoleId, deny: Permission.createPublicThreads }] });
    const m = fake.say(noThreads.id, { as: f.alice, content: 'x' });
    expect(await refusal(bot.startThreadFromMessage(noThreads.id, m.id, { name: 'n' }))).toMatchObject({ status: 403, code: 50013 });
  });

  it('the channel object carries the overwrites as Discord sends them', async () => {
    const c = fake.addChannel(f.guild.id, { name: 'shown', overwrites: [{ id: f.consentRole.id, allow: CHAT, deny: Permission.manageMessages }] });
    const read = (await bot.getChannel(c.id)) as unknown as { permission_overwrites: unknown[] };
    expect(read.permission_overwrites).toEqual([{ id: f.consentRole.id, type: 0, allow: String(CHAT), deny: String(Permission.manageMessages) }]);
  });

  it('say() can refuse people who may not chat, as Discord’s apps do', () => {
    const c = fake.addChannel(f.guild.id, {
      name: 'members-only',
      overwrites: [
        { id: f.guild.everyoneRoleId, deny: CHAT },
        { id: f.consentRole.id, allow: CHAT },
      ],
    });
    expect(() => fake.say(c.id, { as: f.alice, content: 'x', enforcePermissions: true })).toThrow(/may not send/);
    expect(fake.say(c.id, { as: f.alice, content: 'x' }).content).toBe('x');
    fake.world.setMemberRole(f.guild.id, f.alice.id, f.consentRole.id, true);
    expect(fake.say(c.id, { as: f.alice, content: 'allowed', enforcePermissions: true }).content).toBe('allowed');
    fake.world.setMemberRole(f.guild.id, f.alice.id, f.consentRole.id, false);
  });
});
