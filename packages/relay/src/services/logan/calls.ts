import { newId } from '@logitland/contracts';
import { DiscordError, RateLimitedError } from '@logitland/discord';
import { iso, type Relay } from '../../context';
import { RelayError, forbidden, notFound, unavailable } from '../../errors';
import { audit } from '../audit';
import { getOwner } from '../identity';
import { getSettings } from '../settings';
import { checkCall, filterAnswer, loadCaller, type CallInput, type Caller, type Checked } from './access';

// Running a call through Logan. Reads and writes run at once; destructive ones (the catalog's destructive class: deletes, kicks,
// bans, bulk changes, plus timeouts) wait in the staff alerts channel for the person who asked to press Confirm, and are checked
// again when they do. Every write that runs is audited and posted in the alerts channel, and carries an audit log reason in
// Discord naming the person.

/** How long a destructive request waits for its Confirm. */
export const REQUEST_TTL_MS = 10 * 60_000;
const CONFIRM = 'logan_confirm:';
const CANCEL = 'logan_cancel:';
/** Discord's button styles: red for the destructive confirm, grey for cancel. */
const DANGER = 4;
const SECONDARY = 2;
const REASON_MAX = 200;
const BODY_PREVIEW_MAX = 800;

export interface CallArgs extends CallInput {
  /** Why, in the person's words: shown with the confirmation and kept in both audit logs. */
  reason?: string;
}

export type CallOutcome =
  | { status: 'done'; operation_id: string; answer: unknown }
  | { status: 'pending'; request_id: string; operation_id: string; expires_at: string; detail: string };

/** Whether this call waits for a Confirm. A timeout is a change to the member that takes their voice away for a while. */
export function needsConfirmation(checked: Checked, body: unknown): boolean {
  if (checked.op.risk === 'destructive') return true;
  const until = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).communication_disabled_until : undefined;
  return checked.op.operationId === 'update_guild_member' && until !== undefined && until !== null;
}

const auditReason = (caller: Caller, reason?: string) => `${caller.owner.username} via Logan admin MCP${reason ? `: ${reason}` : ''}`;
const describe = (checked: Checked) => `\`${checked.op.operationId}\` (\`${checked.op.method} ${checked.path}\`)`;

/** Discord's refusal, passed on with its words; a 5xx or lost connection is the relay's 503. */
function discordProblem(err: unknown): RelayError {
  if (err instanceof RateLimitedError)
    return new RelayError(429, 'rate_limited', 'Discord is rate limiting Logan. Try again shortly.', { retryAfterSeconds: err.retryAfterSeconds });
  if (err instanceof DiscordError && err.status < 500)
    return new RelayError(
      err.status === 404 ? 404 : err.status === 403 ? 403 : 400,
      err.status === 404 ? 'not_found' : err.status === 403 ? 'forbidden' : 'invalid_request',
      `Discord refused: ${err.message}${err.code ? ` (code ${err.code})` : ''}.`,
    );
  return unavailable('Discord didn’t answer. Try again in a minute.', 30);
}

/** Sends the checked call as Logan. Writes are audited, with what Discord answered left out (it may be large). */
async function execute(relay: Relay, caller: Caller, checked: Checked, args: CallArgs): Promise<unknown> {
  const write = checked.op.method !== 'GET';
  let answer: unknown;
  try {
    answer = await relay.discord.request(
      checked.op.method,
      checked.path,
      args.body,
      write && checked.op.auditLogReason ? auditReason(caller, args.reason) : undefined,
    );
  } catch (err) {
    throw discordProblem(err);
  }
  if (write)
    await audit(relay, {
      actor_type: 'admin',
      actor_id: caller.owner.id,
      action: `logan.${checked.op.operationId}`,
      target_type: 'discord',
      target_id: `${checked.op.method} ${checked.path}`,
      reason: args.reason ?? null,
    });
  return filterAnswer(relay, caller, checked.op.operationId, answer ?? null);
}

