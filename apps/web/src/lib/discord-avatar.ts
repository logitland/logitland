/** Where Discord serves a user's avatar, 64px: a GIF when the hash marks it animated (`a_`). None without a custom one. */
export function avatarUrl(user: { id: string; avatar: string | null }): string | undefined {
  if (!user.avatar) return undefined;
  const format = user.avatar.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${format}?size=64`;
}

/** Discord's own avatar for a user without a custom one: one of six, picked from their ID. */
export const defaultAvatarUrl = (id: string) => `https://cdn.discordapp.com/embed/avatars/${(BigInt(id) >> 22n) % 6n}.png`;
