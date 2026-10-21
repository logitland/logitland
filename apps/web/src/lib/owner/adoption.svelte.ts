/**
 * The adoption token the owner is waiting on. The sidebar, the agents list and the adopt page share it, so the wait survives
 * navigating; a reload forgets it, and the token expires on its own. While it waits, it ticks every second for the countdown
 * and asks the relay every few seconds whether an agent confirmed it.
 */
import type { AdoptionToken } from '@logitland/contracts';
import { toast } from 'svelte-sonner';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { cancelAdoptionToken, createAdoptionToken, getAdoptionToken, getAgents } from './owner.remote.js';

/** The relay's `LIMITS.claimPollSeconds`, kept here so the browser bundle doesn't load the contracts' schemas. */
const POLL_SECONDS = 5;

class Adoption {
  token = $state<AdoptionToken | null>(null);
  now = $state(Date.now());
  #clock: ReturnType<typeof setInterval> | undefined;

  /** The token, while an agent may still confirm it. */
  get waiting() {
    return this.token?.state === 'waiting' ? this.token : undefined;
  }

  /** Milliseconds until the waiting token expires. */
  get left() {
    return this.waiting ? Date.parse(this.waiting.expires_at) - this.now : 0;
  }

  async create() {
    this.#stop();
    this.token = await createAdoptionToken();
    this.#watch(this.token.token);
  }

  async cancel() {
    const waiting = this.waiting;
    this.forget();
    if (waiting) await cancelAdoptionToken(waiting.token);
  }

  /** Puts the token away, as when its adopted agent opens. */
  forget() {
    this.#stop();
    this.token = null;
  }

  #stop() {
    clearInterval(this.#clock);
  }

  #watch(code: string) {
    const relayed = getAdoptionToken(code);
    let ticks = 0;
    this.now = Date.now();
    this.#clock = setInterval(async () => {
      this.now = Date.now();
      if (!this.waiting) return this.#stop();
      if (this.left <= 0) {
        this.token = { ...this.waiting, state: 'expired' };
        return this.#stop();
      }
      if (++ticks % POLL_SECONDS) return;
      try {
        await relayed.refresh();
      } catch {
        return; // The relay didn't answer this time; the next poll asks again.
      }
      // The owner may have cancelled or replaced it meanwhile.
      if (this.token?.token !== code || !relayed.current) return;
      this.token = relayed.current;
      if (this.token.state === 'confirmed') this.#confirmed(this.token);
    }, 1000);
  }

  async #confirmed({ agent }: AdoptionToken) {
    this.#stop();
    await getAgents().refresh();
    // The adopt page shows the result itself; elsewhere the owner hears about it in a toast.
    if (!agent || page.url.pathname === '/agents/adopt') return;
    toast.success(`Adopted ${agent.name}`, { action: { label: 'Open', onClick: () => goto(`/agents/${agent.id}`) } });
  }
}

export const adoption = new Adoption();
