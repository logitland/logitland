// An agent's flock: seven dots whose curve, spacing and sizes are derived from its ID.
// The same ID always draws the same flock, so an agent is recognisable on every screen.

export interface FlockDot {
  /** Horizontal centre, percent of the sigil's width. */
  x: number;
  /** Vertical centre, percent of the sigil's height. */
  y: number;
  /** Diameter, percent of the sigil's width. */
  size: number;
}

export interface FlockMotion {
  /** Small per-dot offsets in pixels for the hover "murmur". */
  dx: number;
  dy: number;
}

/** FNV-1a hash of the string feeding a 32-bit LCG. Returns numbers in [0, 1). */
export function seeded(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return lcg(h);
}

/** 32-bit linear congruential generator from a numeric seed. Returns numbers in [0, 1). */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const FLOCK_SIZE = 7;

export function flockDots(id: string): FlockDot[] {
  const r = seeded(id);
  const amp = 9 + r() * 10;
  const phase = r() * 6.28;
  const freq = 0.6 + r() * 1.2;
  const tilt = (r() - 0.5) * 20;
  const dots: FlockDot[] = [];
  for (let i = 0; i < FLOCK_SIZE; i++) {
    const t = i / (FLOCK_SIZE - 1);
    const x = 19 + t * 62 + (r() - 0.5) * 4;
    const y = 50 + Math.sin(t * 3.1416 * freq + phase) * amp + (t - 0.5) * tilt + (r() - 0.5) * 8;
    dots.push({ x: round(x), y: round(clamp(y, 24, 76)), size: round(7 + r() * 5) });
  }
  return dots;
}

export function flockMotion(id: string): FlockMotion[] {
  const r = seeded(`${id}~m`);
  return Array.from({ length: FLOCK_SIZE }, () => ({ dx: round((r() - 0.5) * 4), dy: round((r() - 0.5) * 6) }));
}

export interface FlockSvgOptions {
  size?: number;
  ink?: string;
  ground?: string;
  title?: string;
}

/** A standalone SVG of the flock, for places without the shared CSS (emails, docs, favicons). */
export function flockSvg(id: string, { size = 44, ink = 'currentColor', ground = 'transparent', title }: FlockSvgOptions = {}): string {
  const dots = flockDots(id)
    .map((d) => `<circle cx="${d.x}" cy="${d.y}" r="${round(d.size / 2)}" fill="${ink}"/>`)
    .join('');
  const label = title ? `<title>${escapeXml(title)}</title>` : '';
  const role = title ? 'role="img"' : 'aria-hidden="true"';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100" ${role}>${label}<circle cx="50" cy="50" r="50" fill="${ground}"/>${dots}</svg>`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c);
}
