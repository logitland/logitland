import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startFixtures } from "./fixtures.mjs";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
// Reuse local encryption material so restarting does not invalidate persisted credentials.
if (!existsSync(".dev.vars")) {
  writeFileSync(
    ".dev.vars",
    Object.entries({
      ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      INTERNAL_TOKEN: randomBytes(32).toString("base64url"),
      DISCORD_CLIENT_SECRET: "fixture-only",
    })
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n"),
    { mode: 0o600 },
  );
}
const secrets = Object.fromEntries(
  readFileSync(".dev.vars", "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const position = line.indexOf("=");
      return [line.slice(0, position), JSON.parse(line.slice(position + 1))];
    }),
);
const origin = "http://127.0.0.1:18990";
const integrationOrigin = "http://127.0.0.1:18991";
// Workers AI has no local emulator. Omit its binding entirely so local runs cannot make paid calls.
const localConfig = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
delete localConfig.ai;
writeFileSync(".wrangler.fixture.json", JSON.stringify(localConfig, null, 2));
const migrate = spawnSync(
  "pnpm",
  [
    "exec",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--config",
    ".wrangler.fixture.json",
  ],
  { stdio: "inherit" },
);
if (migrate.status !== 0) process.exit(migrate.status ?? 1);
const types = spawnSync(
  "pnpm",
  ["exec", "wrangler", "types", "--include-runtime", "false", "--strict-vars", "false"],
  { stdio: "inherit" },
);
if (types.status !== 0) process.exit(types.status ?? 1);
const fixture = await startFixtures({
  origin,
  integrationOrigin,
  internalToken: secrets.INTERNAL_TOKEN,
});
const worker = spawn(
  "pnpm",
  [
    "exec",
    "wrangler",
    "dev",
    "--config",
    ".wrangler.fixture.json",
    "--local",
    "--ip",
    "127.0.0.1",
    "--port",
    "18990",
    "--show-interactive-dev-session",
    "false",
    "--log-level",
    "warn",
  ],
  { stdio: "inherit", detached: process.platform !== "win32" },
);
let draining = false;
const interval = setInterval(async () => {
  if (draining) return;
  draining = true;
  try {
    const result = await fetch(`${origin}/internal/dispatch`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secrets.INTERNAL_TOKEN}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (result.status >= 500) console.error(`dispatcher returned ${result.status}`);
    await result.body?.cancel();
  } catch (error) {
    if (error.cause?.code !== "ECONNREFUSED")
      console.error("local dispatcher unavailable", error.message);
  } finally {
    draining = false;
  }
}, 1000);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(interval);
  if (process.platform === "win32") worker.kill("SIGTERM");
  else if (worker.pid) process.kill(-worker.pid, "SIGTERM");
  fixture.close();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
worker.on("exit", (code) => {
  clearInterval(interval);
  fixture.close();
  process.exitCode = code ?? 0;
});
console.log(
  `Local prototype: ${origin}. Fixtures: ${integrationOrigin}. No live Discord or paid inference.`,
);
