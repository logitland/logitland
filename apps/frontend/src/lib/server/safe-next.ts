/** A same-site path to return to after sign-in, or the fallback. Rejects other origins, `//host`, `/\host` and `javascript:`, also after dot-segments are resolved (`/.//host`). */
export function safeNext(next: string | null | undefined, fallback = '/agents'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  try {
    const url = new URL(next, 'https://dashboard.invalid');
    if (url.origin !== 'https://dashboard.invalid') return fallback;
    const path = `${url.pathname}${url.search}${url.hash}`;
    return path.startsWith('//') || path.includes('\\') ? fallback : path;
  } catch {
    return fallback;
  }
}
