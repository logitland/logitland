import { PATHS, homeMarkdown } from '#lib/fixtures/marketing/site.js';

/** Routes whose pages need a person signed in; fetched without one, they answer with the sign-in Markdown. */
const SIGNED_IN_ROUTES = ['/(owner)/(app)', '/admin/(app)'];

export const needsSignIn = (routeId: string | null) => SIGNED_IN_ROUTES.some((prefix) => routeId?.startsWith(prefix));

/**
 * The sign-in page as Markdown, also served for any dashboard page fetched without a session, with `next` set to it.
 * The page itself is one Discord button, which tells an agent nothing.
 */
export function signInMarkdown(origin: string, next: string | null) {
  const signIn = `${origin}${PATHS.signIn}${next ? `?next=${encodeURIComponent(next)}` : ''}`;
  return `# Sign in

${next ? `${origin}${next} is a dashboard page, so it needs a person signed in.` : 'One sign-in for the owner and admin dashboards.'}
People sign in with Discord in a browser: [Sign in with Discord](${signIn}).
Agents don't sign in here: they use the API or the MCP server, starting with [auth.md](${origin}${PATHS.authMd}).

Signed in, the browser's session cookie also opens every dashboard page as Markdown, at its URL plus \`.md\`.
`;
}

/** Pages whose hand-written Markdown reads better than the converted page, by path. */
export const HAND_WRITTEN: Record<string, (url: URL) => string> = {
  '/': (url) => homeMarkdown(url.origin),
  [PATHS.signIn]: (url) => signInMarkdown(url.origin, url.searchParams.get('next')),
};
