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

/**
 * Starting points you can load and then adjust. The LAST TWO colours of each
 * are its underpainting (see composer.js), so they're chosen as base tones,
 * usually the deepest colours in the set.
 */
export const PALETTE_PRESETS = [
  { name: 'Harbour',  colors: ['#c9a227', '#e8dcc0', '#9c2f2a', '#2e6f73', '#1f3a68', '#3b2f4a'] },
  { name: 'Ember',    colors: ['#f2cf7a', '#e0892e', '#b8401f', '#3d3a4a', '#6b1f1a', '#2a1a1f'] },
  { name: 'Moss',     colors: ['#e6dcc0', '#c2b56b', '#7a8b3c', '#5b4a3a', '#3e5a2f', '#1f2a1c'] },
  { name: 'Nocturne', colors: ['#e0e6ed', '#c9a227', '#98c1d9', '#3d5a80', '#1d3557', '#0f1a2e'] },
  { name: 'Coast',    colors: ['#f2efe6', '#d9b88f', '#1e2d3a', '#2c5f7a', '#a8c5cf', '#5a8fa6'] },
  { name: 'Poppy',    colors: ['#c8331f', '#e8742c', '#f1c84b', '#f3ead8', '#3f6b3a', '#24281f'] },
  // Mostly dark: near-blacks and deep blues, with one pale steel-blue
  // highlight so the relief still catches some light.
  { name: 'Midnight', colors: ['#b8c7da', '#2f4466', '#1a2a46', '#0e1a30', '#0a0f1c', '#050608'] },
  // Neutral greys from bone white to near black. Lets the relief and
  // lighting do all the work; also a good base for the white text later.
  { name: 'Graphite', colors: ['#f0f0ee', '#c8c8c6', '#9a9a98', '#6c6c6a', '#3e3e3d', '#1b1b1b'] },
  // Earth pigments: yellow ochre, raw and burnt sienna, burnt umber.
  // The classic old-master palette.
  { name: 'Earth',    colors: ['#efe3c8', '#d6a756', '#b8743a', '#8a4a2b', '#5c3a24', '#2e211a'] },
  // Twilight: peach and rose fading into violet.
  { name: 'Dusk',     colors: ['#f6d6c2', '#e8a49c', '#c96f86', '#7d4e7e', '#4a3a6b', '#2b2547'] },
];

/**
 * Prepare a palette for picking: convert hex to RGB and drop unused slots.
 * @param {Object} palette  { colors: [{ hex, weight }], mixing, variation }
 * @param {Object} [options]
 *   lastTwo: only use the last two colours that are switched on (weight > 0).
 *            The underpainting uses this.
 * @returns {Object} a picker with a pick(rand) method
 */
export function createColorPicker(palette, { lastTwo = false } = {}) {
  let slots = palette.colors.filter((c) => c.weight > 0);
  if (lastTwo) slots = slots.slice(-2);
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
