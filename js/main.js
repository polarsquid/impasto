// =============================================================================
// main.js
// -----------------------------------------------------------------------------
// The entry point. Loaded by index.html as an ES module. It:
//   1. loads the shaders and sets up WebGL,
//   2. creates the paint surface and the lighting pass,
//   3. builds the control panel,
//   4. paints a test composition,
//   5. redraws the screen whenever something changes.
//
// PHASE 1 SCOPE: the lit height field + a test brush. The real procedural
// background generator (phase 2), palette-knife text (phase 3) and presets
// (phase 4) plug into this same structure later.
// =============================================================================

import { createContext, loadShaderSources } from './renderer/gl-utils.js';
import { PaintSurface } from './renderer/surface.js';
import { LightingPass } from './renderer/lighting.js';
import { attachPointerBrush } from './strokes/pointer-brush.js';
import { paintTestComposition, hexToRgb } from './strokes/test-strokes.js';
import { createLightPad } from './ui/light-pad.js';
import { buildSliders, initTooltips } from './ui/controls.js';

// --- Settings ----------------------------------------------------------------

// Surface resolution in pixels. 4:5 portrait. The canvas is displayed scaled
// to fit the window, but everything is painted at this size.
const SURFACE_WIDTH = 1080;
const SURFACE_HEIGHT = 1350;

// Canvas colours to pick from: traditional grounds painters prime with.
// A dark or coloured ground changes the mood of everything painted over it,
// because it peeks through wherever the paint is thin.
const GROUND_SWATCHES = [
  { name: 'White gesso',   hex: '#ebe6da' },
  { name: 'Primed linen',  hex: '#d8cfbd' },
  { name: 'Raw linen',     hex: '#b9a582' },
  { name: 'Warm grey',     hex: '#8b847a' },
  { name: 'Red ochre',     hex: '#8a4a33' },
  { name: 'Black gesso',   hex: '#232120' },
];
const DEFAULT_GROUND = '#d8cfbd';