/** Posts in the staff alerts channel, if there is one. A failed post is logged: the action already happened and is audited. */
async function postAlert(relay: Relay, content: string): Promise<void> {
  const { alerts_channel_id: channelId } = await getSettings(relay);
  if (!channelId) return;
  try {
    await relay.discord.createMessage(channelId, { content });
  } catch (error) {
    relay.log.warn('logan.alert_failed', { channel_id: channelId, error });
  }
}

const reasonLine = (reason?: string) => (reason ? `\nReason: ${reason}` : '');

/** One call from the person's MCP client: checked, then run, or left waiting for their Confirm. */
export async function callOperation(relay: Relay, caller: Caller, operationId: string, args: CallArgs): Promise<CallOutcome> {
  const reason = args.reason?.trim().slice(0, REASON_MAX) || undefined;
  const checked = await checkCall(relay, caller, operationId, args);
  if (needsConfirmation(checked, args.body)) return requestConfirmation(relay, caller, checked, { ...args, reason });
  const answer = await execute(relay, caller, checked, { ...args, reason });
  if (checked.op.method !== 'GET')
    await postAlert(relay, `<@${caller.owner.discord_user_id}> had Logan run ${describe(checked)} through the admin MCP.${reasonLine(reason)}`);
  return { status: 'done', operation_id: operationId, answer };
}

function bodyPreview(body: unknown): string {
  if (body === undefined) return '';
  const json = JSON.stringify(body);
  return `\n\`\`\`json\n${json.length > BODY_PREVIEW_MAX ? `${json.slice(0, BODY_PREVIEW_MAX)}…` : json}\n\`\`\``;
}

async function requestConfirmation(relay: Relay, caller: Caller, checked: Checked, args: CallArgs): Promise<CallOutcome> {
  const { alerts_channel_id: channelId } = await getSettings(relay);
  if (!channelId) throw forbidden('This needs a Confirm in the staff alerts channel, and none is set. Ask an admin with the operate power to pick one.');
  const id = newId('logan_request');
  const now = relay.now();
  const expiresAt = iso(new Date(now.getTime() + REQUEST_TTL_MS));
  const call = { params: args.params, query: args.query, body: args.body, reason: args.reason };
  await relay.db
    .prepare(
      "INSERT INTO logan_requests (id, owner_id, operation_id, call, status, channel_id, created_at, expires_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)",
    )
    .bind(id, caller.owner.id, checked.op.operationId, JSON.stringify(call), channelId, iso(now), expiresAt)
    .run();
  const content = [
    `<@${caller.owner.discord_user_id}> asked Logan to run ${describe(checked)} through the admin MCP.${reasonLine(args.reason)}${bodyPreview(args.body)}`,
    `Only they can confirm it, until <t:${Math.floor(Date.parse(expiresAt) / 1000)}:t>.`,
  ].join('\n');
  const components = [
    {
      type: 1,
      components: [
        { type: 2, style: DANGER, label: 'Confirm', custom_id: `${CONFIRM}${id}` },
        { type: 2, style: SECONDARY, label: 'Cancel', custom_id: `${CANCEL}${id}` },
      ],
    },
  ];
  try {
    const message = await relay.discord.createMessage(channelId, { content, components }, caller.owner.discord_user_id);
    await relay.db.prepare('UPDATE logan_requests SET message_id = ? WHERE id = ?').bind(message.id, id).run();
  } catch (error) {
    relay.log.warn('logan.confirm_post_failed', { channel_id: channelId, error });
    await relay.db
      .prepare("UPDATE logan_requests SET status = 'failed', result = ? WHERE id = ?")
      .bind(JSON.stringify({ error: 'The confirmation couldn’t be posted.' }), id)
      .run();
    throw unavailable('Logan couldn’t post the confirmation in the staff alerts channel. Try again in a minute.', 60);
  }
  return {
    status: 'pending',
    request_id: id,
    operation_id: checked.op.operationId,
    expires_at: expiresAt,
    detail: 'Press Confirm on Logan’s message in the staff alerts channel within 10 minutes. Check back with request_status.',
  };
}

interface RequestRow {
  id: string;
  owner_id: string;
  operation_id: string;
  call: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  result: string | null;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
}

const expired = (relay: Relay, row: RequestRow) => row.status === 'pending' && row.expires_at <= iso(relay.now());

