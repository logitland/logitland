// Vite-bundled runtime manifest: Svartz's reference shell with the API theme's REST pages and the MCP theme's tool pages.
import { apiRenderers } from '@svartz/theme-api-docs/runtime';
import { mcpRenderers } from '@svartz/theme-mcp-docs/runtime';
import { referenceTheme } from '@svartz/ui/reference/runtime';

/** @param {import('@svartz/ui/reference').ReferenceThemeConfig} [config] */
export const theme = (config) =>
  referenceTheme(
    { id: '@logitland/docs-theme', displayName: 'Logitland docs', renderers: [...apiRenderers, ...mcpRenderers] },
    config,
  );

export default theme;
