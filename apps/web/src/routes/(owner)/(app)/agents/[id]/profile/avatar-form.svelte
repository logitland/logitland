<script lang="ts">
  import LockIcon from '@lucide/svelte/icons/lock';
  import { untrack } from 'svelte';
  import { toast } from 'svelte-sonner';
  import AgentAvatar from '#lib/components/shell/agent-avatar.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import * as RadioGroup from '#lib/components/ui/radio-group/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import { LEVELS, type Agent } from '#lib/fixtures/owner/data.js';
  import { formatBytes, levelName } from '#lib/fixtures/owner/format.js';
  import { AVATAR_TYPES, avatarFileError, avatarUrlError, canSetAvatar, dashboard } from '#lib/fixtures/owner/store.svelte.js';

  /** Picks the agent's avatar: the sigil, an uploaded image, or a link. `avatar` is the draft, bound for the preview. */
  let { agent, avatar = $bindable() }: { agent: Agent; avatar: string | null } = $props();

  type Mode = 'sigil' | 'upload' | 'url';
  const MODES = [
    { value: 'sigil', title: 'Sigil', description: 'Made from the agent’s ID' },
    { value: 'upload', title: 'Upload image', description: 'PNG, JPEG, GIF or WebP, up to 2 MB' },
    { value: 'url', title: 'Image URL', description: 'A link to an image' },
  ] as const satisfies { value: Mode; title: string; description: string }[];

  const modeOf = (value: string | null): Mode => (value === null ? 'sigil' : value.startsWith('data:') ? 'upload' : 'url');
  const unlocksAt = LEVELS.findIndex((rule) => rule.permissions.includes('avatar'));

  let mode = $state(untrack(() => modeOf(agent.avatar)));
  let upload = $state(untrack(() => (modeOf(agent.avatar) === 'upload' ? agent.avatar : null)));
  let url = $state(untrack(() => (modeOf(agent.avatar) === 'url' ? (agent.avatar ?? '') : '')));
  let file = $state<{ name: string; size: number }>();
  let error = $state<string>();
  let saving = $state(false);
  let picker = $state<HTMLInputElement>();

  const allowed = $derived(canSetAvatar(agent));
  /** What Save would store. A URL counts once it's well formed, so the preview doesn't flicker while typing. */
  const draft = $derived(mode === 'sigil' ? null : mode === 'upload' ? upload : avatarUrlError(url) ? null : url.trim());
  const dirty = $derived(mode !== modeOf(agent.avatar) || draft !== agent.avatar);

  $effect(() => {
    avatar = draft ?? (mode === 'sigil' ? null : agent.avatar);
  });

  function discard() {
    mode = modeOf(agent.avatar);
    upload = mode === 'upload' ? agent.avatar : null;
    url = mode === 'url' ? (agent.avatar ?? '') : '';
    file = undefined;
    error = undefined;
  }

  function choose(event: Event & { currentTarget: HTMLInputElement }) {
    const chosen = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!chosen) return;
    error = avatarFileError(chosen) ?? undefined;
    if (error) return;
    const reader = new FileReader();
    reader.onload = () => {
      upload = String(reader.result);
      file = { name: chosen.name, size: chosen.size };
    };
    reader.readAsDataURL(chosen);
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (mode === 'upload' && !upload) error = 'Choose an image to upload.';
    if (mode === 'url') error = avatarUrlError(url) ?? undefined;
    if (error) return;
    saving = true;
    const result = await dashboard.saveAvatar(agent.id, draft);
    saving = false;
    if (!result.ok) {
      error = result.error;
      return;
    }
    toast.success(draft === null ? 'Avatar reset to the sigil' : 'Avatar updated');
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
        class="grid gap-2 sm:grid-cols-3"
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
                    <LockIcon class="size-3.5" aria-hidden="true" /><span class="sr-only">Unlocks at</span>
                    {levelName(unlocksAt)}
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

      {#if mode === 'upload'}
        <Field.Field data-invalid={error ? true : undefined}>
          <div class="flex items-center gap-4">
            <AgentAvatar agent={{ id: agent.id, avatar: upload }} class="size-16" />
            <div class="flex min-w-0 flex-col items-start gap-1.5">
              <Button
                variant="outline"
                disabled={saving}
                aria-describedby={error ? 'avatar-error' : undefined}
                onclick={() => picker?.click()}
              >
                {upload ? 'Choose another' : 'Choose image'}
              </Button>
              {#if file}
                <span class="max-w-full truncate text-xs text-muted-foreground">{file.name} · {formatBytes(file.size)}</span>
              {/if}
            </div>
          </div>
          <input bind:this={picker} type="file" accept={AVATAR_TYPES.join(',')} class="hidden" onchange={choose} />
          {#if error}
            <Field.Error id="avatar-error">{error}</Field.Error>
          {/if}
        </Field.Field>
      {:else if mode === 'url'}
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
      {/if}
    </Card.Content>
    <Card.Footer class="justify-end gap-2">
      {#if dirty && !saving}
        <Button variant="ghost" onclick={discard}>Discard</Button>
      {/if}
      <Button type="submit" disabled={!dirty || saving}>
        {#if saving}<Spinner />{mode === 'url' ? 'Checking image…' : 'Saving…'}{:else}Save{/if}
      </Button>
    </Card.Footer>
  </form>
</Card.Root>
