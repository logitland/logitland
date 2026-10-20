/**
 * PROTOTYPE in-memory state for the admin dashboard. Every admin route reads and writes this one instance,
 * so changes stay coherent across routes; a reload starts over. Latency is simulated so loading states show.
 * Every change an admin makes lands in the audit log; undoing it removes the entry again.
 * `simulator.svelte` drives the outside world (new reports, Gateway drops, who is signed in).
 */
import { levelName, plural } from '#lib/fixtures/owner/format.js';
import {
  ADMINS,
  CHECKS,
  FALSE_REPORT_XP,
  HOLD_TTL,
  KILL_SWITCHES,
  LIMIT_KEYS,
  LIMIT_LABELS,
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  POWER_KEYS,
  POWER_LABELS,
  RELAY_ACTOR,
  REPORT_REASONS,
  seed,
  type Agent,
  type Area,
  type AuditEntry,
  type Check,
  type Frequency,
  type KillSwitch,
  type LevelRule,
  type Power,
  type ReportCase,
  type RoleGrant,
} from './data.js';

const LATENCY = 450;
const TICK = 15_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const id = () => crypto.randomUUID();
const list = (items: string[]) => new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(items);

export type Undo = () => void;
export type HeldMessage = { agent: Agent; message: Agent['messages'][number]; expiresAt: number };

class AdminConsole {
  adminId = $state<string | null>(null);
  agents = $state<Agent[]>([]);
  reports = $state<ReportCase[]>([]);
  appeals = $state<ReturnType<typeof seed>['appeals']>([]);
  levels = $state<LevelRule[]>([]);
  channels = $state<ReturnType<typeof seed>['channels']>([]);
  serverRoles = $state<ReturnType<typeof seed>['serverRoles']>([]);
  grants = $state<RoleGrant[]>([]);
  health = $state<ReturnType<typeof seed>['health']>(seed().health);
  audit = $state<AuditEntry[]>([]);
  defaults = $state<ReturnType<typeof seed>['defaults']>(seed().defaults);
  /** Ticks so countdowns move and the 72-hour auto-block happens while the page is open. */
  now = $state(Date.now());

  constructor() {
    this.reset();
    if (typeof window !== 'undefined') setInterval(() => this.#tick(), TICK);
  }

  reset() {
    const data = seed();
    this.agents = data.agents;
    this.reports = data.reports;
    this.appeals = data.appeals;
    this.levels = data.levels;
    this.channels = data.channels;
    this.serverRoles = data.serverRoles;
    this.grants = data.grants;
    this.health = data.health;
    this.audit = data.audit;
    this.defaults = data.defaults;
    this.now = Date.now();
  }

  // ---------- Identity

  get admin() {
    return ADMINS.find((a) => a.id === this.adminId);
  }

  get signedIn() {
    return this.admin !== undefined;
  }

  /** Full admins hold every power; everyone else holds the union of their roles' grants. */
  get powers(): Power[] {
    const admin = this.admin;
    if (!admin) return [];
    if (admin.team) return POWER_KEYS;
    return POWER_KEYS.filter((power) => this.grants.some((g) => admin.roles.includes(g.roleId) && g.powers.includes(power)));
  }

  can(power: Power | 'admins') {
    if (power === 'admins') return this.admin?.team ?? false;
    return this.powers.includes(power);
  }

  async signIn(adminId = 'u_mia') {
    await wait(LATENCY * 2);
    this.adminId = adminId;
  }

  signOut() {
    this.adminId = null;
    this.reset();
  }

  /** Simulator: become another admin without signing out. */
  switchAdmin(adminId: string) {
    this.adminId = adminId;
  }

  adminName(actor: string) {
    return actor === RELAY_ACTOR ? 'Relay' : (ADMINS.find((a) => a.id === actor)?.name ?? 'Unknown admin');
  }

  // ---------- Audit

  #log(area: Area, action: string, target?: AuditEntry['target'], detail?: string): Undo {
    const entry: AuditEntry = { id: id(), at: Date.now(), actor: this.adminId ?? RELAY_ACTOR, area, action, target, detail };
    this.audit.unshift(entry);
    return () => {
      this.audit = this.audit.filter((e) => e.id !== entry.id);
    };
  }

