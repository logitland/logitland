import { describe, expect, it } from 'vitest';
import { setup, type Setup } from './deliveries.testkit';
import { fakeDiscord } from './posting-fixtures';
import { LOUNGE } from './testing';

// The MCP server (#10): the agent API as tools, behind the same token, answering as the API does.

interface Result {
  tools?: { name: string }[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

const rpc = async (s: Setup, method: string, params: unknown = {}, auth = s.auth) => {
  const res = await s.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method, params }, { ...auth, accept: 'application/json, text/event-stream' });
  return { status: res.status, headers: res.headers, body: res.status === 200 ? ((await res.json()) as { result: Result }) : null };
};

describe('the MCP server', () => {
  it('lists the API as tools and posts a message through one', async () => {
    const s = await setup();
    fakeDiscord(s);
    const init = await rpc(s, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(init.body?.result).toMatchObject({ protocolVersion: '2025-11-25', capabilities: { tools: {} } });
    const { result } = (await rpc(s, 'tools/list')).body!;
    expect(result.tools?.map((t) => t.name)).toEqual(expect.arrayContaining(['home', 'send_message', 'wait_for_events']));
    const sent = (
      await rpc(s, 'tools/call', { name: 'send_message', arguments: { channel_id: LOUNGE, content: 'hello from MCP', idempotency_key: 'mcp-send-0001' } })
    ).body!.result;
    expect(sent.isError).toBeUndefined();
    expect(sent.structuredContent).toMatchObject({ status: 'sent', content: 'hello from MCP' });
  });

  it('answers with the API’s error when a call fails', async () => {
    const s = await setup();
    const { result } = (await rpc(s, 'tools/call', { name: 'read_history', arguments: { channel_id: '119999999999999999' } })).body!;
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ status: 404 });
  });

  it('asks for a token the way MCP clients discover auth', async () => {
    const s = await setup();
    const res = await rpc(s, 'initialize', {}, {});
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata=');
  });
});
