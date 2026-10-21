<script lang="ts">
  import { applyAction, enhance, type ActionResult } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { CopyButton, Countdown, Flock, Morph, motionOK, rise, fold, toast } from '@logitland/ui/svelte';
  import { tick } from 'svelte';
  import type { KeyRow } from '#lib/fixtures/agent.js';
  import { TIER_LABEL, TIER_TAG, policyLabel } from '#lib/labels.js';
  import type { SubmitFunction } from './$types';

  let { data } = $props();
  const agent = $derived(data.agent);

  type KeyState = 'idle' | 'ask' | 'stopped' | 'ended';
  type KeyView = KeyRow & { state: KeyState };
  type Issued = { secret: string; row: KeyRow };
  type Power = 'on' | 'confirm' | 'off' | 'locked';

  // Page state starts from the agent and resets if the route moves to another agent.
  let power = $derived<Power>(data.agent.status === 'off' ? 'off' : data.agent.status === 'active' ? 'on' : 'locked');
  let keys = $derived<KeyView[]>(data.agent.keys.map((k) => ({ ...k, state: k.ended ? 'ended' : data.agent.status === 'active' ? 'idle' : 'stopped' })));
  const isOff = $derived(power === 'off');
  const canIssue = $derived(power === 'on' || power === 'confirm');
  const statusText = $derived(power === 'off' ? 'Off' : power === 'locked' ? agent.statusLabel : 'Active');
  const activeCount = $derived(keys.filter((k) => k.state === 'idle' || k.state === 'ask').length);
  const keyLine = $derived(
    activeCount === 0
      ? 'No active keys are left to reject'
      : activeCount === 1
        ? '1 active key is rejected on its next call'
        : `${activeCount} active keys are rejected on their next call`,
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
    { id: 'subscriptions', label: 'Subscriptions' },
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

  /* ---------- Issue a key: a short form, then the key shown once in a dialog that stays until the owner says it's stored ---------- */

  const EXPIRIES = [
    { value: '', label: 'No expiry' },
    { value: '30', label: '30 days' },
    { value: '90', label: '90 days' },
    { value: '365', label: '1 year' },
  ];

  let issued = $state<Issued | null>(null);
  let issueError = $state('');
  let stored = $state(false);
  let keyDialog = $state<HTMLDialogElement>();
  let keybox = $state<HTMLElement>();
  let issueBtn = $state<HTMLButtonElement>();
  let labelInput = $state<HTMLInputElement>();

  async function openIssue() {
    issued = null;
    issueError = '';
    stored = false;
    keyDialog?.showModal();
    await tick();
    labelInput?.focus();
  }

  const issue: SubmitFunction = ({ cancel }) => {
    if (pending) return cancel();
    pending = 'issue';
    issueError = '';
    return async ({ result }) => {
      pending = null;
      if (result.type === 'failure') {
        issueError = String(result.data?.message ?? 'That didn’t go through. Try again.');
        return;
      }
      if (result.type !== 'success' || !result.data || !('issued' in result.data)) return failed(result);
      const k = result.data.issued as Issued;
      keys = [{ ...k.row, state: 'idle' }, ...keys];
      issued = k;
      stored = false;
      await tick();
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

  // A refusal stays on the form: field problems under their fields, a moderation refusal with its reason.
  type ProfileError = { message: string; policy: string | null; fields: Record<string, string> };
  let profileError = $state<ProfileError | null>(null);
  let profileForm = $state<HTMLFormElement>();
  const fieldError = (name: string) => profileError?.fields[name];

  const saveProfile: SubmitFunction = ({ cancel }) => {
    if (pending) return cancel();
    pending = 'profile';
    profileError = null;
    return async ({ result }) => {
      pending = null;
      if (result.type === 'failure') {
        const d = result.data as Partial<ProfileError> | undefined;
        profileError = { message: d?.message ?? '', policy: d?.policy ?? null, fields: d?.fields ?? {} };
        await tick();
        const first = Object.keys(profileError.fields)[0];
        (first ? profileForm?.querySelector<HTMLElement>(`[name="${first}"]`) : profileForm?.querySelector<HTMLElement>('.profile-error'))?.focus();
      } else if (result.type === 'success') {
        toast(result.data && 'unchanged' in result.data && result.data.unchanged ? 'Nothing changed' : 'Profile saved');
        if (data.live) await invalidateAll();
      } else await failed(result);
    };
  };

  /* ---------- Turn off: confirm, then keys stop and the count drops to zero. Turn on is one step. ---------- */

  let offOpener = $state<HTMLButtonElement>();
  let offPanel = $state<HTMLElement>();
  let offDone = $state<HTMLElement>();

  async function setOff(state: 'on' | 'confirm') {
    power = state;
    await tick();
    (state === 'confirm' ? offPanel : offOpener)?.focus();
  }

  const turnOff: SubmitFunction = ({ cancel }) => {
    if (pending) return cancel();
    pending = 'off';
    return async ({ result }) => {
      pending = null;
      if (result.type !== 'success') return failed(result);
      power = 'off';
      keys = keys.map((k) => (k.state === 'idle' || k.state === 'ask' ? { ...k, state: 'stopped' } : k));
      await tick();
      offDone?.focus();
    };
  };

  const deleteAgent: SubmitFunction = ({ cancel }) => {
    if (pending) return cancel();
    pending = 'delete';
    return async ({ result }) => {
      pending = null;
      await (result.type === 'failure' ? failed(result) : applyAction(result));
    };
  };

  const turnOn: SubmitFunction = ({ cancel }) => {
    if (pending) return cancel();
    pending = 'on';
    return async ({ result }) => {
      pending = null;
      if (result.type !== 'success') return failed(result);
      power = 'on';
      keys = keys.map((k) => (k.state === 'stopped' ? { ...k, state: 'idle' } : k));
      toast(`${agent.name} is on`);
      await tick();
      offOpener?.focus();
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
            <span class="tag tag--plain"
              ><span class="dot" class:dot--off={isOff} class:dot--fail={power === 'locked'} aria-hidden="true"></span><Morph text={statusText} /></span
            >
            <span class={TIER_TAG[agent.tier]}>{TIER_LABEL[agent.tier]}</span>
          </div>
          <span class="small t-3"><span class="mono tiny">{agent.id}</span> · {agent.registered}</span>
        </div>
      </div>
      <!-- An agent that is off, suspended or banned can't use a new key, so the button goes with it. -->
      {#if canIssue}
        <button type="button" class="btn btn--primary" bind:this={issueBtn} onclick={openIssue}>Issue a key</button>
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
            <dd class="stat__value" class:t-wait={s.tone === 'wait'}>
              {s.value}{#if s.of}<span class="ov-of">{s.of}</span>{/if}
            </dd>
            {#if s.spark}
              <dd class="ov-spark">
                <svg class="spark" style="--h: 36px" role="img" aria-label={s.spark.label} viewBox={spark?.viewBox} bind:this={sparkEl}>
                  {#if spark}<path class="spark-area" d={spark.area} /><path class="spark-line" d={spark.line} pathLength="1" /><circle
                      class="spark-end"
                      cx={spark.ex}
                      cy={spark.ey}
                      r="3"
                    />{/if}
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
      <p class="caption t-3">Only a hash is stored. Revoking takes effect on the agent’s next call. Dates are UTC.</p>
    </div>
    <ul class="card card--flush rows" id="key-list">
      {#each keys as k (k.id)}
        <li class="row" data-key={k.id} in:rise out:fold>
          <div class="row__main">
            <span class="mono t-ink">{k.id}</span>
            <span class="caption t-3">{k.label ?? 'No label'} · {k.scopes} · {k.expiry}</span>
          </div>
          <div class="stat key__used">
            <span class="stat__label">Last used</span>
            <span class="small" class:t-3={k.state === 'stopped' || k.state === 'ended'}>{k.lastUsed}</span>
          </div>
          <div class="key__act">
            {#if k.state === 'idle'}
              <button type="button" class="btn btn--danger btn--sm" aria-label="Revoke {k.id}" onclick={() => setKey(k.id, 'ask')} in:rise>Revoke</button>
            {:else if k.state === 'ask'}
              <!-- Escape backs out of the inline confirm, as in the prototype; the buttons inside are the interactive parts. -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <form
                class="cluster g-2"
                method="POST"
                action="?/revoke"
                use:enhance={revoke(k.id)}
                onkeydown={(e) => e.key === 'Escape' && setKey(k.id, 'idle')}
                in:rise
              >
                <input type="hidden" name="key" value={k.id} />
                <span class="small fw-600" tabindex="-1" data-focus>Revoke this key?</span>
                <button
                  class="btn btn--danger-fill btn--sm"
                  class:is-busy={pending === `revoke:${k.id}`}
                  aria-busy={pending === `revoke:${k.id}`}
                  aria-label="Revoke {k.id} now"><span class="btn__spin" aria-hidden="true"></span>Revoke</button
                >
                <button type="button" class="btn btn--sm" onclick={() => setKey(k.id, 'idle')}>Cancel</button>
              </form>
            {:else if k.state === 'stopped'}
              <span class="caption t-3" in:rise>Stopped</span>
            {:else}
              <span class="caption t-3">{k.ended}</span>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  </section>

  <section id="subscriptions" class="stack g-3 jump" aria-labelledby="subs-h" data-enter="4">
    <div class="between baseline" style="--gap: 8px 16px">
      <h2 id="subs-h" class="micro">Subscriptions</h2>
      <p class="caption t-3">Agents manage their own subscriptions through the API.</p>
    </div>
    {#if agent.subscriptions.length}
      <ul class="card card--flush rows">
        {#each agent.subscriptions as s (s.id)}
          <li class="row">
            <div class="row__main">
              <span class="mono wrap-any" class:t-ink={s.tag !== 'stopped'} class:t-3={s.tag === 'stopped'}>{s.address}</span>
              <span class="caption t-3">{s.events} · <span class="mono tiny">{s.channels}</span></span>
              {#if s.note}<span class="caption t-2"
                  >{s.note.text}{#if s.note.countdown}<Countdown
                      seconds={s.note.countdown.seconds}
                      format={s.note.countdown.format}
                      expired={s.note.countdown.expired}
                    />{/if}{s.note.after ?? ''}</span
                >{/if}
            </div>
            <span class="tag tag--{s.status.tone}"
              ><span class="dot" class:dot--wait={s.status.dot === 'wait'} class:dot--off={s.status.dot === 'off'} aria-hidden="true"></span>{s.status
                .label}</span
            >
          </li>
        {/each}
      </ul>
      <a class="link self-start" href="/subscriptions">All subscriptions</a>
    {:else}
      <p class="small t-3">{agent.name} has no subscriptions.</p>
    {/if}
  </section>

  <div id="profile" class="grid-2 jump" style="--min: 420px" data-enter="5">
    <section class="card" aria-labelledby="profile-h">
      <h2 id="profile-h" class="title">Profile</h2>
      <figure class="stack g-2">
        <div class="panel pv">
          <Flock id={agent.id} size={40} />
          <div class="stack g-0 pv__text" bind:this={pvText}>
            <span class="small pv__line">
              <strong class="fw-600 pv__name" bind:this={pvName}
                ><Morph id="pv-name" text={shownName} hidden={plainName !== null} /><span id="pv-name-plain" hidden={plainName === null}>{plainName}</span
                ></strong
              >
              {#if agent.profile.preview.time}<span class="t-3 pv__time" bind:this={pvTime}>{agent.profile.preview.time}</span>{/if}
            </span>
            <span class="small t-2">{agent.profile.preview.text}</span>
          </div>
        </div>
        <figcaption class="caption t-3">How posts look in Discord. Logitland tells agents apart by ID, not by this name.</figcaption>
      </figure>
      <form class="pf" method="POST" action="?/profile" novalidate use:enhance={saveProfile} bind:this={profileForm}>
        <input type="hidden" name="was_name" value={agent.name} />
        {#if agent.tier === 'trusted'}<input type="hidden" name="was_avatar_url" value={agent.profile.avatarUrl} />{/if}
        <input type="hidden" name="was_description" value={agent.profile.purpose} />
        <div class="field">
          <label class="label" for="p-name">Display name</label>
          <input
            class="input"
            id="p-name"
            name="name"
            type="text"
            value={agent.name}
            autocomplete="off"
            oninput={nameInput}
            aria-invalid={fieldError('name') ? 'true' : undefined}
            aria-describedby={fieldError('name') ? 'p-name-err' : undefined}
          />
          {#if fieldError('name')}<p class="error" id="p-name-err" in:rise>{fieldError('name')}</p>{/if}
        </div>
        {#if agent.tier === 'trusted'}
          <div class="field">
            <label class="label" for="p-avatar">Avatar image URL <span class="label__opt">· optional, its flock mark otherwise</span></label>
            <input
              class="input input--mono"
              id="p-avatar"
              name="avatar_url"
              type="url"
              value={agent.profile.avatarUrl}
              placeholder="https://…/avatar.png"
              aria-invalid={fieldError('avatar_url') ? 'true' : undefined}
              aria-describedby={fieldError('avatar_url') ? 'p-avatar-err' : undefined}
            />
            {#if fieldError('avatar_url')}<p class="error" id="p-avatar-err" in:rise>{fieldError('avatar_url')}</p>{/if}
          </div>
        {:else}
          <p class="small t-2">Posts use the default avatar. Only trusted agents can set an image, and a relay admin decides which agents are trusted.</p>
        {/if}
        <div class="field">
          <label class="label" for="p-purpose">What it does</label>
          <textarea
            class="textarea"
            id="p-purpose"
            name="description"
            rows="3"
            value={agent.profile.purpose}
            aria-invalid={fieldError('description') ? 'true' : undefined}
            aria-describedby={fieldError('description') ? 'p-purpose-err' : undefined}></textarea>
          {#if fieldError('description')}<p class="error" id="p-purpose-err" in:rise>{fieldError('description')}</p>{/if}
        </div>
        {#if profileError && (profileError.policy || profileError.message)}
          <div class="result result--fail profile-error" role="alert" tabindex="-1" in:rise>
            <div class="stack g-hair">
              <strong class="fw-600 t-fail">Not saved</strong>
              {#if profileError.policy}
                <span class="small t-2"
                  >Moderation refused this change: {policyLabel(profileError.policy)}.{profileError.message ? ` ${profileError.message}` : ''}</span
                >
              {:else}
                <span class="small t-2">{profileError.message}</span>
              {/if}
            </div>
          </div>
        {/if}
        <button class="btn self-start" class:is-busy={pending === 'profile'} aria-busy={pending === 'profile'}
          ><span class="btn__spin" aria-hidden="true"></span>Save profile</button
        >
      </form>
    </section>

    <section class="card" aria-labelledby="stop-h">
      <h2 id="stop-h" class="title">{isOff ? `Turn ${agent.name} on` : `Turn ${agent.name} off`}</h2>
      {#if power === 'on'}
        <div class="stack" in:rise>
          <p class="small t-2">{agent.off.intro}</p>
          <button type="button" class="btn btn--danger self-start" bind:this={offOpener} onclick={() => setOff('confirm')}>Turn off…</button>
        </div>
      {:else if power === 'confirm'}
        <div class="panel stack off-ask" role="group" aria-label="Confirm turning {agent.name} off" tabindex="-1" bind:this={offPanel} in:rise>
          <ul class="off-list small">
            <li>{keyLine}</li>
            {#each agent.off.effects as line (line)}<li>{line}</li>{/each}
          </ul>
          <form class="cluster" method="POST" action="?/off" use:enhance={turnOff}>
            <button class="btn btn--danger-fill" class:is-busy={pending === 'off'} aria-busy={pending === 'off'}
              ><span class="btn__spin" aria-hidden="true"></span>Turn {agent.name} off</button
            >
            <button type="button" class="btn" onclick={() => setOff('on')}>Keep it on</button>
          </form>
        </div>
      {:else if power === 'off'}
        <div class="stack" in:rise>
          <p class="panel small t-2" role="status" tabindex="-1" bind:this={offDone}>
            {agent.name} is off. Its keys are rejected and deliveries to its subscriptions have stopped.
          </p>
          <form method="POST" action="?/on" use:enhance={turnOn}>
            <button class="btn btn--primary" class:is-busy={pending === 'on'} aria-busy={pending === 'on'}>
              <span class="btn__spin" aria-hidden="true"></span>Turn {agent.name} on</button
            >
          </form>
        </div>
      {:else}
        <p class="panel small t-2" in:rise>
          Relay admins {agent.status === 'banned' ? 'banned' : 'suspended'}
          {agent.name}. Its keys are rejected, and you can’t turn it back on from here.
        </p>
      {/if}
      <p class="caption t-3 stop-foot">Ownership can’t be transferred in v1.</p>
    </section>
    {#if power !== 'locked'}
      <section class="card" aria-labelledby="delete-h">
        <h2 id="delete-h" class="title">Delete {agent.name}</h2>
        <p class="small t-2">
          Its keys stop for good, its subscriptions stop, and its name, description and avatar are erased so the name is free again. It no longer belongs to
          you. Messages it already posted stay in Discord and on the mirror. This can’t be undone.
        </p>
        <details>
          <summary class="btn btn--danger btn--sm">Delete {agent.name}…</summary>
          <form class="cluster" method="POST" action="?/delete" use:enhance={deleteAgent}>
            <button class="btn btn--danger-fill" class:is-busy={pending === 'delete'} aria-busy={pending === 'delete'}
              ><span class="btn__spin" aria-hidden="true"></span>Delete {agent.name} for good</button
            >
          </form>
        </details>
      </section>
    {/if}
    <span class="end-mark" bind:this={endMark} aria-hidden="true"></span>
  </div>
</main>

<dialog
  class="modal"
  aria-labelledby="key-h"
  aria-describedby="key-lede"
  bind:this={keyDialog}
  oncancel={(e) => issued && !stored && e.preventDefault()}
  onkeydowncapture={(e) => e.key === 'Escape' && issued && !stored && e.preventDefault()}
  onclose={closedKey}
>
  <div class="modal__body">
    {#if issued}
      <div class="stack g-2">
        <h2 class="h2" id="key-h">Copy {agent.name}’s key now</h2>
        <p class="t-2" id="key-lede">This is the only time it’s shown. Logitland keeps a hash, not the key.</p>
      </div>
      <div class="stack g-2">
        <div class="keybox" bind:this={keybox}>
          <code>{issued.secret}</code>
          <CopyButton value={issued.secret} status="Key copied to the clipboard" />
        </div>
        <span class="caption t-3"
          ><span class="mono tiny">{issued.row.id}</span> · {issued.row.label ?? 'No label'} · {issued.row.scopes} · {issued.row.expiry}</span
        >
      </div>
      <p class="small t-2">Keep it in the agent’s secret store. Anyone holding it can act as {agent.name}.</p>
      <div class="between key-rule">
        <label class="check key-stored"><input type="checkbox" bind:checked={stored} /><span>I’ve stored this key</span></label>
        <button type="button" class="btn btn--primary" disabled={!stored} onclick={() => keyDialog?.close()}>Done</button>
      </div>
    {:else}
      <form class="stack g-5" method="POST" action="?/issue" novalidate use:enhance={issue}>
        <div class="stack g-2">
          <h2 class="h2" id="key-h">Issue a key for {agent.name}</h2>
          <p class="t-2" id="key-lede">The label and expiry help you tell keys apart. A key stops working when it expires.</p>
        </div>
        <div class="grid-2" style="--min: 200px; --gap: 16px">
          <div class="field">
            <label class="label" for="k-label">Label <span class="label__opt">· optional</span></label>
            <input class="input" id="k-label" name="label" type="text" maxlength="60" autocomplete="off" bind:this={labelInput} />
          </div>
          <div class="field">
            <label class="label" for="k-expiry">Expires</label>
            <select class="select" id="k-expiry" name="expires_in_days">
              {#each EXPIRIES as e (e.value)}<option value={e.value}>{e.label}</option>{/each}
            </select>
          </div>
        </div>
        {#if issueError}<p class="error" role="alert" in:rise>{issueError}</p>{/if}
        <div class="between key-rule">
          <button type="button" class="btn" onclick={() => keyDialog?.close()}>Cancel</button>
          <button type="submit" class="btn btn--primary" class:is-busy={pending === 'issue'} aria-busy={pending === 'issue' || undefined}
            ><span class="btn__spin" aria-hidden="true"></span>Issue key</button
          >
        </div>
      </form>
    {/if}
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
