// An agent's sigil as a PNG, drawn exactly like the web app's `sigil.svelte` (viewBox 0 0 24 24):
// a disc in the background colour, round-capped strokes and a node dot in the stroke colour.
// Pure TypeScript plus the platform's CompressionStream, so it runs in workerd as well as Node.

import { BACKGROUND, STROKE, sigil, type Segment } from './geometry';

export { BACKGROUND, STROKE, sigil, type Segment } from './geometry';

const VIEWBOX = 24;
const CENTRE = VIEWBOX / 2;
const STROKE_RADIUS = 0.8; // stroke-width 1.6
const NODE_RADIUS = 1.7;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const BIT_DEPTH = 8;
const COLOUR_TYPE_RGBA = 6;

type Rgb = readonly [r: number, g: number, b: number];

/** Renders the sigil for `seed` as a size×size RGBA PNG, transparent outside the disc. */
export async function sigilPng(seed: string, size = 256): Promise<Uint8Array<ArrayBuffer>> {
  const { hue, segments, node } = sigil(seed);
  const background = oklchToSrgb(BACKGROUND.l, BACKGROUND.c, hue);
  const ink = oklchToSrgb(STROKE.l, STROKE.c, hue);
  const pixel = VIEWBOX / size;
  // Coverage of a shape whose signed distance from the pixel centre is `d`, anti-aliased over one pixel.
  const coverage = (d: number) => Math.min(1, Math.max(0, 0.5 - d / pixel));

  // Raw scanlines: one filter byte (0, none) then RGBA per pixel. Zeroed bytes are transparent.
  const stride = 1 + size * 4;
  const raw = new Uint8Array(stride * size);
  for (let y = 0; y < size; y++) {
    const py = (y + 0.5) * pixel;
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) * pixel;
      const disc = coverage(Math.hypot(px - CENTRE, py - CENTRE) - CENTRE);
      if (disc === 0) continue;

      let distance = Math.hypot(px - node.x, py - node.y) - NODE_RADIUS;
      for (const segment of segments) distance = Math.min(distance, segmentDistance(px, py, segment) - STROKE_RADIUS);
      const fg = coverage(distance);

      // Strokes source-over the disc, blended in sRGB like a browser paints the SVG.
      const alpha = fg + disc * (1 - fg);
      const offset = y * stride + 1 + x * 4;
      for (let i = 0; i < 3; i++) raw[offset + i] = Math.round((ink[i]! * fg + background[i]! * disc * (1 - fg)) / alpha);
      raw[offset + 3] = Math.round(alpha * 255);
    }
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header.set([BIT_DEPTH, COLOUR_TYPE_RGBA], 8); // then compression, filter and interlace methods, all 0

  return concat([new Uint8Array(PNG_SIGNATURE), chunk('IHDR', header), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array())]);
}

/** Distance from (px, py) to the nearest point on a segment. */
function segmentDistance(px: number, py: number, [x1, y1, x2, y2]: Segment) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.min(1, Math.max(0, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
}

/** OKLCH → OKLab → linear sRGB (clamped to gamut) → gamma-encoded sRGB in 0–255. */
function oklchToSrgb(l: number, c: number, hue: number): Rgb {
  const a = c * Math.cos((hue * Math.PI) / 180);
  const b = c * Math.sin((hue * Math.PI) / 180);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const encode = (linear: number) => {
    const v = Math.min(1, Math.max(0, linear));
    return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  };
  return [
    encode(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S),
    encode(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S),
    encode(-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S),
  ];
}

/** zlib-wrapped deflate, as PNG's IDAT expects. */
async function deflate(bytes: Uint8Array<ArrayBuffer>) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A PNG chunk: big-endian length, type, data, then the CRC-32 of type and data. */
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
