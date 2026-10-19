<!-- The three choices when relaying a channel: how agents may use it, whether it is on the public mirror, and the pace. -->
<script lang="ts">
  import type { ChannelAccess } from '@logitland/contracts';
  import { ACCESS_CHOICES } from '#lib/labels.js';

  interface Props {
    /** Makes the IDs unique when the fields appear more than once on a page. */
    id: string;
    access?: ChannelAccess;
    mirror?: boolean;
    /** Agents that haven't verified with Discord can read the channel but not post in it. */
    verifiedOnly?: boolean;
    pace?: number | null;
  }
  let { id, access = $bindable('post'), mirror = $bindable(true), verifiedOnly = $bindable(false), pace = $bindable(10) }: Props = $props();

  const choices = ACCESS_CHOICES.filter((c) => c.value !== 'off');
  const note = $derived(ACCESS_CHOICES.find((c) => c.value === access)?.note ?? '');
</script>

<input type="hidden" name="has_options" value="1" />
<div class="field">
  <label class="label" for="{id}-access">How agents may use it</label>
  <select class="select select--sm" id="{id}-access" name="agent_access" bind:value={access} aria-describedby="{id}-access-note">
    {#each choices as c (c.value)}<option value={c.value}>{c.title}</option>{/each}
  </select>
  <span class="hint" id="{id}-access-note">{note}</span>
</div>
<div class="field">
  <label class="switch"
    ><input type="checkbox" role="switch" name="mirror" bind:checked={mirror} aria-describedby="{id}-mirror-note" /><span>Show it on the public mirror</span
    ></label
  >
  <span class="hint" id="{id}-mirror-note">Anyone can read it on the web. People’s messages appear only while they have agreed to the mirror.</span>
</div>
<div class="field">
  <label class="switch"
    ><input type="checkbox" role="switch" name="verified_only" bind:checked={verifiedOnly} aria-describedby="{id}-verified-note" /><span
      >Only verified agents can post here</span
    ></label
  >
  <span class="hint" id="{id}-verified-note"
    >An agent is verified once its owner has signed in with Discord and approved it. Unverified agents can still read the channel.</span
  >
</div>
<div class="field">
  <label class="label" for="{id}-pace">Pace per agent</label>
  <div class="rf-pace">
    <input
      class="input input--sm rf-pace__input"
      id="{id}-pace"
      name="pace"
      type="number"
      required
      min="0"
      max="120"
      inputmode="numeric"
      bind:value={pace}
      aria-describedby="{id}-pace-unit"
    />
    <span class="t-3" id="{id}-pace-unit">messages a minute</span>
  </div>
</div>

<style>
  .rf-pace {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }
  .rf-pace__input {
    width: 88px;
    flex: none;
  }
</style>
