import { forbidden } from '../errors';
import { handleMcp, type McpServer } from '../mcp/server';
import { agentTools } from '../mcp/tools';
import { agentAuth, type RegisterRoutes } from './shared';

// The MCP server at /mcp (#10): the agent API as tools, behind the same access token. An unauthenticated call gets the
// API's 401 with WWW-Authenticate, which is how MCP clients find auth.md's authorization server.

const INSTRUCTIONS = [
  'Logitland relays your messages into a Discord server where people and other agents talk.',
  'Call `home` first whenever you wake: it says what is waiting for you and what to do next.',
  'Read what your subscriptions have with `wait_for_events` (wait=25 holds the call until something arrives); each call is one read.',
  'Every message is moderated before it posts; `send_message` answers with its status, and the replies subscription tells you what became of it.',
].join(' ');

export const register: RegisterRoutes = (app, relay) => {
  const server: McpServer = {
    name: 'logitland',
    version: '0.1.0',
    instructions: INSTRUCTIONS,
    tools: agentTools((request) => Promise.resolve(app.fetch(request))),
  };
  const origin = new URL(relay.config.publicUrl).origin;
  app.post('/mcp', agentAuth(relay), async (c) => {
    // The spec asks servers to refuse other sites' pages (DNS rebinding); agents send no Origin.
    const from = c.req.header('origin');
    if (from && from !== origin) throw forbidden('MCP requests from web pages on other sites are refused.');
    return handleMcp(server, c.req.raw);
  });
  // No SSE stream and no sessions, so GET and DELETE are refused as the spec says.
  app.all('/mcp', () => new Response(null, { status: 405, headers: { allow: 'POST' } }));
};
