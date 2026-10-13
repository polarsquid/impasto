// =============================================================================
// surface.js
// -----------------------------------------------------------------------------
// The PaintSurface is our "canvas" in the painter's sense: it remembers every
// bit of paint that's been laid down. It lives entirely on the GPU as
// textures, never as JavaScript arrays, so even a large painting with
// thousands of strokes stays fast.
//
// It holds three render targets (textures we can draw into):
//
//   front  - the painting as it stands, as TWO textures:
//              paint:  rgb = paint colour, a = coverage (0 = bare canvas)
//              height: r = paint thickness
//            The canvas colour isn't stored at all; the lighting pass mixes
//            it in, so it can be changed without repainting.
//   back   - a copy of front, plus the stroke in progress. This is what's
//            shown on screen. A shader can't read and write the same texture
//            at once, so composites read front and write back.
//   stroke - scratch space for the ONE stroke currently being painted
//            (r = thickness, g = coverage)
//
// The life of a stroke:
//
//   beginStroke()  clear the stroke buffer
//   addDabs()      stamp dabs into the stroke buffer (MAX blending), then
//                  composite "front + stroke" into back, so the stroke shows
//                  up live while you're still dragging
//   endStroke()    copy the stroke's area from back into front. The stroke
//                  is now permanently part of the painting, and front and
//                  back are identical again.
//
// Keeping the stroke separate until it's finished is what lets overlapping
// dabs WITHIN one stroke merge smoothly (MAX blending), while separate strokes
// still pile up on top of each other (composite adds their heights).
//
// SPEED: every step above is limited to the stroke's bounding box using the
// scissor test. A typical stroke covers a few percent of the canvas, so this
// makes painting hundreds of strokes (the generator) many times faster than
// processing the whole canvas for each one.
// =============================================================================

import { Program, createRenderTarget, clearTarget, bindTarget, drawFullscreen, setScissor } from './gl-utils.js';
import { FLOATS_PER_DAB } from '../strokes/stroke-path.js';

