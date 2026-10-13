// =============================================================================
// flow-field.js
// -----------------------------------------------------------------------------
// A flow field gives every point on the canvas a direction. Strokes follow
// it, so the field decides the painting's overall gesture: calm horizontal
// bands, a sweeping diagonal, a whirlpool, and so on. It's like the grain
// in a piece of wood, which every stroke runs along.
//
// Each field type starts from a simple, regular pattern and then adds
// "chaos": simplex noise, a smooth random value that changes gradually
// across the canvas. A little chaos makes the regular pattern feel
// hand-made; a lot of it breaks the pattern up entirely.
// =============================================================================

export const FIELD_TYPES = [
  { value: 'sweep',     label: 'Sweep' },
  { value: 'waves',     label: 'Waves' },
  { value: 'swirl',     label: 'Swirl' },
  { value: 'radial',    label: 'Radial burst' },
  { value: 'turbulent', label: 'Turbulent' },
];

/**
 * Build a flow field function.
 *
 * @param {Object} s  field settings:
 *   type      one of FIELD_TYPES
 *   angle     main direction in degrees (0 = left to right, 90 = downward)
 *   scale     size of the field's features in pixels: the length of a wave,
 *             the size of the noise's lumps
 *   chaos     0..1, how much noise disturbs the pattern
 *   centerX, centerY  0..1, the centre point for swirl and radial
 * @param {number} width, height  canvas size in pixels
 * @param {(x: number, y: number) => number} noise2D  simplex noise, -1..1
 * @returns {(x: number, y: number) => number}  angle in radians at a point
 */
export function createFlowField(s, width, height, noise2D) {
  const base = s.angle * Math.PI / 180;
  const scale = Math.max(20, s.scale);
  const cx = s.centerX * width;
  const cy = s.centerY * height;

  // Smooth noise sampled at the field's scale. Two "octaves" (a big lump
  // pattern plus a smaller, fainter one) look more natural than one.
  const noise = (x, y) => noise2D(x / scale, y / scale) + 0.4 * noise2D(x / scale * 2.3 + 31, y / scale * 2.3 - 17);

  switch (s.type) {
    case 'waves': {
      // Bands across the main direction; the direction swings back and forth
      // as you move across the bands, giving parallel rolling waves.
      const px = -Math.sin(base);
      const py = Math.cos(base);
      return (x, y) => {
        const across = x * px + y * py;  // distance across the bands
        return base + Math.sin(across / scale * Math.PI * 2) * 0.8 + noise(x, y) * s.chaos * 1.5;
      };
    }
    case 'swirl':
      // At every point, go AROUND the centre (90 degrees off pointing at it),
      // with a slight inward drift so strokes spiral rather than circle.
      return (x, y) => Math.atan2(y - cy, x - cx) + Math.PI * 0.5 + 0.18 + noise(x, y) * s.chaos * 1.5;
    case 'radial':
      // Point directly away from the centre, like rays from a sun.
      return (x, y) => Math.atan2(y - cy, x - cx) + noise(x, y) * s.chaos * 1.5;
    case 'turbulent':
      // No underlying pattern, just noise; chaos makes it swirlier.
      return (x, y) => base + noise(x, y) * Math.PI * (0.8 + s.chaos * 1.2);
    case 'sweep':
    default:
      // One main direction, bent by noise.
      return (x, y) => base + noise(x, y) * s.chaos * 1.8;
  }
}
