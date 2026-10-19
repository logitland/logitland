import { LIMITS } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import type { Relay } from './context';
import { hmac } from './crypto';
import { authenticateKey } from './services/identity';
import { checkDescription, checkName, nameKey } from './services/names';
import { clientHashes, purgeRawIpsJob, recordOrigin, revealRawIps } from './services/origins';
import { signup } from './services/signup';
import { count, easyChallenges, getChallenge, solve } from './signup.helpers';
import { NO_CLIENT, type ClientInfo } from './types';
import { harness, seedAgent } from './testing';

const at = (ip: string | null, over: Partial<ClientInfo> = {}): ClientInfo => ({ ...NO_CLIENT, ip, ...over });

describe('name keys', () => {
  it('fold the lookalike digits and symbols named in the policy', () => {
    expect(nameKey('0134578')).toBe('oleastb');
    expect(nameKey('$@|')).toBe('sal');
  });

  it.each([
    ['Adm1n', 'admin'],
    ['Аdmin', 'Admin'],
    ['Αdmin', 'Admin'],
    ['a.d.m.i.n', 'ADMIN'],
    ['Ad_Min', 'admin'],
    ['L0g1tland', 'logitland'],
    ['$taff', 'staff'],
    ['@dmin', 'admin'],
    ['|ogitland', 'logitland'],
    ['ＡＤＭＩＮ', 'admin'],
    ['Admín', 'admin'],
    ['𝐀dmin', 'admin'],
    ["a b-c_d.e'f", 'abcdef'],
    ['Lоgan', 'Logan'],
  ])('make %j and %j one key', (a, b) => {
    expect(nameKey(a)).toBe(nameKey(b));
  });

  it.each([
    ['Alice', 'Alicia'],
    ['Bob', 'Rob'],
    ['Agent 7', 'Agent 8'],
    ['Ada', 'Adam'],
  ])('keep %j and %j apart', (a, b) => {
    expect(nameKey(a)).not.toBe(nameKey(b));
  });

  it('leave other scripts alone', () => {
    expect(nameKey('日本語ボット')).toBe('日本語ボット');
    expect(nameKey('Привет')).not.toBe(nameKey('Привет2'));
    expect(nameKey('สวัสดี')).toBe('สวัสดี');
  });
});

describe('name rules', () => {
  it.each(['Ada', 'Orrery Bot', "O'Neil", 'agent_007', 'Léa', 'Ünal', '日本語ボット', 'Привет', 'x1', 'Anywhere', 'Model T', 'Moderate', 'Hereford'])(
    'accept %j',
    (name) => {
      expect(checkName(name)).toEqual({ ok: true });
    },
  );

  it.each([
    ['', 'name_policy'],
    ['a', 'name_policy'],
    ['𝐀', 'name_policy'],
    ['a'.repeat(33), 'name_policy'],
    [' lead', 'name_policy'],
    ['trail ', 'name_policy'],
    ['bad!name', 'name_policy'],
    ['<b>bold</b>', 'name_policy'],
    ['tab\tname', 'name_policy'],
    ['nul\u0000l', 'name_policy'],
    ['zero\u200bwidth', 'name_policy'],
    ['joiner\u200dname', 'name_policy'],
    ['rtl\u202ename', 'name_policy'],
    ['isolate\u2066name', 'name_policy'],
    ['word\u2060joiner', 'name_policy'],
    ['bom\ufeffname', 'name_policy'],
    ['line\u2028break', 'name_policy'],
    ['no\u00a0break', 'name_policy'],
    ['em\u3000space', 'name_policy'],
    ['Emoji 🙂', 'name_policy'],
    ['z̸̡̛̪͎̩algo', 'name_policy'],
    ['-_-', 'name_policy'],
    ['...', 'name_policy'],
  ])('refuse %j as %s', (name, code) => {
    const r = checkName(name);
    expect(r).toMatchObject({ ok: false, code });
    expect((r as { reason: string }).reason.length).toBeGreaterThan(10);
  });

  it.each([
    'admin',
    'Administrator',
    'moderator',
    'Moderator Mia',
    'staff',
    'Staff Member',
    'official',
    'The Official Bot',
    'system',
    'System Bot',
    'discord',
    'Discord Helper',
    'clyde',
    'logitland',
    'Logitland Support',
    'everyone',
    'relay',
    'Relay Runner',
    'support',
    'owner',
    'Adm1n',
    'Аdmin',
    'a.d.m.i.n',
    '0fficial',
    'L0gitland',
    '5upport',
    'mod',
    'MOD',
    'm.o.d',
    'm-o-d',
    'Server Mod',
    'the_mod',
    'here',
    'Here Bot',
  ])('refuse %j as impersonation', (name) => {
    const r = checkName(name);
    expect(r).toMatchObject({ ok: false, code: 'impersonation' });
    expect((r as { reason: string }).reason).toMatch(/reserved/);
  });

  it('names the reserved word it matched', () => {
    expect(checkName('Logitland Support')).toMatchObject({ ok: false, reason: expect.stringContaining('logitland') });
  });

  it('accepts plain descriptions and refuses control and direction characters', () => {
    expect(checkDescription('Tracks planets.\nLikes tea.\tA lot. 👩\u200d💻')).toEqual({ ok: true });
    for (const bad of ['bell\u0007', 'nul\u0000', 'rtl\u202etext', 'isolate\u2067x', 'sep\u2028arator', 'c1\u0085control']) {
      expect(checkDescription(bad)).toMatchObject({ ok: false, code: 'control_chars' });
    }
  });
});

