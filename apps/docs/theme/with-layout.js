/**
 * Svartz minimal with every page layout swapped for `layout`, which wraps minimal's own. Minimal has no slot for
 * page actions, so this is the smallest supported way to add one: a theme built from minimal's theme object.
 *
 * @param {import('@svartz/core').SvartzTheme} minimal the theme `@svartz/theme-minimal` builds for this config
 * @param {import('@svartz/core').ThemeComponentLoader} layout
 * @returns {import('@svartz/core').SvartzTheme}
 */
export function withLayout(minimal, layout) {
  const { notFoundPage, ...pages } = minimal.layouts;
  return {
    ...minimal,
    id: '@logitland/docs-theme',
    displayName: 'Logitland docs',
    layouts: { ...Object.fromEntries(Object.keys(pages).map((slot) => [slot, layout])), notFoundPage },
  };
}
