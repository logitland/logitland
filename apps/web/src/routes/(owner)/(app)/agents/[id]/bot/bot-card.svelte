<script lang="ts">
  import { BotRequest, type AgentBot, type AgentBotStatus, type BotCheck, type BotRequirement, type BotStrikes } from '@logitland/contracts';
  import BanIcon from '@lucide/svelte/icons/ban';
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import { untrack } from 'svelte';
  import { toast } from 'svelte-sonner';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { Badge, type BadgeVariant } from '#lib/components/ui/badge/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Skeleton } from '#lib/components/ui/skeleton/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import { formatDate, plural } from '#lib/fixtures/owner/format.js';
  import { messageOf } from '#lib/owner/errors.js';
  import { checkBot, removeBot, requestBot, setBot } from '#lib/owner/owner.remote.js';

  /**
   * The agent's own Discord bot, which the relay posts as instead of a webhook once staff add it to the server. Four steps run
   * across the top (save, request, staff add it, live). The owner pastes a token and, beside the field, what staff need is
   * checked as facts about the bot (Public Bot: On); a failing setting links to the bot's page in the Developer Portal. Save
   * waits for the pasted token to pass, and Request to add bot for the saved bot to pass again. The relay never shows the token
   * back. Strikes for posting outside the relay show above it, and a kicked or banned owner can't give a token.
   */
  let { agentId, name, bot, strikes }: { agentId: string; name: string; bot: AgentBot | null; strikes: BotStrikes } = $props();

  const barred = $derived(strikes.banned || strikes.barred_until !== null);

  const STATUS: Record<AgentBotStatus, { label: string; variant: BadgeVariant }> = {
    saved: { label: 'Saved', variant: 'outline' },
    waiting: { label: 'Waiting', variant: 'default' },
    active: { label: 'Active', variant: 'success' },
    paused: { label: 'Paused', variant: 'warning' },
  };

  /** Each requirement as a fact about the bot: its label, and the value when it is met and when it isn't. */
  const REQUIREMENTS = $derived<Record<BotRequirement, { label: string; met: string; unmet: string }>>({
    bot_token: { label: 'Token', met: 'Bot token', unmet: 'Not a bot’s' },
    this_agent: { label: 'Posts for', met: `${name} only`, unmet: 'Taken' },
    public_bot: { label: 'Public Bot', met: 'On', unmet: 'Off' },
    no_code_grant: { label: 'Requires OAuth2 Code Grant', met: 'Off', unmet: 'On' },
    no_other_server: { label: 'Other servers', met: 'None', unmet: 'In another' },
    connects: { label: 'Discord connection', met: 'Connects', unmet: 'Failed' },
  });
  /** Requirements fixed with a toggle on the bot's page in the Developer Portal. */
  const ON_BOT_PAGE = new Set<BotRequirement>(['public_bot', 'no_code_grant']);
  const PORTAL = 'https://discord.com/developers/applications';

  /** The four steps, and how many are done: none before saving (or once paused, as its token must be saved again), all once live. */
  const STEPS = $derived(['Save token', 'Request', 'Staff add it', `${name} posts as it`]);
  const DONE: Record<AgentBotStatus, number> = { saved: 1, waiting: 2, active: 4, paused: 0 };
  const done = $derived(bot ? DONE[bot.status] : 0);
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
  const passes = (check: BotCheck | undefined) => check?.items.every((item) => item.ok) ?? false;
  /** Save waits for the pasted token to pass, and Request for the saved bot to. */
  const savable = $derived(checkable && passes(pasted));
  const ready = $derived(!typed && passes(saved));
  /** The requirements show beside the field until the bot is requested, and again for any new token pasted. */
  const listed = $derived(!bot || bot.status === 'saved' || bot.status === 'paused' || typed !== '');

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
      <Card.Title>{bot?.username ?? 'Own bot'}</Card.Title>
      {#if bot}
        <Card.Action><Badge variant={STATUS[bot.status].variant}>{STATUS[bot.status].label}</Badge></Card.Action>
      {/if}
    </Card.Header>
    <Card.Content class="gap-6">
      <ol aria-label="Steps" class="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {#each STEPS as step, i (i)}
          {@const state = i < done ? 'done' : i === done ? 'current' : 'next'}
          <li class="flex flex-col gap-2" aria-current={state === 'current' ? 'step' : undefined}>
            <span class="h-1 rounded-full {state === 'done' ? 'bg-brand' : state === 'current' ? 'bg-brand/40' : 'bg-muted'}"></span>
            <span class="text-xs {state === 'next' ? 'text-muted-foreground' : 'font-medium'}">
              {step}<span class="sr-only">{state === 'done' ? ', done' : state === 'current' ? ', next up' : ''}</span>
            </span>
          </li>
        {/each}
      </ol>

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

      <!-- Two columns even without the requirements, so the field keeps its width. -->
      <div class="grid items-start gap-6 lg:grid-cols-2">
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
            aria-describedby="{error ? 'bot-token-error' : 'bot-token-use'}{listed ? ' bot-checklist' : ''}"
            class="font-mono"
          />
          {#if error}
            <Field.Error id="bot-token-error">{error}</Field.Error>
          {:else}
            <Field.Description id="bot-token-use">Only the relay uses it: to post as {name} and give the bot {name}’s name and avatar.</Field.Description>
          {/if}
        </Field.Field>

        {#if listed}
          <section aria-labelledby="bot-needs" class="rounded-xl border">
            <header class="flex min-h-11 items-center justify-between gap-3 border-b py-1 pr-1.5 pl-4">
              <h3 id="bot-needs" class="text-sm font-medium">What staff need</h3>
              {#if shown}
                <Button size="sm" variant="ghost" disabled={checking || busy !== undefined} onclick={() => check(typed || undefined)}>
                  {#if checking}<Spinner />Checking…{:else}Check again{/if}
                </Button>
              {:else if !bot}
                <Button size="sm" variant="ghost" href={PORTAL} target="_blank" rel="noopener">
                  Developer Portal
                  <ExternalLinkIcon aria-hidden="true" />
                </Button>
              {/if}
            </header>
            <ul id="bot-checklist" aria-busy={checking} class="divide-y text-sm">
              {#each Object.entries(REQUIREMENTS) as [requirement, fact] (requirement)}
                {@const item = shown?.items.find((i) => i.requirement === requirement)}
                {@const ok = item?.ok ?? null}
                <li class="px-4 py-2.5 {ok === false ? 'bg-destructive/6' : ''}">
                  <div class="flex items-center justify-between gap-4">
                    <span class="text-muted-foreground">{fact.label}</span>
                    {#if checking && !shown}
                      <Skeleton class="h-4 w-16" />
                    {:else if ok === null}
                      <span class="text-muted-foreground" aria-label="Not checked">–</span>
                    {:else}
                      <span class="flex items-center gap-2 font-medium {ok ? '' : 'text-destructive'}">
                        <span class="size-1.5 rounded-full {ok ? 'bg-success' : 'bg-destructive'}" aria-hidden="true"></span>
                        {ok ? fact.met : fact.unmet}
                      </span>
                    {/if}
                  </div>
                  {#if item?.reason}
                    <p class="mt-1 text-xs text-muted-foreground">{item.reason}</p>
                    {#if shown?.bot && ON_BOT_PAGE.has(item.requirement)}
                      <Button size="sm" variant="outline" class="mt-2" href="{PORTAL}/{shown.bot.application_id}/bot" target="_blank" rel="noopener">
                        Open {shown.bot.username}’s Bot page
                        <ExternalLinkIcon aria-hidden="true" />
                      </Button>
                    {/if}
                  {/if}
                </li>
              {/each}
            </ul>
          </section>
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
      <Button type="submit" variant={bot?.status === 'saved' ? 'outline' : 'default'} disabled={barred || !savable || busy !== undefined}>
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
