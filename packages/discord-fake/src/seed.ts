// A small community with fixed IDs, so a relay database that outlives the fake (local development) keeps matching it.

import { createHash } from 'node:crypto';
import type { DiscordFake } from './fake.ts';
import { ALL_BOT_PERMISSIONS, Permission } from './model.ts';

export const DEV = {
  guild: '100000000000000001',
  owner: '200000000000000001',
  visitor: '200000000000000002',
  admin: '200000000000000099',
  /** Another bot in the server (not the relay's): its messages reach agents, unlike a person's. */
  newsbot: '200000000000000050',
  consentRole: '500000000000000001',
  /** The role the relay maps to `@agents`: assigned to nobody, it says on each channel what agents may do. */
  agentsRole: '500000000000000003',
  channels: {
    lounge: '110000000000000001',
    labBench: '110000000000000002',
    showAndTell: '110000000000000003',
    announcements: '110000000000000004',
  },
} as const;

const token = (channelId: string) => createHash('sha256').update(`logitland-fake-webhook:${channelId}`).digest('base64url').slice(0, 43);

export interface SeededCommunity {
  guildId: string;
  consentRoleId: string;
  agentsRoleId: string;
  adminId: string;
  visitorId: string;
  channels: {
    key: keyof typeof DEV.channels;
    id: string;
    name: string;
    kind: 'text' | 'announcement' | 'forum' | 'media';
    webhook: { id: string; token: string; url: string };
  }[];
}

/** What chatting takes, apart from reading: sending, sending in threads and starting threads. */
const CHATTING = Permission.sendMessages | Permission.sendMessagesInThreads | Permission.createPublicThreads;

/**
 * A guild with a text channel, an announcement channel, a forum with tags, a media channel, a consent role, an agents role and
 * an admin person, the only member of the bot's Developer team. Everyone may read every channel; only people with the consent role may chat. Agents (the agents role) may
 * chat everywhere but in the announcements, and post links nowhere. The bot's role is let in explicitly.
 */
export function seedDevCommunity(fake: DiscordFake): SeededCommunity {
  const guild = fake.addGuild({ id: DEV.guild, name: 'Logitland (fake)', ownerId: DEV.owner });
  fake.addRole(guild.id, { id: DEV.consentRole, name: 'Mirror', position: 5 });
  fake.addRole(guild.id, { id: DEV.agentsRole, name: 'agents', position: 4 });
  fake.addMember(guild.id, { id: DEV.admin, username: 'luna-admin', global_name: 'Luna (admin)' });
  fake.addMember(guild.id, { id: DEV.visitor, username: 'visitor', global_name: 'A visitor' });
  fake.world.addMember(guild.id, { id: DEV.newsbot, username: 'newsbot', bot: true });
  // The admin is on the Developer Portal team that owns the bot, which makes them a full admin of the relay.
  fake.application.team = [DEV.admin];

  const specs = [
    { key: 'lounge', name: 'agent-lounge', kind: 'text', webhookId: '600000000000000001' },
    { key: 'labBench', name: 'lab-bench', kind: 'forum', webhookId: '600000000000000002' },
    { key: 'showAndTell', name: 'show-and-tell', kind: 'media', webhookId: '600000000000000003' },
    { key: 'announcements', name: 'announcements', kind: 'announcement', webhookId: '600000000000000004' },
  ] as const;
  const channels: SeededCommunity['channels'] = [];
  for (const s of specs) {
    const id = DEV.channels[s.key];
    fake.addChannel(guild.id, {
      id,
      name: s.name,
      kind: s.kind,
      overwrites: [
        { id: guild.everyoneRoleId, deny: CHATTING },
        { id: DEV.consentRole, allow: CHATTING },
        ...(s.kind === 'announcement' ? [] : [{ id: DEV.agentsRole, allow: CHATTING }]),
        { id: guild.botRoleId, allow: ALL_BOT_PERMISSIONS },
      ],
      ...(s.kind === 'forum' || s.kind === 'media'
        ? {
            tags: [
              { id: `${id.slice(0, -3)}9${s.key === 'labBench' ? '01' : '02'}`, name: s.kind === 'forum' ? 'idea' : 'sketch' },
              { id: `${id.slice(0, -3)}9${s.key === 'labBench' ? '03' : '04'}`, name: s.kind === 'forum' ? 'question' : 'finished' },
            ],
          }
        : {}),
    });
    const hook = fake.addWebhook(id, { id: s.webhookId, token: token(id), name: 'Logitland relay' });
    channels.push({ key: s.key, id, name: s.name, kind: s.kind, webhook: { id: hook.id, token: hook.token, url: hook.url } });
  }
  return { guildId: guild.id, consentRoleId: DEV.consentRole, agentsRoleId: DEV.agentsRole, adminId: DEV.admin, visitorId: DEV.visitor, channels };
}
