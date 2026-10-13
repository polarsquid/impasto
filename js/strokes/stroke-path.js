// =============================================================================
// stroke-path.js
// -----------------------------------------------------------------------------
// Turns a path (a series of points from the mouse, or from a generator) into
// evenly spaced dabs.
//
// Why not just put one dab at every mouse position? Because mouse events
// arrive at irregular intervals: move fast and the points are far apart (gaps
// in the stroke), move slowly and they bunch up. So instead we walk along the
// path and drop a dab every `spacing` pixels, no matter how the points
// arrived.
//
// Each dab also gets:
//   - an angle: which way the brush is travelling (bristle grooves follow it)
//   - a paint load: starts at 1 and decays as the brush travels, so long
//     strokes thin out and break up as the brush runs dry
//   - the distance travelled so far, so the shader can vary things along
//     the stroke (like the ragged edges)
// =============================================================================

// Every dab is stored as 5 numbers in a row: x, y, angle, load, travelled.
// Other files import this constant instead of hard-coding the 5.
export const FLOATS_PER_DAB = 5;

export class StrokePath {
  /**
   * @param {Object} brush  needs .radius (px) and .loadLength (px)
   */
  constructor(brush) {
    this.brush = brush;
    // Dab spacing: 10% of the radius. Closer = smoother but more work.
    this.spacing = Math.max(1, brush.radius * 0.1);
    this.last = null;        // previous point {x, y}
    this.angle = null;       // smoothed travel direction, radians
    this.travelled = 0;      // total distance along the stroke, px
    this.untilNextDab = 0;   // distance left before the next dab is due
    this.dabCount = 0;
  }

  /** Start the stroke at a point. */
  begin(x, y) {
    this.last = { x, y };
  }

  /**
   * Extend the stroke to a new point.
   * @returns {Float32Array} the new dabs (FLOATS_PER_DAB floats each), possibly empty
   */
  addPoint(x, y) {
    const out = [];
    const dx = x - this.last.x;
    const dy = y - this.last.y;
    const segLength = Math.hypot(dx, dy);
    if (segLength < 0.5) return new Float32Array(0);  // ignore tiny jitters

    // Smooth the direction. Raw mouse movement is jittery, and the bristle
    // grooves would wobble with it. Blending 35% toward each new direction
    // gives a steady angle that still follows curves.
    const segAngle = Math.atan2(dy, dx);
    this.angle = (this.angle === null) ? segAngle : lerpAngle(this.angle, segAngle, 0.35);

    // Walk along this segment, dropping a dab every `spacing` pixels.
    let walked = this.untilNextDab;
    while (walked <= segLength) {
      const t = walked / segLength;          // 0..1 along the segment
      const load = Math.exp(-(this.travelled + walked) / this.brush.loadLength);
      out.push(this.last.x + dx * t, this.last.y + dy * t, this.angle, load,
               this.travelled + walked);
      walked += this.spacing;
    }
    // Remember how far into the NEXT segment the next dab should land.
    this.untilNextDab = walked - segLength;
    this.travelled += segLength;
    this.last = { x, y };
    this.dabCount += out.length / FLOATS_PER_DAB;
    return new Float32Array(out);
  }

  /** For a click without dragging: a single dab where the brush touched. */
  singleDab() {
    this.dabCount = 1;
    return new Float32Array([this.last.x, this.last.y, this.angle ?? 0, 1, 0]);
  }
}

/**
 * Blend between two angles along the SHORTEST way round the circle.
 * (A naive blend from 350 degrees to 10 degrees would go the long way, via 180.)
 */
function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return a + diff * t;
}
