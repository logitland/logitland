// Files on messages: the signed CDN addresses Discord gives, their expiry and refresh, and their removal with the message.

import { DiscordRest } from '@logitland/discord';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CDN_URL_TTL_MS, type DiscordFake } from '../src/index.ts';
import { fixture, type Fixture } from './helpers.ts';

let f: Fixture;
let fake: DiscordFake;
let clock = Date.parse('2026-10-19T03:00:00Z');

beforeAll(async () => {
  f = await fixture({ now: () => clock });
  fake = f.fake;
});
afterAll(() => fake.close());

const download = async (url: string) => {
  const res = await fetch(url);
  return { status: res.status, type: res.headers.get('content-type'), text: await res.text() };
};

describe('files on messages', () => {
  it('are served at a signed CDN address until it expires, then at the address Discord refreshes it to', async () => {
    const m = fake.say(f.text.id, { as: f.alice, content: 'look', files: [{ filename: 'notes.txt', contentType: 'text/plain', data: 'hello file' }] });
    const [file] = m.attachments;
    expect(file).toMatchObject({ filename: 'notes.txt', size: 10, content_type: 'text/plain' });
    expect(await download(file!.url)).toEqual({ status: 200, type: 'text/plain', text: 'hello file' });
    expect((await download(file!.url.replace(/hm=\w+/, 'hm=forged'))).status).toBe(404);

    clock += CDN_URL_TTL_MS;
    expect((await download(file!.url)).status).toBe(404);
    const [fresh] = await new DiscordRest({ botToken: fake.botToken, base: fake.apiBase }).refreshAttachmentUrls([file!.url]);
    expect(fresh!.original).toBe(file!.url);
    expect(await download(fresh!.refreshed)).toMatchObject({ status: 200, text: 'hello file' });
  });

  it('go when their message is deleted, or an edit drops them', async () => {
    const m = fake.say(f.text.id, {
      as: f.alice,
      content: 'two files',
      files: [
        { filename: 'a.txt', data: 'a' },
        { filename: 'b.txt', data: 'b' },
      ],
    });
    const [a, b] = m.attachments;
    const edited = fake.edit(f.text.id, m.id, 'one file', [b!.id]);
    expect(edited.attachments.map((x) => x.id)).toEqual([b!.id]);
    expect((await download(a!.url)).status).toBe(404);
    expect((await download(b!.url)).status).toBe(200);

    fake.remove(f.text.id, m.id);
    expect((await download(b!.url)).status).toBe(404);
  });

  it('can be attached over the control API', async () => {
    const res = await fetch(`${fake.controlUrl}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channel: f.text.id,
        as: f.alice.id,
        content: 'a picture',
        files: [{ filename: 'dot.png', content_type: 'image/png', base64: Buffer.from('PNG!').toString('base64'), width: 1, height: 1 }],
      }),
    });
    const m = (await res.json()) as { attachments: { url: string; width: number }[] };
    expect(m.attachments[0]).toMatchObject({ width: 1 });
    expect(await download(m.attachments[0]!.url)).toMatchObject({ status: 200, type: 'image/png', text: 'PNG!' });
  });
});
