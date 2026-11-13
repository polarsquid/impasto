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
//                      g = gloss, 0..1: 0 is ordinary brushed oil paint,
//                          1 is the smoother, shinier top that a palette
//                          knife leaves (the text, phase 3)
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
// Besides strokes, a surface can also run a whole-area "pass" (applyPass):
// a shader that reads front and writes back over a rectangle, then copies
// it into front. The knife lettering (phase 3) is painted that way. And it
// can keep a SNAPSHOT of itself (saveSnapshot / restoreSnapshot), so the
// lettering can be repainted over the same background again and again
// without regenerating the background.
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
    this.#createTargets(width, height);

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

  /**
   * Make the textures for a given size. Surface targets have two textures:
   * [0] paint (RGBA) and [1] height + gloss, which needs only two channels,
   * so it uses RG16F (two half-floats per pixel).
   */
  #createTargets(width, height) {
    const gl = this.gl;
    this.width = width;
    this.height = height;
    const surfaceLayout = { attachments: [{}, { internalFormat: gl.RG16F, format: gl.RG }] };
    this.front  = createRenderTarget(gl, width, height, surfaceLayout);
    this.back   = createRenderTarget(gl, width, height, surfaceLayout);
    this.stroke = createRenderTarget(gl, width, height);
    this.snapshot = null;       // made the first time saveSnapshot() is called
  }

  /** Free a render target's GPU memory (its textures and framebuffer). */
  #deleteTarget(target) {
    if (!target) return;
    target.textures.forEach((t) => this.gl.deleteTexture(t));
    this.gl.deleteFramebuffer(target.framebuffer);
  }

  /**
   * Change the surface's size (portrait <-> landscape). The painting is
   * lost: the textures are thrown away and new blank ones made. Whoever
   * owns the surface repaints it afterwards.
   */
  resize(width, height) {
    if (width === this.width && height === this.height) return;
    [this.front, this.back, this.stroke, this.snapshot].forEach((t) => this.#deleteTarget(t));
    this.#createTargets(width, height);
    this.strokeActive = false;
    this.clear();
  }

  /**
   * Remember the painting as it is now, so restoreSnapshot() can bring it
   * back later. Phase 3 takes one when the background is finished, and
   * restores it before every repaint of the lettering.
   */
  saveSnapshot() {
    if (!this.snapshot) {
      this.snapshot = createRenderTarget(this.gl, this.width, this.height,
        { attachments: [{}, { internalFormat: this.gl.RG16F, format: this.gl.RG }] });
    }
    this.#copy(this.front, this.snapshot, null);
  }

  /** True if there's a snapshot to go back to. */
  get hasSnapshot() { return this.snapshot !== null; }

  /** Put the painting back exactly as it was at the last saveSnapshot(). */
  restoreSnapshot() {
    if (!this.snapshot) return;
    // Both front and back, to keep the rule that they're identical between strokes.
    this.#copy(this.snapshot, this.front, null);
    this.#copy(this.snapshot, this.back, null);
  }

  /**
   * Run a shader over a rectangle of the painting: it reads the painting
   * (front) and writes the new version (into back), which is then copied
   * into front, so the change becomes permanent. Used for effects that work
   * on a whole area at once rather than dab by dab, like the knife lettering.
   *
   * The program must read the painting from samplers named uPaint (texture
   * unit 0) and uHeight (unit 1), and write two outputs like composite.frag.
   *
   * @param {Program} program
   * @param {{x0, y0, x1, y1}} box  surface pixels, y down
   * @param {Function} setUniforms  called with the program to set its own
   *   uniforms (use texture units 2 and up for any extra textures)
   */
  applyPass(program, box, setUniforms) {
    const gl = this.gl;
    bindTarget(gl, this.back);
    setScissor(gl, box, this.height);
    program.use()
      .texture('uPaint', this.front.textures[0], 0)
      .texture('uHeight', this.front.textures[1], 1);
    setUniforms(program);
    drawFullscreen(gl);
    setScissor(gl, null);
    bindTarget(gl, null);
    this.#copy(this.back, this.front, box);
  }

  /** Wipe the painting back to bare canvas: zero coverage, zero height. */
  clear() {
    clearTarget(this.gl, this.front);
    clearTarget(this.gl, this.back);
    clearTarget(this.gl, this.stroke);
    // A snapshot is blanked too, so restoring it later gives bare canvas
    // rather than bringing back paint that was cleared away.
    if (this.snapshot) clearTarget(this.gl, this.snapshot);
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

  /**
   * Copy a rectangle of both surface textures from one target to another.
   * A box of null copies the whole surface.
   */
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
