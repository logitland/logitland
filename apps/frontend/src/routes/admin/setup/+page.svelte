<script lang="ts">
  import type { ChannelAccess, SetupCheck } from '@logitland/contracts';
  import { FLIP, Morph, announce, fold, rise, toast } from '@logitland/ui/svelte';
  import { applyAction, enhance, type SubmitFunction } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { onMount, tick, untrack } from 'svelte';
  import { flip } from 'svelte/animate';
  import RelayFields from '#lib/admin/RelayFields.svelte';
  import { SETUP_GROUPS, STATUS_ORDER, STATUS_TAG, STATUS_WORD, channelOfCheck, groupOf, tally } from '#lib/setup-view.js';

  let { data } = $props();

  /* ---------- The checks, with what has been fixed on this page ---------- */

  // In relay mode a re-check asks Discord again and replaces everything. In fixtures mode the fixes stay on the page.
  let fixed = $state<Record<string, true>>({});
  const checks = $derived<SetupCheck[]>(data.checks.map((c) => (fixed[c.id] ? { ...c, status: 'ok', detail: 'Fixed just now.', fix: '' } : c)));
  const counts = $derived(tally(checks));
  const attention = $derived(counts.fail + counts.warn + counts.unknown);

  // Start on what needs attention, or on everything when nothing does.
  let show = $state<'attention' | 'all'>(untrack(() => (tally(data.checks).ok === data.checks.length ? 'all' : 'attention')));

  const groups = $derived(
    SETUP_GROUPS.map((g) => {
      const all = checks.filter((c) => groupOf(c) === g.id).sort((a, z) => STATUS_ORDER[a.status] - STATUS_ORDER[z.status]);
      const shown = show === 'all' ? all : all.filter((c) => c.status !== 'ok');
      return { ...g, all, shown, needs: all.filter((c) => c.status !== 'ok').length };
    }).filter((g) => g.all.length > 0),
  );

  /* ---------- Re-check ---------- */

  let checkedAt = $state(Date.now());
  let now = $state(Date.now());
  const sinceText = $derived.by(() => {
    const s = Math.max(0, Math.round((now - checkedAt) / 1000));
    return s < 45 ? 'Checked just now' : s < 5400 ? `Checked ${Math.round(s / 60)} min ago` : `Checked ${Math.round(s / 3600)} h ago`;
  });
  let rechecking = $state(false);

  async function recheck() {
    if (rechecking) return;
    rechecking = true;
    await Promise.all([invalidateAll(), new Promise((r) => setTimeout(r, data.live ? 0 : 700))]);
    if (data.live) fixed = {};
    checkedAt = Date.now();
    now = checkedAt;
    rechecking = false;
    await tick();
    announce(
      attention === 0 ? 'Checked again: everything is ready' : `Checked again: ${attention} ${attention === 1 ? 'check needs' : 'checks need'} attention`,
    );
  }

  onMount(() => {
    const id = setInterval(() => {
      if (!document.hidden) now = Date.now();
    }, 20_000);
    return () => clearInterval(id);
  });

  /* ---------- Fixes the relay can make ---------- */

  let working = $state<string | null>(null);
  let errors = $state<Record<string, string>>({});
  let picking = $state(false);
  let pickId = $state('');
  let pickAccess = $state<ChannelAccess>('post');
  let pickMirror = $state(true);
  let pickPace = $state<number | null>(10);
  let posted = $state<{ url: string; channel: string } | null>(null);
  let consentId = $state('');

  const unrelayed = $derived((data.listing?.channels ?? []).filter((c) => !c.relay || c.relay.agent_access === 'off'));
  const textChannels = $derived((data.listing?.channels ?? []).filter((c) => c.type === 'text' || c.type === 'announcement'));
  $effect.pre(() => {
    if (!pickId || !unrelayed.some((c) => c.id === pickId)) pickId = unrelayed[0]?.id ?? '';
    if (!consentId || !textChannels.some((c) => c.id === consentId)) consentId = (textChannels.find((c) => c.name === 'welcome') ?? textChannels[0])?.id ?? '';
  });
  // Forum and media channels need a thread for every post, so they start as threads only, like the relay's own default.
  let accessFor = '';
  $effect.pre(() => {
    const c = unrelayed.find((x) => x.id === pickId);
    if (!c || accessFor === c.id) return;
    accessFor = c.id;
    pickAccess = c.type === 'forum' || c.type === 'media' ? 'post_new_threads' : 'post';
  });

  let recheckBtn = $state<HTMLButtonElement>();

  // A fixed check leaves the "needs attention" list, taking its button with it. Focus goes to the next fix, or to Re-check.
  async function fixedBy(ids: string[]) {
    if (data.live) await recheck();
    else for (const id of ids) fixed[id] = true;
    await tick();
    const next = [...document.querySelectorAll<HTMLElement>('[data-check] button:not([disabled]), [data-check] a.btn')].find(
      (el) => !ids.includes(el.closest('[data-check]')?.getAttribute('data-check') ?? ''),
    );
    (next ?? recheckBtn)?.focus();
  }

  const act: SubmitFunction = ({ action, formData, cancel }) => {
    if (working) return cancel();
    const kind = action.search.replace('?/', '');
    const key = String(formData.get('key') ?? kind);
    working = key;
    delete errors[key];
    return async ({ result }) => {
      working = null;
      if (result.type === 'failure') {
        errors[key] = String(result.data?.message ?? 'That didn’t work. Try again.');
        return;
      }
      if (result.type !== 'success' || !result.data) return applyAction(result);
      const d = result.data;
      if (kind === 'commands') {
        const list = (d.registered as { name: string; subcommands: string[] }[])
          .map((c) => `/${c.name}${c.subcommands.length ? ` (${c.subcommands.join(', ')})` : ''}`)
          .join(', ');
        toast(`Registered ${list || 'the commands'}.`);
        await fixedBy(['mirror-command']);
      } else if (kind === 'consent') {
        const msg = d.posted as { url: string };
        posted = { url: msg.url, channel: String(d.channelName ?? '') };
        toast('The consent message is posted.');
      } else {
        const channel = d.channel as { name: string };
        toast(`#${channel.name} is relayed.${d.webhook_created ? ' The bot created its webhook.' : ''}`);
        picking = false;
        const id = String(d.channelId);
        await fixedBy([`channel:${id}:webhook`, 'channels-relayed']);
      }
    };
  };

  const canRelayWebhook = (c: SetupCheck) => c.status !== 'ok' && channelOfCheck(c.id)?.part === 'webhook';
