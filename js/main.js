// =============================================================================
// main.js
// -----------------------------------------------------------------------------
// The entry point, loaded by index.html as an ES module. It's the "shell"
// that every build phase runs inside:
//
//   1. loads the shaders and sets up WebGL,
//   2. creates the shared pieces: lighting pass, settings, panel sections,
//      hand brush,
//   3. builds the tab bar, one tab per phase,
//   4. runs the render loop, which draws whichever tab is showing.
//
// The phases themselves live in js/phases/. Each tab is CUMULATIVE: a later
// phase shows everything the earlier ones did, plus its own new features,
// all on the same shared engine. Adding a phase means writing
// js/phases/phaseN-....js and adding it to the PHASES list below.
//
// The canvas can be portrait or landscape (same size, turned 90 degrees).
// Switching resizes every tab's surface and asks each tab to repaint.
// =============================================================================

import { createContext, loadShaderSources } from './renderer/gl-utils.js';
import { PaintSurface } from './renderer/surface.js';
import { LightingPass } from './renderer/lighting.js';
import { attachPointerBrush } from './strokes/pointer-brush.js';
import { hexToRgb } from './color/pigment.js';
import { buildSharedSections } from './ui/shared-sections.js';
import { createTabs } from './ui/tabs.js';
import { TextPainter } from './text/text-painter.js';
import { initTooltips, resetInPlace } from './ui/controls.js';
import { brushPhase } from './phases/phase1-brush.js';
import { generatorPhase } from './phases/phase2-generator.js';
import { textPhase } from './phases/phase3-text.js';

// Every phase, in order. The tab bar is built from this list.
const PHASES = [brushPhase, generatorPhase, textPhase];

// Surface resolution in pixels, for each orientation: 4:5 portrait, or the
// same canvas turned on its side. The canvas is displayed scaled to fit the
// window, but everything is painted at this size.
const SURFACE_SIZES = {
  portrait:  { width: 1080, height: 1350 },
  landscape: { width: 1350, height: 1080 },
};
const DEFAULT_ORIENTATION = 'portrait';

// Every shader file the app uses (files they #include are found automatically).
const SHADER_FILES = [
  'fullscreen.vert', 'dab.vert', 'dab.frag', 'composite.frag', 'copy.frag', 'lighting.frag',
  'text.frag',
];

// --- Shared settings ------------------------------------------------------------
// One set for the whole app: the light, canvas and brush are the same in
// every tab. These objects are edited directly by the sliders.
//
// The defaults are FUNCTIONS that return a fresh object each time, so
// "Reset all settings" can get a clean copy to reset from.

const DEFAULT_GROUND = '#d8cfbd';
const DEFAULT_BRUSH_COLOR = '#1f3a68';

/** Everything the lighting pass needs: the light itself plus the canvas. */
function defaultLight() {
  return {
    ground: hexToRgb(DEFAULT_GROUND),  // canvas colour (sRGB 0..1)
    azimuth: 315,     // light from the top left (degrees, 0 = top)
    elevation: 32,    // fairly low, raking light shows off the relief
    ambient: 0.32,
    depth: 7,         // pixels of height per unit of paint
    specular: 0.35,
    shininess: 40,
    shadow: 0.85,
    occlusion: 0.6,
    weave: 0.15,
    weaveScale: 5,
    viewMode: 0,
  };
}

/**
 * The brush. The "character" settings (tip to pickup) are shared with the
 * generator; size, thickness, load and colour are for the hand brush only.
 */
function defaultBrush() {
  return {
    radius: 30,        // px
    thickness: 1.0,    // paint units
    loadLength: 500,   // px of travel before the paint is mostly used up
    color: hexToRgb(DEFAULT_BRUSH_COLOR),
    tipShape: 2.2,     // 1 = round tip, higher = flatter brush with squarer ends
    edgeWobble: 0.5,   // how ragged the stroke edges are
    bristles: 14,      // grooves across the brush
    groove: 0.45,      // groove depth 0..1
    ridge: 0.35,       // edge ridge height
    flatten: 0.55,     // how much the brush squashes paint under it
    pickup: 0.35,      // how much wet paint underneath mixes into the brush
  };
}

const settings = {
  defaultGround: DEFAULT_GROUND,
  defaultBrushColor: DEFAULT_BRUSH_COLOR,
  light: defaultLight(),
  brush: defaultBrush(),
};

// --- Start up ----------------------------------------------------------------------

const canvas = document.getElementById('painting');
const statusEl = document.getElementById('status');

