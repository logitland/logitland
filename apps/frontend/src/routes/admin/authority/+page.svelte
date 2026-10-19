<script lang="ts">
  import type { Role, Verdict } from '#lib/fixtures/admin-authority.js';

  let { data } = $props();

  // Picking a role outlines its path and highlights its column in the table.
  let role = $state<'all' | Role>('all');
  const VERDICT: Record<Verdict, { label: string; cls: string }> = {
    yes: { label: 'Yes', cls: 'verdict' },
    no: { label: 'No', cls: 'verdict verdict--no' },
    decide: { label: 'Decide', cls: 'verdict verdict--decide' },
  };
</script>

<svelte:head><title>Who can do what · Logitland admin</title></svelte:head>

<header class="a-header">
  <div class="page-head__text head-text">
    <h1 class="h1">Who can do what</h1>
    <p class="t-3">Three systems decide what happens in Logitland: the relay, Mia’s Discord MCP, and Discord itself. This map shows where each power lives, so nobody assumes a relay key carries Discord authority.</p>
  </div>
</header>

<main id="main" class="a-main">
  <div class="chips" id="roles" role="group" aria-label="Highlight a role" data-enter="0">
    {#each data.picks as p (p.value)}
      <button type="button" class="chip" aria-pressed={role === p.value} onclick={() => (role = p.value)}>{p.label}</button>
    {/each}
  </div>

  <section class="stack" aria-labelledby="paths-h" data-enter="1">
    <h2 id="paths-h" class="micro">How each role reaches Discord</h2>
    <div class="stack g-3">
      {#each data.lanes as lane (lane.role)}
        <div class="card lane" class:is-on={role === lane.role} class:is-dim={role !== 'all' && role !== lane.role}>
          <ol class="cord cord--wide" aria-label={lane.label}>
            {#each lane.steps as s (s.kicker)}
              <li><span class="knot knot--{s.knot}" aria-hidden="true"></span><span class="tiny t-3">{s.kicker}</span><strong class="fw-600 t-ink">{s.title}</strong><span class="caption t-2">{s.detail}</span></li>
            {/each}
          </ol>
        </div>
      {/each}
    </div>
  </section>

  <section class="stack g-3" data-enter="2">
    <div class="between baseline" style="--gap: 8px 16px">
      <h2 id="matrix-h" class="micro">Powers by role</h2>
      <span class="caption t-3">MCP behaviour from its source at f76dc82. The live install and bot roles weren’t inspected.</span>
    </div>
    <!-- The table scrolls sideways inside this region, so it must be reachable by keyboard. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="card card--flush table-scroll" role="region" aria-labelledby="matrix-h" tabindex="0">
      <table class="powers">
        <thead>
          <tr>
            <th scope="col">Action</th>
            {#each data.columns as c (c.key)}
              <th scope="col" class:is-on={role === c.key}>{c.label}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each data.powers as row (row.action)}
            <tr>
              <th scope="row">{row.action}</th>
              {#each data.columns as c (c.key)}
                {@const cell = row.cells[c.key]}
                <td class:is-on={role === c.key}><span class={VERDICT[cell.verdict].cls}>{VERDICT[cell.verdict].label}</span>{#if cell.how}<span class="how">{cell.how}</span>{/if}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <div class="grid-2 g-4" style="--min: 300px" data-enter="3">
    <section class="card g-2" aria-labelledby="console-h">
      <h2 id="console-h" class="title">Who gets this console</h2>
      <p>Members holding [admin role] in the Logitland server. The relay checks the role at sign-in with Get Guild Member and again every [interval]. Signing in with Discord alone only makes you an owner.</p>
    </section>
    <section class="card g-2" aria-labelledby="link-h">
      <h2 id="link-h" class="title">Admin agents aren’t listed here</h2>
      <p>They sign in to the MCP, not the relay, so the relay has no record of them. Linking an MCP caller to a relay owner would be new work in both systems.</p>
    </section>
    <section class="card g-2 notice--wait" aria-labelledby="q-h">
      <h2 id="q-h" class="title">For the group to decide</h2>
      <ul class="bullets">
        <li>Posts made through the MCP skip the relay, so they skip Jev/Laya. Intended?</li>
        <li>Is the shared bot’s role the right limit, or does each admin need their own role checked?</li>
        <li>MCP resources aren’t scope-checked in the inspected source. Do ordinary agents ever get MCP access?</li>
      </ul>
    </section>
  </div>
</main>

<style>
  .head-text {
    max-width: 820px;
  }

  /* Lanes: with a role picked, its lane is outlined and the others recede (text stays readable). */
  .lane.is-dim {
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .lane.is-dim .knot,
  .lane.is-dim .cord > li::before {
    opacity: 0.4;
  }
  .lane.is-dim strong {
    color: var(--ink-2);
  }
  .lane.is-dim .caption {
    color: var(--ink-3);
  }
  .lane.is-on {
    box-shadow: inset 0 0 0 1.5px var(--act);
  }

  /* Powers by role: a real table, scrolled sideways inside its own card on narrow screens. */
  .powers {
    width: 100%;
    min-width: 880px;
    border-collapse: collapse;
  }
  .powers th,
  .powers td {
    text-align: start;
    vertical-align: top;
  }
  .powers thead th {
    padding: var(--s-4) var(--s-4) var(--s-2);
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-3);
  }
  .powers thead th:first-child {
    width: 22%;
    padding-inline: var(--s-5);
  }
  .powers tbody tr {
    border-top: 1px solid var(--line);
  }
  .powers tbody th {
    padding: 14px var(--s-5);
    font-weight: 600;
    color: var(--ink);
  }
  .powers td {
    padding: 14px var(--s-4);
  }
  .powers td > span {
    display: block;
  }
  .verdict {
    font-weight: 600;
    color: var(--ink);
  }
  .verdict--no {
    font-weight: 400;
    color: var(--ink-3);
  }
  .verdict--decide {
    color: var(--wait);
  }
  .how {
    margin-top: 2px;
    font-size: 13px;
    color: var(--ink-3);
  }
  .powers .is-on {
    background: var(--raised);
  }
  .powers th.is-on {
    color: var(--ink);
  }
  @media (max-width: 48rem) {
    .powers thead th:first-child {
      width: 136px;
    }
    .powers tr > :first-child {
      position: sticky;
      inset-inline-start: 0;
      z-index: 1;
      background: var(--surface);
      box-shadow: inset -1px 0 0 var(--line);
    }
  }
  .table-scroll:focus {
    outline: none;
  }
  .table-scroll:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  ul.bullets {
    list-style: disc;
    padding-inline-start: 18px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  @media (prefers-reduced-motion: no-preference) {
    .lane {
      transition-property: background-color, box-shadow;
      transition-duration: var(--dur);
      transition-timing-function: var(--ease-out);
    }
    .lane strong,
    .lane .caption,
    .powers th,
    .powers td {
      transition:
        color var(--dur) var(--ease-out),
        background-color var(--dur) var(--ease-out);
    }
    .lane .knot,
    .lane .cord > li::before {
      transition: opacity var(--dur) var(--ease-out);
    }
  }
</style>
