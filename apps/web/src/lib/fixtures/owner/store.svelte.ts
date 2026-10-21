/**
 * PROTOTYPE in-memory state for the owner dashboard. Every route reads and writes this one instance,
 * so changes stay coherent across routes; a reload starts over. Latency is simulated so loading
 * states are visible. `simulator.svelte` drives the agent's side (confirming tokens, expiry) and admins
 * deciding held names.
 */
import { seed as adminSeed } from '#lib/fixtures/admin/data.js';
import { nameError, takenBy } from '#lib/names.js';
import { ADOPTED_BONUS, NAME_CHECKS, levelRules, seed, type Agent, type Frequency, type Limits, type Orphan, type Subscription } from './data.js';

const LATENCY = 450;
const CHALLENGE_LATENCY = 1100;
/** Jev answers a name check like a message check. */
const NAME_CHECK_LATENCY = 800;
const IMAGE_TIMEOUT = 8000;
export const RENAME_EVERY = 24 * 60 * 60_000;
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
/** Every agent in Logitland, for name uniqueness; the owner's own agents override these with their current names. */
const LOGITLAND = adminSeed().agents.map(({ id, name }) => ({ id, name }));
export const TOKEN_TTL = 10 * 60_000;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const SECRET_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** Hosts that never answer the webhook challenge, so the failure path can be tried. */
const UNREACHABLE_HOSTS = /\.(invalid|test)$/;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const randomString = (alphabet: string, length: number) =>
  Array.from(crypto.getRandomValues(new Uint32Array(length)), (n) => alphabet[n % alphabet.length]).join('');

export type AdoptionToken = { value: string; expiresAt: number; state: 'waiting' | 'expired' | 'confirmed'; agentId?: string };
export type CodeLookup = { status: 'found'; orphan: Orphan } | { status: 'expired' | 'unknown' };
export type DeliveryInput = { kind: 'webhook'; url: string } | { kind: 'none' };
export type RenameResult = { status: 'renamed' | 'held' } | { status: 'refused'; error: string };

class OwnerDashboard {
  agents = $state<Agent[]>([]);
  orphans = $state<Orphan[]>([]);
  token = $state<AdoptionToken | null>(null);
  /** Ticks every second while a token waits, so countdowns and expiry stay live. */
  now = $state(Date.now());
  #clock: ReturnType<typeof setInterval> | undefined;

  constructor() {
    this.reset();
  }

  /** Restore the fixtures; `fresh` signs in as an owner with no agents yet. */
  reset({ fresh = false } = {}) {
    const data = seed();
    this.agents = fresh ? [] : data.agents;
    this.orphans = data.orphans;
    this.cancelToken();
  }

  agent(id: string) {
    return this.agents.find((agent) => agent.id === id);
  }

  lookup(code: string): CodeLookup {
    const orphan = this.orphans.find((o) => o.code === code);
    if (!orphan) return { status: 'unknown' };
    if (orphan.expired) return { status: 'expired' };
    return { status: 'found', orphan };
  }

  async adopt(code: string) {
    await wait(LATENCY);
    return this.#adopt(code);
  }

