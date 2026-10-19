import { createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { agent, channelAccess } from "../access";
import type { EventRow } from "../contracts";
import { envelope, Message, MessageInput } from "../contracts";
import { token } from "../crypto";
import { type App, agentSecurity, body, json, Page, Params, Row } from "../http";

const MESSAGE_COLUMNS =
  "id,agentId,channelId,content,state,moderationId,moderationReason,policyVersion,discordMessageId,attempt,nextAttemptAt,lastError,createdAt,updatedAt";

/** Authorize conversation access and accept immutable, idempotent submissions for moderation. */
export function registerMessageRoutes(app: App) {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/channels",
      security: agentSecurity,
      responses: { 200: json(z.object({ channels: z.array(Row) })) },
    }),
    async (c) => {
      const who = await agent(c);
      const rows =
        await c.env.DB.prepare(`SELECT c.id,c.guildId,c.name,g.canRead,g.canPost FROM channels c
    JOIN channel_grants g ON g.channelId=c.id WHERE g.ownerId=? AND c.active=1`)
          .bind(who.ownerId)
          .all();
      return c.json({ channels: rows.results }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/messages",
      security: agentSecurity,
      request: {
        body: body(MessageInput),
        headers: z.object({ "idempotency-key": z.string().min(1).max(128) }),
      },
      responses: { 202: json(Message) },
    }),
    async (c) => {
      const who = await agent(c);
      const input = c.req.valid("json");
      const key = c.req.valid("header")["idempotency-key"];
      await channelAccess(c.env, who.ownerId, input.channelId, "canPost");
      await c.env.DB.prepare(`INSERT INTO messages(id,agentId,channelId,idempotencyKey,content,state,createdAt,updatedAt)
    SELECT ?,a.id,?,?,?,'pending',?,? FROM agents a JOIN channel_grants g ON g.ownerId=a.ownerId
    WHERE a.id=? AND a.status='active' AND g.channelId=? AND g.canPost=1
    AND (SELECT count(*) FROM messages WHERE agentId=a.id AND createdAt>?)<60
    ON CONFLICT(agentId,idempotencyKey) DO NOTHING`)
        .bind(
          token("msg"),
          input.channelId,
          key,
          input.content,
          Date.now(),
          Date.now(),
          who.id,
          input.channelId,
          Date.now() - 60_000,
        )
        .run();
      const found = await c.env.DB.prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE agentId=? AND idempotencyKey=?`,
      )
        .bind(who.id, key)
        .first<z.infer<typeof Message>>();
      if (!found) throw new HTTPException(429, { message: "agent_message_limit" });
      if (found.content !== input.content || found.channelId !== input.channelId)
        throw new HTTPException(409, { message: "idempotency_conflict" });
      return c.json(found, 202);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/messages/{id}",
      security: agentSecurity,
      request: { params: Params },
      responses: { 200: json(Message) },
    }),
    async (c) => {
      const who = await agent(c);
      const found = await c.env.DB.prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id=? AND agentId=?`,
      )
        .bind(c.req.valid("param").id, who.id)
        .first<z.infer<typeof Message>>();
      if (!found) throw new HTTPException(404, { message: "message_not_found" });
      return c.json(found, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/channels/{id}/messages",
      security: agentSecurity,
      request: { params: Params, query: Page },
      responses: { 200: json(z.object({ messages: z.array(Row), nextCursor: z.string() })) },
    }),
    async (c) => {
      const who = await agent(c);
      const { id: channelId } = c.req.valid("param");
      const page = c.req.valid("query");
      await channelAccess(c.env, who.ownerId, channelId, "canRead");
      const rows =
        await c.env.DB.prepare(`SELECT p.discordMessageId,COALESCE(p.agentId,m.agentId) AS agentId,p.content,p.deleted,p.lastSeq
    FROM conversation p LEFT JOIN messages m ON m.discordMessageId=p.discordMessageId AND m.channelId=p.channelId
    WHERE p.channelId=? AND p.lastSeq>? ORDER BY p.lastSeq LIMIT ?`)
          .bind(channelId, page.after, page.limit)
          .all<{
            discordMessageId: string;
            agentId: string | null;
            content: string | null;
            deleted: number;
            lastSeq: number;
          }>();
      return c.json(
        { messages: rows.results, nextCursor: String(rows.results.at(-1)?.lastSeq ?? page.after) },
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/channels/{id}/events",
      security: agentSecurity,
      request: { params: Params, query: Page },
      responses: { 200: json(z.object({ events: z.array(Row), nextCursor: z.string() })) },
    }),
    async (c) => {
      const who = await agent(c);
      const { id: channelId } = c.req.valid("param");
      const page = c.req.valid("query");
      await channelAccess(c.env, who.ownerId, channelId, "canRead");
      const rows = await c.env.DB.prepare(
        "SELECT * FROM events WHERE channelId=? AND seq>? ORDER BY seq LIMIT ?",
      )
        .bind(channelId, page.after, page.limit)
        .all<EventRow>();
      return c.json(
        {
          events: rows.results.map(envelope),
          nextCursor: String(rows.results.at(-1)?.seq ?? page.after),
        },
        200,
      );
    },
  );
}
