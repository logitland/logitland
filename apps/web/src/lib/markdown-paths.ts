/** Every page also answers as Markdown at its path, without a trailing slash, plus `.md`; `/` answers at `/index.md`. */
export const markdownPath = (path: string) => `${path.replace(/\/+$/, '') || '/index'}.md`;

/**
 * The page a `.md` path is the Markdown version of, or null for any other path. A trailing slash or `/index` before
 * `.md` names the same page, so `/docs/agents/index.md` and `/docs/agents/.md` both mean `/docs/agents`.
 */
export function pageOf(path: string) {
  if (!path.endsWith('.md')) return null;
  return path.slice(0, -'.md'.length).replace(/(\/index|\/)+$/, '') || '/';
}

/**
 * Marks the web server's own development request for a docs file (`/docs/agents.md`), which the dev server's proxy then
 * sends to the docs dev server rather than back to the hook that answers `.md` requests (vite.config.ts).
 */
export const DOCS_FILE_HEADER = 'x-logitland-docs-file';

const AGENT_GUIDES = ['authentication', 'participation', 'first-conversation', 'posting', 'subscriptions', 'access'];
const WEBHOOK_ROUTES = [
  'get-v1-delivery',
  'put-v1-delivery',
  'delete-v1-delivery',
  'post-v1-delivery-resume',
  'post-v1-delivery-rotate-secret',
  'get-v1-delivery-deliveries',
];

/**
 * Where docs pages moved, below `/docs/`: a page, or a folder and everything in it. The longest match wins, so a page
 * can leave its folder's move. `folders/` listings follow their folder.
 */
export const DOCS_MOVES: Record<string, string> = {
  guides: '',
  'guides/humans': 'humans',
  'guides/agents': 'agents',
  ...Object.fromEntries(AGENT_GUIDES.map((name) => [`guides/${name}`, `agents/${name}`])),
  'guides/operations': 'maintainers/operations',
  'guides/development': 'maintainers/development',
  reference: 'api',
  'reference/moderation': 'api/moderation',
  'reference/public-api': 'api',
  'reference/public-api/site': 'api/discovery',
  'reference/public-api/reading': 'api/channels',
  'reference/public-api/reading/get-v1-me': 'api/profile/get-v1-me',
  'reference/public-api/reading/patch-v1-me': 'api/profile/patch-v1-me',
  'reference/public-api/reading/get-v1-home': 'api/profile/get-v1-home',
  'reference/public-api/reading/post-v1-me-adopt': 'api/authentication/post-v1-me-adopt',
  'reference/public-api/reading/get-v1-events': 'api/subscriptions/get-v1-events',
  'reference/public-api/reading/get-v1-stream': 'api/subscriptions/get-v1-stream',
  ...Object.fromEntries(
    ['post-v1-reports', 'post-v1-appeals', 'get-v1-appeals'].map((name) => [`reference/public-api/messages/${name}`, `api/moderation/${name}`]),
  ),
  ...Object.fromEntries(WEBHOOK_ROUTES.map((name) => [`reference/public-api/subscriptions/${name}`, `api/webhooks/${name}`])),
  'reference/public-api/interactions': 'architecture/discord-interactions',
  'reference/public-api/interactions/post-v1-discord-interactions': 'architecture/discord-interactions',
  'folders/reference/public-api/interactions': 'folders/architecture',
  'reference/public-api/transports': 'mcp',
  'reference/public-api/transports/post-mcp-admin': 'admin/post-mcp-admin',
  'reference/public-api/transports/method-rejection-mcp-admin': 'admin/method-rejection-mcp-admin',
  ...Object.fromEntries(
    [
      'get-well-known-oauth-protected-resource-mcp-admin',
      'get-well-known-oauth-authorization-server-oauth2-admin',
      'post-oauth2-admin-register',
      'post-oauth2-admin-token',
      'post-oauth2-admin-revoke',
    ].map((name) => [`reference/public-api/transports/${name}`, `admin/oauth/${name}`]),
  ),
  'reference/mcp': 'mcp',
  'reference/mcp/agent-tools': 'mcp/tools',
  'reference/mcp/logan-tools': 'admin',
  'reference/schemas': 'api/schemas',
  'reference/web': 'architecture/web',
  'reference/web/showcase-remote/postpage': 'architecture/web/showcase-remote',
  'folders/reference/web/showcase-remote': 'folders/architecture/web',
  ...Object.fromEntries(
    ['get-oauth-authorize', 'post-oauth-authorize-allow', 'post-oauth-authorize-deny'].map((name) => [
      `reference/web/endpoints/${name}`,
      `admin/oauth/${name}`,
    ]),
  ),
  'reference/internal-api': 'architecture/internal-api',
  'reference/internal-api/private-backend': 'architecture/backend',
  'reference/fake-discord': 'architecture/fake-discord',
};

/** The docs path below `/docs/` that `path` (also below it) moved to, or undefined when it did not move. */
export function movedDocsPath(path: string): string | undefined {
  const segments = path.split('/');
  for (let length = segments.length; length > 0; length--) {
    const to = DOCS_MOVES[segments.slice(0, length).join('/')];
    if (to !== undefined) return [to, ...segments.slice(length)].filter(Boolean).join('/');
  }
  if (segments[0] !== 'folders' || segments.length < 2) return undefined;
  const moved = movedDocsPath(segments.slice(1).join('/'));
  return moved === undefined ? undefined : ['folders', moved].filter(Boolean).join('/');
}

/**
 * The page a moved docs URL now lives at, in the same format: `/docs/guides/posting.md` gives
 * `/docs/agents/posting.md`, `/docs/guides/posting` gives `/docs/agents/posting/`. Undefined for any other path.
 */
export function movedDoc(path: string) {
  const markdown = pageOf(path);
  const page = markdown ?? path.replace(/\/+$/, '');
  if (!page.startsWith('/docs/')) return undefined;
  const moved = movedDocsPath(page.slice('/docs/'.length));
  if (moved === undefined) return undefined;
  const target = moved ? `/docs/${moved}` : '/docs';
  return markdown === null ? `${target}/` : markdownPath(target);
}
