import { describe, expect, it } from 'vitest';
import { all, moreChannels, one, push, world } from './intake-fixtures';
import { BENCH, FORUM, LOUNGE } from './testing';

const rename = (channel_id: string, name: string, type: 'text' | 'announcement' | 'forum' | 'media', tags?: unknown[]) => ({
  kind: 'channel_update' as const,
  channel_id,
  name,
  type,
  ...(tags ? { tags } : {}),
});
const channel = (h: Awaited<ReturnType<typeof world>>['h'], id: string) =>
  one<Record<string, any>>(h, 'SELECT name, type, agent_access, updated_at FROM channels WHERE id = ?', id);
const audit = (h: Awaited<ReturnType<typeof world>>['h']) =>
  all<Record<string, any>>(
    h,
    "SELECT actor_type, actor_id, action, target_type, target_id, reason, diff FROM audit_log WHERE action = 'channel.synced' ORDER BY created_at",
  );

describe('a relayed channel that changes in Discord', () => {
  it('has its name and type refreshed, with an audit entry saying what changed', async () => {
    const { h } = await world();
    h.advance(60_000);
    await push(h, rename(LOUNGE, 'common-room', 'announcement'));
    expect(await channel(h, LOUNGE)).toMatchObject({ name: 'common-room', type: 'announcement', agent_access: 'post', updated_at: h.now().toISOString() });
    const [entry] = await audit(h);
    expect(entry).toMatchObject({ actor_type: 'system', actor_id: 'gateway', target_type: 'channel', target_id: LOUNGE });
    expect(JSON.parse(entry!.diff)).toEqual({ name: { from: 'lounge', to: 'common-room' }, type: { from: 'text', to: 'announcement' } });
  });

  it('is left alone when nothing differs', async () => {
    const { h } = await world();
    const before = await channel(h, LOUNGE);
    h.advance(60_000);
    await push(h, rename(LOUNGE, 'lounge', 'text'), rename(LOUNGE, 'lounge', 'text'));
    expect(await channel(h, LOUNGE)).toEqual(before);
    expect(await audit(h)).toHaveLength(0);
  });

  it('follows a run of changes in one batch', async () => {
    const { h } = await world();
    await push(h, rename(LOUNGE, 'one', 'text'), rename(LOUNGE, 'two', 'text'), rename(LOUNGE, 'two', 'text'));
    expect((await channel(h, LOUNGE))!.name).toBe('two');
    expect(await audit(h)).toHaveLength(2);
  });

  it('is ignored when agents can’t use it', async () => {
    const { h } = await world();
    await push(h, rename(BENCH, 'renamed', 'forum'));
    expect(await channel(h, BENCH)).toMatchObject({ name: 'bench', type: 'text' });
    expect(await audit(h)).toHaveLength(0);
  });

  it('stops taking new-thread posts when it stops being a forum', async () => {
    const { h } = await world();
    await moreChannels(h);
    await push(h, rename(FORUM, 'forum', 'text'));
    expect(await channel(h, FORUM)).toMatchObject({ type: 'text', agent_access: 'post' });
    // The other way round changes nothing about what agents may do.
    await push(h, rename(LOUNGE, 'lounge', 'forum'));
    expect(await channel(h, LOUNGE)).toMatchObject({ type: 'forum', agent_access: 'post' });
    // A forum that stays a forum keeps its access.
    await push(h, rename('110000000000000004', 'gallery', 'media'), rename('110000000000000004', 'gallery 2', 'media'));
    expect(await channel(h, '110000000000000004')).toMatchObject({ name: 'gallery 2', type: 'media', agent_access: 'read_only' });
  });

  it('rejects types and names the relay can’t use', async () => {
    const { h } = await world();
    const r = await push(
      h,
      { kind: 'channel_update', channel_id: LOUNGE, name: 'x', type: 'voice' },
      { kind: 'channel_update', channel_id: LOUNGE, name: '', type: 'text' },
    );
    expect(r.invalid).toBe(2);
  });
});

describe('forum tags', () => {
  const tags = [
    { id: '140000000000000001', name: 'Bug', moderated: true },
    { id: '140000000000000002', name: 'Idea', moderated: false },
  ];

  it('are written the way the admin console saves them, and only when they changed', async () => {
    const { h } = await world();
    await moreChannels(h);
    h.advance(60_000);
    await push(h, rename(FORUM, 'forum', 'forum', tags));
    expect(JSON.parse((await one<{ tags: string }>(h, 'SELECT tags FROM channels WHERE id = ?', FORUM))!.tags)).toEqual(tags);
    const stamp = (await channel(h, FORUM))!.updated_at;
    expect(stamp).toBe(h.now().toISOString());

    h.advance(60_000);
    await push(h, rename(FORUM, 'forum', 'forum', tags));
    expect((await channel(h, FORUM))!.updated_at).toBe(stamp);

    await push(h, rename(FORUM, 'forum', 'forum', [tags[0]]));
    expect(JSON.parse((await one<{ tags: string }>(h, 'SELECT tags FROM channels WHERE id = ?', FORUM))!.tags)).toEqual([tags[0]]);
    // A channel without tags in the event keeps the tags it has.
    await push(h, rename(FORUM, 'forum', 'forum'));
    expect(JSON.parse((await one<{ tags: string }>(h, 'SELECT tags FROM channels WHERE id = ?', FORUM))!.tags)).toEqual([tags[0]]);
    // Tags are metadata, not a policy change: no audit entry.
    expect(await audit(h)).toHaveLength(0);
  });

  it('are cleared when the channel stops being a forum', async () => {
    const { h } = await world();
    await moreChannels(h);
    await push(h, rename(FORUM, 'forum', 'forum', tags));
    await push(h, rename(FORUM, 'forum', 'text'));
    expect(JSON.parse((await one<{ tags: string }>(h, 'SELECT tags FROM channels WHERE id = ?', FORUM))!.tags)).toEqual([]);
    // A text channel that never had tags is not rewritten for it.
    const stamp = (await channel(h, LOUNGE))!.updated_at;
    h.advance(60_000);
    await push(h, rename(LOUNGE, 'lounge', 'text'));
    expect((await channel(h, LOUNGE))!.updated_at).toBe(stamp);
  });

  it('can be cleared by Discord removing them all', async () => {
    const { h } = await world();
    await moreChannels(h);
    await push(h, rename(FORUM, 'forum', 'forum', tags), rename(FORUM, 'forum', 'forum', []));
    expect(JSON.parse((await one<{ tags: string }>(h, 'SELECT tags FROM channels WHERE id = ?', FORUM))!.tags)).toEqual([]);
  });
});
