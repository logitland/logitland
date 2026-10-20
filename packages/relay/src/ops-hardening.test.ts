import { describe, expect, it } from 'vitest';
import { ConfigError, checkConfig, type RelayBindings } from './config';
import { SecretBox } from './crypto';
import { createRelay } from './index';
import { resealJob } from './services/reseal';
import { LOUNGE, MIGRATIONS, harness, seedChannel, seedOwner } from './testing';
import { SqliteD1 } from './testing/sqlite-d1';

const prod = (over: Partial<RelayBindings> = {}): RelayBindings => ({
  DB: new SqliteD1().migrate(MIGRATIONS),
  RELAY_SECRET_KEY: SecretBox.generateKey(),
  INTERNAL_TOKEN: 'x'.repeat(10) + 'Qv8sL2pZr7Tn4Wc1Yb6Hd9Kf3Mg5Jx0Ea',
  IP_HASH_KEY: 'h'.repeat(40),
  PUBLIC_URL: 'https://relay.logitland.org',
  DASHBOARD_URL: 'https://logitland.org',
  ADMIN_DISCORD_IDS: '200000000000000099',
  DISCORD_BOT_TOKEN: 't',
  DISCORD_APPLICATION_ID: '1',
  DISCORD_PUBLIC_KEY: 'k',
  DISCORD_GUILD_ID: '1',
  JEV_LAYA_URL: 'https://jev.example.net',
  JEV_LAYA_TOKEN: 'j',
  DELIVERIES: { send: async () => {} } as never,
  ...over,
});

const refused = (env: RelayBindings) => {
  try {
    createRelay(env);
  } catch (e) {
    return e;
  }
  return null;
};

describe('encryption key settings', () => {
  it('accept a proper key and an old key under its own ID', () => {
    expect(checkConfig(prod())).toEqual([]);
    expect(checkConfig(prod({ RELAY_SECRET_KEY_ID: 'k2', RELAY_SECRET_KEYS_OLD: `k1:${SecretBox.generateKey()}` }))).toEqual([]);
  });

  it('turn a key that is not base64 of 32 bytes into a ConfigError, not a crash', () => {
    const env = prod({ RELAY_SECRET_KEY: 'ab'.repeat(32) });
    expect(checkConfig(env).join(' ')).toContain('RELAY_SECRET_KEY must be 32 random bytes');
    expect(refused(env)).toBeInstanceOf(ConfigError);
    expect(refused(prod({ RELAY_SECRET_KEY: 'not base64!' }))).toBeInstanceOf(ConfigError);
  });

  it('turn an old-key entry without an ID into a ConfigError', () => {
    const env = prod({ RELAY_SECRET_KEYS_OLD: SecretBox.generateKey() });
    expect(checkConfig(env).join(' ')).toContain('RELAY_SECRET_KEYS_OLD must be id:base64 pairs');
    expect(refused(env)).toBeInstanceOf(ConfigError);
  });

  it('refuse an old key listed under the current key’s ID, which would replace the current key', async () => {
    const env = prod({ RELAY_SECRET_KEYS_OLD: `k1:${SecretBox.generateKey()}` });
    expect(checkConfig(env).join(' ')).toContain('new key needs a new RELAY_SECRET_KEY_ID');
    expect(refused(env)).toBeInstanceOf(ConfigError);
    const dup = `a:${SecretBox.generateKey()},a:${SecretBox.generateKey()}`;
    expect(checkConfig(prod({ RELAY_SECRET_KEYS_OLD: dup })).join(' ')).toContain('twice');
    expect(() => new SecretBox({ id: 'k1', key: SecretBox.generateKey() }, [{ id: 'k1', key: SecretBox.generateKey() }])).toThrow('used twice');
  });

  it('rotate: values sealed before open afterwards and the re-seal moves them onto the new key', async () => {
    const oldKey = SecretBox.generateKey();
    const before = createRelay(prod({ RELAY_SECRET_KEY: oldKey }));
    const sealed = await before.secrets.seal('https://discord.com/api/webhooks/1/secret', 'channels.webhook:1');
    const during = createRelay(prod({ RELAY_SECRET_KEY: SecretBox.generateKey(), RELAY_SECRET_KEY_ID: 'k2', RELAY_SECRET_KEYS_OLD: `k1:${oldKey}` }));
    expect(during.secrets.isStale(sealed)).toBe(true);
    expect(await during.secrets.open(sealed, 'channels.webhook:1')).toContain('discord.com');
    expect((await during.secrets.seal('x', 'a')).startsWith('v2.k2.')).toBe(true);
  });

  it('log which key the re-seal walked onto', async () => {
    const h = harness();
    await seedChannel(h.relay, { id: LOUNGE });
    await resealJob(h.relay);
    expect(h.log.lines.find((l) => l.event === 'reseal.walked')?.fields).toMatchObject({ key_id: 'k1', unreadable: 0 });
  });
});

describe('the classifier address', () => {
  const problem = (url: string) => checkConfig(prod({ JEV_LAYA_URL: url })).filter((p) => p.includes('JEV_LAYA_URL'));

  it('must be https on a public host', () => {
    expect(problem('https://jev.example.net')).toEqual([]);
    expect(problem('http://jev.example.net')).toHaveLength(1);
    expect(problem('https://localhost:8080')).toHaveLength(1);
    expect(problem('https://jev.invalid')).toHaveLength(1);
    expect(problem('not a url')).toHaveLength(1);
  });
});

describe('request logs', () => {
  it('name the route, never the claim code or person in the address', async () => {
    const h = harness();
    const owner = await seedOwner(h.relay);
    const real = h.relay.db;
    h.relay.db = {
      batch: (s) => real.batch(s),
      prepare: (text) => {
        if (/claims/.test(text)) throw new Error('boom');
        return real.prepare(text);
      },
    };
    const res = await h.internal('GET', `/internal/owners/${owner.id}/claims/PHG1-YXSE`, undefined, { 'x-logitland-owner': owner.id });
    h.relay.db = real;
    expect(res.status).toBe(500);
    const line = h.log.lines.find((l) => l.event === 'request.failed')!;
    expect(line.fields).toMatchObject({ method: 'GET', route: '/internal/owners/:ownerId/claims/:code' });
    expect(JSON.stringify(line)).not.toContain('PHG1-YXSE');
    expect(JSON.stringify(line)).not.toContain(owner.id);
  });
});

describe('the test database', () => {
  it('refuses what D1 refuses: more than 100 bound parameters and BigInt values', () => {
    const h = harness();
    expect(() => h.db.prepare('SELECT 1').bind(...Array(101).fill(1))).toThrow('100');
    expect(() => h.db.prepare('SELECT 1').bind(...Array(100).fill(1))).not.toThrow();
    expect(() => h.db.prepare('SELECT ?').bind(5n)).toThrow('BigInt');
  });
});