// Everything the lighting pass needs: the light itself plus the canvas.
// These objects are edited directly by the sliders.
const light = {
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

// The test brush you paint with by hand.
const brush = {
  radius: 30,        // px
  thickness: 1.0,    // paint units
  bristles: 14,      // grooves across the brush
  tipShape: 2.2,     // 1 = round tip, higher = flatter brush with squarer ends
  edgeWobble: 0.5,   // how ragged the stroke edges are
  groove: 0.45,      // groove depth 0..1
  ridge: 0.35,       // edge ridge height
  loadLength: 500,   // px of travel before the paint is mostly used up
  flatten: 0.55,     // how much the brush squashes paint under it
  pickup: 0.35,      // how much wet paint underneath tints the brush
  color: hexToRgb('#1f3a68'),
};

// --- Start up ----------------------------------------------------------------

const canvas = document.getElementById('painting');
const statusEl = document.getElementById('status');

async function start() {
  canvas.width = SURFACE_WIDTH;
  canvas.height = SURFACE_HEIGHT;
  const gl = createContext(canvas);

  const shaders = await loadShaderSources([
    'fullscreen.vert', 'dab.vert', 'dab.frag', 'composite.frag', 'lighting.frag',
  ]);

  const surface = new PaintSurface(gl, shaders, SURFACE_WIDTH, SURFACE_HEIGHT);
  const lighting = new LightingPass(gl, shaders);

  // --- Rendering on demand -----------------------------------------------------
  // Rather than redrawing 60 times a second forever, we only redraw when
  // something changed (requestRender sets a flag). The one exception is the
  // "orbit light" animation, which changes every frame while it's on.
  let needsRender = true;
  let orbiting = false;
  let lastTime = performance.now();
  const requestRender = () => { needsRender = true; };

  function frame(now) {
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    if (orbiting) {
      light.azimuth = (light.azimuth + dt * 30) % 360;  // 30 degrees per second
      lightPad.refresh();
      needsRender = true;
    }
    if (needsRender) {
      lighting.render(surface.display, SURFACE_WIDTH, SURFACE_HEIGHT, light);
      needsRender = false;
    }
    requestAnimationFrame(frame);
  }

  // --- Panel ---------------------------------------------------------------------
  const lightPad = createLightPad(document.getElementById('light-pad'), light, requestRender);

  // Each "tip" becomes the hover tooltip for that slider.
  buildSliders(document.getElementById('light-controls'), light, [
    { key: 'depth', label: 'Paint depth', min: 0, max: 15, step: 0.1, digits: 1,
      tip: 'How tall the paint stands. Higher makes ridges and grooves deeper and shadows longer. 0 makes the paint look flat.' },
    { key: 'shadow', label: 'Shadows', min: 0, max: 1, step: 0.01,
      tip: 'How dark the shadows are that ridges cast onto the paint beside them.' },
    { key: 'specular', label: 'Sheen', min: 0, max: 1.5, step: 0.01,
      tip: 'Brightness of the glossy highlights where light glints off wet oil paint. Bare canvas stays matte.' },
    { key: 'shininess', label: 'Sheen sharpness', min: 4, max: 200, step: 1, digits: 0,
      tip: 'Low gives broad, soft highlights like satin. High gives small, sharp glints like fresh glossy paint.' },
    { key: 'ambient', label: 'Ambient light', min: 0, max: 1, step: 0.01,
      tip: 'Light that comes from everywhere at once. Lower makes shadows and dark colours deeper; higher flattens everything.' },
    { key: 'occlusion', label: 'Crevice darkening', min: 0, max: 2, step: 0.01,
      tip: 'Darkens the deep gaps between ridges of paint, where surrounding light struggles to reach.' },
  ], requestRender);

  buildSliders(document.getElementById('canvas-controls'), light, [
    { key: 'weave', label: 'Weave depth', min: 0, max: 0.6, step: 0.01,
      tip: "How strongly the canvas's woven texture shows. It only shows through thin paint; thick paint buries it." },
    { key: 'weaveScale', label: 'Thread size', min: 2, max: 12, step: 0.5, digits: 1,
      tip: 'Spacing of the canvas threads, in pixels. Small is fine linen; large is coarse burlap.' },
  ], requestRender);

  buildSliders(document.getElementById('brush-controls'), brush, [
    { key: 'radius', label: 'Size', min: 4, max: 90, step: 1, digits: 0,
      tip: 'Half the width of the brush, in pixels.' },
    { key: 'thickness', label: 'Paint thickness', min: 0.1, max: 3, step: 0.05,
      tip: 'How much paint the brush lays down, and so how high each stroke stands above the canvas.' },
    { key: 'loadLength', label: 'Paint load', min: 60, max: 2000, step: 10, digits: 0,
      tip: 'How far the brush travels (in pixels) before running dry. A small load breaks into scratchy bristle marks quickly.' },
    { key: 'tipShape', label: 'Tip flatness', min: 1, max: 4, step: 0.1, digits: 1,
      tip: '1 is a round brush with rounded stroke ends. Higher is a flat brush with squarer ends.' },
    { key: 'edgeWobble', label: 'Ragged edges', min: 0, max: 1, step: 0.01,
      tip: 'How uneven the edges of a stroke are. 0 gives clean, straight edges.' },
    { key: 'bristles', label: 'Bristles', min: 2, max: 40, step: 1, digits: 0,
      tip: 'How many bristle grooves run along each stroke. Few gives coarse hog-hair streaks; many gives fine, soft-hair texture.' },
    { key: 'groove', label: 'Groove depth', min: 0, max: 1, step: 0.01,
      tip: 'How deeply the bristle grooves cut into the paint.' },
    { key: 'ridge', label: 'Edge ridges', min: 0, max: 1.5, step: 0.01,
      tip: 'Height of the little walls of paint the brush pushes up along both edges of a stroke.' },
    { key: 'flatten', label: 'Pressure on paint below', min: 0, max: 1, step: 0.01,
      tip: 'How much the brush squashes the paint already on the canvas as it passes over it.' },
    { key: 'pickup', label: 'Wet pickup', min: 0, max: 1, step: 0.01,
      tip: 'How much wet paint already on the canvas gets dragged into a new stroke, showing as streaks of the old colour.' },
  ], () => {});

  // --- Canvas colour ------------------------------------------------------------
  // A row of swatch buttons plus a custom colour picker. aria-pressed marks
  // the chosen swatch, for both the styling and screen readers.
  const swatchRow = document.getElementById('ground-swatches');
  const groundPicker = document.getElementById('ground-color');
  groundPicker.value = DEFAULT_GROUND;

  function setGround(hex) {
    light.ground = hexToRgb(hex);
    groundPicker.value = hex;
    for (const b of swatchRow.querySelectorAll('.swatch')) {
      b.setAttribute('aria-pressed', String(b.dataset.hex === hex));
    }
    requestRender();  // no repainting needed: the lighting pass mixes it in
  }

  for (const { name, hex } of GROUND_SWATCHES) {
    const button = document.createElement('button');
    button.className = 'swatch';
    button.type = 'button';
    button.dataset.hex = hex;
    button.style.setProperty('--swatch', hex);
    button.setAttribute('aria-label', name);
    button.addEventListener('click', () => setGround(hex));
    swatchRow.insertBefore(button, groundPicker);  // swatches first, picker last
  }
  groundPicker.addEventListener('input', () => setGround(groundPicker.value));
  setGround(DEFAULT_GROUND);

  const colorInput = document.getElementById('brush-color');
  colorInput.addEventListener('input', () => { brush.color = hexToRgb(colorInput.value); });

  document.getElementById('view-mode').addEventListener('change', (e) => {
    light.viewMode = parseInt(e.target.value, 10);
    requestRender();
  });

  document.getElementById('orbit').addEventListener('change', (e) => {
    orbiting = e.target.checked;
  });

  // "Clear canvas" back to bare primed canvas.
  document.getElementById('clear').addEventListener('click', () => {
    surface.clear();
    requestRender();
  });

  // "New test painting": a different random seed each time.
  document.getElementById('test-paint').addEventListener('click', () => {
    surface.clear();
    paintTestComposition(surface, brush, Math.floor(Math.random() * 1e6));
    requestRender();
  });

  // "Save PNG": the canvas keeps its image (preserveDrawingBuffer), so we can
  // turn it straight into a file.
  document.getElementById('save').addEventListener('click', () => {
    lighting.render(surface.display, SURFACE_WIDTH, SURFACE_HEIGHT, light);
    canvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `impasto-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  });

  // All controls exist now, so give everything with data-tip its tooltip.
  initTooltips();

  // --- Painting by hand --------------------------------------------------------
  attachPointerBrush(canvas, surface, { getBrush: () => brush, onChange: requestRender });

  // --- First painting ----------------------------------------------------------
  surface.clear();
  paintTestComposition(surface, brush, 7);
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
