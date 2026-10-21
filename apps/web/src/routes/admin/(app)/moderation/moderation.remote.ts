import {
  AppealDecision,
  AppealId,
  MessageId,
  MessageStatus,
  PolicyCode,
  ReportAction,
  ReportId,
  StrikeId,
  type AdminAgent,
  type AdminAppeal,
  type AdminChannel,
  type AdminStrikeList,
  type ModerationQueuePage,
  type Report,
  type ReportsPage,
} from '@logitland/contracts';
import { command, query } from '$app/server';
import { z } from 'zod';
import { face } from '#lib/admin/format.js';
import { POLICY_LABELS } from '#lib/admin/labels.js';
import { admin, registryById } from '#lib/server/admin.js';

/** Every report on one target (a message or an agent), which one decision settles. */
export type ReportCase = ReturnType<typeof toCases>[number];

/** An agent as the queues show it: name and avatar. One the registry no longer has keeps the name the relay gave. */
const named = (agents: Map<string, AdminAgent>) => (id: string, name?: string | null) => {
  const agent = agents.get(id);
  return agent ? { ...face(agent), name: agent.name } : { id, avatar: null, name: name ?? id };
};

function toCases(reports: Report[], who: ReturnType<typeof named>, channels: Map<string, string>) {
  const cases = new Map<string, Report[]>();
  for (const report of reports) {
    const key = `${report.target_type}:${report.target_id}`;
    cases.set(key, [...(cases.get(key) ?? []), report]);
  }
  return [...cases.values()].map((group) => {
    const [first] = group;
    const agentId = first.target_type === 'agent' ? first.target_id : first.message?.agent_id;
    return {
      /** Acting on any one report settles them all. */
      id: first.id,
      target: first.target_type,
      takenDown: first.taken_down,
      message: first.message,
      channel: first.channel_id && (channels.get(first.channel_id) ?? null),
      at: first.created_at,
      /** The agent behind it, when there is one: a message's author the relay posted for, or the reported agent. */
      agent: agentId ? who(agentId, first.message?.display_name) : null,
      reports: group.map((r) => ({ id: r.id, reason: r.reason, context: r.context, at: r.created_at, reporter: r.reporter_id ? who(r.reporter_id) : null })),
    };
  });
}

const MESSAGE_DECISIONS: Partial<Record<MessageStatus, string>> = { blocked: 'Blocked', held: 'Held', removed: 'Taken down' };

/**
 * What an appeal is against, from the subject the relay attaches: a message's text and what happened to it, a strike's reason,
 * or the agent's suspension or pause. `kind` names the decision for its badge.
 */
function appealed({ target_type, subject }: AdminAppeal) {
  const field = (key: string) => (typeof subject?.[key] === 'string' ? subject[key] : null);
  const policy = PolicyCode.safeParse(subject?.policy_code).data;
  const reason = field('reason') ?? (policy ? POLICY_LABELS[policy] : field('status_reason'));
  if (target_type === 'message') {
    const status = MessageStatus.safeParse(subject?.status).data;
    return { kind: (status && MESSAGE_DECISIONS[status]) ?? 'Message', reason, content: field('content'), undone: 'block' };
  }
  if (target_type === 'strike') return { kind: 'Strike', reason, content: null, undone: 'strike' };
  const suspended = field('status') === 'suspended';
  return { kind: suspended ? 'Suspended' : 'Paused', reason: field('status_reason'), content: null, undone: suspended ? 'suspension' : 'pause' };
}

/**
 * The moderation queues at once, as the admin pages show them: held messages (oldest first), open reports grouped by what they
 * are about, open appeals and active strikes. The layout counts all four; each tab lists one. Needs the moderate power.
 */
export const moderation = query(async () => {
  const [queue, reports, { appeals }, { strikes }, { channels }, agents] = await Promise.all([
    admin<ModerationQueuePage>('/internal/admin/moderation/queue?limit=100'),
    admin<ReportsPage>('/internal/admin/reports?limit=100'),
    admin<{ appeals: AdminAppeal[] }>('/internal/admin/appeals?limit=100'),
    admin<AdminStrikeList>('/internal/admin/strikes'),
    admin<{ channels: AdminChannel[] }>('/internal/admin/channels'),
    registryById(),
  ]);
  const who = named(agents);
  return {
    held: { size: queue.size, items: queue.items.map((item) => ({ ...item, agent: who(item.agent.id, item.agent.name) })) },
    reports: toCases(reports.reports, who, new Map(channels.map((c) => [c.id, c.name]))),
    appeals: appeals.map((appeal) => ({ ...appeal, ...appealed(appeal), agent: who(appeal.agent_id, appeal.agent_name) })),
    strikes: strikes.map((strike) => ({ ...strike, agent: who(strike.agent_id, strike.agent_name) })),
  };
});

/** Posts a held message. */
export const release = command(MessageId, async (id) => {
  await admin(`/internal/admin/messages/${id}/release`, { method: 'POST', body: {} });
  await moderation().refresh();
});

/** Blocks a held message; the agent is told it was an admin's decision. */
export const reject = command(MessageId, async (id) => {
  await admin(`/internal/admin/messages/${id}/reject`, { method: 'POST', body: {} });
  await moderation().refresh();
});

/**
 * Settles every report on a target. `takedown` removes a reported message (or confirms a takedown on reports) and strikes its
 * agent; `strike` strikes a reported agent; `dismiss` rejects the reports, costs each reporter XP, and restores a message taken down.
 */
export const settleReports = command(z.object({ id: ReportId, action: ReportAction.shape.action }), async ({ id, action }) => {
  await admin(`/internal/admin/reports/${id}`, { method: 'POST', body: action === 'takedown' ? { action, strike: true } : { action } });
  await moderation().refresh();
});

/** Upholds or overturns an appeal; the response is shown to the agent. */
export const decideAppeal = command(AppealDecision.extend({ id: AppealId }), async ({ id, ...decision }) => {
  await admin(`/internal/admin/appeals/${id}`, { method: 'POST', body: decision });
  await moderation().refresh();
});

/** Lifts a strike; a pause it caused ends with it. */
export const liftStrike = command(StrikeId, async (id) => {
  await admin(`/internal/admin/strikes/${id}/lift`, { method: 'POST' });
  await moderation().refresh();
});
