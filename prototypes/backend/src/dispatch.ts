import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { channelAccess } from "./access";
import type {
  AgentRow,
  ChannelRow,
  DeliveryRow,
  EventRow,
  MessageRow,
  SubscriptionRow,
} from "./contracts";
import { envelope } from "./contracts";
import { hash, signature, token, unseal } from "./crypto";
import { callbackUrl, moderate, sendDiscord } from "./integrations";

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;

function retryAt(attempt: number) {
  return Date.now() + Math.min(300_000, 1000 * 2 ** attempt);
}

async function eligible(
  env: Env,
  agentId: string,
  channelId: string,
  permission: "canRead" | "canPost",
) {
  const agent = await env.DB.prepare(
    "SELECT a.id,a.ownerId,a.name,a.status,a.createdAt FROM agents a JOIN owners o ON o.id=a.ownerId WHERE a.id=? AND a.status='active' AND o.identityProvider=?",
  )
    .bind(agentId, env.MODE === "fixture" ? "discord_fixture" : "discord")
    .first<AgentRow>();
  if (!agent?.ownerId) return null;
  try {
    await channelAccess(env, agent.ownerId, channelId, permission);
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) return null;
    throw error;
  }
  return agent;
}

async function messages(env: Env) {
  // A crashed send cannot be retried safely. A crashed evaluation can be repeated on immutable content.
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE messages SET state='uncertain',lastError='send_lease_expired' WHERE state='sending' AND leaseUntil<?",
    ).bind(Date.now()),
    env.DB.prepare(
      "UPDATE messages SET state='pending',leaseToken=NULL WHERE state='moderating' AND leaseUntil<?",
    ).bind(Date.now()),
  ]);
  const due = await env.DB.prepare(`SELECT id FROM messages WHERE state IN ('pending','approved')
    AND nextAttemptAt<=? AND leaseUntil<=? ORDER BY createdAt LIMIT ?`)
    .bind(Date.now(), Date.now(), BATCH_SIZE)
    .all<{ id: string }>();
  for (const { id } of due.results) {
    const lease = token("lease");
    let message =
      await env.DB.prepare(`UPDATE messages SET state=CASE WHEN state='pending' THEN 'moderating' ELSE state END,
      leaseToken=?,leaseUntil=?,attempt=attempt+1,updatedAt=? WHERE id=? AND state IN ('pending','approved') AND leaseUntil<=? AND nextAttemptAt<=?
      RETURNING *`)
        .bind(lease, Date.now() + LEASE_MS, Date.now(), id, Date.now(), Date.now())
        .first<MessageRow>();
    if (!message) continue;
    if (message.state === "approved" && message.policyVersion !== env.MODERATION_POLICY_VERSION) {
      await env.DB.prepare(
        "UPDATE messages SET state='pending',leaseUntil=0 WHERE id=? AND leaseToken=?",
      )
        .bind(id, lease)
        .run();
      continue;
    }
    const actor = await eligible(env, message.agentId, message.channelId, "canPost");
    if (!actor) {
      await env.DB.prepare(
        "UPDATE messages SET state='cancelled',lastError='access_revoked',leaseUntil=0 WHERE id=? AND leaseToken=?",
      )
        .bind(id, lease)
        .run();
      continue;
    }
    if (message.state === "moderating") {
      const attempt = message.attempt;
      try {
        const verdict = await moderate(env, message);
        const decisionId = token("mod");
        await env.DB.prepare(`INSERT INTO moderation_decisions(id,messageId,contentHash,model,policyVersion,policyText,verdict,confidence,createdAt)
          VALUES(?,?,?,?,?,?,?,?,?)`)
          .bind(
            decisionId,
            id,
            await hash(message.content),
            verdict.model,
            env.MODERATION_POLICY_VERSION,
            env.MODERATION_POLICY,
            verdict.state,
            verdict.confidence,
            Date.now(),
          )
          .run();
        message =
          await env.DB.prepare(`UPDATE messages SET state=?,moderationId=?,moderationReason=?,policyVersion=?,updatedAt=?
          WHERE id=? AND leaseToken=? AND state='moderating' RETURNING *`)
            .bind(
              verdict.state,
              decisionId,
              verdict.reason,
              env.MODERATION_POLICY_VERSION,
              Date.now(),
              id,
              lease,
            )
            .first<MessageRow>();
      } catch {
        await env.DB.prepare(`UPDATE messages SET state=?,lastError='moderation_unavailable',nextAttemptAt=?,leaseUntil=0
          WHERE id=? AND leaseToken=? AND state='moderating'`)
          .bind(attempt >= MAX_ATTEMPTS ? "failed" : "pending", retryAt(attempt), id, lease)
          .run();
        continue;
      }
      if (message?.state !== "approved") continue;
    }
    if (!(await eligible(env, message.agentId, message.channelId, "canPost"))) {
      await env.DB.prepare(
        "UPDATE messages SET state='cancelled',leaseUntil=0 WHERE id=? AND leaseToken=?",
      )
        .bind(id, lease)
        .run();
      continue;
    }
    const channel = await env.DB.prepare("SELECT * FROM channels WHERE id=? AND active=1")
      .bind(message.channelId)
      .first<ChannelRow>();
    if (!channel) continue;
    const lock = await env.DB.prepare(`INSERT INTO send_locks(channelId,token,untilAt) VALUES(?,?,?)
      ON CONFLICT(channelId) DO UPDATE SET token=excluded.token,untilAt=excluded.untilAt
      WHERE send_locks.untilAt<=? RETURNING token`)
      .bind(channel.id, lease, Date.now() + LEASE_MS, Date.now())
      .first();
    if (!lock) {
      await env.DB.prepare(
        "UPDATE messages SET leaseUntil=0,nextAttemptAt=? WHERE id=? AND leaseToken=?",
      )
        .bind(Date.now() + 1000, id, lease)
        .run();
      continue;
    }
    const sending =
      await env.DB.prepare(`UPDATE messages SET state='sending' WHERE id=? AND leaseToken=?
      AND state='approved' AND leaseUntil>? RETURNING id`)
        .bind(id, lease, Date.now())
        .first();
    if (!sending) continue;
    const result = await sendDiscord(env, channel, message, actor.name);
    const next = "retryAt" in result ? result.retryAt : 0;
    await env.DB.batch([
      env.DB.prepare(`UPDATE messages SET state=?,discordMessageId=?,lastError=?,nextAttemptAt=?,leaseUntil=0,updatedAt=?
        WHERE id=? AND leaseToken=? AND state='sending'`).bind(
        result.state,
        "discordMessageId" in result ? result.discordMessageId : null,
        "error" in result ? result.error : null,
        next,
        Date.now(),
        id,
        lease,
      ),
      env.DB.prepare("UPDATE send_locks SET untilAt=? WHERE channelId=? AND token=?").bind(
        next,
        channel.id,
        lease,
      ),
    ]);
  }
  return due.results.length;
}

