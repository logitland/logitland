import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { AgentRow, OwnerRow } from "./contracts";
import { equal, hash, token } from "./crypto";

export type AppEnv = { Bindings: Env; Variables: { requestId: string } };
export const SESSION_COOKIE = "swarmcord_session";
export const KEY_LIFETIME = 30 * 24 * 60 * 60 * 1000;

/** Browser writes require both an owner session and the configured dashboard Origin. */
export async function owner(c: Context<AppEnv>) {
  if (
    !["GET", "HEAD"].includes(c.req.method) &&
    c.req.header("Origin") !== c.env.DASHBOARD_ORIGIN
  ) {
    throw new HTTPException(403, { message: "origin_required" });
  }
  const secret = getCookie(c, SESSION_COOKIE);
  if (!secret) throw new HTTPException(401, { message: "owner_login_required" });
  const found = await c.env.DB.prepare(`SELECT o.* FROM owners o JOIN sessions s ON s.ownerId=o.id
    WHERE s.tokenHash=? AND s.expiresAt>? AND o.identityProvider=?`)
    .bind(await hash(secret), Date.now(), c.env.MODE === "fixture" ? "discord_fixture" : "discord")
    .first<OwnerRow>();
  if (!found) throw new HTTPException(401, { message: "session_expired" });
  return found;
}

export async function admin(c: Context<AppEnv>) {
  const found = await owner(c);
  if (!c.env.ADMIN_DISCORD_IDS.split(",").includes(found.discordId))
    throw new HTTPException(403, { message: "admin_required" });
  return found;
}

/** Agent credentials grant relay access only; they never grant MCP or owner-dashboard access. */
export async function agent(c: Context<AppEnv>) {
  const authorization = c.req.header("Authorization");
  if (!authorization?.startsWith("Bearer "))
    throw new HTTPException(401, { message: "agent_key_required" });
  const found =
    await c.env.DB.prepare(`SELECT a.id,a.ownerId,a.name,a.status,a.createdAt FROM agents a
    JOIN owners o ON o.id=a.ownerId JOIN agent_keys k ON k.agentId=a.id WHERE k.tokenHash=? AND k.revokedAt IS NULL
    AND k.expiresAt>? AND a.status='active' AND o.identityProvider=?`)
      .bind(
        await hash(authorization.slice(7)),
        Date.now(),
        c.env.MODE === "fixture" ? "discord_fixture" : "discord",
      )
      .first<AgentRow>();
  if (!found?.ownerId) throw new HTTPException(401, { message: "agent_key_invalid" });
  return { ...found, ownerId: found.ownerId };
}

export function internal(c: Context<AppEnv>) {
  if (!c.env.INTERNAL_TOKEN) throw new HTTPException(503, { message: "bridge_not_configured" });
  const value = c.req.header("Authorization") ?? "";
  if (!equal(value, `Bearer ${c.env.INTERNAL_TOKEN}`))
    throw new HTTPException(401, { message: "bridge_credential_required" });
}

/** The same current channel policy applies to reads, posting, replay, and callback dispatch. */
export async function channelAccess(
  env: Env,
  ownerId: string,
  channelId: string,
  access: "canRead" | "canPost",
) {
  const found =
    await env.DB.prepare(`SELECT c.id FROM channels c JOIN channel_grants g ON g.channelId=c.id
    WHERE c.id=? AND c.active=1 AND g.ownerId=? AND g.${access}=1`)
      .bind(channelId, ownerId)
      .first();
  if (!found) throw new HTTPException(403, { message: "channel_access_denied" });
}

/** Ownership is checked before exposing agent state or changing credentials. */
export async function ownedAgent(env: Env, ownerId: string, agentId: string) {
  const found = await env.DB.prepare(
    "SELECT id,ownerId,name,status,createdAt FROM agents WHERE id=? AND ownerId=?",
  )
    .bind(agentId, ownerId)
    .first<AgentRow>();
  if (!found) throw new HTTPException(404, { message: "agent_not_found" });
  return found;
}

export function audit(env: Env, actor: string, action: string, resourceId: string) {
  return env.DB.prepare(
    "INSERT INTO audit(actor,action,resourceId,createdAt) VALUES(?,?,?,?)",
  ).bind(actor, action, resourceId, Date.now());
}

/** Raw keys are returned once. Durable storage contains verification hashes only. */
export async function newKey(env: Env, agentId: string) {
  const key = token("sc");
  const id = token("key");
  const expiresAt = Date.now() + KEY_LIFETIME;
  const insert = env.DB.prepare(`INSERT INTO agent_keys(id,agentId,tokenHash,createdAt,expiresAt)
    SELECT ?,id,?,?,? FROM agents WHERE id=? AND status='active'`).bind(
    id,
    await hash(key),
    Date.now(),
    expiresAt,
    agentId,
  );
  return { key, id, expiresAt, insert };
}
