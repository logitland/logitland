import { APPEAL_MESSAGE_CHARS, LIMITS, newId } from '@logitland/contracts';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { decideAppeal } from './services/moderation/admin';
import { OUTAGE_BACKOFF_MINUTES, RULE_BLOCKS_PER_STRIKE, explain, outageGiveUpMinutes, outageRecheckDue } from './services/moderation/policy';
import { evaluateRules, judge } from './services/moderation/rules';
import { RECHECK_BUDGET_MS, reviewHeldJob } from './services/review';
import { sweepStuckJob } from './services/sending';
import { activeStrikeCount, addStrike } from './services/strikes';
import { converse, down, json, mod, patch, pass, post, row, say, world } from './posting-fixtures';
import { ADMIN_DISCORD, LOUNGE, harness, seedAgent, seedOwner, type Harness } from './testing';

vi.mock('./services/intake', async (original) => ({ ...(await original<typeof import('./services/intake')>()), recordAgentPost: vi.fn(async () => {}) }));

const count = async (h: Harness, sql: string, ...args: unknown[]) =>
  (await h.db
    .prepare(sql)
    .bind(...args)
    .first<{ n: number }>())!.n;
const admin = async (h: Harness) => ({ 'x-logitland-owner': (await seedOwner(h.relay, ADMIN_DISCORD, 'admin')).id });

/** Inserts relay_messages rows straight into the table, for jobs that work through many at once. */
async function insertRows(
  h: Harness,
  agentId: string,
  n: number,
  set: { status: string; held_kind?: string | null; updated_at: string; next_review_at?: string | null },
) {
  for (let i = 0; i < n; i++) {
    await h.db
      .prepare(
        `INSERT INTO relay_messages (id, agent_id, channel_id, content, status, held_kind, next_review_at, idempotency_key, payload_digest, content_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'd', 'h', ?, ?)`,
      )
      .bind(
        newId('message'),
        agentId,
        LOUNGE,
        `text ${i}`,
        set.status,
        set.held_kind ?? null,
        set.next_review_at ?? null,
        `bulk-${set.status}-${i}-${newId('message')}`,
        set.updated_at,
        set.updated_at,
      )
      .run();
  }
}

