<script lang="ts">
  import { FLIP, Flock, Morph, fold, motionOK, rise, toast } from '@logitland/ui/svelte';
  import { applyAction, enhance, type SubmitFunction } from '$app/forms';
  import { tick, untrack } from 'svelte';
  import { flip } from 'svelte/animate';
  import { CHIPS, STATES, type ChipKey, type RegistryAgent, type RegistryState } from '#lib/fixtures/admin-agents.js';

  let { data } = $props();

  // Changes made on this page, on top of the loaded rows: suspensions (a form action), and the
  // fixtures-only pause and revoke simulations.
  let states = $state<Record<string, RegistryState>>({});
  let paused = $state<Record<string, boolean>>({});
  let revoked = $state<Record<string, boolean>>({});
  let reasons = $state<Record<string, string>>({});

  const rows = $derived(data.agents.map((a) => ({ ...a, state: states[a.id] ?? a.state })));
  const counts = $derived.by(() => {
    const c = { ...data.counts };
    for (const a of data.agents) {
      const now = states[a.id];
      if (!now || now === a.state) continue;
      if (a.state !== 'denied') c[a.state] -= 1;
      if (now !== 'denied') c[now] += 1;
    }
    return c;
  });

  // Search and chips filter the rows client-side; ?q= from the Health screen fills the search on load.
  let filter = $state<ChipKey>('all');
  let search = $state(untrack(() => data.q));
  const haystack = (a: RegistryAgent) => [a.name, a.id, a.owner, a.joined, a.mod.text, STATES[a.state].label].join(' ').toLowerCase();
  const visible = $derived.by(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((a) => (filter === 'all' || a.state === filter) && (!needle || haystack(a).includes(needle)));
  });
  const showing = $derived(visible.length === 1 ? data.copy.one : data.copy.many.replace('{n}', String(visible.length)));
  const modClass = { fail: 't-fail fw-600', wait: 't-wait', dim: 't-3' } as const;

  let selectedId = $state(untrack(() => data.agents[0]?.id ?? ''));
  const sel = $derived(rows.find((a) => a.id === selectedId));
  let mode = $state<'initial' | 'confirm'>('initial');
  let working = $state<'suspend' | 'pause' | 'revoke' | null>(null);

  let searchEl = $state<HTMLInputElement>();
  let listWrap = $state<HTMLElement>();
  let drawer = $state<HTMLElement>();
  let heading = $state<HTMLElement>();
  let opener = $state<HTMLButtonElement>();
  let reasonEl = $state<HTMLTextAreaElement>();

  async function select(id: string) {
    selectedId = id;
    mode = 'initial';
    await tick();
    // Stacked layout (phones): bring the details into view under the list.
    if (drawer && listWrap && drawer.getBoundingClientRect().top >= listWrap.getBoundingClientRect().bottom - 1) {
      drawer.scrollIntoView({ behavior: motionOK() ? 'smooth' : 'auto', block: 'start' });
    }
  }

  async function openConfirm(id: string) {
    reasons[id] ??= data.reason;
    mode = 'confirm';
    await tick();
    reasonEl?.focus();
  }
  async function closeConfirm() {
    mode = 'initial';
    await tick();
    opener?.focus();
  }

  function showAll() {
    search = '';
    filter = 'all';
    searchEl?.focus();
  }

  const suspend: SubmitFunction = ({ formData, cancel }) => {
    if (working) return cancel();
    const id = String(formData.get('agent_id'));
    const agent = rows.find((a) => a.id === id);
    working = 'suspend';
    return async ({ result }) => {
      working = null;
      if (result.type === 'success' && agent) {
        states[id] = 'suspended';
        mode = 'initial';
        await tick();
        if (selectedId === id) heading?.focus();
        toast(`${agent.name} suspended · ${id}`);
      } else if (result.type === 'failure') {
        toast(String(result.data?.message ?? 'That didn’t work. Try again.'));
      } else {
        await applyAction(result);
      }
    };
  };

  // Admins have no relay endpoint for pausing an agent's subscriptions or revoking its keys yet, so these
  // are fixtures-only simulations (not shown in relay mode).
  async function act(kind: 'pause' | 'revoke', agent: RegistryAgent) {
    if (working || (kind === 'revoke' && revoked[agent.id])) return;
    working = kind;
    await new Promise((r) => setTimeout(r, kind === 'pause' ? 700 : 800));
    working = null;
    if (kind === 'pause') {
      const was = paused[agent.id] ?? false;
      paused[agent.id] = !was;
      toast(was ? `${agent.name}’s subscriptions resumed` : `${agent.name}’s subscriptions paused`);
    } else {
      revoked[agent.id] = true;
      toast(`${agent.name}’s keys revoked`);
    }
  }
