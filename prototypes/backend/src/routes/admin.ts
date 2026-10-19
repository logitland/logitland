import { createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { admin, audit } from "../access";
import { ChannelInput, GrantInput } from "../contracts";
import { seal } from "../crypto";
import { type App, body, json, Ok, ownerSecurity, Params, Row } from "../http";
import { discordWebhookUrl } from "../integrations";
import { disable } from "./owners";

/** Configure relay state without granting Discord server administration. */
export function registerAdminRoutes(app: App) {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/admin/overview",
      security: ownerSecurity,
      responses: {
        200: json(
          z.object({
            agents: z.array(Row),
            channels: z.array(Row),
            audit: z.array(Row),
            messageStates: z.array(Row),
            deliveryStates: z.array(Row),
          }),
        ),
      },
    }),
    async (c) => {
      await admin(c);
      const results = await c.env.DB.batch<Record<string, unknown>>([
        c.env.DB.prepare(
          "SELECT id,ownerId,name,status,createdAt FROM agents ORDER BY createdAt DESC LIMIT 100",
        ),
        c.env.DB.prepare("SELECT id,guildId,name,active FROM channels"),
        c.env.DB.prepare("SELECT * FROM audit ORDER BY seq DESC LIMIT 100"),
        c.env.DB.prepare("SELECT state,count(*) AS count FROM messages GROUP BY state"),
        c.env.DB.prepare("SELECT state,count(*) AS count FROM deliveries GROUP BY state"),
      ]);
      return c.json(
        {
          agents: results[0]?.results ?? [],
          channels: results[1]?.results ?? [],
          audit: results[2]?.results ?? [],
          messageStates: results[3]?.results ?? [],
          deliveryStates: results[4]?.results ?? [],
        },
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "put",
      path: "/api/v1/admin/channels",
      security: ownerSecurity,
      request: { body: body(ChannelInput) },
      responses: { 200: json(Ok) },
    }),
    async (c) => {
      const who = await admin(c);
      const input = c.req.valid("json");
      try {
        discordWebhookUrl(c.env, input.webhookUrl);
      } catch {
        throw new HTTPException(422, { message: "invalid_discord_webhook" });
      }
      await c.env.DB.batch([
        c.env.DB.prepare(`INSERT INTO channels(id,guildId,name,webhookCipher) VALUES(?,?,?,?) ON CONFLICT(id)
      DO UPDATE SET guildId=excluded.guildId,name=excluded.name,webhookCipher=excluded.webhookCipher`).bind(
          input.id,
          input.guildId,
          input.name,
          await seal(input.webhookUrl, c.env.ENCRYPTION_KEY),
        ),
        audit(c.env, who.id, "channel.configured", input.id),
      ]);
      return c.json({ ok: true } as const, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "put",
      path: "/api/v1/admin/channel-grants",
      security: ownerSecurity,
      request: { body: body(GrantInput) },
      responses: { 200: json(Ok) },
    }),
    async (c) => {
      const who = await admin(c);
      const input = c.req.valid("json");
      const target = await c.env.DB.prepare(
        "SELECT id FROM owners WHERE id=? AND EXISTS(SELECT 1 FROM channels WHERE id=?)",
      )
        .bind(input.ownerId, input.channelId)
        .first();
      if (!target) throw new HTTPException(404, { message: "grant_target_not_found" });
      await c.env.DB.batch([
        c.env.DB.prepare(`INSERT INTO channel_grants(ownerId,channelId,canRead,canPost) VALUES(?,?,?,?)
      ON CONFLICT(ownerId,channelId) DO UPDATE SET canRead=excluded.canRead,canPost=excluded.canPost`).bind(
          input.ownerId,
          input.channelId,
          Number(input.canRead),
          Number(input.canPost),
        ),
        audit(c.env, who.id, "channel.grant_changed", `${input.ownerId}/${input.channelId}`),
      ]);
      return c.json({ ok: true } as const, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/v1/admin/agents/{id}",
      security: ownerSecurity,
      request: { params: Params },
      responses: { 200: json(Ok) },
    }),
    async (c) => {
      const who = await admin(c);
      await disable(c.env, who.id, c.req.valid("param").id);
      return c.json({ ok: true } as const, 200);
    },
  );
}
