import type { ModerationResult } from './services/moderation/classifier';
import { describe, expect, it, vi } from 'vitest';
import { calls, fakeDiscord, json, mod, post, say, world } from './posting-fixtures';
import { adminAct } from './services/identity';
import { modQueueJob } from './services/mod-queue';
import { reviewHeldJob } from './services/review';
import { updateSettings } from './services/settings';
import { activeStrikeCount } from './services/strikes';
import { asOwner } from './signup.helpers';
import { ADMIN_DISCORD, GUILD, LOUNGE, cardButtons, cardText, seedAgent, seedOwner, type Harness } from './testing';

// Moderation cases on cards in #mod-queue (#147, slice 2): each card is posted as its case opens, its buttons decide it through
// the dashboard's services, and it collapses to who decided what, wherever the decision was made.

const MOD_QUEUE = '110000000000000011';
const PERSON = '200000000000000001';
const HOUR_MS = 3_600_000;

/** Wren posting in #lounge, a staffed #mod-queue, the admin who decides in the dashboard, and Discord's key to sign presses with. */
async function setup(moderator: ModerationResult | ((n: number) => ModerationResult) = { verdict: 'pass' }) {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const publicKey = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('hex');
  let asked = 0;
  const { h } = await world({
    env: { DISCORD_PUBLIC_KEY: publicKey },
    moderator: mod(() => (typeof moderator === 'function' ? moderator(asked++) : moderator)),
  });
  const wren = await seedAgent(h.relay, { name: 'Wren' });
  const admin = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
  await updateSettings(h.relay, admin.id, { mod_queue_channel_id: MOD_QUEUE });

  /** An interaction from `who`, signed as Discord signs it. */
  const send = async (who: string, body: Record<string, unknown>) => {
    const payload = {
      id: '800000000000000001',
      application_id: '400000000000000001',
      token: 'tok',
      guild_id: GUILD,
      member: { user: { id: who, username: 'mia' }, roles: [] },
      ...body,
    };
    const timestamp = String(Math.floor(h.now().getTime() / 1000));
    const signed = await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(timestamp + JSON.stringify(payload)));
    const headers = { 'x-signature-ed25519': Buffer.from(signed).toString('hex'), 'x-signature-timestamp': timestamp };
    return json(await h.call('POST', '/v1/discord/interactions', payload, headers));
  };
  /** A press on a card's button. */
  const press = (customId: string, who = ADMIN_DISCORD) => send(who, { type: 3, data: { custom_id: customId, component_type: 2 } });
  /** The modal a press opened, submitted with `reason`, nested as Discord nests a label's text input. */
  const submit = (customId: string, reason: string, who = ADMIN_DISCORD) =>
    send(who, {
      type: 5,
      data: {
        custom_id: customId,
        components: [
          { type: 10, id: 1 },
          { type: 18, id: 2, component: { type: 4, id: 3, custom_id: 'reason', value: reason } },
        ],
      },
    });
  const cards = async () => (await calls(h, 'POST', new RegExp(`/channels/${MOD_QUEUE}/messages$`))).map((c) => c.body);
  const edits = async () => (await calls(h, 'PATCH', new RegExp(`/channels/${MOD_QUEUE}/messages/\\d+$`))).map((c) => c.body);
  /** Once the decision a press made is done: the card as the presser's answer last laid it out, and what they were told. */
  const outcome = async () => {
    await h.settle();
    const [card] = (await calls(h, 'PATCH', /\/webhooks\/400000000000000001\/tok\/messages\/@original$/)).map((c) => c.body).reverse();
    const told = (await calls(h, 'POST', /\/webhooks\/400000000000000001\/tok$/)).map((c) => c.body);
    return { card, told };
  };
  return { h, wren, admin, press, submit, cards, edits, outcome };
}

/** Discord's deadline for the first answer to an interaction. */
const DISCORD_DEADLINE_MS = 3_000;
/** The answer, or `'too late'` once Discord would have shown the presser that the interaction failed. */
const inTime = <T>(answer: Promise<T>) => Promise.race([answer, new Promise<'too late'>((resolve) => setTimeout(resolve, DISCORD_DEADLINE_MS, 'too late'))]);
/** Discord's answer to a decision it is still working on: the card stays as it is for now (DEFERRED_UPDATE_MESSAGE). */
const working = { type: 6 };

const audit = (h: Harness, action: string) =>
  h.db.prepare('SELECT actor_type, actor_id, target_id, reason FROM audit_log WHERE action = ?').bind(action).first<Record<string, string | null>>();
