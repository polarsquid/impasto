// =============================================================================
// tabs.js
// -----------------------------------------------------------------------------
// The row of tabs, one per build phase.
//
// Follows the standard accessible "tabs" pattern:
//   - the row has role="tablist", each button role="tab"
//   - aria-selected marks the active tab
//   - only the active tab is in the Tab-key order; the arrow keys move
//     between tabs (Home/End jump to the first/last)
//
// The active tab is also written into the page address as a "hash"
// (index.html#generator). That means a reload keeps you on the same tab,
// you can bookmark a tab, and the browser's back button works.
// =============================================================================

/**
 * @param {HTMLElement} container  an empty element to put the tabs in
 * @param {Array} phases           phase modules (id, number, title)
 * @param {string} panelId         id of the element the tabs control
 * @param {(phase) => void} onSelect  called when a tab is chosen
 * @returns {{ select(id): void }}
 */
export function createTabs(container, phases, panelId, onSelect) {
  container.setAttribute('role', 'tablist');
  container.setAttribute('aria-label', 'Build phases');

  const buttons = phases.map((phase) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab';
    button.id = `tab-${phase.id}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', panelId);
    button.innerHTML = `<span class="tab__number">${phase.number}</span><span class="tab__title">${phase.title}</span>`;
    button.addEventListener('click', () => select(phase.id));
    container.appendChild(button);
    return button;
  });

  // Arrow-key navigation between tabs.
  container.addEventListener('keydown', (e) => {
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    let next = null;
    if (e.key === 'ArrowRight') next = (index + 1) % buttons.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    if (next === null) return;
    e.preventDefault();
    buttons[next].focus();
    select(phases[next].id);
  });

  let current = null;
  let firstSelection = true;
  function select(id) {
    const phase = phases.find((p) => p.id === id) ?? phases[phases.length - 1];
    if (phase === current) return;
    current = phase;
    buttons.forEach((button, i) => {
      const selected = phases[i] === phase;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    document.getElementById(panelId).setAttribute('aria-labelledby', `tab-${phase.id}`);
    // Update the address. pushState adds a history entry (so Back returns
    // to the previous tab) without reloading the page. The very first
    // selection uses replaceState instead, so opening the page doesn't add
    // an extra entry you'd have to click Back through.
    if (location.hash !== `#${phase.id}`) {
      const method = firstSelection ? 'replaceState' : 'pushState';
      history[method](null, '', `#${phase.id}`);
    }
    firstSelection = false;
    onSelect(phase);
  }

  // Back/forward buttons (popstate), or someone editing the address by hand
  // (hashchange). If the tab is already showing, select() does nothing.
  window.addEventListener('popstate', () => select(location.hash.slice(1)));
  window.addEventListener('hashchange', () => select(location.hash.slice(1)));

  return { select };
}
