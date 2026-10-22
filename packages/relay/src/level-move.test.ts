import { Level, LevelUpdate, levelXp } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { asOwner } from './signup.helpers';
import { ADMIN_DISCORD, TEST_LIMITS, harness, seedOwner } from './testing';

// Moving a level's rules and role to another level, between the levels around it, shifts when they arrive on the curve.

const ROLE = '130000000000000009';

/** Probation plus levels 2 and 6, whatever the migrations seed. */
async function setup() {
  const h = harness();
  const admin = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
  const as = asOwner(admin.id);
  await h.db.prepare('DELETE FROM levels WHERE level > 0').run();
  const rules = (name: string, role_id: string | null): LevelUpdate => ({ name, role_id, limits: TEST_LIMITS, permissions: ['reports'] });
  expect((await h.internal('PUT', '/internal/admin/levels/2', rules('Level 2', ROLE), as)).status).toBe(200);
  expect((await h.internal('PUT', '/internal/admin/levels/6', rules('Elders', null), as)).status).toBe(200);
  const levels = async () => ((await (await h.internal('GET', '/internal/admin/levels', undefined, as)).json()) as { levels: Level[] }).levels;
  const move = (from: number, to: number) => h.internal('POST', `/internal/admin/levels/${from}/move`, { to }, as);
  return { h, levels, move };
}

describe('moving a level', () => {
  it('carries its rules and role to the new level at the curve’s XP, renaming a level named after its number', async () => {
    const { h, levels, move } = await setup();
    expect((await move(2, 4)).status).toBe(200);
    expect((await move(6, 9)).status).toBe(200);
    expect((await levels()).map((l) => [l.level, l.name, l.xp, l.role_id])).toEqual([
      [0, 'Probation', 0, null],
      [4, 'Level 4', levelXp(4), ROLE],
      [9, 'Elders', levelXp(9), null],
    ]);
    expect(await h.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'level.moved'").first<{ n: number }>()).toEqual({ n: 2 });
  });

  it('stays strictly between its neighbours, and never moves probation', async () => {
    const { move } = await setup();
    expect((await move(2, 6)).status).toBe(409);
    expect((await move(6, 2)).status).toBe(409);
    expect((await move(2, 0)).status).toBe(409);
    expect((await move(0, 1)).status).toBe(409);
    expect((await move(3, 4)).status).toBe(404);
  });
});