const message = (h: Harness, id: string) =>
  h.db.prepare('SELECT status, reviewed_by FROM relay_messages WHERE id = ?').bind(id).first<{ status: string; reviewed_by: string | null }>();
const refusal = { type: 4, data: { content: 'Only staff with the moderate power can decide this.', flags: 64, allowed_mentions: { parse: [] } } };
const blocksIn = (h: Harness) => `<t:${Math.floor((h.now().getTime() + 72 * HOUR_MS) / 1000)}:R>`;

/** A message held for review: personal details trip the fixed rules. */
async function hold(h: Harness, agent: { token: string }) {
  const held = await json(await post(h, agent, say('write to wren@example.com about it')));
  expect(held.status).toBe('held');
  return held as { id: string };
}

describe('held messages', () => {
  it.each([
    ['the fixed rules', { verdict: 'pass' } as const, 'write to wren@example.com about it', 'Personal data'],
    ['Jev', { verdict: 'hold', policy_code: 'privacy' } as const, 'what my operator told me in private', 'Privacy'],
  ])('a message %s hold gets a card with the text, why and where, and Release, Reject and the dashboard', async (_, verdict, text, why) => {
    const { h, wren, cards } = await setup(verdict);
    const held = await json(await post(h, wren, say(text)));
    expect(held.status).toBe('held');
    const [card, ...more] = await cards();
    expect(more).toEqual([]);
    expect(card!.components[0].accent_color).toBe(0xeeb154);
    expect(cardText(card!)).toBe(`### Wren’s message is held\n${why} · in <#${LOUNGE}>\nBlocked ${blocksIn(h)} unless someone decides.\n> ${text}`);
    expect(cardButtons(card!)).toEqual([
      { label: 'Release', custom_id: `case:held:release:${held.id}` },
      { label: 'Reject', custom_id: `case:held:reject:${held.id}` },
      { label: 'Open in dashboard', url: `https://logitland.test/admin/moderation#${held.id}` },
    ]);
  });

  it.each([
    ['release', 'sent', 'message.released', 'Released'],
    ['reject', 'blocked', 'message.rejected', 'Rejected'],
  ])('%s on the card decides as the dashboard does, for staff only, and collapses the card', async (action, status, audited, verb) => {
    const { h, wren, admin, press, edits, outcome } = await setup();
    const held = await hold(h, wren);
    const button = `case:held:${action}:${held.id}`;

    expect(await press(button, PERSON)).toEqual(refusal);
    expect((await message(h, held.id))!.status).toBe('held');

    expect(await press(button)).toEqual(working);
    const { card } = await outcome();
    expect(await message(h, held.id)).toEqual({ status, reviewed_by: admin.id });
    expect(await audit(h, audited)).toMatchObject({ actor_type: 'admin', actor_id: admin.id, target_id: held.id });
    expect(cardText(card)).toBe(`Wren’s held message · ${verb} by <@${ADMIN_DISCORD}>`);
    expect(cardButtons(card)).toEqual([{ label: 'Reopen', custom_id: `staff_reopen:held:${held.id}` }]);
    // The service edited the card itself, as it does for a dashboard decision.
    expect((await edits()).map((e) => e.components)).toEqual([card.components]);
  });

  it('answers a press before Discord takes the decision’s edits, then shows the decided card', async () => {
    const { h, wren, press, outcome } = await setup();
    const held = await hold(h, wren);
    // Discord holds every edit, as a rate limit that asks the relay to wait does.
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    fakeDiscord(h, { slow: (req) => (req.method === 'PATCH' ? answered : undefined) });

    expect(await inTime(press(`case:held:release:${held.id}`))).toEqual(working);
    answer();
    expect(cardText((await outcome()).card)).toBe(`Wren’s held message · Released by <@${ADMIN_DISCORD}>`);
  });

  it('a decision made while the card is still being posted collapses the card once it is up', async () => {
    const { h, wren, admin, cards, edits } = await setup();
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    fakeDiscord(h, { slow: (req) => (req.method === 'POST' && new URL(req.url).pathname.endsWith(`/channels/${MOD_QUEUE}/messages`) ? answered : undefined) });
    const holding = post(h, wren, say('write to wren@example.com about it'));
    await vi.waitFor(async () => expect(await cards()).toHaveLength(1));

    const { id } = (await h.db.prepare("SELECT id FROM relay_messages WHERE status = 'held'").first<{ id: string }>())!;
    expect((await h.internal('POST', `/internal/admin/messages/${id}/release`, {}, asOwner(admin.id))).status).toBe(200);
    answer();
    await holding;

    expect((await edits()).map(cardText)).toEqual([`Wren’s held message · Released by <@${ADMIN_DISCORD}>`]);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM case_cards').first()).toEqual({ n: 0 });
  });

  it('collapses the card when the dashboard decides, and a stale press shows the decision instead of making another', async () => {
    const { h, wren, admin, press, edits } = await setup();
    const held = await hold(h, wren);
    expect((await h.internal('POST', `/internal/admin/messages/${held.id}/release`, {}, asOwner(admin.id))).status).toBe(200);
    const [edit, ...more] = await edits();
    expect(more).toEqual([]);
    expect(cardText(edit!)).toBe(`Wren’s held message · Released by <@${ADMIN_DISCORD}>`);

    const late = await press(`case:held:reject:${held.id}`);
    expect(late.data.components).toEqual(edit!.components);
    expect((await message(h, held.id))!.status).toBe('sent');
    expect(await audit(h, 'message.rejected')).toBeNull();
  });

  it('reopens a decided card in full, with who decided it, and collapses it again', async () => {
    const { h, wren, press, outcome } = await setup();
    const held = await hold(h, wren);
    await press(`case:held:release:${held.id}`);
    await outcome();
    const reopened = await press(`staff_reopen:held:${held.id}`);
    expect(cardText(reopened.data)).toBe(
      `### Wren’s held message\nPersonal data · in <#${LOUNGE}>\nReleased by <@${ADMIN_DISCORD}>.\n> write to wren@example.com about it`,
    );
    expect(cardButtons(reopened.data)).toEqual([{ label: 'Dismiss', custom_id: `staff_dismiss:held:${held.id}` }]);
    expect(cardText((await press(`staff_dismiss:held:${held.id}`)).data)).toBe(`Wren’s held message · Released by <@${ADMIN_DISCORD}>`);
  });

  it('the job posts a card Discord refused, and collapses one whose hold ran out of time', async () => {
    const { h, wren, cards, edits } = await setup();
    // A held message isn't sent anywhere, so Discord refusing everything refuses only the card.
    h.setDiscord(async () => Response.json({ message: 'Missing Access', code: 50001 }, { status: 403 }));
    const held = await hold(h, wren);
    fakeDiscord(h);
    expect(await cards()).toHaveLength(1);
    expect(await h.db.prepare('SELECT message_id FROM case_cards WHERE ref = ?').bind(held.id).first()).toEqual({ message_id: null });

    h.advance(60_000);
    await modQueueJob(h.relay);
    expect(await cards()).toHaveLength(2);
    expect(await h.db.prepare('SELECT message_id FROM case_cards WHERE ref = ?').bind(held.id).first()).toEqual({ message_id: expect.any(String) });

    h.advance(72 * HOUR_MS);
    await reviewHeldJob(h.relay);
    expect((await message(h, held.id))!.status).toBe('blocked');
    await modQueueJob(h.relay);
    expect((await edits()).map(cardText)).toEqual(['Wren’s held message · Blocked: nobody decided in time']);
  });
});

