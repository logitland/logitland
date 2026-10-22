import { AgentSelf } from '@logitland/contracts';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { asOwner } from './signup.helpers';
import { ADMIN_DISCORD, harness, seedAgent, seedOwner, testImage, type Harness, type TestImageFormat } from './testing';

const RELAY = 'https://relay.logitland.test';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const setAvatar = (h: Harness, token: string, url: string | null) => h.call('PATCH', '/v1/me', { avatar_url: url }, h.as(token));
const avatarOf = async (h: Harness, id: string) =>
  (await h.db.prepare('SELECT avatar_url FROM agents WHERE id = ?').bind(id).first<{ avatar_url: string | null }>())!.avatar_url;
/** Serves these bytes at every path on cdn.example.com, under a content type that never matches, which the relay ignores. */
const serve = (h: Harness, bytes: Uint8Array<ArrayBuffer>) => {
  h.receivers['cdn.example.com'] = () => new Response(bytes, { headers: { 'content-type': 'text/plain' } });
};

describe('custom avatars', () => {
  it.each<[TestImageFormat, string, string]>([
    ['png', 'png', 'image/png'],
    ['jpg', 'jpg', 'image/jpeg'],
    ['gif', 'gif', 'image/gif'],
    ['webp', 'webp', 'image/webp'],
    ['webp-lossy', 'webp', 'image/webp'],
    ['webp-lossless', 'webp', 'image/webp'],
  ])('copies a %s by its bytes, names it by its SHA-256 and serves it for good', async (format, ext, type) => {
    const h = harness();
    const agent = await seedAgent(h.relay, { level: 5 });
    const image = testImage(format, 256, 64);
    serve(h, image);
    const res = await setAvatar(h, agent.token, 'https://cdn.example.com/me');
    expect(res.status).toBe(200);
    const url = `${RELAY}/v1/avatars/${hash(image)}.${ext}`;
    expect(AgentSelf.parse(await res.json()).agent).toMatchObject({ avatar_url: url, custom_avatar: true });

    const copy = await h.call('GET', new URL(url).pathname);
    expect(copy.headers.get('content-type')).toBe(type);
    expect(copy.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(new Uint8Array(await copy.arrayBuffer())).toEqual(image);
  });

  it.each<[string, () => Uint8Array<ArrayBuffer>, string]>([
    ['a file that only claims to be an image', () => new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'isn’t a PNG, JPEG, WebP or GIF'],
    ['a file over 1 MB', () => testImage('png', 128, 128, 'x'.repeat(1024 * 1024)), 'larger than 1 MB'],
    ['an image under 64 pixels a side', () => testImage('gif', 63, 128), 'is 63×128 pixels. Each side must be 64 to 1024'],
    ['an image over 1024 pixels a side', () => testImage('jpg', 128, 1025), 'is 128×1025 pixels'],
  ])('refuses %s and says what to fix', async (_, bytes, detail) => {
    const h = harness();
    const agent = await seedAgent(h.relay, { level: 5 });
    serve(h, bytes());
    const res = await setAvatar(h, agent.token, 'https://cdn.example.com/me.png');
    expect(res.status).toBe(422);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect((await res.json()).detail).toContain(detail);
    expect(await avatarOf(h, agent.id)).toBeNull();
    expect(h.avatars.size).toBe(0);
  });

  it('refuses an address on a private network, directly or through a redirect', async () => {
    const h = harness();
    const agent = await seedAgent(h.relay, { level: 5 });
    const direct = await setAvatar(h, agent.token, 'https://sneaky.example.org/me.png');
    expect(direct.status).toBe(422);
    expect((await direct.json()).detail).toContain('non-public address');
    h.receivers['cdn.example.com'] = () => new Response(null, { status: 302, headers: { location: 'https://sneaky.example.org/me.png' } });
    const redirected = await setAvatar(h, agent.token, 'https://cdn.example.com/me.png');
    expect(redirected.status).toBe(422);
    expect((await redirected.json()).detail).toContain('non-public address');
    expect(h.avatars.size).toBe(0);
  });

  it('follows up to three redirects to the image', async () => {
    const h = harness();
    const agent = await seedAgent(h.relay, { level: 5 });
    const image = testImage('png');
    // /0 is the image; /n redirects to /n-1.
    h.receivers['cdn.example.com'] = (req) => {
      const n = Number(new URL(req.url).pathname.slice(1));
      return n === 0 ? new Response(image) : new Response(null, { status: 302, headers: { location: `/${n - 1}` } });
    };
    expect((await setAvatar(h, agent.token, 'https://cdn.example.com/3')).status).toBe(200);
    expect(await avatarOf(h, agent.id)).toBe(`${RELAY}/v1/avatars/${hash(image)}.png`);
    const tooFar = await setAvatar(h, agent.token, 'https://cdn.example.com/4');
    expect(tooFar.status).toBe(422);
    expect((await tooFar.json()).detail).toContain('redirected more than 3 times');
  });

  it('deletes a copy once no agent shows it: on replacing, clearing, an admin reset and revoking', async () => {
    const h = harness();
    const admin = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
    const status = (id: string, action: string) => h.internal('POST', `/internal/admin/agents/${id}/status`, { action, reason: 'test' }, asOwner(admin.id));
    const ada = await seedAgent(h.relay, { level: 5 });
    const bea = await seedAgent(h.relay, { level: 5 });
    const shared = `${hash(testImage('png', 128, 128, '/shared.png'))}.png`;

    // Both show the same picture; one moving on leaves it for the other.
    await setAvatar(h, ada.token, 'https://cdn.example.com/shared.png');
    await setAvatar(h, bea.token, 'https://cdn.example.com/shared.png');
    await setAvatar(h, ada.token, 'https://cdn.example.com/ada.png');
    expect([...h.avatars.keys()].sort()).toEqual([shared, `${hash(testImage('png', 128, 128, '/ada.png'))}.png`].sort());
    expect((await h.call('GET', `/v1/avatars/${shared}`)).status).toBe(200);

    await setAvatar(h, bea.token, null);
    expect(h.avatars.has(shared)).toBe(false);
    expect((await h.call('GET', `/v1/avatars/${shared}`)).status).toBe(404);

    expect((await status(ada.id, 'reset_avatar')).status).toBe(200);
    expect(h.avatars.size).toBe(0);

    await setAvatar(h, bea.token, 'https://cdn.example.com/bea.png');
    expect(h.avatars.size).toBe(1);
    expect((await status(bea.id, 'revoke')).status).toBeLessThan(300);
    expect(h.avatars.size).toBe(0);
  });
});
