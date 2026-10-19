<script lang="ts">
  import { FLIP, Flock, Morph, fold, reveal, rise, toast } from '@logitland/ui/svelte';
  import { tick, untrack } from 'svelte';
  import { flip } from 'svelte/animate';
  import type { ActorFilter, AuditItem } from '#lib/fixtures/admin-audit.js';

  let { data } = $props();

  // Show change / Hide change.
  let open = $state<Record<string, boolean>>(untrack(() => Object.fromEntries(data.days.flatMap((d) => d.entries.flatMap((e) => (e.diff ? [[e.id, e.diff.open]] : []))))));
  async function toggle(id: string) {
    open[id] = !open[id];
    if (!open[id]) return;
    await tick();
    reveal(document.getElementById(`diff-${id}`));
  }

  // Filter by actor kind and by search text, across the day groups.
  let kind = $state<ActorFilter>('all');
  let query = $state('');
  const haystack = (e: AuditItem) => [e.actor, e.kindLabel, e.time, e.text, e.meta, ...(e.diff?.lines.map((l) => l.text) ?? [])].join(' ').toLowerCase();
  const total = $derived(data.days.reduce((n, d) => n + d.entries.length, 0));
  const days = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return data.days
      .map((d) => ({ ...d, entries: d.entries.filter((e) => (kind === 'all' || e.kind === kind) && (!q || haystack(e).includes(q))) }))
      .filter((d) => d.entries.length > 0);
  });
  const note = $derived(days.length ? data.notes.some : !total ? data.notes.empty : query.trim() ? data.notes.query : data.notes.kind);

  let noteEl = $state<HTMLElement>();
  let lastNote = untrack(() => note);
  $effect(() => {
    if (note === lastNote) return;
    lastNote = note;
    reveal(noteEl);
  });
</script>

<svelte:head><title>Audit trail · Logitland admin</title></svelte:head>

<header class="a-header">
  <div class="page-head__text head-text">
    <h1 class="h1">Audit trail</h1>
    <p class="t-3">Every change to relay settings and credentials, and who made it. Changes made in Discord appear only when the relay reads Discord’s audit log.</p>
  </div>
  <div class="a-tools" role="search">
    <label class="sr-only" for="au-search">Search the audit trail</label>
    <input class="input input--sm" id="au-search" type="search" placeholder="Actor, agent, key or request" autocomplete="off" bind:value={query} />
    <button type="button" class="btn btn--sm" onclick={() => toast('Exporting isn’t part of this mockup.')}>Export CSV</button>
  </div>
</header>

<main id="main" class="a-main">
  <div class="chips" id="au-chips" role="group" aria-label="Filter by who made the change" data-enter="0">
    {#each data.filters as f (f.value)}
      <button type="button" class="chip" aria-pressed={kind === f.value} onclick={() => (kind = f.value)}>{f.label}</button>
    {/each}
  </div>

  <div class="split" data-enter="1">
    <section class="stack g-5" id="au-days" aria-label="Changes">
      {#each days as day (day.id)}
        <div class="stack g-3 au-day" animate:flip={FLIP} in:rise out:fold>
          <h2 class="micro" id="day-{day.id}">{day.label}</h2>
          <ol class="card g-0 au-list">
            {#each day.entries as e (e.id)}
              <li class="au-entry" animate:flip={FLIP} in:rise out:fold>
                {#if 'initial' in e.mark}
                  <span class="avatar" style="--size: 32px" aria-hidden="true">{e.mark.initial}</span>
                {:else if 'flock' in e.mark}
                  <Flock id={e.mark.flock} size={32} />
                {:else}
                  <span class="au-ring" aria-hidden="true"></span>
                {/if}
                <div class="stack g-1">
                  <span class="caption t-3"><strong class="t-ink fw-600">{e.actor}</strong> · {e.kindLabel} · {e.time}</span>
                  <span class="t-2">{e.text}</span>
                  <span class="mono tiny t-3 wrap-any">{e.meta}</span>
                </div>
                {#if e.diff}
                  <button type="button" class="btn btn--sm au-toggle" aria-expanded={open[e.id] ?? false} aria-controls="diff-{e.id}" onclick={() => toggle(e.id)}
                    ><Morph text={open[e.id] ? 'Hide change' : 'Show change'} /></button
                  >
                  <div class="code code-lines au-diff" id="diff-{e.id}" role="group" aria-label="Change" hidden={!open[e.id]}
                    >{#each e.diff.lines as line, i (i)}<code class={line.kind === 'dim' ? 'c-dim' : line.kind === 'del' ? 'c-del' : undefined}>{line.text}</code>{/each}</div
                  >
                {/if}
              </li>
            {/each}
          </ol>
        </div>
      {/each}

      <p class="caption t-3" id="au-note" role="status" bind:this={noteEl}>{note}</p>
    </section>

    <div class="stack g-4">
      <section class="card g-3" aria-labelledby="rec-h">
        <h2 id="rec-h" class="title">What is recorded</h2>
        <ul class="bullets">
          <li>Registrations, approvals, denials and agents turned off</li>
          <li>Keys created and revoked, never the key itself</li>
          <li>Subscription changes and signing-secret rotations</li>
          <li>Channel settings, suspensions and webhook replacements</li>
          <li>Channel changes in Discord, from Discord’s audit log</li>
        </ul>
      </section>
      <section class="card g-3" aria-labelledby="not-h">
        <h2 id="not-h" class="title">What isn’t</h2>
        <p>Message text (see Moderation), and which MCP caller asked for a Discord change, unless the MCP writes it into the audit-log reason.</p>
        <span class="caption t-3">Kept for [retention period].</span>
      </section>
    </div>
  </div>
</main>

<style>
  .head-text {
    flex: 1 1 480px;
    max-width: 720px;
  }
  .split {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-5);
    align-items: flex-start;
  }
  .split > :first-child {
    flex: 999 1 560px;
    min-width: 0;
  }
  .split > :last-child {
    flex: 1 1 320px;
    min-width: 0;
  }

  .au-list {
    padding: var(--s-2) var(--s-5);
  }
  .au-entry {
    position: relative;
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) auto;
    gap: var(--s-2) var(--s-4);
    padding: var(--s-4) 0;
    align-items: start;
  }
  .au-entry::before {
    content: '';
    position: absolute;
    inset-inline-start: 15px;
    top: 52px;
    bottom: -16px;
    width: 2px;
    background: var(--line);
  }
  .au-entry:last-child::before {
    content: none;
  }
  .au-entry > .avatar,
  .au-entry > :global(.flock),
  .au-ring {
    position: relative;
  }
  .au-ring {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--ground);
    box-shadow: inset 0 0 0 2px var(--line-strong);
  }
  .au-toggle {
    align-self: start;
  }
  .au-diff {
    grid-column: 2;
    position: relative;
  }
  @media (max-width: 48rem) {
    .au-entry {
      grid-template-columns: 32px minmax(0, 1fr);
    }
    .au-toggle {
      grid-column: 2;
      justify-self: start;
    }
    .au-diff {
      grid-column: 1 / -1;
    }
  }
  @media (max-width: 30rem) {
    .a-tools .input {
      flex-basis: 100%;
    }
  }

  ul.bullets {
    list-style: disc;
    padding-inline-start: 18px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
</style>