describe('origin hashes', () => {
  it('are HMACs of the address and of its network, under the hash key', async () => {
    const { relay } = harness();
    const h = await clientHashes(relay, at('203.0.113.7'));
    expect(h.ip).toBe(await hmac(relay.config.hashKey, 'ip:203.0.113.7'));
    expect(h.net).toBe(await hmac(relay.config.hashKey, 'net:203.0.113.0/24'));
    expect(h.ip).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(h)).not.toContain('203.0.113');
    const other = await clientHashes({ ...relay, config: { ...relay.config, hashKey: 'a-different-key-a-different-key-1234' } }, at('203.0.113.7'));
    expect(other.ip).not.toBe(h.ip);
    expect(other.net).not.toBe(h.net);
  });

  it('are stable, and share a network across the /24', async () => {
    const { relay } = harness();
    const a = await clientHashes(relay, at('203.0.113.7'));
    expect(await clientHashes(relay, at('203.0.113.7'))).toEqual(a);
    const sibling = await clientHashes(relay, at('203.0.113.200'));
    expect(sibling.net).toBe(a.net);
    expect(sibling.ip).not.toBe(a.ip);
    expect((await clientHashes(relay, at('203.0.114.7'))).net).not.toBe(a.net);
    expect((await clientHashes(relay, at('203.0.113.007'))).ip).not.toBe(null);
  });

  it('count an IPv6 /64 as one address and a /48 as one network, however the address is spelled', async () => {
    const { relay } = harness();
    const a = await clientHashes(relay, at('2001:db8:1:2::1'));
    expect(await clientHashes(relay, at('2001:0DB8:0001:0002:0000:0000:0000:0001'))).toEqual(a);
    expect(await clientHashes(relay, at('[2001:db8:1:2::1]'))).toEqual(a);
    expect(await clientHashes(relay, at('2001:db8:1:2:0:0:0:1%eth0'))).toEqual(a);
    expect(await clientHashes(relay, at('2001:db8:1:2:ffff:eeee:dddd:9'))).toEqual(a);
    const nextDoor = await clientHashes(relay, at('2001:db8:1:3::1'));
    expect(nextDoor.ip).not.toBe(a.ip);
    expect(nextDoor.net).toBe(a.net);
    expect((await clientHashes(relay, at('2001:db8:2:2::1'))).net).not.toBe(a.net);
    expect(a.ip).toBe(await hmac(relay.config.hashKey, 'ip:2001:0db8:0001:0002::/64'));
    expect(a.net).toBe(await hmac(relay.config.hashKey, 'net:2001:0db8:0001::/48'));
  });

  it('treat an IPv4 client reaching us over IPv6 as that IPv4 address', async () => {
    const { relay } = harness();
    const v4 = await clientHashes(relay, at('203.0.113.7'));
    expect(await clientHashes(relay, at('::ffff:203.0.113.7'))).toEqual(v4);
    expect(await clientHashes(relay, at('::ffff:cb00:7107'))).toEqual(v4);
  });

  it('read every IPv6 shorthand', async () => {
    const { relay } = harness();
    const same = async (a: string, b: string) => expect(await clientHashes(relay, at(a))).toEqual(await clientHashes(relay, at(b)));
    await same('::', '0:0:0:0:0:0:0:0');
    await same('::1', '0000:0000:0000:0000:0000:0000:0000:0001');
    await same('1::', '1:0:0:0:0:0:0:0');
    await same('1:2:3:4:5:6:7::', '1:2:3:4:5:6:7:0');
    await same('1:2:3:4:5:6:1.2.3.4', '1:2:3:4:5:6:102:304');
    await same('64:ff9b::1.2.3.4', '64:ff9b::102:304');
    expect(await clientHashes(relay, at('::1'))).toEqual(await clientHashes(relay, at('::2')));
  });

  it('do not throw on malformed addresses', async () => {
    const { relay } = harness();
    const seen = new Set<string>();
    for (const bad of ['1::2::3', '12345::1', ':::', '1:2:3:4:5:6:7:8:9', '1.2.3', '999.1.1.1', 'g::1', '']) {
      const h = await clientHashes(relay, at(bad));
      if (bad) seen.add(h.ip!);
      else expect(h).toEqual({ ip: null, net: null });
    }
    expect(seen.size).toBe(7);
  });

  it('are null without an address, and still stable for one nobody can parse', async () => {
    const { relay } = harness();
    expect(await clientHashes(relay, at(null))).toEqual({ ip: null, net: null });
    const odd = await clientHashes(relay, at('not-an-ip'));
    expect(odd.ip).toMatch(/^[0-9a-f]{64}$/);
    expect(await clientHashes(relay, at('NOT-AN-IP'))).toEqual(odd);
  });
});

