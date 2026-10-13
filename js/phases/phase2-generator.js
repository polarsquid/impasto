// =============================================================================
// phase2-generator.js  -  Phase 2: procedural background generator
// -----------------------------------------------------------------------------
// Everything from phase 1 (light, canvas, paint character, hand brush for
// touch-ups) plus a generator that paints whole backgrounds:
//
//   Generate  - seed, repaint, watch it paint
//   Gesture   - the flow field: which way the strokes travel
//   Palette   - up to 6 weighted colours, mixed like real pigment
//   Layers    - underpainting, body paint and accents, coarse to fine
//
// The flow: settings -> composer.js plans every stroke -> stroke-runner.js
// paints them onto this tab's surface. See phase1-brush.js for how phase
// objects plug into main.js.
// =============================================================================

import { composePainting, defaultGeneratorSettings, LAYERS } from '../generator/composer.js';
import { StrokeRunner } from '../generator/stroke-runner.js';
import { FIELD_TYPES } from '../generator/flow-field.js';
import { PALETTE_PRESETS } from '../generator/palettes.js';
import {
  createSection, createSubheading, buildSliders, createSelect, createCheckbox,
  createButton, createActions,
} from '../ui/controls.js';

// The brush settings that describe the paint's character. The generator
// uses these for its strokes too, so hand touch-ups match the background.
const CHARACTER_KEYS = ['tipShape', 'edgeWobble', 'bristles', 'groove', 'ridge', 'flatten', 'pickup'];

