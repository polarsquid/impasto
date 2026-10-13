// =============================================================================
// shared-sections.js
// -----------------------------------------------------------------------------
// Panel sections that every phase tab uses: light, canvas, paint character,
// hand brush and view. Each is built ONCE. When you switch tabs, main.js
// moves these same elements into the new tab's panel (appendChild moves an
// element rather than copying it). So there's one light pad, one set of
// sliders, and they can never fall out of sync between tabs.
//
// The settings they edit live in app.settings (see main.js). When something
// changes they call app.notify(kind) with one of:
//   'light' | 'canvas' | 'character' | 'brush' | 'view'
// so the active phase can react (the generator repaints on 'character').
// =============================================================================

import { hexToRgb } from '../color/pigment.js';
import { createLightPad } from './light-pad.js';
import {
  createSection, buildSliders, createSelect, createCheckbox, createButton, createActions,
} from './controls.js';

// Canvas colours to pick from: traditional grounds painters prime with.
// A dark or coloured ground changes the mood of everything painted over it,
// because it peeks through wherever the paint is thin.
export const GROUND_SWATCHES = [
  { name: 'White gesso',  hex: '#ebe6da' },
  { name: 'Primed linen', hex: '#d8cfbd' },
  { name: 'Raw linen',    hex: '#b9a582' },
  { name: 'Warm grey',    hex: '#8b847a' },
  { name: 'Red ochre',    hex: '#8a4a33' },
  { name: 'Black gesso',  hex: '#232120' },
];

/**
 * Build all shared sections.
 * @param {Object} app  the app context from main.js
 * @returns {{ sections: Object<string, HTMLElement>, lightPad }}
 */
export function buildSharedSections(app) {
  const { light, brush } = app.settings;
  return {
    sections: {
      light:     buildLightSection(app, light),
      canvas:    buildCanvasSection(app, light),
      character: buildCharacterSection(app, brush),
      brush:     buildBrushSection(app, brush),
      view:      buildViewSection(app, light),
    },
  };
}

// --- Light ----------------------------------------------------------------------

function buildLightSection(app, light) {
  const section = createSection('Light');
  const changed = () => app.notify('light');

  // The pad lives in a wrapper that carries the tooltip; the pad adds its
  // text readout right after itself, inside the same wrapper.
  const wrap = document.createElement('div');
  wrap.className = 'light-pad-wrap';
  wrap.dataset.tip = 'Drag the lamp to move the light. Near the centre, light falls from overhead and the paint looks flatter. Near the rim, light skims across the surface and every ridge throws a shadow.';
  const pad = document.createElement('div');
  pad.className = 'light-pad';
  wrap.appendChild(pad);
  section.appendChild(wrap);
  app.lightPad = createLightPad(pad, light, changed);

  const orbit = createCheckbox('Orbit the light', false, (on) => { app.orbiting = on; },
    'Slowly circles the light around the painting, so you can see the relief from every side.');
  section.appendChild(orbit.row);

  buildSliders(section, light, [
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
  ], changed);
  return section;
}

// --- Canvas ---------------------------------------------------------------------

function buildCanvasSection(app, light) {
  const section = createSection('Canvas');
  const changed = () => app.notify('canvas');

  // Swatch buttons plus a custom colour picker. aria-pressed marks the
  // chosen swatch, for both the styling and screen readers.
  const row = document.createElement('div');
  row.className = 'control control--ground';
  row.dataset.tip = "The colour of the primed canvas under the paint. It shows wherever paint is thin or missing, and it changes instantly, even under paint you've already laid down.";
  row.innerHTML = `
    <span class="control__label" id="ground-label">Canvas colour</span>
    <div class="swatches" role="group" aria-labelledby="ground-label">
      <input type="color" aria-label="Custom canvas colour">
    </div>`;
  const swatchRow = row.querySelector('.swatches');
  const picker = row.querySelector('input');

  function setGround(hex) {
    light.ground = hexToRgb(hex);
    picker.value = hex;
    for (const b of swatchRow.querySelectorAll('.swatch')) {
      b.setAttribute('aria-pressed', String(b.dataset.hex === hex));
    }
    changed();  // no repainting needed: the lighting pass mixes it in
  }

  for (const { name, hex } of GROUND_SWATCHES) {
    const button = document.createElement('button');
    button.className = 'swatch';
    button.type = 'button';
    button.dataset.hex = hex;
    button.style.setProperty('--swatch', hex);
    button.setAttribute('aria-label', name);
    button.addEventListener('click', () => setGround(hex));
    swatchRow.insertBefore(button, picker);  // swatches first, picker last
  }
  picker.addEventListener('input', () => setGround(picker.value));
  setGround(app.settings.defaultGround);
  section.appendChild(row);

  buildSliders(section, light, [
    { key: 'weave', label: 'Weave depth', min: 0, max: 0.6, step: 0.01,
      tip: "How strongly the canvas's woven texture shows. It only shows through thin paint; thick paint buries it." },
    { key: 'weaveScale', label: 'Thread size', min: 2, max: 12, step: 0.5, digits: 1,
      tip: 'Spacing of the canvas threads, in pixels. Small is fine linen; large is coarse burlap.' },
  ], changed);
  return section;
}

