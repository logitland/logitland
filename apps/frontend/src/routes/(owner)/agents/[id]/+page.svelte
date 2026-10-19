<script lang="ts">
  import { applyAction, enhance, type ActionResult } from '$app/forms';
  import { CopyButton, Flock, Morph, motionOK, rise, fold, toast } from '@logitland/ui/svelte';
  import { tick } from 'svelte';
  import type { KeyRow } from '#lib/fixtures/agent.js';
  import type { SubmitFunction } from './$types';

  let { data } = $props();
  const agent = $derived(data.agent);

  type KeyState = 'idle' | 'ask' | 'stopped' | 'revoked';
  type KeyView = KeyRow & { state: KeyState };
  type Issued = { id: string; secret: string; detail: string };

  // Page state starts from the agent and resets if the route moves to another agent.
  let offState = $derived<'on' | 'confirm' | 'off'>(data.agent.status === 'off' ? 'off' : 'on');
  let keys = $derived<KeyView[]>(data.agent.keys.map((k) => ({ ...k, state: k.revoked ? 'revoked' : data.agent.status === 'off' ? 'stopped' : 'idle' })));
  const isOff = $derived(offState === 'off');
  const activeCount = $derived(keys.filter((k) => k.state === 'idle' || k.state === 'ask').length);
  const keyLine = $derived(
    activeCount === 0 ? 'No active keys are left to reject' : activeCount === 1 ? '1 active key is rejected on its next call' : `${activeCount} active keys are rejected on their next call`,
  );

  let pending = $state<string | null>(null);

  async function failed(result: ActionResult) {
    if (result.type === 'failure') toast(String(result.data?.message ?? ''));
    else await applyAction(result);
  }

  /* ---------- Section nav: aria-current follows the section at the top of the view ---------- */

  const sections = $derived([
    ...(data.agent.overview ? [{ id: 'overview', label: 'Overview' }] : []),
    { id: 'keys', label: 'Keys' },
    { id: 'channels', label: 'Channels' },
    { id: 'profile', label: 'Profile' },
  ]);
  let current = $derived(sections[0]!.id);
  let endMark = $state<HTMLElement>();
  let locked = false;
  let unlockTimer: ReturnType<typeof setTimeout> | undefined;
  const BAND_TOP = 80;

  $effect(() => {
    const targets = sections.map((s) => document.getElementById(s.id)).filter((t): t is HTMLElement => !!t);
    if (!endMark || !targets.length) return;
    const inBand = new Set<Element>();
    let atEnd = false;
    const pick = () => {
      if (locked) return;
      let t = atEnd ? targets.at(-1) : targets.find((s) => inBand.has(s));
      if (!t && targets[0]!.getBoundingClientRect().top > BAND_TOP) t = targets[0];
      if (t) current = t.id;
    };
    const band = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) inBand.add(e.target);
          else inBand.delete(e.target);
        }
        pick();
      },
      { rootMargin: `-${BAND_TOP}px 0px -70% 0px` },
    );
    targets.forEach((t) => band.observe(t));
    const end = new IntersectionObserver(([e]) => {
      atEnd = !!e?.isIntersecting;
      pick();
    });
    end.observe(endMark);
    return () => {
      band.disconnect();
      end.disconnect();
    };
  });

  // The link's own fragment navigation does the scrolling; it is smooth only when motion is allowed.
  function jump(id: string) {
    current = id;
    locked = true;
    const root = document.documentElement;
    if (motionOK()) root.classList.add('is-jumping');
    const release = () => {
      locked = false;
      root.classList.remove('is-jumping');
      clearTimeout(unlockTimer);
      removeEventListener('scrollend', release);
    };
    clearTimeout(unlockTimer);
    addEventListener('scrollend', release, { once: true });
    unlockTimer = setTimeout(release, 1200);
  }

  /* ---------- Sparkline: redrawn at its real size so the end mark stays round ---------- */

  let sparkEl = $state<SVGSVGElement>();
  let sparkBox = $state({ w: 0, h: 0 });
  $effect(() => {
    const el = sparkEl;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      sparkBox = { w: r.width, h: r.height };
    });
    ro.observe(el);
    return () => ro.disconnect();
  });
  const spark = $derived.by(() => {
    const peaks = data.agent.overview?.find((s) => s.spark)?.spark?.peaks;
    const { w, h } = sparkBox;
    if (!peaks?.length || !w || !h) return null;
    const pad = 3;
    const max = Math.max(...peaks) || 1;
    const pts = peaks.map((v, i) => [pad + (i / (peaks.length - 1)) * (w - pad * 2), h - pad - (v / max) * (h - pad * 2)] as const);
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const [ex, ey] = pts.at(-1)!;
    return {
      viewBox: `0 0 ${w.toFixed(1)} ${h.toFixed(1)}`,
      line,
      area: `${line} L${ex.toFixed(1)} ${h} L${pts[0]![0].toFixed(1)} ${h} Z`,
      ex: ex.toFixed(1),
      ey: ey.toFixed(1),
    };
  });

  /* ---------- Keys: inline confirm, then the row folds away and the count follows ---------- */

  let keysHeading = $state<HTMLElement>();
  const keyControl = (id: string) => document.querySelector<HTMLElement>(`[data-key="${id}"] .key__act button, [data-key="${id}"] [data-focus]`);

  async function setKey(id: string, state: 'idle' | 'ask') {
    keys = keys.map((k) => (k.id === id ? { ...k, state } : k));
    await tick();
    keyControl(id)?.focus();
  }

  function revoke(id: string): SubmitFunction {
    return ({ cancel }) => {
      if (pending) return cancel();
      pending = `revoke:${id}`;
      return async ({ result }) => {
        pending = null;
        if (result.type !== 'success') return failed(result);
        const live = keys.filter((k) => k.state === 'idle' || k.state === 'ask');
        const i = live.findIndex((k) => k.id === id);
        const next = live[i + 1] ?? live[i - 1];
        keys = keys.filter((k) => k.id !== id);
        toast(`Revoked ${id}. Its next call is rejected.`);
        await tick();
        (next ? keyControl(next.id) : keysHeading)?.focus();
      };
    };
  }

  /* ---------- Issue a key: shown once, in a dialog that stays until the owner says it's stored ---------- */

  let issued = $state<Issued | null>(null);
  let stored = $state(false);
  let keyDialog = $state<HTMLDialogElement>();
  let keybox = $state<HTMLElement>();
  let issueBtn = $state<HTMLButtonElement>();

  const issue: SubmitFunction = ({ cancel }) => {
    if (pending) return cancel();
    pending = 'issue';
    return async ({ result }) => {
      pending = null;
      if (result.type !== 'success' || !result.data || !('issued' in result.data)) return failed(result);
      const k = result.data.issued;
      keys = [{ id: k.id, detail: k.detail, lastUsed: 'Not used yet', state: 'idle' }, ...keys];
      issued = k;
      stored = false;
      await tick();
      keyDialog?.showModal();
      keybox?.querySelector('button')?.focus();
    };
  };

  function closedKey() {
    issueBtn?.focus();
    // Drop the secret once the dialog has faded out; it is never shown again.
    setTimeout(() => (issued = null), 300);
  }

  /* ---------- Profile: the preview name follows the field, morphing while it fits on one line ---------- */

  let shownName = $derived(data.agent.name);
  let plainName = $derived<string | null>(null);
  let pvText = $state<HTMLElement>();
  let pvName = $state<HTMLElement>();
  let pvTime = $state<HTMLElement>();
  let measure: CanvasRenderingContext2D | null = null;

  function fitsOneLine(text: string): boolean {
    if (!pvText || !pvName) return true;
    measure ??= document.createElement('canvas').getContext('2d');
    if (!measure) return true;
    const cs = getComputedStyle(pvName);
    measure.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const room = pvText.getBoundingClientRect().width - (pvTime?.getBoundingClientRect().width ?? 0) - 8;
    return measure.measureText(text).width <= room;
  }

  function nameInput(e: Event & { currentTarget: HTMLInputElement }) {
    const text = e.currentTarget.value.trim() || data.agent.name;
    if (fitsOneLine(text)) {
      plainName = null;
      shownName = text;
    } else {
      plainName = text;
    }
  }

  // Fixtures-only: the relay has no endpoint for profile changes yet, so the action only simulates the save.
  const saveProfile: SubmitFunction = ({ cancel }) => {
    if (pending) return cancel();
    pending = 'profile';
    return async ({ result }) => {
      pending = null;
      if (result.type === 'success') toast('Profile saved');
      else await failed(result);
    };
  };

  /* ---------- Turn off: confirm, then keys stop and the count drops to zero ---------- */

  let offOpener = $state<HTMLButtonElement>();
  let offPanel = $state<HTMLElement>();
  let offDone = $state<HTMLElement>();

  async function setOff(state: 'on' | 'confirm') {
    offState = state;
    await tick();
    (state === 'confirm' ? offPanel : offOpener)?.focus();
  }

  const turnOff: SubmitFunction = ({ cancel }) => {
    if (pending) return cancel();
    pending = 'off';
    return async ({ result }) => {
      pending = null;
      if (result.type !== 'success') return failed(result);
      offState = 'off';
      keys = keys.map((k) => (k.state === 'idle' || k.state === 'ask' ? { ...k, state: 'stopped' } : k));
      await tick();
      offDone?.focus();
    };
  };
