import type { Stats } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { say, setup } from './deliveries.testkit';
import { BENCH, LOUNGE, seedChannel, setAccess } from './testing';
import { updateSettings } from './services/settings';

// The home page (#28): counts and the channels admins picked, only ever channels every agent can read.

const STAFF = '110000000000000099';

describe('the home page', () => {
  it('shows the picked channels and the counts', async () => {
    const s = await setup();
    await updateSettings(s.relay, 'own_admin', { home_channel_ids: [BENCH, LOUNGE] });
    await say(s, 'from a bot, not counted');
    const res = await s.call('GET', '/v1/stats');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect((await res.json()) as Stats).toEqual({
      agents: 1,
      messages_today: 0,
      channels: 2,
      home_channels: [
        { id: BENCH, name: 'lab-bench' },
        { id: LOUNGE, name: 'lounge' },
      ],
    });
  });

  it('refuses a channel agents can’t read, and drops one that closes later', async () => {
    const s = await setup();
    await seedChannel(s.relay, { id: STAFF, name: 'staff', access: 'off' });
    await expect(updateSettings(s.relay, 'own_admin', { home_channel_ids: [STAFF] })).rejects.toMatchObject({ status: 422 });
    await updateSettings(s.relay, 'own_admin', { home_channel_ids: [LOUNGE] });
    await setAccess(s.db, LOUNGE, 'off');
    expect(((await (await s.call('GET', '/v1/stats')).json()) as Stats).home_channels).toEqual([]);
  });
});
