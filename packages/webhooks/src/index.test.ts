import { Webhook } from 'standardwebhooks';
import { describe, expect, it } from 'vitest';
import { WebhookVerificationError, generateSecret, sign, signHeaders, verify } from './index';

const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const body = JSON.stringify({ type: 'message.created', data: { message_id: '123' } });
const now = new Date('2026-10-19T03:14:00Z');

describe('sign / verify', () => {
  it('round-trips', async () => {
    const h = await signHeaders(secret, 'del_01JD5T8QWE', body, now);
    await expect(verify(h, body, secret, { now })).resolves.toEqual({ id: 'del_01JD5T8QWE', timestamp: 1792379640 });
  });

  it('rejects a modified body', async () => {
    const h = await signHeaders(secret, 'del_1', body, now);
    await expect(verify(h, body.replace('123', '124'), secret, { now })).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it('rejects stale timestamps', async () => {
    const h = await signHeaders(secret, 'del_1', body, new Date(now.getTime() - 301_000));
    await expect(verify(h, body, secret, { now })).rejects.toThrow('tolerance');
  });

  it('accepts any secret during rotation', async () => {
    const next = generateSecret();
    const h = await signHeaders(next, 'del_1', body, now);
    await expect(verify(h, body, [secret, next], { now })).resolves.toBeTruthy();
  });

  it('accepts a signature list with unknown versions', async () => {
    const s = await sign(secret, 'del_1', 1792379640, body);
    const h = { 'webhook-id': 'del_1', 'webhook-timestamp': '1792379640', 'webhook-signature': `v1a,abc ${s}` };
    await expect(verify(h, body, secret, { now })).resolves.toBeTruthy();
  });

  it('signs with several secrets, one signature each', async () => {
    const next = generateSecret();
    const h = await signHeaders([next, secret], 'del_1', body, now);
    const parts = h['webhook-signature'].split(' ');
    expect(parts).toHaveLength(2);
    expect(parts.every((p) => p.startsWith('v1,'))).toBe(true);
    expect(parts[0]).toBe(await sign(next, 'del_1', 1792379640, body));
    expect(parts[1]).toBe(await sign(secret, 'del_1', 1792379640, body));
    await expect(verify(h, body, next, { now })).resolves.toBeTruthy();
    await expect(verify(h, body, secret, { now })).resolves.toBeTruthy();
    await expect(verify(h, body, generateSecret(), { now })).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it('keeps one signature for a single secret in a list', async () => {
    const h = await signHeaders([secret], 'del_1', body, now);
    expect(h['webhook-signature']).toBe(await sign(secret, 'del_1', 1792379640, body));
  });

  it('refuses to sign without a secret', async () => {
    await expect(signHeaders([], 'del_1', body, now)).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it('refuses ids that would make the signed content ambiguous', async () => {
    await expect(sign(secret, 'a.b', 1, body)).rejects.toThrow('webhook-id');
  });
});

describe('interop with the standardwebhooks reference library', () => {
  it('our signatures verify with the reference', async () => {
    const h = await signHeaders(secret, 'del_ref1', body);
    expect(() => new Webhook(secret).verify(body, h)).not.toThrow();
  });

  it('a receiver with either secret verifies a two-secret delivery with the reference', async () => {
    const next = generateSecret();
    const h = await signHeaders([next, secret], 'del_ref3', body);
    expect(() => new Webhook(next).verify(body, h)).not.toThrow();
    expect(() => new Webhook(secret).verify(body, h)).not.toThrow();
    expect(() => new Webhook(generateSecret()).verify(body, h)).toThrow();
  });

  it('reference signatures verify with ours', async () => {
    const ts = new Date();
    const signature = new Webhook(secret).sign('del_ref2', ts, body);
    const h = { 'webhook-id': 'del_ref2', 'webhook-timestamp': String(Math.floor(ts.getTime() / 1000)), 'webhook-signature': signature };
    await expect(verify(h, body, secret)).resolves.toBeTruthy();
  });
});
