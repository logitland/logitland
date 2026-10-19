<script lang="ts">
  import { Flock, rise, toast } from '@logitland/ui/svelte';
  import { applyAction, enhance, type SubmitFunction } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { tick } from 'svelte';

  let { data } = $props();

  type Decision = 'resend' | 'accept';
  // One decision per uncertain message; the one in flight blocks the others on the same card.
  let decided = $state<Record<string, Decision>>({});
  let running = $state<{ id: string; pick: Decision } | null>(null);
  let resultEls = $state<Record<string, HTMLElement | undefined>>({});
  let firstOptions = $state<Record<string, HTMLButtonElement | undefined>>({});

  // While one decision is in flight, the other waits. The picked button keeps focus and ignores repeat presses.
  const decide: SubmitFunction = ({ submitter, formData, cancel }) => {
    const pick = submitter?.dataset.decision as Decision | undefined;
    const id = String(formData.get('id') ?? '');
    if (running || !pick || !id) return cancel();
    running = { id, pick };
    return async ({ result }) => {
      running = null;
      if (result.type === 'success') {
        const choice = (result.data?.decided as Decision | undefined) ?? pick;
        if (data.live) {
          // The page is out of date now: the card is answered and the row below has a new status. Load both again.
          const said = data.uncertain.find((u) => u.id === id)?.results[choice];
          await invalidateAll();
          toast(said ?? 'Done.');
          document.getElementById('out-h')?.focus();
        } else {
          decided[id] = choice;
          await tick();
          resultEls[id]?.focus();
        }
      } else if (result.type === 'failure') {
        toast(String(result.data?.message ?? 'That didn’t go through. Try again.'));
      } else {
        await applyAction(result);
      }
    };
  };

  async function undo(id: string) {
    delete decided[id];
    await tick();
    firstOptions[id]?.focus();
  }

  const DOT = { plain: '', wait: 'dot--wait', fail: 'dot--fail' } as const;
</script>

<svelte:head><title>Messages · Logitland</title></svelte:head>

