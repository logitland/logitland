import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { type AppEnv, audit, SESSION_COOKIE } from "./access";
import type { OwnerRow } from "./contracts";
import { equal, hash, readJson, token } from "./crypto";

const STATE_COOKIE = "swarmcord_oauth_state";
const FLOW_LIFETIME = 10 * 60 * 1000;
const SESSION_LIFETIME = 24 * 60 * 60 * 1000;
const DiscordUser = z.object({ id: z.string().regex(/^\d+$/), username: z.string() });

function cookieOptions(c: Context<AppEnv>, maxAge: number) {
  return {
    httpOnly: true,
    secure: new URL(c.env.PUBLIC_ORIGIN).protocol === "https:",
    sameSite: "Lax" as const,
    path: "/",
    maxAge,
  };
}

/** A local Discord-shaped provider exercises the same state/PKCE/callback path without a real account. */
function provider(env: Env) {
  return env.MODE === "fixture"
    ? `${env.INTEGRATION_ORIGIN}/oauth2`
    : "https://discord.com/api/oauth2";
}

export async function startLogin(c: Context<AppEnv>) {
  const state = token("state");
  const verifier = token("pkce");
  await c.env.DB.prepare("INSERT INTO oauth_states(stateHash,verifier,expiresAt) VALUES(?,?,?)")
    .bind(await hash(state), verifier, Date.now() + FLOW_LIFETIME)
    .run();
  setCookie(c, STATE_COOKIE, state, cookieOptions(c, FLOW_LIFETIME / 1000));
  const url = new URL(
    c.env.MODE === "fixture"
      ? `${provider(c.env)}/authorize`
      : "https://discord.com/oauth2/authorize",
  );
  url.search = new URLSearchParams({
    client_id: c.env.DISCORD_CLIENT_ID,
    redirect_uri: `${c.env.PUBLIC_ORIGIN}/auth/discord/callback`,
    response_type: "code",
    scope: "identify",
    state,
    code_challenge: Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ).toString("base64url"),
    code_challenge_method: "S256",
  }).toString();
  if (c.env.MODE === "fixture")
    url.searchParams.set("as", c.req.query("as") === "member" ? "member" : "admin");
  return c.redirect(url.toString());
}

export async function completeLogin(c: Context<AppEnv>) {
  const state = c.req.query("state") ?? "";
  const stateCookie = getCookie(c, STATE_COOKIE) ?? "";
  if (!state || !equal(state, stateCookie))
    throw new HTTPException(400, { message: "oauth_state_invalid" });
  const flow = await c.env.DB.prepare(
    "DELETE FROM oauth_states WHERE stateHash=? AND expiresAt>? RETURNING verifier",
  )
    .bind(await hash(state), Date.now())
    .first<{ verifier: string }>();
  deleteCookie(c, STATE_COOKIE, { path: "/" });
  const code = c.req.query("code");
  if (!flow || !code) throw new HTTPException(400, { message: "oauth_code_invalid" });
  const response = await fetch(`${provider(c.env)}/token`, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.env.DISCORD_CLIENT_ID,
      client_secret: c.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${c.env.PUBLIC_ORIGIN}/auth/discord/callback`,
      code_verifier: flow.verifier,
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new HTTPException(502, { message: "discord_login_failed" });
  }
  const credentials = await readJson(response, z.object({ access_token: z.string() }));
  const me = await fetch(
    c.env.MODE === "fixture"
      ? `${c.env.INTEGRATION_ORIGIN}/users/@me`
      : "https://discord.com/api/v10/users/@me",
    {
      headers: { Authorization: `Bearer ${credentials.access_token}` },
      signal: AbortSignal.timeout(8000),
      redirect: "manual",
    },
  );
  if (!me.ok) {
    await me.body?.cancel();
    throw new HTTPException(502, { message: "discord_identity_failed" });
  }
  const user = await readJson(me, DiscordUser);
  const identityProvider = c.env.MODE === "fixture" ? "discord_fixture" : "discord";
  const existing = await c.env.DB.prepare("SELECT identityProvider FROM owners WHERE discordId=?")
    .bind(user.id)
    .first<{ identityProvider: string }>();
  if (existing && existing.identityProvider !== identityProvider) {
    throw new HTTPException(503, { message: "identity_environment_mismatch" });
  }
  const found =
    await c.env.DB.prepare(`INSERT INTO owners(id,discordId,displayName,identityProvider,createdAt)
    VALUES(?,?,?,?,?) ON CONFLICT(discordId) DO UPDATE SET displayName=excluded.displayName RETURNING *`)
      .bind(token("own"), user.id, user.username, identityProvider, Date.now())
      .first<OwnerRow>();
  if (!found) throw new Error("owner_insert_failed");
  const session = token("session");
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO sessions(tokenHash,ownerId,expiresAt) VALUES(?,?,?)").bind(
      await hash(session),
      found.id,
      Date.now() + SESSION_LIFETIME,
    ),
    audit(c.env, found.id, "owner.login", found.id),
  ]);
  setCookie(c, SESSION_COOKIE, session, cookieOptions(c, SESSION_LIFETIME / 1000));
  return c.redirect(c.env.DASHBOARD_ORIGIN);
}
