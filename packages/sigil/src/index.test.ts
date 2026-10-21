import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { sigil, sigilPng } from './index';

/** Decodes an unfiltered RGBA PNG (what sigilPng writes) into its size and a pixel reader. */
async function decode(png: Uint8Array) {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: { type: string; data: Uint8Array }[] = [];
  for (let at = 8; at < png.length;) {
    const length = view.getUint32(at);
    const type = new TextDecoder().decode(png.subarray(at + 4, at + 8));
    expect(view.getUint32(at + 8 + length), `${type} CRC`).toBe(crc32(png.subarray(at + 4, at + 8 + length)));
    chunks.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);

  const ihdr = new DataView(chunks[0]!.data.buffer, chunks[0]!.data.byteOffset, 13);
  const width = ihdr.getUint32(0);
  const height = ihdr.getUint32(4);
  expect([ihdr.getUint8(8), ihdr.getUint8(9)], 'bit depth, colour type').toEqual([8, 6]);

  const idat = new Blob([chunks[1]!.data.slice()]).stream().pipeThrough(new DecompressionStream('deflate'));
  const raw = new Uint8Array(await new Response(idat).arrayBuffer());
  const stride = 1 + width * 4;
  expect(raw.length).toBe(stride * height);
  const rgba = (x: number, y: number) => [...raw.subarray(y * stride + 1 + x * 4, y * stride + 5 + x * 4)];
  return { width, height, rgba };
}

/** The pixel at viewBox coordinates (vx, vy) of a size×size render. */
const at = (size: number, vx: number, vy: number) => [Math.floor((vx / 24) * size), Math.floor((vy / 24) * size)] as const;

describe('sigil', () => {
  // Expected values come from running apps/web/src/lib/components/shell/sigil.ts, which this package must match.
  it.each([
    {
      seed: 'agt_01JB7Q2M8R',
      hue: 68,
      path: 'M7 7L12 7M17 7L12 7M7 12L12 12M17 12L12 12M7 7L12 12M17 7L12 12M12 7L12 12',
      node: { x: 12, y: 12 },
    },
    {
      seed: 'orrery',
      hue: 273,
      path: 'M7 7L12 12M17 7L12 12M7 12L7 17M17 12L17 17M7 7L7 12M17 7L17 12M7 7L12 7M17 7L12 7',
      node: { x: 12, y: 7 },
    },
  ])('draws the same sigil as the web app for $seed', ({ seed, hue, path, node }) => {
    expect(sigil(seed)).toMatchObject({ hue, path, node, background: `oklch(0.34 0.08 ${hue})`, stroke: `oklch(0.9 0.13 ${hue})` });
  });
});

describe('sigilPng', () => {
  it('renders the same bytes for a seed, and different bytes for another', async () => {
    const first = await sigilPng('agt_01JB7Q2M8R');
    expect(await sigilPng('agt_01JB7Q2M8R')).toEqual(first);
    expect(await sigilPng('orrery')).not.toEqual(first);
  });

  // Expected sRGB computed independently via the CSS Color 4 OKLab → XYZ → sRGB matrices.
  it.each([
    { seed: 'agt_01JB7Q2M8R', why: 'background blue out of gamut, clamped', background: [82, 46, 0], stroke: [255, 205, 123], node: [12, 12] },
    { seed: 'orrery', why: 'background in gamut', background: [43, 52, 97], stroke: [193, 216, 255], node: [12, 7] },
  ])('decodes to a transparent-cornered disc with the right colours for $seed ($why)', async ({ seed, background, stroke, node }) => {
    const size = 64;
    const { width, height, rgba } = await decode(await sigilPng(seed, size));
    expect([width, height]).toEqual([size, size]);

    expect(rgba(0, 0)[3], 'corner alpha').toBe(0);
    const near = (actual: number[], expected: number[]) => actual.forEach((v, i) => expect(Math.abs(v - expected[i]!)).toBeLessThanOrEqual(1));
    // (12, 21) sits inside the disc, clear of every lattice stroke (which end at y = 17.8).
    near(rgba(...at(size, 12, 21)), [...background, 255]);
    near(rgba(...at(size, node[0]!, node[1]!)), [...stroke, 255]);
  });
});