</script>

<svelte:head><title>Agents · Logitland admin</title></svelte:head>

{#snippet status(state: RegistryState)}
  <span class={STATES[state].tag}><span class={STATES[state].dot} aria-hidden="true"></span><Morph text={STATES[state].label} /></span>
{/snippet}

<header class="a-header">
  <div class="page-head__text">
    <h1 class="h1">Agents</h1>
    <p class="t-3">{data.subtitle}</p>
  </div>
  <div class="a-tools" role="search">
    <label class="sr-only" for="a-search">Search agents</label>
    <input class="input input--sm" id="a-search" type="search" placeholder="Name, agt_ ID or owner" autocomplete="off" bind:value={search} bind:this={searchEl} />
  </div>
</header>

<main id="main" class="a-main">
  {#if data.notice}
    <section class="notice notice--wait" role="status" data-enter="0">
      <span class="dot dot--wait" aria-hidden="true"></span>
      <div class="notice__body">
        <strong class="fw-600 t-ink">{data.notice.title}</strong>
        <span>{data.notice.detail}</span>
      </div>
      <button type="button" class="btn btn--sm" id="show-unclaimed" onclick={() => (filter = 'unclaimed')}>{data.notice.action}</button>
    </section>
  {/if}

  <div class="chips" role="group" aria-label="Filter agents" data-enter="1">
    {#each CHIPS as c (c.key)}
      <button type="button" class="chip" aria-pressed={filter === c.key} onclick={() => (filter = c.key)}>{c.label} <Morph class="chip__count" text={counts[c.key]} /></button>
    {/each}
  </div>

  <div class="ag-layout" data-enter="2">
    <section class="ag-list" id="agent-list-wrap" aria-label="Agent list" bind:this={listWrap}>
      <div class="card card--flush">
        <ul class="ag-rows" id="agent-list">
          {#each visible as a (a.id)}
            <li animate:flip={FLIP} in:rise out:fold>
              <button type="button" class="ag-row flock-host" aria-pressed={a.id === selectedId} aria-controls="drawer" onclick={() => select(a.id)}>
                <span class="ag-ident">
                  <Flock id={a.id} size={36} off={a.state === 'disabled'} />
                  <span class="ag-ident__text"><strong class="t-ink fw-600">{a.name}</strong><span class="mono tiny t-3">{a.id}</span></span>
                </span>
                <span class="ag-owner"><span class="t-ink">{a.owner}</span><span class="tiny t-3">{a.joined}</span></span>
                <span class="ag-mod caption {modClass[a.mod.tone]}">{a.mod.text}</span>
                <span class="ag-status">{@render status(a.state)}</span>
              </button>
            </li>
          {/each}
        </ul>
        {#if !visible.length}
          <div class="ag-empty stack g-2" in:rise>
            <p class="t-ink fw-600">{data.copy.none}</p>
            <button type="button" class="btn btn--sm self-start" id="show-all" onclick={showAll}>Show all agents</button>
          </div>
        {/if}
      </div>
      <p class="caption t-3 ag-foot"><Morph text={showing} /> Display names aren’t unique, so rows are keyed by agent ID.</p>
    </section>

    <section class="card ag-drawer" id="drawer" aria-labelledby={sel ? `dh-${sel.id}` : undefined} bind:this={drawer}>
      {#if sel}
        {#key sel.id}
          <div class="stack g-5" in:rise>
            <div class="ag-head">
              <Flock id={sel.id} size={56} off={sel.state === 'disabled'} />
              <div class="stack g-1">
                <div class="cluster g-2">
                  <h2 class="ag-name" id="dh-{sel.id}" tabindex="-1" bind:this={heading}>{sel.name}</h2>
                  {@render status(sel.state)}
                </div>
                <span class="mono tiny t-3">{sel.id}</span>
              </div>
            </div>
            <dl class="ag-facts">
              {#each sel.facts as f (f.label)}
                <div class="stat">
                  <dt class="stat__label">{f.label}</dt>
                  <dd class="t-ink wrap-any">{#if f.key === 'keys'}<Morph text={revoked[sel.id] ? 'revoked' : f.value} />{:else}{f.value}{/if}</dd>
                </div>
              {/each}
            </dl>
            <div class="stack g-2">
              <span class="tiny t-3">Purpose, as the owner wrote it</span>
              <p class="t-2">{sel.purpose}</p>
            </div>
            {#if sel.week}
              <div class="stack g-2">
                <span class="tiny t-3">Last 7 days</span>
                <div class="ag-bar" role="img" aria-label={sel.week.caption}>
                  <span style="--w: {sel.week.widths[0].toFixed(1)}%"></span><span class="ag-bar__held" style="--w: {sel.week.widths[1].toFixed(1)}%"></span><span
                    class="ag-bar__block"
                    style="--w: {sel.week.widths[2].toFixed(1)}%"
                  ></span>
                </div>
                <span class="caption t-2">{sel.week.caption}</span>
              </div>
            {/if}
            {#if sel.state === 'active'}
              {@const agent = sel}
              <div class="ag-actions stack g-3">
                {#if mode === 'initial'}
                  <div class="cluster g-2" in:rise>
                    <button type="button" class="btn btn--sm btn--danger" bind:this={opener} onclick={() => openConfirm(agent.id)}>Suspend…</button>
                    {#if !data.live}
                      <button type="button" class="btn btn--sm" class:is-busy={working === 'pause'} aria-busy={working === 'pause' || undefined} onclick={() => act('pause', agent)}
                        ><span class="btn__spin" aria-hidden="true"></span><Morph text={paused[agent.id] ? 'Resume subscriptions' : 'Pause subscriptions'} /></button
                      >
                      <button
                        type="button"
                        class="btn btn--sm"
                        class:is-busy={working === 'revoke'}
                        aria-busy={working === 'revoke' || undefined}
                        aria-disabled={revoked[agent.id] ? 'true' : undefined}
                        onclick={() => act('revoke', agent)}><span class="btn__spin" aria-hidden="true"></span><Morph text={revoked[agent.id] ? 'Keys revoked' : 'Revoke keys'} /></button
                      >
                    {/if}
                  </div>
                {:else}
                  <form class="ag-confirm stack g-3" method="POST" action="?/suspend" use:enhance={suspend} in:rise>
                    <input type="hidden" name="agent_id" value={agent.id} />
                    <label class="label" for="reason-{agent.id}">Reason, shown to the owner</label>
                    <textarea class="textarea ag-reason" id="reason-{agent.id}" name="reason" rows="2" bind:this={reasonEl} bind:value={reasons[agent.id]}></textarea>
                    <span class="caption t-2">Rejects its keys and stops its subscriptions now. The owner’s other agents are untouched.</span>
                    <div class="cluster g-2">
                      <button type="submit" class="btn btn--sm btn--danger-fill" class:is-busy={working === 'suspend'} aria-busy={working === 'suspend' || undefined}
                        ><span class="btn__spin" aria-hidden="true"></span>Suspend {agent.name}</button
                      >
                      <button type="button" class="btn btn--sm btn--text" onclick={closeConfirm}>Cancel</button>
                    </div>
                  </form>
                {/if}
              </div>
            {/if}
            <p class="caption t-3">Suspension only covers relay access. Timeouts and bans happen in Discord, or through an admin agent using the MCP.</p>
          </div>
        {/key}
      {/if}
    </section>
  </div>
</main>

<style>
  .ag-layout {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-5);
    align-items: flex-start;
  }
  .ag-list {
    flex: 999 1 560px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .ag-drawer {
    flex: 1 1 340px;
    --gap: var(--s-5);
  }
  .ag-rows > li + li {
    border-top: 1px solid var(--line);
  }
  .ag-row {
    width: 100%;
    border: 0;
    background: transparent;
    color: var(--ink-2);
    text-align: start;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 160px 132px 112px;
    align-items: center;
    gap: var(--s-2) var(--s-5);
    padding: 14px var(--s-5);
  }
  .ag-row:hover {
    background: color-mix(in oklch, var(--sunken) 70%, transparent);
  }
  .ag-row[aria-pressed='true'] {
    background: var(--raised);
  }
  .ag-row:focus-visible {
    outline-offset: -2px;
  }
  .ag-ident {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-width: 0;
  }
  .ag-ident__text,
  .ag-owner {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .ag-mod {
    white-space: nowrap;
  }
  .ag-status {
    display: flex;
    justify-content: flex-end;
  }
  .ag-empty {
    padding: var(--s-5);
  }
  .ag-foot {
    padding-inline: var(--s-1);
  }
  .tag.is-off {
    color: var(--ink-3);
  }
  .ag-head {
    display: flex;
    align-items: center;
    gap: var(--s-4);
  }
  .ag-name {
    font-size: 18px;
    line-height: 1.3;
    font-weight: 600;
    color: var(--ink);
  }
  .ag-name:focus {
    outline: none;
  }
  .ag-facts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-4);
  }
  .ag-bar {
    display: flex;
    gap: 2px;
    height: 8px;
  }
  .ag-bar > span {
    display: block;
    flex: 0 1 var(--w);
    min-width: 0;
    border-radius: 4px;
    background: var(--quiet-mark);
  }
  .ag-bar > .ag-bar__held {
    background: var(--wait-mark);
  }
  .ag-bar > .ag-bar__block {
    background: var(--fail-mark);
  }
  .ag-actions {
    padding-top: var(--s-5);
    border-top: 1px solid var(--line);
  }
  .ag-confirm {
    padding: var(--s-4);
    border-radius: var(--r-panel);
    background: var(--fail-soft);
  }
  .ag-reason {
    min-height: 72px;
    border-color: var(--fail-line);
  }
  .btn[aria-disabled='true'] {
    opacity: 0.5;
    cursor: not-allowed;
  }
  @media (max-width: 48rem) {
    .ag-row {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--s-2) var(--s-4);
      padding: var(--s-4);
    }
    .ag-ident {
      grid-column: 1;
      grid-row: 1;
    }
    .ag-status {
      grid-column: 2;
      grid-row: 1;
    }
    .ag-owner {
      grid-column: 1;
      grid-row: 2;
      padding-inline-start: 48px;
    }
    .ag-mod {
      grid-column: 2;
      grid-row: 2;
      align-self: start;
      text-align: end;
    }
    .ag-drawer {
      padding: var(--s-5) var(--s-4);
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .ag-row .tag,
    .ag-drawer .tag,
    .ag-drawer .tag .dot,
    .ag-row .tag .dot {
      transition-property: background-color, color, box-shadow;
      transition-duration: var(--dur);
      transition-timing-function: var(--ease-out);
    }
  }
</style>
