// =============================================================================
// composer.js
// -----------------------------------------------------------------------------
// Plans a whole painting: turns the generator settings and a seed into a
// list of strokes ("jobs"), each with a brush and a path of points. It
// doesn't paint anything itself; stroke-runner.js does that. Keeping the
// planning separate means the plan is pure data, which is easy to test,
// to paint all at once or a few strokes per frame, or (in phase 4) to save.
//
// The painting is built in three layers, coarse to fine, as a painter works:
//
//   underpainting - big, thin strokes that block in colour and cover the
//                   canvas
//   body          - medium strokes, the bulk of the paint
//   accents       - small, thick strokes that stand highest and catch light
//
// Each layer has an AMOUNT: the fraction of the canvas it covers, from 0
// (layer off) to 1 (every bit of canvas covered, no gaps). Planning a layer
// happens in two passes, using a coverage grid (coverage.js) to keep score:
//
//   1. Spread strokes evenly with a "jittered grid": divide the canvas into
//      equal cells and start one stroke somewhere random inside each. Pure
//      randomness would leave clumps and bald patches; a jittered grid looks
//      random but covers evenly. The order is shuffled, so strokes overlap
//      naturally rather than in neat rows. Stop as soon as the layer covers
//      its target amount.
//   2. If the target isn't reached yet (always the case near Amount 1), find
//      the remaining bare spots and aim a stroke at each, until it is.
//
// The underpainting is painted from the LAST TWO colours in the palette
// only, so it reads as a unified base tone; the other layers use them all.
// =============================================================================

import { createNoise2D } from '../../lib/simplex-noise.js';
import { createFlowField } from './flow-field.js';
import { createColorPicker, PALETTE_PRESETS } from './palettes.js';
import { CoverageGrid } from './coverage.js';
import { seededRandom, shuffle } from './random.js';

/**
 * The three layers, in painting order. `loadFactor` sets how far a brush
 * travels before running dry, as a multiple of the stroke's length: thin
 * underpainting lasts a long way, thick accents run out sooner.
 * `underColors` marks the layer that only uses the last two palette colours.
 */
export const LAYERS = [
  { key: 'under',   label: 'Underpainting', loadFactor: 2.2, underColors: true },
  { key: 'body',    label: 'Body paint',    loadFactor: 1.6 },
  { key: 'accents', label: 'Accents',       loadFactor: 1.3 },
];

/** At most this many strokes per layer, so planning always stays quick. */
const MAX_STROKES_PER_LAYER = 6000;

/** Settings a fresh generator starts with. */
export function defaultGeneratorSettings() {
  return {
    seed: 1234,
    field: { type: 'sweep', angle: -20, scale: 420, chaos: 0.45, centerX: 0.5, centerY: 0.5 },
    palette: {
      colors: PALETTE_PRESETS[0].colors.map((hex) => ({ hex, weight: 1 })),
      mixing: 0.3,      // chance a stroke picks up a second colour
      variation: 0.07,  // random brightness shift per stroke
    },
    coverage: 1.0,      // multiplies every layer's amount
    layers: {
      //  amount    = fraction of the canvas the layer covers (1 = all of it)
      //  size      = brush radius px, length = stroke length px
      //  thickness = paint thickness
      under:   { amount: 0.9,  size: 62, length: 420, thickness: 0.35 },
      body:    { amount: 0.8,  size: 30, length: 230, thickness: 1.0 },
      accents: { amount: 0.3,  size: 14, length: 95,  thickness: 1.6 },
    },
  };
}

/**
 * Plan a painting.
 * @param {Object} settings   generator settings (see defaultGeneratorSettings)
 * @param {Object} character  shared paint character: bristles, groove, ridge,
 *                            tipShape, edgeWobble, flatten, pickup
 * @param {number} width, height  canvas size
 * @returns {{ jobs: Array<{brush, points: Float32Array, layer: string}> }}
 */
