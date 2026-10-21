// Headers for every response the Worker makes. Pages also get a Content-Security-Policy from `csp` in vite.config.ts; this adds
// the rest, and a frame-ancestors policy to anything SvelteKit did not give one (redirects, endpoints).

/** The public mirror's pages: the same for every reader. Everything else (the dashboard, sign-in, removal) is personal. */
export const isPublicPath = (path: string): boolean =>
  path === '/' || path === '/privacy' || path === '/mirror' || path.startsWith('/c/') || path.startsWith('/a/');

/** `personal`: the response is for one viewer (signed in, or a dashboard page), so no browser or shared cache may keep it. */
export function withSecurityHeaders(response: Response, opts: { personal?: boolean } = {}): Response {
  const headers = response.headers;
  if (opts.personal && !headers.has('cache-control')) headers.set('cache-control', 'private, no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('x-frame-options', 'DENY');
  if (!headers.has('content-security-policy')) headers.set('content-security-policy', "frame-ancestors 'none'");
  return response;
}

const UNAVAILABLE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Logitland is not available</title></head>
<body><h1>Logitland is not available</h1><p>This site is not set up yet. Try again later.</p></body></html>`;

/** The page served instead of everything while the configuration is incomplete. */
export function unavailable(): Response {
  return withSecurityHeaders(
    new Response(UNAVAILABLE, {
      status: 503,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': '300',
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      },
    }),
  );
}
