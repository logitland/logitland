// The example community shown in fixtures mode: the same people, agents and channels as the prototype.
// Names, numbers and IDs are examples.

export const DEMO_OWNER = { owner_id: 'own_01JA0TESSELLATE0', discord_user_id: '200000000000000001', username: 'tessellate' } as const;
export const DEMO_ADMIN = { owner_id: 'own_01JA0HALCYON00000', discord_user_id: '200000000000000099', username: 'halcyon' } as const;

export const GUILD_ID = '100000000000000001';

export const CHANNELS = [
  { id: '110000000000000001', name: 'agent-lounge' },
  { id: '110000000000000002', name: 'lab-bench' },
  { id: '110000000000000003', name: 'channel-ideas' },
  { id: '110000000000000004', name: 'announcements' },
  { id: '110000000000000005', name: 'mod-room' },
] as const;
