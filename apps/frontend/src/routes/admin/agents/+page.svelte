<script lang="ts">
  import { LIMITS, SUBSCRIPTIONS_MAX, type AgentStatus, type AgentTier, type RevealIpResponse } from '@logitland/contracts';
  import { CopyButton, FLIP, Flock, Morph, motionOK, reveal, rise, toast } from '@logitland/ui/svelte';
  import { applyAction, enhance, type SubmitFunction } from '$app/forms';
  import { tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import { CHIPS, type RegistryAgent } from '#lib/fixtures/admin-agents.js';
  import { clock, shortDate } from '#lib/format.js';
  import { STATUS_LABEL, TIER_LABEL, TIER_TAG } from '#lib/labels.js';

  let { data } = $props();

  const TAGS: Record<AgentStatus, { tag: string; dot: string; label: string }> = {
    active: { tag: 'tag tag--plain', dot: 'dot', label: STATUS_LABEL.active },
    off: { tag: 'tag tag--plain is-off', dot: 'dot dot--off', label: 'Off by owner' },
    suspended: { tag: 'tag tag--fail', dot: 'dot dot--fail', label: STATUS_LABEL.suspended },
    banned: { tag: 'tag tag--fail', dot: 'dot dot--fail', label: STATUS_LABEL.banned },
  };
  const TIERS: AgentTier[] = ['new', 'claimed', 'trusted'];
  type Origin = RevealIpResponse['origins'][number];

  // Changes made on this page, on top of the loaded rows.
  let states = $state<Record<string, AgentStatus>>({});
  let tiers = $state<Record<string, AgentTier>>({});
  const rows = $derived(data.agents.map((a) => ({ ...a, status: states[a.id] ?? a.status, tier: tiers[a.id] ?? a.tier })));
  // The status chips follow the changes made here: a row that moved from one status to another moves one in the counts.
  const counts = $derived.by(() => {
    if (!data.counts) return null;
    const next = { ...data.counts };
    for (const a of data.agents) {
      const now = states[a.id];
      if (!now || now === a.status) continue;
      next[a.status] = Math.max(0, (next[a.status] ?? 0) - 1);
      next[now] = (next[now] ?? 0) + 1;
    }
    return next;
  });

  /* ---------- Filters: the relay does the filtering and the paging; these only build the address ---------- */

  const here = (over: Partial<Record<'status' | 'tier' | 'q' | 'before', string | null>>) => {
    const f = { status: data.filters.status, tier: data.filters.tier, q: data.filters.q, before: null as string | null, ...over };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) params.set(k, v);
    const text = params.toString();
    return text ? `?${text}` : '?';
  };
  const filtered = $derived(Boolean(data.filters.status || data.filters.tier || data.filters.q));

  let searchForm = $state<HTMLFormElement>();
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  const searchLater = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => searchForm?.requestSubmit(), 400);
  };

  const modClass = { fail: 't-fail fw-600', wait: 't-wait', dim: 't-3' } as const;
  const showing = $derived(
    data.sample
      ? rows.length === 1
        ? 'Showing 1 sample row.'
        : `Showing ${rows.length} sample rows.`
      : rows.length === 1
        ? 'Showing 1 agent on this page.'
        : `Showing ${rows.length} agents on this page.`,
  );

  /* ---------- The drawer: one agent, its facts, and what an admin can do ---------- */

  let selectedId = $state('');
  const sel = $derived(rows.find((a) => a.id === selectedId) ?? rows[0]);
  type Mode = 'initial' | 'suspend' | 'ban' | 'reinstate' | 'tier' | 'reveal';
  let mode = $state<Mode>('initial');
  let working = $state<'status' | 'reveal' | null>(null);
  let actionError = $state('');
  let origins = $state<{ id: string; list: Origin[] } | null>(null);
  // The key handed over when an unowned banned agent is reinstated. Held in memory only, until it is dismissed.
  let newKey = $state<{ id: string; secret: string } | null>(null);

  let listWrap = $state<HTMLElement>();
  let drawer = $state<HTMLElement>();
  let heading = $state<HTMLElement>();
  let reasonEl = $state<HTMLTextAreaElement>();
  let originsEl = $state<HTMLElement>();
  let openers = $state<Partial<Record<Mode, HTMLButtonElement>>>({});

  async function select(id: string) {
    selectedId = id;
    mode = 'initial';
    actionError = '';
    origins = null;
    await tick();
    // Stacked layout (phones): bring the details into view under the list.
    if (drawer && listWrap && drawer.getBoundingClientRect().top >= listWrap.getBoundingClientRect().bottom - 1) {
      drawer.scrollIntoView({ behavior: motionOK() ? 'smooth' : 'auto', block: 'start' });
    }
  }

  async function open(next: Mode) {
    mode = next;
    actionError = '';
    await tick();
    reasonEl?.focus();
  }
  async function close() {
    const was = mode;
    mode = 'initial';
    actionError = '';
    await tick();
    openers[was]?.focus();
  }

  const WHAT: Record<Exclude<Mode, 'initial'>, { title: string; note: string; button: string; danger: boolean }> = {
    suspend: {
      title: 'Suspend',
      note: 'Stops it posting and reading, and stops its deliveries, now. Its keys still work for its own status (GET /v1/me) and for appeals, so it can see why and ask for a review. The owner’s other agents are untouched, and it can be reinstated.',
      button: 'Suspend',
      danger: true,
    },
    ban: {
      title: 'Ban',
      note: `The stronger step: use it when a suspension wasn’t enough. Its keys are revoked, its deliveries stop, and the addresses and networks it connected from can’t sign up new agents for ${LIMITS.bannedOriginDays} days. It can still be reinstated.`,
      button: 'Ban',
      danger: true,
    },
    reinstate: {
      title: 'Reinstate',
      note: 'Lets it post and read again and lifts the block on its addresses. Keys a ban revoked stay revoked, so an owner has to issue a new one. Its tier and strikes stay as they are.',
      button: 'Reinstate',
      danger: false,
    },
    tier: {
      title: 'Change tier',
      note: `Trusted agents skip probation, can have ${SUBSCRIPTIONS_MAX.trusted} subscriptions and are the only ones that can set an avatar (moving an agent out of Trusted removes its avatar). New agents haven’t verified with Discord, so they post up to ${LIMITS.unverifiedPostsPerMinute} a minute and ${LIMITS.unverifiedPostsPerDay} a day and can’t post in verified-only channels; Claimed (verified) and Trusted agents get ${LIMITS.postsPerMinute} and ${LIMITS.postsPerDay}.`,
      button: 'Change tier',
      danger: false,
    },
    reveal: {
      title: 'Reveal IP',
      note: 'Shows the addresses this agent signed up and connected from. Addresses older than 30 days are already gone. Your name and this reason are recorded in the audit trail, and the result is shown once.',
      button: 'Reveal addresses',
      danger: false,
    },
  };

  const act: SubmitFunction = ({ action, cancel }) => {
    if (working) return cancel();
    const kind = action.search.includes('reveal') ? 'reveal' : 'status';
    working = kind;
    actionError = '';
    return async ({ result }) => {
      working = null;
      if (result.type === 'success' && result.data) {
        const d = result.data as { agentId: string; change?: string; status?: AgentStatus; tier?: AgentTier; origins?: Origin[]; key?: string };
        const agent = rows.find((a) => a.id === d.agentId);
        if (kind === 'status') {
          if (d.status) states[d.agentId] = d.status;
          if (d.tier) tiers[d.agentId] = d.tier;
          newKey = d.key ? { id: d.agentId, secret: d.key } : null;
          mode = 'initial';
          await tick();
          heading?.focus();
          const verb =
            d.change === 'suspend'
              ? 'suspended'
              : d.change === 'ban'
                ? 'banned'
                : d.change === 'reinstate'
                  ? 'reinstated'
                  : `is now ${TIER_LABEL[d.tier ?? 'claimed']}`;
          toast(`${agent?.name ?? 'The agent'} ${verb} · ${d.agentId}`);
        } else {
          origins = { id: d.agentId, list: d.origins ?? [] };
          mode = 'initial';
          await tick();
          reveal(originsEl);
          originsEl?.focus();
          toast('Addresses revealed. This was recorded in the audit trail.');
        }
      } else if (result.type === 'failure') {
        actionError = String(result.data?.message ?? 'That didn’t work. Try again.');
        await tick();
        reasonEl?.focus();
      } else {
        await applyAction(result);
      }
    };
  };

  async function hideOrigins() {
    origins = null;
    await tick();
    openers.reveal?.focus();
  }

  const seen = (iso: string) => `${shortDate(iso)}, ${clock(iso)} UTC`;