// --- Paint character ---------------------------------------------------------------
// How the paint and bristles behave. Shared by the hand brush AND the
// generator, so the whole painting has one consistent "handwriting".

function buildCharacterSection(app, brush) {
  const section = createSection('Paint character', {
    note: 'How every stroke looks, painted by hand or generated.',
  });
  buildSliders(section, brush, [
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
      tip: 'How much each stroke squashes the paint already on the canvas as it passes over it.' },
    { key: 'pickup', label: 'Wet pickup', min: 0, max: 1, step: 0.01,
      tip: 'How much wet paint already on the canvas gets dragged into a new stroke. The colours mix like real pigment: blue through yellow streaks green.' },
  ], () => app.notify('character'));
  return section;
}

// --- Hand brush ---------------------------------------------------------------------

function buildBrushSection(app, brush) {
  const section = createSection('Hand brush', {
    note: 'Drag on the painting to paint with it.',
  });

  const colorRow = document.createElement('div');
  colorRow.className = 'control control--color';
  colorRow.dataset.tip = 'The colour of the paint on your brush.';
  colorRow.innerHTML = `<label class="control__label" for="brush-color">Colour</label>
    <input type="color" id="brush-color" value="${app.settings.defaultBrushColor}">`;
  colorRow.querySelector('input').addEventListener('input', (e) => {
    brush.color = hexToRgb(e.target.value);
    app.notify('brush');
  });
  section.appendChild(colorRow);

  buildSliders(section, brush, [
    { key: 'radius', label: 'Size', min: 4, max: 90, step: 1, digits: 0,
      tip: 'Half the width of the brush, in pixels.' },
    { key: 'thickness', label: 'Paint thickness', min: 0.1, max: 3, step: 0.05,
      tip: 'How much paint the brush lays down, and so how high each stroke stands above the canvas.' },
    { key: 'loadLength', label: 'Paint load', min: 60, max: 2000, step: 10, digits: 0,
      tip: 'How far the brush travels (in pixels) before running dry. A small load breaks into scratchy bristle marks quickly.' },
  ], () => app.notify('brush'));
  return section;
}

// --- View -------------------------------------------------------------------------------

function buildViewSection(app, light) {
  const section = createSection('View');
  const view = createSelect('Show', [
    { value: '0', label: 'Lit painting' },
    { value: '1', label: 'Colour only' },
    { value: '2', label: 'Height map' },
    { value: '3', label: 'Surface normals' },
  ], '0', (value) => {
    light.viewMode = parseInt(value, 10);
    app.notify('view');
  }, 'Swap the finished view for the data behind it: flat colour with no lighting, the height map (lighter means thicker paint), or surface normals (the colours show which way each bit of paint faces).');
  section.appendChild(view.row);

  section.appendChild(createActions(
    createButton('Clear canvas', () => app.clearPainting(),
      { tip: "Removes all the paint from this tab's painting, leaving bare canvas." }),
    createButton('Save PNG', () => app.savePng(),
      { tip: 'Downloads the painting exactly as shown, at full resolution (1080 × 1350).' }),
  ));
  return section;
}
