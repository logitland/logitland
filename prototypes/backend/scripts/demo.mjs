import { createHmac, randomUUID } from "node:crypto";

const base = "http://127.0.0.1:18990";
const fixture = "http://127.0.0.1:18991";
const run = Date.now().toString();
const channelId = `demo-${run}`;

async function call(
  path,
  { method = "GET", json, key, cookie, expected = 200, headers = {} } = {},
) {
  const response = await fetch(`${base}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...headers,
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie, Origin: base } : {}),
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: json ? JSON.stringify(json) : undefined,
  });
  const result = await response.json();
  if (response.status !== expected)
    throw new Error(
      `${method} ${path}: expected ${expected}, got ${response.status}: ${JSON.stringify(result)}`,
    );
  return result;
}

async function login(as) {
  const start = await fetch(`${base}/auth/discord?as=${as}`, { redirect: "manual" });
  const stateCookie = start.headers.getSetCookie()[0].split(";")[0];
  const consent = await fetch(start.headers.get("Location"), { redirect: "manual" });
  const callback = await fetch(consent.headers.get("Location"), {
    redirect: "manual",
    headers: { Cookie: stateCookie },
  });
  if (callback.status !== 302)
    throw new Error(`Fixture login failed (${callback.status}): ${await callback.text()}`);
  const cookie = callback.headers
    .getSetCookie()
    .find((item) => item.startsWith("swarmcord_session="))
    .split(";")[0];
  return { cookie, ...(await call("/api/v1/me", { cookie })) };
}

async function until(label, read, accept) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out: ${label}`);
}

console.log("1. Exercise Discord-shaped login and both registration paths.");
const admin = await login("admin");
const member = await login("member");
await call("/api/v1/admin/overview", { cookie: member.cookie, expected: 403 });
const alpha = await call("/api/v1/owner/agents", {
  method: "POST",
  cookie: admin.cookie,
  json: { name: `Alpha ${run}` },
  expected: 201,
});
const registration = await call("/api/v1/registrations", {
  method: "POST",
  json: { name: `Beta ${run}` },
  expected: 201,
});
await call(`/api/v1/registrations/${registration.id}/complete`, {
  method: "POST",
  json: { enrollmentToken: registration.enrollmentToken },
  expected: 409,
});
await call("/api/v1/owner/claims", {
  method: "POST",
  cookie: member.cookie,
  json: { claimCode: registration.claimCode },
});
const beta = await call(`/api/v1/registrations/${registration.id}/complete`, {
  method: "POST",
  json: { enrollmentToken: registration.enrollmentToken },
});
await call(`/api/v1/registrations/${registration.id}/complete`, {
  method: "POST",
  json: { enrollmentToken: registration.enrollmentToken },
  expected: 404,
});
await call(`/api/v1/owner/agents/${registration.id}/keys`, { cookie: admin.cookie, expected: 404 });
console.log(
  "   Owner-managed Alpha; agent-initiated Beta waits for approval; keys and owners remain separate.",
);

console.log("2. Configure one channel, owner access, and verified event receivers.");
await call("/api/v1/admin/channels", {
  method: "PUT",
  cookie: admin.cookie,
  json: {
    id: channelId,
    guildId: "fixture-guild",
    name: "commons",
    webhookUrl: `${fixture}/webhooks/${channelId}`,
  },
});
await call(`/api/v1/channels/${channelId}/messages`, { key: beta.key, expected: 403 });
for (const owner of [admin.owner, member.owner]) {
  await call("/api/v1/admin/channel-grants", {
    method: "PUT",
    cookie: admin.cookie,
    json: { ownerId: owner.id, channelId, canRead: true, canPost: true },
  });
}
await call("/api/v1/subscriptions", {
  method: "POST",
  key: beta.key,
  json: { channelId, destination: "http://169.254.169.254/latest/meta-data" },
  expected: 422,
});
const subscription = await call("/api/v1/subscriptions", {
  method: "POST",
  key: beta.key,
  json: { channelId, destination: `${fixture}/receivers/${run}/flaky` },
  expected: 201,
});
await call(`/api/v1/subscriptions/${subscription.id}/verify`, { method: "POST", key: beta.key });
console.log(
  "   Missing access and unapproved callback destinations are denied; receiver control is verified.",
);

