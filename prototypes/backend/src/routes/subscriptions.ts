import { createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { agent, channelAccess } from "../access";
import type { SubscriptionRow } from "../contracts";
import { id, SubscriptionInput } from "../contracts";
import { equal, hash, readJson, seal, token, unseal } from "../crypto";
import { type App, agentSecurity, body, json, Ok, Params, Row } from "../http";
import { callbackUrl } from "../integrations";

/** Manage verified event receivers without exposing their secrets through inspection routes. */
export function registerSubscriptionRoutes(app: App) {
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/subscriptions",
      security: agentSecurity,
      request: { body: body(SubscriptionInput) },
      responses: {
        201: json(z.object({ id, status: z.literal("pending"), signingSecret: z.string() })),
      },
    }),
    async (c) => {
      const who = await agent(c);
      const input = c.req.valid("json");
      await channelAccess(c.env, who.ownerId, input.channelId, "canRead");
      try {
        callbackUrl(c.env, input.destination);
      } catch {
        throw new HTTPException(422, { message: "destination_not_allowed" });
      }
      const subscriptionId = token("sub");
      const secret = `whsec_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64")}`;
      const result =
        await c.env.DB.prepare(`INSERT INTO subscriptions(id,agentId,channelId,destinationCipher,signingCipher,status,createdAt)
    SELECT ?,a.id,?,?,?,'pending',? FROM agents a WHERE a.id=? AND a.status='active'
    AND (SELECT count(*) FROM subscriptions WHERE agentId=a.id AND status!='disabled')<10`)
          .bind(
            subscriptionId,
            input.channelId,
            await seal(input.destination, c.env.ENCRYPTION_KEY),
            await seal(secret, c.env.ENCRYPTION_KEY),
            Date.now(),
            who.id,
          )
          .run();
      if (!result.meta.changes) throw new HTTPException(429, { message: "subscription_limit" });
      return c.json({ id: subscriptionId, status: "pending" as const, signingSecret: secret }, 201);
    },
  );

  async function ownSubscription(c: Parameters<typeof agent>[0], subscriptionId: string) {
    const who = await agent(c);
    const subscription = await c.env.DB.prepare(
      "SELECT * FROM subscriptions WHERE id=? AND agentId=?",
    )
      .bind(subscriptionId, who.id)
      .first<SubscriptionRow>();
    if (!subscription) throw new HTTPException(404, { message: "subscription_not_found" });
    return { ...subscription, ownerId: who.ownerId };
  }
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/subscriptions/{id}/verify",
      security: agentSecurity,
      request: { params: Params },
      responses: { 200: json(Ok) },
    }),
    async (c) => {
      const subscription = await ownSubscription(c, c.req.valid("param").id);
      if (subscription.status !== "pending")
        throw new HTTPException(409, { message: "subscription_not_pending" });
      await channelAccess(c.env, subscription.ownerId, subscription.channelId, "canRead");
      const challenge = token("challenge");
      const challengeHash = await hash(challenge);
      await c.env.DB.prepare(
        "UPDATE subscriptions SET challengeHash=? WHERE id=? AND status='pending'",
      )
        .bind(challengeHash, subscription.id)
        .run();
      const url = callbackUrl(
        c.env,
        await unseal(subscription.destinationCipher, c.env.ENCRYPTION_KEY),
      );
      let echoed: string;
      try {
        const response = await fetch(url, {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(8000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "subscription.challenge", challenge }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error("challenge_failed");
        }
        echoed = (await readJson(response, z.object({ challenge: z.string() }))).challenge;
      } catch {
        throw new HTTPException(502, { message: "receiver_verification_failed" });
      }
      if (!equal(challenge, echoed))
        throw new HTTPException(422, { message: "receiver_challenge_mismatch" });
      await agent(c);
      await channelAccess(c.env, subscription.ownerId, subscription.channelId, "canRead");
      const changed = await c.env.DB.prepare(
        "UPDATE subscriptions SET status='active',challengeHash=NULL WHERE id=? AND status='pending' AND challengeHash=?",
      )
        .bind(subscription.id, challengeHash)
        .run();
      if (!changed.meta.changes) throw new HTTPException(409, { message: "subscription_changed" });
      return c.json({ ok: true } as const, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/v1/subscriptions/{id}",
      security: agentSecurity,
      request: { params: Params },
      responses: { 200: json(Ok) },
    }),
    async (c) => {
      const subscription = await ownSubscription(c, c.req.valid("param").id);
      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE subscriptions SET status='disabled' WHERE id=?").bind(
          subscription.id,
        ),
        c.env.DB.prepare(
          "UPDATE deliveries SET state='cancelled' WHERE subscriptionId=? AND state='pending'",
        ).bind(subscription.id),
      ]);
      return c.json({ ok: true } as const, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/subscriptions",
      security: agentSecurity,
      responses: { 200: json(z.object({ subscriptions: z.array(Row) })) },
    }),
    async (c) => {
      const who = await agent(c);
      return c.json(
        {
          subscriptions: (
            await c.env.DB.prepare(
              "SELECT id,channelId,status,createdAt FROM subscriptions WHERE agentId=? ORDER BY createdAt DESC LIMIT 100",
            )
              .bind(who.id)
              .all()
          ).results,
        },
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/subscriptions/{id}/deliveries",
      security: agentSecurity,
      request: { params: Params },
      responses: { 200: json(z.object({ deliveries: z.array(Row) })) },
    }),
    async (c) => {
      const subscription = await ownSubscription(c, c.req.valid("param").id);
      await channelAccess(c.env, subscription.ownerId, subscription.channelId, "canRead");
      return c.json(
        {
          deliveries: (
            await c.env.DB.prepare(
              "SELECT id,eventId,state,attempt,nextAttemptAt,lastStatus,lastError,createdAt FROM deliveries WHERE subscriptionId=? ORDER BY createdAt DESC LIMIT 100",
            )
              .bind(subscription.id)
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
      path: "/api/v1/subscriptions/{id}/deliveries/{deliveryId}/retry",
      security: agentSecurity,
      request: { params: z.object({ id, deliveryId: id }) },
      responses: { 200: json(Ok) },
    }),
    async (c) => {
      const params = c.req.valid("param");
      const subscription = await ownSubscription(c, params.id);
      await channelAccess(c.env, subscription.ownerId, subscription.channelId, "canRead");
      if (subscription.status !== "active")
        throw new HTTPException(409, { message: "subscription_inactive" });
      await c.env.DB.prepare(
        "UPDATE deliveries SET state='pending',attempt=0,nextAttemptAt=?,leaseUntil=0 WHERE id=? AND subscriptionId=? AND state='dead'",
      )
        .bind(Date.now(), params.deliveryId, subscription.id)
        .run();
      return c.json({ ok: true } as const, 200);
    },
  );
}
