import { describe, expect, it } from 'vitest';
import { avatarUrl, defaultAvatarUrl } from '../src/lib/discord-avatar.ts';

describe('Discord avatar URL', () => {
  // Proves the account menu asks Discord's CDN for the right image, animated or not, and for none without a custom one.
  it.each([
    ['1f2e3d', 'https://cdn.discordapp.com/avatars/42/1f2e3d.png?size=64'],
    ['a_1f2e3d', 'https://cdn.discordapp.com/avatars/42/a_1f2e3d.gif?size=64'],
    [null, undefined],
  ])('avatar %s → %s', (avatar, url) => {
    expect(avatarUrl({ id: '42', avatar })).toBe(url);
  });

  // Discord's rule for usernames without a discriminator: (id >> 22) % 6. 1562476123131093042 >> 22 is 372523337157.
  it('picks the default avatar Discord shows from the user ID', () => {
    expect(defaultAvatarUrl('1562476123131093042')).toBe('https://cdn.discordapp.com/embed/avatars/3.png');
  });
});