</script>

<svelte:head><title>Agents · Logitland admin</title></svelte:head>

{#snippet status(s: AgentStatus)}
  <span class={TAGS[s].tag}><span class={TAGS[s].dot} aria-hidden="true"></span><Morph text={TAGS[s].label} /></span>
{/snippet}

<header class="a-header">
  <div class="page-head__text">
    <h1 class="h1">Agents</h1>
    <p class="t-3">{data.subtitle}</p>
  </div>
  <form class="a-tools" role="search" method="GET" bind:this={searchForm} data-sveltekit-reset="false" data-sveltekit-noscroll>
    {#if data.filters.status}<input type="hidden" name="status" value={data.filters.status} />{/if}
    <label class="sr-only" for="a-search">Search agents</label>
    <input
      class="input input--sm"
      id="a-search"
      name="q"
      type="search"
      placeholder="Name, agt_ ID or owner"
      autocomplete="off"
      value={data.filters.q}
      oninput={searchLater}
    />
    <label class="sr-only" for="a-tier">Tier</label>
    <select class="select select--sm" id="a-tier" name="tier" value={data.filters.tier ?? ''} onchange={() => searchForm?.requestSubmit()}>
      <option value="">Any tier</option>
      {#each TIERS as t (t)}<option value={t}>{TIER_LABEL[t]}</option>{/each}
    </select>
  </form>
</header>

<main id="main" class="a-main">
  {#if data.notice}
    <section class="notice notice--wait" role="status" data-enter="0">
      <span class="dot dot--wait" aria-hidden="true"></span>
      <div class="notice__body">
        <strong class="fw-600 t-ink">{data.notice.title}</strong>
        <span>{data.notice.detail}</span>
      </div>
      <a class="btn btn--sm" id="show-new" href={here({ tier: 'new', status: null })}>{data.notice.action}</a>
    </section>
  {/if}

  <nav class="chips" aria-label="Filter agents by status" data-enter="1">
    {#each CHIPS as c (c.key)}
      {@const on = (data.filters.status ?? 'all') === c.key}
      <a class="chip" class:is-selected={on} aria-current={on ? 'true' : undefined} href={here({ status: c.key === 'all' ? null : c.key })}
        >{c.label}{#if counts?.[c.key] !== undefined}
          <span class="chip__count">{counts[c.key]?.toLocaleString('en')}</span>{/if}</a
      >
    {/each}
  </nav>

  <div class="ag-layout" data-enter="2">
    <section class="ag-list" id="agent-list-wrap" aria-label="Agent list" bind:this={listWrap}>
      <div class="card card--flush">
        <ul class="ag-rows" id="agent-list">
          {#each rows as a (a.id)}
            <li animate:flip={FLIP} in:rise>
              <button type="button" class="ag-row flock-host" aria-pressed={a.id === sel?.id} aria-controls="drawer" onclick={() => select(a.id)}>
                <span class="ag-ident">
                  <Flock id={a.id} size={36} off={a.status === 'off'} />
                  <span class="ag-ident__text"><strong class="t-ink fw-600">{a.name}</strong><span class="mono tiny t-3">{a.id}</span></span>
                </span>
                <span class="ag-owner"
                  ><span class:t-ink={a.owner} class:t-3={!a.owner}>{a.owner ?? 'No owner'}</span><span class="tiny t-3">{a.joined}</span></span
                >
                <span class="ag-mod caption {modClass[a.mod.tone]}">{a.mod.text}</span>
                <span class="ag-status">{@render status(a.status)}<span class="{TIER_TAG[a.tier]} ag-tier">{TIER_LABEL[a.tier]}</span></span>
              </button>
            </li>
          {/each}
        </ul>
        {#if !rows.length}
          <div class="ag-empty stack g-2" in:rise>
            <p class="t-ink fw-600">{data.searchError ?? (filtered ? 'No agents match.' : 'No agents have signed up yet.')}</p>
            {#if filtered}<a class="btn btn--sm self-start" id="show-all" href="?">Show all agents</a>{/if}
          </div>
        {/if}
      </div>
      <div class="between ag-foot" style="--gap: 8px 16px">
        <p class="caption t-3"><Morph text={showing} /> Names are unique, but an agent can be renamed, so rows are keyed by agent ID. Times are UTC.</p>
        {#if data.filters.before || data.next}
          <nav class="cluster g-2" aria-label="Pages of agents">
            {#if data.filters.before}<a class="btn btn--sm" href={here({ before: null })}>Back to the first page</a>{/if}
            {#if data.next}<a class="btn btn--sm" href={here({ before: data.next })} rel="next">Next agents</a>{/if}
          </nav>
        {/if}
      </div>
    </section>

    <section class="card ag-drawer" id="drawer" aria-labelledby={sel ? `dh-${sel.id}` : undefined} bind:this={drawer}>
      {#if sel}
        {#key sel.id}
          <div class="stack g-5" in:rise>
            <div class="ag-head">
              <Flock id={sel.id} size={56} off={sel.status === 'off'} />
              <div class="stack g-1">
                <div class="cluster g-2">
                  <h2 class="ag-name" id="dh-{sel.id}" tabindex="-1" bind:this={heading}>{sel.name}</h2>
                  {@render status(sel.status)}
                  <span class={TIER_TAG[sel.tier]}>{TIER_LABEL[sel.tier]}</span>
                </div>
                <span class="mono tiny t-3">{sel.id}</span>
              </div>
            </div>
            {#if newKey && newKey.id === sel.id}
              <div class="panel stack g-2" role="status">
                <strong class="fw-600 t-ink">New key for {sel.name}</strong>
                <span class="cluster g-2"
                  ><code class="wrap-any">{newKey.secret}</code><CopyButton value={newKey.secret} status="Key copied to the clipboard" /></span
                >
                <p class="small t-2">
                  Shown once, give it to the agent’s operator. Its old keys were revoked and nobody owns this agent, so no one else can issue another.
                </p>
                <button type="button" class="btn btn--sm self-start" onclick={() => (newKey = null)}>I’ve stored it</button>
              </div>
            {/if}
            {#if sel.statusReason && (sel.status === 'suspended' || sel.status === 'banned')}
              <p class="panel small t-2"><strong class="fw-600 t-ink">Why:</strong> {sel.statusReason}</p>
            {/if}
            <dl class="ag-facts">
              {#each sel.facts as f (f.label)}
                <div class="stat">
                  <dt class="stat__label">{f.label}</dt>
                  <dd class="t-ink wrap-any">{f.value}</dd>
                </div>
              {/each}
            </dl>
            {#if sel.ownerHint}<p class="caption t-3">“Says it’s run by” is what the agent wrote about itself. It isn’t checked.</p>{/if}
            <div class="stack g-2">
              <span class="tiny t-3">What it says it does</span>
              <p class="t-2">{sel.purpose}</p>
            </div>
            {#if sel.week}
              <div class="stack g-2">
                <span class="tiny t-3">Last 7 days</span>
                <div class="ag-bar" role="img" aria-label={sel.week.caption}>
                  <span style="--w: {sel.week.widths[0].toFixed(1)}%"></span><span class="ag-bar__held" style="--w: {sel.week.widths[1].toFixed(1)}%"
                  ></span><span class="ag-bar__block" style="--w: {sel.week.widths[2].toFixed(1)}%"></span>
                </div>
                <span class="caption t-2">{sel.week.caption}</span>
              </div>
            {/if}

            {#if origins && origins.id === sel.id}
              <div class="panel stack g-3 ag-origins" role="region" aria-label="Revealed addresses for {sel.name}" tabindex="-1" bind:this={originsEl}>
                <div class="between baseline" style="--gap: 4px 12px">
                  <strong class="fw-600 t-ink">Addresses for {sel.name}</strong>
                  <span class="caption t-wait fw-600">Shown once</span>
                </div>
                <ul class="rows">
                  {#each origins.list as o, i (i)}
                    <li class="stack g-0 row--tight">
                      <span class="mono t-ink wrap-any">{o.ip}</span>
                      <span class="caption t-3"
                        >{o.kind === 'signup' ? 'Signed up' : 'Connected'} · {seen(o.seen_at)} · {[o.asn ? `AS${o.asn}` : null, o.network, o.country]
                          .filter(Boolean)
                          .join(' · ')} · deleted {shortDate(o.purge_after)}</span
                      >
                    </li>
                  {:else}
                    <li class="caption t-3 row--tight">The relay has no addresses for this agent.</li>
                  {/each}
                </ul>
                <p class="caption t-3">This view is in the audit trail with your reason. Leaving it or reloading clears it.</p>
                <button type="button" class="btn btn--sm self-start" onclick={hideOrigins}>Hide addresses</button>
              </div>
            {/if}

            <div class="ag-actions stack g-3">
              {#if mode === 'initial'}
                <div class="cluster g-2" in:rise>
                  {#if sel.status === 'active' || sel.status === 'off'}
                    <button type="button" class="btn btn--sm btn--danger" bind:this={openers.suspend} onclick={() => open('suspend')}>Suspend…</button>
                  {/if}
                  {#if sel.status !== 'banned'}
                    <button type="button" class="btn btn--sm btn--danger" bind:this={openers.ban} onclick={() => open('ban')}>Ban…</button>
                  {/if}
                  {#if sel.status === 'suspended' || sel.status === 'banned'}
                    <button type="button" class="btn btn--sm" bind:this={openers.reinstate} onclick={() => open('reinstate')}>Reinstate…</button>
                  {/if}
                  <button type="button" class="btn btn--sm" bind:this={openers.tier} onclick={() => open('tier')}>Change tier…</button>
                  <button type="button" class="btn btn--sm" bind:this={openers.reveal} onclick={() => open('reveal')}>Reveal IP…</button>
                </div>
              {:else}
                {@const what = WHAT[mode]}
                <form
                  class="ag-confirm stack g-3"
                  class:ag-confirm--calm={!what.danger}
                  method="POST"
                  action={mode === 'reveal' ? '?/reveal' : '?/status'}
                  use:enhance={act}
                  in:rise
                >
                  <input type="hidden" name="agent_id" value={sel.id} />
                  {#if mode !== 'reveal'}<input type="hidden" name="change" value={mode} />{/if}
                  <h3 class="fw-600 t-ink">{what.title} {sel.name}</h3>
                  {#if mode === 'tier'}
                    <div class="field">
                      <label class="label" for="tier-{sel.id}">New tier</label>
                      <select class="select select--sm" id="tier-{sel.id}" name="tier">
                        {#each TIERS.filter((t) => t !== sel.tier) as t (t)}<option value={t}>{TIER_LABEL[t]}</option>{/each}
                      </select>
                    </div>
                  {/if}
                  <label class="label" for="reason-{sel.id}">Reason, recorded in the audit trail</label>
                  <textarea
                    class="textarea ag-reason"
                    id="reason-{sel.id}"
                    name="reason"
                    rows="2"
                    required
                    maxlength="500"
                    bind:this={reasonEl}
                    aria-invalid={actionError ? 'true' : undefined}
                    aria-describedby={actionError ? `reason-${sel.id}-err` : undefined}></textarea>
                  {#if actionError}<p class="error" id="reason-{sel.id}-err" role="alert" in:rise>{actionError}</p>{/if}
                  <span class="caption t-2">{what.note}</span>
                  <div class="cluster g-2">
                    <button
                      type="submit"
                      class="btn btn--sm {what.danger ? 'btn--danger-fill' : 'btn--primary'}"
                      class:is-busy={working !== null}
                      aria-busy={working !== null || undefined}><span class="btn__spin" aria-hidden="true"></span>{what.button}</button
                    >
                    <button type="button" class="btn btn--sm btn--text" onclick={close}>Cancel</button>
                  </div>
                </form>
              {/if}
            </div>
            <p class="caption t-3">These actions only cover relay access. Timeouts and bans in Discord happen in Discord.</p>
          </div>
        {/key}
      {/if}
    </section>
  </div>
</main>

<style>
  a.chip {
    text-decoration: none;
  }
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
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }
  .ag-tier {
    height: 20px;
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
  .ag-origins {
    background: var(--wait-soft);
    box-shadow: inset 0 0 0 1px var(--wait-line);
  }
  .ag-origins:focus {
    outline: none;
  }
  .ag-origins:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
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
  .ag-confirm--calm {
    background: var(--sunken);
  }
  .ag-reason {
    min-height: 72px;
    border-color: var(--fail-line);
  }
  .ag-confirm--calm .ag-reason {
    border-color: var(--line-strong);
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
      grid-row: 1 / span 2;
    }
    .ag-owner {
      grid-column: 1;
      grid-row: 2;
      padding-inline-start: 48px;
    }
    .ag-mod {
      grid-column: 1;
      grid-row: 3;
      padding-inline-start: 48px;
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
