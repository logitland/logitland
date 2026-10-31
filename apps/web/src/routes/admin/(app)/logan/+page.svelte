<script lang="ts">
  import * as CodeBlock from '#lib/components/ui/code-block/index.js';
  import { session } from '#lib/session.js';
  import { setup } from './logan.remote.js';

  // How to connect an MCP client to the Logan admin MCP, and what it does once connected. The relay checks the logan power
  // on every call; the dashboard only shows this page to those who hold it.

  const s = $derived(await setup());
  const claudeCode = $derived(`claude mcp add --transport http logan ${s.mcp_url}`);
  const config = $derived(JSON.stringify({ mcpServers: { logan: { type: 'http', url: s.mcp_url } } }, null, 2));
  const channel = $derived(s.staff_log_channel ? `#${s.staff_log_channel.name}` : null);
</script>

<svelte:head><title>Logan · Logitland</title></svelte:head>

<div class="flex min-h-9 items-center justify-between gap-4">
  <h1 class="text-2xl font-semibold tracking-tight">Logan</h1>
</div>

<div class="mt-6 flex max-w-3xl flex-col gap-8">
  <section aria-labelledby="connect-heading" class="flex flex-col gap-3">
    <h2 id="connect-heading" class="text-sm font-medium">Connect your MCP client</h2>
    <CodeBlock.Root>
      <CodeBlock.Header>
        <CodeBlock.Title>MCP server</CodeBlock.Title>
        <CodeBlock.Actions><CodeBlock.CopyButton value={s.mcp_url} aria-label="Copy MCP server URL" /></CodeBlock.Actions>
      </CodeBlock.Header>
      <CodeBlock.Content code={s.mcp_url} />
    </CodeBlock.Root>
    <CodeBlock.Root>
      <CodeBlock.Header>
        <CodeBlock.Title>Claude Code</CodeBlock.Title>
        <CodeBlock.Actions><CodeBlock.CopyButton value={claudeCode} aria-label="Copy Claude Code command" /></CodeBlock.Actions>
      </CodeBlock.Header>
      <CodeBlock.Content code={claudeCode} wrap />
    </CodeBlock.Root>
    <p class="text-sm text-muted-foreground">Then run <code class="font-mono">/mcp</code> in Claude Code, choose logan and sign in with Discord.</p>
    <CodeBlock.Root>
      <CodeBlock.Header>
        <CodeBlock.Title>Other MCP clients</CodeBlock.Title>
        <CodeBlock.Actions><CodeBlock.CopyButton value={config} aria-label="Copy MCP client configuration" /></CodeBlock.Actions>
      </CodeBlock.Header>
      <CodeBlock.Content code={config} />
    </CodeBlock.Root>
  </section>

  <section aria-labelledby="does-heading">
    <h2 id="does-heading" class="text-sm font-medium">What Logan does for you</h2>
    <ul class="mt-3 divide-y overflow-hidden rounded-xl border bg-card text-sm">
      <li class="px-4 py-3">Anything you may do in the server yourself, checked against your roles on every call.</li>
      <li class="px-4 py-3">
        {#if channel}
          Deletes, kicks, bans, timeouts and bulk changes wait for you to press Confirm on Logan’s message in {channel}, for up to 10 minutes.
        {:else if session.can('operate')}
          Deletes, kicks, bans, timeouts and bulk changes are refused until a staff log or staff alerts channel is set on <a
            href="/admin/health"
            class="underline">Health</a
          >.
        {:else}
          Deletes, kicks, bans, timeouts and bulk changes are refused until an admin sets a staff log or staff alerts channel.
        {/if}
      </li>
      <li class="px-4 py-3">Every change is posted in {channel ?? 'the staff log channel'} and kept in the audit log under your name.</li>
    </ul>
  </section>
</div>
