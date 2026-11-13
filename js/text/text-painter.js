// =============================================================================
// text-painter.js
// -----------------------------------------------------------------------------
// Paints the knife lettering onto a PaintSurface. Three steps:
//
//   layout   - layout.js decides the lines, size and letter positions
//   field    - text-field.js turns the letters into a signed distance field
//   paint    - shaders/text.frag uses the field to lay thick white knife
//              paint into the surface (colour, coverage, height and gloss)
//
// Layout and field take the most time (tens of milliseconds, in JavaScript)
// but only depend on the message, size, position, jitter, seed and canvas
// shape. So they're remembered, and only redone when one of those changes.
// Changing roughness, height, knife marks or contamination just re-runs the
// shader, which is quick.
//
// The field is uploaded to the GPU as a texture: 4 numbers per pixel, stored
// as half-floats (RGBA16F), which is plenty for distances and angles.
// =============================================================================

import { Program } from '../renderer/gl-utils.js';
import { layoutText } from './layout.js';
import { buildTextField } from './text-field.js';
import { seededRandom } from '../generator/random.js';

/** Letters this tall (cap height, px) have knife marks at their natural size. */
const REFERENCE_CAP = 250;

export class TextPainter {
  /**
   * @param {WebGL2RenderingContext} gl
   * @param {Object} shaders  shader sources keyed by file name
   */
  constructor(gl, shaders) {
    this.gl = gl;
    this.program = new Program(gl, shaders['fullscreen.vert'], shaders['text.frag'], 'text');
    this.texture = gl.createTexture();
    this.cacheKey = null;   // what the current layout + field were made from
    this.layout = null;
    this.field = null;
  }

  /**
   * Paint the message onto the surface. Call it on a surface that holds just
   * the background (phase 3 restores its snapshot first), since the letters
   * are painted on top of whatever is there.
   *
   * @param {PaintSurface} surface
   * @param {Object} font      opentype.js Font from font.js
   * @param {Object} settings  text settings (see defaultTextSettings in layout.js)
   * @param {number} seed      random seed: the same seed gives the same letters
   * @returns {{ lines: string[] }} the lines used, e.g. to show in the panel
   */
  paint(surface, font, settings, seed) {
    this.#prepare(surface, font, settings, seed);
    const { layout, field } = this;
    if (!field) return { lines: [] };

    const box = { x0: field.x, y0: field.y, x1: field.x + field.width, y1: field.y + field.height };
    surface.applyPass(this.program, box, (program) => {
      program
        .texture('uText', this.texture, 2)
        .vec2('uFieldOrigin', field.x, field.y)
        .vec2('uFieldSize', field.width, field.height)
        .vec2('uSurfaceSize', surface.width, surface.height)
        // Keep knife marks in proportion to the letters, within sensible limits.
        .float('uScale', Math.min(2, Math.max(0.35, layout.capPx / REFERENCE_CAP)))
        .float('uSeed', seed % 1000)
        .float('uRoughness', settings.roughness)
        .float('uTextHeight', settings.height)
        .float('uKnife', settings.knife)
        .float('uContamination', settings.contamination);
    });
    return { lines: layout.lines };
  }

  /** Redo the layout and field if anything they depend on has changed. */
  #prepare(surface, font, settings, seed) {
    const key = JSON.stringify([settings.text, settings.size, settings.position, settings.jitter,
      seed, surface.width, surface.height]);
    if (key === this.cacheKey) return;
    this.cacheKey = key;

    // The letters get their own random stream from the seed, so the text's
    // jitter and knife marks don't change when generator settings do.
    const rand = seededRandom((seed ^ 0x51ed270b) >>> 0);
    this.layout = layoutText(font, settings.text, surface.width, surface.height, settings, rand);
    this.field = buildTextField(this.layout, surface.width, surface.height);
    if (!this.field) return;

    // Upload the field. RGBA16F storage, but we hand over 32-bit floats
    // (gl.FLOAT) and let WebGL convert them. NEAREST filtering: the shader
    // reads exact pixels with texelFetch, so no smoothing is wanted.
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, this.field.width, this.field.height, 0,
      gl.RGBA, gl.FLOAT, this.field.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
}
