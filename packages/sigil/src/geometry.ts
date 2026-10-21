/**
 * Deterministic sigil geometry for an agent: a mirrored set of strokes on a 3×3 lattice plus one node,
 * coloured by a hue derived from the seed. The same seed always yields the same sigil, so the relay
 * can render the identical image as the agent's default Discord avatar.
 */

const LATTICE = [7, 12, 17] as const;

/** Edges on the left half and centre column; the right half mirrors them. */
const EDGES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 0, 1],
  [0, 1, 0, 2],
  [1, 0, 1, 1],
  [1, 1, 1, 2],
  [0, 0, 1, 0],
  [0, 1, 1, 1],
  [0, 2, 1, 2],
  [0, 0, 1, 1],
  [0, 1, 1, 0],
  [0, 1, 1, 2],
  [0, 2, 1, 1],
];

const STROKES = 4;

/** OKLCH lightness and chroma of the disc and of the strokes; the seed picks the hue. */
export const BACKGROUND = { l: 0.34, c: 0.08 } as const;
export const STROKE = { l: 0.9, c: 0.13 } as const;

/** A straight stroke from (x1, y1) to (x2, y2), in the 24×24 viewBox. */
export type Segment = readonly [x1: number, y1: number, x2: number, y2: number];

function fnv1a(input: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sigil(seed: string) {
  const random = mulberry32(fnv1a(seed));
  const hue = Math.floor(random() * 360);

  const pool = [...EDGES];
  const picked = Array.from({ length: STROKES }, () => pool.splice(Math.floor(random() * pool.length), 1)[0]!);

  // A centre-column edge mirrors onto itself, so it is drawn once.
  const segments = picked.flatMap(([c1, r1, c2, r2]): Segment[] => {
    const segment: Segment = [LATTICE[c1]!, LATTICE[r1]!, LATTICE[c2]!, LATTICE[r2]!];
    const mirrored: Segment = [LATTICE[2 - c1]!, LATTICE[r1]!, LATTICE[2 - c2]!, LATTICE[r2]!];
    return c1 === 1 && c2 === 1 ? [segment] : [segment, mirrored];
  });

  const node = { x: LATTICE[1], y: LATTICE[Math.floor(random() * 3)]! };

  return {
    /** Drives the agent's accent colour in the UI (`.agent-accent` with `--agent-hue`). */
    hue,
    path: segments.map(([x1, y1, x2, y2]) => `M${x1} ${y1}L${x2} ${y2}`).join(''),
    /** The strokes `path` draws, for renderers that cannot take SVG path data. */
    segments,
    node,
    background: `oklch(${BACKGROUND.l} ${BACKGROUND.c} ${hue})`,
    stroke: `oklch(${STROKE.l} ${STROKE.c} ${hue})`,
  };
}