describe('recording origins', () => {
  it('stores the hashes and network, and seals the raw address for the agent', async () => {
    const h = harness();
    const a = await seedAgent(h.relay);
    const b = await seedAgent(h.relay);
    await recordOrigin(h.relay, a.id, at('203.0.113.7', { asn: 64496, asOrganization: 'Example Net', country: 'NL' }), 'signup');
    const row = await h.db.prepare('SELECT * FROM agent_origins WHERE agent_id = ?').bind(a.id).first<Record<string, string | number | null>>();
    const hashes = await clientHashes(h.relay, at('203.0.113.7'));
    expect(row).toMatchObject({
      kind: 'signup',
      ip_hmac: hashes.ip,
      net_hmac: hashes.net,
      asn: 64496,
      as_org: 'Example Net',
      country: 'NL',
      seen_at: h.now().toISOString(),
    });
    expect(row!.ip_purge_after).toBe(new Date(h.now().getTime() + LIMITS.rawIpRetentionDays * 86_400_000).toISOString());
    const sealed = row!.ip_sealed as string;
    expect(sealed).not.toContain('203.0.113.7');
    expect(await h.relay.secrets.open(sealed, `agent_origins.ip:${a.id}`)).toBe('203.0.113.7');
    await expect(h.relay.secrets.open(sealed, `agent_origins.ip:${b.id}`)).rejects.toThrow();
    await expect(h.relay.secrets.open(sealed, 'channels.webhook:1')).rejects.toThrow();
  });

  it('keeps unknown network details as null, and skips a request with no address', async () => {
    const h = harness();
    const a = await seedAgent(h.relay);
    await recordOrigin(h.relay, a.id, at('203.0.113.7'), 'use');
    await recordOrigin(h.relay, a.id, at(null, { asn: 1 }), 'use');
    const { results } = await h.db.prepare('SELECT asn, as_org, country FROM agent_origins').all();
    expect(results).toEqual([{ asn: null, as_org: null, country: null }]);
  });

  it('opens only within the retention, newest first', async () => {
    const h = harness();
    const a = await seedAgent(h.relay);
    await recordOrigin(h.relay, a.id, at('203.0.113.7'), 'signup');
    h.advance(86_400_000);
    await recordOrigin(h.relay, a.id, at('198.51.100.1'), 'use');
    expect((await revealRawIps(h.relay, a.id)).map((o) => o.ip)).toEqual(['198.51.100.1', '203.0.113.7']);
    h.advance(29 * 86_400_000 + 1000);
    expect((await revealRawIps(h.relay, a.id)).map((o) => o.ip)).toEqual(['198.51.100.1']);
  });
});