async function start() {
  const startSize = SURFACE_SIZES[DEFAULT_ORIENTATION];
  canvas.width = startSize.width;
  canvas.height = startSize.height;
  const gl = createContext(canvas);
  const shaders = await loadShaderSources(SHADER_FILES);
  const lighting = new LightingPass(gl, shaders);

  // --- The app context ------------------------------------------------------------
  // One object handed to every phase and shared section, so they can reach
  // the engine without importing main.js (which would be a circular import).
  let activePhase = null;
  let needsRender = true;

  const app = {
    settings,
    orientation: DEFAULT_ORIENTATION,   // 'portrait' or 'landscape'
    width: startSize.width,             // current surface size in pixels
    height: startSize.height,
    orbiting: false,     // set by the "Orbit the light" checkbox
    lightPad: null,      // set when the light section is built

    /** A new, blank painting surface (each tab makes its own). */
    createSurface: () => new PaintSurface(gl, shaders, app.width, app.height),

    /** Something that paints knife lettering onto a surface (phase 3). */
    createTextPainter: () => new TextPainter(gl, shaders),

    /**
     * Turn the canvas between 'portrait' and 'landscape'. Every tab that's
     * been opened gets its surface resized (which wipes it) and is asked to
     * repaint itself at the new shape with its resize() hook. Tabs not yet
     * opened simply start at the new size when they are.
     */
    setOrientation(name) {
      if (name === app.orientation || !SURFACE_SIZES[name]) return;
      app.orientation = name;
      ({ width: app.width, height: app.height } = SURFACE_SIZES[name]);
      // Changing a canvas's size also clears it; the render below redraws it.
      canvas.width = app.width;
      canvas.height = app.height;
      for (const phase of PHASES) {
        if (!phase.initialized) continue;
        phase.surface.resize(app.width, app.height);
        phase.resize?.(app);
      }
      refreshShared();
      needsRender = true;
    },

    /** Ask for the screen to be redrawn on the next frame. */
    requestRender: () => { needsRender = true; },

    /** A shared setting changed: redraw, and tell the active phase. */
    notify(kind) {
      needsRender = true;
      activePhase?.notify?.(kind);
    },

    /**
     * Put every setting in every tab back to its default. Shared settings
     * are reset here; each phase resets its own (and the generator then
     * repaints with them).
     */
    resetAllSettings() {
      app.setOrientation(DEFAULT_ORIENTATION);
      resetInPlace(settings.light, defaultLight());
      resetInPlace(settings.brush, defaultBrush());
      app.orbiting = false;
      refreshShared();
      for (const phase of PHASES) {
        if (phase.initialized) phase.reset?.(app);
      }
      needsRender = true;
    },

    clearPainting() {
      activePhase?.surface.clear();
      needsRender = true;
    },

    savePng() {
      // Draw a fresh frame first. The canvas keeps its image afterwards
      // (preserveDrawingBuffer), so we can turn it straight into a file.
      lighting.render(activePhase.surface.display, app.width, app.height, settings.light);
      canvas.toBlob((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `impasto-${activePhase.id}-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      }, 'image/png');
    },
  };

  // --- Panel ---------------------------------------------------------------------------
  const { sections: shared, refresh: refreshShared } = buildSharedSections(app);
  const panelBody = document.getElementById('phase-panel');
  const introEl = document.getElementById('phase-intro');

  /** Show a phase: build it if it's new, then swap its sections in. */
  function activate(phase) {
    if (!phase.initialized) {
      phase.init(app);
      phase.initialized = true;
    }
    activePhase?.leave?.(app);
    activePhase = phase;

    // Look up each name in the layout: the phase's own section first,
    // otherwise a shared one. replaceChildren MOVES the shared sections
    // here from the previous tab's panel.
    panelBody.replaceChildren(...phase.layout.map((name) => phase.sections?.[name] ?? shared[name]));
    initTooltips(panelBody);
    introEl.textContent = phase.intro;
    document.title = `Impasto: ${phase.title}`;

    phase.enter?.(app);
    needsRender = true;
  }

  createTabs(document.getElementById('phase-tabs'), PHASES, 'phase-panel', activate)
    .select(location.hash.slice(1));

  // --- Painting by hand --------------------------------------------------------------
  // A phase can refuse hand painting for a moment (the generator does while
  // it's still painting) by returning null from handPaintSurface().
  attachPointerBrush(canvas, {
    getSurface: () => (activePhase.handPaintSurface ? activePhase.handPaintSurface() : activePhase.surface),
    getBrush: () => settings.brush,
    onChange: app.requestRender,
  });

  // --- Render loop -----------------------------------------------------------------------
  // Rather than redrawing 60 times a second forever, we only redraw when
  // something changed (needsRender). The exception is "orbit the light",
  // which changes every frame while it's on.
  let lastTime = performance.now();
  function frame(now) {
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    if (app.orbiting) {
      settings.light.azimuth = (settings.light.azimuth + dt * 30) % 360;  // 30 degrees a second
      app.lightPad.refresh();
      needsRender = true;
    }
    if (needsRender && activePhase) {
      lighting.render(activePhase.surface.display, app.width, app.height, settings.light);
      needsRender = false;
    }
    requestAnimationFrame(frame);
  }

  statusEl.hidden = true;
  requestAnimationFrame(frame);
}

start().catch((error) => {
  // If anything fails (no WebGL2, shader typo, opened from file://), say what
  // happened right on the page rather than failing silently.
  console.error(error);
  statusEl.hidden = false;
  statusEl.textContent = window.location.protocol === 'file:'
    ? 'This page needs to be served over http. Run "npx serve" in the project folder and open the address it prints.'
    : `Couldn't start the painter: ${error.message}`;
});
