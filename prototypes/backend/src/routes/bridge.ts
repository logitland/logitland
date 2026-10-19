import { createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { internal } from "../access";
import { EventBatch } from "../contracts";
import { hash, token } from "../crypto";
import { dispatch } from "../dispatch";
import { type App, body, internalSecurity, json } from "../http";

/** Accept ordered upstream events and drive durable work using internal credentials. */
export function registerBridgeRoutes(app: App) {
  app.openapi(
    createRoute({
      method: "post",
      path: "/internal/events",
      security: internalSecurity,
      request: { body: body(EventBatch) },
      responses: { 200: json(z.object({ received: z.number(), inserted: z.number() })) },
    }),
    async (c) => {
      internal(c);
      const batch = c.req.valid("json");
      for (const event of batch.events) {
        const channel = await c.env.DB.prepare("SELECT id FROM channels WHERE id=? AND active=1")
          .bind(event.channelId)
          .first();
        if (!channel) throw new HTTPException(422, { message: "unconfigured_channel" });
      }
      const inserts = await Promise.all(
        batch.events.map(async (event) =>
          c.env.DB.prepare(`INSERT INTO events(id,source,sourceEventId,type,channelId,discordMessageId,agentId,content,occurredAt,observedAt,payloadHash)
    VALUES(?,?,?,?,?,?,(SELECT agentId FROM messages WHERE discordMessageId=? AND channelId=? LIMIT 1),?,?,?,?)
    ON CONFLICT(source,sourceEventId) DO NOTHING RETURNING id`).bind(
            token("evt"),
            batch.source,
            event.sourceEventId,
            event.type,
            event.channelId,
            event.discordMessageId,
            event.discordMessageId,
            event.channelId,
            "content" in event ? (event.content ?? null) : null,
            event.occurredAt,
            Date.now(),
            await hash(JSON.stringify(event)),
          ),
        ),
      );
      let inserted = 0;
      try {
        const results = await c.env.DB.batch<{ id: string }>(inserts);
        inserted = results.reduce((sum, row) => sum + row.results.length, 0);
      } catch (error) {
        if (String(error).includes("event_identity_conflict"))
          throw new HTTPException(409, { message: "event_identity_conflict" });
        throw error;
      }
      return c.json(
        {
          received: batch.events.length,
          inserted,
        },
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/internal/dispatch",
      security: internalSecurity,
      responses: { 200: json(z.object({ sends: z.number(), deliveries: z.number() })) },
    }),
    async (c) => {
      internal(c);
      return c.json(await dispatch(c.env), 200);
    },
  );
}
