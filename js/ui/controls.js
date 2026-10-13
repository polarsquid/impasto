// =============================================================================
// controls.js
// -----------------------------------------------------------------------------
// Small builders for the side panel, so adding a setting is one entry in a
// list rather than a chunk of HTML: sections, sliders, dropdowns, checkboxes
// and buttons. Also turns any element with a data-tip="..." attribute into a
// hover tooltip.
//
// Each slider is "bound" to a key on a settings object: moving the slider
// writes straight into that object, then calls onChange so the app redraws.
// =============================================================================

let idCounter = 0;
const nextId = (prefix) => `${prefix}-${++idCounter}`;

/**
 * A titled panel section.
 * @param {string} title
 * @param {Object} [options]  { note: a short line of help text under the title }
 * @returns {HTMLElement} the <section>; add controls to it with appendChild
 */
export function createSection(title, { note } = {}) {
  const section = document.createElement('section');
  section.className = 'group';
  const heading = document.createElement('h2');
  heading.className = 'group__title';
  heading.textContent = title;
  section.appendChild(heading);
  if (note) {
    const p = document.createElement('p');
    p.className = 'group__note';
    p.textContent = note;
    section.appendChild(p);
  }
  return section;
}

/** A small subheading inside a section, e.g. one layer of the generator. */
export function createSubheading(text) {
  const h = document.createElement('h3');
  h.className = 'group__subtitle';
  h.textContent = text;
  return h;
}

/**
 * Sliders bound to a settings object.
 * @param {HTMLElement} parent  where to add the sliders
 * @param {Object} target       the settings object the sliders edit
 * @param {Array} specs         [{ key, label, min, max, step, digits, tip }]
 * @param {Function} onChange   called with the key after any slider moves
 * @returns {{ rows: Map<string, HTMLElement>, refresh: Function }}
 *   rows: each slider's row by key (e.g. to hide ones that don't apply)
 *   refresh(): re-read the values from `target` (after it changed elsewhere)
 */
export function buildSliders(parent, target, specs, onChange) {
  const rows = new Map();
  const refreshers = [];

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
    const show = () => {
      input.value = target[key];
      output.textContent = Number(target[key]).toFixed(digits);
    };
    show();

    input.addEventListener('input', () => {
      target[key] = parseFloat(input.value);
      output.textContent = target[key].toFixed(digits);
      onChange(key);
    });
    parent.appendChild(row);
    rows.set(key, row);
    refreshers.push(show);
  }
  return { rows, refresh: () => refreshers.forEach((f) => f()) };
}

/**
 * A dropdown.
 * @param {Array<{value, label}>} options
 * @returns {{ row: HTMLElement, select: HTMLSelectElement }}
 */
export function createSelect(label, options, value, onChange, tip) {
  const id = nextId('select');
  const row = document.createElement('div');
  row.className = 'control control--select';
  if (tip) row.dataset.tip = tip;
  row.innerHTML = `<label class="control__label" for="${id}">${label}</label><select id="${id}"></select>`;
  const select = row.querySelector('select');
  for (const o of options) select.add(new Option(o.label, o.value));
  select.value = value;
  select.addEventListener('change', () => onChange(select.value));
  return { row, select };
}

/** A checkbox with a label. Returns { row, input }. */
export function createCheckbox(label, checked, onChange, tip) {
  const id = nextId('check');
  const row = document.createElement('div');
  row.className = 'toggle';
  if (tip) row.dataset.tip = tip;
  row.innerHTML = `<input type="checkbox" id="${id}"><label for="${id}">${label}</label>`;
  const input = row.querySelector('input');
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return { row, input };
}

/**
 * A button, wrapped in a <span> that can carry a tooltip (see the note on
 * .actions in painter.css about why the wrapper exists).
 */
export function createButton(label, onClick, { tip, primary = false } = {}) {
  const wrap = document.createElement('span');
  if (tip) wrap.dataset.tip = tip;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = primary ? 'button button--primary' : 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  wrap.appendChild(button);
  return wrap;
}

/** A row of buttons. */
export function createActions(...buttons) {
  const row = document.createElement('div');
  row.className = 'actions';
  row.append(...buttons);
  return row;
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
  const elements = [...root.querySelectorAll('[data-tip]')];
  if (root instanceof Element && root.matches('[data-tip]')) elements.push(root);
  for (const el of elements) {
    if (el.classList.contains('has-tip')) continue;
    const tip = document.createElement('span');
    tip.className = 'tip';
    tip.id = nextId('tip');
    tip.setAttribute('role', 'tooltip');
    tip.textContent = el.dataset.tip;
    el.classList.add('has-tip');
    el.appendChild(tip);

    const controls = el.matches(FOCUSABLE) ? [el] : el.querySelectorAll(FOCUSABLE);
    for (const control of controls) control.setAttribute('aria-describedby', tip.id);
  }
}

/**
 * Put a settings object back to its defaults, IN PLACE.
 *
 * Why not just replace it with a fresh defaults object? Because the sliders
 * hold a reference to the exact object they edit. Replace the object and
 * they'd carry on editing the old, forgotten one. So instead we copy each
 * default value into the existing object (and into the objects nested
 * inside it), keeping every object the same one the controls know about.
 * After this, call the controls' refresh functions so they show the values.
 *
 * @param {Object} target    the live settings object
 * @param {Object} defaults  a fresh copy of the default settings
 */
export function resetInPlace(target, defaults) {
  for (const [key, value] of Object.entries(defaults)) {
    const current = target[key];
    const isObject = (v) => v !== null && typeof v === 'object';
    if (Array.isArray(value) && Array.isArray(current) && value.length === current.length && value.every(isObject)) {
      // An array of objects (e.g. palette slots): reset each one in place.
      value.forEach((item, i) => resetInPlace(current[i], item));
    } else if (isObject(value) && !Array.isArray(value) && isObject(current)) {
      resetInPlace(current, value);   // a nested settings object
    } else {
      target[key] = Array.isArray(value) ? value.slice() : value;   // a plain value
    }
  }
}
