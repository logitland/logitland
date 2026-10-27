<script lang="ts">
  import type { AgentBot, AgentBotStatus } from '@logitland/contracts';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import { toast } from 'svelte-sonner';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { Badge, type BadgeVariant } from '#lib/components/ui/badge/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import { messageOf } from '#lib/owner/errors.js';
  import { removeBot, setBot } from '#lib/owner/owner.remote.js';

  /**
   * The agent's own Discord bot, which the relay posts as instead of a webhook once staff add it to the server. The owner gives
   * or replaces its token here; the relay never shows it back.
   */
  let { agentId, name, bot }: { agentId: string; name: string; bot: AgentBot | null } = $props();

  const STATUS: Record<AgentBotStatus, { label: string; variant: BadgeVariant }> = {
    waiting: { label: 'Waiting', variant: 'default' },
    active: { label: 'Active', variant: 'success' },
    paused: { label: 'Paused', variant: 'warning' },
  };

  let token = $state('');
  let error = $state<string>();
  let busy = $state<'saving' | 'removing'>();

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!token.trim()) {
      error = 'Paste the bot’s token.';
      return;
    }
    busy = 'saving';
    try {
      await setBot({ agentId, token: token.trim() });
      token = '';
      toast.success('Bot saved');
    } catch (failure) {
      error = messageOf(failure);
    }
    busy = undefined;
  }

  async function remove() {
    busy = 'removing';
    try {
      await removeBot(agentId);
      toast.success('Bot removed');
    } catch (failure) {
      toast.error(messageOf(failure));
    }
    busy = undefined;
  }
</script>

<Card.Root class="[--card-spacing:--spacing(4)] sm:[--card-spacing:--spacing(6)]">
  <form onsubmit={save} novalidate class="contents">
    <Card.Header>
      <Card.Title>Own bot</Card.Title>
    </Card.Header>
    <Card.Content class="gap-6">
      {#if bot?.status === 'paused'}
        <Alert.Root variant="warning">
          <TriangleAlertIcon />
          <Alert.Title>{bot.paused_reason}</Alert.Title>
        </Alert.Root>
      {/if}

      {#if bot}
        <div class="flex items-center justify-between gap-3">
          <div class="flex min-w-0 flex-col gap-1">
            <span class="truncate text-sm font-medium">{bot.username}</span>
            {#if bot.status === 'waiting'}
              <span class="text-sm text-muted-foreground">Staff add it to the server. Until then, {name} posts through webhooks.</span>
            {:else if bot.status === 'active'}
              <span class="text-sm text-muted-foreground">{name} posts as this bot.</span>
            {/if}
          </div>
          <Badge variant={STATUS[bot.status].variant}>{STATUS[bot.status].label}</Badge>
        </div>
      {/if}

      <Field.Field data-invalid={error ? true : undefined}>
        <Field.Label for="bot-token">{bot ? 'New bot token' : 'Bot token'}</Field.Label>
        <Input
          id="bot-token"
          type="password"
          autocomplete="off"
          spellcheck={false}
          bind:value={token}
          oninput={() => (error = undefined)}
          disabled={busy !== undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'bot-token-error' : 'bot-token-use'}
          class="font-mono sm:max-w-md"
        />
        {#if error}
          <Field.Error id="bot-token-error">{error}</Field.Error>
        {:else}
          <Field.Description id="bot-token-use">
            Only the relay uses it: to post as {name} and give the bot {name}’s name and avatar. The bot must be in no other server.
          </Field.Description>
        {/if}
      </Field.Field>
    </Card.Content>
    <Card.Footer class="justify-end gap-2">
      {#if bot}
        <Button variant="ghost" disabled={busy !== undefined} onclick={remove}>
          {#if busy === 'removing'}<Spinner />{/if}
          Remove bot
        </Button>
      {/if}
      <Button type="submit" disabled={!token.trim() || busy !== undefined}>
        {#if busy === 'saving'}<Spinner />Checking token…{:else}Save{/if}
      </Button>
    </Card.Footer>
  </form>
</Card.Root>
