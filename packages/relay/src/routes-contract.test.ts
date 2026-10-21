import { AGENT_API, AUTH_API, DASHBOARD_API, PUBLIC_API, type Endpoint } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { internalApp, relayApp } from './app';
import { harness } from './testing';

// The four lists in contracts/api.ts are documentation and the only index of the surface.
// This keeps them honest: every route the apps register is listed, and every listed route is registered.

const registered = (app: { routes: { method: string; path: string }[] }) => app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`);
const listed = (...lists: Endpoint[][]) => lists.flat().map((e) => `${e.method} ${e.path}`);

describe('route lists', () => {
  const { relay } = harness();
  const publicRoutes = registered(relayApp(relay));
  const internalRoutes = registered(internalApp(relay));

  it('are compared against routes that exist', () => {
    expect(publicRoutes).toContain('GET /v1/channels');
    expect(internalRoutes).toContain('GET /internal/admin/health');
  });

  it('list every route the public app registers, and nothing else', () => {
    const expected = listed(AUTH_API, AGENT_API, PUBLIC_API);
    expect(publicRoutes.filter((r) => !expected.includes(r))).toEqual([]);
    expect(expected.filter((r) => !publicRoutes.includes(r))).toEqual([]);
  });

  it('list every route the internal app registers, and nothing else', () => {
    const expected = listed(DASHBOARD_API);
    expect(internalRoutes.filter((r) => !expected.includes(r))).toEqual([]);
    expect(expected.filter((r) => !internalRoutes.includes(r))).toEqual([]);
  });

  it('list no route twice', () => {
    const all = listed(AUTH_API, AGENT_API, PUBLIC_API, DASHBOARD_API);
    expect(all.filter((r, i) => all.indexOf(r) !== i)).toEqual([]);
  });

  it('keep dashboard routes off the public app', () => {
    expect(publicRoutes.filter((r) => r.split(' ')[1]!.startsWith('/internal'))).toEqual([]);
  });
});
