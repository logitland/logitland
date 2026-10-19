import { z } from "zod";
import type { ChannelRow, MessageRow } from "./contracts";
import { readJson, unseal } from "./crypto";

const Verdict = z.object({
  model: z.string(),
  answers: z.object({
    moderation: z.object({
      type: z.literal("choice"),
      choice: z.enum(["allow", "block", "review"]),
      confidence: z.number().min(0).max(1),
    }),
  }),
});
const MIN_CONFIDENCE = 0.85;

/** Jev evaluates policy separately from untrusted message text. The policy is a prototype draft. */
export async function moderate(env: Env, message: MessageRow) {
  const input = {
    state: { content: message.content },
    questions: {
      moderation: {
        type: "choice",
        instructions: `Evaluate the content against this policy: ${env.MODERATION_POLICY}`,
        criteria: {
          allow: "The content complies with the policy.",
          block: "The content violates the policy.",
          review: "There is insufficient context or uncertainty to allow publication.",
        },
      },
    },
  };
  // Fixture mode never invokes paid inference. The real adapter uses the documented AI binding.
  let raw: unknown;
  if (env.MODE === "fixture") {
    const response = await fetch(`${env.INTEGRATION_ORIGIN}/moderate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(8000),
      redirect: "manual",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("moderation_unavailable");
    }
    raw = await readJson(response, Verdict);
  } else {
    raw = await env.AI.run("typesafe/jev", input, { signal: AbortSignal.timeout(8000) });
  }
  const result = Verdict.parse(raw);
  const answer = result.answers.moderation;
  return {
    state:
      answer.choice === "block"
        ? "blocked"
        : answer.choice === "allow" && answer.confidence >= MIN_CONFIDENCE
          ? "approved"
          : "held",
    reason: `${answer.choice} (${answer.confidence})`,
    model: result.model,
    confidence: answer.confidence,
  };
}

/** Only operator-approved origins are callable in this prototype; arbitrary-URL egress remains unproven. */
export function callbackUrl(env: Env, destination: string) {
  const url = new URL(destination);
  const allowed = env.CALLBACK_ORIGINS.split(",").map((x) => x.trim());
  if (!allowed.includes(url.origin) || url.username || url.password || url.hash)
    throw new Error("destination_not_allowed");
  if (env.MODE !== "fixture" && url.protocol !== "https:") throw new Error("https_required");
  return url;
}

export function discordWebhookUrl(env: Env, value: string) {
  const url = new URL(value);
  const fixture = env.MODE === "fixture" && url.origin === env.INTEGRATION_ORIGIN;
  if (env.MODE === "fixture" && !fixture) throw new Error("fixture_requires_local_webhook");
  if (
    !fixture &&
    (url.origin !== "https://discord.com" ||
      !/^\/api(?:\/v10)?\/webhooks\/\d+\/[\w.-]+$/.test(url.pathname))
  ) {
    throw new Error("invalid_discord_webhook");
  }
  if (url.username || url.password || url.hash || url.search)
    throw new Error("invalid_discord_webhook");
  return url;
}

/** Return an explicit uncertain outcome rather than retrying a potentially accepted Discord message. */
export async function sendDiscord(
  env: Env,
  channel: ChannelRow,
  message: MessageRow,
  agentName: string,
) {
  const url = discordWebhookUrl(env, await unseal(channel.webhookCipher, env.ENCRYPTION_KEY));
  url.searchParams.set("wait", "true");
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: agentName,
        content: message.content,
        allowed_mentions: { parse: [] },
      }),
    });
    if (response.status === 429) {
      const body = await readJson(response, z.object({ retry_after: z.number().positive() }));
      return {
        state: "approved",
        retryAt: Date.now() + Math.ceil(body.retry_after * 1000),
        error: "discord_rate_limited",
      } as const;
    }
    if (response.status >= 400 && response.status < 500) {
      await response.body?.cancel();
      return { state: "failed", error: `discord_${response.status}` } as const;
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { state: "uncertain", error: `discord_${response.status}` } as const;
    }
    const body = await readJson(response, z.object({ id: z.string().min(1) }));
    return { state: "sent", discordMessageId: body.id } as const;
  } catch {
    return { state: "uncertain", error: "discord_confirmation_missing" } as const;
  }
}
