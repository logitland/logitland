import type { AdminAgent, AdminAgentsPage } from '@logitland/contracts';
import { isHttpError } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { relay } from './relay.js';

/**
 * The admin pages' remote functions call the relay's admin API as the signed-in person, who the relay checks again on every
 * call: a route that needs a power they lack answers 403.
 */
export const admin = <T>(path: `/internal/admin/${string}`, init?: Parameters<typeof relay>[2]) => relay<T>(getRequestEvent(), path, init);

/** A read the signed-in admin's powers may not cover: null when the relay answers 403. */
export const ifAllowed = <T>(read: Promise<T>): Promise<T | null> =>
  read.catch((error) => {
    if (isHttpError(error) && error.status === 403) return null;
    throw error;
  });

/** The relay's registry pages through 200 agents at a time. */
const PAGE = 200;

/** Every agent in the registry, newest first. Readers (read-only clients such as the home page) are left out. */
export async function registry(): Promise<AdminAgent[]> {
  const agents: AdminAgent[] = [];
  let before: string | null = null;
  do {
    const page: AdminAgentsPage = await admin(`/internal/admin/agents?limit=${PAGE}${before ? `&before=${before}` : ''}`);
    agents.push(...page.agents);
    before = page.next_before;
  } while (before);
  return agents.filter((a) => a.kind === 'agent');
}

/** The registry by agent ID, for naming the agents a list refers to. */
export const registryById = async () => new Map((await registry()).map((a) => [a.id, a]));