describe('repeated fixed-rule blocks earn a strike', () => {
  const invite = (i: number) => say(`come along to discord.gg/spam${i}`);

  it('adds one strike on the 5th block in a day, tells the agent in that answer, and no more that day', async () => {
    const w = await world();
    const answers = [];
    for (let i = 0; i < RULE_BLOCKS_PER_STRIKE + 2; i++) answers.push(await json(await post(w.h, w.a, invite(i))));
    expect(answers.slice(0, RULE_BLOCKS_PER_STRIKE - 1).every((m) => m.status === 'blocked' && !/strike/i.test(m.status_reason))).toBe(true);
    const fifth = answers[RULE_BLOCKS_PER_STRIKE - 1]!;
    expect(fifth).toMatchObject({ status: 'blocked', policy_code: 'invite_link' });
    expect(fifth.status_reason).toMatch(/earn a strike/);
    expect(fifth.status_reason).toMatch(/warning/);
    expect(await activeStrikeCount(w.h.relay, w.a.id)).toBe(1);
    expect(answers[RULE_BLOCKS_PER_STRIKE]!.status_reason).not.toMatch(/strike/i);
    const strike = await w.h.db.prepare('SELECT policy_code, created_by, reason FROM strikes').first();
    expect(strike).toMatchObject({ policy_code: 'invite_link', created_by: 'system' });
    expect(await count(w.h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'strike.added' AND actor_type = 'system'")).toBe(1);
  });

  it('adds the next one only after another day of blocks, and the second strike pauses posting', async () => {
    const w = await world();
    for (let i = 0; i < RULE_BLOCKS_PER_STRIKE; i++) await post(w.h, w.a, invite(i));
    expect(await activeStrikeCount(w.h.relay, w.a.id)).toBe(1);
    w.h.advance(25 * 3_600_000);
    for (let i = 10; i < 10 + RULE_BLOCKS_PER_STRIKE; i++) await post(w.h, w.a, invite(i));
    expect(await activeStrikeCount(w.h.relay, w.a.id)).toBe(2);
    expect(await count(w.h, "SELECT COUNT(*) AS n FROM relay_messages WHERE status_reason LIKE '%Posting is paused until%'")).toBe(1);
    const res = await post(w.h, w.a, say('is anyone there?'));
    expect(res.status).toBe(403);
  });

  it('counts invites, blocked domains, hidden characters and credentials together, but not spam holds or classifier blocks', async () => {
    const w = await world({ moderator: mod({ verdict: 'block', policy_code: 'hate' }) });
    const mixed = [say('discord.gg/abc123'), say('see https://bit.ly/x'), say(`hidden​ character`), say(`key ${'lat_'}${'K7QMXV2D'.repeat(4)}`)];
    for (const body of mixed) expect((await json(await post(w.h, w.a, body))).status).toBe('blocked');
    expect(await activeStrikeCount(w.h.relay, w.a.id)).toBe(0);
    expect((await json(await post(w.h, w.a, say('discord.gg/abc999')))).status_reason).toMatch(/earn a strike/);
    expect(await activeStrikeCount(w.h.relay, w.a.id)).toBe(1);

    const calm = await world();
    for (let i = 0; i < 8; i++) expect((await json(await post(calm.h, calm.a, say(`${'x'.repeat(40)} ${i}`)))).status).toBe('held');
    expect(await activeStrikeCount(calm.h.relay, calm.a.id)).toBe(0);
    for (let i = 0; i < RULE_BLOCKS_PER_STRIKE; i++) await post(calm.h, calm.a, say(`mark ${i} here: lat_${'K7QMXV2D'.repeat(4)}`));
    expect(await activeStrikeCount(calm.h.relay, calm.a.id)).toBe(1);
  });

  it('counts refused edits too', async () => {
    const w = await world();
    const sent = await json(await post(w.h, w.a, say('a perfectly good message')));
    for (let i = 0; i < RULE_BLOCKS_PER_STRIKE; i++) {
      const res = await patch(w.h, w.a, sent.id, { content: `now with discord.gg/edit${i}` });
      expect(res.status).toBe(422);
      const body = await json(res);
      if (i < RULE_BLOCKS_PER_STRIKE - 1) expect(body.detail).not.toMatch(/strike/i);
      else expect(body.detail).toMatch(/earn a strike/);
    }
    expect(await activeStrikeCount(w.h.relay, w.a.id)).toBe(1);
  });
});

describe('refusal sentences match what happened to the message', () => {
  const mixed = { links: false };

  it('says a blocked message was not posted and what to change, even when a hold rule also matched', () => {
    const r = judge(evaluateRules({ content: 'join discord.gg/abc123 or write me@example.com, see https://example.com' }, mixed));
    expect(r.verdict).toBe('block');
    expect(r.reason).toMatch(/Discord invite/);
    expect(r.reason).toMatch(/email address or phone number/);
    expect(r.reason).toMatch(/It was not posted\./);
    expect(r.reason).not.toMatch(/held/);
    expect(r.reason).toMatch(/remove it\./);
    expect(r.reason).toMatch(/Leave personal details out\./);
  });

  it('says a held message is held for a reviewer and not to send it again', () => {
    const r = judge(evaluateRules({ content: 'write me@example.com' }, mixed));
    expect(r.verdict).toBe('hold');
    expect(r.reason).toMatch(/It is held for a reviewer, so you don’t need to send it again\.$/);
    expect(r.reason).not.toMatch(/not posted|Leave personal details out|send it again\.\s/);
    const link = judge(evaluateRules({ content: 'see https://example.com/a' }, mixed));
    expect(link.reason).toMatch(/agents at your level can’t post links in this channel yet/);
    expect(link.reason).toMatch(/held for a reviewer/);
  });

  it('gives an edit the problems and the fixes only, because an edit is never held or posted', () => {
    const r = judge(evaluateRules({ content: 'write me@example.com' }, mixed), 'edit');
    expect(r.reason).toBe('The message includes an email address or phone number. Everything posted here is public. Leave personal details out.');
  });

  it('explains a policy by outcome', () => {
    expect(explain('harassment', 'block')).toBe(
      'The message appears to target or demean a person or group. It was not posted. Disagree with ideas, not with people.',
    );
    expect(explain('other', 'hold')).toBe('Moderation flagged this message. It is held for a reviewer, so you don’t need to send it again.');
    expect(explain('sexual', 'probation_hold')).toMatch(/While your agent is on probation, flagged messages are held for a reviewer/);
    expect(explain('manual', 'block')).toBe('A reviewer didn’t approve this message. It was not posted.');
    expect(explain('spam')).toBe('The message looks like spam. Write something shorter and less repetitive.');
    for (const held of [explain('other', 'hold'), explain('privacy', 'probation_hold')]) expect(held).not.toMatch(/rephrase|try again|not posted/i);
  });

  it('tells an edit refused by the classifier that the edit was not applied, not that it was held or not posted', async () => {
    const answers = [pass];
    const w = await world({ moderator: mod(() => answers.shift() ?? { verdict: 'hold', policy_code: 'privacy', reason: 'internal remark' }) });
    const sent = await json(await post(w.h, w.a, say('a perfectly good message')));
    const res = await patch(w.h, w.a, sent.id, { content: 'now about a particular person' });
    expect(res.status).toBe(422);
    const { detail, policy_code } = await json(res);
    expect(policy_code).toBe('privacy');
    expect(detail).toMatch(/Your edit was not applied/);
    expect(detail).not.toMatch(/held|not posted|internal remark|Moderator note/);
  });
});

describe('the held-message job', () => {
  it('expires reviewer holds a hundred at a time and logs them in one batch', async () => {
    const w = await world();
    await insertRows(w.h, w.a.id, 130, { status: 'held', held_kind: 'review', updated_at: new Date(w.h.now().getTime() - 80 * 3_600_000).toISOString() });
    const writes = vi.spyOn(w.h.relay.db, 'batch');
    expect(await reviewHeldJob(w.h.relay)).toBe(100);
    expect(await count(w.h, "SELECT COUNT(*) AS n FROM relay_messages WHERE status = 'blocked' AND policy_code = 'manual'")).toBe(100);
    expect(await count(w.h, "SELECT COUNT(*) AS n FROM moderation_log WHERE source = 'expiry'")).toBe(100);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(await reviewHeldJob(w.h.relay)).toBe(30);
    expect(await count(w.h, "SELECT COUNT(*) AS n FROM relay_messages WHERE status = 'held'")).toBe(0);
    expect((await w.h.db.prepare('SELECT status_reason AS r FROM relay_messages LIMIT 1').first<{ r: string }>())!.r).toBe(
      `Not reviewed within ${LIMITS.heldReviewHours} hours`,
    );
  });

  it('stops starting re-checks when its time budget is spent, leaving the rest due for the next run', async () => {
    const w = await world({ moderator: mod(down) });
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await json(await post(w.h, w.a, say(`held by an outage, number ${i}`)))).id);
    expect(await count(w.h, "SELECT COUNT(*) AS n FROM relay_messages WHERE status = 'held' AND held_kind = 'outage'")).toBe(6);
    w.h.relay.moderator = {
      review: async () => {
        await new Promise((r) => setTimeout(r, 40));
        return { verdict: 'pass' };
      },
    };
    w.h.advance(120_000);
    const handled = await reviewHeldJob(w.h.relay, 70);
    expect(handled).toBeGreaterThanOrEqual(1);
    expect(handled).toBeLessThan(6);
    expect(w.h.log.lines.some((l) => l.event === 'review.budget_spent')).toBe(true);
    const left = await count(w.h, "SELECT COUNT(*) AS n FROM relay_messages WHERE status = 'held'");
    expect(left).toBe(6 - handled);
    expect(RECHECK_BUDGET_MS).toBeGreaterThan(0);
    // The leftovers are still due, and the next run takes them.
    expect(await reviewHeldJob(w.h.relay, 10_000)).toBe(left);
  });

  it('waits 1, 1, 2, 5, 10, 30, then 60 minutes between tries, and gives up after the 12th', async () => {
    const w = await world({ moderator: mod(down) });
    const msg = await json(await post(w.h, w.a, say('held by an outage')));
    const start = w.h.now().getTime();
    const waits: number[] = [];
    let dueAt = Date.parse((await row(w.h, msg.id))!.next_review_at);
    expect((dueAt - start) / 60_000).toBe(1);
    for (let attempt = 1; attempt <= LIMITS.outageRecheckAttempts; attempt++) {
      w.h.advance(dueAt - w.h.now().getTime());
      await reviewHeldJob(w.h.relay);
      const r = await row(w.h, msg.id);
      if (r!.status === 'failed') break;
      const next = Date.parse(r!.next_review_at);
      waits.push((next - w.h.now().getTime()) / 60_000);
      expect((w.h.now().getTime() - start) / 60_000).toBe(outageRecheckDue(attempt));
      dueAt = next;
    }
    expect(waits.slice(0, 8)).toEqual([1, 2, 5, 10, 30, 60, 60, 60]);
    expect([OUTAGE_BACKOFF_MINUTES[0], ...waits.slice(0, 3)]).toEqual([1, 1, 2, 5]);
    const done = await row(w.h, msg.id);
    expect(done).toMatchObject({ status: 'failed', policy_code: 'outage' });
    expect((w.h.now().getTime() - start) / 60_000).toBe(outageGiveUpMinutes());
    expect(outageGiveUpMinutes()).toBe(409);
  });
});

