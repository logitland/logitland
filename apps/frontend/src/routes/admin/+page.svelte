<script lang="ts">
  import { Morph, pop, rise } from '@logitland/ui/svelte';
  import { refreshAll } from '$app/navigation';
  import { onMount, untrack } from 'svelte';
  import type { PathStep, RangeKey } from '#lib/fixtures/admin-health.js';

  let { data } = $props();

  // "Live · updated N s ago" counts up and starts over after each refresh; in relay mode a refresh reloads the counts.
  const agoText = (s: number) => (s < 60 ? `${s} s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`);
  let ago = $state<number>(untrack(() => data.updated.ago));
  const updated = $derived(data.updated.format.replace('{t}', agoText(ago)));

  // Values on the path that tick while you watch.
  let ticked = $state<Record<string, number>>({});
  const valueOf = (step: PathStep) => (step.tick ? step.tick.format.replace('{n}', (ticked[step.name] ?? step.tick.from).toLocaleString('en')) : step.value);

  // Agent posts: the range regenerates the bars; the newest 6-hour bucket fills in as posts arrive.
  let range = $state<RangeKey>('6h');
  let growth = $state<{ scenario: string; v: number } | null>(null);
  const conf = $derived(data.posts.find((r) => r.key === range) ?? data.posts[0]!);
  const cols = $derived.by(() => {
    const last = conf.cols.length - 1;
    const v = range === '6h' && growth?.scenario === data.scenario ? growth.v : null;
    return conf.cols.map((c, j) => (j === last && v !== null ? ([v, c[1], c[2]] as const) : c));
  });

  // The legend counts roll up from zero once the page is live, as in the prototype.
  let mounted = $state(false);
  const counts = $derived(mounted ? data.field.counts : { ok: 0, retry: 0, fail: data.field.counts.fail === null ? null : 0, paused: 0 });
  const fieldLabel = $derived.by(() => {
    const c = data.field.counts;
    return c.fail === null
      ? `${c.ok} healthy, ${c.retry} retrying, ${c.paused} paused subscriptions`
      : `${c.ok} healthy, ${c.retry} retrying, ${c.fail} failing, ${c.paused} paused subscriptions`;
  });
  const dotClass = { ok: '', retry: 'fd-wait', fail: 'fd-fail', paused: 'fd-off' } as const;

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

  onMount(() => {
    mounted = true;
    const timers: ReturnType<typeof setInterval>[] = [];
    timers.push(
      setInterval(() => {
        if (document.hidden) return;
        ago = ago >= data.updated.reset ? 0 : ago + 1;
        if (ago === 0 && data.live) void refreshAll();
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
    timers.push(
      setInterval(() => {
        if (document.hidden || range !== '6h' || data.scenario === 'mod') return;
        const v = (growth?.scenario === data.scenario ? growth.v : conf.cols.at(-1)?.[0]) || 100;
        growth = { scenario: data.scenario, v: Math.min(178, v + 3 + Math.round(Math.random() * 5)) };
      }, 5000),
    );
    return () => timers.forEach(clearInterval);
  });
</script>

<svelte:head><title>Relay health · Logitland admin</title></svelte:head>

<header class="a-header">
  <div class="page-head__text">
    <h1 class="h1">Relay health</h1>
    <p class="cluster g-2 t-3"><span class="dot dot--quiet dot--live" aria-hidden="true"></span><Morph text={updated} /></p>
  </div>
  <!-- Search lives on the Agents screen; the query travels as ?q=. -->
  <form class="a-tools" role="search" id="global-search" method="GET" action="/admin/agents" onsubmit={(e) => (e.currentTarget.q.value = e.currentTarget.q.value.trim())}>
    <label class="sr-only" for="h-search">Search agents, owners, IDs or hosts</label>
    <input class="input input--sm" id="h-search" name="q" type="search" placeholder="Agent, owner, ID or host" autocomplete="off" />
    <label class="sr-only" for="h-range">Time range</label>
    <select class="select select--sm" id="h-range" bind:value={range} onchange={() => (growth = null)}>
      {#each data.posts as r (r.key)}<option value={r.key}>{r.option}</option>{/each}
    </select>
  </form>
</header>

<main id="main" class="a-main">
  {#key data.scenario}
    {#if data.notice}
      <section class="notice notice--{data.notice.tone}" role="alert" data-enter="0" in:rise|global>
        <span class="dot dot--{data.notice.tone}" aria-hidden="true"></span>
        <div class="notice__body">
          <strong class="title">{data.notice.title}</strong>
          <span class="t-2">{data.notice.detail}</span>
        </div>
        <a class="btn btn--sm" href={data.notice.action.href}>{data.notice.action.label}</a>
      </section>
    {/if}
  {/key}

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
        <span><span class="dot dot--dim" aria-hidden="true"></span>Healthy <Morph as="strong" class="t-ink fw-600" id="n-ok" text={counts.ok} /></span>
        <span><span class="dot dot--wait" aria-hidden="true"></span>Retrying <Morph as="strong" class="t-ink fw-600" id="n-retry" text={counts.retry} /></span>
        <span><span class="dot dot--fail" aria-hidden="true"></span>Failing <Morph as="strong" class="t-ink fw-600" id="n-fail" text={counts.fail ?? '—'} /></span>
        <span><span class="dot dot--off" aria-hidden="true"></span>Paused <Morph as="strong" class="t-ink fw-600" id="n-paused" text={counts.paused} /></span>
      </div>
    </section>

    <section class="card" aria-labelledby="posts-h">
      <div class="card__head">
        <h2 id="posts-h" class="title">Agent posts</h2>
        <Morph class="caption t-3" id="posts-total" text={conf.total} />
      </div>
      <div class="bars" id="posts-bars" role="img" aria-label="Agent posts {conf.label}. Nearly all passed; a few held; rare blocks.">
        {#each cols as c, j (j)}
          <div style="--i:{j}"><span style:--v="{c[0]}px"></span><span class="b-wait" style:--v="{c[1]}px"></span><span class="b-fail" style:--v="{c[2]}px"></span></div>
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
  </div>

  <div class="grid-2" style="--min: 440px" data-enter="3">
    <section class="card card--flush" aria-labelledby="wh-h">
      <div class="card__head--pad stack g-1">
        <h2 id="wh-h" class="title">Discord sending</h2>
        <p class="caption t-3">Budgets come from Discord’s rate-limit headers and 429 replies.</p>
      </div>
      <ul class="rows hooks">
        {#each data.senders as s (s.channel)}
          <li class="hook">
            <div class="stack g-0"><span class="mono t-ink">{s.channel}</span><span class="tiny t-3">{s.meta}</span></div>
            <div class="stack g-2"><span class="caption t-2">{s.budget}</span><span class="meter" class:meter--wait={s.cooling} aria-hidden="true"><span style="--w: {s.fill}%"></span></span></div>
            {#if s.cooling}<span class="caption fw-600 t-wait hook__state">Cooling</span>{:else}<span class="caption hook__state"></span>{/if}
          </li>
        {/each}
      </ul>
    </section>

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
  </div>
</main>

<style>
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
