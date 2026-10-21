import { describe, expect, it } from 'vitest';
import { AgentId, CreateSubscriptionRequest, ProfileUpdate, RelayEvent, SendMessageRequest, SignupRequest, UserCode, newId, ulid } from './index';

describe('ids', () => {
  it('generates valid, time-ordered ULIDs', () => {
    const a = ulid(1_700_000_000_000);
    const b = ulid(1_700_000_000_001);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a.slice(0, 10) < b.slice(0, 10)).toBe(true);
  });

  it('prefixes IDs by kind and validates them', () => {
    const id = newId('agent');
    expect(id.startsWith('agt_')).toBe(true);
    expect(AgentId.safeParse(id).success).toBe(true);
    expect(AgentId.safeParse('agt_01JB7Q2M8R').success).toBe(true);
    expect(AgentId.safeParse('key_01JB7Q2M8R').success).toBe(false);
    expect(AgentId.safeParse('agt_01JB7Q2M8L').success).toBe(false);
  });
});

describe('signup', () => {
  const base = { name: 'Moth-9', challenge: 'pow_ABCDEFGH', nonce: '48213' };

  it('needs a name, a challenge and a nonce, and nothing about Discord', () => {
    expect(SignupRequest.safeParse(base).success).toBe(true);
    expect(SignupRequest.safeParse({ ...base, name: 'x' }).success).toBe(false);
    expect(SignupRequest.safeParse({ ...base, challenge: 'abc' }).success).toBe(false);
    expect(SignupRequest.safeParse({ ...base, nonce: 'has space' }).success).toBe(false);
  });

  it('keeps owner hints short', () => {
    expect(SignupRequest.safeParse({ ...base, owner_hint: '@moth on Discord' }).success).toBe(true);
    expect(SignupRequest.safeParse({ ...base, owner_hint: 'x'.repeat(121) }).success).toBe(false);
  });

  it('accepts codes without ambiguous letters', () => {
    expect(UserCode.safeParse('7QFM-KX2D').success).toBe(true);
    expect(UserCode.safeParse('7QFM-KX2I').success).toBe(false);
  });

  it('refuses an empty profile change', () => {
    expect(ProfileUpdate.safeParse({}).success).toBe(false);
    expect(ProfileUpdate.safeParse({ description: null }).success).toBe(true);
  });
});

describe('messages', () => {
  it('refuses thread_id together with thread_name', () => {
    const r = SendMessageRequest.safeParse({ channel_id: '123456789012345678', content: 'hi', thread_id: '123456789012345679', thread_name: 'x' });
    expect(r.success).toBe(false);
  });

  it('caps content at Discord’s 2,000 characters', () => {
    expect(SendMessageRequest.safeParse({ channel_id: '123456789012345678', content: 'a'.repeat(2001) }).success).toBe(false);
  });
});

describe('subscriptions', () => {
  it('requires HTTPS with a domain name', () => {
    const base = { events: ['message.created'], channel_ids: ['123456789012345678'] };
    expect(CreateSubscriptionRequest.safeParse({ ...base, url: 'https://hooks.example.com/in' }).success).toBe(true);
    expect(CreateSubscriptionRequest.safeParse({ ...base, url: 'http://hooks.example.com/in' }).success).toBe(false);
    expect(CreateSubscriptionRequest.safeParse({ ...base, url: 'https://10.0.0.1/in' }).success).toBe(false);
  });

  it('caps channels per subscription', () => {
    const channel_ids = Array.from({ length: 21 }, (_, i) => String(123456789012345600n + BigInt(i)));
    expect(CreateSubscriptionRequest.safeParse({ events: ['message.created'], channel_ids, url: 'https://hooks.example.com/in' }).success).toBe(false);
  });
});

describe('events', () => {
  it('discriminates by type', () => {
    const e = RelayEvent.parse({
      id: 'evt_01JD5T8QWE',
      schema_version: 1,
      type: 'message.deleted',
      observed_at: '2026-10-19T03:14:00Z',
      cursor: '884213',
      guild_id: '123456789012345678',
      channel_id: '123456789012345679',
      data: { message_id: '123456789012345680', removed_by: 'author' },
    });
    expect(e.type).toBe('message.deleted');
  });
});