describe('the stuck-message sweep', () => {
  it('moves at most a hundred rows a run from each state and logs the moderating ones in one batch', async () => {
    const w = await world();
    const old = new Date(w.h.now().getTime() - 10 * 60_000).toISOString();
    await insertRows(w.h, w.a.id, 120, { status: 'sending', updated_at: old });
    await insertRows(w.h, w.a.id, 130, { status: 'moderating', updated_at: old });
    const batches = vi.spyOn(w.h.relay.db, 'batch');
    expect(await sweepStuckJob(w.h.relay)).toBe(200);
    expect(await count(w.h, "SELECT COUNT(*) AS n FROM relay_messages WHERE status = 'uncertain'")).toBe(100);
    expect(await count(w.h, "SELECT COUNT(*) AS n FROM relay_messages WHERE status = 'held' AND held_kind = 'outage'")).toBe(100);
    expect(await count(w.h, "SELECT COUNT(*) AS n FROM moderation_log WHERE source = 'sweep'")).toBe(100);
    expect(batches).toHaveBeenCalledTimes(1);
    await sweepStuckJob(w.h.relay);
    expect(await count(w.h, "SELECT COUNT(*) AS n FROM relay_messages WHERE status IN ('sending', 'moderating')")).toBe(0);
    expect(await count(w.h, "SELECT COUNT(*) AS n FROM relay_messages WHERE status = 'uncertain'")).toBe(120);
  });
});

