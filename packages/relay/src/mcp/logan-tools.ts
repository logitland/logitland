import { z } from 'zod';
import type { Relay } from '../context';
import { RelayError, parse } from '../errors';
import { anyChannelPermissions, offered, performable, type Caller } from '../services/logan/access';
import { callOperation, requestStatus } from '../services/logan/calls';
import { getOperation, operations, requiredPermissions, searchOperations } from '../services/logan/catalog';
import type { McpTool, ToolResult } from './server';

// The Logan admin MCP's tools, modelled on discord-mcp's: find an operation, read what it needs, call it, and follow a call
// that waits for a Confirm. Built for one caller per request (routes/logan.ts), who was checked just before; every call checks
// them again against the operation's own requirements.

const PAGE = 20;
const Method = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

const Search = z.object({
  query: z.string().max(200).optional().describe('What you want to do, in plain words ("kick a member", "create forum tag"), or an operation ID.'),
  method: Method.optional(),
  family: z.string().max(40).optional().describe('Narrow to one family: channel, message, thread, member, role, guild, moderation…'),
  cursor: z.string().max(10).optional().describe('next_cursor from the previous page.'),
});
const Describe = z.object({ operation_id: z.string().max(100) });
const Call = z.object({
  operation_id: z.string().max(100),
  params: z.record(z.string(), z.string()).optional().describe('Path parameters by name, e.g. { "channel_id": "…" }. guild_id is this server’s.'),
  query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  body: z.unknown().optional().describe('The JSON body Discord takes for this operation.'),
  reason: z.string().max(200).optional().describe('Why: shown with a confirmation and kept in the audit logs.'),
});
const Status = z.object({ request_id: z.string().max(40) });

const result = (data: Record<string, unknown>): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });

/** The relay's refusals become tool errors with their reason, so the client can tell the person instead of retrying. */
async function answer(run: () => Promise<Record<string, unknown>>): Promise<ToolResult> {
  try {
    return result(await run());
  } catch (err) {
    if (!(err instanceof RelayError)) throw err;
    const problem = err.toProblem();
    return {
      ...result({ error: problem.code, detail: problem.detail ?? problem.title, ...(problem.errors ? { errors: problem.errors } : {}) }),
      isError: true,
    };
  }
}

const brief = (op: (typeof operations)[number]) => ({
  operation_id: op.operationId,
  method: op.method,
  path: op.path,
  family: op.family,
  risk: op.risk,
  needs_confirmation: op.risk === 'destructive',
});

export function loganTools(relay: Relay, caller: Caller): McpTool[] {
  const tool = <S extends z.ZodObject>(
    spec: Omit<McpTool, 'inputSchema' | 'call'> & { input: S; run: (args: z.infer<S>) => Promise<Record<string, unknown>> },
  ): McpTool => ({
    name: spec.name,
    title: spec.title,
    description: spec.description,
    ...(spec.annotations ? { annotations: spec.annotations } : {}),
    inputSchema: z.toJSONSchema(spec.input, { io: 'input' }) as Record<string, unknown>,
    call: (args) => answer(() => spec.run(parse(spec.input, args))),
  });

  return [
    tool({
      name: 'search_operations',
      title: 'Find a Discord operation',
      description: 'Search the Discord operations you may have Logan perform in this server right now, best match first.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      input: Search,
      run: async ({ query, method, family, cursor }) => {
        const anyChannel = await anyChannelPermissions(relay, caller);
        const mine = operations.filter((op) => (!family || op.family === family) && performable(caller, op, anyChannel));
        const hits = searchOperations({ query, method }, mine);
        const start = Number.parseInt(cursor ?? '0', 10) || 0;
        const page = hits.slice(start, start + PAGE).map(brief);
        return { operations: page, ...(start + PAGE < hits.length ? { next_cursor: String(start + PAGE) } : {}) };
      },
    }),
    tool({
      name: 'describe_operation',
      title: 'Describe a Discord operation',
      description: 'What one operation takes (path and query parameters, body), what Discord requires of you for it, and whether it waits for a Confirm.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      input: Describe,
      run: async ({ operation_id }) => {
        const op = getOperation(operation_id);
        if (!op) throw new RelayError(404, 'not_found', `There’s no operation ${operation_id}. Find one with search_operations.`);
        const anyChannel = await anyChannelPermissions(relay, caller);
        return {
          ...brief(op),
          path_params: op.pathParams,
          query_params: op.queryParams,
          required_query: op.requiredQuery,
          body: op.requestBody ? { required: op.requestBody.required, schema: op.requestBody.schemaName ?? null } : null,
          required_permissions: requiredPermissions(op.operationId),
          offered: offered(op),
          available_to_you: performable(caller, op, anyChannel),
          ...(op.operationId === 'update_guild_member' ? { note: 'Setting communication_disabled_until (a timeout) waits for a Confirm.' } : {}),
        };
      },
    }),
    tool({
      name: 'call_operation',
      title: 'Have Logan perform an operation',
      description:
        'Logan performs one Discord operation in this server, if you may. Destructive ones (deletes, kicks, bans, timeouts, bulk changes) answer status pending: you confirm them on Logan’s message in the staff alerts channel.',
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      input: Call,
      run: async ({ operation_id, params = {}, query = {}, body, reason }) => callOperation(relay, caller, operation_id, { params, query, body, reason }),
    }),
    tool({
      name: 'request_status',
      title: 'Check a pending request',
      description: 'Whether a request waiting for your Confirm is still pending, ran (with Discord’s answer), failed, was cancelled or expired.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      input: Status,
      run: ({ request_id }) => requestStatus(relay, caller.owner.id, request_id),
    }),
  ];
}
