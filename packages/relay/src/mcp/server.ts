// A stateless MCP server over Streamable HTTP (spec 2025-11-25, https://modelcontextprotocol.io/specification/2025-11-25):
// one JSON-RPC message per POST, answered with JSON. No sessions, no server-initiated messages and no SSE stream, which
// the spec allows; GET and DELETE answer 405. Only tools are offered. The transport knows nothing about the relay: tools
// come in from tools.ts, which builds them from the API's own contracts.

export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
const LATEST = PROTOCOL_VERSIONS[0];

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  /** JSON Schema for the arguments (an object schema). */
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  call(args: Record<string, unknown>, request: Request): Promise<ToolResult>;
}

export interface McpServer {
  name: string;
  version: string;
  /** Shown to the client at initialize: how to use the server well. */
  instructions: string;
  tools: McpTool[];
}

type Id = string | number | null;
interface Message {
  jsonrpc?: unknown;
  id?: Id;
  method?: unknown;
  params?: unknown;
}

const rpcError = (id: Id, code: number, message: string) => Response.json({ jsonrpc: '2.0', id, error: { code, message } });
const rpcResult = (id: Id, result: unknown) => Response.json({ jsonrpc: '2.0', id, result });

/** Answers one MCP request. Authentication and Origin checks happen before this, in the route. */
export async function handleMcp(server: McpServer, request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  const version = request.headers.get('mcp-protocol-version');
  if (version && !(PROTOCOL_VERSIONS as readonly string[]).includes(version)) return rpcError(null, -32600, `Unsupported MCP-Protocol-Version ${version}`);

  let msg: Message;
  try {
    msg = (await request.clone().json()) as Message;
  } catch {
    return rpcError(null, -32700, 'Parse error: send one JSON-RPC message as JSON');
  }
  if (Array.isArray(msg) || typeof msg !== 'object' || msg === null || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string')
    return rpcError(null, -32600, 'Invalid request: send one JSON-RPC 2.0 message');
  // A notification (no id) or a response from the client is accepted and needs no answer.
  if (msg.id === undefined) return new Response(null, { status: 202 });
  const id = msg.id;
  const params = (msg.params ?? {}) as Record<string, unknown>;

  switch (msg.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : LATEST;
      return rpcResult(id, {
        protocolVersion: (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : LATEST,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: server.name, version: server.version },
        instructions: server.instructions,
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, {
        tools: server.tools.map(({ name, title, description, inputSchema, annotations }) => ({
          name,
          title,
          description,
          inputSchema,
          ...(annotations ? { annotations } : {}),
        })),
      });
    case 'tools/call': {
      const tool = server.tools.find((t) => t.name === params.name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(params.name)}`);
      const args = params.arguments ?? {};
      if (typeof args !== 'object' || args === null || Array.isArray(args)) return rpcError(id, -32602, 'Tool arguments must be an object');
      return rpcResult(id, await tool.call(args as Record<string, unknown>, request));
    }
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}