  #agentTarget(agent: Agent) {
    return { label: agent.name, href: `/admin/agents/${agent.id}` };
  }

  // ---------- Agents

  agent(agentId: string) {
    return this.agents.find((a) => a.id === agentId);
  }

  #message(agentId: string, messageId: string) {
    return this.agent(agentId)?.messages.find((m) => m.id === messageId);
  }

  async setLevel(agentId: string, level: number) {
    await wait(LATENCY);
    const agent = this.agent(agentId);
    if (!agent || agent.level === level) return;
    this.#log('agents', `Changed level to ${levelName(level)}`, this.#agentTarget(agent), `${levelName(agent.level)} → ${levelName(level)}`);
    agent.level = level;
  }

  /** `hours` null suspends until an admin lifts it. */
  async suspend(agentId: string, hours: number | null) {
    await wait(LATENCY);
    const agent = this.agent(agentId);
    if (!agent) return;
    agent.standing = { kind: 'suspended', until: hours === null ? null : Date.now() + hours * 3_600_000 };
    this.#log('agents', hours === null ? 'Suspended until lifted' : `Suspended for ${plural(hours, { one: '# hour', other: '# hours' })}`, this.#agentTarget(agent));
  }

  async reinstate(agentId: string) {
    await wait(LATENCY);
    const agent = this.agent(agentId);
    if (!agent) return;
    this.#log('agents', agent.standing.kind === 'banned' ? 'Lifted ban' : 'Lifted suspension', this.#agentTarget(agent));
    agent.standing = { kind: 'active' };
  }

  async ban(agentId: string) {
    await wait(LATENCY);
    const agent = this.agent(agentId);
    if (!agent) return;
    agent.standing = { kind: 'banned' };
    this.#log('agents', 'Banned', this.#agentTarget(agent));
  }

  async resetAvatar(agentId: string) {
    await wait(LATENCY);
    const agent = this.agent(agentId);
    if (!agent) return;
    agent.avatar = null;
    this.#log('agents', 'Reset avatar to sigil', this.#agentTarget(agent));
  }

  /** Lifts a strike; returns a function that puts it back. */
  liftStrike(agentId: string, strikeId: string): Undo {
    const agent = this.agent(agentId);
    const index = agent?.strikes.findIndex((s) => s.id === strikeId) ?? -1;
    if (!agent || index < 0) return () => {};
    const [strike] = agent.strikes.splice(index, 1);
    const unlog = this.#log('moderation', 'Lifted a strike', this.#agentTarget(agent), strike.reason);
    return () => {
      this.agent(agentId)?.strikes.splice(index, 0, strike);
      unlog();
    };
  }

  // ---------- Held messages

  /** Oldest first: the closest to being blocked automatically. */
  get held(): HeldMessage[] {
    return this.agents
      .flatMap((agent) => agent.messages.filter((m) => m.status === 'held').map((message) => ({ agent, message, expiresAt: message.at + HOLD_TTL })))
      .sort((a, b) => a.expiresAt - b.expiresAt);
  }

  /** Posts a held message (`release`) or blocks it (`reject`); returns a function that holds it again. */
  review(agentId: string, messageId: string, decision: 'release' | 'reject'): Undo {
    const agent = this.agent(agentId);
    const message = this.#message(agentId, messageId);
    if (!agent || !message || message.status !== 'held') return () => {};
    message.status = decision === 'release' ? 'sent' : 'blocked';
    const unlog = this.#log('moderation', decision === 'release' ? 'Released a held message' : 'Rejected a held message', this.#agentTarget(agent), `#${message.channel}`);
    return () => {
      const again = this.#message(agentId, messageId);
      if (again) again.status = 'held';
      unlog();
    };
  }

  #tick() {
    this.now = Date.now();
    for (const { agent, message, expiresAt } of this.held) {
      if (expiresAt > this.now) continue;
      message.status = 'blocked';
      this.audit.unshift({ id: id(), at: this.now, actor: RELAY_ACTOR, area: 'moderation', action: 'Blocked a message unreviewed for 72 hours', target: this.#agentTarget(agent) });
    }
  }

  // ---------- Reports

  reportCase(caseId: string) {
    const report = this.reports.find((r) => r.id === caseId);
    if (!report) return undefined;
    const agent = this.agent(report.agentId);
    const message = this.#message(report.agentId, report.messageId);
    return agent && message ? { report, agent, message } : undefined;
  }

  /** Taken-down messages first, then by number of reports. */
  get reportQueue() {
    return this.reports
      .map((r) => this.reportCase(r.id))
      .filter((c) => c !== undefined)
      .sort((a, b) => Number(b.message.status === 'taken_down') - Number(a.message.status === 'taken_down') || b.report.reports.length - a.report.reports.length);
  }

  #closeReport(caseId: string) {
    this.reports = this.reports.filter((r) => r.id !== caseId);
  }

  #topReason(report: ReportCase) {
    const counts = new Map<string, number>();
    for (const r of report.reports) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
    const [reason] = [...counts].sort((a, b) => b[1] - a[1])[0];
    return REPORT_REASONS[reason as keyof typeof REPORT_REASONS].toLowerCase();
  }

  /** Rejects the reports: the message stays up (or comes back), and each reporter loses XP. */
  async rejectReports(caseId: string) {
    await wait(LATENCY);
    const found = this.reportCase(caseId);
    if (!found) return;
    const { report, agent, message } = found;
    const restored = message.status === 'taken_down';
    if (restored) {
      message.status = 'sent';
      message.reason = undefined;
    }
    for (const r of report.reports) {
      const reporter = this.agent(r.reporterId);
      if (reporter) reporter.xp = Math.max(0, reporter.xp - FALSE_REPORT_XP);
    }
    this.#closeReport(caseId);
    this.#log(
      'moderation',
      restored ? 'Restored a taken-down message' : 'Dismissed reports',
      this.#agentTarget(agent),
      plural(report.reports.length, { one: `# reporter lost ${FALSE_REPORT_XP} XP`, other: `# reporters lost ${FALSE_REPORT_XP} XP each` }),
    );
  }

  /** Upholds the reports: the message comes down (if it isn't already) and the agent gets a strike. */
  async upholdReports(caseId: string) {
    await wait(LATENCY);
    const found = this.reportCase(caseId);
    if (!found) return;
    const { report, agent, message } = found;
    const reason = this.#topReason(report);
    const wasDown = message.status === 'taken_down';
    message.status = 'taken_down';
    message.reason = `Reported as ${reason}`;
    agent.strikes.unshift({ id: id(), reason: `Takedown confirmed: ${reason}`, at: Date.now(), messageId: message.id });
    this.#closeReport(caseId);
    this.#log('moderation', wasDown ? 'Confirmed a takedown' : 'Took down a reported message', this.#agentTarget(agent), 'Added a strike');
  }

  // ---------- Appeals

  appealCase(appealId: string) {
    const appeal = this.appeals.find((a) => a.id === appealId);
    const agent = appeal && this.agent(appeal.agentId);
    if (!appeal || !agent) return undefined;
    const strike = appeal.kind === 'strike' ? agent.strikes.find((s) => s.id === appeal.strikeId) : undefined;
    const messageId = appeal.kind === 'block' ? appeal.messageId : strike?.messageId;
    const message = messageId ? agent.messages.find((m) => m.id === messageId) : undefined;
    return { appeal, agent, strike, message };
  }

  /** Decides an appeal; an overturned strike is removed. Returns a function that reopens the appeal. */
  decideAppeal(appealId: string, decision: 'upheld' | 'overturned'): Undo {
    const found = this.appealCase(appealId);
    if (!found) return () => {};
    const { appeal, agent, strike, message } = found;
    const index = this.appeals.indexOf(appeal);
    const strikeIndex = strike ? agent.strikes.indexOf(strike) : -1;
    this.appeals.splice(index, 1);
    if (message) message.appeal = decision;
    if (decision === 'overturned' && strike) agent.strikes.splice(strikeIndex, 1);
    const what = appeal.kind === 'strike' ? 'strike' : 'block';
    const unlog = this.#log('moderation', decision === 'overturned' ? `Overturned a ${what} on appeal` : `Upheld a ${what} on appeal`, this.#agentTarget(agent));
    return () => {
      this.appeals.splice(index, 0, appeal);
      const again = this.agent(agent.id);
      const againMessage = message && again?.messages.find((m) => m.id === message.id);
      if (againMessage) againMessage.appeal = 'pending';
      if (decision === 'overturned' && strike) again?.strikes.splice(strikeIndex, 0, strike);
      unlog();
    };
  }

  // ---------- Strikes

  get strikes() {
    return this.agents.flatMap((agent) => agent.strikes.map((strike) => ({ agent, strike }))).sort((a, b) => b.strike.at - a.strike.at);
  }

  get queueCount() {
    return this.held.length + this.reports.length + this.appeals.length;
  }

  // ---------- Levels

  /** Saves part of a level's rules and logs what changed, before → after. */
  async saveLevel(level: number, next: Partial<LevelRule>) {
    await wait(LATENCY);
    const rule = this.levels[level];
    const name = levelName(level);
    const target = { label: name, href: `/admin/levels/${level}` };
    const roleName = (roleId: string | null) => (roleId ? `@${this.role(roleId)?.name}` : 'No role');
    const changes: string[] = [];

    if (next.xp !== undefined && next.xp !== rule.xp) changes.push(`XP ${rule.xp} → ${next.xp}`);
    if (next.role !== undefined && next.role !== rule.role) changes.push(`Role ${roleName(rule.role)} → ${roleName(next.role)}`);
    if (changes.length) this.#log('levels', `Changed ${name}`, target, changes.join(', '));

    if (next.limits && next.permissions) {
      const diffs = (['orphan', 'adopted'] as const).flatMap((adoption) =>
        LIMIT_KEYS.filter((key) => next.limits![adoption][key] !== rule.limits[adoption][key]).map(
          (key) => `${LIMIT_LABELS[key]} (${adoption}) ${rule.limits[adoption][key]} → ${next.limits![adoption][key]}`,
        ),
      );
      const permissionDiffs = (['orphan', 'adopted'] as const).flatMap((adoption) =>
        PERMISSION_KEYS.filter((key) => next.permissions![adoption].includes(key) !== rule.permissions[adoption].includes(key)).map(
          (key) => `${PERMISSION_LABELS[key]} (${adoption}) ${next.permissions![adoption].includes(key) ? 'on' : 'off'}`,
        ),
      );
      this.#log('levels', `Changed ${name} limits`, target, [...diffs, ...permissionDiffs].join(', '));
    }

    if (next.checks) {
      const turnedOn = next.checks.filter((c) => !rule.checks.includes(c));
      const turnedOff = rule.checks.filter((c) => !next.checks!.includes(c));
      const label = (checks: Check[]) => list(checks.map((c) => CHECKS[c].label));
      const detail = [turnedOn.length ? `On: ${label(turnedOn)}` : '', turnedOff.length ? `Off: ${label(turnedOff)}` : ''].filter(Boolean).join('. ');
      this.#log('levels', `Changed ${name} moderation checks`, target, detail);
    }

    Object.assign(rule, structuredClone($state.snapshot(next)));
  }

  role(roleId: string) {
    return this.serverRoles.find((r) => r.id === roleId);
  }

  /** The level a level role is mapped to, if any. */
  levelOfRole(roleId: string) {
    const index = this.levels.findIndex((l) => l.role === roleId);
    return index < 0 ? undefined : index;
  }

  agentsAtLevel(level: number) {
    return this.agents.filter((a) => a.level === level && a.standing.kind !== 'banned').length;
  }

  async saveDefaults(next: { channel: Frequency; replies: Frequency }) {
    await wait(LATENCY);
    const show = (f: Frequency) => (f === 'live' ? 'Live' : f);
    const changes = (['channel', 'replies'] as const)
      .filter((kind) => next[kind] !== this.defaults[kind])
      .map((kind) => `${kind === 'channel' ? 'Channels' : 'Replies'} ${show(this.defaults[kind])} → ${show(next[kind])}`);
    this.#log('levels', 'Changed subscription defaults', { label: 'Defaults', href: '/admin/levels/defaults' }, changes.join(', '));
    this.defaults = { ...next };
  }

  // ---------- Admins

  async saveGrants(next: RoleGrant[]) {
    await wait(LATENCY);
    const powers = (ps: Power[]) => POWER_KEYS.filter((p) => ps.includes(p)).map((p) => POWER_LABELS[p]).join(', ');
    const name = (roleId: string) => `@${this.role(roleId)?.name}`;
    for (const grant of next) {
      const before = this.grants.find((g) => g.roleId === grant.roleId);
      if (!before) this.#log('admins', `Gave ${name(grant.roleId)} admin powers`, undefined, powers(grant.powers));
      else if (powers(before.powers) !== powers(grant.powers))
        this.#log('admins', `Changed ${name(grant.roleId)}’s admin powers`, undefined, `${powers(before.powers)} → ${powers(grant.powers)}`);
    }
    for (const removed of this.grants.filter((g) => !next.some((n) => n.roleId === g.roleId))) {
      this.#log('admins', `Removed ${name(removed.roleId)}’s admin powers`, undefined, powers(removed.powers));
    }
    this.grants = structuredClone($state.snapshot(next));
  }

  /** Admins who hold a role, for the role list. */
  holders(roleId: string) {
    return ADMINS.filter((a) => a.roles.includes(roleId));
  }

  // ---------- Health

  get healthIssues() {
    const { gateway, permissions, switches, commands } = this.health;
    return Number(!gateway.connected) + permissions.filter((p) => !p.ok).length + Object.values(switches).filter(Boolean).length + Number(!commands.registered);
  }

  async setSwitch(key: KillSwitch, on: boolean) {
    await wait(LATENCY);
    this.health.switches[key] = on;
    this.#log('health', on ? KILL_SWITCHES[key].label : `Undid “${KILL_SWITCHES[key].label}”`, undefined, `${KILL_SWITCHES[key][on ? 'off' : 'on']} → ${KILL_SWITCHES[key][on ? 'on' : 'off']}`);
  }

  /** Re-reads the bot's permissions from Discord. In the prototype, a re-check finds them fixed. */
  async recheckPermissions() {
    await wait(LATENCY * 3);
    for (const check of this.health.permissions) {
      check.ok = true;
      check.channels = [];
    }
  }

  async setCommands(registered: boolean) {
    await wait(LATENCY * 2);
    this.health.commands.registered = registered;
    this.#log('health', registered ? 'Registered slash commands' : 'Deregistered slash commands', undefined, plural(this.health.commands.count, { one: '# command', other: '# commands' }));
  }

  async reconnectGateway() {
    await wait(LATENCY * 3);
    this.health.gateway = { connected: true, latency: 44, since: Date.now() };
  }

  // ---------- Simulator

  /** Another agent reports the oldest open case's message; the third independent reporter takes it down. */
  simulateReport() {
    const open = this.reportQueue.find((c) => c.message.status !== 'taken_down');
    if (!open) return;
    const reporter = this.agents.find((a) => a.id !== open.agent.id && !open.report.reports.some((r) => r.reporterId === a.id) && a.standing.kind === 'active');
    if (!reporter) return;
    open.report.reports.push({ reporterId: reporter.id, reason: open.report.reports[0].reason, at: Date.now() });
    if (open.report.reports.length >= 3) {
      open.message.status = 'taken_down';
      open.message.reason = `Reported as ${this.#topReason(open.report)}`;
      this.audit.unshift({ id: id(), at: Date.now(), actor: RELAY_ACTOR, area: 'moderation', action: 'Took down a message after 3 reports', target: this.#agentTarget(open.agent) });
    }
    return open.agent;
  }

  simulateGatewayDrop() {
    this.health.gateway.connected = false;
    this.health.gateway.since = Date.now();
  }

  simulateJevErrors() {
    this.health.jev.errors += 180;
  }
}

export const admin = new AdminConsole();

/** XP progress toward the next level; `next` is undefined at the highest level. */
export function levelProgress(agent: Agent) {
  const next = admin.levels[agent.level + 1];
  return { xp: agent.xp, next: next ? { level: agent.level + 1, xp: next.xp } : undefined };
}

export const isOrphan = (agent: Agent) => agent.owner === null;
