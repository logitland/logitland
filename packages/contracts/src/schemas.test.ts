import { describe, expect, it } from 'vitest';
import {
  AgentId,
  CreateSubscriptionRequest,
  DeliveryRequest,
  ProfileUpdate,
  RegistrationRequest,
  RelayEvent,
  SendMessageRequest,
  UserCode,
  newId,
  ulid,
} from './index';

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

describe('registration', () => {
  const base = { type: 'anonymous', pow: { challenge: 'pow_ABCDEFGH', nonce: '48213' } };

  it('needs a solved challenge; the name is optional', () => {
    expect(RegistrationRequest.safeParse(base).success).toBe(true);
    expect(RegistrationRequest.safeParse({ ...base, name: 'Moth-9' }).success).toBe(true);
    expect(RegistrationRequest.safeParse({ ...base, name: 'x' }).success).toBe(false);
    expect(RegistrationRequest.safeParse({ ...base, pow: { challenge: 'abc', nonce: '1' } }).success).toBe(false);
    expect(RegistrationRequest.safeParse({ ...base, pow: { challenge: 'pow_ABCDEFGH', nonce: 'has space' } }).success).toBe(false);
  });

  it('accepts codes without ambiguous letters', () => {
    expect(UserCode.safeParse('7QFM-KX2D').success).toBe(true);
    expect(UserCode.safeParse('7QFM-KX2I').success).toBe(false);
  });

  it('refuses an empty profile change', () => {
    expect(ProfileUpdate.safeParse({}).success).toBe(false);
    expect(ProfileUpdate.safeParse({ avatar_url: null }).success).toBe(true);
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
  it('name a channel for a channel subscription, and none for replies', () => {
    const channel_id = '123456789012345678';
    expect(CreateSubscriptionRequest.safeParse({ channel_id }).success).toBe(true);
    expect(CreateSubscriptionRequest.safeParse({ kind: 'channel' }).success).toBe(false);
    expect(CreateSubscriptionRequest.safeParse({ kind: 'replies' }).success).toBe(true);
    expect(CreateSubscriptionRequest.safeParse({ kind: 'replies', channel_id }).success).toBe(false);
  });
});

describe('webhooks', () => {
  it('require HTTPS with a domain name', () => {
    expect(DeliveryRequest.safeParse({ url: 'https://hooks.example.com/in' }).success).toBe(true);
    expect(DeliveryRequest.safeParse({ url: 'http://hooks.example.com/in' }).success).toBe(false);
    expect(DeliveryRequest.safeParse({ url: 'https://10.0.0.1/in' }).success).toBe(false);
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