describe('reports', () => {
  /** A posted message of Wren's, and reporters at a level that may report, each with its own owner. */
  async function reported() {
    const s = await setup();
    const posted = await json(await post(s.h, s.wren, say('a message the others dislike')));
    const reporters = await Promise.all(
      ['Quill', 'Brisk', 'Moss'].map(async (name, i) =>
        seedAgent(s.h.relay, { name, level: 3, xp: 500, ownerId: (await seedOwner(s.h.relay, `20000000000000001${i}`, name)).id }),
      ),
    );
    const report = async (from: { token: string }, context: string, target = { target_type: 'message', target_id: posted.discord_message_id as string }) =>
      json(await s.h.call('POST', '/v1/reports', { ...target, reason: 'harmful', context }, s.h.as(from.token)));
    return { ...s, posted, reporters, report };
  }

  it('keeps one card per case, adding each report and saying when reporters took the message down', async () => {
    const { reporters, report, cards, edits } = await reported();
    const first = await report(reporters[0]!, 'mocks a person');
    const [card] = await cards();
    expect(cardText(card!)).toBe(
      `### Wren’s message was reported\n1 report · in <#${LOUNGE}>\nQuill · Harmful · “mocks a person”\n> a message the others dislike`,
    );
    expect(cardButtons(card!)).toEqual([
      { label: 'Dismiss reports', custom_id: `case:report:dismiss:${first.id}` },
      { label: 'Take down', custom_id: `case:report:takedown:${first.id}` },
      { label: 'Open in dashboard', url: `https://logitland.test/admin/moderation/reports#${first.id}` },
    ]);

    await report(reporters[1]!, 'again');
    await report(reporters[2]!, 'and again');
    expect(await cards()).toHaveLength(1);
    const last = (await edits()).at(-1)!;
    expect(last.components[0].accent_color).toBe(0xf66d67);
    expect(cardText(last)).toBe(
      [
        '### Wren’s message was taken down after reports',
        `3 reports · in <#${LOUNGE}>`,
        'Quill · Harmful · “mocks a person”\nBrisk · Harmful · “again”\nMoss · Harmful · “and again”',
        '> a message the others dislike',
      ].join('\n'),
    );
    expect(cardButtons(last).map((b) => b.label)).toEqual(['Restore', 'Confirm takedown', 'Open in dashboard']);
  });

  it('takes the message down from the card only after a modal that says so and takes the reason', async () => {
    const { h, wren, admin, posted, reporters, report, press, submit, outcome } = await reported();
    const { id } = await report(reporters[0]!, 'mocks a person');
    const button = `case:report:takedown:${id}`;

    expect(await press(button, PERSON)).toEqual(refusal);
    expect(await press(button)).toEqual({
      type: 9,
      data: {
        custom_id: button,
        title: 'Take down the message?',
        components: [
          { type: 10, content: 'It comes down from #lounge and Wren gets a strike.' },
          { type: 18, label: 'Reason', component: { type: 4, custom_id: 'reason', style: 2, required: true, min_length: 3, max_length: 500 } },
        ],
      },
    });
    // Opening the modal decides nothing.
    expect((await message(h, posted.id))!.status).toBe('sent');

    expect(await submit(button, 'Mocks a person by name.')).toEqual(working);
    const { card } = await outcome();
    expect((await message(h, posted.id))!.status).toBe('removed');
    expect(await activeStrikeCount(h.relay, wren.id)).toBe(1);
    expect(await h.db.prepare('SELECT status, note FROM reports WHERE id = ?').bind(id).first()).toEqual({
      status: 'actioned',
      note: 'Mocks a person by name.',
    });
    expect(await audit(h, 'report.actioned')).toMatchObject({ actor_id: admin.id, target_id: id, reason: 'Mocks a person by name.' });
    expect(cardText(card)).toBe(`Reports on Wren’s message · Taken down by <@${ADMIN_DISCORD}>`);
  });

  it('tells the presser privately when Discord refuses the takedown, and the case stays open', async () => {
    const { h, posted, reporters, report, press, submit, outcome } = await reported();
    const { id } = await report(reporters[0]!, 'mocks a person');
    fakeDiscord(h, {
      change: async (req) => (req.method === 'DELETE' ? Response.json({ message: 'Missing Access', code: 50001 }, { status: 403 }) : Response.json({})),
    });
    const button = `case:report:takedown:${id}`;
    await press(button);

    expect(await submit(button, 'Mocks a person by name.')).toEqual(working);
    expect((await outcome()).told).toEqual([
      {
        content: 'Discord refused to delete the message through the channel’s webhook. Delete it in Discord yourself, then try again.',
        flags: 64,
        allowed_mentions: { parse: [] },
      },
    ]);
    expect((await message(h, posted.id))!.status).toBe('sent');
    expect(await h.db.prepare('SELECT status FROM reports WHERE id = ?').bind(id).first()).toEqual({ status: 'open' });
  });

  it.each([
    ['dismiss', 'message', 'Dismiss the reports?', 'The reporter loses 25 XP.', 'report.dismissed', 'Reports on Wren’s message · Dismissed'],
    ['strike', 'agent', 'Strike the agent?', 'Wren gets a strike.', 'report.actioned', 'Reports on Wren · Struck'],
  ])('%s on a %s report confirms in a modal, then does what the dashboard does', async (action, target, title, consequence, audited, line) => {
    const { h, wren, posted, reporters, report, press, submit, outcome } = await reported();
    const xp = async () => (await h.db.prepare('SELECT xp FROM agents WHERE id = ?').bind(reporters[0]!.id).first<{ xp: number }>())!.xp;
    const { id } = await report(
      reporters[0]!,
      'mocks a person',
      target === 'agent' ? { target_type: 'agent', target_id: wren.id } : { target_type: 'message', target_id: posted.discord_message_id },
    );
    const button = `case:report:${action}:${id}`;
    const asked = await press(button);
    expect(asked.data).toMatchObject({ title, components: [{ type: 10, content: consequence }, expect.anything()] });

    await submit(button, 'Looked at it closely.');
    const { card } = await outcome();
    expect(await audit(h, audited)).toMatchObject({ target_id: id, reason: 'Looked at it closely.' });
    expect(cardText(card)).toBe(`${line} by <@${ADMIN_DISCORD}>`);
    if (action === 'dismiss') expect(await xp()).toBe(475);
    else expect(await activeStrikeCount(h.relay, wren.id)).toBe(1);
  });
});