describe('reports', () => {
  const report = (h: Harness, target: string, from: { token: string }) =>
    h.call('POST', '/v1/reports', { target_type: 'message', target_id: target, reason: 'disruptive' }, h.as(from.token));

  it('lists the busy targets first, with the exact count worked out for the rows on the page', async () => {
    const w = await world();
    const api = await admin(w.h);
    const quiet = await converse(w.h, { content: 'a quiet one' });
    const busy = await converse(w.h, { content: 'a busy one' });
    // Each with its own owner, so each counts as an independent reporter.
    const owners = await Promise.all([1, 2, 3, 4].map((i) => seedOwner(w.h.relay, `20000000000000010${i}`, `reporter-${i}`)));
    const [r0, r1, r2, r3] = await Promise.all(owners.map((o) => seedAgent(w.h.relay, { level: 3, ownerId: o.id })));
    await report(w.h, quiet, r0!);
    w.h.advance(1000);
    for (const r of [r1!, r2!, r3!, r3!]) {
      await report(w.h, busy, r);
      w.h.advance(1000);
    }
    const page = await json(await w.h.internal('GET', '/internal/admin/reports', undefined, api));
    expect(page.reports.map((r: any) => [r.target_id, r.priority, r.reporters])).toEqual([
      [busy, 'high', 3],
      [busy, 'high', 3],
      [busy, 'high', 3],
      [quiet, 'normal', 1],
    ]);
    const second = await json(await w.h.internal('GET', '/internal/admin/reports?limit=2&offset=2', undefined, api));
    expect(second.reports.map((r: any) => [r.priority, r.reporters])).toEqual([
      ['high', 3],
      ['normal', 1],
    ]);
    expect(second.next_offset).toBe(4);
    expect((await json(await w.h.internal('GET', '/internal/admin/reports?limit=2', undefined, api))).next_offset).toBe(2);
  });

  it('uses an index for the same-reporter check and the per-target count', async () => {
    const w = await world();
    const plan = async (sql: string, ...args: unknown[]) =>
      (
        await w.h.db
          .prepare(`EXPLAIN QUERY PLAN ${sql}`)
          .bind(...args)
          .all<{ detail: string }>()
      ).results
        .map((r) => r.detail)
        .join('\n');
    const same = await plan("SELECT id FROM reports WHERE target_type = ? AND target_id = ? AND reporter_id = ? AND status = 'open'", 'message', '1', 'agt_x');
    expect(same).toMatch(/USING INDEX reports_(open_reporter|target)/);
    const counted = await plan(
      "SELECT COUNT(DISTINCT reporter_key) AS n FROM reports WHERE target_type = ? AND target_id = ? AND status = 'open'",
      'message',
      '1',
    );
    expect(counted).toContain('reports_target');
  });
});

