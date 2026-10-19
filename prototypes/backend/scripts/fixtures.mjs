import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";

/** Local Discord/Jev-shaped boundaries. All state here is intentionally disposable. */
export function startFixtures({ origin, integrationOrigin, internalToken }) {
  const codes = new Map();
  const tokens = new Map();
  const messages = [];
  const callbacks = [];
  const moderation = [];
  const failures = new Map();
  let sequence = 0;
  const messageBase = BigInt(Date.now()) * 1_000_000n;
  const response = (res, status, value) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(value));
  };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, integrationOrigin);
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
        if (chunks.reduce((sum, item) => sum + item.length, 0) > 65536) {
          response(res, 413, { error: "too_large" });
          return;
        }
      }
      const raw = Buffer.concat(chunks).toString();
      if (url.pathname === "/oauth2/authorize") {
        const code = randomUUID();
        codes.set(code, {
          challenge: url.searchParams.get("code_challenge"),
          as: url.searchParams.get("as"),
        });
        const target = new URL(url.searchParams.get("redirect_uri"));
        if (target.origin !== origin) {
          response(res, 400, {});
          return;
        }
        target.searchParams.set("code", code);
        target.searchParams.set("state", url.searchParams.get("state"));
        res.writeHead(302, { Location: target.toString() });
        res.end();
        return;
      }
      if (url.pathname === "/oauth2/token") {
        const form = new URLSearchParams(raw);
        const code = codes.get(form.get("code"));
        codes.delete(form.get("code"));
        if (
          !code ||
          createHash("sha256")
            .update(form.get("code_verifier") ?? "")
            .digest("base64url") !== code.challenge
        ) {
          response(res, 400, { error: "invalid_grant" });
          return;
        }
        const access = randomUUID();
        tokens.set(access, code.as);
        response(res, 200, { access_token: access });
        return;
      }
      if (url.pathname === "/users/@me") {
        const as = tokens.get(req.headers.authorization?.slice(7));
        if (!as) {
          response(res, 401, {});
          return;
        }
        response(res, 200, {
          id: as === "member" ? "100000000000000002" : "100000000000000001",
          username: `fixture-${as}`,
        });
        return;
      }
      if (url.pathname === "/moderate") {
        const input = JSON.parse(raw);
        const content = input.state.content;
        const choice = content.includes("[block]")
          ? "block"
          : content.includes("[review]")
            ? "review"
            : "allow";
        moderation.push({ content, choice });
        if (content.includes("[moderation-down]")) {
          response(res, 503, { error: "fixture_unavailable" });
          return;
        }
        response(res, 200, {
          model: "jev-fixture-not-inference",
          answers: { moderation: { type: "choice", choice, confidence: 0.99 } },
        });
        return;
      }
      if (url.pathname.startsWith("/webhooks/")) {
        const input = JSON.parse(raw);
        const key = `${url.pathname}/${input.content}`;
        const attempted = failures.get(key) ?? 0;
        failures.set(key, attempted + 1);
        if (input.content.includes("[rate-limit]") && attempted === 0) {
          response(res, 429, { retry_after: 0.1 });
          return;
        }
        const message = {
          id: String(messageBase + BigInt(++sequence)),
          content: input.content,
          username: input.username,
          mentions: input.allowed_mentions,
        };
        messages.push(message);
        if (input.content.includes("[uncertain]")) {
          res.destroy();
          return;
        }
        response(res, 200, message);
        // A real Gateway event may arrive before or after the send response. This fixture sends it later.
        setTimeout(async () => {
          try {
            const sent = await fetch(`${origin}/internal/events`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${internalToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                source: "discord-mcp",
                events: [
                  {
                    type: "message.created",
                    sourceEventId: `fixture-${message.id}`,
                    channelId: url.pathname.split("/").at(-1),
                    discordMessageId: message.id,
                    content: message.content,
                    occurredAt: Date.now(),
                  },
                ],
              }),
            });
            if (!sent.ok) console.error(`fixture event intake returned ${sent.status}`);
            await sent.body?.cancel();
          } catch (error) {
            console.error("fixture event intake failed", error.message);
          }
        }, 50);
        return;
      }
      if (url.pathname.startsWith("/receivers/")) {
        const input = JSON.parse(raw);
        if (input.type === "subscription.challenge") {
          response(res, 200, { challenge: input.challenge });
          return;
        }
        callbacks.push({ destination: url.pathname, headers: req.headers, body: input, raw });
        const count = failures.get(url.pathname) ?? 0;
        failures.set(url.pathname, count + 1);
        const status = url.pathname.endsWith("/flaky") && count === 0 ? 503 : 204;
        res.writeHead(status);
        res.end();
        return;
      }
      if (url.pathname === "/inspect") {
        response(res, 200, { messages, callbacks, moderation });
        return;
      }
      response(res, 404, { error: "fixture_route_missing" });
    } catch (error) {
      response(res, 500, { error: error.message });
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(new URL(integrationOrigin).port, "127.0.0.1", () => resolve(server));
  });
}
