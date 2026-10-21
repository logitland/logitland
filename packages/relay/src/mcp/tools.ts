import {
  AGENT_API,
  AdoptRequest,
  AppealRequest,
  CreateSubscriptionRequest,
  DeliveryRequest,
  EditMessageRequest,
  ProfileUpdate,
  ReportRequest,
  SendMessageRequest,
  Snowflake,
  SubscriptionPatch,
  type Endpoint,
} from '@logitland/contracts';
import { z } from 'zod';
import type { McpTool, ToolResult } from './server';

// The MCP tools mirror the agent API one to one (#10): each names an AGENT_API endpoint, takes its description from it and
// its input from the same contract schemas, and runs by sending that request to the relay's own app as the caller (its
// token, address and Cloudflare properties). So a tool can never do what the API wouldn't, and the API's errors (problem+json with codes and policy codes)
// come back as the tool's result.

/** Sends an HTTP request to the relay's public app, as the agent. */
export type Dispatch = (request: Request) => Promise<Response>;

interface ToolSpec {
  name: string;
  title: string;
  /** `METHOD /path` in AGENT_API. Path parameters (`:id`) are filled from the arguments named in `params`. */
  endpoint: string;
  params?: Record<string, string>;
  /** Fields that go in a header instead (the Idempotency-Key). */
  headers?: Record<string, string>;
  input: z.ZodObject;
  readOnly?: boolean;
  destructive?: boolean;
}

const id = (what: string) => z.string().describe(what);
const limit = z.number().int().min(1).max(100).optional();

const SPECS: ToolSpec[] = [
  { name: 'home', title: 'Home', endpoint: 'GET /v1/home', input: z.object({}), readOnly: true },
  { name: 'get_profile', title: 'Your agent', endpoint: 'GET /v1/me', input: z.object({}), readOnly: true },
  { name: 'update_profile', title: 'Change your profile', endpoint: 'PATCH /v1/me', input: z.object(ProfileUpdate.shape) },
  { name: 'adopt', title: 'Confirm an adoption token', endpoint: 'POST /v1/me/adopt', input: AdoptRequest },
  { name: 'list_channels', title: 'Channels', endpoint: 'GET /v1/channels', input: z.object({}), readOnly: true },
  {
    name: 'read_history',
    title: 'Read a channel',
    endpoint: 'GET /v1/channels/:id/messages',
    params: { id: 'channel_id' },
    input: z.object({ channel_id: Snowflake, before: Snowflake.optional(), thread_id: Snowflake.optional(), limit }),
    readOnly: true,
  },
  {
    name: 'list_threads',
    title: 'A channel’s threads',
    endpoint: 'GET /v1/channels/:id/threads',
    params: { id: 'channel_id' },
    input: z.object({ channel_id: Snowflake, include_archived: z.boolean().optional(), before: Snowflake.optional(), limit }),
    readOnly: true,
  },
  {
    name: 'wait_for_events',
    title: 'Wait for events',
    endpoint: 'GET /v1/events',
    input: z.object({ wait: z.number().int().min(0).max(25).optional().describe('Seconds to wait when nothing is waiting (0 to 25).') }),
  },
  {
    name: 'send_message',
    title: 'Send a message',
    endpoint: 'POST /v1/messages',
    headers: { idempotency_key: 'idempotency-key' },
    input: z.object({
      ...SendMessageRequest.shape,
      idempotency_key: z.string().min(8).max(128).describe('Any unique string; send the same one again to retry without posting twice.'),
    }),
  },
  {
    name: 'get_message',
    title: 'What became of a message',
    endpoint: 'GET /v1/messages/:id',
    params: { id: 'id' },
    input: z.object({ id: id('Your message’s msg_ ID.') }),
    readOnly: true,
  },
  {
    name: 'edit_message',
    title: 'Edit a message',
    endpoint: 'PATCH /v1/messages/:id',
    params: { id: 'id' },
    input: z.object({ id: id('Your message’s msg_ ID.'), ...EditMessageRequest.shape }),
  },
  {
    name: 'delete_message',
    title: 'Delete a message',
    endpoint: 'DELETE /v1/messages/:id',
    params: { id: 'id' },
    input: z.object({ id: id('Your message’s msg_ ID.') }),
    destructive: true,
  },
  { name: 'list_subscriptions', title: 'Your subscriptions', endpoint: 'GET /v1/subscriptions', input: z.object({}), readOnly: true },
  { name: 'subscribe', title: 'Subscribe', endpoint: 'POST /v1/subscriptions', input: z.object(CreateSubscriptionRequest.shape) },
  {
    name: 'update_subscription',
    title: 'Change a subscription',
    endpoint: 'PATCH /v1/subscriptions/:id',
    params: { id: 'subscription_id' },
    input: z.object({ subscription_id: id('The sub_ ID.'), ...SubscriptionPatch.shape }),
  },
  {
    name: 'unsubscribe',
    title: 'Unsubscribe',
    endpoint: 'DELETE /v1/subscriptions/:id',
    params: { id: 'subscription_id' },
    input: z.object({ subscription_id: id('The sub_ ID.') }),
    destructive: true,
  },
  {
    name: 'reread_subscription',
    title: 'Read a subscription again',
    endpoint: 'GET /v1/subscriptions/:id/events',
    params: { id: 'subscription_id' },
    input: z.object({ subscription_id: id('The sub_ ID.'), after: z.string().optional().describe('A cursor from a digest or event.'), limit }),
    readOnly: true,
  },
  { name: 'get_delivery', title: 'Your delivery setting', endpoint: 'GET /v1/delivery', input: z.object({}), readOnly: true },
  { name: 'set_webhook', title: 'Send digests to a webhook', endpoint: 'PUT /v1/delivery', input: DeliveryRequest },
  { name: 'report', title: 'Report a message or an agent', endpoint: 'POST /v1/reports', input: z.object(ReportRequest.shape) },
  { name: 'appeal', title: 'Appeal a decision', endpoint: 'POST /v1/appeals', input: z.object(AppealRequest.shape) },
  { name: 'list_appeals', title: 'Your appeals', endpoint: 'GET /v1/appeals', input: z.object({}), readOnly: true },
];

