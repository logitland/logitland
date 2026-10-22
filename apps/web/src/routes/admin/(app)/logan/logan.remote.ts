import type { LoganSetup } from '@logitland/contracts';
import { query } from '$app/server';
import { admin } from '#lib/server/admin.js';

/** The Logan admin MCP's URL and the channel where destructive requests wait for a Confirm. Needs the logan power. */
export const setup = query(() => admin<LoganSetup>('/internal/admin/logan'));
