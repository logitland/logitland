// The setup checklist: which group each check belongs to and how a status reads.
import type { SetupCheck, SetupStatus } from '@logitland/contracts';

export type SetupGroupId = 'app' | 'server' | 'channels' | 'relay';

export const SETUP_GROUPS: { id: SetupGroupId; title: string; blurb: string }[] = [
  { id: 'app', title: 'Discord app', blurb: 'The bot and what Discord sends to the relay.' },
  { id: 'server', title: 'Server and roles', blurb: 'The role people get when they agree to the public mirror.' },
  { id: 'channels', title: 'Channels', blurb: 'What the bot can do in each relayed channel.' },
  { id: 'relay', title: 'Relay', blurb: 'Reading Discord, checking messages, and who can open these pages.' },
];

const APP = new Set(['bot-token', 'bot-in-server', 'message-content-intent', 'interactions-url', 'mirror-command']);
const SERVER = new Set(['consent-role']);

export function groupOf(check: Pick<SetupCheck, 'id'>): SetupGroupId {
  if (APP.has(check.id)) return 'app';
  if (SERVER.has(check.id)) return 'server';
  if (check.id.startsWith('channel:') || check.id === 'channels-relayed') return 'channels';
  return 'relay';
}

export const STATUS_WORD: Record<SetupStatus, string> = { ok: 'Ready', warn: 'Warning', fail: 'Needs fixing', unknown: 'Couldn’t check' };
export const STATUS_ORDER: Record<SetupStatus, number> = { fail: 0, warn: 1, unknown: 2, ok: 3 };
export const STATUS_TAG: Record<SetupStatus, { tag: string; dot: string }> = {
  ok: { tag: 'tag tag--plain', dot: 'dot' },
  warn: { tag: 'tag tag--wait', dot: 'dot dot--wait' },
  fail: { tag: 'tag tag--fail', dot: 'dot dot--fail' },
  unknown: { tag: 'tag tag--plain is-off', dot: 'dot dot--off' },
};

export function tally(checks: Pick<SetupCheck, 'status'>[]): Record<SetupStatus, number> {
  const t: Record<SetupStatus, number> = { ok: 0, warn: 0, fail: 0, unknown: 0 };
  for (const c of checks) t[c.status] += 1;
  return t;
}

/** The channel a per-channel check is about: `channel:<id>:webhook` gives the ID and the part. */
export function channelOfCheck(id: string): { channelId: string; part: string } | null {
  const m = /^channel:(\d{17,20}):(.+)$/.exec(id);
  return m ? { channelId: m[1]!, part: m[2]! } : null;
}
