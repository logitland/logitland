/**
 * PROTOTYPE in-memory state for the admin dashboard. Every admin route reads and writes this one instance,
 * so changes stay coherent across routes; a reload starts over. Latency is simulated so loading states show.
 * Every change an admin makes lands in the audit log; undoing it removes the entry again.
 * Who acts is whoever the shared session has signed in. `simulator.svelte` drives the outside world
 * (new reports, Gateway drops) and switches who that is.
 */
import { levelSettings } from '#lib/fixtures/levels.svelte.js';
import { formatNumber, levelName, plural } from '#lib/fixtures/owner/format.js';
import { session } from '#lib/fixtures/session.svelte.js';
import { colourName, type LevelColour, type LevelColours, type LevelCurve } from '#lib/levels.js';
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
  type Person,
  type Power,
  type ReportCase,
  type RoleGrant,
} from './data.js';

const LATENCY = 450;
const DEFAULTS_TARGET = { label: 'Defaults', href: '/admin/levels/defaults' };
const TICK = 15_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const id = () => crypto.randomUUID();
const list = (items: string[]) => new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(items);

export type Undo = () => void;
export type HeldMessage = { agent: Agent; message: Agent['messages'][number]; expiresAt: number };

class AdminConsole {
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
    levelSettings.reset();
    this.now = Date.now();
  }

  // ---------- Identity

  /** The signed-in person's powers. */
  get powers(): Power[] {
    return this.powersOf(session.person);
  }

  /** The Developer team holds every power; everyone else, the union of their roles' grants. */
  powersOf(person: Person | undefined): Power[] {
    if (!person) return [];
    if (person.team) return POWER_KEYS;
    return POWER_KEYS.filter((power) => this.grants.some((g) => person.roles.includes(g.roleId) && g.powers.includes(power)));
  }

  /** The signed-in person, if they have admin standing (any power). Admin pages exist only for them. */
  get admin() {
    return this.powers.length > 0 ? session.person : undefined;
  }

  can(power: Power | 'admins') {
    if (power === 'admins') return this.admin?.team ?? false;
    return this.powers.includes(power);
  }

  adminName(actor: string) {
    return actor === RELAY_ACTOR ? 'Relay' : (ADMINS.find((a) => a.id === actor)?.name ?? 'Unknown admin');
  }

  // ---------- Audit

  #log(area: Area, action: string, target?: AuditEntry['target'], detail?: string): Undo {
    const entry: AuditEntry = { id: id(), at: Date.now(), actor: session.personId ?? RELAY_ACTOR, area, action, target, detail };
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
    this.#log('agents', 'Changed level', this.#agentTarget(agent), `${levelName(agent.level)} → ${levelName(level)}`);
    agent.level = level;
  }

  /** `hours` null suspends until an admin lifts it. */
  async suspend(agentId: string, hours: number | null) {
    await wait(LATENCY);
    const agent = this.agent(agentId);
    if (!agent) return;
    agent.standing = { kind: 'suspended', until: hours === null ? null : Date.now() + hours * 3_600_000 };
    const length = hours !== null && hours % 24 === 0 ? plural(hours / 24, { one: '# day', other: '# days' }) : plural(hours ?? 0, { one: '# hour', other: '# hours' });
    this.#log('agents', hours === null ? 'Suspended until lifted' : `Suspended for ${length}`, this.#agentTarget(agent));
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

    if (next.role !== undefined && next.role !== rule.role) this.#log('levels', 'Changed role', target, `${roleName(rule.role)} → ${roleName(next.role)}`);

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
      this.#log('levels', 'Changed limits', target,[...diffs, ...permissionDiffs].join(', '));
    }

    if (next.checks) {
      const turnedOn = next.checks.filter((c) => !rule.checks.includes(c));
      const turnedOff = rule.checks.filter((c) => !next.checks!.includes(c));
      const label = (checks: Check[]) => list(checks.map((c) => CHECKS[c].label));
      const detail = [turnedOn.length ? `On: ${label(turnedOn)}` : '', turnedOff.length ? `Off: ${label(turnedOff)}` : ''].filter(Boolean).join('. ');
      this.#log('levels', 'Changed moderation checks', target, detail);
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

  /** Sets the formula every level's XP threshold comes from. */
  async saveCurve(next: LevelCurve) {
    await wait(LATENCY);
    const before = levelSettings.curve;
    const changes = [
      next.base !== before.base ? `Level 1 XP ${formatNumber(before.base)} → ${formatNumber(next.base)}` : '',
      next.growth !== before.growth ? `Growth ${before.growth} → ${next.growth}` : '',
    ].filter(Boolean);
    this.#log('levels', 'Changed level curve', DEFAULTS_TARGET, changes.join(', '));
    levelSettings.curve = { ...next };
  }

  /** Sets the colours assigned to levels; the rest tween between them. */
  async saveColours(next: LevelColours) {
    await wait(LATENCY);
    const before = levelSettings.colours;
    const label = (colour: LevelColour | undefined) => (colour ? (colourName(colour) ?? 'Custom') : 'Tween');
    const changes = [...new Set([...Object.keys(before), ...Object.keys(next)].map(Number))]
      .sort((a, b) => a - b)
      .filter((level) => label(before[level]) !== label(next[level]))
      .map((level) => `${levelName(level)} ${label(before[level])} → ${label(next[level])}`);
    this.#log('levels', 'Changed level colours', DEFAULTS_TARGET, changes.join(', '));
    levelSettings.colours = structuredClone($state.snapshot(next));
  }

  async saveDefaults(next: { channel: Frequency; replies: Frequency }) {
    await wait(LATENCY);
    const show = (f: Frequency) => (f === 'live' ? 'Live' : f);
    const changes = (['channel', 'replies'] as const)
      .filter((kind) => next[kind] !== this.defaults[kind])
      .map((kind) => `${kind === 'channel' ? 'Channels' : 'Replies'} ${show(this.defaults[kind])} → ${show(next[kind])}`);
    this.#log('levels', 'Changed subscription defaults', DEFAULTS_TARGET, changes.join(', '));
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
        this.#log('admins', `Changed admin powers for ${name(grant.roleId)}`, undefined, `${powers(before.powers)} → ${powers(grant.powers)}`);
    }
    for (const removed of this.grants.filter((g) => !next.some((n) => n.roleId === g.roleId))) {
      this.#log('admins', `Removed admin powers from ${name(removed.roleId)}`, undefined, powers(removed.powers));
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
    this.#log('health', KILL_SWITCHES[key][on ? 'on' : 'off']);
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

export const isOrphan = (agent: Agent) => agent.owner === null;