export const generatorPhase = {
  id: 'generator',
  number: 2,
  title: 'Generator',
  intro: 'Paints a whole background from a seed. Adjust the gesture, palette and layers, then touch up by hand.',
  layout: ['generate', 'gesture', 'palette', 'layers', 'light', 'canvas', 'character', 'brush', 'view'],

  init(app) {
    this.app = app;
    this.settings = defaultGeneratorSettings();
    this.surface = app.createSurface();
    this.watch = false;
    this.repaintTimer = null;

    this.runner = new StrokeRunner({
      onProgress: (done, total) => {
        if (done < total) this.setStatus(`Painting… ${done} of ${total} strokes`);
      },
      onFrame: () => app.requestRender(),
      onDone: (total) => this.setStatus(`${total} strokes painted`),
    });

    this.sections = {
      generate: this.buildGenerateSection(),
      gesture:  this.buildGestureSection(),
      palette:  this.buildPaletteSection(),
      layers:   this.buildLayersSection(),
    };
    this.repaint();
  },

  // Pause a "watch it paint" run while the tab is hidden; carry on after.
  enter() { this.runner.resume(); },
  leave() { this.runner.pause(); },

  // Shared settings changed. Paint character affects generated strokes.
  notify(kind) {
    if (kind === 'character') this.scheduleRepaint();
  },

  // The hand brush can't paint while the generator is still painting:
  // both would be laying strokes on the same surface at once.
  handPaintSurface() {
    return this.runner.running ? null : this.surface;
  },

  // --- Painting ------------------------------------------------------------------

  /** Plan the painting from the current settings and paint it. */
  repaint() {
    clearTimeout(this.repaintTimer);
    const { brush } = this.app.settings;
    const character = Object.fromEntries(CHARACTER_KEYS.map((k) => [k, brush[k]]));
    const { jobs } = composePainting(this.settings, character, this.surface.width, this.surface.height);
    this.surface.clear();
    this.runner.run(this.surface, jobs, this.watch);
  },

  /**
   * Repaint shortly after the last change. Dragging a slider fires dozens of
   * changes a second; waiting until it pauses for 250ms means we repaint
   * once per adjustment instead of dozens of times ("debouncing").
   */
  scheduleRepaint() {
    clearTimeout(this.repaintTimer);
    this.repaintTimer = setTimeout(() => this.repaint(), 250);
  },

  setStatus(text) { this.statusEl.textContent = text; },

  // --- Generate section -------------------------------------------------------------

  buildGenerateSection() {
    const section = createSection('Generate', {
      note: 'Changing any generator or paint character setting repaints the background, which clears hand-painted touch-ups.',
    });

    // Seed: a number input plus a "New seed" button.
    const seedRow = document.createElement('div');
    seedRow.className = 'control control--seed';
    seedRow.dataset.tip = 'The number every random choice comes from. The same seed with the same settings always paints exactly the same picture, so note down seeds you like.';
    seedRow.innerHTML = `<label class="control__label" for="gen-seed">Seed</label>
      <input type="number" id="gen-seed" min="0" max="999999" step="1">`;
    const seedInput = seedRow.querySelector('input');
    seedInput.value = this.settings.seed;
    seedInput.addEventListener('change', () => {
      this.settings.seed = Math.max(0, Math.floor(Number(seedInput.value) || 0));
      seedInput.value = this.settings.seed;
      this.repaint();
    });
    section.appendChild(seedRow);

    const watch = createCheckbox('Watch it paint', this.watch, (on) => { this.watch = on; },
      'Paints the background stroke by stroke so you can watch it build up, instead of all at once.');
    section.appendChild(watch.row);

    section.appendChild(createActions(
      createButton('New seed', () => {
        this.settings.seed = Math.floor(Math.random() * 1e6);
        seedInput.value = this.settings.seed;
        this.repaint();
      }, { primary: true, tip: 'Picks a random seed and paints a fresh background with the same settings.' }),
      createButton('Repaint', () => this.repaint(),
        { tip: 'Paints the current seed again. Handy for clearing touch-ups, or to watch it paint.' }),
    ));

    // A live region: screen readers announce changes to this text.
    this.statusEl = document.createElement('p');
    this.statusEl.className = 'group__status';
    this.statusEl.setAttribute('aria-live', 'polite');
    section.appendChild(this.statusEl);
    return section;
  },

  // --- Gesture section ----------------------------------------------------------------

  buildGestureSection() {
    const section = createSection('Gesture');
    const field = this.settings.field;
    const changed = () => this.scheduleRepaint();

    const sliders = buildSliders(document.createElement('div'), field, [
      { key: 'angle', label: 'Direction', min: -180, max: 180, step: 1, digits: 0,
        tip: 'The main direction strokes travel, in degrees. 0 runs left to right; 90 runs top to bottom. Used by sweep, waves and turbulent.' },
      { key: 'scale', label: 'Scale', min: 80, max: 1400, step: 10, digits: 0,
        tip: 'How big the curves and waves in the stroke pattern are, in pixels. Small makes busy, tight movement; large makes broad, slow movement.' },
      { key: 'chaos', label: 'Chaos', min: 0, max: 1, step: 0.01,
        tip: 'How much randomness bends the pattern. 0 is perfectly regular; 1 breaks it up into restless, irregular strokes.' },
      { key: 'centerX', label: 'Centre across', min: 0, max: 1, step: 0.01,
        tip: 'Where the centre of the swirl or burst sits, from the left edge (0) to the right edge (1).' },
      { key: 'centerY', label: 'Centre down', min: 0, max: 1, step: 0.01,
        tip: 'Where the centre of the swirl or burst sits, from the top (0) to the bottom (1).' },
    ], changed);

    // Only show the settings that the chosen field type actually uses.
    const updateVisibility = () => {
      const centred = field.type === 'swirl' || field.type === 'radial';
      sliders.rows.get('angle').hidden = centred;
      sliders.rows.get('centerX').hidden = !centred;
      sliders.rows.get('centerY').hidden = !centred;
    };

    const type = createSelect('Pattern', FIELD_TYPES, field.type, (value) => {
      field.type = value;
      updateVisibility();
      changed();
    }, 'The overall movement of the strokes: one sweeping direction, rolling waves, a whirlpool around a point, rays bursting from a point, or restless turbulence.');

    section.appendChild(type.row);
    section.append(...sliders.rows.values());
    updateVisibility();
    return section;
  },

  // --- Palette section -----------------------------------------------------------------

  buildPaletteSection() {
    const section = createSection('Palette');
    const palette = this.settings.palette;
    const changed = () => this.scheduleRepaint();

    // Six colour slots: a colour picker and a weight slider each.
    const slotInputs = [];
    const slots = document.createElement('div');
    slots.className = 'palette';
    slots.dataset.tip = 'Each colour and how much of it to use. A weight of 2 is used twice as often as 1; drag a weight to 0 to leave that colour out.';
    palette.colors.forEach((slot, i) => {
      const row = document.createElement('div');
      row.className = 'palette__slot';
      row.innerHTML = `
        <input type="color" aria-label="Colour ${i + 1}">
        <input type="range" min="0" max="3" step="0.05" aria-label="Amount of colour ${i + 1}">
        <output></output>`;
      const [color, weight] = row.querySelectorAll('input');
      const output = row.querySelector('output');
      const show = () => {
        color.value = slot.hex;
        weight.value = slot.weight;
        output.textContent = slot.weight.toFixed(2);
        row.classList.toggle('palette__slot--off', slot.weight <= 0);
      };
      color.addEventListener('input', () => { slot.hex = color.value; changed(); });
      weight.addEventListener('input', () => {
        slot.weight = parseFloat(weight.value);
        show();
        changed();
      });
      show();
      slotInputs.push(show);
      slots.appendChild(row);
    });

    const presets = createSelect('Load colours',
      [{ value: '', label: 'Choose a palette…' }, ...PALETTE_PRESETS.map((p) => ({ value: p.name, label: p.name }))],
      '', (name) => {
        const preset = PALETTE_PRESETS.find((p) => p.name === name);
        if (!preset) return;
        preset.colors.forEach((hex, i) => { palette.colors[i].hex = hex; palette.colors[i].weight = 1; });
        slotInputs.forEach((show) => show());
        presets.select.value = '';   // back to the placeholder, ready for next time
        this.repaint();
      }, 'Replaces the six colours below with a ready-made palette. You can adjust them afterwards.');

    section.appendChild(presets.row);
    section.appendChild(slots);
    buildSliders(section, palette, [
      { key: 'mixing', label: 'Palette mixing', min: 0, max: 1, step: 0.01,
        tip: "How often a stroke's colour is mixed with a second palette colour, like a brush dragged through a neighbouring puddle of paint. Mixes like real pigment." },
      { key: 'variation', label: 'Colour variation', min: 0, max: 0.3, step: 0.01,
        tip: 'How much each stroke is randomly lightened or darkened, so strokes of the same colour are not all identical.' },
    ], changed);
    return section;
  },

  // --- Layers section ------------------------------------------------------------------

  buildLayersSection() {
    const section = createSection('Layers', {
      note: 'Painted in order: big thin strokes first, small thick ones last.',
    });
    const changed = () => this.scheduleRepaint();

    buildSliders(section, this.settings, [
      { key: 'coverage', label: 'Overall coverage', min: 0, max: 2, step: 0.01,
        tip: 'Scales the number of strokes in every layer at once. Lower lets more bare canvas show through.' },
    ], changed);

    // Per-layer ranges: sizes that suit each layer's job.
    const ranges = {
      under:   { size: [20, 140], length: [100, 1000] },
      body:    { size: [8, 80],   length: [40, 600] },
      accents: { size: [3, 40],   length: [15, 300] },
    };
    const descriptions = {
      under: 'big, thin strokes that block in colour',
      body: 'the main mass of paint',
      accents: 'small, thick strokes that stand highest',
    };

    for (const layer of LAYERS) {
      const r = ranges[layer.key];
      const d = descriptions[layer.key];
      section.appendChild(createSubheading(layer.label));
      buildSliders(section, this.settings.layers[layer.key], [
        { key: 'density', label: 'Amount', min: 0, max: 3, step: 0.05,
          tip: `How many strokes in the ${layer.label.toLowerCase()} layer (${d}). 1 covers the canvas about once over; 0 turns the layer off.` },
        { key: 'size', label: 'Brush size', min: r.size[0], max: r.size[1], step: 1, digits: 0,
          tip: `Typical brush radius for this layer, in pixels. Each stroke varies a little around it.` },
        { key: 'length', label: 'Stroke length', min: r.length[0], max: r.length[1], step: 5, digits: 0,
          tip: 'Typical stroke length, in pixels. Long strokes show off the gesture; short ones read as dabs.' },
        { key: 'thickness', label: 'Paint thickness', min: 0.05, max: 3, step: 0.05,
          tip: 'How thick the paint is in this layer, so how much relief it adds. Thin underpainting and thick accents is the classic build-up.' },
      ], changed);
    }
    return section;
  },
};
