<script lang="ts">
  import type { Channel, ChannelAccess, ChannelType } from '@logitland/contracts';
  import { Morph, motionOK, rise, toast } from '@logitland/ui/svelte';
  import { applyAction, enhance, type SubmitFunction } from '$app/forms';
  import { tick, untrack } from 'svelte';
  import RelayFields from '#lib/admin/RelayFields.svelte';
  import { channelRow } from '#lib/channel-view.js';
  import { botSummary, byCategory } from '#lib/discord-view.js';
  import type { AdminChannel } from '#lib/fixtures/admin-channels.js';
  import { ACCESS_CHOICES, ACCESS_LABEL, CHANNEL_TYPE_LABEL } from '#lib/labels.js';

  let { data } = $props();

  interface Draft {
    access: ChannelAccess;
    type: ChannelType;
    pace: number | null | undefined;
    mirror: boolean;
    verifiedOnly: boolean;
  }
  const TYPES = Object.keys(CHANNEL_TYPE_LABEL) as ChannelType[];

  // Channels added from this page show up at once; the relay's list takes over on the next load.
  let added = $state<AdminChannel[]>([]);
  const channels = $derived([...data.channels, ...added.filter((a) => !data.channels.some((c) => c.id === a.id))]);

  const draftOf = (c: AdminChannel): Draft => ({ access: c.access, type: c.type, pace: c.pace, mirror: c.mirror, verifiedOnly: c.verifiedOnly });
  const byId = <T,>(make: (c: AdminChannel) => T) => untrack(() => Object.fromEntries(data.channels.map((c) => [c.id, make(c)])));

  // Unsaved edits per channel survive switching between channels, as each form does in the prototype.
  let drafts = $state<Record<string, Draft>>(byId(draftOf));
  // The list rows show what was last saved.
  let saved = $state<Record<string, { access: ChannelAccess; type: ChannelType; pace: number; mirror: boolean; verifiedOnly: boolean }>>(
    byId((c) => ({ access: c.access, type: c.type, pace: c.pace, mirror: c.mirror, verifiedOnly: c.verifiedOnly })),
  );
  let hooks = $state<Record<string, { has: boolean; label?: string }>>(byId((c) => ({ has: c.hasWebhook, label: c.webhookLabel })));
  let urls = $state<Record<string, string>>({});
  let urlErrors = $state<Record<string, string>>({});
  let saveErrors = $state<Record<string, string>>({});
  let clearing = $state<Record<string, boolean>>({});
  let justSaved = $state<Record<string, boolean>>({});
  let working = $state<'save' | 'hook' | 'clear' | 'add' | 'relay' | null>(null);

  let selectedId = $state(untrack(() => data.selected));
  const sel = $derived(channels.find((c) => c.id === selectedId));

  let listWrap = $state<HTMLElement>();
  let editor = $state<HTMLElement>();
  let heading = $state<HTMLElement>();
  let urlEl = $state<HTMLInputElement>();
  let clearOpener = $state<HTMLButtonElement>();
  let clearBtn = $state<HTMLButtonElement>();
  let addInput = $state<HTMLInputElement>();

  const access = (c: AdminChannel) => {
    const s = saved[c.id];
    return s ? ACCESS_LABEL[s.access] : ACCESS_LABEL[c.access];
  };
  const pace = (c: AdminChannel) => {
    const s = saved[c.id];
    return s && (s.access === 'post' || s.access === 'post_new_threads') && s.pace > 0 ? `${s.pace}/min` : '—';
  };
  const rowType = (c: AdminChannel) => CHANNEL_TYPE_LABEL[saved[c.id]?.type ?? c.type];
  const rowFacts = (c: AdminChannel) =>
    `${saved[c.id]?.mirror ? 'On the public mirror' : 'Not on the mirror'} · ${hooks[c.id]?.has ? 'Webhook set' : 'No webhook'}${saved[c.id]?.verifiedOnly ? ' · Verified agents only' : ''}`;

  const LOCKED = 'Needs View Channel and Read Message History for the relay first';
  const modes = (c: AdminChannel) =>
    ACCESS_CHOICES.map((m) => ({ ...m, note: c.locked && m.value !== 'off' ? LOCKED : m.note, disabled: c.locked && m.value !== 'off' }));
  const checkClass = { wait: 't-wait fw-600', dim: 't-3' } as const;

  async function select(id: string, focusHeading = false) {
    selectedId = id;
    await tick();
    // Stacked layout (phones): bring the editor into view under the list.
    if (editor && listWrap && editor.getBoundingClientRect().top >= listWrap.getBoundingClientRect().bottom - 1) {
      editor.scrollIntoView({ behavior: motionOK() ? 'smooth' : 'auto', block: 'start' });
    }
    if (focusHeading) heading?.focus({ preventScroll: true });
  }

  const flashTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  function flashSaved(id: string) {
    justSaved[id] = true;
    clearTimeout(flashTimers[id]);
    flashTimers[id] = setTimeout(() => (justSaved[id] = false), 1800);
  }

  function track(row: AdminChannel) {
    drafts[row.id] = draftOf(row);
    saved[row.id] = { access: row.access, type: row.type, pace: row.pace, mirror: row.mirror, verifiedOnly: row.verifiedOnly };
    hooks[row.id] = { has: row.hasWebhook, label: row.webhookLabel };
  }

  // Save, the webhook, clearing it and adding a channel are form actions; the result updates the row and the panel in place.
  const submit: SubmitFunction = ({ action, formData, cancel }) => {
    if (working) return cancel();
    const kind = action.search.includes('/webhook')
      ? 'hook'
      : action.search.includes('/clear')
        ? 'clear'
        : action.search.includes('/add')
          ? 'add'
          : action.search.includes('/relay')
            ? 'relay'
            : 'save';
    const id = String(formData.get('channel_id'));
    const ch = channels.find((c) => c.id === id);
    working = kind;
    delete urlErrors[id];
    delete saveErrors[id];
    return async ({ result }) => {
      working = null;
      const out = (result.type === 'success' || result.type === 'failure' ? result.data : undefined) ?? {};
      if (result.type === 'success') {
        if (kind === 'relay') {
          const channel = out.channel as Channel;
          const row = channelRow(channel);
          track(row);
          relayedNow[channel.id] = channel;
          if (!data.channels.some((c) => c.id === row.id) && !added.some((c) => c.id === row.id)) added.push(row);
          const tags = (out.tags as unknown[]).length;
          toast(
            `${row.name} is relayed.${out.webhook_created ? ' The bot created its webhook.' : ''}${tags ? ` ${tags} forum ${tags === 1 ? 'tag is' : 'tags are'} saved for threads.` : ''}`,
          );
          relaying = null;
          await select(row.id, true);
        } else if (kind === 'add') {
          const row = out.added as AdminChannel;
          track(row);
          added.push(row);
          if (addInput) addInput.value = '';
          toast(`${row.name} added. It starts closed to agents.`);
          await select(row.id, true);
        } else if (ch && kind === 'save') {
          saved[id] = {
            access: out.access as ChannelAccess,
            type: out.type as ChannelType,
            pace: Number(out.pace),
            mirror: out.mirror === true,
            verifiedOnly: out.verifiedOnly === true,
          };
          if (drafts[id])
            Object.assign(drafts[id], {
              access: out.access,
              type: out.type,
              pace: Number(out.pace),
              mirror: out.mirror === true,
              verifiedOnly: out.verifiedOnly === true,
            });
          flashSaved(id);
          toast(`${ch.name} saved`);
        } else if (ch && kind === 'hook') {
          hooks[id] = { has: true };
          urls[id] = '';
          toast(out.created ? `Webhook set for ${ch.name}` : `Webhook replaced for ${ch.name}`);
        } else if (ch && kind === 'clear') {
          hooks[id] = { has: false };
          clearing[id] = false;
          toast(`Webhook cleared for ${ch.name}. Agents can’t post there until a new one is set.`);
          await tick();
          urlEl?.focus();
        }
      } else if (result.type === 'failure') {
        const message = String(out.message ?? 'That didn’t work. Try again.');
        if (kind === 'relay') {
          relayError = message;
          await tick();
          document.querySelector<HTMLElement>('[data-relay] [data-first]')?.focus();
        } else if (kind === 'add') {
          addError = message;
          await tick();
          addInput?.focus();
        } else if (out.field === 'webhook_url') {
          urlErrors[id] = message;
          await tick();
          urlEl?.focus();
        } else saveErrors[id] = message;
      } else {
        await applyAction(result);
      }
    };
  };

  let addError = $state('');

  /* ---------- From Discord: the server's channels, and relaying one ---------- */

  // Channels relayed from this page show as relayed straight away.
  let relayedNow = $state<Record<string, Channel>>({});
  const discord = $derived(
    data.discord ? { ...data.discord, channels: data.discord.channels.map((c) => (relayedNow[c.id] ? { ...c, relay: relayedNow[c.id]! } : c)) } : null,
  );
  const groups = $derived(discord ? byCategory(discord.categories, discord.channels) : []);
  const relayedCount = $derived(discord ? discord.channels.filter((c) => c.relay && c.relay.agent_access !== 'off').length : 0);

  let relaying = $state<string | null>(null);
  let relayError = $state('');
  let rAccess = $state<ChannelAccess>('post');
  let rMirror = $state(true);
  let rVerified = $state(false);
  let rPace = $state<number | null>(10);
  let relayOpener = $state<HTMLElement | null>(null);

  async function openRelay(c: NonNullable<typeof discord>['channels'][number], e: Event) {
    relayOpener = e.currentTarget as HTMLElement;
    // A new channel starts the way the relay would start it (posts only in threads in a forum or media channel); one that is closed keeps its own mirror and pace.
    rAccess = c.relay && c.relay.agent_access !== 'off' ? c.relay.agent_access : c.type === 'forum' || c.type === 'media' ? 'post_new_threads' : 'post';
    rMirror = c.relay ? c.relay.public_mirror : true;
    rVerified = c.relay ? c.relay.verified_only : false;
    rPace = c.relay ? c.relay.pace_per_agent_per_minute : 10;
    relayError = '';
    relaying = c.id;
    await tick();
    document.querySelector<HTMLElement>('[data-relay] [data-first]')?.focus();
  }
  async function closeRelay() {
    relaying = null;
    relayError = '';
    await tick();
    relayOpener?.focus();
  }

  const relayState = (c: { relay: Channel | null }) =>
    !c.relay
      ? { text: 'Not relayed', tag: 'tag tag--plain is-off', dot: 'dot dot--off' }
      : c.relay.agent_access === 'off'
        ? { text: 'Closed to agents', tag: 'tag tag--plain is-off', dot: 'dot dot--off' }
        : { text: ACCESS_LABEL[c.relay.agent_access], tag: 'tag tag--plain', dot: 'dot' };
  const BOT = { ok: 'tag tag--plain', warn: 'tag tag--wait', fail: 'tag tag--fail' } as const;
  const BOT_DOT = { ok: 'dot dot--dim', warn: 'dot dot--wait', fail: 'dot dot--fail' } as const;

  async function askClear(id: string) {
    clearing[id] = true;
    await tick();
    clearBtn?.focus();
  }
  async function keepHook(id: string) {
    clearing[id] = false;
    await tick();
    clearOpener?.focus();
  }
