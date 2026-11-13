// =============================================================================
// font.js
// -----------------------------------------------------------------------------
// Loads the lettering font (XBAND Rough) with opentype.js, which reads the
// .ttf file and can hand us every letter's OUTLINE: the curves and lines
// that trace its edge. We need outlines rather than just "drawing text",
// because the knife paint is built from the exact shape of each letter.
//
// The font is loaded once and shared: loadFont() returns the same promise
// every time it's called with the same address.
// =============================================================================

import { parse } from '../../lib/opentype.mjs';

/** Where the lettering font lives, relative to index.html. */
export const LETTERING_FONT_URL = 'fonts/XBAND_Rough.ttf';

const cache = new Map();

/**
 * Load a font file and parse it.
 * @param {string} url
 * @returns {Promise<Object>} an opentype.js Font, plus our own `capHeight`
 */
export function loadFont(url = LETTERING_FONT_URL) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then((response) => {
      if (!response.ok) throw new Error(`Could not load the font ${url} (${response.status})`);
      return response.arrayBuffer();
    }).then((buffer) => prepareFont(parse(buffer))));
  }
  return cache.get(url);
}

/**
 * Add the measurements the layout needs to a parsed font. Kept separate from
 * loadFont() so a Node test can parse the file from disk and call this.
 *
 * capHeight: how tall a capital letter is, as a fraction of the font size.
 * Many fonts record this in their "OS/2" table, but XBAND Rough doesn't, so
 * we measure it from the letter H's outline instead. (We lay text out by cap
 * height rather than the full font size, because the font size includes
 * room for accents and descenders that all-caps lettering never uses.)
 */
export function prepareFont(font) {
  const box = font.getPath('H', 0, 0, 1).getBoundingBox();
  // y points DOWN in opentype.js paths (like the screen), so the top of the
  // H is at a negative y. Fall back to a typical value if H is missing.
  font.capHeight = box.y1 < 0 ? -box.y1 : 0.72;
  return font;
}
