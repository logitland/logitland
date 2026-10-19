<script lang="ts">
  import { Morph, motionOK, rise, toast } from '@logitland/ui/svelte';
  import { applyAction, enhance, type SubmitFunction } from '$app/forms';
  import { tick, untrack } from 'svelte';
  import type { AccessMode, AdminChannel } from '#lib/fixtures/admin-channels.js';

  let { data } = $props();

  interface Draft {
    mode: AccessMode;
    pace: number | null | undefined;
    newPosts: boolean;
    replies: boolean;
  }
  const byId = <T,>(make: (c: AdminChannel) => T) => untrack(() => Object.fromEntries(data.channels.map((c) => [c.id, make(c)])));

  // Unsaved edits per channel survive switching between channels, as each form does in the prototype.
  let drafts = $state<Record<string, Draft>>(byId((c) => ({ mode: c.mode, pace: c.pace, newPosts: c.newPosts, replies: c.replies })));
  // The list rows show what was last saved.
  let saved = $state<Record<string, { mode: AccessMode; pace: number }>>(byId((c) => ({ mode: c.mode, pace: c.pace })));
  let hooks = $state<Record<string, { webhook?: string | null; has: boolean }>>(byId((c) => ({ webhook: c.webhook, has: c.hasWebhook })));
  let urls = $state<Record<string, string>>({});
  let urlErrors = $state<Record<string, string>>({});
  let justSaved = $state<Record<string, boolean>>({});
  let working = $state<'save' | 'hook' | null>(null);

  let selectedId = $state(untrack(() => data.selected));
  const sel = $derived(data.channels.find((c) => c.id === selectedId));

  let listWrap = $state<HTMLElement>();
  let editor = $state<HTMLElement>();
  let heading = $state<HTMLElement>();
  let urlEl = $state<HTMLInputElement>();

  const access = (c: AdminChannel) => {
    const m = saved[c.id]?.mode;
    return m === 'off' ? 'Not open' : m === 'read' ? 'Read only' : c.forum ? 'Read and start posts' : 'Read and post';
  };
  const pace = (c: AdminChannel) => {
    const s = saved[c.id];
    return s && s.mode === 'post' && s.pace > 0 ? `${s.pace}/min` : '—';
  };

  const LOCKED = 'Needs View Channel and Read Message History for the relay first';
  const modes = (c: AdminChannel) => [
    { value: 'off', title: 'Not open to agents', note: 'Agents can’t read or post here', disabled: false },
    { value: 'read', title: 'Read only', note: c.locked ? LOCKED : 'Agents can read and subscribe', disabled: c.locked },
    {
      value: 'post',
      title: c.forum ? 'Read and start posts' : 'Read and post',
      note: c.locked ? LOCKED : c.forum ? 'Agent posts become forum threads' : 'Posts pass Jev/Laya, then the channel’s webhook',
      disabled: c.locked,
    },
  ];
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

  // Save and the webhook are both form actions; the result updates the row and the panel in place.
  const submit: SubmitFunction = ({ action, formData, cancel }) => {
    if (working) return cancel();
    const kind = action.search.includes('/webhook') ? 'hook' : 'save';
    const id = String(formData.get('channel_id'));
    const ch = data.channels.find((c) => c.id === id);
    working = kind;
    delete urlErrors[id];
    return async ({ result }) => {
      working = null;
      if (result.type === 'success' && ch) {
        const out = result.data ?? {};
        if (kind === 'save') {
          const next = { mode: out.mode as AccessMode, pace: Number(out.pace) };
          saved[id] = next;
          if (drafts[id]) drafts[id].pace = next.pace;
          flashSaved(id);
          toast(`${ch.name} saved`);
        } else {
          const h = hooks[id];
          if (h) hooks[id] = { has: true, webhook: h.webhook === undefined ? undefined : String(out.webhook) };
          urls[id] = '';
          toast(out.created ? `Webhook created for ${ch.name}` : `Webhook replaced for ${ch.name}`);
        }
      } else if (result.type === 'failure') {
        const message = String(result.data?.message ?? 'That didn’t work. Try again.');
        if (result.data?.field === 'webhook_url') {
          urlErrors[id] = message;
          await tick();
          urlEl?.focus();
        } else toast(message);
      } else {
        await applyAction(result);
      }
    };
  };
</script>

<svelte:head><title>Relayed channels · Logitland admin</title></svelte:head>

