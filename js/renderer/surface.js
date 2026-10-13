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
//   front  - the painting as it stands (rgb = colour, a = paint height)
//   back   - a spare copy; composites are written here, then front and back
//            swap ("ping-pong"), because a shader can't read and write the
//            same texture at once
//   stroke - scratch space for the ONE stroke currently being painted
//            (r = thickness, g = coverage)
//
// The life of a stroke:
//
//   beginStroke()  clear the stroke buffer
//   addDabs()      stamp dabs into the stroke buffer (MAX blending), then
//                  composite "front + stroke" into back, so the stroke shows
//                  up live while you're still dragging
//   endStroke()    swap: back becomes the new front. The stroke is now
//                  permanently part of the painting.
//
// Keeping the stroke separate until it's finished is what lets overlapping
// dabs WITHIN one stroke merge smoothly (MAX blending), while separate strokes
// still pile up on top of each other (composite adds their heights).
// =============================================================================

import { Program, createRenderTarget, bindTarget, drawFullscreen } from './gl-utils.js';
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

    this.front  = createRenderTarget(gl, width, height);
    this.back   = createRenderTarget(gl, width, height);
    this.stroke = createRenderTarget(gl, width, height);

    this.dabProgram = new Program(gl, shaders['dab.vert'], shaders['dab.frag'], 'dab');
    this.compositeProgram = new Program(gl, shaders['fullscreen.vert'], shaders['composite.frag'], 'composite');

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
    this.strokeHasPaint = false;
  }

  /**
   * Wipe the painting back to a bare, primed canvas.
   * @param {number[]} groundColor  sRGB [r, g, b] in 0..1
   */
  clear(groundColor) {
    const gl = this.gl;
    for (const target of [this.front, this.back]) {
      bindTarget(gl, target);
      // Alpha (= height) 0: no paint yet, just the ground colour.
      gl.clearColor(groundColor[0], groundColor[1], groundColor[2], 0.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    bindTarget(gl, null);
  }

  /**
   * Start a new stroke.
   * @param {Object} brush  radius, thickness, color, bristles, etc. (see main.js)
   */
  beginStroke(brush) {
    const gl = this.gl;
    this.brush = brush;
    this.strokeActive = true;
    this.strokeHasPaint = false;
    bindTarget(gl, this.stroke);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    bindTarget(gl, null);
  }

  /**
   * Stamp dabs into the stroke buffer, then refresh the live preview.
   * @param {Float32Array} dabs  FLOATS_PER_DAB floats per dab: x, y, angle, load, travelled
   */
  addDabs(dabs) {
    if (!this.strokeActive || dabs.length === 0) return;
    const gl = this.gl;
    const b = this.brush;

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

    this.strokeHasPaint = true;
    this.#compositeIntoBack();
  }

  /** Finish the stroke: it becomes a permanent part of the painting. */
  endStroke() {
    if (!this.strokeActive) return;
    this.strokeActive = false;
    // If no dabs were added, "back" doesn't hold a fresh composite, so we
    // must NOT swap (we'd swap in a stale image).
    if (this.strokeHasPaint) {
      [this.front, this.back] = [this.back, this.front];
    }
    this.brush = null;
  }

  /**
   * The texture the lighting pass should show. While a stroke is in
   * progress that's the live composite in "back", otherwise the painting.
   */
  get displayTexture() {
    return (this.strokeActive && this.strokeHasPaint) ? this.back.texture : this.front.texture;
  }

  /** Composite (front + stroke) into back. */
  #compositeIntoBack() {
    const gl = this.gl;
    const b = this.brush;
    bindTarget(gl, this.back);
    this.compositeProgram.use()
      .texture('uSurface', this.front.texture, 0)
      .texture('uStroke', this.stroke.texture, 1)
      .vec3('uColor', b.color[0], b.color[1], b.color[2])
      .float('uFlatten', b.flatten)
      .float('uPickup', b.pickup)
      .float('uThickness', b.thickness);
    drawFullscreen(gl);
    bindTarget(gl, null);
  }
}
