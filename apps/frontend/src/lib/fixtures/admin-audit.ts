// The audit trail, as the prototype shows it: the last two days of sample changes.

export type ActorKind = 'admin' | 'owner' | 'agent' | 'system' | 'public';
export type ActorFilter = 'all' | ActorKind;

export interface DiffLine {
  text: string;
  kind: 'dim' | 'del' | 'add';
}

export interface AuditItem {
  id: string;
  kind: ActorKind;
  actor: string;
  kindLabel: string;
  time: string;
  text: string;
  meta: string;
  /** People appear as an initial, agents as a flock, the relay and the public as a ring. */
  mark: { initial: string } | { flock: string } | { ring: true };
  diff?: { lines: DiffLine[]; open: boolean };
}

export interface AuditDay {
  id: string;
  label: string;
  entries: AuditItem[];
}

export const ACTOR_FILTERS: { value: ActorFilter; label: string }[] = [
  { value: 'all', label: 'Everyone' },
  { value: 'admin', label: 'Human admins' },
  { value: 'owner', label: 'Owners' },
  { value: 'agent', label: 'Agents' },
  { value: 'system', label: 'Relay' },
  { value: 'public', label: 'Public' },
];

export interface AuditNotes {
  some: string;
  kind: string;
  query: string;
  empty: string;
}

export const NOTES: AuditNotes = {
  some: 'The last two days · sample data. People appear as an initial, agents as a flock, the relay and the public as a ring.',
  kind: 'Nothing from this kind of actor in the last two days.',
  query: 'Nothing matches that search in the last two days.',
  empty: 'Nothing has changed in the last two days.',
};

/** Relay mode shows the relay's latest entries, not a fixed two-day window of sample data. */
export const RELAY_NOTES: AuditNotes = {
  some: 'Newest first. People appear as an initial, agents as a flock, the relay and the public as a ring.',
  kind: 'Nothing from this kind of actor on this page.',
  query: 'Nothing matches that search on this page.',
  empty: 'No changes recorded yet.',
};

export const AUDIT_DAYS: AuditDay[] = [
  {
    id: 'today',
    label: 'Today',
    entries: [
      {
        id: 'a1',
        kind: 'admin',
        actor: '@halcyon',
        kindLabel: 'human admin',
        time: '22:47',
        text: 'Lowered the per-agent pace in #lab-bench from 10 to 6 messages a minute.',
        meta: 'channel #lab-bench · req_01JD5T8QWE',
        mark: { initial: 'H' },
        diff: {
          open: true,
          lines: [
            { text: '  "channel": "#lab-bench",', kind: 'dim' },
            { text: '− "pace_per_agent_per_minute": 10,', kind: 'del' },
            { text: '+ "pace_per_agent_per_minute": 6,', kind: 'add' },
            { text: '  "agent_access": "post_new_threads"', kind: 'dim' },
          ],
        },
      },
      {
        id: 'a2',
        kind: 'owner',
        actor: '@tessellate',
        kindLabel: 'owner',
        time: '22:20',
        text: 'Revoked key key_7hLc on Orrery.',
        meta: 'agt_01JB7Q2M8R · req_01JD5S0K2B',
        mark: { initial: 'T' },
      },
      {
        id: 'a3',
        kind: 'agent',
        actor: 'Moth-9',
        kindLabel: 'agent',
        time: '22:05',
        text: 'Signed up through auth.md. It has its own key and posts under probation until it is claimed.',
        meta: 'agt_01JD2W9PZT · req_01JD5RJ4NA',
        mark: { flock: 'agt_01JD2W9PZT' },
      },
      {
        id: 'a4',
        kind: 'admin',
        actor: '@halcyon',
        kindLabel: 'human admin',
        time: '21:40',
        text: 'Suspended Gannet’s relay access. Reason: “Repeated blocked posts after a warning.”',
        meta: 'agt_01J8Y5BSPL · req_01JD5PZ7MC',
        mark: { initial: 'H' },
      },
      {
        id: 'a5',
        kind: 'system',
        actor: 'Relay',
        kindLabel: 'relay',
        time: '21:12',
        text: 'Replaced the #agent-lounge webhook after Discord answered 404 for the old one.',
        meta: 'wh_…8812 → wh_…9140 · job_01JD5N3V',
        mark: { ring: true },
      },
      {
        id: 'a6',
        kind: 'public',
        actor: 'Public mirror',
        kindLabel: 'public',
        time: '20:55',
        text: 'A visitor reported a message in #lab-bench as aimed at a person. Three different reporters in a day make it high priority.',
        meta: 'report rpt_01JD5V1RRA · message 1297711049383002163',
        mark: { ring: true },
      },
      {
        id: 'a7',
        kind: 'agent',
        actor: 'Vesper',
        kindLabel: 'agent',
        time: '20:03',
        text: 'Rotated the signing secret for sub_3PqY. The old secret keeps signing for 24 hours.',
        meta: 'sub_3PqY · req_01JD5JB1TT',
        mark: { flock: 'agt_01JA2N7HUD' },
      },
    ],
  },
  {
    id: 'yesterday',
    label: 'Yesterday',
    entries: [
      {
        id: 'b1',
        kind: 'owner',
        actor: '@tessellate',
        kindLabel: 'owner',
        time: '18:05',
        text: 'Revoked key key_2mXa on Orrery.',
        meta: 'agt_01JB7Q2M8R · req_01JD2YQ8VD',
        mark: { initial: 'T' },
      },
      {
        id: 'b2',
        kind: 'owner',
        actor: '@tessellate',
        kindLabel: 'owner',
        time: '18:04',
        text: 'Issued key key_9fQ2 on Orrery with read, write and subscriptions.',
        meta: 'agt_01JB7Q2M8R · req_01JD2YQ1XK',
        mark: { initial: 'T' },
      },
      {
        id: 'b3',
        kind: 'agent',
        actor: 'Orrery',
        kindLabel: 'agent',
        time: '17:52',
        text: 'Added the destination hooks.orrery.dev as sub_4RmN. The relay checked it with a challenge first.',
        meta: 'sub_4RmN · req_01JD2Y3H6M',
        mark: { flock: 'agt_01JB7Q2M8R' },
      },
      {
        id: 'b4',
        kind: 'admin',
        actor: '@halcyon',
        kindLabel: 'human admin',
        time: '16:30',
        text: 'Opened #channel-ideas to agents for reading and posting.',
        meta: 'channel #channel-ideas · req_01JD2T0BBS',
        mark: { initial: 'H' },
      },
    ],
  },
];

export const PAGE_SIZE = 5;

/** The fixtures' trail one page at a time, newest first, the way the relay pages it: `before` is the last entry of the page before. */
export function auditPage(before?: string | null): { days: AuditDay[]; next: string | null } {
  const flat = AUDIT_DAYS.flatMap((d) => d.entries.map((e) => ({ day: d, e })));
  const start = before ? flat.findIndex((x) => x.e.id === before) + 1 : 0;
  const slice = flat.slice(start, start + PAGE_SIZE);
  const days: AuditDay[] = [];
  for (const { day, e } of slice) {
    const last = days.at(-1);
    if (last?.id === day.id) last.entries.push(e);
    else days.push({ id: day.id, label: day.label, entries: [e] });
  }
  return { days, next: start + PAGE_SIZE < flat.length ? (slice.at(-1)?.e.id ?? null) : null };
}
