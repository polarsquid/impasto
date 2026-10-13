// =============================================================================
// lighting.js
// -----------------------------------------------------------------------------
// The final pass: takes the paint surface (colour + height) and draws the lit
// result onto the visible <canvas>. All the interesting work happens in
// shaders/lighting.frag; this file just feeds it its settings.
// =============================================================================

import { Program, bindTarget, drawFullscreen } from './gl-utils.js';

/**
 * Convert the light's position, as a painter would describe it, into a 3D
 * direction vector for the shader.
 *
 *   azimuth   - compass direction the light comes FROM, in degrees:
 *               0 = top, 90 = right, 180 = bottom, 270 = left
 *   elevation - height above the canvas, in degrees:
 *               90 = straight overhead (flat-looking paint),
 *               low values = raking light that skims the surface and makes
 *               every ridge cast a long shadow
 *
 * In the shader's coordinates, +x is right, +y is UP the canvas and +z points
 * out of the canvas toward the viewer.
 */
export function lightDirection(azimuthDeg, elevationDeg) {
  const az = azimuthDeg * Math.PI / 180;
  const el = elevationDeg * Math.PI / 180;
  return [
    Math.sin(az) * Math.cos(el),  // x
    Math.cos(az) * Math.cos(el),  // y
    Math.sin(el),                 // z
  ];
}

export class LightingPass {
  constructor(gl, shaders) {
    this.gl = gl;
    this.program = new Program(gl, shaders['fullscreen.vert'], shaders['lighting.frag'], 'lighting');
  }

  /**
   * Draw the lit painting to the screen.
   * @param {{paint, height}} surface  the two surface textures (PaintSurface.display)
   * @param {number} width   surface width in pixels
   * @param {number} height  surface height in pixels
   * @param {Object} s       lighting settings (see DEFAULT_LIGHT in main.js)
   */
  render(surface, width, height, s) {
    const gl = this.gl;
    const [lx, ly, lz] = lightDirection(s.azimuth, s.elevation);

    bindTarget(gl, null);  // null = the visible canvas
    this.program.use()
      .texture('uPaint', surface.paint, 0)
      .texture('uHeight', surface.height, 1)
      .vec3('uGround', s.ground[0], s.ground[1], s.ground[2])
      .vec2('uSurfaceSize', width, height)
      .vec2('uTexel', 1 / width, 1 / height)
      .vec3('uLightDir', lx, ly, lz)
      .vec3('uLightColor', 1.0, 0.96, 0.9)  // slightly warm, like a tungsten lamp
      .float('uAmbient', s.ambient)
      .float('uDepth', s.depth)
      .float('uSpecular', s.specular)
      .float('uShininess', s.shininess)
      .float('uShadow', s.shadow)
      .float('uOcclusion', s.occlusion)
      .float('uWeave', s.weave)
      .float('uWeaveScale', s.weaveScale)
      .int('uViewMode', s.viewMode);
    drawFullscreen(gl);
  }
}