</script>

<svelte:head><title>{agent.name} · Logitland</title></svelte:head>

<main id="main" class="o-main">
  <div class="stack" data-enter="0">
    <a class="crumb" href="/agents">Agents</a>
    <div class="between" style="--gap: 16px 24px">
      <div class="ident">
        <Flock id={agent.id} size={64} off={isOff} />
        <div class="stack g-1">
          <div class="cluster">
            <h1 class="h1">{agent.name}</h1>
            <span class="tag tag--plain"><span class="dot" class:dot--off={isOff} aria-hidden="true"></span><Morph text={isOff ? 'Off' : agent.statusLabel} /></span>
          </div>
          <span class="small t-3"><span class="mono tiny">{agent.id}</span> · {agent.registered}</span>
        </div>
      </div>
      <!-- The relay refuses new keys for an agent that is off, so the button goes with it. -->
      {#if !isOff}
        <form method="POST" action="?/issue" use:enhance={issue}>
          <button class="btn btn--primary" class:is-busy={pending === 'issue'} aria-busy={pending === 'issue'} bind:this={issueBtn}><span class="btn__spin" aria-hidden="true"></span>Issue a key</button>
        </form>
      {/if}
    </div>
  </div>

  <nav class="secnav" id="secnav" aria-label="On this page" data-enter="1">
    {#each sections as s (s.id)}
      <a class="nav-pill" href="#{s.id}" aria-current={current === s.id ? 'true' : undefined} onclick={() => jump(s.id)}>{s.label}</a>
    {/each}
  </nav>

  {#if agent.overview}
    <section id="overview" class="jump" aria-label="Overview" data-enter="2">
      <dl class="grid-2" style="--min: 240px">
        {#each agent.overview as s (s.label)}
          <div class="stat stat--lg">
            <dt class="stat__label">{s.label}</dt>
            <dd class="stat__value" class:t-wait={s.tone === 'wait'}>{s.value}{#if s.of}<span class="ov-of">{s.of}</span>{/if}</dd>
            {#if s.spark}
              <dd class="ov-spark">
                <svg class="spark" style="--h: 36px" role="img" aria-label={s.spark.label} viewBox={spark?.viewBox} bind:this={sparkEl}>
                  {#if spark}<path class="spark-area" d={spark.area} /><path class="spark-line" d={spark.line} pathLength="1" /><circle class="spark-end" cx={spark.ex} cy={spark.ey} r="3" />{/if}
                </svg>
              </dd>
            {/if}
            {#if s.link}<dd><a class="link" href={s.link.href}>{s.link.label}</a></dd>{/if}
          </div>
        {/each}
      </dl>
    </section>
  {/if}

  <section id="keys" class="stack g-3 jump" aria-labelledby="keys-h" data-enter="3">
    <div class="between baseline" style="--gap: 8px 16px">
      <div class="cluster baseline g-2">
        <h2 id="keys-h" class="micro" tabindex="-1" bind:this={keysHeading}>Keys</h2>
        <Morph id="key-count" class="caption t-3" text="{activeCount} active" />
      </div>
      <p class="caption t-3">Only a hash is stored. Revoking takes effect on the agent’s next call.</p>
    </div>
    <ul class="card card--flush rows" id="key-list">
      {#each keys as k (k.id)}
        <li class="row" data-key={k.id} in:rise out:fold>
          <div class="row__main">
            <span class="mono t-ink">{k.id}</span>
            <span class="caption t-3">{k.detail}</span>
          </div>
          <div class="stat key__used">
            <span class="stat__label">Last used</span>
            <span class="small" class:t-3={k.state === 'stopped' || k.state === 'revoked'}>{k.lastUsed}</span>
          </div>
          <div class="key__act">
            {#if k.state === 'idle'}
              <button type="button" class="btn btn--danger btn--sm" aria-label="Revoke {k.id}" onclick={() => setKey(k.id, 'ask')} in:rise>Revoke</button>
            {:else if k.state === 'ask'}
              <!-- Escape backs out of the inline confirm, as in the prototype; the buttons inside are the interactive parts. -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <form class="cluster g-2" method="POST" action="?/revoke" use:enhance={revoke(k.id)} onkeydown={(e) => e.key === 'Escape' && setKey(k.id, 'idle')} in:rise>
                <input type="hidden" name="key" value={k.id} />
                <span class="small fw-600" tabindex="-1" data-focus>Revoke this key?</span>
                <button class="btn btn--danger-fill btn--sm" class:is-busy={pending === `revoke:${k.id}`} aria-busy={pending === `revoke:${k.id}`} aria-label="Revoke {k.id} now"><span class="btn__spin" aria-hidden="true"></span>Revoke</button>
                <button type="button" class="btn btn--sm" onclick={() => setKey(k.id, 'idle')}>Cancel</button>
              </form>
            {:else if k.state === 'stopped'}
              <span class="caption t-3" in:rise>Stopped</span>
            {:else}
              <span class="caption t-3">{k.revoked}</span>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  </section>

  <section id="channels" class="stack g-3 jump" aria-labelledby="ch-h" data-enter="4">
    <div class="between baseline" style="--gap: 8px 16px">
      <h2 id="ch-h" class="micro">Channels</h2>
      <p class="caption t-3">Greyed boxes are set by Discord or relay admins, not by you.</p>
    </div>
    <!-- As in the prototype, nothing here is saved: the relay has no endpoint for per-agent channel access yet. -->
    <div class="card card--flush">
      <div class="table-scroll">
        <table class="ch-table">
          <thead>
            <tr>
              <th scope="col">Channel</th>
              <th scope="col" class="ch-c">Read</th>
              <th scope="col" class="ch-c">Post</th>
              <th scope="col" class="ch-c ch-c--wide">Subscribe</th>
              <th scope="col">Why</th>
            </tr>
          </thead>
          <tbody>
            {#each agent.channels as c (c.name)}
              <tr>
                <td class="mono" class:t-ink={!c.muted} class:t-3={c.muted}>{c.name}</td>
                <td class="ch-c"><input type="checkbox" aria-label="Read {c.name}" checked={c.read.on} disabled={c.read.locked} /></td>
                <td class="ch-c"><input type="checkbox" aria-label="Post in {c.name}" checked={c.post.on} disabled={c.post.locked} /></td>
                <td class="ch-c"><input type="checkbox" aria-label="Subscribe to {c.name}" checked={c.subscribe.on} disabled={c.subscribe.locked} /></td>
                <td class="small t-2">{c.why}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <div id="profile" class="grid-2 jump" style="--min: 420px" data-enter="5">
    <section class="card" aria-labelledby="profile-h">
      <h2 id="profile-h" class="title">Profile</h2>
      <figure class="stack g-2">
        <div class="panel pv">
          <Flock id={agent.id} size={40} />
          <div class="stack g-0 pv__text" bind:this={pvText}>
            <span class="small pv__line">
              <strong class="fw-600 pv__name" bind:this={pvName}><Morph id="pv-name" text={shownName} hidden={plainName !== null} /><span id="pv-name-plain" hidden={plainName === null}>{plainName}</span></strong>
              {#if agent.profile.preview.time}<span class="t-3 pv__time" bind:this={pvTime}>{agent.profile.preview.time}</span>{/if}
            </span>
            <span class="small t-2">{agent.profile.preview.text}</span>
          </div>
        </div>
        <figcaption class="caption t-3">How posts look in Discord. Logitland tells agents apart by ID, not by this name.</figcaption>
      </figure>
      <form class="pf" method="POST" action="?/profile" use:enhance={saveProfile}>
        <div class="field">
          <label class="label" for="p-name">Display name</label>
          <input class="input" id="p-name" name="name" type="text" value={agent.name} autocomplete="off" oninput={nameInput} />
        </div>
        <div class="field">
          <label class="label" for="p-avatar">Avatar image URL <span class="label__opt">· optional, its flock mark otherwise</span></label>
          <input class="input input--mono" id="p-avatar" name="avatar_url" type="url" value={agent.profile.avatarUrl} placeholder="https://…/avatar.png" />
        </div>
        <div class="field">
          <label class="label" for="p-purpose">What it does</label>
          <textarea class="textarea" id="p-purpose" name="description" rows="3" value={agent.profile.purpose}></textarea>
        </div>
        <button class="btn self-start" class:is-busy={pending === 'profile'} aria-busy={pending === 'profile'}><span class="btn__spin" aria-hidden="true"></span>Save profile</button>
      </form>
    </section>

    <section class="card" aria-labelledby="stop-h">
      <h2 id="stop-h" class="title">Turn {agent.name} off</h2>
      {#if offState === 'on'}
        <div class="stack" in:rise>
          <p class="small t-2">{agent.off.intro}</p>
          <button type="button" class="btn btn--danger self-start" bind:this={offOpener} onclick={() => setOff('confirm')}>Turn off…</button>
        </div>
      {:else if offState === 'confirm'}
        <div class="panel stack off-ask" role="group" aria-label="Confirm turning {agent.name} off" tabindex="-1" bind:this={offPanel} in:rise>
          <ul class="off-list small">
            <li>{keyLine}</li>
            {#each agent.off.effects as line (line)}<li>{line}</li>{/each}
          </ul>
          <form class="cluster" method="POST" action="?/off" use:enhance={turnOff}>
            <button class="btn btn--danger-fill" class:is-busy={pending === 'off'} aria-busy={pending === 'off'}><span class="btn__spin" aria-hidden="true"></span>Turn {agent.name} off</button>
            <button type="button" class="btn" onclick={() => setOff('on')}>Keep it on</button>
          </form>
        </div>
      {:else}
        <p class="panel small t-2" role="status" tabindex="-1" bind:this={offDone} in:rise>{agent.name} is off. Its keys are rejected and its subscriptions have stopped.</p>
      {/if}
      <p class="caption t-3 stop-foot">Ownership can’t be transferred in v1.</p>
    </section>
    <span class="end-mark" bind:this={endMark} aria-hidden="true"></span>
  </div>
</main>

<dialog
  class="modal"
  aria-labelledby="key-h"
  aria-describedby="key-lede"
  bind:this={keyDialog}
  oncancel={(e) => !stored && e.preventDefault()}
  onkeydowncapture={(e) => e.key === 'Escape' && !stored && e.preventDefault()}
  onclose={closedKey}
>
  <div class="modal__body">
    <div class="stack g-2">
      <h2 class="h2" id="key-h">Copy {agent.name}’s key now</h2>
      <p class="t-2" id="key-lede">This is the only time it’s shown. Logitland keeps a hash, not the key.</p>
    </div>
    <div class="stack g-2">
      <div class="keybox" bind:this={keybox}>
        <code>{issued?.secret}</code>
        <CopyButton value={issued?.secret ?? ''} status="Key copied to the clipboard" />
      </div>
      <span class="caption t-3"><span class="mono tiny">{issued?.id}</span> · {issued?.detail}</span>
    </div>
    <p class="small t-2">Keep it in the agent’s secret store. Anyone holding it can post as {agent.name} under your name.</p>
    <div class="between key-rule">
      <label class="check key-stored"><input type="checkbox" bind:checked={stored} /><span>I’ve stored this key</span></label>
      <button type="button" class="btn btn--primary" disabled={!stored} onclick={() => keyDialog?.close()}>Done</button>
    </div>
  </div>
</dialog>

<style>
  .secnav {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
    padding-block: var(--s-2);
    margin-block: calc(-1 * var(--s-2));
    background: var(--ground);
  }
  .secnav .nav-pill {
    min-height: 36px;
    padding: 0 14px;
  }
  .secnav .nav-pill[aria-current='true'] {
    background: var(--ink);
    color: var(--surface);
    font-weight: 600;
  }
  .jump {
    scroll-margin-top: 72px;
  }
  :global(html.is-jumping) {
    scroll-behavior: smooth;
  }

  .stat__value.t-wait {
    color: var(--wait);
  }
  .ov-of {
    font-family: var(--font-text);
    font-size: 15px;
    font-weight: 500;
    letter-spacing: 0;
    color: var(--ink-3);
  }
  .ov-spark {
    margin-top: var(--s-2);
  }

  .key__used {
    min-width: 120px;
  }
  .key__act {
    min-width: 148px;
    margin-inline-start: auto;
    display: flex;
    justify-content: flex-end;
    text-align: end;
  }
  .key__act > .cluster {
    justify-content: flex-end;
  }

  .ch-table {
    width: 100%;
    min-width: 640px;
    border-collapse: collapse;
  }
  .ch-table th {
    padding: var(--s-4) var(--s-2) var(--s-2);
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-3);
    text-align: start;
  }
  .ch-table td {
    padding: 14px var(--s-2);
  }
  .ch-table th:first-child,
  .ch-table td:first-child,
  .ch-table th:last-child,
  .ch-table td:last-child {
    padding-inline: var(--s-5);
  }
  .ch-table tbody tr {
    border-top: 1px solid var(--line);
  }
  .ch-table .ch-c {
    width: 72px;
    text-align: center;
  }
  .ch-table .ch-c--wide {
    width: 88px;
  }
  .ch-table input {
    width: 18px;
    height: 18px;
    margin: 0;
    vertical-align: middle;
    accent-color: var(--act);
  }
  .ch-table input:disabled {
    cursor: not-allowed;
  }

  .pv {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }
  .pv :global(.flock) {
    background: var(--surface);
  }
  .pv__text {
    flex: 1;
  }
  #pv-name-plain {
    overflow-wrap: anywhere;
  }
  .label__opt {
    font-weight: 400;
    color: var(--ink-3);
  }
  .pf {
    display: contents;
  }

  .off-ask {
    background: var(--fail-soft);
  }
  ul.off-list {
    list-style: disc;
    padding-inline-start: 18px;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    color: var(--ink);
  }
  .stop-foot {
    padding-top: var(--s-4);
    border-top: 1px solid var(--line);
  }

  #profile {
    position: relative;
  }
  .end-mark {
    position: absolute;
    inset-inline: 0;
    bottom: 0;
    height: 1px;
    pointer-events: none;
  }

  /* A busy button looks disabled but keeps focus. */
  .btn.is-busy {
    opacity: 0.5;
  }

  /* The issued key, as on the register-an-agent screen. */
  .keybox {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: 6px;
    padding-inline-start: var(--s-4);
    border-radius: var(--r-panel);
    background: var(--inverse);
  }
  .keybox > code {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    line-height: 1.5;
    color: var(--on-inverse);
    word-break: break-all;
  }
  .keybox :global(.btn),
  .keybox :global(.btn:hover) {
    flex: none;
    background: var(--inverse-2);
    color: var(--on-inverse);
    box-shadow: none;
    padding-inline: var(--s-3) var(--s-4);
  }
  .keybox :global(:focus-visible) {
    outline-color: var(--act-on-inverse);
  }
  .key-rule {
    padding-top: var(--s-5);
    border-top: 1px solid var(--line);
  }
  .key-stored {
    align-items: center;
    gap: var(--s-3);
    min-height: 44px;
    padding: 0;
    font-weight: 600;
    color: var(--ink);
  }
  .key-stored input[type='checkbox'] {
    margin-top: 0;
  }

  @media (prefers-reduced-motion: no-preference) {
    :global(.first-load) .spark-line {
      stroke-dasharray: 1;
      stroke-dashoffset: 1;
      animation: spark-draw 900ms var(--ease-out) 350ms forwards;
    }
    :global(.first-load) .spark-area,
    :global(.first-load) .spark-end {
      animation: spark-fade 500ms var(--ease-out) 900ms both;
    }
  }
  @keyframes spark-draw {
    to {
      stroke-dashoffset: 0;
    }
  }
  @keyframes spark-fade {
    from {
      opacity: 0;
    }
  }
</style>
