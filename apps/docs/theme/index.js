// Node-safe manifest for the build pipeline, like minimal's: components load lazily.
import minimal from '@svartz/theme-minimal';
import { withLayout } from './with-layout.js';

/** @param {import('@svartz/theme-minimal').MinimalThemeConfig} [config] */
export default (config) => withLayout(minimal(config), () => import('./SiteLayout.svelte'));
