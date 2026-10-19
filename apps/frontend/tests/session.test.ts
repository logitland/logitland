import type { Cookies } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { clearSession, isRemovalOnly, readPerson, readSession, sign, writePerson, writeSession } from '../src/lib/server/session';

const SECRET = 'a-test-secret-a-test-secret-a-test-secret';

function jar(): Cookies & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: (name: string) => store.get(name),
    set: (name: string, value: string) => void store.set(name, value),
    delete: (name: string) => void store.delete(name),
  } as unknown as Cookies & { store: Map<string, string> };
}

describe('who needs an owner account', () => {
  it('only the message-removal page does without one', () => {
    for (const next of ['/mirror/remove', '/mirror/remove?preview=left', '/mirror/remove/', '/mirror/remove#top']) expect(isRemovalOnly(next), next).toBe(true);
    for (const next of ['/agents', '/claim/ABCD-EFGH', '/mirror', '/mirror/removed', '/mirror/remove-all', '/admin/agents', ''])
      expect(isRemovalOnly(next), next).toBe(false);
  });
});

describe('the person session', () => {
  it('carries a Discord ID and name, and nothing that could pass for an owner', async () => {
    const cookies = jar();
    await writePerson(cookies, SECRET, { discord_user_id: '700000000000000001', username: 'pat' }, true);
    expect(await readPerson(cookies, SECRET)).toMatchObject({ kind: 'person', discord_user_id: '700000000000000001', username: 'pat' });
    // Copied into the owner session's cookie, it is not an owner session.
    const copy = jar();
    copy.set('ll_session', cookies.get('ll_person')!);
    expect(await readSession(copy, SECRET)).toBeNull();
  });

  it('is refused when it is expired, forged or signed for something else', async () => {
    const cookies = jar();
    cookies.set(
      'll_person',
      await sign(SECRET, 'person', { kind: 'person', discord_user_id: '700000000000000001', username: 'pat', exp: Math.floor(Date.now() / 1000) - 1 }),
    );
    expect(await readPerson(cookies, SECRET)).toBeNull();
    cookies.set('ll_person', await sign(SECRET, 'person', { discord_user_id: '700000000000000001', username: 'pat', exp: Math.floor(Date.now() / 1000) + 60 }));
    expect(await readPerson(cookies, SECRET)).toBeNull();
    await writePerson(cookies, SECRET, { discord_user_id: '700000000000000001', username: 'pat' }, true);
    expect(await readPerson(cookies, 'another-secret-another-secret-another-secret')).toBeNull();
  });

  it('is not an owner session, and an owner session is not a person session', async () => {
    const cookies = jar();
    await writeSession(cookies, SECRET, { owner_id: 'own_01JA0TESSELLATE0', discord_user_id: '700000000000000001', username: 'pat', is_admin: false }, true);
    expect(await readSession(cookies, SECRET)).toMatchObject({ owner_id: 'own_01JA0TESSELLATE0' });
    const copy = jar();
    copy.set('ll_person', cookies.get('ll_session')!);
    expect(await readPerson(copy, SECRET)).toBeNull();
  });

  it('only accepts a value signed for its own cookie, even with the same fields', async () => {
    const cookies = jar();
    const fields = {
      owner_id: 'own_01JA0TESSELLATE0',
      discord_user_id: '700000000000000001',
      username: 'pat',
      is_admin: true,
      exp: Math.floor(Date.now() / 1000) + 60,
    };
    cookies.set('ll_session', await sign(SECRET, 'oauth', fields));
    expect(await readSession(cookies, SECRET)).toBeNull();
    cookies.set('ll_session', await sign(SECRET, 'session', fields));
    expect(await readSession(cookies, SECRET)).toMatchObject({ owner_id: 'own_01JA0TESSELLATE0' });
  });

  it('ends together with the owner session', async () => {
    const cookies = jar();
    await writePerson(cookies, SECRET, { discord_user_id: '700000000000000001', username: 'pat' }, true);
    await writeSession(cookies, SECRET, { owner_id: 'own_01JA0TESSELLATE0', discord_user_id: '700000000000000001', username: 'pat', is_admin: false }, true);
    clearSession(cookies);
    expect(cookies.store.size).toBe(0);
  });
});