/** A request the person made, as request_status shows it. A pending one past its time is expired. */
export async function requestStatus(relay: Relay, ownerId: string, requestId: string) {
  const row = await relay.db.prepare('SELECT * FROM logan_requests WHERE id = ? AND owner_id = ?').bind(requestId, ownerId).first<RequestRow>();
  if (!row) throw notFound('No such request of yours.');
  return {
    request_id: row.id,
    operation_id: row.operation_id,
    status: expired(relay, row) ? 'expired' : row.status,
    created_at: row.created_at,
    expires_at: row.expires_at,
    decided_at: row.decided_at,
    ...(row.result ? JSON.parse(row.result) : {}),
  };
}

/* ---------- The Confirm and Cancel buttons ---------- */

export const isLoganButton = (customId: string | undefined): customId is string => Boolean(customId?.startsWith(CONFIRM) || customId?.startsWith(CANCEL));

/** How to answer a press: a reply only the presser sees, or a new text for the message, buttons removed. */
export type ButtonAnswer = { ephemeral: string } | { update: string };

/**
 * A press on Confirm or Cancel. Only the person who asked may press; anyone else is told so privately. Confirm runs the call
 * after the answer (`defer`), checked again with the person's standing and permissions as they are now, and then `finish`
 * rewrites the message with what happened.
 */
export async function answerButton(
  relay: Relay,
  customId: string,
  presserId: string,
  defer: (work: Promise<void>) => void,
  finish: (content: string) => Promise<void>,
): Promise<ButtonAnswer> {
  const confirm = customId.startsWith(CONFIRM);
  const id = customId.slice((confirm ? CONFIRM : CANCEL).length);
  const row = await relay.db.prepare('SELECT * FROM logan_requests WHERE id = ?').bind(id).first<RequestRow>();
  if (!row) return { ephemeral: 'That request is gone.' };
  const owner = await getOwner(relay, row.owner_id);
  if (presserId !== owner.discord_user_id) return { ephemeral: `Only <@${owner.discord_user_id}>, who asked, can confirm or cancel this.` };
  if (expired(relay, row)) return { update: `<@${owner.discord_user_id}>’s request to run \`${row.operation_id}\` expired before it was confirmed.` };
  if (row.status !== 'pending') return { ephemeral: `That request is already ${row.status}.` };

  const now = iso(relay.now());
  const claimed = await relay.db
    .prepare('UPDATE logan_requests SET status = ?, decided_at = ? WHERE id = ? AND status = ? AND expires_at > ?')
    .bind(confirm ? 'running' : 'cancelled', now, id, 'pending', now)
    .run();
  if (!claimed.meta.changes) return { ephemeral: 'That request was just handled.' };
  if (!confirm) return { update: `<@${owner.discord_user_id}> cancelled running \`${row.operation_id}\` through Logan.` };
  defer(confirmRun(relay, row, finish));
  return { update: `<@${owner.discord_user_id}> confirmed. Logan is running \`${row.operation_id}\`…` };
}

async function confirmRun(relay: Relay, row: RequestRow, finish: (content: string) => Promise<void>): Promise<void> {
  const args = JSON.parse(row.call) as CallArgs;
  let content: string;
  let result: Record<string, unknown>;
  try {
    const caller = await loadCaller(relay, row.owner_id);
    const checked = await checkCall(relay, caller, row.operation_id, args);
    const answer = await execute(relay, caller, checked, args);
    result = { answer };
    content = `<@${caller.owner.discord_user_id}> confirmed: Logan ran ${describe(checked)} through the admin MCP.${reasonLine(args.reason)}`;
  } catch (err) {
    const why = err instanceof RelayError ? (err.detail ?? err.message) : 'Something went wrong in the relay.';
    if (!(err instanceof RelayError)) relay.log.error('logan.confirm_failed', { request: row.id, error: err });
    result = { error: why };
    content = `Logan didn’t run \`${row.operation_id}\`: ${why}`;
  }
  await relay.db
    .prepare('UPDATE logan_requests SET status = ?, result = ? WHERE id = ?')
    .bind('answer' in result ? 'done' : 'failed', JSON.stringify(result), row.id)
    .run();
  await finish(content);
}
