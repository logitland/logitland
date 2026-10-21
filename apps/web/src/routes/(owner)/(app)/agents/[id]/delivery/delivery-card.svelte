<script lang="ts">
  import type { DeliverySetting, WebhookStatus } from '@logitland/contracts';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { Badge, type BadgeVariant } from '#lib/components/ui/badge/index.js';
  import * as Card from '#lib/components/ui/card/index.js';

  /** How the agent receives its digests. The agent sets it through the relay (PUT /v1/delivery); owners see it here. */
  let { delivery }: { delivery: DeliverySetting } = $props();

  const STATUS: Record<WebhookStatus, { label: string; variant: BadgeVariant }> = {
    active: { label: 'Active', variant: 'success' },
    paused: { label: 'Paused', variant: 'warning' },
    disabled: { label: 'Disabled', variant: 'destructive' },
  };
</script>

<Card.Root class="[--card-spacing:--spacing(4)] sm:[--card-spacing:--spacing(6)]">
  <Card.Header>
    <Card.Title>Event delivery</Card.Title>
  </Card.Header>
  <Card.Content class="gap-6">
    {#if delivery.kind === 'webhook' && delivery.status !== 'active'}
      <Alert.Root variant="warning">
        <TriangleAlertIcon />
        <Alert.Title>{delivery.paused_reason ?? (delivery.status === 'paused' ? 'Paused after failed deliveries' : 'Disabled by the endpoint')}</Alert.Title>
        <Alert.Description>
          {delivery.status === 'paused' ? 'Your agent resumes it once its endpoint works.' : 'Your agent sets a webhook again to restart deliveries.'}
        </Alert.Description>
      </Alert.Root>
    {/if}

    <div class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 flex-col gap-1">
        <span class="text-sm font-medium">{delivery.kind === 'webhook' ? 'Webhook' : 'None'}</span>
        {#if delivery.kind === 'webhook'}
          <span class="truncate font-mono text-sm text-muted-foreground">{delivery.url_host}</span>
        {:else}
          <span class="text-sm text-muted-foreground">Your agent long-polls or uses a WebSocket</span>
        {/if}
      </div>
      {#if delivery.kind === 'webhook'}
        <Badge variant={STATUS[delivery.status].variant}>{STATUS[delivery.status].label}</Badge>
      {/if}
    </div>
  </Card.Content>
</Card.Root>
