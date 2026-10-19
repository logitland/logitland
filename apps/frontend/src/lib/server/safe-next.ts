/** A same-site path to return to after sign-in, or the fallback. Rejects other origins, `//host`, `/\host` and `javascript:`. */
export function safeNext(next: string | null | undefined, fallback = '/agents'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  try {
    const url = new URL(next, 'https://dashboard.invalid');
    return url.origin === 'https://dashboard.invalid' ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
