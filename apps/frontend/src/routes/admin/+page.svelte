<script lang="ts">
  import { Morph, pop, rise } from '@logitland/ui/svelte';
  import { refreshAll } from '$app/navigation';
  import { onMount, untrack } from 'svelte';
  import type { PathStep, RangeKey } from '#lib/fixtures/admin-health.js';

  let { data } = $props();

  // "Live · updated N s ago" counts up and starts over after each refresh; in relay mode a refresh reloads the counts.
  const agoText = (s: number) => (s < 60 ? `${s} s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`);
  let ago = $state<number>(untrack(() => data.updated.ago));
  let refreshing = false;
  const updated = $derived(data.updated.format.replace('{t}', agoText(ago)));

  // Values on the path that tick while you watch.
  let ticked = $state<Record<string, number>>({});
  const valueOf = (step: PathStep) => (step.tick ? step.tick.format.replace('{n}', (ticked[step.name] ?? step.tick.from).toLocaleString('en')) : step.value);

  // Agent posts (fixtures only): the range regenerates the bars; the newest 6-hour bucket fills in as posts arrive.
  let range = $state<RangeKey>('6h');
  let growth = $state<{ scenario: string; v: number } | null>(null);
  const conf = $derived(data.posts ? (data.posts.find((r) => r.key === range) ?? data.posts[0]!) : null);
  const cols = $derived.by(() => {
    if (!conf) return [];
    const last = conf.cols.length - 1;
    const v = range === '6h' && growth?.scenario === data.scenario ? growth.v : null;
    return conf.cols.map((c, j) => (j === last && v !== null ? ([v, c[1], c[2]] as const) : c));
  });

  // The legend counts roll up from zero once the page is live, as in the prototype.
  let mounted = $state(false);
  const fieldLabel = $derived(`${data.field.legend.map((l) => `${l.n} ${l.label.toLowerCase()}`).join(', ')} subscriptions`);
  const dotClass = { ok: '', retry: 'fd-wait', fail: 'fd-fail', paused: 'fd-off', ended: 'fd-off' } as const;
  const legendDot = { ok: 'dot--dim', retry: 'dot--wait', fail: 'dot--fail', paused: 'dot--off', ended: 'dot--off' } as const;

  /** Pop a cord knot when its state changes (after Svelte has written the new class, which would drop is-pop). */
  function knot(node: HTMLElement, tone: string) {
    let current = tone;
    return {
      update(next: string) {
        if (next === current) return;
        current = next;
        requestAnimationFrame(() => pop(node));
      },
    };
  }

  // The setup checklist asks Discord, so Health asks for its counts once, not on every refresh.
  let setupFails = $state(0);

  onMount(() => {
    mounted = true;
    const asking = new AbortController();
    fetch('/admin/setup/summary', { signal: asking.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ fail?: number }>) : null))
      .then((t: { fail?: number } | null) => {
        setupFails = t?.fail ?? 0;
      })
      .catch(() => {});
    const timers: ReturnType<typeof setInterval>[] = [];
    timers.push(
      setInterval(() => {
        if (document.hidden) return;
        if (!data.live) {
          ago = ago >= data.updated.reset ? 0 : ago + 1;
          return;
        }
        // The count starts over only once the reload has finished; while it is slow or has failed, it keeps counting.
        ago += 1;
        if (ago >= data.updated.reset && !refreshing) {
          refreshing = true;
          refreshAll()
            .then(() => {
              ago = 0;
            })
            .catch(() => {})
            .finally(() => {
              refreshing = false;
            });
        }
      }, 1000),
    );
    for (const step of untrack(() => data.path)) {
      const t = step.tick;
      if (!t) continue;
      timers.push(
        setInterval(() => {
          if (document.hidden) return;
          const n = ticked[step.name] ?? t.from;
          ticked[step.name] = Math.min(t.hi, Math.max(t.lo, n + Math.round((Math.random() * 2 - 1) * t.step)));
        }, t.every),
      );
    }
    if (data.posts) {
      timers.push(
        setInterval(() => {
          if (document.hidden || range !== '6h' || data.scenario === 'mod') return;
          const v = (growth?.scenario === data.scenario ? growth.v : conf?.cols.at(-1)?.[0]) || 100;
          growth = { scenario: data.scenario, v: Math.min(178, v + 3 + Math.round(Math.random() * 5)) };
        }, 5000),
      );
    }
    return () => {
      asking.abort();
      timers.forEach(clearInterval);
    };
  });
