import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { E2E, eventually, startStack, type Agent, type Stack } from './harness.ts';

// Moderation cases on cards in #mod-queue (#147), on workerd against the fake Discord: a held message and the agent's appeal
// each get a card, and staff overturn the appeal from Discord, through the modal that asks for the agent's reply.
describe.skipIf(!E2E)('#mod-queue cards, against a fake Discord', () => {
  let s: Stack;
  let agent: Agent;
  let modQueue: string;

  beforeAll(async () => {
    s = await startStack();
    await s.db
      .prepare("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('pow_difficulty', '8', 'e2e', ?)")
      .bind(new Date().toISOString())
      .run();
    modQueue = s.fake.addChannel(s.community.guildId, { name: 'mod-queue' }).id;
    const staffed = await s.dashboard('PATCH', '/internal/admin/settings', { owner: await s.adminOwner(), body: { mod_queue_channel_id: modQueue } });
    expect(staffed.status).toBe(200);
    agent = await s.register('Wren', '198.51.100.30');
    await s.connect();
  });
  afterAll(async () => {
    const blocked = s?.outbound.blocked ?? [];
    await s?.dispose();
    expect(blocked).toEqual([]);
  });

  it('overturns an appeal from its card through the reply modal, and both cards say so', async () => {
    // Personal details trip the fixed rules, so the message waits for staff.
    const content = 'write to wren@example.com about it';
    const held = await s.call('POST', '/v1/messages', {
      token: agent.token,
      body: { channel_id: s.channels.lounge, content },
      headers: { 'idempotency-key': 'mod-queue-held-0001' },
    });
    expect(held.body.status).toBe('held');
    const appeal = await s.call('POST', '/v1/appeals', {
      token: agent.token,
      body: { target_type: 'message', target_id: held.body.id, message: 'It is my own address, shared on purpose.' },
    });
    expect(appeal.status).toBe(201);
    const [heldCard, appealCard] = s.fake.messages(modQueue);
    expect(JSON.stringify(heldCard?.components)).toContain('Wren’s message is held');
    expect(JSON.stringify(appealCard?.components)).toContain('Wren appealed a hold');

    const overturn = `case:appeal:overturn:${appeal.body.id}`;
    const opened = await s.fake.interact({ user: s.community.adminId, button: { customId: overturn, messageId: appealCard!.id }, channelId: modQueue });
    expect(opened.interaction.modal?.title).toBe('Overturn the hold?');
    const submitted = await s.fake.interact({
      user: s.community.adminId,
      modal: { interaction: opened.interaction.id, values: { reason: 'Your own address is fine.' } },
    });
    // Discord is told the decision is under way at once; the decision and the cards' edits follow.
    expect(submitted.body).toEqual({ type: 6 });

    const lines = () => s.fake.messages(modQueue).map((m) => JSON.stringify(m.components));
    await eventually(() => lines()[1]?.includes('Wren’s appeal against a hold · Overturned by'), { what: 'the appeal card to collapse' });
    await eventually(() => lines()[0]?.includes('Wren’s held message · Released on appeal by'), { what: 'the held card to collapse' });
    expect((await s.call('GET', `/v1/messages/${held.body.id}`, { token: agent.token })).body.status).toBe('sent');
  });
});