export function composePainting(settings, character, width, height) {
  // Two independent random streams from the one seed: one for the noise in
  // the flow field, one for everything else. Changing how many random
  // numbers one uses then can't reshuffle the other.
  const rand = seededRandom(settings.seed);
  const noise2D = createNoise2D(seededRandom(settings.seed ^ 0x9e3779b9));

  const field = createFlowField(settings.field, width, height, noise2D);
  const allColors = createColorPicker(settings.palette);
  const underColors = createColorPicker(settings.palette, { lastTwo: true });
  const jobs = [];

  for (const layer of LAYERS) {
    const L = settings.layers[layer.key];
    const target = Math.min(1, L.amount * settings.coverage);
    if (target <= 0) continue;

    const colors = layer.underColors ? underColors : allColors;
    // Cells about a fifth of the brush radius: fine enough to catch real
    // gaps, coarse enough to stay fast.
    const grid = new CoverageGrid(width, height, Math.min(10, Math.max(3, L.size / 5)));
    // Aiming for 99.5% or more means "no gaps at all".
    const wantComplete = target >= 0.995;
    const done = () => (wantComplete ? grid.complete : grid.fraction >= target);
    let count = 0;

    // Make one stroke starting at (x, y) and record what it covers.
    const addStroke = (x, y, flip) => {
      const radius = L.size * (0.75 + rand() * 0.5);    // +/- 25% size
      const length = L.length * (0.6 + rand() * 0.8);   // +/- 40% length
      const brush = {
        ...character,
        radius,
        thickness: L.thickness * (0.85 + rand() * 0.3),
        color: colors.pick(rand),
        seed: rand() * 1000,
        loadLength: length * layer.loadFactor,
      };
      const points = tracePath(x, y, length, radius, field, flip, rand);
      grid.stampStroke(points, brush);
      jobs.push({ brush, points, layer: layer.key });
      count++;
      return radius;
    };
    // A field only gives a LINE direction, so a stroke may travel either way
    // along it. Picking at random stops every stroke starting on one side.
    const randomFlip = () => (rand() < 0.5 ? 0 : Math.PI);

    // --- Pass 1: even spread --------------------------------------------------------
    // Enough candidate start points to cover the canvas about 2.5 times over;
    // usually we stop long before using them all.
    const candidates = Math.ceil(2.5 * width * height / (2 * L.size * L.length));
    for (const [x, y] of jitteredGrid(candidates, width, height, L.size, rand)) {
      if (done() || count >= MAX_STROKES_PER_LAYER) break;
      addStroke(x, y, randomFlip());
    }

    // --- Pass 2: fill the gaps ---------------------------------------------------------
    // Aim a stroke at each bare spot. To put the spot in the stroke's solid
    // middle rather than its tip, start the stroke a little way back along
    // the flow field.
    while (!done() && count < MAX_STROKES_PER_LAYER) {
      const gap = grid.nextGap(rand);
      if (!gap) break;
      const flip = randomFlip();
      const a = field(gap.x, gap.y) + flip;
      const back = L.size * 1.2;
      addStroke(gap.x - Math.cos(a) * back, gap.y - Math.sin(a) * back, flip);
      // If the stroke curved away and still missed the spot, count the spot
      // as covered anyway so this loop can't go on forever. (Neighbouring
      // strokes almost always cover it in practice.)
      grid.forceCover(gap.index);
    }
  }
  return { jobs };
}

/**
 * Even-but-random starting points (see the jittered grid note at the top).
 * The grid reaches `margin` pixels past every edge, so strokes starting just
 * outside can sweep in and the edges get as much paint as the middle.
 */
function jitteredGrid(count, width, height, margin, rand) {
  if (count <= 0) return [];
  const w = width + margin * 2;
  const h = height + margin * 2;
  // Pick a column/row count whose cells are roughly square.
  const cols = Math.max(1, Math.round(Math.sqrt(count * w / h)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const cw = w / cols;
  const ch = h / rows;

  const points = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      points.push([(c + rand()) * cw - margin, (r + rand()) * ch - margin]);
    }
  }
  // The grid may have a few more cells than strokes wanted: shuffle, trim.
  return shuffle(points, rand).slice(0, count);
}

/**
 * Walk a stroke's path through the flow field.
 * @param {number} flip  0 to travel with the field, PI to travel against it
 * @returns {Float32Array} x0, y0, x1, y1, ... in surface pixels
 */
function tracePath(x, y, length, radius, field, flip, rand) {
  const step = Math.max(2, radius * 0.12);
  let wander = 0;
  const points = [x, y];
  for (let d = 0; d < length; d += step) {
    // A small random drift on top of the field: a human hand isn't exact.
    wander += (rand() - 0.5) * 0.06;
    wander *= 0.97;   // ...but it keeps getting pulled back on course
    const a = field(x, y) + flip + wander;
    x += Math.cos(a) * step;
    y += Math.sin(a) * step;
    points.push(x, y);
  }
  return new Float32Array(points);
}
