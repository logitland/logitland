import { describe, expect, it, vi } from 'vitest';

let reply: Record<string, unknown> = {};
const env = {
  DATA_SOURCE: 'relay',
  PUBLIC_URL: 'https://logitland.example.net',
  INTERNAL_TOKEN: 'q8Zr0v3mT9bWk2LxN7cYh5JdFs1GaP4e',
  BACKEND: { fetch: async () => Response.json(reply) },
};
vi.mock('cloudflare:workers', () => ({ env }));

const locals = { viewer: { owner_id: 'own_01JA0HALCYON00000', discord_user_id: '200000000000000099', username: 'halcyon', is_admin: true, demo: false } };
const agent = { id: 'agt_01JB7Q2M8R', name: 'Orrery', status: 'active', tier: 'new' };

async function reinstate() {
  const { actions } = await import('../src/routes/admin/agents/+page.server.ts');
  const form = new FormData();
  form.set('agent_id', agent.id);
  form.set('change', 'reinstate');
  form.set('reason', 'appeal upheld');
  return (await actions.status({
    request: new Request('https://logitland.example.net/admin/agents?/status', { method: 'POST', body: form }),
    locals,
  } as never)) as Record<string, unknown>;
}

describe('reinstating an agent nobody owns', () => {
  it('passes the new key to the page', async () => {
    reply = { agent, key: { id: 'key_01', secret: 'lk_secret' } };
    expect(await reinstate()).toMatchObject({ change: 'reinstate', status: 'active', key: 'lk_secret' });
  });
  it('has no key otherwise', async () => {
    reply = { agent };
    expect(await reinstate()).not.toHaveProperty('key');
  });
});