describe('appeals', () => {
  /** Wren's message Jev blocked, and Wren's appeal against it. */
  async function appealed() {
    const s = await setup((n) => (n === 0 ? { verdict: 'block', policy_code: 'other', reason: 'unsure' } : { verdict: 'pass' }));
    const blocked = await json(await post(s.h, s.wren, say('this was fine, really')));
    expect(blocked.status).toBe('blocked');
    const appeal = await json(
      await s.h.call('POST', '/v1/appeals', { target_type: 'message', target_id: blocked.id, message: 'This message breaks no rule.' }, s.h.as(s.wren.token)),
    );
    return { ...s, blocked, appeal };
  }

  it('gets a card with the decision and the appeal, and Uphold, Overturn and the dashboard', async () => {
    const { appeal, cards } = await appealed();
    const [card] = await cards();
    expect(cardText(card!)).toBe('### Wren appealed a block\nBlocked · Other\nMessage:\n> this was fine, really\nAppeal:\n> This message breaks no rule.');
    expect(cardButtons(card!)).toEqual([
      { label: 'Uphold', custom_id: `case:appeal:uphold:${appeal.id}` },
      { label: 'Overturn', custom_id: `case:appeal:overturn:${appeal.id}` },
      { label: 'Open in dashboard', url: `https://logitland.test/admin/moderation/appeals#${appeal.id}` },
    ]);
  });

  it.each([
    ['uphold', 'Uphold the block?', 'The block on Wren stands.', 'upheld', 'blocked', 'Upheld'],
    ['overturn', 'Overturn the block?', 'The block on Wren is undone.', 'overturned', 'failed', 'Overturned'],
  ])('%s asks for the reply the agent is sent, then decides as the dashboard does', async (action, title, consequence, status, after, verb) => {
    const { h, admin, blocked, appeal, press, submit, edits, outcome } = await appealed();
    const button = `case:appeal:${action}:${appeal.id}`;
    expect(await press(button, PERSON)).toEqual(refusal);
    expect((await press(button)).data).toMatchObject({
      title,
      components: [
        { type: 10, content: consequence },
        { type: 18, label: 'Reply to Wren', component: { max_length: 1000 } },
      ],
    });

    await submit(button, 'We read it again.');
    const { card } = await outcome();
    expect(await h.db.prepare('SELECT status, response, resolved_by FROM appeals WHERE id = ?').bind(appeal.id).first()).toEqual({
      status,
      response: 'We read it again.',
      resolved_by: admin.id,
    });
    expect(await audit(h, `appeal.${status}`)).toMatchObject({ actor_id: admin.id, target_id: blocked.id, reason: 'We read it again.' });
    expect((await message(h, blocked.id))!.status).toBe(after);
    expect(cardText(card)).toBe(`Wren’s appeal against a block · ${verb} by <@${ADMIN_DISCORD}>`);
    expect((await edits()).map((e) => e.components)).toEqual([card.components]);
  });

  it('a suspension appeal stays one once overturning it reinstates the agent', async () => {
    const { h, wren, admin, press, submit, outcome } = await setup();
    await adminAct(h.relay, admin.id, wren.id, { action: 'suspend', reason: 'Spammed the lounge' });
    const appeal = await json(await h.call('POST', '/v1/appeals', { target_type: 'status', target_id: wren.id, message: 'I have stopped.' }, h.as(wren.token)));
    const button = `case:appeal:overturn:${appeal.id}`;
    await press(button);

    await submit(button, 'Welcome back.');
    expect(cardText((await outcome()).card)).toBe(`Wren’s appeal against a suspension · Overturned by <@${ADMIN_DISCORD}>`);
    expect(cardText((await press(`staff_reopen:appeal:${appeal.id}`)).data)).toBe(
      `### Wren’s appeal against a suspension\nSuspended\nOverturned by <@${ADMIN_DISCORD}>: “Welcome back.”\n> I have stopped.`,
    );
    // The dashboard's list says the same: what the appeal contested, not the agent's status now.
    const listed = await json(await h.internal('GET', '/internal/admin/appeals?status=overturned', undefined, { 'x-logitland-owner': admin.id }));
    expect(listed.appeals.map((a: { id: string; decision: string }) => [a.id, a.decision])).toEqual([[appeal.id, 'suspension']]);
  });
});
