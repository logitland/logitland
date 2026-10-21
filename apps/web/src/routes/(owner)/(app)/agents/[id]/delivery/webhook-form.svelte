<script lang="ts">
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import { untrack } from 'svelte';
  import { toast } from 'svelte-sonner';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import * as RadioGroup from '#lib/components/ui/radio-group/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import type { Agent } from '#lib/fixtures/owner/data.js';
  import { dashboard, webhookUrlError } from '#lib/fixtures/owner/store.svelte.js';
  import SecretDialog from './secret-dialog.svelte';

  let { agent }: { agent: Agent } = $props();

  const saved = $derived(agent.delivery);
  const savedUrl = $derived(saved.kind === 'webhook' ? saved.url : '');

  let kind = $state(untrack(() => agent.delivery.kind));
  let url = $state(untrack(() => (agent.delivery.kind === 'webhook' ? agent.delivery.url : '')));
  let urlError = $state<string>();
  let saving = $state(false);
  let resuming = $state(false);
  let rotateOpen = $state(false);
  let rotating = $state(false);
  let secret = $state<string>();

  const dirty = $derived(kind !== saved.kind || (kind === 'webhook' && url.trim() !== savedUrl));

  function discard() {
    kind = saved.kind;
    url = savedUrl;
    urlError = undefined;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (kind === 'webhook') {
      urlError = webhookUrlError(url) ?? undefined;
      if (urlError) return;
    }
    saving = true;
    const result = await dashboard.saveDelivery(agent.id, kind === 'webhook' ? { kind, url: url.trim() } : { kind });
    saving = false;
    if (!result.ok) {
      urlError = result.error;
      return;
    }
    url = url.trim();
    if (result.secret) secret = result.secret;
    else toast.success('Saved');
  }

  async function rotate() {
    rotating = true;
    secret = await dashboard.rotateSecret(agent.id);
    rotating = false;
    rotateOpen = false;
  }

  async function resume() {
    resuming = true;
    await dashboard.resumeDelivery(agent.id);
    resuming = false;
    toast.success('Deliveries resumed');
  }
</script>

<Card.Root class="[--card-spacing:--spacing(4)] sm:[--card-spacing:--spacing(6)]">
  <form onsubmit={save} novalidate class="contents">
    <Card.Header>
      <Card.Title>Event delivery</Card.Title>
    </Card.Header>
    <Card.Content class="gap-6">
      <RadioGroup.Root bind:value={kind} class="grid gap-2 sm:grid-cols-2" aria-label="Event delivery" disabled={saving}>
        <Field.Label for="delivery-webhook">
          <Field.Field orientation="horizontal">
            <Field.Content>
              <Field.Title>Webhook</Field.Title>
              <Field.Description>The relay posts events to a URL</Field.Description>
            </Field.Content>
            <RadioGroup.Item value="webhook" id="delivery-webhook" />
          </Field.Field>
        </Field.Label>
        <Field.Label for="delivery-none">
          <Field.Field orientation="horizontal">
            <Field.Content>
              <Field.Title>None</Field.Title>
              <Field.Description>Your agent long-polls or uses a WebSocket</Field.Description>
            </Field.Content>
            <RadioGroup.Item value="none" id="delivery-none" />
          </Field.Field>
        </Field.Label>
      </RadioGroup.Root>

      {#if kind === 'webhook'}
        {#if saved.kind === 'webhook' && saved.paused}
          <Alert.Root variant="warning" class="max-sm:pr-4">
            <TriangleAlertIcon />
            <Alert.Title>Paused after 50 failed deliveries in a row</Alert.Title>
            <Alert.Description>Fix the endpoint, then resume.</Alert.Description>
            <Alert.Action class="static col-span-full mt-3 sm:absolute sm:top-1/2 sm:right-3 sm:mt-0 sm:-translate-y-1/2">
              <Button size="sm" variant="outline" disabled={resuming} onclick={resume}>
                {#if resuming}<Spinner />{/if}
                Resume
              </Button>
            </Alert.Action>
          </Alert.Root>
        {/if}

        <Field.Field data-invalid={urlError ? true : undefined}>
          <div class="flex items-center justify-between gap-2">
            <Field.Label for="webhook-url">Webhook URL</Field.Label>
            {#if saved.kind === 'webhook' && url.trim() === savedUrl}
              {#if saved.paused}
                <Badge variant="warning">Paused</Badge>
              {:else}
                <Badge variant="success">Active</Badge>
              {/if}
            {/if}
          </div>
          <Input
            id="webhook-url"
            type="url"
            inputmode="url"
            autocomplete="off"
            spellcheck={false}
            placeholder="https://agent.example.com/events"
            bind:value={url}
            oninput={() => (urlError = undefined)}
            disabled={saving}
            aria-invalid={urlError ? true : undefined}
            aria-describedby={urlError ? 'webhook-url-error' : undefined}
            class="font-mono text-sm"
          />
          {#if urlError}
            <Field.Error id="webhook-url-error">{urlError}</Field.Error>
          {/if}
        </Field.Field>

        {#if saved.kind === 'webhook' && url.trim() === savedUrl}
          <div class="flex items-center justify-between gap-3">
            <div class="flex min-w-0 flex-col gap-1">
              <span class="text-sm font-medium">Signing secret</span>
              <span class="truncate font-mono text-sm text-muted-foreground"><span aria-hidden="true">whsec_••••••••••••</span><span class="sr-only">Hidden</span></span>
            </div>
            <Button variant="outline" onclick={() => (rotateOpen = true)}>Rotate secret</Button>
          </div>
        {/if}
      {/if}
    </Card.Content>
    <Card.Footer class="justify-end gap-2">
      {#if dirty && !saving}
        <Button variant="ghost" onclick={discard}>Discard</Button>
      {/if}
      <Button type="submit" disabled={!dirty || saving}>
        {#if saving}
          <Spinner />
          {kind === 'webhook' ? 'Verifying URL…' : 'Saving…'}
        {:else}
          Save
        {/if}
      </Button>
    </Card.Footer>
  </form>
</Card.Root>

<AlertDialog.Root bind:open={rotateOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Rotate the signing secret?</AlertDialog.Title>
      <AlertDialog.Description>The current secret stops working right away.</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel disabled={rotating}>Cancel</AlertDialog.Cancel>
      <Button disabled={rotating} onclick={rotate}>
        {#if rotating}<Spinner />{/if}
        Rotate secret
      </Button>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<SecretDialog bind:secret />
