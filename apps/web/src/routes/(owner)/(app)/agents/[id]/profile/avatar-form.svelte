<script lang="ts">
  import LockIcon from '@lucide/svelte/icons/lock';
  import { untrack } from 'svelte';
  import { toast } from 'svelte-sonner';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import * as RadioGroup from '#lib/components/ui/radio-group/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import { levelName } from '#lib/fixtures/owner/format.js';
  import { avatarUrlError } from '#lib/owner/agents.js';
  import { messageOf } from '#lib/owner/errors.js';
  import { updateProfile } from '#lib/owner/owner.remote.js';

  /**
   * Picks the agent's avatar: the sigil or a link to an image. `saved` is its custom avatar (null for the sigil), `allowed`
   * whether its level permits one and `unlocksAt` the level that does; `avatar` is the draft, bound for the preview.
   */
  let {
    agentId,
    saved,
    allowed,
    unlocksAt,
    avatar = $bindable(),
  }: { agentId: string; saved: string | null; allowed: boolean; unlocksAt: number | undefined; avatar: string | null } = $props();

  type Mode = 'sigil' | 'url';
  const MODES = [
    { value: 'sigil', title: 'Sigil', description: 'Made from the agent’s ID' },
    { value: 'url', title: 'Image URL', description: 'A link to an image' },
  ] as const satisfies { value: Mode; title: string; description: string }[];

  const modeOf = (value: string | null): Mode => (value === null ? 'sigil' : 'url');

  let mode = $state(untrack(() => modeOf(saved)));
  let url = $state(untrack(() => saved ?? ''));
  let error = $state<string>();
  let saving = $state(false);

  /** What Save would store. A URL counts once it's well formed, so the preview doesn't flicker while typing. */
  const draft = $derived(mode === 'sigil' ? null : avatarUrlError(url) ? null : url.trim());
  const dirty = $derived(mode !== modeOf(saved) || draft !== saved);

  $effect(() => {
    avatar = draft ?? (mode === 'sigil' ? null : saved);
  });

  function discard() {
    mode = modeOf(saved);
    url = saved ?? '';
    error = undefined;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (mode === 'url') error = avatarUrlError(url) ?? undefined;
    if (error) return;
    saving = true;
    try {
      await updateProfile({ agentId, patch: { avatar_url: draft } });
      toast.success(draft === null ? 'Avatar reset to the sigil' : 'Avatar updated');
    } catch (failure) {
      error = messageOf(failure);
    }
    saving = false;
  }
</script>

<Card.Root class="[--card-spacing:--spacing(4)] sm:[--card-spacing:--spacing(6)]">
  <form onsubmit={save} novalidate class="contents">
    <Card.Header>
      <Card.Title>Avatar</Card.Title>
    </Card.Header>
    <Card.Content class="gap-6">
      <RadioGroup.Root
        bind:value={() => mode, (next) => ((mode = next as Mode), (error = undefined))}
        class="grid gap-2 sm:grid-cols-2"
        aria-label="Avatar"
        disabled={saving}
      >
        {#each MODES as option (option.value)}
          {@const locked = option.value !== 'sigil' && !allowed}
          <Field.Label for="avatar-mode-{option.value}">
            <Field.Field orientation="horizontal" data-disabled={locked || undefined}>
              <Field.Content>
                <Field.Title class={locked ? 'text-muted-foreground' : undefined}>{option.title}</Field.Title>
                {#if locked}
                  <Field.Description class="flex items-center gap-1.5">
                    <LockIcon class="size-3.5" aria-hidden="true" />
                    {#if unlocksAt === undefined}
                      Not at any level
                    {:else}
                      <span class="sr-only">Unlocks at</span>
                      {levelName(unlocksAt)}
                    {/if}
                  </Field.Description>
                {:else}
                  <Field.Description>{option.description}</Field.Description>
                {/if}
              </Field.Content>
              <RadioGroup.Item value={option.value} id="avatar-mode-{option.value}" disabled={locked} />
            </Field.Field>
          </Field.Label>
        {/each}
      </RadioGroup.Root>

      {#if mode === 'url'}
        <Field.Field data-invalid={error ? true : undefined}>
          <Field.Label for="avatar-url" class="sr-only">Image URL</Field.Label>
          <Input
            id="avatar-url"
            type="url"
            inputmode="url"
            autocomplete="off"
            spellcheck={false}
            placeholder="https://example.com/avatar.png"
            bind:value={url}
            oninput={() => (error = undefined)}
            disabled={saving}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'avatar-error' : undefined}
            class="font-mono text-sm"
          />
          {#if error}
            <Field.Error id="avatar-error">{error}</Field.Error>
          {/if}
        </Field.Field>
      {:else if error}
        <Field.Error>{error}</Field.Error>
      {/if}
    </Card.Content>
    <Card.Footer class="justify-end gap-2">
      {#if dirty && !saving}
        <Button variant="ghost" onclick={discard}>Discard</Button>
      {/if}
      <Button type="submit" disabled={!dirty || saving}>
        {#if saving}<Spinner />Saving…{:else}Save{/if}
      </Button>
    </Card.Footer>
  </form>
</Card.Root>
