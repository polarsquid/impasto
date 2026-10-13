// =============================================================================
// palettes.js
// -----------------------------------------------------------------------------
// The generator's colours. A palette is up to 6 colours, each with a weight
// (how much of that colour to use). Picking a colour for a stroke works like
// a painter loading a brush:
//
//   1. Choose a colour, more often the heavier-weighted ones.
//   2. Sometimes, mix in a bit of a second colour, like a brush that's been
//      dragged through a neighbouring puddle on the palette. This uses real
//      pigment mixing, so the in-between colours look like paint.
//   3. Nudge it very slightly lighter or darker, so no two strokes from the
//      same "tube" are exactly identical.
// =============================================================================

import { hexToRgb, mixPigments } from '../color/pigment.js';
import { pickWeighted } from './random.js';

/** Starting points you can load and then adjust. */
export const PALETTE_PRESETS = [
  { name: 'Harbour',  colors: ['#1f3a68', '#2e6f73', '#c9a227', '#e8dcc0', '#9c2f2a', '#3b2f4a'] },
  { name: 'Ember',    colors: ['#2a1a1f', '#6b1f1a', '#b8401f', '#e0892e', '#f2cf7a', '#3d3a4a'] },
  { name: 'Moss',     colors: ['#1f2a1c', '#3e5a2f', '#7a8b3c', '#c2b56b', '#e6dcc0', '#5b4a3a'] },
  { name: 'Nocturne', colors: ['#0f1a2e', '#1d3557', '#3d5a80', '#98c1d9', '#e0e6ed', '#c9a227'] },
  { name: 'Coast',    colors: ['#f2efe6', '#a8c5cf', '#5a8fa6', '#2c5f7a', '#d9b88f', '#1e2d3a'] },
  { name: 'Poppy',    colors: ['#c8331f', '#e8742c', '#f1c84b', '#3f6b3a', '#f3ead8', '#24281f'] },
];

/**
 * Prepare a palette for picking: convert hex to RGB and drop unused slots.
 * @param {Object} palette  { colors: [{ hex, weight }], mixing, variation }
 * @returns {Object} a picker with a pick(rand) method
 */
export function createColorPicker(palette) {
  const slots = palette.colors.filter((c) => c.weight > 0);
  const colors = slots.map((c) => hexToRgb(c.hex));
  const weights = slots.map((c) => c.weight);

  return {
    /** @returns {number[]} an sRGB colour for one stroke */
    pick(rand) {
      if (colors.length === 0) return [0.5, 0.5, 0.5];
      let color = colors[pickWeighted(weights, rand)];

      // 2. Sometimes drag the brush through a second colour.
      if (rand() < palette.mixing && colors.length > 1) {
        const other = colors[pickWeighted(weights, rand)];
        color = mixPigments(color, other, rand() * 0.45);
      }

      // 3. A slight brightness shift. Multiplying all three channels by the
      //    same amount keeps the hue and only changes the value.
      const shift = 1 + (rand() - 0.5) * 2 * palette.variation;
      return color.map((c) => Math.min(1, Math.max(0, c * shift)));
    },
  };
}