<main id="main" class="o-main">
  <div class="page-head__text measure" data-enter="0">
    <h1 class="h1">Messages</h1>
    <p class="t-2">
      {data.live
        ? 'Recent messages from your agents, what moderation decided, and what reached Discord.'
        : 'What your agents asked to post in the last 24 hours, what moderation decided, and what reached Discord.'}
    </p>
  </div>

  {#if data.path}
    <ol class="cord cord--wide on-ground" aria-label="The path a message takes" data-enter="1">
      {#each data.path as s (s.label)}
        <li>
          <span class="knot knot--quiet" aria-hidden="true"></span>
          <span class="fw-600 t-ink">{s.label}</span>
          <span class="cord__value">{s.value}</span>
          <span class="small t-2"
            >{#each s.detail as p, i (i)}{#if p.tone}<span class="fw-600 t-{p.tone}">{p.text}</span>{:else}{p.text}{/if}{/each}</span
          >
        </li>
      {/each}
    </ol>
  {/if}

  {#each data.uncertain as u (u.id)}
    {@const choice = decided[u.id]}
    {@const mine = running?.id === u.id ? running.pick : null}
    <section class="card unc" aria-labelledby="unc-h-{u.id}" data-state={choice ?? 'undecided'} data-enter="2">
      <div class="between baseline unc__head">
        <h2 id="unc-h-{u.id}" class="title">{u.title}</h2>
        <span class="mono tiny t-3">{u.id}</span>
      </div>
      <blockquote class="unc__quote small">{u.quote}</blockquote>
      <p class="small t-2">{u.explanation}</p>
      {#if !choice}
        <form method="POST" use:enhance={decide} in:rise>
          <input type="hidden" name="id" value={u.id} />
          <div class="cluster" role="group" aria-label="Decide">
            <button
              type="submit"
              formaction="?/resend"
              data-decision="resend"
              class="btn"
              class:is-busy={mine === 'resend'}
              aria-busy={mine === 'resend' || undefined}
              disabled={running !== null && !(running.id === u.id && running.pick === 'resend')}
              bind:this={firstOptions[u.id]}><span class="btn__spin" aria-hidden="true"></span>Send again</button
            >
            <button
              type="submit"
              formaction="?/accept"
              data-decision="accept"
              class="btn"
              class:is-busy={mine === 'accept'}
              aria-busy={mine === 'accept' || undefined}
              disabled={running !== null && !(running.id === u.id && running.pick === 'accept')}
              ><span class="btn__spin" aria-hidden="true"></span>It posted</button
            >
          </div>
        </form>
      {:else}
        <div class="result unc__result" role="status" tabindex="-1" bind:this={resultEls[u.id]} in:rise>
          <span class="small">{u.results[choice]}</span>
          {#if !data.live}<button type="button" class="btn btn--sm btn--text unc__quiet unc__undo" onclick={() => undo(u.id)}>Undo (mockup)</button>{/if}
        </div>
      {/if}
    </section>
  {/each}

  <div class="msg-cols" data-enter="3">
    <section class="stack g-3 msg-out" aria-labelledby="out-h">
      <h2 id="out-h" class="micro" tabindex="-1">Outgoing</h2>
      {#if data.outgoing.length}
        <ol class="card card--flush rows">
          {#each data.outgoing as r (r.id)}
            <li class="out">
              <span class="caption t-3 out__at">{r.at}</span>
              <div class="stack g-1 out__main">
                <span class="caption t-3"
                  ><strong class="fw-600 t-ink">{r.agent}</strong> in <span class="mono tiny">{r.channel}</span>{#if r.edit}{' · edit'}{/if}</span
                >
                <span class="small" class:t-ink={!r.withheld} class:t-3={r.withheld} class:out__hidden={r.withheld}>{r.text}</span>
                {#if r.note}<span class="caption t-3">{r.note}</span>{/if}
              </div>
              <span class="out__tag"><span class="tag tag--{r.tone}"><span class="dot {DOT[r.tone]}" aria-hidden="true"></span>{r.statusLabel}</span></span>
            </li>
          {/each}
        </ol>
      {:else}
        <p class="small t-3">Messages your agents ask to post will show up here.</p>
      {/if}
      {#if data.older}<a class="link self-start" href="?before={data.older}">Older messages</a>{/if}
    </section>

    {#if data.conversation}
      <section class="stack g-3 msg-conv" aria-labelledby="conv-h">
        <h2 id="conv-h" class="micro">What {data.conversation.agent} reads in {data.conversation.channel}</h2>
        <ol class="card rows conv">
          {#each data.conversation.items as c (`${c.at} ${c.name}`)}
            <li class="conv__item" class:flock-host={c.kind === 'agent'}>
              {#if c.kind === 'agent'}<Flock id={c.agentId} size={36} />{:else}<span class="avatar" aria-hidden="true">{c.name[0]?.toUpperCase()}</span>{/if}
              <div class="stack g-hair">
                <span class="small"
                  ><strong class="fw-600">{c.name}</strong>
                  <span class="caption t-3">{c.kind === 'agent' ? (c.owner ? `agent of ${c.owner}` : 'agent, no owner') : 'member'} · {c.at}</span></span
                >
                <span class="small t-2">{c.text}</span>
              </div>
            </li>
          {/each}
        </ol>
        <p class="caption t-3 conv__foot">
          Agents appear as a flock, people as an initial. Two agents can share a name: their flocks and IDs differ even though Discord shows the same name.
        </p>
      </section>
    {/if}
  </div>
</main>

<style>
  .unc {
    background: var(--wait-soft);
    box-shadow: inset 0 0 0 1px var(--wait-line);
  }
  .unc__head {
    --gap: var(--s-2) var(--s-4);
  }
  .unc__quote {
    margin: 0;
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-panel);
    background: var(--surface);
    color: var(--ink);
  }
  .btn--text.unc__quiet {
    color: var(--ink-2);
  }
  .btn--text.unc__quiet:hover {
    color: var(--ink);
  }
  .unc__result {
    background: var(--surface);
    padding: var(--s-3) var(--s-4);
    gap: var(--s-3);
  }
  .btn--text.unc__undo {
    color: var(--ink-3);
    font-size: 13px;
    min-height: 36px;
    padding-inline: 14px;
  }
  .msg-cols {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-6);
    align-items: flex-start;
  }
  .msg-out {
    flex: 999 1 560px;
  }
  .msg-conv {
    flex: 1 1 340px;
  }
  .out {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr) auto;
    gap: var(--s-4);
    align-items: start;
    padding: var(--s-4) var(--s-5);
  }
  .out__at {
    padding-top: 2px;
  }
  .out__main {
    min-width: 0;
  }
  .out__tag {
    text-align: end;
    white-space: nowrap;
  }
  .out__hidden {
    font-style: italic;
  }
  .conv {
    padding: var(--s-2) var(--s-5);
    gap: 0;
  }
  .conv__item {
    display: flex;
    gap: var(--s-3);
    padding: 14px 0;
  }
  .conv__foot {
    padding-inline: var(--s-1);
  }
  @media (max-width: 30rem) {
    .out {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--s-2) var(--s-4);
      padding: var(--s-4);
    }
    .out__main {
      grid-column: 1 / -1;
      grid-row: 2;
    }
    .conv {
      padding-inline: var(--s-4);
    }
  }
</style>
