// =============================================================================
// test-strokes.js
// -----------------------------------------------------------------------------
// Paints a quick test composition automatically, so there's something to
// light and judge the moment the page loads. This is a rough preview of what
// phase 2 (the real procedural background generator) will do properly.
//
// It already uses two ideas the real generator will build on:
//
//   Flow field - every point on the canvas has a "preferred direction" that
//                strokes follow, the way a painter's strokes follow the form
//                of what they're painting. Here it's just a few sine waves.
//
//   Coarse to fine - big strokes first, then medium, then small, like a
//                painter blocking in shapes before adding detail.
// =============================================================================

import { StrokePath } from './stroke-path.js';

/**
 * A tiny seeded random number generator ("mulberry32"). Math.random() can't
 * be seeded, but we want the same seed to give the same painting every time.
 * Returns a function that produces numbers in 0..1.
 */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** '#3a5f8f' -> [0.23, 0.37, 0.56] */
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

// A deliberately small palette, as a painter would mix from.
const PALETTE = ['#1f3a68', '#2e6f73', '#c9a227', '#e8dcc0', '#9c2f2a', '#3b2f4a'];

/** The flow field: preferred stroke angle (radians) at a point. */
function flowAngle(x, y, seed) {
  return Math.sin(x * 0.0045 + seed) * 1.1
       + Math.cos(y * 0.0032 - seed * 0.7) * 0.9
       + Math.sin((x + y) * 0.002) * 0.4;
}

/**
 * Paint a full test composition onto the surface.
 * @param {PaintSurface} surface
 * @param {Object} baseBrush  default brush settings to start from
 * @param {number} seed       same seed = same painting
 */
export function paintTestComposition(surface, baseBrush, seed = 7) {
  const rand = seededRandom(seed);
  const W = surface.width;
  const H = surface.height;

  // Three passes, coarse to fine: [stroke count, min radius, max radius].
  const passes = [[30, 40, 62], [55, 22, 36], [70, 10, 18]];

  for (const [count, minR, maxR] of passes) {
    for (let i = 0; i < count; i++) {
      const radius = minR + rand() * (maxR - minR);
      const base = hexToRgb(PALETTE[Math.floor(rand() * PALETTE.length)]);
      // Nudge the colour slightly so strokes from the same tube still vary.
      const color = base.map(c => Math.min(1, Math.max(0, c + (rand() - 0.5) * 0.08)));

      const brush = {
        ...baseBrush,
        radius,
        color,
        seed: rand() * 1000,
        loadLength: 250 + rand() * 400,
      };

      // Walk a path that follows the flow field, with a little wander.
      let x = rand() * W;
      let y = rand() * H;
      const length = 4 * radius + rand() * 300;
      const flip = rand() < 0.5 ? 0 : Math.PI;   // strokes can go either way
      const path = new StrokePath(brush);
      path.begin(x, y);
      surface.beginStroke(brush);

      const step = 3;
      const parts = [];
      let wander = 0;
      for (let d = 0; d < length; d += step) {
        wander += (rand() - 0.5) * 0.08;
        const a = flowAngle(x, y, seed) + flip + wander;
        x += Math.cos(a) * step;
        y += Math.sin(a) * step;
        const dabs = path.addPoint(x, y);
        if (dabs.length) parts.push(...dabs);
      }
      surface.addDabs(new Float32Array(parts));
      surface.endStroke();
    }
  }
}