async function callbacks(env: Env) {
  const due =
    await env.DB.prepare(`SELECT id FROM deliveries WHERE (state='pending' OR (state='delivering' AND leaseUntil<=?))
    AND nextAttemptAt<=? ORDER BY createdAt,id LIMIT ?`)
      .bind(Date.now(), Date.now(), BATCH_SIZE)
      .all<{ id: string }>();
  for (const { id } of due.results) {
    const lease = token("lease");
    const delivery =
      await env.DB.prepare(`UPDATE deliveries SET state='delivering',leaseToken=?,leaseUntil=?,attempt=attempt+1
      WHERE id=? AND (state='pending' OR (state='delivering' AND leaseUntil<=?)) AND nextAttemptAt<=? RETURNING *`)
        .bind(lease, Date.now() + LEASE_MS, id, Date.now(), Date.now())
        .first<DeliveryRow>();
    if (!delivery) continue;
    const subscription = await env.DB.prepare("SELECT * FROM subscriptions WHERE id=?")
      .bind(delivery.subscriptionId)
      .first<SubscriptionRow>();
    const allowed =
      subscription?.status === "active" &&
      (await eligible(env, subscription.agentId, subscription.channelId, "canRead"));
    if (!allowed || !subscription) {
      await env.DB.prepare(
        "UPDATE deliveries SET state='cancelled',lastError='subscription_or_access_revoked' WHERE id=? AND leaseToken=?",
      )
        .bind(id, lease)
        .run();
      continue;
    }
    const event = await env.DB.prepare("SELECT * FROM events WHERE id=?")
      .bind(delivery.eventId)
      .first<EventRow>();
    if (!event) throw new Error("delivery_event_missing");
    let status: number | null = null;
    let state: "delivered" | "pending" | "dead" = "pending";
    let error: string | null = null;
    let next = retryAt(delivery.attempt);
    try {
      const url = callbackUrl(
        env,
        await unseal(subscription.destinationCipher, env.ENCRYPTION_KEY),
      );
      const body = JSON.stringify(envelope(event));
      const timestamp = String(Math.floor(Date.now() / 1000));
      const secret = await unseal(subscription.signingCipher, env.ENCRYPTION_KEY);
      const response = await fetch(url, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(8000),
        redirect: "manual",
        headers: {
          "Content-Type": "application/json",
          "webhook-id": id,
          "webhook-timestamp": timestamp,
          "webhook-signature": await signature(secret, id, timestamp, body),
        },
      });
      status = response.status;
      const retry = response.headers.get("Retry-After");
      if (retry && z.coerce.number().nonnegative().safeParse(retry).success)
        next = Math.max(next, Date.now() + Math.min(Number(retry), 86400) * 1000);
      await response.body?.cancel();
      state = response.ok ? "delivered" : status === 429 || status >= 500 ? "pending" : "dead";
      error = response.ok ? null : `callback_${status}`;
      if (status === 410)
        await env.DB.prepare("UPDATE subscriptions SET status='disabled' WHERE id=?")
          .bind(subscription.id)
          .run();
    } catch {
      error = "callback_transport_or_policy_failure";
    }
    if (state === "pending" && delivery.attempt >= MAX_ATTEMPTS) state = "dead";
    await env.DB.prepare(`UPDATE deliveries SET state=?,lastStatus=?,lastError=?,nextAttemptAt=?,leaseUntil=0
      WHERE id=? AND leaseToken=? AND state='delivering'`)
      .bind(state, status, error, next, id, lease)
      .run();
  }
  return due.results.length;
}

/** Durable work is discoverable from D1; scheduled execution can later be replaced by Queue wakeups. */
export async function dispatch(env: Env) {
  const sends = await messages(env);
  const deliveries = await callbacks(env);
  return { sends, deliveries };
}
