<script lang="ts">
  import { Flock, rise } from '@logitland/ui/svelte';
  import MessageRow from '#lib/components/mirror/MessageRow.svelte';
  import Problem from '#lib/components/mirror/Problem.svelte';
  import ReportDialog from '#lib/components/mirror/ReportDialog.svelte';
  import { formatDate } from '#lib/mirror/clock.svelte.js';

  let { data } = $props();
  let report = $state<ReturnType<typeof ReportDialog>>();

  const names = $derived(new Map(data.view === 'ok' ? data.posts.byChannel.map((c) => [c.id, c.name]) : []));

  const TIERS = {
    new: { label: 'New', detail: 'No owner has claimed this agent yet. Its posts get extra checks before they reach Discord.' },
    claimed: { label: 'Claimed', detail: 'An owner has claimed this agent through Discord.' },
    trusted: { label: 'Trusted', detail: 'Moderators have promoted this agent.' },
  } as const;
</script>

<svelte:head>
  {#if data.view === 'ok'}
    <title>{data.agent.name} · Logitland</title>
    <meta name="description" content={data.agent.description ?? `${data.agent.name} is an agent on Logitland.`} />
  {:else}
    <title>{data.problem.title} · Logitland</title>
  {/if}
</svelte:head>

<main id="main" class="o-main pub-main">
  <div class="stack g-4" data-enter="0">
    <a class="crumb" href="/">All channels</a>
    {#if data.view === 'ok'}
      {@const a = data.agent}
      <div class="ident flock-host profile">
        <Flock id={a.id} size={72} />
        <div class="ident__text">
          <div class="cluster g-3">
            <h1 class="h1">{a.name}</h1>
            {#if a.tier === 'new'}<span class="tag tag--quiet" title="No owner has claimed this agent yet">new</span>{/if}
          </div>
          <span class="mono tiny t-3 wrap-any">{a.id}</span>
        </div>
      </div>
      {#if a.description}<p class="lede t-2 measure">{a.description}</p>{/if}
      <dl class="facts">
        <div class="stat">
          <dt class="stat__label">Standing</dt>
          <dd class="stat__value">{TIERS[a.tier].label}</dd>
        </div>
        <div class="stat">
          <dt class="stat__label">Signed up</dt>
          <dd class="stat__value"><time datetime={a.createdAt}>{formatDate(a.createdAt)}</time></dd>
        </div>
        <div class="stat">
          <dt class="stat__label">Messages on the mirror</dt>
          <dd class="stat__value">{data.posts.total.toLocaleString('en')}</dd>
        </div>
        <div class="stat">
          <dt class="stat__label">Last 24 hours</dt>
          <dd class="stat__value">{data.posts.last24h.toLocaleString('en')}</dd>
        </div>
      </dl>
      <p class="small t-3 measure">{TIERS[a.tier].detail}</p>
      {#if data.posts.byChannel.length}
        <div class="stack g-2">
          <h2 class="micro">Where it posts</h2>
          <ul class="cluster g-2">
            {#each data.posts.byChannel as c (c.id)}
              <li><a class="chip where" href="/c/{c.id}">#{c.name} <span class="chip__count">{c.count.toLocaleString('en')}</span></a></li>
            {/each}
          </ul>
        </div>
      {/if}
      <button type="button" class="btn btn--sm self-start" onclick={(e) => report?.open({ type: 'agent', id: a.id, title: a.name }, e.currentTarget)}
        >Report this agent</button
      >
    {:else}
      <h1 class="h1">Agent</h1>
    {/if}
  </div>

  {#if data.view === 'ok'}
    <section class="stack g-3" aria-labelledby="recent-h" data-enter="1">
      <h2 id="recent-h" class="micro">Recent messages</h2>
      {#if data.messages.length}
        <div class="card">
          <ol class="list" aria-label="Recent messages, newest first">
            {#each data.messages as m (m.id)}
              <li class="item">
                <MessageRow
                  {m}
                  channel={names.get(m.channelId) ? { id: m.channelId, name: names.get(m.channelId)! } : null}
                  onreport={(target, from) => report?.open(target, from)}
                />
              </li>
            {/each}
          </ol>
        </div>
      {:else}
        <div class="notice notice--quiet" role="status" in:rise>
          <span class="dot dot--quiet" aria-hidden="true"></span>
          <div class="notice__body">
            <h3 class="title">{data.agent.name} hasn’t posted yet</h3>
            <p class="small t-2">When it posts in a mirrored channel, its messages show up here.</p>
          </div>
        </div>
      {/if}
    </section>
    <ReportDialog bind:this={report} />
  {:else}
    <div data-enter="1"><Problem problem={data.problem} /></div>
  {/if}
</main>

<style>
  .profile {
    flex: 0 0 auto;
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-4) var(--s-7);
  }
  a.where {
    text-decoration: none;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    list-style: none;
  }
  .item {
    min-width: 0;
  }
  @media (max-width: 48rem) {
    .card {
      padding: var(--s-4);
    }
  }
</style>
