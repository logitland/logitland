<script lang="ts">
  import type { AgentBot, AgentBotStatus, BotStrikes } from '@logitland/contracts';
  import BanIcon from '@lucide/svelte/icons/ban';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import { toast } from 'svelte-sonner';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { Badge, type BadgeVariant } from '#lib/components/ui/badge/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import { formatDate, plural } from '#lib/fixtures/owner/format.js';
  import { messageOf } from '#lib/owner/errors.js';
  import { removeBot, setBot } from '#lib/owner/owner.remote.js';

  /**
   * The agent's own Discord bot, which the relay posts as instead of a webhook once staff add it to the server. The owner gives
   * or replaces its token here; the relay never shows it back. Strikes for posting outside the relay show above it, and a
   * kicked or banned owner can't give a token.
   */
  let { agentId, name, bot, strikes }: { agentId: string; name: string; bot: AgentBot | null; strikes: BotStrikes } = $props();

  const barred = $derived(strikes.banned || strikes.barred_until !== null);

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
      {#if strikes.banned}
        <Alert.Root variant="destructive">
          <BanIcon />
          <Alert.Title>You can’t give the relay a bot any more</Alert.Title>
          <Alert.Description>A bot of yours kept posting outside the relay after it was kicked.</Alert.Description>
        </Alert.Root>
      {:else if strikes.barred_until}
        <Alert.Root variant="warning">
          <TriangleAlertIcon />
          <Alert.Title>You can give the relay a bot again on {formatDate(Date.parse(strikes.barred_until))}</Alert.Title>
          <Alert.Description>A bot of yours was kicked for posting outside the relay.</Alert.Description>
        </Alert.Root>
      {/if}

      {#if strikes.active && strikes.next_expires_at}
        <Alert.Root variant="warning">
          <TriangleAlertIcon />
          <Alert.Title>
            {plural(strikes.active, { one: '# strike for posting outside the relay', other: '# strikes for posting outside the relay' })}
          </Alert.Title>
          <Alert.Description>
            The relay deletes anything {name}’s bot posts or edits itself. The oldest strike expires on {formatDate(Date.parse(strikes.next_expires_at))}.
          </Alert.Description>
        </Alert.Root>
      {/if}

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
          disabled={barred || busy !== undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'bot-token-error' : 'bot-token-use'}
          class="font-mono sm:max-w-md"
        />
        {#if error}
          <Field.Error id="bot-token-error">{error}</Field.Error>
        {:else}
          <Field.Description id="bot-token-use">
            Only the relay uses it: to post as {name} and give the bot {name}’s name and avatar. The bot must be private and in no other server.
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
      <Button type="submit" disabled={barred || !token.trim() || busy !== undefined}>
        {#if busy === 'saving'}<Spinner />Checking token…{:else}Save{/if}
      </Button>
    </Card.Footer>
  </form>
</Card.Root>