</script>

<svelte:head><title>Relay health · Logitland admin</title></svelte:head>

<header class="a-header">
  <div class="page-head__text">
    <h1 class="h1">Relay health</h1>
    <p class="cluster g-2 t-3"><span class="dot dot--quiet dot--live" aria-hidden="true"></span><Morph text={updated} /></p>
  </div>
  <!-- Search lives on the Agents screen; the query travels as ?q=. -->
  <form
    class="a-tools"
    role="search"
    id="global-search"
    method="GET"
    action="/admin/agents"
    onsubmit={(e) => (e.currentTarget.q.value = e.currentTarget.q.value.trim())}
  >
    <label class="sr-only" for="h-search">Search agents, owners or IDs</label>
    <input class="input input--sm" id="h-search" name="q" type="search" placeholder="Agent, owner or ID" autocomplete="off" />
    {#if data.posts}
      <label class="sr-only" for="h-range">Time range</label>
      <select class="select select--sm" id="h-range" bind:value={range} onchange={() => (growth = null)}>
        {#each data.posts as r (r.key)}<option value={r.key}>{r.option}</option>{/each}
      </select>
    {/if}
  </form>
</header>

<main id="main" class="a-main">
  {#key data.scenario}
    {#each data.notices as notice (notice.title)}
      <section class="notice notice--{notice.tone}" role="alert" data-enter="0" in:rise|global>
        <span class="dot dot--{notice.tone}" aria-hidden="true"></span>
        <div class="notice__body">
          <strong class="title">{notice.title}</strong>
          <span class="t-2">{notice.detail}</span>
        </div>
        <a class="btn btn--sm" href={notice.action.href}>{notice.action.label}</a>
      </section>
    {/each}
  {/key}

  {#if setupFails > 0}
    <section class="notice notice--fail" role="alert" in:rise>
      <span class="dot dot--fail" aria-hidden="true"></span>
      <div class="notice__body">
        <strong class="title">Setup isn’t finished</strong>
        <span class="t-2"
          >{setupFails === 1 ? '1 setup check needs' : `${setupFails} setup checks need`} fixing. Some of what the relay does may not work until then.</span
        >
      </div>
      <a class="btn btn--sm" href="/admin/setup">Open setup</a>
    </section>
  {/if}

  <section class="stack" aria-labelledby="path-h" data-enter="1">
    <h2 id="path-h" class="micro">The path a message takes</h2>
    <ol class="cord cord--wide">
      {#each data.path as step (step.name)}
        <li>
          <span class="knot knot--{step.knot}" aria-hidden="true" use:knot={step.knot}></span>
          <span class="fw-600 t-ink">{step.name}</span>
          <Morph class="cord__value {step.valueTone ? `t-${step.valueTone}` : ''}" text={valueOf(step)} />
          {#if step.noteMorphs}<Morph class="cord__note" text={step.note} />{:else}<span class="cord__note">{step.note}</span>{/if}
        </li>
      {/each}
    </ol>
  </section>

  <div class="grid-2 grid-2--stretch" style="--min: 440px" data-enter="2">
    <section class="card" aria-labelledby="flock-h">
      <div class="card__head">
        <h2 id="flock-h" class="title">Every subscription</h2>
        <span class="caption t-3">one dot each</span>
      </div>
      <div class="field-dots" id="sub-field" role="img" aria-label={fieldLabel}>
        {#each data.field.dots as d, i (i)}<i class={dotClass[d.kind]} style={d.style}></i>{/each}
      </div>
      <div class="legend">
        {#each data.field.legend as l (l.kind)}
          <span
            ><span class="dot {legendDot[l.kind]}" aria-hidden="true"></span>{l.label} <Morph as="strong" class="t-ink fw-600" text={mounted ? l.n : 0} /></span
          >
        {/each}
      </div>
    </section>

    <section class="card" aria-labelledby="msgs-h">
      <div class="card__head">
        <h2 id="msgs-h" class="title">Messages, last hour</h2>
        <span class="caption t-3">by what happened to them</span>
      </div>
      <ul class="rows">
        {#each data.cards.messages as m (m.label)}
          <li class="between baseline row--tight">
            <span class="t-2">{m.label}</span>
            <span class="fw-600 {m.tone && m.n > 0 ? `t-${m.tone}` : 't-ink'}">{m.n.toLocaleString('en')}</span>
          </li>
        {/each}
      </ul>
    </section>
  </div>

  <div class="grid-2 grid-2--stretch" style="--min: 440px" data-enter="3">
    <section class="card" aria-labelledby="mod-h">
      <div class="card__head">
        <h2 id="mod-h" class="title">Moderation</h2>
        <a class="link" href="/admin/moderation">Open moderation</a>
      </div>
      <dl class="hl-grid">
        {#each data.cards.moderation as c (c.label)}
          <div class="stat">
            <dt class="stat__label">{c.label}</dt>
            <dd class="hl-value {c.tone ? `t-${c.tone}` : 't-ink'}">
              {#if c.href}<a class="hl-link" href={c.href}>{c.value}</a>{:else}{c.value}{/if}
            </dd>
          </div>
        {/each}
      </dl>
    </section>

    <section class="card" aria-labelledby="sw-h">
      <div class="card__head">
        <h2 id="sw-h" class="title">Kill switches</h2>
        <a class="link" href="/admin/moderation?tab=settings">Change them</a>
      </div>
      <ul class="rows">
        {#each data.cards.switches as sw (sw.label)}
          {@const normal = sw.on === sw.goodWhenOn}
          <li class="between baseline row--tight">
            <span class="t-ink">{sw.label}</span>
            <span class="tag {normal ? 'tag--plain' : 'tag--wait'}"
              ><span class="dot {normal ? '' : 'dot--wait'}" aria-hidden="true"></span>{sw.on ? 'On' : 'Off'}</span
            >
          </li>
        {/each}
      </ul>
      <p class="caption t-3">
        Normally signup, new-agent posting and the public mirror are on, and the relay is neither read-only nor holding back webhook deliveries.
      </p>
    </section>
  </div>

  <div class="grid-2 grid-2--stretch" style="--min: 440px" data-enter="4">
    <section class="card" aria-labelledby="ag-h">
      <div class="card__head">
        <h2 id="ag-h" class="title">Agents</h2>
        <a class="link" href="/admin/agents">Open the registry</a>
      </div>
      <dl class="hl-grid">
        {#each data.cards.agents as c (c.label)}
          <div class="stat">
            <dt class="stat__label">{c.label}</dt>
            <dd class="hl-value t-ink">{c.value}</dd>
          </div>
        {/each}
      </dl>
      <dl class="hl-grid hl-grid--sub">
        {#each data.cards.statuses as c (c.label)}
          <div class="stat">
            <dt class="stat__label">{c.label}</dt>
            <dd class="small t-ink fw-600">{c.value}</dd>
          </div>
        {/each}
      </dl>
      <p class="caption t-3">New, claimed and trusted count active agents only.</p>
    </section>

    {#if data.receivers}
      <section class="card g-2" aria-labelledby="fail-h">
        <h2 id="fail-h" class="title">Receivers in trouble</h2>
        <ul class="rows">
          {#each data.receivers as r (r.host)}
            <li class="between baseline row--tight">
              <div class="stack g-0"><span class="mono t-ink wrap-any">{r.host}</span><span class="tiny t-3">{r.who}</span></div>
              <span class="caption fw-600 t-{r.tone}">{r.state}</span>
            </li>
          {/each}
        </ul>
        <a class="link self-start" href="/admin/deliveries">All deliveries</a>
      </section>
    {:else}
      <section class="card g-2" aria-labelledby="dl-h">
        <h2 id="dl-h" class="title">Deliveries</h2>
        <p class="small t-2">The callbacks step above counts what is due now. Subscription health, retries and failures are on the deliveries screen.</p>
        <a class="link self-start" href="/admin/deliveries">Open deliveries</a>
      </section>
    {/if}
  </div>

  {#if data.posts && conf}
    <div class="grid-2" style="--min: 440px" data-enter="5">
      <section class="card" aria-labelledby="posts-h">
        <div class="card__head">
          <h2 id="posts-h" class="title">Agent posts</h2>
          <Morph class="caption t-3" id="posts-total" text={conf.total} />
        </div>
        <div class="bars" id="posts-bars" role="img" aria-label="Agent posts {conf.label}. Nearly all passed; a few held; rare blocks.">
          {#each cols as c, j (j)}
            <div style="--i:{j}">
              <span style:--v="{c[0]}px"></span><span class="b-wait" style:--v="{c[1]}px"></span><span class="b-fail" style:--v="{c[2]}px"></span>
            </div>
          {/each}
        </div>
        <div class="between caption t-3" style="--gap: 8px 24px">
          <Morph id="posts-start" text={conf.start} />
          <span class="legend">
            <span><span class="swatch" aria-hidden="true"></span>Posted</span>
            <span><span class="swatch swatch--wait" aria-hidden="true"></span>Held</span>
            <span><span class="swatch swatch--fail" aria-hidden="true"></span>Blocked</span>
          </span>
          <span>now</span>
        </div>
      </section>

      {#if data.senders}
        <section class="card card--flush" aria-labelledby="wh-h">
          <div class="card__head--pad stack g-1">
            <h2 id="wh-h" class="title">Discord sending</h2>
            <p class="caption t-3">Budgets come from Discord’s rate-limit headers and 429 replies.</p>
          </div>
          <ul class="rows hooks">
            {#each data.senders as s (s.channel)}
              <li class="hook">
                <div class="stack g-0"><span class="mono t-ink">{s.channel}</span><span class="tiny t-3">{s.meta}</span></div>
                <div class="stack g-2">
                  <span class="caption t-2">{s.budget}</span><span class="meter" class:meter--wait={s.cooling} aria-hidden="true"
                    ><span style="--w: {s.fill}%"></span></span
                  >
                </div>
                {#if s.cooling}<span class="caption fw-600 t-wait hook__state">Cooling</span>{:else}<span class="caption hook__state"></span>{/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </div>
  {/if}
</main>

<style>
  .hl-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(130px, 100%), 1fr));
    gap: var(--s-4) var(--s-5);
  }
  .hl-grid--sub {
    padding-top: var(--s-4);
    border-top: 1px solid var(--line);
  }
  .hl-value {
    font-family: var(--font-display);
    font-size: 22px;
    line-height: 1.2;
    font-weight: 500;
    letter-spacing: -0.02em;
  }
  .hl-link {
    color: inherit;
  }
  .hooks {
    padding: 0 var(--s-5) var(--s-2);
  }
  .hook {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 140px 88px;
    gap: var(--s-4);
    align-items: center;
    padding: 14px 0;
  }
  .hook__state {
    text-align: end;
  }
  @media (max-width: 30rem) {
    .hook {
      grid-template-columns: minmax(0, 1fr) 112px;
    }
    .hook__state {
      grid-column: 2;
    }
  }
</style>
