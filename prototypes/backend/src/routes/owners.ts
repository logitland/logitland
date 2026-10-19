import { createRoute, z } from "@hono/zod-openapi";
import { deleteCookie, getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { audit, channelAccess, newKey, ownedAgent, owner, SESSION_COOKIE } from "../access";
import type { AgentRow } from "../contracts";
import { Agent, Claim, Enrollment, id, Registration } from "../contracts";
import { hash, token } from "../crypto";
import { type App, body, json, Key, Ok, ownerSecurity, Params, Row } from "../http";
/** Revoke an agent and its queued participation atomically; in-flight network effects cannot be recalled. */
export async function disable(env: Env, actor: string, agentId: string) {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE agents SET status='disabled',claimHash=NULL,enrollmentHash=NULL WHERE id=?",
    ).bind(agentId),
    env.DB.prepare("UPDATE agent_keys SET revokedAt=? WHERE agentId=?").bind(Date.now(), agentId),
    env.DB.prepare("UPDATE subscriptions SET status='disabled' WHERE agentId=?").bind(agentId),
    env.DB.prepare(
      "UPDATE messages SET state='cancelled',lastError='agent_disabled' WHERE agentId=? AND state IN ('pending','approved','moderating')",
    ).bind(agentId),
    env.DB.prepare(
      "UPDATE deliveries SET state='cancelled',lastError='agent_disabled' WHERE state='pending' AND subscriptionId IN (SELECT id FROM subscriptions WHERE agentId=?)",
    ).bind(agentId),
    audit(env, actor, "agent.disabled", agentId),
  ]);
}

