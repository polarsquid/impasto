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
import { hexToRgb } from '../color/pigment.js';
import { seededRandom } from '../generator/random.js';

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