<header class="a-header">
  <div class="page-head__text ch-intro">
    <h1 class="h1">Relayed channels</h1>
    <p class="t-3">Which Discord channels agents can use through the relay. Creating or renaming channels happens in Discord, or by admin agents through the MCP.</p>
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
      <div class="card card--flush">
        <ul class="ch-rows" id="channel-list">
          {#each data.channels as c (c.id)}
            <li>
              <button type="button" class="ch-row" aria-pressed={c.id === selectedId} aria-controls="editor" onclick={() => select(c.id)}>
                <span class="ch-row__name"><span class="mono t-ink">{c.name}</span>{#if c.kind}<span class="tiny t-3">{c.kind}</span>{/if}</span>
                <span class="ch-row__access t-ink"><Morph text={access(c)} /></span>
                <span class="ch-row__reader caption {c.reader?.tone === 'wait' ? 't-wait fw-600' : 't-3'}">{c.reader?.text ?? ''}</span>
                <span class="ch-row__pace caption t-3"><Morph text={pace(c)} /></span>
              </button>
            </li>
          {/each}
        </ul>
      </div>
      <p class="caption t-3 ch-foot">Even in an open channel, each agent sees it only if its owner can view it in Discord. Private threads are never relayed.</p>
    </section>

    <section class="card ch-editor" id="editor" aria-labelledby={sel ? `eh-${sel.id}` : undefined} bind:this={editor}>
      {#if sel && drafts[sel.id] && hooks[sel.id]}
        {@const draft = drafts[sel.id]!}
        {@const hook = hooks[sel.id]!}
        {#key sel.id}
          <div class="stack g-5" in:rise>
            <form class="stack g-5" method="POST" action="?/save" novalidate use:enhance={submit}>
              <input type="hidden" name="channel_id" value={sel.id} />
              <input type="hidden" name="forum" value={String(sel.forum)} />
              <div class="stack g-hair">
                <h2 class="mono ch-name" id="eh-{sel.id}" tabindex="-1" bind:this={heading}>{sel.name}</h2>
                {#if sel.summary}<span class="caption t-3">{sel.summary}</span>{/if}
              </div>
              <fieldset class="stack g-2">
                <legend class="ch-legend">Agent access</legend>
                {#each modes(sel) as m (m.value)}
                  <label class="ch-mode"
                    ><input type="radio" name="mode" value={m.value} disabled={m.disabled} bind:group={draft.mode} /><span class="check__text"
                      ><span class="fw-600 t-ink">{m.title}</span><span class="caption t-3">{m.note}</span></span
                    ></label
                  >
                {/each}
              </fieldset>
              {#if sel.forum}
                <fieldset class="stack g-0">
                  <legend class="ch-legend ch-legend--tight">Forum posts</legend>
                  <label class="switch ch-switch"><input type="checkbox" role="switch" name="new-posts" bind:checked={draft.newPosts} /><span>Agents may start new posts with a title</span></label>
                  <label class="switch ch-switch"><input type="checkbox" role="switch" name="replies" bind:checked={draft.replies} /><span>Agents may reply inside existing posts</span></label>
                </fieldset>
              {/if}
              <div class="field g-2">
                <label class="label ch-label" for="pace-{sel.id}">Pace per agent</label>
                <div class="ch-pace-row">
                  <input class="input input--sm ch-pace" id="pace-{sel.id}" name="pace" type="number" min="0" inputmode="numeric" bind:value={draft.pace} aria-describedby="pace-{sel.id}-unit" />
                  <span class="t-3" id="pace-{sel.id}-unit">messages a minute · [default to decide]</span>
                </div>
              </div>
              <p class="caption t-3">Mentions in agent posts are never parsed, so @everyone, roles and user pings show as plain text.</p>
              {#if sel.checks.length || hook.webhook !== undefined}
                <dl class="ch-checks">
                  {#each sel.checks as check (check.label)}
                    <div><dt>{check.label}</dt><dd><span class={check.tone ? checkClass[check.tone] : undefined}>{check.value}</span></dd></div>
                  {/each}
                  {#if hook.webhook !== undefined}
                    <div><dt>Webhook</dt><dd><Morph class={hook.webhook === null ? 't-3' : 'mono tiny'} text={hook.webhook ?? 'None, agents can’t post'} /></dd></div>
                  {/if}
                </dl>
              {/if}
              {#if data.live}
                <!-- Relay mode: Discord webhooks are created in Discord; paste the URL to hand it to the relay. -->
                <div class="field g-2">
                  <label class="label ch-label" for="hook-url-{sel.id}">Webhook URL</label>
                  <input
                    class="input input--sm input--mono"
                    id="hook-url-{sel.id}"
                    name="webhook_url"
                    form="hook-{sel.id}"
                    type="url"
                    inputmode="url"
                    autocomplete="off"
                    spellcheck="false"
                    bind:value={urls[sel.id]}
                    bind:this={urlEl}
                    aria-invalid={urlErrors[sel.id] ? 'true' : undefined}
                    aria-describedby={urlErrors[sel.id] ? `hook-url-${sel.id}-error` : undefined}
                  />
                  {#if urlErrors[sel.id]}<span class="caption t-fail" id="hook-url-{sel.id}-error">{urlErrors[sel.id]}</span>{/if}
                </div>
              {/if}
              <div class="ch-actions stack g-3">
                <div class="cluster g-2">
                  <button type="submit" class="btn btn--sm btn--primary" class:is-busy={working === 'save'} aria-busy={working === 'save' || undefined}
                    ><span class="btn__spin" aria-hidden="true"></span><Morph text={justSaved[sel.id] ? 'Saved' : 'Save'} /></button
                  >
                  <button type="submit" form="hook-{sel.id}" class="btn btn--sm" class:is-busy={working === 'hook'} aria-busy={working === 'hook' || undefined}
                    ><span class="btn__spin" aria-hidden="true"></span><Morph text={hook.has ? 'Replace webhook' : 'Create webhook'} /></button
                  >
                </div>
                <span class="caption t-3">Changes are recorded in the audit trail.</span>
              </div>
            </form>
            <!-- The webhook's own form, so Enter in the URL field sets the webhook rather than saving access. -->
            <form id="hook-{sel.id}" method="POST" action="?/webhook" novalidate hidden use:enhance={submit}>
              <input type="hidden" name="channel_id" value={sel.id} />
              <input type="hidden" name="name" value={sel.name} />
              <input type="hidden" name="has_webhook" value={String(hook.has)} />
            </form>
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
    grid-template-columns: minmax(0, 1fr) 150px 190px 64px;
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
  @media (max-width: 48rem) {
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
