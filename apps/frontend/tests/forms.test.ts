import { describe, expect, it, vi } from 'vitest';

const sent: { path: string; body: Record<string, unknown> }[] = [];

const env = {
  DATA_SOURCE: 'relay',
  PUBLIC_URL: 'https://logitland.example.net',
  INTERNAL_TOKEN: 'q8Zr0v3mT9bWk2LxN7cYh5JdFs1GaP4e',
  BACKEND: {
    fetch: async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : {};
      sent.push({ path: new URL(url).pathname, body });
      return Response.json({
        id: '110000000000000001',
        guild_id: '100000000000000001',
        name: 'agent-lounge',
        type: 'text',
        agent_access: body.agent_access,
        pace_per_agent_per_minute: body.pace_per_agent_per_minute,
        public_mirror: body.public_mirror,
        verified_only: body.verified_only,
        has_webhook: true,
      });
    },
  },
};

vi.mock('cloudflare:workers', () => ({ env }));

const locals = { viewer: { owner_id: 'own_01JA0HALCYON00000', discord_user_id: '200000000000000099', username: 'halcyon', is_admin: true, demo: false } };

function saveRequest(pace: string) {
  const form = new FormData();
  form.set('channel_id', '110000000000000001');
  form.set('access', 'post');
  form.set('type', 'text');
  form.set('pace', pace);
  form.set('mirror', 'on');
  return new Request('https://logitland.example.net/admin/channels?/save', { method: 'POST', body: form });
}

describe('pace', () => {
  it('reads whole numbers from 0 to 120 and nothing else', async () => {
    const { readPace } = await import('../src/lib/server/discord-actions.ts');
    expect(readPace('0')).toBe(0);
    expect(readPace(' 10 ')).toBe(10);
    for (const bad of ['', '   ', '1.5', '-1', '121', 'abc', null]) expect(readPace(bad), String(bad)).toBeNull();
  });

  it('an empty pace is refused by the channel save and never reaches the relay', async () => {
    const { actions } = await import('../src/routes/admin/channels/+page.server.ts');
    sent.length = 0;
    const out = (await actions.save({ request: saveRequest(''), locals } as never)) as { status: number };
    expect(out.status).toBe(400);
    expect(sent).toEqual([]);
  });

  it('a typed pace is saved as given, including 0', async () => {
    const { actions } = await import('../src/routes/admin/channels/+page.server.ts');
    sent.length = 0;
    await actions.save({ request: saveRequest('0'), locals } as never);
    expect(sent[0]!.body.pace_per_agent_per_minute).toBe(0);
  });
});

describe('claim form', () => {
  const post = (headers: Record<string, string>, body: string) =>
    new Request('https://logitland.example.net/claim', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body });

  it('refuses a body bigger than a code could need without reading it', async () => {
    const { actions } = await import('../src/routes/(owner)/claim/+page.server.ts');
    const request = post({ 'content-length': '5000000' }, 'code=x');
    const read = vi.spyOn(request, 'formData');
    const out = (await actions.default({ request } as never)) as { status: number };
    expect(out.status).toBe(413);
    expect(read).not.toHaveBeenCalled();
  });

  it('accepts a normal code', async () => {
    const { actions } = await import('../src/routes/(owner)/claim/+page.server.ts');
    const body = 'code=7qfmkx2d';
    await expect(actions.default({ request: post({ 'content-length': String(body.length) }, body) } as never)).rejects.toMatchObject({
      location: '/claim/7QFM-KX2D',
    });
  });
});
