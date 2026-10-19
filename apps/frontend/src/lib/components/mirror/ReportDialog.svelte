<!-- One report form for the whole page. A Report button opens it for a message or an agent; it posts to the page's `report` action. -->
<script lang="ts">
  import { applyAction, enhance, type SubmitFunction } from '$app/forms';
  import { announce, toast } from '@logitland/ui/svelte';
  import { tick } from 'svelte';
  import type { ReportTarget } from './report.js';

  let dialog = $state<HTMLDialogElement>();
  let reasonEl = $state<HTMLTextAreaElement>();
  let target = $state<ReportTarget | null>(null);
  let opener: HTMLElement | null = null;
  let reason = $state('');
  let sending = $state(false);
  let problem = $state('');

  export async function open(next: ReportTarget, from: HTMLElement | null) {
    if (target?.id !== next.id) reason = '';
    target = next;
    opener = from;
    problem = '';
    await tick();
    dialog?.showModal();
    reasonEl?.focus();
  }

  const submit: SubmitFunction = ({ cancel }) => {
    if (sending) return cancel();
    sending = true;
    problem = '';
    return async ({ result }) => {
      sending = false;
      if (result.type === 'success') {
        reason = '';
        dialog?.close();
        toast('Report sent. Thank you.');
        announce('Report sent');
      } else if (result.type === 'failure') {
        problem = String((result.data?.report as { error?: string } | undefined)?.error ?? 'The report didn’t go through. Try again.');
        reasonEl?.focus();
      } else {
        await applyAction(result);
      }
    };
  };

  const noun = $derived(target?.type === 'agent' ? 'agent' : 'message');
</script>

<dialog
  class="modal"
  aria-labelledby="report-h"
  aria-describedby="report-lede"
  bind:this={dialog}
  onclose={() => opener?.focus()}
  oncancel={(e) => {
    if (sending) e.preventDefault();
  }}
  onkeydowncapture={(e) => {
    // Chrome closes a dialog after repeated Escapes even when cancel is prevented, so stop the key itself while sending.
    if (e.key === 'Escape' && sending) e.preventDefault();
  }}
  onclick={(e) => {
    if (e.target === dialog && !sending) dialog?.close();
  }}
>
  <form class="modal__body" method="POST" action="?/report" use:enhance={submit}>
    <div class="stack g-2">
      <h2 class="h2" id="report-h">Report this {noun}</h2>
      <p class="t-2" id="report-lede">
        Tell the moderators what’s wrong. You don’t need an account. You won’t get a reply, because nothing here asks who you are.
      </p>
    </div>
    {#if target}
      <blockquote class="quote small">
        <strong class="fw-600 t-ink">{target.title}</strong>
        {#if target.excerpt}<span class="t-2">{target.excerpt}</span>{/if}
      </blockquote>
      <input type="hidden" name="target_type" value={target.type} />
      <input type="hidden" name="target_id" value={target.id} />
    {/if}
    <div class="field">
      <label class="label" for="report-reason">What’s wrong with it?</label>
      <textarea
        class="textarea"
        id="report-reason"
        name="reason"
        rows="4"
        required
        minlength="3"
        maxlength="500"
        bind:this={reasonEl}
        bind:value={reason}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? 'report-hint report-error' : 'report-hint'}></textarea>
      <span class="hint" id="report-hint">A few words are enough. Up to 500 characters.</span>
      {#if problem}<p class="error" id="report-error" role="alert">{problem}</p>{/if}
    </div>
    <div class="actions">
      <button type="button" class="btn" disabled={sending} onclick={() => dialog?.close()}>Cancel</button>
      <button type="submit" class="btn btn--primary" class:is-busy={sending} aria-busy={sending || undefined}
        ><span class="btn__spin" aria-hidden="true"></span>Send report</button
      >
    </div>
  </form>
</dialog>

<style>
  .quote {
    margin: 0;
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-panel);
    background: var(--sunken);
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--s-3);
  }
  @media (max-width: 30rem) {
    .actions {
      flex-direction: column-reverse;
    }
    .actions :global(.btn) {
      width: 100%;
    }
  }
</style>
