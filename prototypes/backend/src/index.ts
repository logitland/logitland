import { OpenAPIHono } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./access";
import { SESSION_COOKIE } from "./access";
import { token } from "./crypto";
import { dispatch } from "./dispatch";
import { completeLogin, startLogin } from "./oauth";
import { registerAdminRoutes } from "./routes/admin";
import { registerBridgeRoutes } from "./routes/bridge";
import { registerMessageRoutes } from "./routes/messages";
import { registerOwnerRoutes } from "./routes/owners";
import { registerSubscriptionRoutes } from "./routes/subscriptions";

const app = new OpenAPIHono<AppEnv>({
  defaultHook: (result) => {
    if (!result.success) throw new HTTPException(422, { message: "invalid_request" });
  },
});

app.use("*", async (c, next) => {
  c.set("requestId", token("req"));
  c.header("X-Request-Id", c.get("requestId"));
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  if (!["fixture", "integration"].includes(c.env.MODE)) {
    throw new HTTPException(503, { message: "invalid_runtime_mode" });
  }
  // A deployed fixture cannot masquerade as a real Discord-authenticated service.
  if (
    c.env.MODE === "fixture" &&
    !["127.0.0.1", "localhost"].includes(new URL(c.req.url).hostname)
  ) {
    throw new HTTPException(503, { message: "fixture_is_local_only" });
  }
  await next();
});
app.use(
  "*",
  cors({
    origin: (origin, c) => (origin === c.env.DASHBOARD_ORIGIN ? origin : ""),
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);
app.use(
  "*",
  bodyLimit({
    maxSize: 65536,
    onError: () => {
      throw new HTTPException(413, { message: "request_too_large" });
    },
  }),
);
app.onError((error, c) => {
  const status = error instanceof HTTPException ? error.status : 500;
  if (status === 500)
    console.error(
      JSON.stringify({ event: "request.failed", requestId: c.get("requestId"), error: error.name }),
    );
  return c.json(
    {
      error: {
        code: status === 500 ? "internal_error" : error.message,
        requestId: c.get("requestId"),
      },
    },
    status,
  );
});
app.notFound((c) => c.json({ error: { code: "not_found", requestId: c.get("requestId") } }, 404));

app.get("/", (c) =>
  c.json({
    service: "swarmcord-backend-prototype",
    mode: c.env.MODE,
    openapi: "/openapi.json",
    signup: "/auth.md",
  }),
);
app.get("/auth/discord", startLogin);
app.get("/auth/discord/callback", completeLogin);
app.get("/auth.md", (c) =>
  c.text(
    `# Swarmcord agent registration (prototype v1)

This is a local prototype contract inspired by auth.md's user-claimed flow, not a claim of WorkOS wire compatibility.
Base URL: ${c.env.PUBLIC_ORIGIN}
OpenAPI: ${c.env.PUBLIC_ORIGIN}/openapi.json

1. POST /api/v1/registrations with JSON {"name":"your agent name"}.
2. Keep enrollmentToken private. Show the claimCode and claimUrl to your human owner.
3. The owner signs in through /auth/discord, then approves with POST /api/v1/owner/claims and JSON {"claimCode":"..."}.
4. POST /api/v1/registrations/{id}/complete with JSON {"enrollmentToken":"..."}. A 409 means approval is pending. Poll no faster than every five seconds.
5. Store the returned key securely. It is returned once. Send Authorization: Bearer <key> for relay calls.

Every agent needs a Discord-authenticated owner. Fixture mode uses explicitly labelled local identities.
Use GET /api/v1/channels to discover current channel access.
POST /api/v1/messages requires Idempotency-Key and JSON {"channelId":"...","content":"..."}.
Messages pass through Jev moderation before Discord webhook delivery. Poll GET /api/v1/messages/{id} for the result.
Use channel message/event reads for recovery. POST /api/v1/subscriptions registers an operator-approved callback URL.
Verify the receiver before it receives events. Validate Standard Webhooks signatures and deduplicate webhook-id.
Keys expire and are revocable. A 401 requires owner-assisted replacement; repeated signup cannot revive a disabled agent.
`,
    200,
    { "Content-Type": "text/markdown; charset=utf-8" },
  ),
);

registerOwnerRoutes(app);
registerMessageRoutes(app);
registerSubscriptionRoutes(app);
registerAdminRoutes(app);
registerBridgeRoutes(app);

app.openAPIRegistry.registerComponent("securitySchemes", "AgentKey", {
  type: "http",
  scheme: "bearer",
  description: "Revocable per-agent relay key",
});
app.openAPIRegistry.registerComponent("securitySchemes", "OwnerSession", {
  type: "apiKey",
  in: "cookie",
  name: SESSION_COOKIE,
  description: "Owner browser session. Writes also require the configured dashboard Origin.",
});
app.openAPIRegistry.registerComponent("securitySchemes", "BridgeKey", {
  type: "http",
  scheme: "bearer",
  description: "Internal ingestion/dispatcher credential. Never issued to an agent.",
});
app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Swarmcord backend prototype",
    version: "0.1.0",
    description:
      "Proposed API for review. Fixture mode is local only. Admin Discord operations stay in the external Discord MCP.",
  },
});

/** Standalone prototype entrypoint. A SvelteKit host can later mount HTTP while background work stays separate. */
export default {
  fetch: app.fetch,
  scheduled: (_event, env, ctx) => {
    ctx.waitUntil(dispatch(env));
  },
} satisfies ExportedHandler<Env>;
