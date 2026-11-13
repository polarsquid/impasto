// =============================================================================
// text-field.js
// -----------------------------------------------------------------------------
// Turns the laid-out letters (layout.js) into a "text field": an image with
// four numbers per pixel that text.frag reads to paint the knife lettering.
//
//   r = SIGNED DISTANCE to the nearest letter edge, in pixels:
//       negative inside a letter, positive outside, 0 exactly on the edge.
//   g = knife direction of the nearest letter (radians, y down)
//   b = that letter's random seed (0..1)
//   a = distance along the knife's path from where it touched down (pixels)
//
// WHY A SIGNED DISTANCE FIELD (SDF)?
// A plain black-and-white mask only says "inside" or "outside". The distance
// tells the shader HOW FAR inside or outside, which is what shapes the
// paint: a ridge 4px in from the edge, a smear of spill 6px outside it, and
// edges that can be roughened by simply adding noise to the distance.
//
// HOW IT'S MADE
//   1. Draw every letter, filled, into an ordinary 2D canvas. Each letter is
//      filled with its own colour, so we can later tell which letter a
//      pixel belongs to.
//   2. Run a fast "Euclidean distance transform" twice: once to find each
//      outside pixel's distance to the nearest inside pixel, once the other
//      way round. (The algorithm is Felzenszwalb and Huttenlocher's, which
//      takes the same time however far the distances are.)
//   3. The outside pass also remembers WHICH inside pixel was nearest, so
//      pixels around a letter know which letter they belong to (for the
//      knife direction of its spill).
//
// Only a rectangle around the text (plus a margin for spill and rough
// edges) is processed, not the whole canvas: less work, smaller texture.
// =============================================================================

/** Extra pixels kept around the text's box, for spill and rough edges. */
export const FIELD_MARGIN = 48;

/** Distances are capped at this many pixels; nothing reads further. */
const MAX_DISTANCE = 64;

/** A big number standing in for "infinitely far" in the transform. */
const FAR = 1e20;

/**
 * Build the text field for a layout. Browser only (it draws with a canvas).
 * @param {Object} layout  from layoutText()
 * @param {number} width, height  surface size
 * @returns {{ data: Float32Array, x: number, y: number, width: number,
 *             height: number } | null}
 *   data holds 4 floats per pixel (see the top of this file), rows from the
 *   top down. x, y = where the rectangle sits on the surface.
 */
export function buildTextField(layout, width, height) {
  const region = fieldRegion(layout, width, height);
  if (!region) return null;
  const { alpha, ids } = rasterizeLetters(layout.letters, region);
  return { ...region, data: computeField(alpha, ids, layout.letters, region) };
}

/** The rectangle of the surface the field covers: the text box plus margin. */
export function fieldRegion(layout, width, height) {
  if (!layout.box) return null;
  const x0 = Math.max(0, Math.floor(layout.box.x0 - FIELD_MARGIN));
  const y0 = Math.max(0, Math.floor(layout.box.y0 - FIELD_MARGIN));
  const x1 = Math.min(width, Math.ceil(layout.box.x1 + FIELD_MARGIN));
  const y1 = Math.min(height, Math.ceil(layout.box.y1 + FIELD_MARGIN));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// --- 1. Drawing the letters -----------------------------------------------------

/**
 * Fill each letter in its own colour and read the pixels back.
 *
 * The letter number (1, 2, 3... with 0 meaning "no letter") is hidden in the
 * red and green channels, 16 letters per channel step. Steps of 16 leave
 * plenty of slack: the canvas smooths (anti-aliases) letter edges, which can
 * shift the stored colour a little at partly covered pixels.
 *
 * @returns {{ alpha: Uint8Array, ids: Uint16Array }} per pixel: how much is
 *   covered (0..255) and which letter (1-based, 0 = none)
 */
function rasterizeLetters(letters, region) {
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(region.width, region.height)
    : Object.assign(document.createElement('canvas'), { width: region.width, height: region.height });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.translate(-region.x, -region.y);   // draw in surface coordinates

  letters.forEach((letter, i) => {
    const id = i + 1;
    ctx.fillStyle = `rgb(${(id % 16) * 16 + 8}, ${Math.floor(id / 16) * 16 + 8}, 0)`;
    ctx.beginPath();
    for (const c of letter.commands) {
      if (c.type === 'M') ctx.moveTo(c.x, c.y);
      else if (c.type === 'L') ctx.lineTo(c.x, c.y);
      else if (c.type === 'C') ctx.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y);
      else if (c.type === 'Q') ctx.quadraticCurveTo(c.x1, c.y1, c.x, c.y);
      else if (c.type === 'Z') ctx.closePath();
    }
    // "nonzero" winding: holes (the middle of an O) are drawn in the opposite
    // direction to the outside, so they stay empty.
    ctx.fill('nonzero');
  });

  const pixels = ctx.getImageData(0, 0, region.width, region.height).data;
  const count = region.width * region.height;
  const alpha = new Uint8Array(count);
  const ids = new Uint16Array(count);
  for (let p = 0; p < count; p++) {
    const a = pixels[p * 4 + 3];
    alpha[p] = a;
    if (a >= 128) {
      const id = Math.floor(pixels[p * 4] / 16) + 16 * Math.floor(pixels[p * 4 + 1] / 16);
      ids[p] = Math.min(id, letters.length);
    }
  }
  return { alpha, ids };
}

// --- 2. The distance transform ----------------------------------------------------