export class PaintSurface {
  /**
   * @param {WebGL2RenderingContext} gl
   * @param {Object} shaders  shader sources keyed by file name
   * @param {number} width    surface size in pixels
   * @param {number} height
   */
  constructor(gl, shaders, width, height) {
    this.gl = gl;
    this.width = width;
    this.height = height;

    // Surface targets have two textures: [0] paint (RGBA), [1] height. Height
    // only needs one channel, so it uses R16F (one half-float per pixel).
    const surfaceLayout = { attachments: [{}, { internalFormat: gl.R16F, format: gl.RED }] };
    this.front  = createRenderTarget(gl, width, height, surfaceLayout);
    this.back   = createRenderTarget(gl, width, height, surfaceLayout);
    this.stroke = createRenderTarget(gl, width, height);

    this.dabProgram = new Program(gl, shaders['dab.vert'], shaders['dab.frag'], 'dab');
    this.compositeProgram = new Program(gl, shaders['fullscreen.vert'], shaders['composite.frag'], 'composite');
    this.copyProgram = new Program(gl, shaders['fullscreen.vert'], shaders['copy.frag'], 'copy');

    // --- Instance buffer for dabs ------------------------------------------------
    // A VAO (vertex array object) records how vertex data is laid out, so we
    // set it up once here and just re-bind it when drawing.
    this.dabBuffer = gl.createBuffer();
    this.dabVAO = gl.createVertexArray();
    gl.bindVertexArray(this.dabVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dabBuffer);
    // Each dab is 5 floats in a row: x, y, angle, load, travelled.
    // "stride" = bytes from one dab to the next (5 floats x 4 bytes = 20).
    const stride = FLOATS_PER_DAB * 4;
    // Attribute 0 (aDab, a vec4) = the first 4 floats of each dab.
    gl.enableVertexAttribArray(0);  // matches layout(location = 0) in dab.vert
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, stride, 0);
    // Attribute 1 (aTravel, one float) = the 5th float, 16 bytes in.
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 16);
    // Divisor 1 = advance to the next dab once per INSTANCE (per dab),
    // rather than once per vertex. This is what makes it instancing.
    gl.vertexAttribDivisor(0, 1);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);

    this.brush = null;          // settings of the stroke in progress
    this.strokeActive = false;
    this.box = null;            // bounding box of the stroke in progress
    this.lastBox = null;        // ...and of the previous stroke
    this.strokeCount = 0;       // strokes painted since the last clear

    this.clear();
  }

  /** Wipe the painting back to bare canvas: zero coverage, zero height. */
  clear() {
    clearTarget(this.gl, this.front);
    clearTarget(this.gl, this.back);
    clearTarget(this.gl, this.stroke);
    this.lastBox = null;
    this.strokeCount = 0;
  }

  /**
   * Start a new stroke.
   * @param {Object} brush  radius, thickness, color, bristles, etc. (see main.js)
   */
  beginStroke(brush) {
    const gl = this.gl;
    this.brush = brush;
    this.strokeActive = true;
    this.box = null;

    // The stroke buffer still holds the PREVIOUS stroke, but only inside
    // that stroke's box, so that's all we need to clear.
    if (this.lastBox) {
      bindTarget(gl, this.stroke);
      setScissor(gl, this.lastBox, this.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      setScissor(gl, null);
      bindTarget(gl, null);
    }
  }

  /**
   * Stamp dabs into the stroke buffer, then refresh the live preview.
   * @param {Float32Array} dabs  FLOATS_PER_DAB floats per dab: x, y, angle, load, travelled
   */
  addDabs(dabs) {
    if (!this.strokeActive || dabs.length === 0) return;
    const gl = this.gl;
    const b = this.brush;

    // Grow the stroke's bounding box to include these dabs. A dab reaches
    // at most one radius from its centre; add 2px of safety margin.
    const reach = b.radius + 2;
    const box = this.box ?? { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (let i = 0; i < dabs.length; i += FLOATS_PER_DAB) {
      box.x0 = Math.min(box.x0, dabs[i] - reach);
      box.y0 = Math.min(box.y0, dabs[i + 1] - reach);
      box.x1 = Math.max(box.x1, dabs[i] + reach);
      box.y1 = Math.max(box.y1, dabs[i + 1] + reach);
    }
    // Keep it inside the canvas.
    box.x0 = Math.max(0, box.x0);
    box.y0 = Math.max(0, box.y0);
    box.x1 = Math.min(this.width, box.x1);
    box.y1 = Math.min(this.height, box.y1);
    this.box = box;
    if (box.x1 <= box.x0 || box.y1 <= box.y0) return;   // entirely off-canvas

    bindTarget(gl, this.stroke);
    this.dabProgram.use()
      .vec2('uSurfaceSize', this.width, this.height)
      .float('uRadius', b.radius)
      .float('uThickness', b.thickness)
      .float('uBristles', b.bristles)
      .float('uGroove', b.groove)
      .float('uRidge', b.ridge)
      .float('uSeed', b.seed)
      .float('uTipShape', b.tipShape)
      .float('uEdgeWobble', b.edgeWobble);

    // MAX blending: each pixel keeps the larger of (what's there, new dab).
    // For MAX, the usual blendFunc factors are ignored.
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);

    gl.bindVertexArray(this.dabVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dabBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, dabs, gl.DYNAMIC_DRAW);  // upload this batch
    // 6 vertices (our square) x one instance per dab.
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, dabs.length / FLOATS_PER_DAB);
    gl.bindVertexArray(null);

    gl.disable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);  // put blending back to normal

    this.#compositeIntoBack();
  }

  /** Finish the stroke: it becomes a permanent part of the painting. */
  endStroke() {
    if (!this.strokeActive) return;
    this.strokeActive = false;
    // If no dabs landed on the canvas, back is unchanged: nothing to copy.
    if (this.box && this.box.x1 > this.box.x0 && this.box.y1 > this.box.y0) {
      this.#copy(this.back, this.front, this.box);
      this.lastBox = this.box;
      this.strokeCount++;
    }
    this.brush = null;
  }

  /**
   * The textures the lighting pass should show. "back" always holds the
   * painting plus any stroke in progress.
   * @returns {{ paint: WebGLTexture, height: WebGLTexture }}
   */
  get display() {
    return { paint: this.back.textures[0], height: this.back.textures[1] };
  }

  /** Composite (front + stroke) into back, inside the stroke's box only. */
  #compositeIntoBack() {
    const gl = this.gl;
    const b = this.brush;
    bindTarget(gl, this.back);
    setScissor(gl, this.box, this.height);
    this.compositeProgram.use()
      .texture('uPaint', this.front.textures[0], 0)
      .texture('uHeight', this.front.textures[1], 1)
      .texture('uStroke', this.stroke.texture, 2)
      .vec3('uColor', b.color[0], b.color[1], b.color[2])
      .float('uFlatten', b.flatten)
      .float('uPickup', b.pickup)
      .float('uThickness', b.thickness);
    drawFullscreen(gl);
    setScissor(gl, null);
    bindTarget(gl, null);
  }

  /** Copy a rectangle of both surface textures from one target to another. */
  #copy(from, to, box) {
    const gl = this.gl;
    bindTarget(gl, to);
    setScissor(gl, box, this.height);
    this.copyProgram.use()
      .texture('uPaint', from.textures[0], 0)
      .texture('uHeight', from.textures[1], 1);
    drawFullscreen(gl);
    setScissor(gl, null);
    bindTarget(gl, null);
  }
}