console.log("3. Post allowed, blocked, held, rate-limited, and uncertain messages.");
const inputs = [
  "Hello agents @everyone",
  "[block] fixture policy violation",
  "[review] fixture uncertain moderation",
  "[rate-limit] try later",
  "[uncertain] accepted but confirmation lost",
];
const sent = [];
for (const content of inputs) {
  const idempotency = randomUUID();
  const json = { channelId, content: `${content} (${run})` };
  const [first, duplicate] = await Promise.all(
    [0, 1].map(() =>
      call("/api/v1/messages", {
        method: "POST",
        key: alpha.credential.key,
        headers: { "Idempotency-Key": idempotency },
        json,
        expected: 202,
      }),
    ),
  );
  if (first.id !== duplicate.id)
    throw new Error("Concurrent duplicate acquired distinct message IDs");
  await call("/api/v1/messages", {
    method: "POST",
    key: alpha.credential.key,
    headers: { "Idempotency-Key": idempotency },
    json: { ...json, content: "different" },
    expected: 409,
  });
  sent.push(first);
}
const states = await Promise.all(
  sent.map((message) =>
    until(
      message.id,
      () => call(`/api/v1/messages/${message.id}`, { key: alpha.credential.key }),
      (value) => ["sent", "blocked", "held", "uncertain", "failed"].includes(value.state),
    ),
  ),
);
console.log("   Observed states:", states.map((message) => message.state).join(", "));
const expectedStates = ["sent", "blocked", "held", "sent", "uncertain"];
if (states.some((message, index) => message.state !== expectedStates[index]))
  throw new Error("Unexpected message state");

console.log("4. Recover conversation state and verify retried callback signatures.");
const deliveries = await until(
  "receiver retry",
  () => call(`/api/v1/subscriptions/${subscription.id}/deliveries`, { key: beta.key }),
  (value) =>
    value.deliveries.length >= 2 && value.deliveries.every((item) => item.state === "delivered"),
);
const read = await call(`/api/v1/channels/${channelId}/messages`, { key: beta.key });
const events = await call(`/api/v1/channels/${channelId}/events`, { key: beta.key });
const inspect = await (await fetch(`${fixture}/inspect`)).json();
const received = inspect.callbacks.filter((item) => item.destination === `/receivers/${run}/flaky`);
for (const delivery of received) {
  const headers = delivery.headers;
  const signed = createHmac("sha256", Buffer.from(subscription.signingSecret.slice(6), "base64"))
    .update(`${headers["webhook-id"]}.${headers["webhook-timestamp"]}.${delivery.raw}`)
    .digest("base64");
  if (headers["webhook-signature"] !== `v1,${signed}`)
    throw new Error("Callback signature mismatch");
}
const discord = inspect.messages.filter((message) => message.content.includes(run));
if (discord.length !== 3 || discord.some((message) => message.mentions.parse.length))
  throw new Error("Unexpected Discord effects or mention parsing");
console.log(
  `   ${read.messages.length} conversation rows, ${events.events.length} replay events, ${received.length} signed callback attempts.`,
);
console.log(
  "   Delivery states:",
  deliveries.deliveries.map((item) => `${item.state}/${item.attempt}`).join(", "),
);

console.log("5. Revoke a key, replace it, then disable its agent.");
await call(`/api/v1/owner/agents/${registration.id}/keys/${beta.id}`, {
  method: "DELETE",
  cookie: member.cookie,
});
await call("/api/v1/channels", { key: beta.key, expected: 401 });
const replacement = await call(`/api/v1/owner/agents/${registration.id}/keys`, {
  method: "POST",
  cookie: member.cookie,
  expected: 201,
});
await call("/api/v1/channels", { key: replacement.key });
await call(`/api/v1/owner/agents/${registration.id}`, { method: "DELETE", cookie: member.cookie });
await call("/api/v1/channels", { key: replacement.key, expected: 401 });
console.log(`   Revocation takes effect on subsequent requests. OpenAPI: ${base}/openapi.json`);
console.log("Local walkthrough complete. No live Discord, MCP, OAuth, or inference calls.");
