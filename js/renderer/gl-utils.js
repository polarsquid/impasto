// =============================================================================
// gl-utils.js
// -----------------------------------------------------------------------------
// Small helpers that hide WebGL's most repetitive boilerplate. WebGL is a
// very low-level API: to do anything you create shaders, compile them, link
// them into programs, create textures, attach them to framebuffers, and so on.
// These functions wrap each of those chores so the rest of the code can talk
// about painting instead of plumbing.
// =============================================================================

/**
 * Get a WebGL2 context from a <canvas> and check it can do what we need.
 *
 * We need to RENDER INTO floating-point textures (our height map stores
 * values like 0.37 or 2.8, not just 0..255 bytes). In WebGL2 that requires the
 * EXT_color_buffer_float extension, which virtually every modern browser has.
 */
export function createContext(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: false,             // we draw full-screen images, no edges to smooth
    alpha: false,                 // the canvas itself is opaque
    preserveDrawingBuffer: true,  // keep the image after drawing (needed to save PNGs)
  });
  if (!gl) {
    throw new Error('This browser does not support WebGL2. Try a current version of Chrome, Firefox or Safari.');
  }
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new Error('This browser cannot render to float textures (EXT_color_buffer_float is missing).');
  }
  return gl;
}

/**
 * Fetch shader source files (.vert / .frag) from the shaders/ folder.
 * Note: fetch() only works when the page is served over http(s), which is why
 * the README says to run a local server instead of double-clicking the file.
 *
 * @param {string[]} names  e.g. ['dab.vert', 'dab.frag']
 * @returns {Promise<Object>} { 'dab.vert': '...source...', ... }
 */
export async function loadShaderSources(names) {
  const entries = await Promise.all(names.map(async (name) => {
    const response = await fetch(`shaders/${name}`);
    if (!response.ok) throw new Error(`Could not load shaders/${name} (${response.status})`);
    return [name, await response.text()];
  }));
  return Object.fromEntries(entries);
}

/**
 * Compile one shader stage. If the GLSL has a mistake, the browser's error
 * message is thrown with the file name, which makes debugging much easier.
 */
function compileShader(gl, type, source, label) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader "${label}" failed to compile:\n${log}`);
  }
  return shader;
}

/**
 * A "program" is a vertex shader + fragment shader linked together; it's what
 * actually runs on the GPU when we draw. This class also caches uniform
 * locations. (Uniforms are the settings we pass from JS into a shader, like
 * the light direction. Looking up where they live is slow, so we do it once.)
 */
export class Program {
  constructor(gl, vertexSource, fragmentSource, label = 'program') {
    this.gl = gl;
    this.label = label;
    const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource, `${label} (vertex)`);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, `${label} (fragment)`);

    this.program = gl.createProgram();
    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error(`Program "${label}" failed to link:\n${gl.getProgramInfoLog(this.program)}`);
    }
    // Once linked, the individual shader objects are no longer needed.
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    this.locations = new Map();
  }

  /** Make this the active program for the next draw call. */
  use() {
    this.gl.useProgram(this.program);
    return this;
  }

  /** Find (and remember) where a uniform lives in the program. */
  loc(name) {
    if (!this.locations.has(name)) {
      // Returns null if the uniform doesn't exist, or if the GLSL compiler
      // removed it because it's unused. Setting a null location is harmless.
      this.locations.set(name, this.gl.getUniformLocation(this.program, name));
    }
    return this.locations.get(name);
  }

  // Typed setters. GLSL is strict about types, so a float needs uniform1f,
  // a vec3 needs uniform3f, an int (or texture slot) needs uniform1i, etc.
  float(name, v)       { this.gl.uniform1f(this.loc(name), v); return this; }
  int(name, v)         { this.gl.uniform1i(this.loc(name), v); return this; }
  vec2(name, x, y)     { this.gl.uniform2f(this.loc(name), x, y); return this; }
  vec3(name, x, y, z)  { this.gl.uniform3f(this.loc(name), x, y, z); return this; }

  /**
   * Bind a texture to a numbered "texture unit" and point a sampler uniform
   * at it. The GPU has several slots (units 0, 1, 2...) that shaders read
   * textures from; a sampler uniform just holds a slot number.
   */
  texture(name, texture, unit) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.loc(name), unit);
    return this;
  }
}

/**
 * A render target = one or more textures we can draw INTO (via a
 * framebuffer) and later read FROM (as textures in another shader). This is
 * how multi-pass GPU effects are built: draw into one target, feed it to the
 * next pass.
 *
 * A target can have SEVERAL textures ("multiple render targets", MRT): one
 * draw call then writes a different output into each texture at once. The
 * paint surface uses this to keep colour and height in separate textures.
 *
 * Each texture defaults to RGBA16F: four 16-bit floating-point channels per
 * pixel. "Half floats" have plenty of precision for paint heights and
 * colours, use half the memory of 32-bit floats, and (unlike 32-bit) can be
 * smoothly filtered and blended on every WebGL2 device.
 *
 * @param {Object[]} [options.attachments]  one { internalFormat, format }
 *   per texture, e.g. [{}, { internalFormat: gl.R16F, format: gl.RED }].
 *   Leave out for a single RGBA16F texture.
 * @returns {{ textures, texture, framebuffer, width, height }}
 *   `texture` is a shortcut for textures[0].
 */
export function createRenderTarget(gl, width, height, options = {}) {
  const attachments = options.attachments ?? [{}];
  const filter = options.filter ?? gl.LINEAR;   // LINEAR = smooth sampling between pixels

  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

  const textures = attachments.map((spec, i) => {
    const internalFormat = spec.internalFormat ?? gl.RGBA16F;
    const format = spec.format ?? gl.RGBA;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // Allocate storage (null = no initial data, we'll clear or draw into it).
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    // CLAMP_TO_EDGE: reading past the border repeats the edge pixel instead
    // of wrapping around to the other side of the painting.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Attach as colour output number i. In a shader, the output declared
    // with layout(location = i) lands in this texture.
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, texture, 0);
    return texture;
  });

  // Tell the framebuffer to write to ALL its attachments, not just the first.
  // (This setting is remembered by the framebuffer, so we only do it once.)
  gl.drawBuffers(textures.map((_, i) => gl.COLOR_ATTACHMENT0 + i));

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Render target could not be created (framebuffer status ${status}).`);
  }

  return { textures, texture: textures[0], framebuffer, width, height };
}

/**
 * Fill every texture of a render target with zeros.
 * (gl.clear would also work, but clearBufferfv is explicit about which
 * attachment it's clearing, which is clearer with several textures.)
 */
export function clearTarget(gl, target) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  target.textures.forEach((_, i) => gl.clearBufferfv(gl.COLOR, i, [0, 0, 0, 0]));
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/**
 * Direct all following draw calls into a render target (or to the visible
 * canvas when target is null), and size the drawing area to match.
 */
export function bindTarget(gl, target) {
  if (target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
  } else {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }
}

/**
 * Draw the single oversized triangle from fullscreen.vert. WebGL2 needs *a*
 * vertex array object bound to draw, even when the shader uses no vertex
 * buffers, so we keep one empty VAO around for this.
 */
let emptyVAO = null;
export function drawFullscreen(gl) {
  if (!emptyVAO) emptyVAO = gl.createVertexArray();
  gl.bindVertexArray(emptyVAO);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
}
