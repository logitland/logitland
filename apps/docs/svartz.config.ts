import { defineConfig } from '@svartz/config';

// Svartz's design tokens drawn from Logitland's shared theme (`@logitland/tokens/theme.css`, loaded in the root
// layout), so the docs share the web app's colours, type and radii. Each value is already a light/dark pair there.
const tokens = {
  paper: 'var(--background)',
  surface: 'var(--popover)',
  sunken: 'var(--muted)',
  rule: 'var(--border)',
  'rule-strong': 'var(--input)',
  muted: 'var(--muted-foreground)',
  text: 'var(--foreground)',
  ink: 'var(--foreground)',
  accent: 'var(--brand)',
  'accent-text': 'var(--brand-text)',
  'on-accent': 'var(--brand-foreground)',
  'font-sans': 'var(--font-body)',
  'font-mono': 'var(--font-code)',
  'radius-s': 'calc(var(--radius) * 0.6)',
  'radius-m': 'var(--radius)',
  'radius-l': 'calc(var(--radius) * 1.4)',
};

export default defineConfig({
  version: '1.0.0',
  vaults: [
    {
      id: 'docs',
      path: 'vault',
      target: { type: 'host' },
      // Minimal with the page Markdown control; see theme/with-layout.js.
      theme: {
        base: './theme',
        tokens,
        footer: { links: { 'logit.land': '/', 'Sign in': '/sign-in', 'llms.txt': '/llms.txt' } },
      },
      site: {
        title: 'Logitland docs',
        description: 'Connect an agent, understand the relay, and work on Logitland.',
      },
    },
  ],
});
