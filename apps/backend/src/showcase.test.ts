import type { ShowcaseFrame } from '@logitland/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { Bindings } from './index';
import { ShowcaseLive } from './showcase';

// The feed's fan-out runs here with a fake Durable Object state. How hibernating WebSockets behave on workerd is covered by
// the workerd suite.

vi.stubGlobal('WebSocketRequestResponsePair', class {});

const LOUNGE = '110000000000000001';

function feed() {
  const kv = new Map<string, unknown>();
  const sent: unknown[] = [];
  const socket = { readyState: WebSocket.OPEN, send: (frame: string) => void sent.push(JSON.parse(frame)) };
  const ctx = {
    setWebSocketAutoResponse: () => {},
    getWebSockets: () => [socket],
    storage: {
      kv: { get: (k: string) => kv.get(k), put: (k: string, v: unknown) => void kv.set(k, v), delete: (k: string) => kv.delete(k), list: () => kv.entries() },
    },
  };
  return { live: new ShowcaseLive(ctx as unknown as DurableObjectState, {} as Bindings), sent };
}

const message = (id: string) => ({
  message_id: id,
  channel_id: LOUNGE,
  thread_id: null,
  author: { kind: 'human' as const, agent_id: null, author_id: 'p_luna', display_name: 'Luna', avatar_url: null, username: 'luna' },
  content: 'words that may be deleted',
  created_at: '2026-10-22T00:00:00.000Z',
  edited_at: null,
  deleted: false,
  removed_by: null,
});

describe('the live feed', () => {
  it('never sends a message after its deletion, even from a publication that read it before', async () => {
    const { live, sent } = feed();
    const deleted: ShowcaseFrame = { type: 'message.deleted', channel_id: LOUNGE, message_ids: ['1'] };
    const later: ShowcaseFrame = { type: 'message.created', at: 0, message: message('2') };
    await live.publish([deleted]);
    await live.publish([{ type: 'message.created', at: 0, message: message('1') }, { type: 'message.updated', message: message('1') }, later]);
    expect(sent).toEqual([deleted, later]);
  });

  it('never sends a post with its deleted starter’s words again, but does once it shows the starter deleted, or was only unlisted', async () => {
    const { live, sent } = feed();
    const post = (id: string, deleted = false): ShowcaseFrame => ({
      type: 'post.updated',
      post: {
        id,
        channel_id: LOUNGE,
        name: 'A post',
        created_at: '2026-10-22T00:00:00.000Z',
        last_message_at: '2026-10-22T00:00:00.000Z',
        message_count: 1,
        archived: false,
        locked: false,
        starter_message_id: id,
        starter: { ...message(id), ...(deleted ? { content: null, deleted: true } : {}) },
        applied_tags: [],
        name_hidden: false,
      },
    });
    const removed: ShowcaseFrame = { type: 'post.removed', channel_id: LOUNGE, post_id: '1' };
    const starterDeleted: ShowcaseFrame = { type: 'message.deleted', channel_id: LOUNGE, message_ids: ['2'] };
    await live.publish([removed, starterDeleted]);
    await live.publish([post('1'), post('2'), post('2', true), post('3')]);
    expect(sent).toEqual([removed, starterDeleted, post('1'), post('2', true), post('3')]);
  });
});
