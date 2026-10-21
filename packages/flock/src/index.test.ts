import { describe, expect, it } from 'vitest';
import { FLOCK_SIZE, flockDots, flockMotion, flockSvg, seeded } from './index';

describe('flockDots', () => {
  it('is deterministic for an ID', () => {
    expect(flockDots('agt_01JB7Q2M8R')).toEqual(flockDots('agt_01JB7Q2M8R'));
  });

  it('differs between agents', () => {
    expect(flockDots('agt_01JB7Q2M8R')).not.toEqual(flockDots('agt_01JC0F5XK3'));
  });

  it('matches the prototype output for Orrery', () => {
    // Values produced by the prototype's original implementation (toFixed(1)).
    const first = flockDots('agt_01JB7Q2M8R')[0]!;
    const r = seeded('agt_01JB7Q2M8R');
    const amp = 9 + r() * 10,
      phase = r() * 6.28,
      freq = 0.6 + r() * 1.2,
      tilt = (r() - 0.5) * 20;
    const x = 19 + (r() - 0.5) * 4;
    const y = Math.max(24, Math.min(76, 50 + Math.sin(phase) * amp - 0.5 * tilt + (r() - 0.5) * 8));
    expect(first.x).toBeCloseTo(Number(x.toFixed(1)), 5);
    expect(first.y).toBeCloseTo(Number(y.toFixed(1)), 5);
    expect(freq).toBeGreaterThan(0);
  });

  it('keeps every dot inside the sigil', () => {
    for (const id of ['a', 'agt_01J9MRT4QE', 'agt_01JD2W9PZT', 'x'.repeat(200)]) {
      const dots = flockDots(id);
      expect(dots).toHaveLength(FLOCK_SIZE);
      for (const d of dots) {
        expect(d.x).toBeGreaterThanOrEqual(15);
        expect(d.x).toBeLessThanOrEqual(85);
        expect(d.y).toBeGreaterThanOrEqual(24);
        expect(d.y).toBeLessThanOrEqual(76);
        expect(d.size).toBeGreaterThanOrEqual(7);
        expect(d.size).toBeLessThanOrEqual(12);
      }
    }
  });

  it('orders dots left to right', () => {
    const xs = flockDots('agt_01JC0F5XK3').map((d) => d.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });
});

describe('flockMotion', () => {
  it('gives each dot a small offset', () => {
    const m = flockMotion('agt_01JB7Q2M8R');
    expect(m).toHaveLength(FLOCK_SIZE);
    for (const o of m) {
      expect(Math.abs(o.dx)).toBeLessThanOrEqual(2);
      expect(Math.abs(o.dy)).toBeLessThanOrEqual(3);
    }
  });
});

describe('flockSvg', () => {
  it('is decorative without a title', () => {
    expect(flockSvg('agt_1')).toContain('aria-hidden="true"');
  });

  it('escapes the title', () => {
    const svg = flockSvg('agt_1', { title: 'Orrery <bot>' });
    expect(svg).toContain('role="img"');
    expect(svg).toContain('<title>Orrery &lt;bot&gt;</title>');
    expect(svg.match(/<circle/g)).toHaveLength(FLOCK_SIZE + 1);
  });
});
