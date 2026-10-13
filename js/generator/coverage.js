// =============================================================================
// coverage.js
// -----------------------------------------------------------------------------
// Keeps track of which parts of the canvas a layer has covered, WHILE the
// generator is still planning. That's what lets a layer's "Amount" mean
// "cover this fraction of the canvas": the composer keeps adding strokes
// until the grid says it's covered enough, and at Amount 1 it hunts down
// every remaining gap and drops a stroke on it.
//
// The canvas is divided into small square cells (a few pixels each). When a
// stroke is planned, we "stamp" the cells it will DEFINITELY cover, i.e. we
// are deliberately cautious:
//   - only the solid part of the stroke counts, before the brush starts to
//     run dry and break up (see DRY_START in shaders/dab.frag)
//   - only a slightly narrower band than the full brush width, since stroke
//     edges are ragged
//   - not the very ends, which are rounded/tapered
// Being cautious means the real painting covers at least as much as the
// grid thinks, so "covered" in the grid really means covered on screen.
// =============================================================================

/**
 * Paint stays solid while the brush's load is above this (must match
 * DRY_START in shaders/dab.frag). Load decays as exp(-travelled / loadLength),
 * so the solid part of a stroke is loadLength * ln(1 / SOLID_LOAD) long.
 */
export const SOLID_LOAD = 0.6;

export class CoverageGrid {
  /**
   * @param {number} width, height  canvas size in pixels
   * @param {number} cellSize       cell size in pixels (smaller = more exact)
   */
  constructor(width, height, cellSize) {
    this.cell = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.cells = new Uint8Array(this.cols * this.rows);  // 0 = bare, 1 = covered
    this.coveredCount = 0;
    this.gaps = [];   // a shuffled list of bare cells, used by nextGap()
  }

  /** Fraction of the canvas covered, 0..1. */
  get fraction() {
    return this.coveredCount / this.cells.length;
  }

  /** True when there are no bare cells left. */
  get complete() {
    return this.coveredCount === this.cells.length;
  }

  /**
   * Mark the cells a planned stroke will definitely cover.
   * @param {Float32Array} points  the stroke path: x0, y0, x1, y1, ...
   * @param {Object} brush         needs radius, loadLength, edgeWobble
   */
  stampStroke(points, brush) {
    // Half-width we're sure of: trimmed by up to 30% where edges wobble.
    const r = brush.radius * (0.85 - 0.3 * brush.edgeWobble);
    const solidLength = brush.loadLength * Math.log(1 / SOLID_LOAD);

    // Total path length, to know where the stroke ends.
    let pathLength = 0;
    for (let i = 2; i < points.length; i += 2) {
      pathLength += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
    }

    // Stamp discs of radius r along the path, every half-radius, between
    // r from the start and r before the end of the solid part. A disc there
    // sits entirely inside the band of paint.
    const from = r;
    const to = Math.min(solidLength, pathLength) - r;
    if (to < from) {
      // A stroke too short for that: stamp one small disc at its middle.
      const mid = Math.floor(points.length / 4) * 2;
      this.#stampDisc(points[mid], points[mid + 1], r * 0.5);
      return;
    }

    let travelled = 0;
    let nextStamp = from;
    for (let i = 2; i < points.length && nextStamp <= to; i += 2) {
      const x0 = points[i - 2], y0 = points[i - 1];
      const segment = Math.hypot(points[i] - x0, points[i + 1] - y0);
      // Drop stamps at every multiple of r/2 that falls on this segment.
      while (nextStamp <= travelled + segment && nextStamp <= to) {
        const t = segment > 0 ? (nextStamp - travelled) / segment : 0;
        this.#stampDisc(x0 + (points[i] - x0) * t, y0 + (points[i + 1] - y0) * t, r);
        nextStamp += r * 0.5;
      }
      travelled += segment;
    }
  }

  /**
   * The centre (in pixels) of a bare cell, chosen at random, or null if the
   * canvas is fully covered. Used to aim gap-filling strokes.
   */
  nextGap(rand) {
    // Work through a shuffled list of bare cells; cells covered since the
    // list was made are skipped. When the list runs out, make a fresh one.
    for (let attempt = 0; attempt < 2; attempt++) {
      while (this.gaps.length) {
        const index = this.gaps.pop();
        if (!this.cells[index]) {
          return {
            x: (index % this.cols + 0.5) * this.cell,
            y: (Math.floor(index / this.cols) + 0.5) * this.cell,
            index,
          };
        }
      }
      for (let i = 0; i < this.cells.length; i++) if (!this.cells[i]) this.gaps.push(i);
      for (let i = this.gaps.length - 1; i > 0; i--) {   // shuffle (Fisher-Yates)
        const j = Math.floor(rand() * (i + 1));
        [this.gaps[i], this.gaps[j]] = [this.gaps[j], this.gaps[i]];
      }
    }
    return null;
  }

  /**
   * Give up on one cell: count it as covered. A safety valve for the rare
   * cell that strokes keep curving around, so planning always finishes.
   */
  forceCover(index) {
    if (!this.cells[index]) { this.cells[index] = 1; this.coveredCount++; }
  }

  /** Mark every cell whose centre lies inside a circle. */
  #stampDisc(cx, cy, radius) {
    const c = this.cell;
    const minCol = Math.max(0, Math.floor((cx - radius) / c));
    const maxCol = Math.min(this.cols - 1, Math.floor((cx + radius) / c));
    const minRow = Math.max(0, Math.floor((cy - radius) / c));
    const maxRow = Math.min(this.rows - 1, Math.floor((cy + radius) / c));
    const r2 = radius * radius;
    for (let row = minRow; row <= maxRow; row++) {
      const dy = (row + 0.5) * c - cy;
      for (let col = minCol; col <= maxCol; col++) {
        const dx = (col + 0.5) * c - cx;
        if (dx * dx + dy * dy > r2) continue;
        const i = row * this.cols + col;
        if (!this.cells[i]) { this.cells[i] = 1; this.coveredCount++; }
      }
    }
  }
}
