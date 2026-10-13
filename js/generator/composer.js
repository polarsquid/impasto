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
// Within a layer, strokes are spread with a "jittered grid": divide the
// canvas into equal cells and put one stroke start somewhere random inside
// each cell. Pure randomness would leave clumps and bald patches; a jittered
// grid looks random but covers the canvas evenly. The order is shuffled
// afterwards, so strokes don't overlap in neat rows.
// =============================================================================

import { createNoise2D } from '../../lib/simplex-noise.js';
import { createFlowField } from './flow-field.js';
import { createColorPicker, PALETTE_PRESETS } from './palettes.js';
import { seededRandom, shuffle } from './random.js';

/**
 * The three layers, in painting order. `loadFactor` sets how far a brush
 * travels before running dry, as a multiple of the stroke's length: thin
 * underpainting lasts a long way, thick accents run out sooner.
 */
export const LAYERS = [
  { key: 'under',   label: 'Underpainting', loadFactor: 2.0 },
  { key: 'body',    label: 'Body paint',    loadFactor: 1.2 },
  { key: 'accents', label: 'Accents',       loadFactor: 0.9 },
];

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
    coverage: 1.0,      // scales the number of strokes in every layer
    layers: {
      //          density = how much of the canvas the layer covers (1 = about once over)
      //          size = brush radius px, length = stroke length px
      under:   { density: 1.3,  size: 62, length: 420, thickness: 0.35 },
      body:    { density: 1.3,  size: 30, length: 230, thickness: 1.0 },
      accents: { density: 0.35, size: 14, length: 95,  thickness: 1.6 },
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
  const colors = createColorPicker(settings.palette);
  const jobs = [];

  for (const layer of LAYERS) {
    const L = settings.layers[layer.key];
    const density = L.density * settings.coverage;
    if (density <= 0) continue;

    // How many strokes? Enough that their total area (width x length)
    // covers the canvas `density` times over.
    const strokeArea = (2 * L.size) * L.length;
    const count = Math.min(3000, Math.round(density * width * height / strokeArea));

    for (const [x, y] of jitteredGrid(count, width, height, L.size, rand)) {
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
      jobs.push({ brush, points: tracePath(x, y, length, radius, field, rand), layer: layer.key });
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
 * @returns {Float32Array} x0, y0, x1, y1, ... in surface pixels
 */
function tracePath(x, y, length, radius, field, rand) {
  const step = Math.max(2, radius * 0.12);
  // A field only gives a LINE direction, so a stroke may travel either way
  // along it. Picking at random stops every stroke starting on the same side.
  const flip = rand() < 0.5 ? 0 : Math.PI;
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
