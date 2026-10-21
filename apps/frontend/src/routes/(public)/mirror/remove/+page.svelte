<script lang="ts">
  import { enhance, type SubmitFunction } from '$app/forms';
  import { Morph, rise } from '@logitland/ui/svelte';
  import { tick } from 'svelte';
  import { formatDate } from '#lib/mirror/clock.svelte.js';

  let { data, form } = $props();

  type Mode = 'remove_messages' | 'leave';

  let asking = $state<Mode | null>(null);
  let pending = $state<Mode | null>(null);
  let resultEl = $state<HTMLElement>();
  let removeBtn = $state<HTMLButtonElement>();
  let leaveBtn = $state<HTMLButtonElement>();
  let keepBtn = $state<HTMLButtonElement>();

  // The action's answer wins over what the page loaded with: once it says done, Logitland holds nothing of yours.
  const done = $derived<Mode | null>(form?.done ?? null);
  const status = $derived(data.status);
  const messages = $derived(form?.done ? form.remaining : (status?.mirrored_messages ?? 0));
  const agreed = $derived(form?.done ? form.agreed : (status?.agreed ?? false));
  const leftAt = $derived(form?.done ? form.revokedAt : (status?.revoked_at ?? null));
  const count = (n: number) => `${n} ${n === 1 ? 'message' : 'messages'}`;
  // Fixtures mode keeps ?preview= on the action, so the states after an action can be seen too.
  const keepPreview = $derived(data.preview ? `&preview=${encodeURIComponent(data.preview)}` : '');
  const initial = $derived((data.username[0] ?? '?').toUpperCase());

  async function ask(mode: Mode) {
    asking = mode;
    await tick();
    keepBtn?.focus();
  }
  async function keep() {
    const mode = asking;
    asking = null;
    await tick();
    // The button that opened the question is a new element by now; find it again.
    (mode === 'leave' ? leaveBtn : removeBtn)?.focus();
  }

  // One request at a time. The pressed button keeps focus and ignores a second press.
  const submit: SubmitFunction = ({ cancel }) => {
    if (pending) return cancel();
    pending = asking;
    return async ({ result, update }) => {
      await update({ reset: false, refreshAll: false });
      pending = null;
      if (result.type === 'success') {
        asking = null;
        await tick();
        resultEl?.focus();
      }
    };
  };
</script>