/**
 * Turn the coverage and letter ids into the 4-channel field. Pure maths,
 * so it can be tested in Node with a made-up mask.
 *
 * @param {Uint8Array} alpha   coverage per pixel, 0..255 (inside = 128 or more)
 * @param {Uint16Array} ids    letter per pixel, 1-based (only needed inside)
 * @param {Array} letters      [{ angle, seed, box }] from the layout
 * @param {{x, y, width, height}} region  where these pixels sit on the surface
 * @returns {Float32Array} 4 floats per pixel
 */
export function computeField(alpha, ids, letters, region) {
  const w = region.width;
  const h = region.height;
  const count = w * h;
  const inside = new Uint8Array(count);
  for (let p = 0; p < count; p++) inside[p] = alpha[p] >= 128 ? 1 : 0;

  // Distance from OUTSIDE pixels to the nearest inside one (and which one),
  // then from INSIDE pixels to the nearest outside one.
  const toInside = distanceTransform(inside, 1, w, h, true);
  const toOutside = distanceTransform(inside, 0, w, h, false);

  // Per letter: knife direction as a unit vector, and the "touch-down"
  // point: the corner of its box the knife reaches first.
  const knives = letters.map((l) => {
    const dx = Math.cos(l.angle);
    const dy = Math.sin(l.angle);
    const corners = [[l.box.x0, l.box.y0], [l.box.x1, l.box.y0], [l.box.x0, l.box.y1], [l.box.x1, l.box.y1]];
    const start = Math.min(...corners.map(([x, y]) => x * dx + y * dy));
    return { dx, dy, start, angle: l.angle, seed: l.seed };
  });

  const out = new Float32Array(count * 4);
  for (let p = 0; p < count; p++) {
    let sd;
    let id;
    if (inside[p]) {
      sd = -(Math.sqrt(toOutside.dist[p]) - 0.5);
      id = ids[p];
    } else {
      sd = Math.sqrt(toInside.dist[p]) - 0.5;
      id = toInside.nearest[p] >= 0 ? ids[toInside.nearest[p]] : 0;
    }
    // Right at the edge, use the canvas's smoothed coverage to place the
    // edge between pixels (sub-pixel accuracy), so edges aren't stair-stepped.
    if (Math.abs(sd) <= 0.5) sd = 0.5 - alpha[p] / 255;
    sd = Math.max(-MAX_DISTANCE, Math.min(MAX_DISTANCE, sd));

    const knife = knives[(id || 1) - 1];
    const o = p * 4;
    out[o] = sd;
    if (knife) {
      const sx = region.x + (p % w) + 0.5;            // pixel centre on the surface
      const sy = region.y + Math.floor(p / w) + 0.5;
      out[o + 1] = knife.angle;
      out[o + 2] = knife.seed;
      out[o + 3] = Math.max(0, sx * knife.dx + sy * knife.dy - knife.start);
    }
  }
  return out;
}

/**
 * 2D Euclidean distance transform (Felzenszwalb and Huttenlocher, 2012).
 * For every pixel, finds the SQUARED distance to the nearest "feature" pixel
 * (one whose mask value equals `featureValue`). It works in two sweeps:
 * first down each column, then along each row using the column results.
 * Doing x and y separately is valid because squared distance splits
 * neatly: dx^2 + dy^2.
 *
 * @param {boolean} trackNearest  also record each pixel's nearest feature
 * @returns {{ dist: Float32Array, nearest: Int32Array | null }}
 *   nearest[p] = index of the nearest feature pixel, or -1 if there is none
 */
export function distanceTransform(mask, featureValue, w, h, trackNearest) {
  const count = w * h;
  const colDist = new Float32Array(count);           // after the column sweep
  const colRow = trackNearest ? new Int32Array(count) : null;   // nearest feature's row
  const dist = new Float32Array(count);
  const nearest = trackNearest ? new Int32Array(count).fill(-1) : null;

  // Scratch arrays for the 1D transform, sized for the longer side.
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const arg = new Int32Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);

  // Sweep 1: down each column. A feature pixel costs 0, anything else "far".
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = mask[y * w + x] === featureValue ? 0 : FAR;
    transform1D(f, h, d, arg, v, z);
    for (let y = 0; y < h; y++) {
      colDist[y * w + x] = d[y];
      if (colRow) colRow[y * w + x] = arg[y];
    }
  }

  // Sweep 2: along each row, starting from the column distances.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = colDist[y * w + x];
    transform1D(f, w, d, arg, v, z);
    for (let x = 0; x < w; x++) {
      dist[y * w + x] = d[x];
      if (nearest && d[x] < FAR / 2) {
        const fx = arg[x];                              // nearest column...
        nearest[y * w + x] = colRow[y * w + fx] * w + fx;   // ...and its nearest row
      }
    }
  }
  return { dist, nearest };
}

/**
 * The 1D distance transform: for each position q, the smallest
 * (q - p)^2 + f[p] over all p. Picture a parabola sitting on each p at
 * height f[p]; the answer is the "lower envelope" of all the parabolas.
 * The algorithm builds that envelope left to right (v holds the parabolas
 * in it, z where each takes over from the last), then reads it off.
 *
 * Writes the distances into d and the winning p for each q into arg.
 */
function transform1D(f, n, d, arg, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    // Where the parabola at q crosses the last one in the envelope.
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    // If it crosses before that one even takes over, that one is hidden:
    // drop it and compare with the one before.
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
    arg[q] = v[k];
  }
}