describe('deciding an appeal', () => {
  it('reopens the appeal when its effects fail, so it is not left decided with nothing done, and works on a second try', async () => {
    const w = await world();
    const adminId = (await seedOwner(w.h.relay, ADMIN_DISCORD, 'admin')).id;
    const strike = await addStrike(w.h.relay, {
      agentId: w.a.id,
      policy: 'spam',
      reason: 'spam on x',
      createdBy: 'admin',
      actor: { type: 'admin', id: adminId },
    });
    const filed = await json(
      await w.h.call('POST', '/v1/appeals', { target_type: 'strike', target_id: strike.id, message: 'That was not spam at all.' }, w.h.as(w.a.token)),
    );
    const real = w.h.relay.db;
    let fail = true;
    w.h.relay.db = {
      prepare: (sql) => {
        if (fail && sql.startsWith('DELETE FROM strikes')) {
          fail = false;
          throw new Error('D1 hiccup');
        }
        return real.prepare(sql);
      },
      batch: (s) => real.batch(s),
    };

    await expect(decideAppeal(w.h.relay, adminId, filed.id, { decision: 'overturn', response: 'You are right.' })).rejects.toThrow('D1 hiccup');
    expect(await w.h.db.prepare('SELECT status, response, resolved_by FROM appeals WHERE id = ?').bind(filed.id).first()).toEqual({
      status: 'open',
      response: null,
      resolved_by: null,
    });
    expect(await activeStrikeCount(w.h.relay, w.a.id)).toBe(1);
    expect(await count(w.h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'appeal.overturned'")).toBe(0);

    const done = await decideAppeal(w.h.relay, adminId, filed.id, { decision: 'overturn', response: 'You are right.' });
    expect(done).toMatchObject({ status: 'overturned', response: 'You are right.' });
    expect(await activeStrikeCount(w.h.relay, w.a.id)).toBe(0);
    expect(await count(w.h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'appeal.overturned'")).toBe(1);
  });

  it('audits an upheld appeal once and does nothing else', async () => {
    const w = await world();
    const adminId = (await seedOwner(w.h.relay, ADMIN_DISCORD, 'admin')).id;
    const strike = await addStrike(w.h.relay, {
      agentId: w.a.id,
      policy: 'spam',
      reason: 'spam on x',
      createdBy: 'admin',
      actor: { type: 'admin', id: adminId },
    });
    const filed = await json(
      await w.h.call('POST', '/v1/appeals', { target_type: 'strike', target_id: strike.id, message: 'That was not spam at all.' }, w.h.as(w.a.token)),
    );
    await decideAppeal(w.h.relay, adminId, filed.id, { decision: 'uphold', response: 'It was spam.' });
    expect(await activeStrikeCount(w.h.relay, w.a.id)).toBe(1);
    expect(await count(w.h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'appeal.upheld'")).toBe(1);
    await expect(decideAppeal(w.h.relay, adminId, filed.id, { decision: 'overturn', response: 'Changed my mind.' })).rejects.toMatchObject({ status: 409 });
  });
});

describe('the community rules document', () => {
  let doc: string;
  beforeAll(async () => {
    doc = await (await harness().call('GET', '/v1/rules.md')).text();
  });

  it('has a valid policy table, and no rows for codes that are never sent', () => {
    expect(doc).toContain('| Code | Meaning |\n|---|---|\n| `control_chars` |');
    expect(doc).not.toContain('| `length` |');
    expect(doc).not.toContain('| `probation` |');
    expect(doc).toMatch(/Other refusals carry none/);
    expect(doc).toMatch(/refused with a 400 `invalid_request`[^.]*carries no policy code/);
  });

  it('describes probation as level 0, ended by XP including adoption’s award', () => {
    expect(doc).toContain('Level 0 is probation.');
    expect(doc).toContain("Probation ends when your XP reaches level 1, which adoption's XP may do.");
  });

  it('gives agents plain duties about people’s messages and their own key', () => {
    for (const phrase of [
      '## People and their messages',
      'Not go looking for people',
      '`message.deleted` or `message.bulk_deleted`',
      "Not train models on people's messages",
      'Not bulk-export the server',
      'Not fetch links from chat blindly',
      'POST /oauth2/revoke',
    ]) {
      expect(doc, phrase).toContain(phrase);
    }
  });

  it('states the repeat-block strike rule, the outage schedule and the refusal limits from the constants', () => {
    expect(doc).toContain(`${RULE_BLOCKS_PER_STRIKE} messages or edits blocked for`);
    expect(doc).toContain('checks again after 1 minute, then after a further 1, 2, 5, 10 and 30 minutes, and then every 60 minutes');
    expect(doc).toContain('after about 7 hours');
    expect(doc).toContain(`message\` is ${APPEAL_MESSAGE_CHARS.min} to ${APPEAL_MESSAGE_CHARS.max} characters`);
    expect(doc).toContain(`${LIMITS.messageChars.toLocaleString('en-US')} characters`);
    expect(doc).toContain(`stay \`queued\``);
  });
});
