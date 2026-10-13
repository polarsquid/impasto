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
// "Watch" mode paints at a steady pace: a fixed number of strokes per frame,
// chosen so a whole painting takes about WATCH_SECONDS. (Sending a stroke to
// the GPU takes JavaScript almost no time, so without a fixed pace a fast
// computer would finish the whole painting in a frame or two and there'd be
// nothing to watch.) There's also a time budget per frame as a safety
// limit: on a slow computer, a frame stops early rather than stuttering,
// and the painting simply takes longer.
// =============================================================================

import { StrokePath, FLOATS_PER_DAB } from '../strokes/stroke-path.js';

/** Roughly how long "watch it paint" takes for a whole painting. */
const WATCH_SECONDS = 4;

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
    // Strokes per frame, assuming ~60 frames a second.
    const perFrame = Math.max(1, Math.ceil(state.jobs.length / (WATCH_SECONDS * 60)));
    const step = () => {
      const deadline = performance.now() + 12;   // safety limit: 12ms per frame
      const stop = Math.min(state.jobs.length, state.next + perFrame);
      while (state.next < stop && performance.now() < deadline) {
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
