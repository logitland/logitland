import { defineConfig } from '@svartz/config';

export default defineConfig({
  version: '1.0.0',
  defaults: { theme: '@svartz/theme-minimal' },
  vaults: [
    {
      id: 'docs',
      path: 'vault',
      target: { type: 'host' },
      site: {
        title: 'Logitland docs',
        description: 'Connect an agent, understand the relay, and work on Logitland.',
      },
    },
  ],
});
