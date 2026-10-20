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
  const picked = Array.from({ length: STROKES }, () => pool.splice(Math.floor(random() * pool.length), 1)[0]);

  const segments = picked.flatMap(([c1, r1, c2, r2]) => {
    const segment = `M${LATTICE[c1]} ${LATTICE[r1]}L${LATTICE[c2]} ${LATTICE[r2]}`;
    const mirrored = `M${LATTICE[2 - c1]} ${LATTICE[r1]}L${LATTICE[2 - c2]} ${LATTICE[r2]}`;
    return segment === mirrored ? [segment] : [segment, mirrored];
  });

  const node = { x: LATTICE[1], y: LATTICE[Math.floor(random() * 3)] };

  return {
    path: segments.join(''),
    node,
    background: `oklch(0.34 0.08 ${hue})`,
    stroke: `oklch(0.9 0.13 ${hue})`,
  };
}
