// Node-safe manifest for the build pipeline: Svartz's reference shell. The renderers are in runtime.js.
import { referenceTheme } from '@svartz/ui/reference';

/** @param {import('@svartz/ui/reference').ReferenceThemeConfig} [config] */
export default (config) => referenceTheme({ id: '@logitland/docs-theme', displayName: 'Logitland docs' }, config);
