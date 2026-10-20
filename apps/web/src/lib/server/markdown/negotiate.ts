import { shouldServeMarkdown } from '@mdream/js/negotiate';

/**
 * User agents that get Markdown whatever they Accept: LLM crawlers and fetchers, which often ask for HTML, and
 * command-line HTTP clients, whose readers are terminals and scripts. Matched case-insensitively anywhere in the
 * `User-Agent`. Browsers match none of them.
 */
export const MARKDOWN_USER_AGENTS = [
  // Anthropic
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'anthropic-ai',
  // OpenAI
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  // Others
  'PerplexityBot',
  'Perplexity-User',
  'CCBot',
  'Meta-ExternalAgent',
  'cohere-ai',
  // Command-line and library clients
  'curl',
  'Wget',
  'HTTPie',
  'python-requests',
  'Go-http-client',
  'node-fetch',
  'undici',
] as const;

const agentPattern = new RegExp(MARKDOWN_USER_AGENTS.map((ua) => ua.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');

/** Whether a request for a page should get its Markdown version: its Accept prefers Markdown, or an agent sent it. */
export function wantsMarkdown(headers: Headers) {
  const accept = headers.get('accept') ?? undefined;
  const destination = headers.get('sec-fetch-dest') ?? undefined;
  return shouldServeMarkdown(accept, destination) || agentPattern.test(headers.get('user-agent') ?? '');
}
