// =============================================================================
// light-pad.js
// -----------------------------------------------------------------------------
// A circular control for positioning the light, like looking down on the
// painting from above with a lamp you can move around it:
//
//   - the ANGLE of the dot around the centre = which side the light comes from
//   - the DISTANCE from the centre = how low the light is:
//       centre  -> straight overhead (90 degrees, flat-looking paint)
//       rim     -> skimming the surface (5 degrees, long dramatic shadows)
//
// Keyboard: arrow left/right rotate the light, arrow up/down raise or lower it.
// =============================================================================

const MIN_ELEVATION = 5;   // degrees, at the rim
const MAX_ELEVATION = 90;  // degrees, at the centre

/** Describe an azimuth in words, e.g. 315 -> "top left". */
function describeDirection(az) {
  const names = ['top', 'top right', 'right', 'bottom right', 'bottom', 'bottom left', 'left', 'top left'];
  return names[Math.round(((az % 360) + 360) % 360 / 45) % 8];
}

/**
 * @param {HTMLElement} root    an empty element to build the pad inside
 * @param {Object} light        settings object with .azimuth and .elevation
 * @param {Function} onChange   called after every change
 * @returns {{ refresh: Function }} call refresh() if light changes elsewhere
 */
export function createLightPad(root, light, onChange) {
  // An SVG drawing, 200 x 200 units: the rim, two rings marking 30 and 60
  // degrees of elevation, a line from the centre to the lamp, and the lamp.
  root.innerHTML = `
    <svg class="light-pad__svg" viewBox="0 0 200 200" aria-hidden="true">
      <circle class="light-pad__rim"  cx="100" cy="100" r="92" />
      <circle class="light-pad__ring" cx="100" cy="100" r="${ringRadius(30)}" />
      <circle class="light-pad__ring" cx="100" cy="100" r="${ringRadius(60)}" />
      <line   class="light-pad__beam" x1="100" y1="100" x2="100" y2="100" />
      <circle class="light-pad__glow" cx="100" cy="100" r="16" />
      <circle class="light-pad__lamp" cx="100" cy="100" r="7" />
    </svg>`;
  root.tabIndex = 0;
  root.setAttribute('role', 'application');
  root.setAttribute('aria-roledescription', 'light position');

  const beam = root.querySelector('.light-pad__beam');
  const glow = root.querySelector('.light-pad__glow');
  const lamp = root.querySelector('.light-pad__lamp');
  const readout = document.createElement('p');
  readout.className = 'light-pad__readout';
  root.after(readout);

  // Elevation <-> distance from centre (in SVG units, rim radius 92).
  function ringRadius(elevation) {
    return (MAX_ELEVATION - elevation) / (MAX_ELEVATION - MIN_ELEVATION) * 92;
  }

  // Move the drawing to match the current light settings.
  function refresh() {
    const r = ringRadius(light.elevation);
    const az = light.azimuth * Math.PI / 180;
    // Azimuth 0 = top, so x uses sin and y uses -cos (SVG y points down).
    const x = 100 + Math.sin(az) * r;
    const y = 100 - Math.cos(az) * r;
    beam.setAttribute('x2', x);
    beam.setAttribute('y2', y);
    for (const el of [glow, lamp]) { el.setAttribute('cx', x); el.setAttribute('cy', y); }
    const text = light.elevation >= 85
      ? 'Light from directly overhead'
      : `Light from the ${describeDirection(light.azimuth)}, ${Math.round(light.elevation)}° high`;
    readout.textContent = text;
    root.setAttribute('aria-label', `${text}. Arrow keys move the light.`);
  }

  // Pointer position -> azimuth + elevation.
  function setFromPointer(event) {
    const rect = root.getBoundingClientRect();
    const dx = (event.clientX - rect.left) / rect.width * 200 - 100;
    const dy = (event.clientY - rect.top) / rect.height * 200 - 100;
    const dist = Math.min(Math.hypot(dx, dy), 92);
    light.azimuth = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    light.elevation = MAX_ELEVATION - dist / 92 * (MAX_ELEVATION - MIN_ELEVATION);
    refresh();
    onChange();
  }

  let dragging = false;
  root.addEventListener('pointerdown', (e) => {
    dragging = true;
    root.setPointerCapture(e.pointerId);
    setFromPointer(e);
  });
  root.addEventListener('pointermove', (e) => { if (dragging) setFromPointer(e); });
  root.addEventListener('pointerup', () => { dragging = false; });
  root.addEventListener('pointercancel', () => { dragging = false; });

  root.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 15 : 5;
    if (e.key === 'ArrowLeft')  light.azimuth = (light.azimuth - step + 360) % 360;
    else if (e.key === 'ArrowRight') light.azimuth = (light.azimuth + step) % 360;
    else if (e.key === 'ArrowUp')    light.elevation = Math.min(MAX_ELEVATION, light.elevation + step / 2);
    else if (e.key === 'ArrowDown')  light.elevation = Math.max(MIN_ELEVATION, light.elevation - step / 2);
    else return;
    e.preventDefault();
    refresh();
    onChange();
  });

  refresh();
  return { refresh };
}
