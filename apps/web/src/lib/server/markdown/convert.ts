import { ELEMENT_NODE, htmlToMarkdown, type ElementNode, type Node } from '@mdream/js';
import { createPlugin } from '@mdream/js/plugins';
import { markdownPath } from '#lib/markdown-paths.js';

/** Both shells put a page's own content in `#content`, the skip link's target, outside their navigation. */
const CONTENT = '#content';

/** Decoration and machinery: they mean nothing outside the screen. */
const SKIPPED_TAGS = new Set(['svg', 'script', 'style', 'template']);

/** Elements that end with a visual break, even where it's not a Markdown one (inside a link). */
const SEPARATED_TAGS = new Set(['div', 'p']);

const isElement = (node: Node): node is ElementNode => node.type === ELEMENT_NODE;
const isScreenReaderOnly = ({ attributes }: ElementNode) => /(^|\s)sr-only(\s|$)/.test(attributes.class ?? '');

/** Controls whose state is content: a radio, checkbox, switch or tab shows whether it's on, a select shows its value. */
const STATEFUL_ROLES = new Set(['radio', 'checkbox', 'switch', 'tab']);
const isStateful = ({ attributes }: ElementNode) => STATEFUL_ROLES.has(attributes.role) || attributes['data-slot'] === 'select-trigger';
const isChecked = ({ attributes }: ElementNode) =>
  attributes['aria-checked'] === 'true' || attributes['aria-selected'] === 'true' || attributes.checked !== undefined;

const isNoise = (element: ElementNode) =>
  SKIPPED_TAGS.has(element.name) ||
  element.attributes.hidden !== undefined ||
  element.attributes['aria-hidden'] === 'true' ||
  (element.attributes.type === 'hidden' && element.name === 'input') ||
  // Other buttons are actions, which an agent reading the page can't take.
  (element.name === 'button' && !isStateful(element)) ||
  // The page-as-Markdown control: the reader already has the Markdown.
  element.attributes['data-slot'] === 'page-markdown';

/**
 * Renders a dashboard's interface as what it shows: drops actions and decoration, writes form controls as their state,
 * and keeps the pieces of a card that's one link (an agent row) from running together.
 */
const interfacePlugin = (page: URL) => {
  const skipped = new WeakSet<ElementNode>();
  return createPlugin({
    // Links between pages point at their Markdown versions, so following one stays in Markdown. The docs link relatively
    // (`../guides/`), so those resolve against the page first.
    processAttributes({ name, attributes }) {
      if (name === 'a' && attributes.href && !/^([a-z][a-z\d+.-]*:|[/#])/i.test(attributes.href)) {
        const target = new URL(attributes.href, page);
        attributes.href = target.pathname + target.search + target.hash;
      }
      if (name === 'a' && /^\/(?!\/)[^.#?]*(\?|$)/.test(attributes.href ?? '')) {
        const [path, query] = attributes.href.split('?');
        attributes.href = markdownPath(path) + (query === undefined ? '' : `?${query}`);
      }
    },
    beforeNodeProcess({ node }) {
      const parentSkipped = node.parent ? skipped.has(node.parent) : false;
      if (!isElement(node)) return parentSkipped ? { skip: true } : undefined;
      if (!parentSkipped && !isNoise(node)) return;
      skipped.add(node);
      return { skip: true };
    },
    onNodeEnter(element) {
      // A card's title heads a section, though it isn't a heading element.
      if (element.attributes['data-slot'] === 'card-title') return '\n\n## ';
      if (isScreenReaderOnly(element)) return ' ';
      if (STATEFUL_ROLES.has(element.attributes.role)) return isChecked(element) ? '[x] ' : '[ ] ';
      if (element.name !== 'input') return;
      const { type, value } = element.attributes;
      if (type === 'checkbox' || type === 'radio') return isChecked(element) ? '[x] ' : '[ ] ';
      return value ? ` \`${value}\` ` : undefined;
    },
    // Layout separates blocks, badges and screen-reader text visually; without it, "2h" and "until it's blocked" touch.
    onNodeExit(element) {
      if (SEPARATED_TAGS.has(element.name) || element.attributes['data-slot'] === 'badge' || isScreenReaderOnly(element)) return ' ';
    },
  });
};

/** The page rendered at `page` as compact Markdown: its content without the shell, with links absolute to its origin. */
export function pageToMarkdown(html: string, page: URL) {
  const markdown = htmlToMarkdown(html, {
    origin: page.origin,
    clean: true,
    hooks: [interfacePlugin(page)],
    plugins: {
      filter: { include: html.includes('id="content"') ? [CONTENT] : [] },
      // Description lists (limits, settings) as `- **Term**: description`.
      tagOverrides: {
        dl: { enter: '\n', exit: '\n' },
        dt: { enter: '- **', exit: '**:', spacing: [0, 0], isInline: true },
        dd: { enter: ' ', exit: '\n', spacing: [0, 0], isInline: true },
      },
    },
  });
  const compact = markdown
    .replace(/(\S) {2,}/g, '$1 ')
    .replace(/ +\]\(/g, '](')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
  return `${compact.trim()}\n`;
}