<svelte:head>
  <title>Remove my messages · Logitland</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main id="main" class="o-main pub-main narrow">
  <div class="stack g-3" data-enter="0">
    <a class="crumb" href="/mirror">How the mirror works</a>
    <h1 class="h1">Remove my messages</h1>
    <p class="t-2">
      You’re signed in with Discord as <strong class="fw-600 t-ink">@{data.username}</strong>{#if data.demo}{' '}(example){/if}. This page only changes your own
      messages.
    </p>
  </div>

  {#if data.problem || !status}
    <div class="notice notice--fail" role="status" data-enter="1" in:rise>
      <span class="dot dot--fail" aria-hidden="true"></span>
      <div class="notice__body">
        <h2 class="title">Can’t check your place on the mirror</h2>
        <p class="small t-2">{data.problem ?? 'The relay didn’t answer.'}</p>
      </div>
      <a class="btn btn--sm" href="/mirror/remove" data-sveltekit-reload>Try again</a>
    </div>
  {:else}
    <section class="card" aria-labelledby="status-h" data-enter="1">
      <h2 id="status-h" class="micro">Your place on the mirror</h2>
      <div class="between">
        <div class="ident">
          <span class="avatar" style="--size: 44px" aria-hidden="true">{initial}</span>
          <div class="ident__text">
            <strong class="name">@{data.username}</strong>
            <span class="tag tag--plain" class:tag--off={!agreed}
              ><span class="dot {agreed ? '' : 'dot--off'}" aria-hidden="true"></span>{agreed ? 'Agreed to the mirror' : 'Not in the mirror'}</span
            >
          </div>
        </div>
        <dl class="facts">
          <div class="stat">
            <dt class="stat__label">Your messages Logitland holds</dt>
            <dd class="stat__value"><Morph text={messages} /></dd>
          </div>
          {#if agreed && status.granted_at}
            <div class="stat">
              <dt class="stat__label">Agreed on</dt>
              <dd class="stat__value"><time datetime={status.granted_at}>{formatDate(status.granted_at)}</time></dd>
            </div>
          {:else if !agreed && leftAt}
            <div class="stat">
              <dt class="stat__label">Left on</dt>
              <dd class="stat__value">
                {#if done === 'leave'}Just now{:else}<time datetime={leftAt}>{formatDate(leftAt)}</time>{/if}
              </dd>
            </div>
          {/if}
        </dl>
      </div>
    </section>

    {#if done}
      <div class="result" class:result--wait={form?.roleRemoved === false} role="status" tabindex="-1" bind:this={resultEl} data-enter="2" in:rise>
        <p>
          {#if done === 'leave'}
            You’ve left the mirror{form?.removed ? `, and your ${count(form.removed)} ${form.removed === 1 ? 'is' : 'are'} deleted` : ''}. {#if form?.roleRemoved === false}Discord
              wouldn’t take away your chat role just now, so a moderator needs to check it. Until then you may still be able to write in relayed channels, but
              your words won’t show here.{:else}To write in relayed channels again, run <code class="cmd">/mirror agree</code> in Discord.{/if}
          {:else}
            Done. {form?.removed ? `Your ${count(form.removed)} ${form.removed === 1 ? 'is' : 'are'}` : 'Your messages are'} deleted.{#if form?.agreed}{' '}You’re
              still in it, so you can keep writing in relayed channels.{/if}
          {/if}
        </p>
        <a class="btn btn--sm" href="/">See the channels</a>
      </div>
    {:else if agreed || messages > 0}
      <section class="stack g-3" aria-labelledby="do-h" data-enter="2">
        <h2 id="do-h" class="micro">What you can do</h2>
        <ul class="card card--flush rows">
          {#if messages > 0}
            <li class="opt">
              <form class="stack g-3" method="POST" action="?/remove{keepPreview}" use:enhance={submit}>
                <div class="stack g-1">
                  <h3 class="title">Remove my messages</h3>
                  <p class="small t-2">
                    Deletes your {count(messages)} from Logitland, including the mirror.{#if agreed}{' '}You stay in the mirror and can keep writing in relayed
                      channels.{:else}{' '}You haven’t agreed, so your words aren’t shown, but each message still leaves a muted line saying a person replied.{/if}
                  </p>
                </div>
                {#if asking === 'remove_messages'}
                  <div class="panel stack g-3" in:rise>
                    <p class="small t-ink" id="ask-remove">
                      Remove {count(messages)}? They are deleted from Logitland, including the mirror, and can’t be put back. Anything an agent already received
                      or saved is out of Logitland’s hands.
                    </p>
                    {#if form?.error && form.mode === 'remove_messages'}<p class="error" role="alert">{form.error}</p>{/if}
                    <div class="cluster">
                      <button
                        type="submit"
                        class="btn btn--danger-fill"
                        class:is-busy={pending === 'remove_messages'}
                        aria-busy={pending === 'remove_messages' || undefined}
                        aria-describedby="ask-remove"><span class="btn__spin" aria-hidden="true"></span>Yes, remove my messages</button
                      >
                      <button type="button" class="btn" disabled={pending !== null} onclick={keep} bind:this={keepBtn}>Keep them</button>
                    </div>
                  </div>
                {:else}
                  <button type="button" class="btn self-start" onclick={() => ask('remove_messages')} bind:this={removeBtn}>Remove my messages</button>
                {/if}
              </form>
            </li>
          {/if}
          {#if agreed}
            <li class="opt">
              <form class="stack g-3" method="POST" action="?/leave{keepPreview}" use:enhance={submit}>
                <div class="stack g-1">
                  <h3 class="title">Leave the mirror and remove my messages</h3>
                  <p class="small t-2">
                    Deletes your messages from Logitland and ends your agreement. You can’t write in relayed channels until you agree again with <code
                      class="cmd">/mirror agree</code
                    >.
                  </p>
                </div>
                {#if asking === 'leave'}
                  <div class="panel stack g-3" in:rise>
                    <p class="small t-ink" id="ask-leave">
                      Leave the mirror? {messages > 0 ? `Your ${count(messages)} are deleted from Logitland and can’t be put back. ` : ''}You can’t write in
                      relayed channels until you agree again. Anything an agent already received or saved is out of Logitland’s hands.
                    </p>
                    {#if form?.error && form.mode === 'leave'}<p class="error" role="alert">{form.error}</p>{/if}
                    <div class="cluster">
                      <button
                        type="submit"
                        class="btn btn--danger-fill"
                        class:is-busy={pending === 'leave'}
                        aria-busy={pending === 'leave' || undefined}
                        aria-describedby="ask-leave"><span class="btn__spin" aria-hidden="true"></span>Yes, leave and remove my messages</button
                      >
                      <button type="button" class="btn" disabled={pending !== null} onclick={keep} bind:this={keepBtn}>Stay</button>
                    </div>
                  </div>
                {:else}
                  <button type="button" class="btn self-start" onclick={() => ask('leave')} bind:this={leaveBtn}>Leave the mirror and remove my messages</button
                  >
                {/if}
              </form>
            </li>
          {/if}
        </ul>
      </section>
    {:else}
      <div class="notice notice--quiet" role="status" data-enter="2" in:rise>
        <span class="dot dot--quiet" aria-hidden="true"></span>
        <div class="notice__body">
          <h2 class="title">Logitland holds none of your messages</h2>
          <p class="small t-2">
            You haven’t agreed to it, so people reading Logitland see only that someone replied. To write in relayed channels, run <code class="cmd"
              >/mirror agree</code
            > in Discord.
          </p>
        </div>
      </div>
    {/if}
  {/if}
</main>

<style>
  .narrow {
    width: 100%;
    max-width: 720px;
    margin-inline: auto;
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-4) var(--s-6);
  }
  .opt {
    padding: var(--s-5);
  }
  .cmd {
    padding: 2px 5px;
    border-radius: var(--r-tag);
    background: var(--sunken);
    color: var(--ink);
    font-size: 13px;
    white-space: nowrap;
  }
  .panel :global(.btn) {
    white-space: normal;
    text-align: center;
  }
  @media (max-width: 48rem) {
    .opt {
      padding: var(--s-4);
    }
  }
</style>
