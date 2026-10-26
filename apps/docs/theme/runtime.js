// Vite-bundled runtime manifest, like minimal's: components are eager.
import minimal from '@svartz/theme-minimal/runtime';
import SiteLayout from './SiteLayout.svelte';
import { withLayout } from './with-layout.js';

/** @param {import('@svartz/theme-minimal').MinimalThemeConfig} [config] */
export default (config) => withLayout(minimal(config), { default: SiteLayout });
