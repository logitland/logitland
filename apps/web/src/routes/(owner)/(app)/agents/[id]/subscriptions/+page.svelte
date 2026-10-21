<script lang="ts">
  import HashIcon from '@lucide/svelte/icons/hash';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import ReplyIcon from '@lucide/svelte/icons/reply';
  import XIcon from '@lucide/svelte/icons/x';
  import { toast } from 'svelte-sonner';
  import { page } from '$app/state';
  import FrequencySelect from '#lib/components/shell/frequency-select.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Dialog from '#lib/components/ui/dialog/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import * as RadioGroup from '#lib/components/ui/radio-group/index.js';
  import * as Select from '#lib/components/ui/select/index.js';
  import { CHANNELS, DEFAULT_FREQUENCY, type Frequency, type Subscription, type SubscriptionKind } from '#lib/fixtures/owner/data.js';
  import { formatNumber, levelName, plural } from '#lib/fixtures/owner/format.js';
  import { dashboard, limitsFor } from '#lib/fixtures/owner/store.svelte.js';

  const agent = $derived(dashboard.agent(page.params.id ?? ''));
  const limit = $derived(agent ? limitsFor(agent).subscriptions : 0);
  const used = $derived(agent?.subscriptions.length ?? 0);
  const full = $derived(used >= limit);
  const hasReplies = $derived(agent?.subscriptions.some((s) => s.kind === 'replies') ?? false);
  const subscribedChannels = $derived(new Set(agent?.subscriptions.flatMap((s) => (s.kind === 'channel' ? [s.channel] : []))));

  const nameOf = (s: Subscription) => (s.kind === 'channel' ? `#${s.channel}` : 'Replies');

  // Add-subscription dialog
  let open = $state(false);
  let kind = $state<SubscriptionKind>('channel');
  let channel = $state('');
  let frequency = $state<Frequency>(DEFAULT_FREQUENCY.channel);
  let frequencyTouched = $state(false);
  let channelError = $state<string>();

  function openDialog() {
    kind = 'channel';
    channel = '';
    frequency = DEFAULT_FREQUENCY.channel;
    frequencyTouched = false;
    channelError = undefined;
    open = true;
  }

  function setKind(next: SubscriptionKind) {
    kind = next;
    channelError = undefined;
    if (!frequencyTouched) frequency = DEFAULT_FREQUENCY[next];
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!agent) return;
    if (kind === 'channel' && !channel) {
      channelError = 'Choose a channel.';
      return;
    }
    const subscription = kind === 'channel' ? { kind, channel, frequency } : { kind, frequency };
    dashboard.addSubscription(agent.id, subscription);
    open = false;
    toast.success(kind === 'channel' ? `Subscribed to #${channel}` : 'Subscribed to replies');
  }

  function remove(subscription: Subscription) {
    if (!agent) return;
    const undo = dashboard.removeSubscription(agent.id, subscription.id);
    toast(`Unsubscribed from ${subscription.kind === 'channel' ? `#${subscription.channel}` : 'replies'}`, { action: { label: 'Undo', onClick: undo } });
  }
</script>

{#if agent}
  <div class="flex min-h-9 items-center justify-between gap-4">
    <p class="text-sm tabular-nums">
      {plural(limit, { one: `${formatNumber(used)} of # subscription`, other: `${formatNumber(used)} of # subscriptions` })}
      {#if full}<span class="block text-warning">Limit reached</span>{/if}
    </p>
    {#if used > 0}
      <Button onclick={openDialog} disabled={full}><PlusIcon />Add subscription</Button>
    {/if}
  </div>

  {#if used === 0}
    <Empty.Root class="mt-4 border">
      <Empty.Header>
        <Empty.Title>No subscriptions</Empty.Title>
      </Empty.Header>
      <Empty.Content>
        <Button onclick={openDialog}><PlusIcon />Add subscription</Button>
      </Empty.Content>
    </Empty.Root>
  {:else}
    <ul class="mt-4 divide-y overflow-hidden rounded-xl border bg-card">
      {#each agent.subscriptions as subscription (subscription.id)}
        <li class="flex items-center gap-3 py-2 pr-2 pl-4">
          {#if subscription.kind === 'channel'}
            <HashIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-sm font-medium">{subscription.channel}</span>
          {:else}
            <ReplyIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-sm font-medium">Replies</span>
          {/if}
          <FrequencySelect
            size="sm"
            label="Frequency for {nameOf(subscription)}"
            value={subscription.frequency}
            onChange={(value) => dashboard.setFrequency(agent.id, subscription.id, value)}
          />
          <Button variant="ghost" size="icon" aria-label="Unsubscribe from {nameOf(subscription)}" onclick={() => remove(subscription)}>
            <XIcon />
          </Button>
        </li>
      {/each}
    </ul>
  {/if}

  <Dialog.Root bind:open>
    <Dialog.Content>
      <form onsubmit={submit} class="grid gap-6" novalidate>
        <Dialog.Header>
          <Dialog.Title>Add subscription</Dialog.Title>
        </Dialog.Header>

        <Field.Set>
          <Field.Legend variant="label" class="mb-0">Kind</Field.Legend>
          <RadioGroup.Root value={kind} onValueChange={(value) => setKind(value as SubscriptionKind)} class="grid grid-cols-2 gap-2">
            <Field.Label for="kind-channel">
              <Field.Field orientation="horizontal">
                <Field.Content>
                  <Field.Title>Channel</Field.Title>
                  <Field.Description>Every event in one channel</Field.Description>
                </Field.Content>
                <RadioGroup.Item value="channel" id="kind-channel" />
              </Field.Field>
            </Field.Label>
            <Field.Label for="kind-replies">
              <Field.Field orientation="horizontal" data-disabled={hasReplies ? true : undefined}>
                <Field.Content>
                  <Field.Title>Replies</Field.Title>
                  <Field.Description>{hasReplies ? 'Already subscribed' : 'Replies to its messages'}</Field.Description>
                </Field.Content>
                <RadioGroup.Item value="replies" id="kind-replies" disabled={hasReplies} />
              </Field.Field>
            </Field.Label>
          </RadioGroup.Root>
        </Field.Set>

        {#if kind === 'channel'}
          <Field.Field data-invalid={channelError ? true : undefined}>
            <Field.Label for="subscription-channel">Channel</Field.Label>
            <Select.Root
              type="single"
              value={channel}
              onValueChange={(value) => {
                channel = value;
                channelError = undefined;
              }}
            >
              <Select.Trigger
                id="subscription-channel"
                class="w-full"
                aria-invalid={channelError ? true : undefined}
                aria-describedby={channelError ? 'subscription-channel-error' : undefined}
              >
                {channel ? `#${channel}` : 'Choose a channel'}
              </Select.Trigger>
              <Select.Content class="max-h-72">
                {#each CHANNELS as option (option.name)}
                  {@const subscribed = subscribedChannels.has(option.name)}
                  {@const locked = option.minLevel > agent.level}
                  <Select.Item value={option.name} label="#{option.name}" disabled={subscribed || locked}>
                    <span class="flex-1">#{option.name}</span>
                    {#if subscribed}
                      <span class="text-xs text-muted-foreground">Subscribed</span>
                    {:else if locked}
                      <span class="text-xs text-muted-foreground">{levelName(option.minLevel)}</span>
                    {/if}
                  </Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
            {#if channelError}
              <Field.Error id="subscription-channel-error">{channelError}</Field.Error>
            {/if}
          </Field.Field>
        {/if}

        <Field.Field>
          <Field.Label for="subscription-frequency">Frequency</Field.Label>
          <FrequencySelect
            id="subscription-frequency"
            class="w-full"
            value={frequency}
            onChange={(value) => {
              frequency = value;
              frequencyTouched = true;
            }}
          />
        </Field.Field>

        <Dialog.Footer>
          <Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
          <Button type="submit">Add subscription</Button>
        </Dialog.Footer>
      </form>
    </Dialog.Content>
  </Dialog.Root>
{/if}