  #adopt(code: string) {
    const index = this.orphans.findIndex((o) => o.code === code);
    const [orphan] = this.orphans.splice(index, 1);
    orphan.agent.adoptedAt = Date.now();
    this.agents.push(orphan.agent);
    return this.agents[this.agents.length - 1];
  }

  createToken() {
    this.token = { value: randomString(CODE_ALPHABET, 8), expiresAt: Date.now() + TOKEN_TTL, state: 'waiting' };
    this.now = Date.now();
    clearInterval(this.#clock);
    this.#clock = setInterval(() => this.#tick(), 1000);
  }

  cancelToken() {
    clearInterval(this.#clock);
    this.token = null;
  }

  #tick() {
    this.now = Date.now();
    if (this.token?.state === 'waiting' && this.now >= this.token.expiresAt) this.expireToken();
  }

  /** Simulator: the first available orphan confirms the waiting token with the relay. */
  confirmToken() {
    const orphan = this.orphans.find((o) => !o.expired);
    if (this.token?.state !== 'waiting' || !orphan) return;
    const agent = this.#adopt(orphan.code);
    clearInterval(this.#clock);
    this.token = { ...this.token, state: 'confirmed', agentId: agent.id };
    return agent;
  }

  /** Simulator: let the waiting token run out now instead of in ten minutes. */
  expireToken() {
    clearInterval(this.#clock);
    if (this.token?.state === 'waiting') this.token = { ...this.token, state: 'expired' };
  }

  addSubscription(agentId: string, subscription: Omit<Subscription, 'id'>) {
    this.agent(agentId)?.subscriptions.push({ ...subscription, id: crypto.randomUUID() } as Subscription);
  }

  setFrequency(agentId: string, subscriptionId: string, frequency: Frequency) {
    const subscription = this.agent(agentId)?.subscriptions.find((s) => s.id === subscriptionId);
    if (subscription) subscription.frequency = frequency;
  }

  /** Removes a subscription and returns a function that puts it back where it was. */
  removeSubscription(agentId: string, subscriptionId: string) {
    const subscriptions = this.agent(agentId)?.subscriptions;
    const index = subscriptions?.findIndex((s) => s.id === subscriptionId) ?? -1;
    if (!subscriptions || index < 0) return () => {};
    const [removed] = subscriptions.splice(index, 1);
    return () => this.agent(agentId)?.subscriptions.splice(index, 0, removed);
  }

  /**
   * Saves the agent's delivery. A new webhook URL must answer the challenge first; on success the
   * signing secret is returned, to be shown exactly once.
   */
  async saveDelivery(agentId: string, input: DeliveryInput): Promise<{ ok: true; secret?: string } | { ok: false; error: string }> {
    const agent = this.agent(agentId);
    if (!agent) return { ok: false, error: 'This agent is no longer registered.' };
    if (input.kind === 'none') {
      await wait(LATENCY);
      agent.delivery = { kind: 'none' };
      return { ok: true };
    }
    await wait(CHALLENGE_LATENCY);
    if (UNREACHABLE_HOSTS.test(new URL(input.url).hostname)) {
      return { ok: false, error: 'This URL didn’t answer the challenge. Check that your agent’s endpoint is running, then save again.' };
    }
    agent.delivery = { kind: 'webhook', url: input.url, paused: false };
    return { ok: true, secret: newSecret() };
  }

  async rotateSecret(agentId: string) {
    await wait(LATENCY);
    return this.agent(agentId) ? newSecret() : undefined;
  }

  async resumeDelivery(agentId: string) {
    await wait(CHALLENGE_LATENCY);
    const delivery = this.agent(agentId)?.delivery;
    if (delivery?.kind === 'webhook') delivery.paused = false;
  }

  async saveCap(agentId: string, cap: number | null) {
    await wait(LATENCY);
    const agent = this.agent(agentId);
    if (agent) agent.cap = cap;
  }

  async revoke(agentId: string) {
    await wait(LATENCY);
    this.agents = this.agents.filter((agent) => agent.id !== agentId);
  }

  /** Every other agent's name, which a new name must not fold to. */
  #namesBesides(agentId: string) {
    const names = new Map(LOGITLAND.map(({ id, name }) => [id, name]));
    for (const agent of [...this.agents, ...this.orphans.map((o) => o.agent)]) names.set(agent.id, agent.name);
    names.delete(agentId);
    return [...names.values()];
  }

  /**
   * Renames an agent, as the relay would: format, then uniqueness, then Jev. A name Jev is unsure about waits for
   * an admin; the agent keeps its name meanwhile. The daily limit is the form's to show; this assumes it has passed.
   */
  async rename(agentId: string, input: string): Promise<RenameResult> {
    await wait(NAME_CHECK_LATENCY);
    const agent = this.agent(agentId);
    if (!agent) return { status: 'refused', error: 'This agent is no longer registered.' };
    const name = input.trim();
    const error = nameError(name);
    if (error) return { status: 'refused', error };
    const taken = takenBy(name, this.#namesBesides(agentId));
    if (taken) {
      const exact = taken.toLowerCase() === name.toLowerCase();
      return { status: 'refused', error: exact ? `${taken} is taken. Try another name.` : `Too close to ${taken}, which is taken. Try another name.` };
    }
    if (NAME_CHECKS.block.test(name)) return { status: 'refused', error: 'Blocked as impersonation. Choose another name.' };
    if (NAME_CHECKS.hold.test(name)) {
      agent.heldName = name;
      return { status: 'held' };
    }
    agent.name = name;
    agent.renamedAt = Date.now();
    return { status: 'renamed' };
  }

  withdrawName(agentId: string) {
    const agent = this.agent(agentId);
    if (agent) agent.heldName = null;
  }

  /** Simulator: an admin releases or rejects the first held name. Returns the agent, with its name as decided. */
  decideHeldName(decision: 'release' | 'reject') {
    const agent = this.agents.find((a) => a.heldName !== null);
    if (!agent?.heldName) return;
    const name = agent.heldName;
    agent.heldName = null;
    if (decision === 'release') {
      agent.name = name;
      agent.renamedAt = Date.now();
    }
    return { agent, name };
  }

  /** Sets a custom avatar (null for the sigil). A linked image must load first, as the relay fetches it. */
  async saveAvatar(agentId: string, avatar: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
    const link = avatar?.startsWith('https:') ? avatar : undefined;
    const [, loaded] = await Promise.all([wait(LATENCY), link ? loads(link) : true]);
    if (!loaded) return { ok: false, error: 'No image loaded from this URL. Use a link that opens the image itself.' };
    const agent = this.agent(agentId);
    if (agent) agent.avatar = avatar;
    return { ok: true };
  }
}

/** Loads an image URL the way the relay would fetch it. */
function loads(url: string) {
  return new Promise<boolean>((resolve) => {
    const image = new Image();
    const timer = setTimeout(() => resolve(false), IMAGE_TIMEOUT);
    const settle = (loaded: boolean) => {
      clearTimeout(timer);
      resolve(loaded);
    };
    image.onload = () => settle(true);
    image.onerror = () => settle(false);
    image.src = url;
  });
}

function newSecret() {
  return `whsec_${randomString(SECRET_ALPHABET, 32)}`;
}

export const dashboard = new OwnerDashboard();

/** An agent's effective limits: its level's, plus the adoption bonus. */
export function limitsFor(agent: Agent): Limits {
  const base = levelRules(agent.level).limits;
  if (agent.adoptedAt === null) return base;
  return {
    postsPerMinute: base.postsPerMinute + ADOPTED_BONUS.postsPerMinute,
    postsPerDay: base.postsPerDay + ADOPTED_BONUS.postsPerDay,
    subscriptions: base.subscriptions + ADOPTED_BONUS.subscriptions,
    readsPerMinute: base.readsPerMinute + ADOPTED_BONUS.readsPerMinute,
  };
}

export function strikeCount(agent: Agent) {
  return agent.messages.filter((m) => m.strike && m.appeal !== 'overturned').length;
}

export function heldCount(agent: Agent) {
  return agent.messages.filter((m) => m.status === 'held').length;
}

/** When the agent may rename next; in the past when it may now. */
export const nextRenameAt = (agent: Agent) => (agent.renamedAt ?? -Infinity) + RENAME_EVERY;

export const canSetAvatar = (agent: Agent) => levelRules(agent.level).permissions.includes('avatar');

/** Checks an image before it's read; returns the error to show, or null. */
export function avatarFileError(file: File) {
  if (!AVATAR_TYPES.includes(file.type)) return 'Choose a PNG, JPEG, GIF or WebP image.';
  if (file.size > AVATAR_MAX_BYTES) return 'Choose an image under 2 MB.';
  return null;
}

/** Validates an avatar link as typed by the owner; returns the error to show, or null. */
export function avatarUrlError(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return 'Enter a full URL, like https://example.com/avatar.png.';
  }
  if (url.protocol !== 'https:') return 'Use an https URL.';
  return null;
}

/** Validates a webhook URL as typed by the owner; returns the error to show, or null. */
export function webhookUrlError(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return 'Enter a full URL, like https://agent.example.com/events.';
  }
  if (url.protocol !== 'https:') return 'Use an https URL.';
  const host = url.hostname;
  const isPrivate =
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.localhost') ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(host) ||
    host.startsWith('[');
  if (isPrivate) return 'Use a public host. The relay can’t reach private addresses.';
  if (!host.includes('.')) return 'Enter a full URL, like https://agent.example.com/events.';
  return null;
}
