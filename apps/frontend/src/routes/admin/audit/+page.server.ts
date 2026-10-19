import type { AuditEntry } from '@logitland/contracts';
import { ACTOR_FILTERS, AUDIT_DAYS, NOTES, RELAY_NOTES, type ActorKind, type AuditDay, type AuditItem, type DiffLine } from '#lib/fixtures/admin-audit.js';
import { relay } from '#lib/server/relay.js';

const KIND: Record<AuditEntry['actor_type'], ActorKind> = { admin: 'admin', owner: 'owner', agent: 'agent', system: 'relay', mcp: 'discord' };
const KIND_LABEL: Record<ActorKind, string> = { admin: 'human admin', owner: 'owner', agent: 'agent', relay: 'relay', discord: 'seen in Discord' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const DAY_MS = 86_400_000;

function diffLines(diff: NonNullable<AuditEntry['diff']>): DiffLine[] {
  const pairs = Object.entries(diff);
  return pairs.flatMap(([key, { from, to }], i) => {
    const comma = i < pairs.length - 1 ? ',' : '';
    return [
      { text: `− "${key}": ${JSON.stringify(from ?? null)}${comma}`, kind: 'del' as const },
      { text: `+ "${key}": ${JSON.stringify(to ?? null)}${comma}`, kind: 'add' as const },
    ];
  });
}

/** Group the relay's entries (newest first) into UTC days and map them to the page's view model. */
function toDays(entries: AuditEntry[], owners: Map<string, string>, agents: Map<string, string>, now = new Date()): AuditDay[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days: AuditDay[] = [];
  for (const e of entries) {
    const at = new Date(e.created_at);
    const day = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
    const id = new Date(day).toISOString().slice(0, 10);
    const label = day === today ? 'Today' : day === today - DAY_MS ? 'Yesterday' : `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
    let group = days.at(-1);
    if (group?.id !== id) days.push((group = { id, label, entries: [] }));

    const kind = KIND[e.actor_type];
    const person = kind === 'admin' || kind === 'owner' ? owners.get(e.actor_id) : undefined;
    const actor = kind === 'relay' ? 'Relay' : person ? `@${person}` : kind === 'agent' ? (agents.get(e.actor_id) ?? e.actor_id) : e.actor_id;
    const words = e.action.replace(/[._]/g, ' ');
    const item: AuditItem = {
      id: e.id,
      kind,
      actor,
      kindLabel: KIND_LABEL[kind],
      time: `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`,
      text: `${words[0]?.toUpperCase() ?? ''}${words.slice(1)}.${e.reason ? ` Reason: “${e.reason}”` : ''}`,
      meta: `${e.target_type} ${e.target_id} · ${e.id}`,
      mark: kind === 'agent' ? { flock: e.actor_id } : kind === 'relay' || kind === 'discord' ? { ring: true } : { initial: (person?.[0] ?? '?').toUpperCase() },
      diff: e.diff && Object.keys(e.diff).length ? { lines: diffLines(e.diff), open: false } : undefined,
    };
    group.entries.push(item);
  }
  return days;
}

export async function load({ locals }) {
  const client = relay();
  if (!client || !locals.viewer) return { filters: ACTOR_FILTERS, days: AUDIT_DAYS, notes: NOTES, live: false };

  // Relay mode: the relay's latest audit entries. Names come from the agent registry, which only knows
  // owners who have agents; anyone else shows as their ID. Times are UTC.
  const [{ entries }, { agents }] = await Promise.all([client.adminAudit(locals.viewer.owner_id), client.adminAgents(locals.viewer.owner_id)]);
  const owners = new Map(agents.filter((a) => a.owner_id && a.owner_username).map((a) => [a.owner_id!, a.owner_username!]));
  owners.set(locals.viewer.owner_id, locals.viewer.username);
  const names = new Map(agents.map((a) => [a.id, a.name]));
  return { filters: ACTOR_FILTERS, days: toDays(entries, owners, names), notes: RELAY_NOTES, live: true };
}
