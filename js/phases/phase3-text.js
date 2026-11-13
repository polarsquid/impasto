// =============================================================================
// phase3-text.js  -  Phase 3: palette-knife text
// -----------------------------------------------------------------------------
// Everything from phase 2 (the generated background, touch-ups, light and
// canvas) plus a short message painted over it in thick white palette-knife
// lettering, in XBAND Rough:
//
//   Message     - the words, their size, vertical position and jitter
//   Knife paint - how rough the edges are, how tall the paint stands,
//                 knife marks, and how much background colour is picked up
//
// HOW IT'S BUILT ON PHASE 2
// This tab IS the generator tab with extra parts: it starts as a copy of
// generatorPhase's methods ({ ...generatorPhase }) and adds its own. So the
// generator's sections, repainting, seeds and "watch it paint" all work here
// exactly as in tab 2, on this tab's own surface and settings.
//
// THE ORDER OF PAINTING
//   1. The generator paints the background (instantly, or paced).
//   2. When it finishes (backgroundDone), the surface takes a SNAPSHOT of
//      the bare background.
//   3. The lettering is painted on top (js/text/text-painter.js).
// Changing a text setting goes back to the snapshot and repaints only the
// lettering, so typing never regenerates the background. Changing a
// generator setting repaints both.
// =============================================================================

import { generatorPhase } from './phase2-generator.js';
import { defaultTextSettings } from '../text/layout.js';
import { loadFont } from '../text/font.js';
import { createSection, buildSliders, resetInPlace } from '../ui/controls.js';

/** Wait this long after the last keystroke before repainting the lettering. */
const TYPING_DELAY = 400;

/** Wait this long after a slider stops moving (the shader pass is quick). */
const SLIDER_DELAY = 120;

export const textPhase = {
  ...generatorPhase,
  id: 'text',
  number: 3,
  title: 'Text',
  intro: 'Paints your message in white palette-knife impasto over the generated background.',
  layout: ['generate', 'gesture', 'palette', 'layers', 'message', 'knife',
           'light', 'canvas', 'character', 'brush', 'view'],

  init(app) {
    // Text parts first: the generator's init paints the background straight
    // away, and when that's done it calls backgroundDone() below, which
    // needs these to exist.
    this.text = defaultTextSettings();
    this.textPainter = app.createTextPainter();
    this.textTimer = null;
    this.font = null;

    // Everything phase 2 sets up: settings, surface, runner, its four
    // sections, and the first background.
    generatorPhase.init.call(this, app);

    this.sections.message = this.buildMessageSection();
    this.sections.knife = this.buildKnifeSection();

    // The font arrives a moment later (it's a file to download); paint the
    // lettering as soon as it does.
    loadFont().then((font) => {
      this.font = font;
      this.paintText();
    }).catch((error) => {
      console.error(error);
      this.linesEl.textContent = `Couldn't load the lettering font: ${error.message}`;
    });
  },

  /** Called by the generator's runner when the background is finished. */
  backgroundDone() {
    this.surface.saveSnapshot();
    this.paintText();
  },

  // "Reset all settings": text back to defaults first, so the generator's
  // reset (which repaints, then calls backgroundDone) letters the defaults.
  reset(app) {
    resetInPlace(this.text, defaultTextSettings());
    generatorPhase.reset.call(this, app);
  },

  // --- Painting the lettering -------------------------------------------------------

  /** Go back to the bare background and letter it with the current settings. */
  paintText() {
    clearTimeout(this.textTimer);
    // Not yet: no font, or the background is still being painted (it'll
    // call backgroundDone when it's finished), or there's no background.
    if (!this.font || this.runner.running || !this.surface.hasSnapshot) return;
    this.surface.restoreSnapshot();
    const { lines } = this.textPainter.paint(this.surface, this.font, this.text, this.settings.seed);
    this.linesEl.textContent = lines.length
      ? `Lines: ${lines.join(' / ')}`
      : 'Type a message to paint it.';
    this.app.requestRender();
  },

  /** Repaint the lettering once changes pause for `delay` ms (debouncing). */
  scheduleText(delay) {
    clearTimeout(this.textTimer);
    this.textTimer = setTimeout(() => this.paintText(), delay);
  },

  // --- Message section ---------------------------------------------------------------

  buildMessageSection() {
    const section = createSection('Message', {
      note: 'Press Enter to break lines yourself; otherwise they are balanced automatically.',
    });
    const typed = () => this.scheduleText(TYPING_DELAY);
    const moved = () => this.scheduleText(SLIDER_DELAY);

    const row = document.createElement('div');
    row.className = 'control control--message';
    row.dataset.tip = 'The words to paint. Short messages work best, a few words over one to three lines. The lettering repaints a moment after you stop typing.';
    row.innerHTML = `<label class="control__label" for="text-message">Text</label>
      <textarea id="text-message" rows="3" spellcheck="false" autocomplete="off"></textarea>`;
    const box = row.querySelector('textarea');
    box.value = this.text.text;
    box.addEventListener('input', () => { this.text.text = box.value; typed(); });
    section.appendChild(row);

    const sliders = buildSliders(section, this.text, [
      { key: 'size', label: 'Size', min: 0.3, max: 1, step: 0.01,
        tip: 'How big the lettering is. 1 is as big as fits inside the margins; lower leaves more of the background around it.' },
      { key: 'position', label: 'Vertical position', min: 0, max: 1, step: 0.01,
        tip: 'Slides the text up or down: 0 is at the top, 0.5 in the middle, 1 at the bottom. It stays centred across.' },
      { key: 'jitter', label: 'Letter jitter', min: 0, max: 1, step: 0.01,
        tip: 'Turns each letter slightly and nudges it off the line, as if each was laid on by hand. 0 keeps them perfectly straight.' },
    ], moved);

    // Which lines the layout chose (or an error), announced to screen readers.
    this.linesEl = document.createElement('p');
    this.linesEl.className = 'group__status';
    this.linesEl.setAttribute('aria-live', 'polite');
    section.appendChild(this.linesEl);

    this.refreshers.push(() => {
      box.value = this.text.text;
      sliders.refresh();
    });
    return section;
  },

  // --- Knife paint section -----------------------------------------------------------

  buildKnifeSection() {
    const section = createSection('Knife paint', {
      note: 'Text changes repaint only the lettering, but clear hand touch-ups on this tab.',
    });
    const sliders = buildSliders(section, this.text, [
      { key: 'roughness', label: 'Edge roughness', min: 0, max: 1, step: 0.01,
        tip: 'How ragged the letter edges are. 0 gives clean edges; 1 gives broken, chipped edges with bites taken out of them.' },
      { key: 'height', label: 'Paint height', min: 0.5, max: 5, step: 0.05,
        tip: 'How thick the knife paint stands above the canvas, so how far it rises above the background and how long its shadows are.' },
      { key: 'knife', label: 'Knife marks', min: 0, max: 1, step: 0.01,
        tip: 'How much the knife shows: steps between passes of the blade, fine scrape lines, and thin skips where the blade lifted. 0 gives a smooth, even top.' },
      { key: 'contamination', label: 'Colour pickup', min: 0, max: 1, step: 0.01,
        tip: 'How much wet background colour the knife drags into the white where it first touches down, fading along the stroke. Mixes like real pigment.' },
    ], () => this.scheduleText(SLIDER_DELAY));
    this.refreshers.push(sliders.refresh);
    return section;
  },
};