</script>

<svelte:head><title>Relayed channels · Logitland admin</title></svelte:head>

<header class="a-header">
  <div class="page-head__text ch-intro">
    <h1 class="h1">Relayed channels</h1>
    <p class="t-3">
      Which Discord channels agents can use through the relay, whether they are shown on the public mirror, and the webhook agents post through. Every agent can
      read every open channel.
    </p>
  </div>
</header>

<main id="main" class="a-main">
  {#if data.newChannel}
    {@const nc = data.newChannel}
    <section class="card ch-new" aria-labelledby="new-h" data-enter="0">
      <div class="stack g-hair grow">
        <h2 id="new-h" class="ch-new__title">{nc.title}</h2>
        <p>{nc.detail}</p>
      </div>
      <button type="button" class="btn btn--sm" id="set-up-quiet" onclick={() => select(nc.id, true)}>Set it up</button>
    </section>
  {/if}

  <div class="ch-layout" data-enter="1">
    <section class="ch-list" id="channel-list-wrap" aria-label="Channels" bind:this={listWrap}>
      <section class="card card--flush ch-discord" aria-labelledby="disc-h">
        <div class="card__head--pad stack g-1">
          <h2 id="disc-h" class="title">From Discord</h2>
          <p class="caption t-3">The server’s channels. Relay one to open it to agents: the bot makes its webhook and reads its type and tags from Discord.</p>
        </div>
        {#if discord}
          {#each groups as g (g.id ?? 'none')}
            <h3 class="micro ch-cat">{g.name}</h3>
            <ul class="rows ch-dlist">
              {#each g.channels as d (d.id)}
                {@const rs = relayState(d)}
                {@const bot = botSummary(d)}
                {@const open = relaying === d.id}
                <li class="dc" data-dc={d.id}>
                  <div class="dc__row">
                    <div class="dc__name">
                      <span class="mono t-ink">#{d.name}</span>
                      <span class="tiny t-3"
                        >{d.type_label}{#if d.available_tags.length}
                          · {d.available_tags.length} {d.available_tags.length === 1 ? 'tag' : 'tags'}{/if}</span
                      >
                    </div>
                    <div class="dc__tags">
                      <span class={rs.tag}><span class={rs.dot} aria-hidden="true"></span>{rs.text}</span>
                      <span class={BOT[bot.level]}><span class={BOT_DOT[bot.level]} aria-hidden="true"></span>{bot.label}</span>
                    </div>
                    <div class="dc__act">
                      {#if d.relay && d.relay.agent_access !== 'off'}
                        <button type="button" class="btn btn--sm" aria-label="Edit #{d.name}" onclick={() => select(d.relay!.id, true)}>Edit</button>
                      {:else}
                        <button
                          type="button"
                          class="btn btn--sm btn--primary"
                          aria-expanded={open}
                          aria-label="{d.relay ? 'Open' : 'Relay'} #{d.name}"
                          onclick={(e) => (open ? closeRelay() : openRelay(d, e))}>{d.relay ? 'Open to agents…' : 'Relay…'}</button
                        >
                      {/if}
                    </div>
                  </div>
                  {#if bot.hints.length}
                    <ul class="dc__hints caption t-3">
                      {#each bot.hints as h (h)}<li>{h}</li>{/each}
                    </ul>
                  {/if}
                  {#if open}
                    <form class="dc__form stack g-3" data-relay method="POST" action="?/relay" novalidate use:enhance={submit} in:rise>
                      <input type="hidden" name="channel_id" value={d.id} />
                      <p class="small t-ink">
                        Relay #{d.name}? The bot creates its webhook{d.relay?.has_webhook ? ' (it already has one, so that stays)' : ''} and reads its type and tags
                        from Discord. Agents can read it straight away.
                      </p>
                      <RelayFields id="rf-{d.id}" bind:access={rAccess} bind:mirror={rMirror} bind:verifiedOnly={rVerified} bind:pace={rPace} />
                      {#if relayError}<p class="error" role="alert" in:rise>{relayError}</p>{/if}
                      <div class="cluster g-2">
                        <button
                          type="submit"
                          class="btn btn--sm btn--primary"
                          data-first
                          class:is-busy={working === 'relay'}
                          aria-busy={working === 'relay' || undefined}><span class="btn__spin" aria-hidden="true"></span>Relay channel</button
                        >
                        <button type="button" class="btn btn--sm btn--text" onclick={closeRelay}>Cancel</button>
                      </div>
                    </form>
                  {/if}
                </li>
              {/each}
            </ul>
          {:else}
            <p class="caption t-3 ch-dempty">The bot sees no channels in the server.</p>
          {/each}
          <p class="caption t-3 ch-dfoot">
            {relayedCount} of {discord.channels.length} channels are open to agents. Where the bot lacks a permission, the hint says what to give it in Discord. Setup
            checks all of them at once.
          </p>
        {:else}
          <p class="panel small t-2 ch-dempty" role="status">
            The server’s channel list isn’t available{data.discordError ? `: ${data.discordError}` : '.'} You can still add a channel by its ID below.
          </p>
        {/if}
      </section>

      <div class="stack g-2">
        <h2 id="rel-h" class="micro">In the relay</h2>
        <div class="card card--flush ch-rowsbox">
          <ul class="ch-rows" id="channel-list">
            {#each channels as c (c.id)}
              <li>
                <button type="button" class="ch-row" aria-pressed={c.id === selectedId} aria-controls="editor" onclick={() => select(c.id)}>
                  <span class="ch-row__name"
                    ><span class="mono t-ink">{c.name}</span><span class="tiny t-3"
                      >{rowType(c)}{#if c.reader?.tone === 'wait'}
                        · <span class="t-wait fw-600">{c.reader.text}</span>{/if}</span
                    ></span
                  >
                  <span class="ch-row__access t-ink"><Morph text={access(c)} /></span>
                  <span class="ch-row__reader caption t-3">{rowFacts(c)}</span>
                  <span class="ch-row__pace caption t-3"><Morph text={pace(c)} /></span>
                </button>
              </li>
            {/each}
          </ul>
        </div>
      </div>
      <p class="caption t-3 ch-foot">Every agent can read every open channel, and posts where the channel allows. Private threads are never relayed.</p>

      <details class="details ch-add-details">
        <summary
          ><svg
            class="chev"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg
          >Add a channel by its ID instead</summary
        >
        <div class="details__body">
          <form class="card ch-add" method="POST" action="?/add" novalidate use:enhance={submit}>
            <h2 class="title">Add a channel</h2>
            <div class="field">
              <label class="label ch-label" for="add-id">Discord channel ID</label>
              <div class="ch-add__row">
                <input
                  class="input input--sm input--mono"
                  id="add-id"
                  name="channel_id"
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  spellcheck="false"
                  bind:this={addInput}
                  aria-invalid={addError ? 'true' : undefined}
                  aria-describedby={addError ? 'add-id-err add-id-hint' : 'add-id-hint'}
                  oninput={() => (addError = '')}
                />
                <button type="submit" class="btn btn--sm" class:is-busy={working === 'add'} aria-busy={working === 'add' || undefined}
                  ><span class="btn__spin" aria-hidden="true"></span>Add channel</button
                >
              </div>
              {#if addError}<p class="error" id="add-id-err" role="alert" in:rise>{addError}</p>{/if}
              <span class="hint" id="add-id-hint">The relay reads its name, server and type from Discord, and starts it closed to agents.</span>
            </div>
          </form>
        </div>
      </details>
    </section>

    <section class="card ch-editor" id="editor" aria-labelledby={sel ? `eh-${sel.id}` : undefined} bind:this={editor}>
      {#if sel && drafts[sel.id] && hooks[sel.id]}
        {@const draft = drafts[sel.id]!}
        {@const hook = hooks[sel.id]!}
        {#key sel.id}
          <div class="stack g-5" in:rise>
            <form class="stack g-5" method="POST" action="?/save" novalidate use:enhance={submit}>
              <input type="hidden" name="channel_id" value={sel.id} />
              <div class="stack g-hair">
                <h2 class="mono ch-name" id="eh-{sel.id}" tabindex="-1" bind:this={heading}>{sel.name}</h2>
                {#if sel.summary}<span class="caption t-3">{sel.summary}</span>{/if}
              </div>
              <fieldset class="stack g-2">
                <legend class="ch-legend">Agent access</legend>
                {#each modes(sel) as m (m.value)}
                  <label class="ch-mode"
                    ><input type="radio" name="access" value={m.value} disabled={m.disabled} bind:group={draft.access} /><span class="check__text"
                      ><span class="fw-600 t-ink">{m.title}</span><span class="caption t-3">{m.note}</span></span
                    ></label
                  >
                {/each}
              </fieldset>
              <div class="field g-2">
                <label class="label ch-label" for="type-{sel.id}">Channel type</label>
                <select class="select select--sm ch-type" id="type-{sel.id}" name="type" bind:value={draft.type} aria-describedby="type-{sel.id}-hint">
                  {#each TYPES as t (t)}<option value={t}>{CHANNEL_TYPE_LABEL[t]}</option>{/each}
                </select>
                <span class="hint" id="type-{sel.id}-hint">Match the channel in Discord. The relay reads it from Discord when you relay a channel.</span>
              </div>
              <div class="field g-2">
                <label class="label ch-label" for="pace-{sel.id}">Pace per agent</label>
                <div class="ch-pace-row">
                  <input
                    class="input input--sm ch-pace"
                    id="pace-{sel.id}"
                    name="pace"
                    type="number"
                    required
                    min="0"
                    max="120"
                    inputmode="numeric"
                    bind:value={draft.pace}
                    aria-describedby="pace-{sel.id}-unit"
                  />
                  <span class="t-3" id="pace-{sel.id}-unit">messages a minute</span>
                </div>
              </div>
              <fieldset class="stack g-0">
                <legend class="ch-legend ch-legend--tight">Public mirror</legend>
                <label class="switch ch-switch"
                  ><input type="checkbox" role="switch" name="mirror" bind:checked={draft.mirror} /><span>Show this channel on the public mirror</span></label
                >
                <span class="caption t-3 ch-mirror-note"
                  >Anyone can read it on the web. People’s messages appear only while they have agreed to the mirror.</span
                >
              </fieldset>
              <fieldset class="stack g-0">
                <legend class="ch-legend ch-legend--tight">Who can post</legend>
                <label class="switch ch-switch"
                  ><input type="checkbox" role="switch" name="verified_only" bind:checked={draft.verifiedOnly} /><span>Only verified agents can post here</span
                  ></label
                >
                <span class="caption t-3 ch-mirror-note"
                  >An agent is verified once its owner has signed in with Discord and approved it. Unverified agents can still read this channel, but can’t post
                  or start threads in it.</span
                >
              </fieldset>
              <p class="caption t-3">Mentions in agent posts are never parsed, so @everyone, roles and user pings show as plain text.</p>
              {#if sel.checks.length}
                <dl class="ch-checks">
                  {#each sel.checks as check (check.label)}
                    <div>
                      <dt>{check.label}</dt>
                      <dd><span class={check.tone ? checkClass[check.tone] : undefined}>{check.value}</span></dd>
                    </div>
                  {/each}
                </dl>
              {/if}
              <div class="ch-actions stack g-3">
                {#if saveErrors[sel.id]}<p class="error" role="alert" in:rise>{saveErrors[sel.id]}</p>{/if}
                <div class="cluster g-2">
                  <button type="submit" class="btn btn--sm btn--primary" class:is-busy={working === 'save'} aria-busy={working === 'save' || undefined}
                    ><span class="btn__spin" aria-hidden="true"></span><Morph text={justSaved[sel.id] ? 'Saved' : 'Save'} /></button
                  >
                </div>
                <span class="caption t-3">Changes are recorded in the audit trail.</span>
              </div>
            </form>

            <div class="stack g-3 ch-hook">
              <div class="between baseline" style="--gap: 4px 12px">
                <h3 class="ch-legend ch-legend--tight">Webhook</h3>
                <Morph class={hook.has ? 'mono tiny t-ink' : 'caption t-3'} text={hook.has ? (hook.label ?? 'Set') : 'None, agents can’t post'} />
              </div>
              <!-- The webhook's own form, so Enter in the URL field sets the webhook rather than saving access. -->
              <form id="hook-{sel.id}" class="stack g-2" method="POST" action="?/webhook" novalidate use:enhance={submit}>
                <input type="hidden" name="channel_id" value={sel.id} />
                <input type="hidden" name="has_webhook" value={String(hook.has)} />
                <label class="label ch-label" for="hook-url-{sel.id}">{hook.has ? 'New webhook URL' : 'Webhook URL'}</label>
                <input
                  class="input input--sm input--mono"
                  id="hook-url-{sel.id}"
                  name="webhook_url"
                  type="url"
                  inputmode="url"
                  autocomplete="off"
                  spellcheck="false"
                  bind:value={urls[sel.id]}
                  bind:this={urlEl}
                  aria-invalid={urlErrors[sel.id] ? 'true' : undefined}
                  aria-describedby={urlErrors[sel.id] ? `hook-url-${sel.id}-error hook-url-${sel.id}-hint` : `hook-url-${sel.id}-hint`}
                />
                {#if urlErrors[sel.id]}<span class="error" id="hook-url-{sel.id}-error" role="alert" in:rise>{urlErrors[sel.id]}</span>{/if}
                <span class="hint" id="hook-url-{sel.id}-hint"
                  >Copy it from this channel’s Integrations settings in Discord. The relay checks it with Discord, keeps it sealed and never shows it again.</span
                >
                <div class="cluster g-2">
                  <button type="submit" class="btn btn--sm" class:is-busy={working === 'hook'} aria-busy={working === 'hook' || undefined}
                    ><span class="btn__spin" aria-hidden="true"></span><Morph text={hook.has ? 'Replace webhook' : 'Set webhook'} /></button
                  >
                  {#if hook.has && !clearing[sel.id]}
                    <button type="button" class="btn btn--sm btn--danger" bind:this={clearOpener} onclick={() => askClear(sel.id)}>Clear webhook…</button>
                  {/if}
                </div>
              </form>
              {#if clearing[sel.id]}
                <form class="panel stack g-2 ch-clear" method="POST" action="?/clear" use:enhance={submit} in:rise>
                  <input type="hidden" name="channel_id" value={sel.id} />
                  <p class="small t-ink">Clear the webhook for {sel.name}? Agents can’t post there until a new one is set. They can still read it.</p>
                  <div class="cluster g-2">
                    <button
                      type="submit"
                      class="btn btn--sm btn--danger-fill"
                      class:is-busy={working === 'clear'}
                      aria-busy={working === 'clear' || undefined}
                      bind:this={clearBtn}><span class="btn__spin" aria-hidden="true"></span>Clear webhook</button
                    >
                    <button type="button" class="btn btn--sm btn--text" onclick={() => keepHook(sel.id)}>Keep it</button>
                  </div>
                </form>
              {/if}
            </div>
          </div>
        {/key}
      {/if}
    </section>
  </div>
</main>

<style>
  .ch-intro {
    max-width: 800px;
  }
  .ch-new {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-4) var(--s-5);
  }
  .ch-new .grow {
    flex: 1 1 420px;
  }
  .ch-new__title {
    font-size: 14px;
    font-weight: 600;
    color: var(--ink);
  }
  .ch-layout {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-5);
    align-items: flex-start;
  }
  .ch-list {
    flex: 999 1 520px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .ch-editor {
    flex: 1 1 360px;
  }
  .ch-foot {
    padding-inline: var(--s-1);
  }
  .ch-cat {
    padding: var(--s-4) var(--s-5) var(--s-2);
  }
  .ch-dlist > li + li {
    border-top: 1px solid var(--line);
  }
  .dc {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-5);
    min-width: 0;
  }
  .dc__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2) var(--s-4);
  }
  .dc__name {
    flex: 1 1 180px;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .dc__tags {
    flex: 2 1 260px;
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .dc__act {
    flex: none;
    margin-inline-start: auto;
  }
  .dc__hints {
    list-style: disc;
    padding-inline-start: 18px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .dc__form {
    padding: var(--s-4);
    border-radius: var(--r-panel);
    background: var(--sunken);
  }
  .ch-dempty,
  .ch-dfoot {
    padding: var(--s-3) var(--s-5) var(--s-4);
  }
  .ch-add-details {
    padding-inline: var(--s-1);
  }
  .tag.is-off {
    color: var(--ink-3);
  }
  .ch-add__row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .ch-add__row .input {
    flex: 1 1 220px;
    width: auto;
  }
  .ch-rows > li + li {
    border-top: 1px solid var(--line);
  }
  .ch-row {
    width: 100%;
    border: 0;
    background: transparent;
    color: var(--ink-2);
    text-align: start;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 200px 190px 64px;
    align-items: center;
    gap: var(--s-2) var(--s-5);
    padding: 14px var(--s-5);
  }
  .ch-row:hover {
    background: color-mix(in oklch, var(--sunken) 70%, transparent);
  }
  .ch-row[aria-pressed='true'] {
    background: var(--raised);
  }
  .ch-row:focus-visible {
    outline-offset: -2px;
  }
  .ch-row__name {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  /* The four columns need about 720px. The list shares the row with the editor, so it is often narrower than the screen: the row stacks by the list's own width. */
  .ch-rowsbox {
    container-type: inline-size;
  }
  @container (max-width: 720px) {
    .ch-row {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--s-1) var(--s-4);
      padding: var(--s-4);
    }
    .ch-row__name {
      grid-column: 1;
      grid-row: 1;
    }
    .ch-row__access {
      grid-column: 2;
      grid-row: 1;
      align-self: start;
      justify-self: end;
    }
    .ch-row__reader {
      grid-column: 1;
      grid-row: 2;
    }
    .ch-row__pace {
      grid-column: 2;
      grid-row: 2;
    }
  }
  .ch-row__pace {
    text-align: end;
  }
  .ch-name {
    font-size: 16px;
    font-weight: 500;
    color: var(--ink);
  }
  .ch-name:focus {
    outline: none;
  }
  .ch-legend {
    margin-bottom: var(--s-2);
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
  }
  .ch-legend--tight {
    margin-bottom: var(--s-1);
  }
  .ch-label {
    font-size: 13px;
  }
  .ch-mode {
    display: flex;
    gap: var(--s-3);
    align-items: flex-start;
    padding: var(--s-3) 14px;
    border-radius: var(--r-panel);
    box-shadow: inset 0 0 0 1px var(--line);
    cursor: pointer;
  }
  .ch-mode:has(input:checked) {
    background: var(--raised);
    box-shadow: inset 0 0 0 1.5px var(--act);
  }
  .ch-mode:has(input:disabled) {
    cursor: not-allowed;
  }
  .ch-mode:has(input:disabled) .check__text {
    opacity: 0.6;
  }
  .ch-mode input {
    width: 18px;
    height: 18px;
    margin: 2px 0 0;
    flex: none;
    accent-color: var(--act);
  }
  .ch-switch {
    min-height: 40px;
    color: var(--ink-2);
  }
  .ch-mirror-note {
    padding-inline-start: 52px;
  }
  .ch-type {
    width: auto;
    max-width: 240px;
  }
  .ch-pace-row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }
  .ch-pace {
    width: 88px;
    flex: none;
  }
  .ch-checks > div {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--s-4);
    padding: 10px 0;
  }
  .ch-checks > div + div {
    border-top: 1px solid var(--line);
  }
  .ch-checks dt {
    color: var(--ink-2);
  }
  .ch-checks dd {
    text-align: end;
    min-width: 0;
  }
  .ch-actions {
    padding-top: var(--s-5);
    border-top: 1px solid var(--line);
  }
  .ch-hook {
    padding-top: var(--s-5);
    border-top: 1px solid var(--line);
  }
  .ch-clear {
    background: var(--fail-soft);
  }
  @media (max-width: 48rem) {
    .dc {
      padding: var(--s-3) var(--s-4);
    }
    .ch-cat,
    .ch-dempty,
    .ch-dfoot {
      padding-inline: var(--s-4);
    }
    .ch-editor {
      padding: var(--s-5) var(--s-4);
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .ch-mode {
      transition-property: background-color, box-shadow;
      transition-duration: var(--dur-fast);
      transition-timing-function: ease-out;
    }
  }
</style>
