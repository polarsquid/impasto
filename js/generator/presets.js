// =============================================================================
// presets.js
// -----------------------------------------------------------------------------
// Background presets: a saved background you can load again later. A preset
// holds everything that decides what the generator paints:
//
//   - the seed and every generator setting (gesture, palette, layers)
//   - the paint character (tip, bristles, ridges...), shared with the brush
//
// and nothing else: the text, light, canvas colour and orientation stay as
// they are when you load one. Presets are plain JSON files, e.g.
//
//   {
//     "format": "impasto-background",
//     "version": 1,
//     "name": "Harbour sweep",
//     "generator": { "seed": 1234, "field": {...}, "palette": {...}, ... },
//     "character": { "tipShape": 2.2, "bristles": 14, ... }
//   }
//
// LOADING SAFELY
// A preset file might be from an older version of the app, hand-edited, or
// not a preset at all. So readPreset() never trusts it blindly: it starts
// from the default settings and copies across only the values it
// recognises, of the right type. Anything missing keeps its default, and
// anything unknown is ignored. That also means presets keep working when
// new settings are added later: they simply get the new defaults.
//
// This file is pure data handling (no page or GPU), so it's easy to test.
// =============================================================================

import { FIELD_TYPES } from './flow-field.js';

/** Identifies our preset files, so other JSON files are rejected politely. */
export const PRESET_FORMAT = 'impasto-background';
export const PRESET_VERSION = 1;

/**
 * The brush settings that describe the paint's character. The generator
 * uses these for its strokes, so a preset saves them with the background.
 */
export const CHARACTER_KEYS = ['tipShape', 'edgeWobble', 'bristles', 'groove', 'ridge', 'flatten', 'pickup'];

/**
 * Make a preset object, ready to save as JSON.
 * @param {string} name
 * @param {Object} generator  the generator settings (see defaultGeneratorSettings)
 * @param {Object} brush      the shared brush settings; only the character is kept
 */
export function makePreset(name, generator, brush) {
  return {
    format: PRESET_FORMAT,
    version: PRESET_VERSION,
    name,
    // A round trip through JSON makes a deep copy with no links back to the
    // live settings objects.
    generator: JSON.parse(JSON.stringify(generator)),
    character: Object.fromEntries(CHARACTER_KEYS.map((k) => [k, brush[k]])),
  };
}

/**
 * Check a loaded preset and turn it into complete, safe settings.
 * @param {Object} data              parsed JSON from a preset file
 * @param {Object} defaultGenerator  a fresh defaultGeneratorSettings()
 * @param {Object} currentBrush      the brush settings now (for missing character values)
 * @returns {{ name: string, generator: Object, character: Object }}
 * @throws {Error} with a readable message if it isn't a preset at all
 */
export function readPreset(data, defaultGenerator, currentBrush) {
  if (!data || typeof data !== 'object' || data.format !== PRESET_FORMAT) {
    throw new Error('That file is not an Impasto background preset.');
  }
  const generator = mergeKnown(defaultGenerator, data.generator);

  // Values with a fixed set of allowed choices get checked individually.
  if (!FIELD_TYPES.some((t) => t.value === generator.field.type)) {
    generator.field.type = defaultGenerator.field.type;
  }
  generator.palette.colors.forEach((slot, i) => {
    if (!/^#[0-9a-f]{6}$/i.test(slot.hex)) slot.hex = defaultGenerator.palette.colors[i].hex;
    slot.hex = slot.hex.toLowerCase();   // colour pickers want lowercase
  });
  generator.seed = Math.max(0, Math.floor(generator.seed));

  const currentCharacter = Object.fromEntries(CHARACTER_KEYS.map((k) => [k, currentBrush[k]]));
  const character = mergeKnown(currentCharacter, data.character);

  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Untitled preset';
  return { name, generator, character };
}

/**
 * A copy of `defaults` with any matching values from `saved` copied in:
 * same keys, same shape, same type. Works through nested objects and
 * arrays (e.g. the six palette slots) one level at a time.
 */
export function mergeKnown(defaults, saved) {
  if (Array.isArray(defaults)) {
    const list = Array.isArray(saved) ? saved : [];
    // Keep the default's length (e.g. always 6 palette slots).
    return defaults.map((d, i) => mergeKnown(d, list[i]));
  }
  if (defaults !== null && typeof defaults === 'object') {
    const source = saved !== null && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    const out = {};
    for (const key of Object.keys(defaults)) out[key] = mergeKnown(defaults[key], source[key]);
    return out;
  }
  // A single value: take the saved one only if it's the same type (and, for
  // numbers, a real number rather than NaN or Infinity).
  if (typeof saved !== typeof defaults) return defaults;
  if (typeof saved === 'number' && !Number.isFinite(saved)) return defaults;
  return saved;
}

/** A file name made from a preset name: "Harbour sweep" -> "harbour-sweep". */
export function presetFileName(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${slug || 'preset'}.json`;
}
