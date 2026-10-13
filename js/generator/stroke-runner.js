// =============================================================================
// stroke-runner.js
// -----------------------------------------------------------------------------
// Paints a planned list of strokes (from composer.js) onto a surface.
//
// Two speeds:
//   instant   - paint everything right away, in one go
//   watch     - paint a batch of strokes each animation frame, so you can
//               see the painting build up layer by layer
//
// "Watch" mode uses a time budget rather than a fixed number of strokes per
// frame: keep painting until ~10ms of the frame are used, then hand control
// back to the browser so the page stays smooth. A slow computer just takes
// more frames, without stuttering.
// =============================================================================

import { StrokePath, FLOATS_PER_DAB } from '../strokes/stroke-path.js';

/** Paint one planned stroke from start to finish. */
export function paintJob(surface, job) {
  const { brush, points } = job;
  const path = new StrokePath(brush);
  path.begin(points[0], points[1]);
  surface.beginStroke(brush);

  // Collect all of the stroke's dabs first, then hand them to the GPU in one
  // go: one draw call per stroke is much faster than one per point.
  const parts = [];
  let total = 0;
  for (let i = 2; i < points.length; i += 2) {
    const dabs = path.addPoint(points[i], points[i + 1]);
    if (dabs.length) { parts.push(dabs); total += dabs.length; }
  }
  const all = new Float32Array(total || FLOATS_PER_DAB);
  if (total) {
    let offset = 0;
    for (const p of parts) { all.set(p, offset); offset += p.length; }
  } else {
    all.set(path.singleDab());   // a stroke too short to move: one dab
  }
  surface.addDabs(all);
  surface.endStroke();
}

export class StrokeRunner {
  /**
   * @param {Object} hooks
   *   onProgress(done, total)  after each batch (e.g. to update a label)
   *   onFrame()                after each batch (e.g. to redraw)
   *   onDone(total)            when the last stroke is painted
   */
  constructor({ onProgress = () => {}, onFrame = () => {}, onDone = () => {} } = {}) {
    this.hooks = { onProgress, onFrame, onDone };
    this.frameId = null;
    this.paused = null;   // a run that was interrupted by pause()
  }

  /** True while a "watch" run is still painting. */
  get running() { return this.frameId !== null; }

  /**
   * Paint `jobs` onto `surface`. Cancels any run still in progress.
   * @param {boolean} watch  paint progressively instead of all at once
   */
  run(surface, jobs, watch) {
    this.cancel();
    if (!watch) {
      for (const job of jobs) paintJob(surface, job);
      this.hooks.onProgress(jobs.length, jobs.length);
      this.hooks.onFrame();
      this.hooks.onDone(jobs.length);
      return;
    }
    this.#loop({ surface, jobs, next: 0 });
  }

  /** Stop the current run where it is, but remember it for resume(). */
  pause() {
    if (this.frameId === null) return;
    cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }

  /** Carry on with a run that pause() stopped. */
  resume() {
    if (this.paused && this.frameId === null) this.#loop(this.paused);
  }

  /** Stop and forget the current run. */
  cancel() {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.paused = null;
  }

  #loop(state) {
    this.paused = state;
    const step = () => {
      const deadline = performance.now() + 10;   // ~10ms of painting per frame
      while (state.next < state.jobs.length && performance.now() < deadline) {
        paintJob(state.surface, state.jobs[state.next++]);
      }
      this.hooks.onProgress(state.next, state.jobs.length);
      this.hooks.onFrame();
      if (state.next < state.jobs.length) {
        this.frameId = requestAnimationFrame(step);
      } else {
        this.frameId = null;
        this.paused = null;
        this.hooks.onDone(state.jobs.length);
      }
    };
    this.frameId = requestAnimationFrame(step);
  }
}
