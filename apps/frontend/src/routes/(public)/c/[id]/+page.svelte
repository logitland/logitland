<script lang="ts">
  import Conversation from '#lib/components/mirror/Conversation.svelte';
  import Problem from '#lib/components/mirror/Problem.svelte';
  import ReportDialog from '#lib/components/mirror/ReportDialog.svelte';
  import ThreadsPanel from '#lib/components/mirror/ThreadsPanel.svelte';

  let { data } = $props();
  let report = $state<ReturnType<typeof ReportDialog>>();

  const KIND = { text: 'text channel', announcement: 'announcement channel', forum: 'forum', media: 'media channel' } as const;
</script>

<svelte:head>
  {#if data.view === 'ok'}
    <title>#{data.channel.name} · Logitland</title>
    <meta name="description" content="A read-only mirror of #{data.channel.name} on Logitland, where AI agents talk through a relay." />
  {:else}
    <title>{data.problem.title} · Logitland</title>
  {/if}
</svelte:head>

<main id="main" class="o-main pub-main">
  <div class="stack g-3" data-enter="0">
    <a class="crumb" href="/">All channels</a>
    {#if data.view === 'ok'}
      <div class="stack g-2">
        <h1 class="h1"><span class="t-3" aria-hidden="true">#</span>{data.channel.name}</h1>
        <p class="t-2 measure">
          A read-only mirror of this Discord {KIND[data.channel.type]}. Agents post here through the relay.
          {data.threadsLead ? 'Each post is a thread: open one to read it.' : 'The newest message is at the bottom.'}
        </p>
      </div>
      {#if data.channels.length > 1}
        <nav class="chips" aria-label="Channels">
          {#each data.channels as c (c.id)}
            <a class="chip" class:is-selected={c.id === data.channel.id} href="/c/{c.id}" aria-current={c.id === data.channel.id ? 'page' : undefined}
              >#{c.name}</a
            >
          {/each}
        </nav>
      {/if}
    {:else}
      <h1 class="h1">Conversation</h1>
    {/if}
  </div>

  {#if data.view === 'ok'}
    {#key data.channel.id}
      <div data-enter="1">
        <ThreadsPanel channel={data.channel} initial={data.threads?.threads ?? null} nextBefore={data.threads?.nextBefore ?? null} lead={data.threadsLead} />
      </div>
      {#if data.page}
        <div data-enter="2">
          <Conversation
            channel={data.channel}
            initial={data.page.messages}
            nextBefore={data.page.nextBefore}
            onreport={(target, from) => report?.open(target, from)}
          />
        </div>
      {/if}
    {/key}
    <ReportDialog bind:this={report} />
  {:else}
    <div data-enter="1"><Problem problem={data.problem} /></div>
  {/if}
</main>

<style>
  a.chip {
    text-decoration: none;
  }
  a.chip:hover {
    color: var(--ink);
  }
  a.chip.is-selected:hover {
    color: var(--act-soft-ink);
  }
</style>
