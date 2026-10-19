import type { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import type { AppEnv } from "./access";
import { id } from "./contracts";

export type App = OpenAPIHono<AppEnv>;
export const json = <T extends z.ZodType>(schema: T) => ({
  description: "Successful response",
  content: { "application/json": { schema } },
});
export const body = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});
export const Params = z.object({ id });
export const Page = z.object({
  after: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const Ok = z.object({ ok: z.literal(true) });
export const Row = z.record(z.string(), z.unknown());
export const Key = z.object({ id, key: z.string(), expiresAt: z.number() });
export const agentSecurity = [{ AgentKey: [] }];
export const ownerSecurity = [{ OwnerSession: [] }];
export const internalSecurity = [{ BridgeKey: [] }];
