// =============================================================================
// controls.js
// -----------------------------------------------------------------------------
// Builds the sliders in the side panel from simple descriptions, so adding a
// new setting is one line in main.js rather than a chunk of HTML.
//
// Each slider is "bound" to a key on a settings object: moving the slider
// writes straight into that object, then calls onChange so the app redraws.
// =============================================================================

/**
 * @param {HTMLElement} parent  where to add the sliders
 * @param {Object} target       the settings object the sliders edit
 * @param {Array} specs         [{ key, label, min, max, step, digits }]
 * @param {Function} onChange   called after any slider moves
 */
export function buildSliders(parent, target, specs, onChange) {
  for (const spec of specs) {
    const { key, label, min, max, step, digits = 2, hint } = spec;

    // <label> wrapping the input means clicking the text focuses the slider,
    // and screen readers announce the label with it.
    const row = document.createElement('label');
    row.className = 'control';
    row.innerHTML = `
      <span class="control__label">${label}</span>
      <output class="control__value"></output>
      <input class="control__input" type="range" min="${min}" max="${max}" step="${step}">`;
    if (hint) row.title = hint;

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
