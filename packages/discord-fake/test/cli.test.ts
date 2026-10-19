// The fake as its own process, the way scripts/dev-full.mjs runs it.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

describe('node src/cli.ts', () => {
  it('starts seeded, answers on the printed address, and stops on SIGTERM', async () => {
    const child = spawn('node', [CLI, '--port', '0', '--seed', 'dev', '--endpoint', 'http://localhost:8787/discord/interactions'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    try {
      const info = await new Promise<{
        ready: boolean;
        url: string;
        api_base: string;
        bot_token: string;
        public_key: string;
        community: { channels: { key: string; webhook: { url: string } }[] };
      }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no ready line')), 10_000);
        child.stdout.on('data', (d: Buffer) => {
          const line = d
            .toString()
            .split('\n')
            .find((l) => l.startsWith('{"ready"'));
          if (line) {
            clearTimeout(timer);
            resolve(JSON.parse(line));
          }
        });
        child.stderr.on('data', (d: Buffer) => reject(new Error(d.toString())));
      });
      expect(info.community.channels.map((c) => c.key)).toEqual(['lounge', 'labBench', 'showAndTell', 'announcements']);
      expect(info.public_key).toMatch(/^[0-9a-f]{64}$/);
      const state = (await (await fetch(`${info.url}/_fake/state`)).json()) as {
        application: { interactions_endpoint_url: string };
        guilds: { channels: { type: number }[] }[];
      };
      expect(state.application.interactions_endpoint_url).toBe('http://localhost:8787/discord/interactions');
      expect(state.guilds[0]!.channels.map((c) => c.type).sort((a, b) => a - b)).toEqual([0, 5, 15, 16]);
      const me = await fetch(`${info.api_base}/users/@me`, { headers: { authorization: `Bot ${info.bot_token}` } });
      expect(me.status).toBe(200);
    } finally {
      child.kill('SIGTERM');
    }
    expect(await exited).toBe(0);
  });

  it('is deterministic where the relay’s database outlives it: IDs and webhook tokens repeat between runs', async () => {
    const run = async () => {
      const child = spawn('node', [CLI, '--port', '0', '--seed', 'dev'], { stdio: ['ignore', 'pipe', 'inherit'] });
      const exited = new Promise((resolve) => child.on('exit', resolve));
      const info = await new Promise<{ community: { channels: { id: string; webhook: { id: string; token: string } }[] } }>((resolve) => {
        child.stdout.on('data', (d: Buffer) => {
          const line = d
            .toString()
            .split('\n')
            .find((l) => l.startsWith('{"ready"'));
          if (line) resolve(JSON.parse(line));
        });
      });
      child.kill('SIGTERM');
      await exited;
      return info.community.channels.map((c) => [c.id, c.webhook.id, c.webhook.token]);
    };
    expect(await run()).toEqual(await run());
  });
});