describe('the purge job', () => {
  it('nulls sealed addresses past their time, keeps the hashes, and is quiet when there is nothing to do', async () => {
    const h = harness();
    const a = await seedAgent(h.relay);
    await recordOrigin(h.relay, a.id, at('203.0.113.7'), 'signup');
    h.advance(86_400_000);
    await recordOrigin(h.relay, a.id, at('198.51.100.1'), 'use');
    expect(await purgeRawIpsJob(h.relay)).toBe(0);

    h.advance(29 * 86_400_000 + 1000);
    expect(await purgeRawIpsJob(h.relay)).toBe(1);
    const { results } = await h.db
      .prepare('SELECT ip_sealed, ip_hmac, net_hmac FROM agent_origins ORDER BY id')
      .all<{ ip_sealed: string | null; ip_hmac: string; net_hmac: string }>();
    expect(results[0]!.ip_sealed).toBeNull();
    expect(results[0]!.ip_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(results[0]!.net_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(results[1]!.ip_sealed).not.toBeNull();
    expect(await purgeRawIpsJob(h.relay)).toBe(0);

    h.advance(86_400_000);
    expect(await purgeRawIpsJob(h.relay)).toBe(1);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agent_origins WHERE ip_sealed IS NOT NULL')).toBe(0);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agent_origins')).toBe(2);
  });

  it('also clears out challenges that expired long ago', async () => {
    const h = harness();
    const c = await getChallenge(h);
    h.advance((LIMITS.powTtlSeconds + 60) * 1000);
    await purgeRawIpsJob(h.relay);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM pow_challenges WHERE id = ?', c.challenge)).toBe(1);
    h.advance(3_600_000);
    await purgeRawIpsJob(h.relay);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM pow_challenges')).toBe(0);
  });
});

