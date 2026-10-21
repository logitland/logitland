import type { AgentStatus, Owner, Scope } from '@logitland/contracts';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { Relay } from '../context';
import { timingSafeEqual } from '../crypto';
import { RelayError, forbidden, unauthorized } from '../errors';
import { getOwner, isAdmin } from '../services/identity';
import { isWorkerAddress } from '../services/origins';
import { authenticateToken } from '../services/tokens';
import type { AgentPrincipal, ClientInfo } from '../types';

export type Env = { Variables: { principal: AgentPrincipal; admin: Owner; client: ClientInfo } };
export type AppContext = Context<Env>;
export type App = Hono<Env>;

/** Each route module registers its routes on the public or internal app. */
export type RegisterRoutes = (app: App, relay: Relay) => void;

/** The request's JSON body, or a 400 problem. Bodies are capped by the app's body limit. */
export async function body(c: AppContext): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new RelayError(400, 'invalid_request', 'Send a JSON body');
  }
}

export function requireScope(c: AppContext, scope: Scope): void {
  if (!c.get('principal').scopes.includes(scope)) throw forbidden(`This access token doesn’t have ${scope}`);
}

/** Cloudflare's view of the caller. Set for every request by the app. */
export function clientInfo(c: Context): ClientInfo {
  const cf = (c.req.raw as Request & { cf?: { asn?: number; asOrganization?: string; country?: string } }).cf;
  const ip = c.req.header('cf-connecting-ip') ?? null;
  return {
    ip,
    worker: ip && isWorkerAddress(ip) ? (c.req.header('cf-worker')?.toLowerCase().slice(0, 253) ?? null) : null,
    asn: typeof cf?.asn === 'number' ? cf.asn : null,
    asOrganization: cf?.asOrganization ?? null,
    country: cf?.country ?? null,
  };
}

/** The request's Bearer token, if it has one. */
export function bearer(c: Context): string | null {
  const [kind, token] = (c.req.header('authorization') ?? '').split(' ');
  return kind === 'Bearer' && token ? token : null;
}

/**
 * Bearer access token → principal. Use on every /v1 route. Only active agents pass unless `allowStatuses` says otherwise. A
 * 401 points at the protected-resource metadata, where auth.md's discovery starts.
 */
export function agentAuth(relay: Relay, opts: { allowStatuses?: AgentStatus[] } = {}): MiddlewareHandler<Env> {
  return async (c, next) => {
    try {
      const token = bearer(c);
      if (!token) throw unauthorized(`Send an access token as a Bearer token. To get one, read ${relay.config.publicUrl}/auth.md.`);
      c.set('principal', await authenticateToken(relay, token, c.get('client'), opts));
    } catch (err) {
      if (err instanceof RelayError && err.status === 401)
        c.header('www-authenticate', `Bearer resource_metadata="${relay.config.publicUrl}/.well-known/oauth-protected-resource"`);
      throw err;
    }
    await next();
  };
}

/** The dashboard's token. The internal app is only reachable through the service binding; this is defence in depth. */
export function internalAuth(relay: Relay): MiddlewareHandler<Env> {
  return async (c, next) => {
    const token = c.req.header('x-logitland-internal') ?? '';
    if (!relay.config.internalToken || !timingSafeEqual(token, relay.config.internalToken)) throw unauthorized('Internal routes need the dashboard token');
    await next();
  };
}

/**
 * Owner routes act for the signed-in person only. The dashboard sends that person's owner ID in
 * x-logitland-owner (from its session, never from user input); the path must name the same owner.
 */
export function ownerBinding(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const header = c.req.header('x-logitland-owner');
    const path = c.req.param('ownerId');
    if (!header || !path || !timingSafeEqual(header, path)) throw forbidden('That isn’t the signed-in owner');
    await next();
  };
}

/** Admin routes re-check admin rights here, not only in the UI. */
export function adminGuard(relay: Relay): MiddlewareHandler<Env> {
  return async (c, next) => {
    const ownerId = c.req.header('x-logitland-owner');
    if (!ownerId) throw unauthorized('Admin routes need the signed-in owner');
    const owner = await getOwner(relay, ownerId);
    if (!isAdmin(relay, owner)) throw forbidden('This person isn’t a relay admin');
    c.set('admin', owner);
    await next();
  };
}

/** Parses a page-size query parameter as an integer within bounds. */
export function intQuery(c: AppContext, name: string, fallback: number, min: number, max: number): number {
  const raw = c.req.query(name);
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new RelayError(400, 'invalid_request', `${name} must be a whole number`);
  return Math.min(Math.max(n, min), max);
}

/** A Discord snowflake from the query string, or undefined. */
export function snowflakeQuery(c: AppContext, name: string): string | undefined {
  const raw = c.req.query(name);
  if (raw === undefined || raw === '') return undefined;
  if (!/^\d{17,20}$/.test(raw)) throw new RelayError(400, 'invalid_request', `${name} must be a Discord message ID`);
  return raw;
}
