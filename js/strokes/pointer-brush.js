// =============================================================================
// pointer-brush.js
// -----------------------------------------------------------------------------
// Lets you paint on the canvas with a mouse, finger or pen.
//
// We use Pointer Events, which treat all three input types the same way.
// Two details worth knowing:
//
//   setPointerCapture  keeps sending us move events even if the pointer
//                      leaves the canvas mid-stroke, so strokes don't get
//                      stuck "on" when you drag past the edge.
//
//   getCoalescedEvents The browser usually reports pointer movement once per
//                      frame (~60 times a second), but the hardware may have
//                      sampled many more positions in between. Coalesced
//                      events give us all of them, so fast curved strokes
//                      come out smooth instead of as straight segments.
// =============================================================================

import { StrokePath } from './stroke-path.js';

/**
 * @param {HTMLCanvasElement} canvas
 * @param {Object} hooks
 *   getSurface()  returns the PaintSurface to paint on. A function rather
 *                 than a fixed surface, because each tab has its own painting
 *                 and the brush should paint on whichever one is showing.
 *   getBrush()    returns the current brush settings
 *   onChange()    called whenever the painting changed (to redraw)
 */
export function attachPointerBrush(canvas, { getSurface, getBrush, onChange }) {
  let path = null;
  let surface = null;   // the surface the current stroke is being painted on

  // The canvas is drawn at its surface resolution (e.g. 1080 x 1350) but
  // shown scaled by CSS to fit the window. Convert the pointer's on-screen
  // position into surface pixels.
  function toSurface(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width * surface.width,
      y: (event.clientY - rect.top) / rect.height * surface.height,
    };
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;          // left button / touch / pen tip only
    surface = getSurface();
    if (!surface) return;
    canvas.setPointerCapture(event.pointerId);

    // Copy the brush settings and give this stroke its own random seed, so
    // no two strokes have identical bristle patterns.
    const brush = { ...getBrush(), seed: Math.random() * 1000 };
    path = new StrokePath(brush);
    const p = toSurface(event);
    path.begin(p.x, p.y);
    surface.beginStroke(brush);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!path) return;
    const events = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
    const batches = [];
    let total = 0;
    for (const e of (events.length ? events : [event])) {
      const p = toSurface(e);
      const dabs = path.addPoint(p.x, p.y);
      if (dabs.length) { batches.push(dabs); total += dabs.length; }
    }
    if (!total) return;

    // Join all batches into one array so the GPU gets a single draw call.
    const all = new Float32Array(total);
    let offset = 0;
    for (const b of batches) { all.set(b, offset); offset += b.length; }
    surface.addDabs(all);
    onChange();
  });

  function finish() {
    if (!path) return;
    if (path.dabCount === 0) surface.addDabs(path.singleDab());  // a click = one dab
    surface.endStroke();
    path = null;
    onChange();
  }
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
}