</script>

<svelte:head><title>Setup · Logitland admin</title></svelte:head>

<header class="a-header">
  <div class="page-head__text su-intro">
    <h1 class="h1">Setup</h1>
    <p class="t-3">
      What the relay needs from Discord and from its own settings. Anything that isn’t ready says what to do, and where the relay can do it for you there’s a
      button.
    </p>
  </div>
  <div class="a-tools">
    <span class="caption t-3" role="status"><Morph text={sinceText} /></span>
    <button
      type="button"
      class="btn btn--sm btn--primary"
      class:is-busy={rechecking}
      aria-busy={rechecking || undefined}
      bind:this={recheckBtn}
      onclick={recheck}><span class="btn__spin" aria-hidden="true"></span>Re-check</button
    >
  </div>
</header>

<main id="main" class="a-main">
  {#if counts.fail > 0}
    <section class="notice notice--fail" role="status" data-enter="0">
      <span class="dot dot--fail" aria-hidden="true"></span>
      <div class="notice__body">
        <strong class="title">{counts.fail === 1 ? '1 check needs fixing' : `${counts.fail} checks need fixing`}</strong>
        <span class="t-2">Some of the relay won’t work until they’re fixed. Each one says what to do.</span>
      </div>
    </section>
  {:else if counts.warn > 0 || counts.unknown > 0}
    <section class="notice notice--wait" role="status" data-enter="0">
      <span class="dot dot--wait" aria-hidden="true"></span>
      <div class="notice__body">
        <strong class="title">Nothing is broken, but {attention === 1 ? '1 thing deserves' : `${attention} things deserve`} a look</strong>
        <span class="t-2">{counts.unknown ? 'Some checks couldn’t run. Re-check in a minute.' : 'The relay works, but these will cause trouble later.'}</span>
      </div>
    </section>
  {:else}
    <section class="notice notice--quiet" role="status" data-enter="0">
      <span class="dot dot--quiet" aria-hidden="true"></span>
      <div class="notice__body">
        <strong class="title">Everything the relay can check is ready</strong>
        <span class="t-2">{counts.ok} checks passed.</span>
      </div>
    </section>
  {/if}

  <div class="between" style="--gap: 12px 24px" data-enter="1">
    <dl class="su-stats" aria-label="Checks by status">
      {#each ['ok', 'warn', 'fail', 'unknown'] as const as s (s)}
        <div class="stat">
          <dt class="stat__label">{STATUS_WORD[s]}</dt>
          <dd class="su-stat {s === 'fail' && counts[s] ? 't-fail' : s === 'warn' && counts[s] ? 't-wait' : 't-ink'}"><Morph text={counts[s]} /></dd>
        </div>
      {/each}
    </dl>
    <div class="chips" role="group" aria-label="Which checks to show">
      <button type="button" class="chip" aria-pressed={show === 'attention'} onclick={() => (show = 'attention')}
        >Needs attention <span class="chip__count">{attention}</span></button
      >
      <button type="button" class="chip" aria-pressed={show === 'all'} onclick={() => (show = 'all')}
        >Everything <span class="chip__count">{checks.length}</span></button
      >
    </div>
  </div>

  {#if data.listingError}
    <p class="panel small t-2" role="status">The server’s channel list isn’t available, so the channel pickers are off: {data.listingError}</p>
  {/if}

  {#each groups as g (g.id)}
    <section class="stack g-3" aria-labelledby="g-{g.id}" data-enter="2">
      <div class="between baseline" style="--gap: 4px 16px">
        <h2 id="g-{g.id}" class="micro">{g.title}</h2>
        <p class="caption t-3">{g.blurb}{g.needs ? ` · ${g.needs} to look at` : ''}</p>
      </div>
      <ul class="card card--flush rows">
        {#each g.shown as c (c.id)}
          {@const st = STATUS_TAG[c.status]}
          {@const ch = channelOfCheck(c.id)}
          <li class="chk" class:chk--ok={c.status === 'ok'} data-check={c.id} animate:flip={FLIP} in:rise out:fold>
            <span class="{st.dot} chk__dot" aria-hidden="true"></span>
            <div class="chk__main">
              <div class="between baseline" style="--gap: 4px 12px">
                <h3 class="chk__title">{c.title}</h3>
                <span class={st.tag}>{STATUS_WORD[c.status]}</span>
              </div>
              <p class="small t-2">{c.detail}</p>
              {#if c.status !== 'ok' && c.fix}
                <div class="panel small chk__fix"><span class="fw-600 t-ink">What to do</span><span>{c.fix}</span></div>
              {/if}

              {#if c.id === 'mirror-command' && c.status !== 'ok'}
                <form class="cluster g-2" method="POST" action="?/commands" use:enhance={act}>
                  <input type="hidden" name="key" value={c.id} />
                  <button class="btn btn--sm btn--primary" class:is-busy={working === c.id} aria-busy={working === c.id || undefined}
                    ><span class="btn__spin" aria-hidden="true"></span>Register /mirror</button
                  >
                  <span class="caption t-3">Adds /mirror agree, leave and status to the server.</span>
                </form>
              {:else if ch && canRelayWebhook(c)}
                <form class="cluster g-2" method="POST" action="?/relay" use:enhance={act}>
                  <input type="hidden" name="key" value={c.id} />
                  <input type="hidden" name="channel_id" value={ch.channelId} />
                  <button class="btn btn--sm btn--primary" class:is-busy={working === c.id} aria-busy={working === c.id || undefined}
                    ><span class="btn__spin" aria-hidden="true"></span>Relay this channel</button
                  >
                  <span class="caption t-3">The bot makes the webhook itself. Its other settings stay as they are.</span>
                </form>
              {:else if c.id === 'channels-relayed' && c.status !== 'ok'}
                {#if !data.listing}
                  <a class="btn btn--sm self-start" href="/admin/channels">Open Channels</a>
                {:else if !picking}
                  <button type="button" class="btn btn--sm btn--primary self-start" onclick={() => (picking = true)}>Relay a channel…</button>
                {:else}
                  <form class="su-inline stack g-3" method="POST" action="?/relay" use:enhance={act} in:rise>
                    <input type="hidden" name="key" value={c.id} />
                    <div class="field">
                      <label class="label" for="su-pick">Channel to relay</label>
                      <select class="select select--sm" id="su-pick" name="channel_id" bind:value={pickId}>
                        {#each unrelayed as u (u.id)}<option value={u.id}>#{u.name} · {u.type_label}</option>{/each}
                      </select>
                    </div>
                    <RelayFields id="su-relay" bind:access={pickAccess} bind:mirror={pickMirror} bind:pace={pickPace} />
                    <div class="cluster g-2">
                      <button class="btn btn--sm btn--primary" class:is-busy={working === c.id} aria-busy={working === c.id || undefined} disabled={!pickId}
                        ><span class="btn__spin" aria-hidden="true"></span>Relay channel</button
                      >
                      <button type="button" class="btn btn--sm btn--text" onclick={() => (picking = false)}>Cancel</button>
                    </div>
                  </form>
                {/if}
              {/if}
              {#if errors[c.id]}<p class="error" role="alert" in:rise>{errors[c.id]}</p>{/if}
            </div>
          </li>
        {:else}
          <li class="chk chk--empty caption t-3">Nothing here needs attention.</li>
        {/each}
      </ul>

      {#if g.id === 'server'}
        <section class="card su-consent" aria-labelledby="consent-h">
          <div class="stack g-1">
            <h3 id="consent-h" class="title">Consent message</h3>
            <p class="small t-2">
              People agree to the public mirror with a button, and that gives them the consent role so they can chat. Post the message once, in a channel
              everyone sees, such as a welcome channel.
            </p>
          </div>
          {#if data.listing}
            <form class="su-consent__form" method="POST" action="?/consent" use:enhance={act}>
              <input type="hidden" name="key" value="consent" />
              <div class="field su-consent__pick">
                <label class="label" for="su-consent">Channel</label>
                <select class="select select--sm" id="su-consent" name="channel_id" bind:value={consentId}>
                  {#each textChannels as t (t.id)}<option value={t.id}>#{t.name} · {t.type_label}</option>{/each}
                </select>
              </div>
              <button class="btn btn--sm" class:is-busy={working === 'consent'} aria-busy={working === 'consent' || undefined} disabled={!consentId}
                ><span class="btn__spin" aria-hidden="true"></span>Post the consent message</button
              >
            </form>
            {#if errors.consent}<p class="error" role="alert" in:rise>{errors.consent}</p>{/if}
            {#if posted}
              <p class="result" role="status" in:rise>
                <span class="small">Posted{posted.channel ? ` in #${posted.channel}` : ''}. Posting it again adds another copy.</span>
                <a class="btn btn--sm" href={posted.url} target="_blank" rel="noopener noreferrer">Open it in Discord</a>
              </p>
            {/if}
          {:else}
            <p class="small t-3">The server’s channel list isn’t available, so there’s nothing to choose from yet.</p>
          {/if}
        </section>
      {/if}
    </section>
  {/each}
</main>

<style>
  .su-intro {
    max-width: 720px;
  }
  .su-stats {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-3) var(--s-6);
  }
  .su-stat {
    font-family: var(--font-display);
    font-size: 26px;
    line-height: 1.2;
    font-weight: 500;
    letter-spacing: -0.02em;
  }
  .chk {
    display: grid;
    grid-template-columns: 8px minmax(0, 1fr);
    gap: var(--s-4);
    align-items: start;
    padding: var(--s-4) var(--s-5);
  }
  .chk--ok {
    padding-block: var(--s-3);
  }
  .chk--empty {
    display: block;
  }
  .chk__dot {
    margin-top: 7px;
  }
  .chk__main {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-width: 0;
  }
  .chk__title {
    font-size: 14px;
    font-weight: 600;
    color: var(--ink);
  }
  .chk__fix {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-wrap: anywhere;
  }
  .su-inline {
    padding: var(--s-4);
    border-radius: var(--r-panel);
    background: var(--sunken);
  }
  .su-consent__form {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-3);
    align-items: flex-end;
  }
  .su-consent__pick {
    flex: 1 1 240px;
  }
  .tag.is-off {
    color: var(--ink-3);
  }
  @media (max-width: 48rem) {
    .chk {
      padding: var(--s-4);
      gap: var(--s-3);
    }
  }
</style>
