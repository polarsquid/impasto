// =============================================================================
// random.js
// -----------------------------------------------------------------------------
// Seeded randomness. Math.random() can't be seeded, so it gives a different
// result every time. For a generator we want the opposite: the same seed
// must always give exactly the same painting, so a painting can be saved as
// just a seed number plus settings, and recreated later.
// =============================================================================

/**
 * A tiny seeded random number generator ("mulberry32"). It scrambles a
 * 32-bit number on every call. Fast, small, and plenty random for art.
 * @param {number} seed  any whole number
 * @returns {() => number}  a function returning numbers in 0..1
 */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick an index at random, where each option has a weight: an option with
 * weight 2 is picked twice as often as one with weight 1.
 * @param {number[]} weights
 * @param {() => number} rand
 */
export function pickWeighted(weights, rand) {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return 0;
  let r = rand() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** Shuffle an array in place (Fisher-Yates), using a seeded rand(). */
export function shuffle(array, rand) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
