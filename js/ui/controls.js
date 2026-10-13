// =============================================================================
// controls.js
// -----------------------------------------------------------------------------
// Builds the sliders in the side panel from simple descriptions, so adding a
// new setting is one entry in main.js rather than a chunk of HTML. Also turns
// any element with a data-tip="..." attribute into a hover tooltip.
//
// Each slider is "bound" to a key on a settings object: moving the slider
// writes straight into that object, then calls onChange so the app redraws.
// =============================================================================

let idCounter = 0;
const nextId = (prefix) => `${prefix}-${++idCounter}`;

/**
 * @param {HTMLElement} parent  where to add the sliders
 * @param {Object} target       the settings object the sliders edit
 * @param {Array} specs         [{ key, label, min, max, step, digits, tip }]
 * @param {Function} onChange   called after any slider moves
 */
export function buildSliders(parent, target, specs, onChange) {
  for (const spec of specs) {
    const { key, label, min, max, step, digits = 2, tip } = spec;
    const inputId = nextId('control');

    // The row is a <div> (not a <label>) so the tooltip we add later sits
    // OUTSIDE the label. Otherwise screen readers would read the whole
    // tooltip as part of the slider's name. The <label for="..."> still
    // links the text to the slider, so clicking the text focuses it.
    const row = document.createElement('div');
    row.className = 'control';
    if (tip) row.dataset.tip = tip;
    row.innerHTML = `
      <label class="control__label" for="${inputId}">${label}</label>
      <output class="control__value" for="${inputId}"></output>
      <input class="control__input" id="${inputId}" type="range" min="${min}" max="${max}" step="${step}">`;

    const input = row.querySelector('input');
    const output = row.querySelector('output');
    input.value = target[key];
    output.textContent = Number(target[key]).toFixed(digits);

    input.addEventListener('input', () => {
      target[key] = parseFloat(input.value);
      output.textContent = target[key].toFixed(digits);
      onChange(key);
    });
    parent.appendChild(row);
  }
}

// Anything a keyboard user can focus.
const FOCUSABLE = 'input, select, button, [tabindex]';

/**
 * Add a tooltip to every element with a data-tip attribute.
 *
 * The tooltip is a real element (not the browser's built-in title popup),
 * which means it can be styled, appears faster, and also shows when you
 * reach the control with the Tab key. The showing and hiding is all done in
 * CSS (see .tip in painter.css); this function just creates the elements.
 *
 * aria-describedby links each control to its tooltip, so screen readers
 * read the description after the control's name.
 *
 * Safe to call more than once: elements that already have a tooltip are
 * skipped.
 */
export function initTooltips(root = document) {
  for (const el of root.querySelectorAll('[data-tip]')) {
    if (el.classList.contains('has-tip')) continue;
    const tip = document.createElement('span');
    tip.className = 'tip';
    tip.id = nextId('tip');
    tip.setAttribute('role', 'tooltip');
    tip.textContent = el.dataset.tip;
    el.classList.add('has-tip');
    el.appendChild(tip);

    for (const control of el.querySelectorAll(FOCUSABLE)) {
      control.setAttribute('aria-describedby', tip.id);
    }
  }
}
