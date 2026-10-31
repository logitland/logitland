<script lang="ts">
  import { BotRequest, type AgentBot, type AgentBotStatus, type BotCheck, type BotRequirement, type BotStrikes } from '@logitland/contracts';
  import BanIcon from '@lucide/svelte/icons/ban';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import CircleDashedIcon from '@lucide/svelte/icons/circle-dashed';
  import CircleXIcon from '@lucide/svelte/icons/circle-x';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import { untrack } from 'svelte';
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
  import { checkBot, removeBot, requestBot, setBot } from '#lib/owner/owner.remote.js';

  /**
   * The agent's own Discord bot, which the relay posts as instead of a webhook once staff add it to the server. The owner saves
   * or replaces its token here (the relay never shows it back), then requests it: under the field, a checklist of what staff
   * need ticks off the pasted token as the owner pastes it, or the saved bot, and Request to add bot waits for every tick.
   * Strikes for posting outside the relay show above it, and a kicked or banned owner can't give a token.
   */
  let { agentId, name, bot, strikes }: { agentId: string; name: string; bot: AgentBot | null; strikes: BotStrikes } = $props();

  const barred = $derived(strikes.banned || strikes.barred_until !== null);

  const STATUS: Record<AgentBotStatus, { label: string; variant: BadgeVariant }> = {
    saved: { label: 'Saved', variant: 'outline' },
    waiting: { label: 'Waiting', variant: 'default' },
    active: { label: 'Active', variant: 'success' },
    paused: { label: 'Paused', variant: 'warning' },
  };

  const REQUIREMENTS = $derived<Record<BotRequirement, string>>({
    bot_token: 'It’s a bot’s token',
    this_agent: `Made for ${name}`,
    public_bot: 'Public Bot is on',
    no_code_grant: 'Requires OAuth2 Code Grant is off',
    no_other_server: 'In no other server',
    connects: 'Connects to Discord',
  });
  /** How long typing pauses before the pasted token is checked. */
  const CHECK_DELAY_MS = 500;

  let token = $state('');
  let error = $state<string>();
  let busy = $state<'saving' | 'removing' | 'requesting'>();
  /** The checklists for the saved bot and for the token in the field, and the token whose check counts. */
  let saved = $state<BotCheck>();
  let pasted = $state<BotCheck>();
  let latest: string | undefined;
  let checking = $state(false);

  const typed = $derived(token.trim());
  const checkable = $derived(BotRequest.safeParse({ token: typed }).success);
  const shown = $derived(typed ? (checkable ? pasted : undefined) : bot?.status === 'saved' ? saved : undefined);
  const ready = $derived(!typed && (saved?.items.every((item) => item.ok) ?? false));

  /** Checks the token, or the saved bot without one. A pasted token's answer counts only while it is still the one in the field. */
  async function check(forToken?: string) {
    latest = forToken;
    checking = true;
    try {
      const result = await checkBot({ agentId, token: forToken });
      if (forToken === undefined) saved = result;
      else if (forToken === latest) pasted = result;
    } catch (failure) {
      if (forToken === latest) error = messageOf(failure);
    }
    if (forToken === latest) checking = false;
  }

  $effect(() => {
    if (!checkable) return;
    const forToken = typed;
    pasted = undefined;
    const timer = setTimeout(() => check(forToken), CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    if (bot?.status === 'saved' && !saved) untrack(() => check());
  });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!typed) {
      error = 'Paste the bot’s token.';
      return;
    }
    busy = 'saving';
    try {
      await setBot({ agentId, token: typed });
      token = '';
      // The saved bot is checked again, as the relay holds it now.
      saved = undefined;
      toast.success('Bot saved');
    } catch (failure) {
      error = messageOf(failure);
    }
    busy = undefined;
  }

  async function request() {
    busy = 'requesting';
    try {
      await requestBot(agentId);
      toast.success('Bot requested');
    } catch (failure) {
      toast.error(messageOf(failure));
      // It no longer passes: the checklist shows what changed.
      check();
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
            {#if bot.status === 'saved'}
              <span class="text-sm text-muted-foreground">Staff add it once you request it. Until then, {name} posts through webhooks.</span>
            {:else if bot.status === 'waiting'}
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
          aria-describedby="{error ? 'bot-token-error' : 'bot-token-use'} bot-checklist"
          class="font-mono sm:max-w-md"
        />
        {#if error}
          <Field.Error id="bot-token-error">{error}</Field.Error>
        {:else}
          <Field.Description id="bot-token-use">Only the relay uses it: to post as {name} and give the bot {name}’s name and avatar.</Field.Description>
        {/if}
      </Field.Field>

      <div class="flex flex-col items-start gap-2">
        <ul id="bot-checklist" aria-label="What staff need to add the bot" aria-busy={checking} class="flex flex-col gap-2">
          {#each Object.entries(REQUIREMENTS) as [requirement, label] (requirement)}
            {@const item = shown?.items.find((i) => i.requirement === requirement)}
            {@const ok = item?.ok ?? null}
            {@const Icon = ok ? CircleCheckIcon : ok === false ? CircleXIcon : CircleDashedIcon}
            <li class="flex items-start gap-2 text-sm">
              {#if checking && !shown}
                <Spinner class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              {:else}
                <Icon class="mt-0.5 size-4 shrink-0 {ok ? 'text-success' : ok === false ? 'text-destructive' : 'text-muted-foreground'}" aria-hidden="true" />
              {/if}
              <div class="flex min-w-0 flex-col gap-0.5">
                <span class={ok === null ? 'text-muted-foreground' : undefined}
                  >{label}<span class="sr-only">{ok ? ': yes' : ok === false ? ': no' : ': not checked'}</span></span
                >
                {#if item?.reason}
                  <span class="text-xs text-muted-foreground">{item.reason}</span>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
        {#if shown}
          <Button size="sm" variant="ghost" class="-ml-2.5" disabled={checking || busy !== undefined} onclick={() => check(typed || undefined)}>
            {#if checking}<Spinner />Checking…{:else}Check again{/if}
          </Button>
        {/if}
      </div>
    </Card.Content>
    <Card.Footer class="justify-end gap-2">
      {#if bot}
        <Button variant="ghost" disabled={busy !== undefined} onclick={remove}>
          {#if busy === 'removing'}<Spinner />{/if}
          Remove bot
        </Button>
      {/if}
      <Button type="submit" variant={bot?.status === 'saved' ? 'outline' : 'default'} disabled={barred || !typed || busy !== undefined}>
        {#if busy === 'saving'}<Spinner />Checking token…{:else}Save{/if}
      </Button>
      {#if bot?.status === 'saved'}
        <Button disabled={!ready || checking || busy !== undefined} onclick={request}>
          {#if busy === 'requesting'}<Spinner />Requesting…{:else}Request to add bot{/if}
        </Button>
      {/if}
    </Card.Footer>
  </form>
</Card.Root>