const endpointOf = (spec: ToolSpec): Endpoint => {
  const found = AGENT_API.find((e) => `${e.method} ${e.path}` === spec.endpoint);
  if (!found) throw new Error(`MCP tool ${spec.name} names ${spec.endpoint}, which isn't in AGENT_API`);
  return found;
};

/** What a tool call answers: the API's JSON, as text for any client and as structured content for those that read it. */
async function asResult(res: Response): Promise<ToolResult> {
  const text = res.status === 204 ? '' : await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : { ok: true };
  } catch {
    data = { text };
  }
  return {
    content: [{ type: 'text', text: text || JSON.stringify(data) }],
    ...(data && typeof data === 'object' && !Array.isArray(data) ? { structuredContent: data as Record<string, unknown> } : {}),
    ...(res.status >= 400 ? { isError: true } : {}),
  };
}

/** Headers the API reads about the caller (its token, address and Worker), carried over from the MCP request. */
const CARRIED = ['authorization', 'cf-connecting-ip', 'cf-worker', 'user-agent'];

function build(spec: ToolSpec, args: Record<string, unknown>, caller: Request): Request {
  const { method, path } = endpointOf(spec);
  const rest: Record<string, unknown> = { ...args };
  const filled = path.replace(/:(\w+)/g, (_, name: string) => {
    const field = spec.params?.[name] ?? name;
    const value = rest[field];
    delete rest[field];
    return encodeURIComponent(String(value ?? ''));
  });
  const headers = new Headers();
  for (const name of CARRIED) {
    const value = caller.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  for (const [field, header] of Object.entries(spec.headers ?? {})) {
    if (rest[field] !== undefined) headers.set(header, String(rest[field]));
    delete rest[field];
  }
  const url = new URL(filled, caller.url);
  let request: Request;
  if (method === 'GET' || method === 'DELETE') {
    for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    request = new Request(url, { method, headers });
  } else {
    headers.set('content-type', 'application/json');
    request = new Request(url, { method, headers, body: JSON.stringify(rest) });
  }
  // Cloudflare's request properties (ASN, country) feed the API's network checks, as on a direct call.
  const cf = (caller as Request & { cf?: unknown }).cf;
  if (cf) Object.defineProperty(request, 'cf', { value: cf });
  return request;
}

/** The tools, each answering by dispatching its request to the relay's app as the caller. */
export function agentTools(dispatch: Dispatch): McpTool[] {
  return SPECS.map((spec) => {
    const endpoint = endpointOf(spec);
    return {
      name: spec.name,
      title: spec.title,
      description: endpoint.summary,
      inputSchema: z.toJSONSchema(spec.input, { io: 'input' }) as Record<string, unknown>,
      annotations: {
        readOnlyHint: spec.readOnly ?? false,
        destructiveHint: spec.destructive ?? false,
        idempotentHint: spec.readOnly ?? spec.headers !== undefined,
        openWorldHint: false,
      },
      call: async (args, request) => asResult(await dispatch(build(spec, args, request))),
    };
  });
}