/** Expose owner sessions and both enrollment paths while keeping their credentials separate. */
export function registerOwnerRoutes(app: App) {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/me",
      security: ownerSecurity,
      responses: { 200: json(z.object({ owner: Row, admin: z.boolean(), mode: z.string() })) },
    }),
    async (c) => {
      const who = await owner(c);
      return c.json(
        {
          owner: who,
          admin: c.env.ADMIN_DISCORD_IDS.split(",").includes(who.discordId),
          mode: c.env.MODE,
        },
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/logout",
      security: ownerSecurity,
      responses: { 200: json(Ok) },
    }),
    async (c) => {
      await owner(c);
      await c.env.DB.prepare("DELETE FROM sessions WHERE tokenHash=?")
        .bind(await hash(getCookie(c, SESSION_COOKIE) ?? ""))
        .run();
      deleteCookie(c, SESSION_COOKIE, { path: "/" });
      return c.json({ ok: true } as const, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/registrations",
      request: { body: body(Registration) },
      responses: {
        201: json(
          z.object({
            id,
            claimCode: z.string(),
            claimUrl: z.string(),
            enrollmentToken: z.string(),
            expiresAt: z.number(),
          }),
        ),
      },
    }),
    async (c) => {
      const input = c.req.valid("json");
      const registrationId = token("agt");
      const claimCode = token("claim");
      const enrollmentToken = token("enroll");
      const expiresAt = Date.now() + 10 * 60 * 1000;
      const created =
        await c.env.DB.prepare(`INSERT INTO agents(id,name,status,claimHash,enrollmentHash,claimExpiresAt,createdAt)
    SELECT ?,?,'pending',?,?,?,? WHERE (SELECT count(*) FROM agents WHERE status='pending' AND claimExpiresAt>?)<100`)
          .bind(
            registrationId,
            input.name,
            await hash(claimCode),
            await hash(enrollmentToken),
            expiresAt,
            Date.now(),
            Date.now(),
          )
          .run();
      if (!created.meta.changes)
        throw new HTTPException(429, { message: "registration_capacity_reached" });
      return c.json(
        {
          id: registrationId,
          claimCode,
          claimUrl: `${c.env.DASHBOARD_ORIGIN}/claim?code=${encodeURIComponent(claimCode)}`,
          enrollmentToken,
          expiresAt,
        },
        201,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/owner/claims",
      security: ownerSecurity,
      request: { body: body(Claim) },
      responses: { 200: json(Agent) },
    }),
    async (c) => {
      const who = await owner(c);
      const claimed =
        await c.env.DB.prepare(`UPDATE agents SET ownerId=?,status='active',claimHash=NULL
    WHERE claimHash=? AND status='pending' AND ownerId IS NULL AND claimExpiresAt>?
    RETURNING id,ownerId,name,status,createdAt`)
          .bind(who.id, await hash(c.req.valid("json").claimCode), Date.now())
          .first<AgentRow>();
      if (!claimed) throw new HTTPException(409, { message: "claim_expired_or_consumed" });
      await audit(c.env, who.id, "agent.claimed", claimed.id).run();
      return c.json(claimed, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/registrations/{id}/complete",
      request: { params: Params, body: body(Enrollment) },
      responses: { 200: json(Key) },
    }),
    async (c) => {
      const enrollmentHash = await hash(c.req.valid("json").enrollmentToken);
      const found = await c.env.DB.prepare(
        "SELECT id,ownerId,name,status,createdAt,claimExpiresAt FROM agents WHERE id=? AND enrollmentHash=?",
      )
        .bind(c.req.valid("param").id, enrollmentHash)
        .first<AgentRow & { claimExpiresAt: number }>();
      if (!found || found.claimExpiresAt < Date.now())
        throw new HTTPException(404, { message: "enrollment_expired_or_consumed" });
      if (found.status === "pending")
        throw new HTTPException(409, { message: "owner_approval_pending" });
      if (found.status !== "active") throw new HTTPException(403, { message: "agent_disabled" });
      const credential = await newKey(c.env, found.id);
      // Both SELECT gates and secret consumption occur in one D1 transaction, so concurrent polls issue only one key.
      const result = await c.env.DB.batch([
        c.env.DB.prepare(`INSERT INTO agent_keys(id,agentId,tokenHash,createdAt,expiresAt)
      SELECT ?,id,?,?,? FROM agents WHERE id=? AND enrollmentHash=? AND status='active' AND claimExpiresAt>?`).bind(
          credential.id,
          await hash(credential.key),
          Date.now(),
          credential.expiresAt,
          found.id,
          enrollmentHash,
          Date.now(),
        ),
        c.env.DB.prepare(
          "UPDATE agents SET enrollmentHash=NULL WHERE id=? AND enrollmentHash=?",
        ).bind(found.id, enrollmentHash),
      ]);
      if (!result[0]?.meta.changes)
        throw new HTTPException(409, { message: "enrollment_consumed" });
      return c.json(
        { id: credential.id, key: credential.key, expiresAt: credential.expiresAt },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/owner/agents",
      security: ownerSecurity,
      responses: { 200: json(z.object({ agents: z.array(Agent) })) },
    }),
    async (c) => {
      const who = await owner(c);
      const rows = await c.env.DB.prepare(
        "SELECT id,ownerId,name,status,createdAt FROM agents WHERE ownerId=? ORDER BY createdAt DESC LIMIT 100",
      )
        .bind(who.id)
        .all<AgentRow>();
      return c.json({ agents: rows.results }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/owner/agents",
      security: ownerSecurity,
      request: { body: body(Registration) },
      responses: { 201: json(z.object({ agent: Agent, credential: Key })) },
    }),
    async (c) => {
      const who = await owner(c);
      const created = {
        id: token("agt"),
        ownerId: who.id,
        name: c.req.valid("json").name,
        status: "active" as const,
        createdAt: Date.now(),
      };
      const credential = await newKey(c.env, created.id);
      await c.env.DB.batch([
        c.env.DB.prepare(
          "INSERT INTO agents(id,ownerId,name,status,createdAt) VALUES(?,?,?,'active',?)",
        ).bind(created.id, who.id, created.name, created.createdAt),
        credential.insert,
        audit(c.env, who.id, "agent.created", created.id),
      ]);
      return c.json(
        {
          agent: created,
          credential: { id: credential.id, key: credential.key, expiresAt: credential.expiresAt },
        },
        201,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/owner/agents/{id}/keys",
      security: ownerSecurity,
      request: { params: Params },
      responses: { 200: json(z.object({ keys: z.array(Row) })) },
    }),
    async (c) => {
      const who = await owner(c);
      await ownedAgent(c.env, who.id, c.req.valid("param").id);
      return c.json(
        {
          keys: (
            await c.env.DB.prepare(
              "SELECT id,createdAt,expiresAt,revokedAt FROM agent_keys WHERE agentId=? ORDER BY createdAt DESC",
            )
              .bind(c.req.valid("param").id)
              .all()
          ).results,
        },
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/owner/agents/{id}/keys",
      security: ownerSecurity,
      request: { params: Params },
      responses: { 201: json(Key) },
    }),
    async (c) => {
      const who = await owner(c);
      const found = await ownedAgent(c.env, who.id, c.req.valid("param").id);
      if (found.status !== "active") throw new HTTPException(409, { message: "agent_disabled" });
      const credential = await newKey(c.env, found.id);
      const result = await c.env.DB.batch([
        credential.insert,
        audit(c.env, who.id, "key.created", credential.id),
      ]);
      if (!result[0]?.meta.changes) throw new HTTPException(409, { message: "agent_disabled" });
      return c.json(
        { id: credential.id, key: credential.key, expiresAt: credential.expiresAt },
        201,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/v1/owner/agents/{id}/keys/{keyId}",
      security: ownerSecurity,
      request: { params: z.object({ id, keyId: id }) },
      responses: { 200: json(Ok) },
    }),
    async (c) => {
      const who = await owner(c);
      const params = c.req.valid("param");
      await ownedAgent(c.env, who.id, params.id);
      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE agent_keys SET revokedAt=? WHERE id=? AND agentId=?").bind(
          Date.now(),
          params.keyId,
          params.id,
        ),
        audit(c.env, who.id, "key.revoked", params.keyId),
      ]);
      return c.json({ ok: true } as const, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/v1/owner/agents/{id}",
      security: ownerSecurity,
      request: { params: Params },
      responses: { 200: json(Ok) },
    }),
    async (c) => {
      const who = await owner(c);
      await ownedAgent(c.env, who.id, c.req.valid("param").id);
      await disable(c.env, who.id, c.req.valid("param").id);
      return c.json({ ok: true } as const, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/owner/activity",
      security: ownerSecurity,
      responses: {
        200: json(
          z.object({
            messages: z.array(Row),
            subscriptions: z.array(Row),
            deliveries: z.array(Row),
          }),
        ),
      },
    }),
    async (c) => {
      const who = await owner(c);
      const results = await c.env.DB.batch<Record<string, unknown>>([
        c.env.DB.prepare(
          "SELECT m.id,m.agentId,m.channelId,m.state,m.moderationReason,m.lastError,m.createdAt FROM messages m JOIN agents a ON a.id=m.agentId WHERE a.ownerId=? ORDER BY m.createdAt DESC LIMIT 100",
        ).bind(who.id),
        c.env.DB.prepare(
          "SELECT s.id,s.agentId,s.channelId,s.status,s.createdAt FROM subscriptions s JOIN agents a ON a.id=s.agentId WHERE a.ownerId=? ORDER BY s.createdAt DESC LIMIT 100",
        ).bind(who.id),
        c.env.DB.prepare(
          "SELECT d.id,d.subscriptionId,d.eventId,d.state,d.attempt,d.lastStatus,d.lastError FROM deliveries d JOIN subscriptions s ON s.id=d.subscriptionId JOIN agents a ON a.id=s.agentId WHERE a.ownerId=? ORDER BY d.createdAt DESC LIMIT 100",
        ).bind(who.id),
      ]);
      return c.json(
        {
          messages: results[0]?.results ?? [],
          subscriptions: results[1]?.results ?? [],
          deliveries: results[2]?.results ?? [],
        },
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/owner/claims/{claimCode}",
      security: ownerSecurity,
      request: { params: z.object({ claimCode: z.string().min(20).max(200) }) },
      responses: { 200: json(z.object({ id, name: z.string(), expiresAt: z.number() })) },
    }),
    async (c) => {
      await owner(c);
      const found = await c.env.DB.prepare(
        "SELECT id,name,claimExpiresAt AS expiresAt FROM agents WHERE claimHash=? AND status='pending' AND claimExpiresAt>?",
      )
        .bind(await hash(c.req.valid("param").claimCode), Date.now())
        .first<{ id: string; name: string; expiresAt: number }>();
      if (!found) throw new HTTPException(404, { message: "claim_not_found" });
      return c.json(found, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/v1/owner/subscriptions/{id}",
      security: ownerSecurity,
      request: { params: Params },
      responses: { 200: json(Ok) },
    }),
    async (c) => {
      const who = await owner(c);
      const found = await c.env.DB.prepare(
        "SELECT s.id FROM subscriptions s JOIN agents a ON a.id=s.agentId WHERE s.id=? AND a.ownerId=?",
      )
        .bind(c.req.valid("param").id, who.id)
        .first<{ id: string }>();
      if (!found) throw new HTTPException(404, { message: "subscription_not_found" });
      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE subscriptions SET status='disabled' WHERE id=?").bind(found.id),
        c.env.DB.prepare(
          "UPDATE deliveries SET state='cancelled' WHERE subscriptionId=? AND state='pending'",
        ).bind(found.id),
        audit(c.env, who.id, "subscription.disabled", found.id),
      ]);
      return c.json({ ok: true } as const, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/owner/deliveries/{id}/retry",
      security: ownerSecurity,
      request: { params: Params },
      responses: { 200: json(Ok) },
    }),
    async (c) => {
      const who = await owner(c);
      const found =
        await c.env.DB.prepare(`SELECT d.id,s.channelId FROM deliveries d JOIN subscriptions s ON s.id=d.subscriptionId
    JOIN agents a ON a.id=s.agentId WHERE d.id=? AND a.ownerId=? AND a.status='active' AND s.status='active' AND d.state='dead'`)
          .bind(c.req.valid("param").id, who.id)
          .first<{ id: string; channelId: string }>();
      if (!found) throw new HTTPException(404, { message: "retryable_delivery_not_found" });
      await channelAccess(c.env, who.id, found.channelId, "canRead");
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE deliveries SET state='pending',attempt=0,nextAttemptAt=?,leaseUntil=0 WHERE id=? AND state='dead'",
        ).bind(Date.now(), found.id),
        audit(c.env, who.id, "delivery.retried", found.id),
      ]);
      return c.json({ ok: true } as const, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/owner/messages/{id}/moderation",
      security: ownerSecurity,
      request: { params: Params },
      responses: { 200: json(z.object({ decisions: z.array(Row) })) },
    }),
    async (c) => {
      const who = await owner(c);
      const found = await c.env.DB.prepare(
        "SELECT m.id FROM messages m JOIN agents a ON a.id=m.agentId WHERE m.id=? AND a.ownerId=?",
      )
        .bind(c.req.valid("param").id, who.id)
        .first();
      if (!found) throw new HTTPException(404, { message: "message_not_found" });
      const decisions = await c.env.DB.prepare(
        "SELECT id,contentHash,model,policyVersion,verdict,confidence,createdAt FROM moderation_decisions WHERE messageId=? ORDER BY createdAt",
      )
        .bind(c.req.valid("param").id)
        .all();
      return c.json({ decisions: decisions.results }, 200);
    },
  );
}
