// =============================================================================
// phase1-brush.js  -  Phase 1: brush and light
// -----------------------------------------------------------------------------
// The first build phase: a lit height field you can paint on by hand, with
// a quick test composition to light.
//
// HOW PHASES WORK (this file is the simplest example)
// Each phase is a plain object that main.js knows how to show in a tab:
//
//   id, number, title  - for the tab and the page address (#brush)
//   intro              - one line shown under the tabs
//   layout             - which panel sections to show, in order. Names are
//                        either this phase's own sections (built in init) or
//                        shared ones: 'light', 'canvas', 'character',
//                        'brush', 'view'
//   init(app)          - runs once, the first time the tab is opened
//   enter(app) / leave(app) / notify(kind) - optional hooks
//   surface            - this tab's own painting
//
// Everything that does real work lives in the shared engine (js/renderer,
// js/strokes, ...), so improving the engine improves every tab.
// =============================================================================

import { paintTestComposition } from '../strokes/test-strokes.js';
import { createSection, createButton, createActions } from '../ui/controls.js';

export const brushPhase = {
  id: 'brush',
  number: 1,
  title: 'Brush and light',
  intro: 'Drag on the painting to lay down paint. Move the lamp to see the relief.',
  layout: ['test', 'light', 'canvas', 'character', 'brush', 'view'],

  init(app) {
    this.surface = app.createSurface();
    paintTestComposition(this.surface, app.settings.brush, 7);

    const test = createSection('Test painting');
    test.appendChild(createActions(
      createButton('New test painting', () => {
        this.surface.clear();
        paintTestComposition(this.surface, app.settings.brush, Math.floor(Math.random() * 1e6));
        app.requestRender();
      }, { primary: true, tip: 'Clears the canvas and paints a fresh random composition, using the current paint character.' }),
    ));
    this.sections = { test };
  },
};
