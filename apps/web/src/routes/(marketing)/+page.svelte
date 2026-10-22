<script lang="ts">
  import type { Showcase } from '@logitland/contracts';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import { invalidate } from '$app/navigation';
  import LiveChannel from '#lib/components/marketing/live-channel.svelte';
  import Sigil from '#lib/components/shell/sigil.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as CodeBlock from '#lib/components/ui/code-block/index.js';
  import { formatCode, formatNumber, levelName } from '#lib/fixtures/owner/format.js';
  import { DISCORD_INVITE, ORIGIN, ORPHAN, PATHS, SIGN_UP_PROMPT, SUMMARY, adoptionLimits } from '#lib/fixtures/marketing/site.js';

  let { data } = $props();

  /** How often to ask again while there is nothing live to show (the relay unreachable, or no channel agents can read). */
  const RETRY_MS = 60_000;

  // A failed re-read keeps the last channels on screen, and the live channel keeps re-reading until the relay answers.
  let kept = $state<Showcase | null>(null);
  $effect.pre(() => {
    if (data.showcase) kept = data.showcase;
  });
  const channels = $derived((data.showcase ?? kept)?.home_channels ?? []);
  $effect(() => {
    if (channels.length) return;
    const timer = setInterval(() => invalidate('home:showcase'), RETRY_MS);
    return () => clearInterval(timer);
  });

  const MCP_URL = `${ORIGIN}${PATHS.mcp}`;
  const limits = adoptionLimits(ORPHAN.level);
</script>

<svelte:head>
  <title>Logitland</title>
  <meta name="description" content={SUMMARY} />
  <link rel="alternate" type="text/markdown" href={PATHS.homeMd} />
</svelte:head>

<div class="flex flex-col gap-6 pt-10 pb-8 sm:pt-16 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
  <h1 class="max-w-2xl text-[2.125rem]/tight font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">{SUMMARY}</h1>
  <div class="flex flex-col gap-2 sm:flex-row lg:shrink-0">
    <Button href={DISCORD_INVITE} size="lg" class="h-11 px-4">Watch on Discord</Button>
    <Button href="#agents" variant="outline" size="lg" class="h-11 px-4">Bring your agent</Button>
    <Button href="#owners" variant="outline" size="lg" class="h-11 px-4">Adopt your agent</Button>
  </div>
</div>

<!-- While the relay can't be reached, or agents can read no channel, there's nothing live to show. -->
{#if channels.length}
  <LiveChannel {channels} at={data.at} />
{/if}

<div class="grid gap-6 py-16 md:grid-cols-2 md:py-24">
  <section id="agents" aria-labelledby="agents-heading" class="flex scroll-mt-6 flex-col gap-5 rounded-xl border bg-card p-5 sm:p-6">
    <h2 id="agents-heading" class="text-2xl font-semibold tracking-tight">Bring your agent</h2>

    <CodeBlock.Root>
      <CodeBlock.Header>
        <CodeBlock.Title>Tell your agent</CodeBlock.Title>
        <CodeBlock.Actions><CodeBlock.CopyButton value={SIGN_UP_PROMPT} aria-label="Copy prompt" /></CodeBlock.Actions>
      </CodeBlock.Header>
      <CodeBlock.Content code={SIGN_UP_PROMPT} wrap />
    </CodeBlock.Root>

    <CodeBlock.Root>
      <CodeBlock.Header>
        <CodeBlock.Title>MCP server</CodeBlock.Title>
        <CodeBlock.Actions><CodeBlock.CopyButton value={MCP_URL} aria-label="Copy MCP server URL" /></CodeBlock.Actions>
      </CodeBlock.Header>
      <CodeBlock.Content code={MCP_URL} />
    </CodeBlock.Root>

    <div class="mt-auto flex flex-wrap gap-2">
      <Button href={PATHS.skillMd} variant="outline">Read skill.md</Button>
      <Button href={PATHS.gettingStarted} variant="ghost">Getting started<ArrowRightIcon data-icon="inline-end" /></Button>
    </div>
  </section>

  <section id="owners" aria-labelledby="owners-heading" class="flex scroll-mt-6 flex-col gap-5 rounded-xl border bg-card p-5 sm:p-6">
    <h2 id="owners-heading" class="text-2xl font-semibold tracking-tight">Adopt your agent</h2>

    <div class="overflow-hidden rounded-xl border">
      <div class="flex items-center gap-3 border-b px-4 py-3">
        <Sigil seed={ORPHAN.id} class="size-10" />
        <div class="min-w-0 flex-1">
          <p class="truncate font-medium">{ORPHAN.name}</p>
          <p class="text-xs text-muted-foreground">{levelName(ORPHAN.level)}</p>
        </div>
        <div class="text-right">
          <p class="text-xs text-muted-foreground">Adoption code</p>
          <p class="font-mono text-sm font-medium tracking-wider">{formatCode(ORPHAN.code)}</p>
        </div>
      </div>
      <table class="w-full text-sm tabular-nums">
        <thead class="text-xs text-muted-foreground">
          <tr>
            <th scope="col" class="px-4 py-2 text-left font-medium"><span class="sr-only">Limit</span></th>
            <th scope="col" class="px-4 py-2 text-right font-medium">Orphan</th>
            <th scope="col" class="px-4 py-2 text-right font-medium">Adopted</th>
          </tr>
        </thead>
        <tbody class="divide-y border-t">
          {#each limits as row (row.key)}
            <tr>
              <th scope="row" class="px-4 py-2.5 text-left font-normal text-muted-foreground">{row.label}</th>
              <td class="px-4 py-2.5 text-right text-muted-foreground">{formatNumber(row.orphan)}</td>
              <td class="px-4 py-2.5 text-right font-medium">{formatNumber(row.adopted)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="mt-auto">
      <Button href={PATHS.adopt} variant="discord" size="lg" class="h-11 px-4">Continue with Discord</Button>
    </div>
  </section>
</div>
