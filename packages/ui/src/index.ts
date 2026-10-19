// Framework-agnostic helpers. The data-attribute behaviours for static pages live in ./dom.ts
// (bundled for the prototype); Svelte components live in ./svelte.
export { EASE, busy, collapse, flip, motionOK, pop, reveal, transition } from './motion';
export { MORPH_EASE, attachMorph, detachMorph, morph, textOf } from './morph';
export { flockDotStyles, renderFlock } from './flock';