describe('authenticating a key', () => {
  /** The relay with every SQL statement recorded, so tests can see which writes a request made. */
  function spy(relay: Relay) {
    const sql: string[] = [];
    return { sql, relay: { ...relay, db: { prepare: (s: string) => (sql.push(s), relay.db.prepare(s)), batch: relay.db.batch.bind(relay.db) } } as Relay };
  }
  const writes = (sql: string[], what: string) => sql.filter((s) => s.startsWith('UPDATE api_keys SET last_used_at') && s.includes(what)).length;
  const lastUsed = async (h: ReturnType<typeof harness>, keyId: string) =>
    (await h.db.prepare('SELECT last_used_at FROM api_keys WHERE id = ?').bind(keyId).first<{ last_used_at: string | null }>())!.last_used_at;

  it('moves last_used_at at most every five minutes, and only writes when it will', async () => {
    const h = harness();
    const a = await seedAgent(h.relay);
    const { relay, sql } = spy(h.relay);
    expect(await lastUsed(h, a.keyId)).toBeNull();

    await authenticateKey(relay, a.key, NO_CLIENT);
    const first = h.now().toISOString();
    expect(await lastUsed(h, a.keyId)).toBe(first);
    expect(writes(sql, 'WHERE id')).toBe(1);

    h.advance(4 * 60_000 + 59_000);
    await authenticateKey(relay, a.key, NO_CLIENT);
    await authenticateKey(relay, a.key, NO_CLIENT);
    expect(await lastUsed(h, a.keyId)).toBe(first);
    expect(writes(sql, 'WHERE id')).toBe(1);

    h.advance(2000);
    await authenticateKey(relay, a.key, NO_CLIENT);
    expect(await lastUsed(h, a.keyId)).toBe(h.now().toISOString());
    expect(writes(sql, 'WHERE id')).toBe(2);
  });

  it('does not touch a key that is refused', async () => {
    const h = harness();
    const revoked = await seedAgent(h.relay);
    await h.db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ?').bind(h.now().toISOString(), revoked.keyId).run();
    const suspended = await seedAgent(h.relay, { status: 'suspended' });
    await expect(authenticateKey(h.relay, revoked.key, at('203.0.113.7'))).rejects.toMatchObject({ status: 401 });
    await expect(authenticateKey(h.relay, suspended.key, at('203.0.113.7'))).rejects.toMatchObject({ status: 403 });
    expect(await lastUsed(h, revoked.keyId)).toBeNull();
    expect(await lastUsed(h, suspended.keyId)).toBeNull();
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agent_origins')).toBe(0);
  });

  it('records where a key is used from at most once a day per agent and network', async () => {
    const h = harness();
    const a = await seedAgent(h.relay);
    const other = await seedAgent(h.relay);
    const origins = (agentId: string) => count(h, "SELECT COUNT(*) AS n FROM agent_origins WHERE agent_id = ? AND kind = 'use'", agentId);

    for (let i = 0; i < 3; i++) await authenticateKey(h.relay, a.key, at('203.0.113.7', { asn: 64496, asOrganization: 'Example Net', country: 'NL' }));
    expect(await origins(a.id)).toBe(1);
    expect(await h.db.prepare('SELECT asn, country FROM agent_origins WHERE agent_id = ?').bind(a.id).first()).toEqual({ asn: 64496, country: 'NL' });

    await authenticateKey(h.relay, a.key, at('203.0.113.99'));
    expect(await origins(a.id)).toBe(1);
    await authenticateKey(h.relay, a.key, at('198.51.100.4'));
    expect(await origins(a.id)).toBe(2);
    await authenticateKey(h.relay, other.key, at('203.0.113.7'));
    expect(await origins(other.id)).toBe(1);
    await authenticateKey(h.relay, a.key, NO_CLIENT);
    expect(await origins(a.id)).toBe(2);

    h.advance(22 * 3_600_000);
    await authenticateKey(h.relay, a.key, at('203.0.113.7'));
    expect(await origins(a.id)).toBe(3);
    const { results } = await h.db.prepare('SELECT ip_sealed FROM agent_origins WHERE agent_id = ?').bind(a.id).all<{ ip_sealed: string }>();
    expect(await h.relay.secrets.open(results[0]!.ip_sealed, `agent_origins.ip:${a.id}`)).toBe('203.0.113.7');
  });

  it('records the origin of requests that reach the API', async () => {
    const h = harness();
    const a = await seedAgent(h.relay);
    await h.call('GET', '/v1/me', undefined, h.as(a.key));
    await h.call('GET', '/v1/me', undefined, h.as(a.key));
    const { results } = await h.db.prepare('SELECT kind, ip_hmac FROM agent_origins WHERE agent_id = ?').bind(a.id).all<{ kind: string; ip_hmac: string }>();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: 'use', ip_hmac: (await clientHashes(h.relay, at('203.0.113.7'))).ip });
  });

  it('refuses a key that expires exactly now, accepts one a moment before', async () => {
    const h = harness();
    const a = await seedAgent(h.relay);
    const expiry = new Date(h.now().getTime() + 60_000).toISOString();
    await h.db.prepare('UPDATE api_keys SET expires_at = ? WHERE id = ?').bind(expiry, a.keyId).run();
    h.advance(59_999);
    await expect(authenticateKey(h.relay, a.key, NO_CLIENT)).resolves.toMatchObject({ keyId: a.keyId });
    h.advance(1);
    await expect(authenticateKey(h.relay, a.key, NO_CLIENT)).rejects.toMatchObject({ status: 401 });
  });

  it('never gives a key more scopes than its agent has', async () => {
    const h = harness();
    const a = await seedAgent(h.relay);
    await h.db.prepare('UPDATE agents SET scopes = ? WHERE id = ?').bind('["messages:read"]', a.id).run();
    expect((await authenticateKey(h.relay, a.key, NO_CLIENT)).scopes).toEqual(['messages:read']);
  });
});

describe('names taken at the same moment', () => {
  it('answer 409 to the loser, and leave no half-made agent', async () => {
    const h = harness();
    await easyChallenges(h);
    const c = await getChallenge(h);
    let done = false;
    const relay: Relay = {
      ...h.relay,
      db: {
        prepare: (sql) => h.db.prepare(sql),
        batch: async (stmts) => {
          if (!done) {
            done = true;
            await seedAgent(h.relay, { name: 'racer' });
          }
          return h.db.batch(stmts);
        },
      },
    };
    await expect(signup(relay, { name: 'Racer', challenge: c.challenge, nonce: solve(c.challenge, c.difficulty) }, at('203.0.113.7'))).rejects.toMatchObject({
      status: 409,
    });
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents')).toBe(1);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM api_keys')).toBe(1);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM claims')).toBe(0);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agent_origins')).toBe(0);
  });
});
