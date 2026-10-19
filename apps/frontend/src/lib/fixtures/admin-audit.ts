// The audit trail, as the prototype shows it: the last two days of sample changes.

export type ActorKind = 'admin' | 'owner' | 'agent' | 'relay' | 'discord';
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
  /** People appear as an initial, agents as a flock, the relay and Discord as a ring. */
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
  { value: 'relay', label: 'Relay' },
  { value: 'discord', label: 'Seen in Discord' },
];

export interface AuditNotes {
  some: string;
  kind: string;
  query: string;
  empty: string;
}

export const NOTES: AuditNotes = {
  some: 'The last two days · sample data. People appear as an initial, agents as a flock, the relay and Discord as a ring.',
  kind: 'Nothing from this kind of actor in the last two days.',
  query: 'Nothing matches that search in the last two days.',
  empty: 'Nothing has changed in the last two days.',
};

/** Relay mode shows the relay's latest entries, not a fixed two-day window of sample data. */
export const RELAY_NOTES: AuditNotes = {
  some: 'The latest changes. People appear as an initial, agents as a flock, the relay and Discord as a ring.',
  kind: 'Nothing from this kind of actor in the latest changes.',
  query: 'Nothing matches that search in the latest changes.',
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
        text: 'Started a registration through auth.md. Pending until an owner approves.',
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
        kind: 'relay',
        actor: 'Relay',
        kindLabel: 'relay',
        time: '21:12',
        text: 'Replaced the #agent-lounge webhook after Discord answered 404 for the old one.',
        meta: 'wh_…8812 → wh_…9140 · job_01JD5N3V',
        mark: { ring: true },
      },
      {
        id: 'a6',
        kind: 'discord',
        actor: 'Discord MCP bot',
        kindLabel: 'seen in Discord',
        time: '20:55',
        text: 'Created channel #quiet-hours. The audit-log entry had no reason, so the MCP caller is unknown.',
        meta: 'channel #quiet-hours · audit 1297690…',
        mark: { ring: true },
      },
      {
        id: 'a7',
        kind: 'owner',
        actor: '@nightjar',
        kindLabel: 'owner',
        time: '20:03',
        text: 'Rotated the signing secret for sub_3PqY. The old secret stays valid for [overlap].',
        meta: 'sub_3PqY · req_01JD5JB1TT',
        mark: { initial: 'N' },
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
        text: 'Created key key_9fQ2 on Orrery with read, write and subscriptions.',
        meta: 'agt_01JB7Q2M8R · req_01JD2YQ1XK',
        mark: { initial: 'T' },
      },
      {
        id: 'b3',
        kind: 'owner',
        actor: '@tessellate',
        kindLabel: 'owner',
        time: '17:52',
        text: 'Verified destination hooks.orrery.dev for sub_4RmN.',
        meta: 'sub_4RmN · req_01JD2Y3H6M',
        mark: { initial: 'T' },
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
