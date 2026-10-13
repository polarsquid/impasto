// =============================================================================
// pigment.js
// -----------------------------------------------------------------------------
// Colour helpers, and paint-like colour mixing using Spectral.js.
//
// Throughout the app, colours are arrays of three numbers 0..1 in sRGB:
// [r, g, b], the same values a colour picker shows (divided by 255).
//
// Spectral.js is vendored in /lib. It's written as a "UMD" script (an older
// format that works everywhere): when it runs in a browser with no module
// system around, it puts itself on the global object as `spectral`. So we
// import it just for that side effect, then pick it up from globalThis.
// =============================================================================

import '../../lib/spectral.js';
const spectral = globalThis.spectral;

/** '#3a5f8f' -> [0.23, 0.37, 0.56] */
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

/** [0.23, 0.37, 0.56] -> '#3a5f8f' */
export function rgbToHex(rgb) {
  return '#' + rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255)
    .toString(16).padStart(2, '0')).join('');
}

/**
 * Mix two paint colours the way real pigments mix (Kubelka-Munk theory),
 * so blue + yellow = green, not grey. See shaders/lib/spectral.glsl for a
 * plain-English explanation of how it works.
 *
 * @param {number[]} a  sRGB 0..1
 * @param {number[]} b  sRGB 0..1
 * @param {number} t    0 = all a, 1 = all b
 * @returns {number[]}  sRGB 0..1
 */
export function mixPigments(a, b, t) {
  if (t <= 0) return a.slice();
  if (t >= 1) return b.slice();
  // Spectral.js expects 0..255 values and returns 0..255.
  const ca = new spectral.Color(a.map((v) => v * 255));
  const cb = new spectral.Color(b.map((v) => v * 255));
  const mixed = spectral.mix([ca, 1 - t], [cb, t]);
  return mixed.sRGB.map((v) => Math.min(1, Math.max(0, v / 255)));
}
