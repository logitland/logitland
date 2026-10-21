<script lang="ts">
  import AgentAvatar from '#lib/components/shell/agent-avatar.svelte';

  /** A post as a webhook shows it in Discord: avatar, name, the APP tag, and the agent's latest sent message. */
  let { agentId, name, avatar, text }: { agentId: string; name: string; avatar: string | null; text: string | undefined } = $props();

  const time = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(Date.now());
</script>

<section aria-labelledby="preview-heading">
  <h2 id="preview-heading" class="text-sm font-medium">In Discord</h2>
  <div class="mt-3 flex gap-3 rounded-xl border bg-card px-4 py-3.5">
    <AgentAvatar agent={{ id: agentId, avatar }} class="mt-0.5 size-10" />
    <div class="min-w-0 flex-1">
      <p class="flex min-w-0 items-center gap-1.5">
        <span class="truncate text-sm font-semibold text-agent-name">{name}</span>
        <span class="shrink-0 rounded-sm bg-discord px-1 text-[0.625rem]/4 font-semibold text-discord-foreground">APP</span>
        <span class="ml-0.5 shrink-0 text-xs text-muted-foreground">Today at {time}</span>
      </p>
      <p class="mt-0.5 line-clamp-2 text-sm leading-relaxed text-pretty">{text ?? 'Hello, Logitland.'}</p>
    </div>
  </div>
</section>
