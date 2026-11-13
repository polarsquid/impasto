// =============================================================================
// layout.js
// -----------------------------------------------------------------------------
// Decides where every letter of the message goes: how to break it into
// lines, how big to make it, and where each letter sits. The result is pure
// data (letter outlines in surface pixels), so it can be tested in Node and
// rasterised later by text-field.js.
//
// LINE BREAKS
// If you type your own line breaks (Enter), they're kept as they are.
// Otherwise the layout tries 1, 2, 3... lines and, for each count, finds the
// split whose LONGEST line is as short as possible. That's what gives
// balanced breaks: "YOU WOULDN'T / STEAL A CAR" rather than
// "YOU WOULDN'T STEAL A / CAR". Then it picks the line count with the best
// score, which weighs two things:
//   - size: how big the letters can be in the space available
//   - evenness: lines of similar length look composed; a stack like
//     "YOU / WOULDN'T / STEAL / A CAR" lets the letters be bigger, but the
//     ragged lines read as broken up
// So the shape of the canvas matters: landscape tends to fewer, longer
// lines, and portrait to more, shorter ones when the words allow it.
//
// HAND-PLACED FEEL
// "Jitter" turns each letter by a few degrees and nudges it off the
// baseline, as if each was knifed on separately rather than typeset.
//
// KNIFE DIRECTION
// Each letter also gets the direction its palette knife travels. Mostly
// that's a downward pull along the stems, varied a little per letter; now
// and then it's a diagonal swipe. text.frag uses it for the knife marks.
// =============================================================================

/** Empty space kept around the text, as a fraction of the shorter side. */
const MARGIN = 0.07;

/** Gap between lines, as a fraction of the cap height. */
const LINE_GAP = 0.38;

/** The most lines auto-layout will try. */
const MAX_LINES = 5;

/**
 * Each extra line costs this much of its score, so between two near-equal
 * layouts the one with fewer lines wins (it reads more naturally).
 */
const EXTRA_LINE_PENALTY = 0.04;

/**
 * How much uneven line lengths count against a layout. Evenness (average
 * line width / widest line, 1 = all equal) is raised to this power, so 2
 * means a fairly ragged 0.7 scores only about half (0.49).
 */
const EVENNESS_WEIGHT = 2;

/** Text settings a fresh Text tab starts with. */
export function defaultTextSettings() {
  return {
    text: "YOU WOULDN'T STEAL A CAR",
    font: 'xband',    // which lettering font (see LETTERING_FONTS in font.js)
    allCaps: true,    // paint everything in capitals, whatever was typed
    size: 0.9,        // fraction of the biggest size that fits (1 = fill the space)
    position: 0.5,    // vertical position: 0 = top, 0.5 = centre, 1 = bottom
    jitter: 0.35,     // per-letter rotation and baseline shift, 0..1
    roughness: 0.25,  // how ragged the letter edges are, 0..1
    height: 1.15,     // how tall the knife paint stands, in paint units
    knife: 0.15,      // strength of knife marks: plateau steps, scrapes, skips
    contamination: 0.15, // how much background colour the knife picks up
  };
}

/**
 * Lay out a message.
 * @param {Object} font    an opentype.js Font with capHeight (see font.js)
 * @param {string} text    the message; line breaks are kept
 * @param {number} width, height  surface size in pixels
 * @param {Object} s       text settings (allCaps, size, position, jitter)
 * @param {Function} rand  seeded random number generator (random.js)
 * @returns {{ letters: Array, lines: string[], fontSize: number, capPx: number,
 *             box: {x0, y0, x1, y1} | null }}
 *   letters: [{ commands, box, angle, seed }] where `commands` are the
 *   outline (opentype.js path commands, in surface pixels, y down), `box`
 *   its bounding box, `angle` the knife direction (radians, y down) and
 *   `seed` a random number 0..1 unique to the letter.
 */
export function layoutText(font, text, width, height, s, rand) {
  const empty = { letters: [], lines: [], fontSize: 0, capPx: 0, box: null };
  // All caps: turn the message into capitals before anything is measured.
  const shown = s.allCaps ? (text ?? '').toUpperCase() : text;
  const lines = chooseLines(font, shown, width, height);
  if (!lines) return empty;

  const margin = MARGIN * Math.min(width, height);
  const boxW = width - margin * 2;
  const boxH = height - margin * 2;
  const cap = font.capHeight;

  // Biggest font size at which every line fits across and the whole block
  // fits down; then scaled by the Size setting.
  const widest = Math.max(...lines.map((line) => inkWidth(font, line)));
  const blockEm = lines.length * cap + (lines.length - 1) * cap * LINE_GAP;
  const fontSize = Math.min(boxW / widest, boxH / blockEm) * s.size;
  const capPx = cap * fontSize;
  const gapPx = capPx * LINE_GAP;

  // Vertical position: slide the block between the top and bottom margins.
  const blockH = blockEm * fontSize;
  const top = margin + (boxH - blockH) * s.position;

  const letters = [];
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };

  lines.forEach((line, i) => {
    const baseline = top + capPx * (i + 1) + gapPx * i;
    // Centre each line by its INK (the visible letter shapes), not its
    // advance width, which includes a little blank space at each end.
    const ink = font.getPath(line, 0, 0, fontSize, { kerning: true }).getBoundingBox();
    const startX = (width - (ink.x2 - ink.x1)) / 2 - ink.x1;

    font.forEachGlyph(line, startX, baseline, fontSize, { kerning: true }, (glyph, gx, gy, gSize) => {
      const path = glyph.getPath(gx, gy, gSize);
      if (!path.commands.length) return;   // a space: nothing to paint
      const letter = placeLetter(path, capPx, s.jitter, rand);
      letters.push(letter);
      box.x0 = Math.min(box.x0, letter.box.x0);
      box.y0 = Math.min(box.y0, letter.box.y0);
      box.x1 = Math.max(box.x1, letter.box.x1);
      box.y1 = Math.max(box.y1, letter.box.y1);
    });
  });

  if (!letters.length) return empty;
  return { letters, lines, fontSize, capPx, box };
}

/**
 * Split the message into lines: the typed ones if there are line breaks,
 * otherwise the best balanced split. Returns null if there's nothing to show.
 */
export function chooseLines(font, text, width, height) {
  const clean = (text ?? '').replace(/\r/g, '');
  if (clean.includes('\n')) {
    const typed = clean.split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean);
    return typed.length ? typed : null;
  }
  const words = clean.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;

  const margin = MARGIN * Math.min(width, height);
  const boxW = width - margin * 2;
  const boxH = height - margin * 2;
  const cap = font.capHeight;

  // Ink widths of every run of words (words i..j-1), measured once.
  const n = words.length;
  const widthOf = [];
  for (let i = 0; i < n; i++) {
    widthOf[i] = [];
    for (let j = i + 1; j <= n; j++) widthOf[i][j] = inkWidth(font, words.slice(i, j).join(' '));
  }

  let best = null;
  for (let k = 1; k <= Math.min(n, MAX_LINES); k++) {
    const breaks = balancedBreaks(widthOf, n, k);
    const widest = breaks.widest;
    const blockEm = k * cap + (k - 1) * cap * LINE_GAP;
    const size = Math.min(boxW / widest, boxH / blockEm);
    const average = breaks.lines.reduce((sum, [i, j]) => sum + widthOf[i][j], 0) / k;
    const evenness = average / widest;
    const score = size * evenness ** EVENNESS_WEIGHT * (1 - EXTRA_LINE_PENALTY * (k - 1));
    if (!best || score > best.score) {
      best = { score, lines: breaks.lines.map(([i, j]) => words.slice(i, j).join(' ')) };
    }
  }
  return best.lines;
}

/**
 * Split n words into exactly k lines so the widest line is as narrow as
 * possible. This is "dynamic programming": the best way to fit the first j
 * words into m lines is built from the best ways to fit fewer words into
 * m - 1 lines, so we never try every combination (fine, since messages are
 * short anyway).
 *
 * @param {number[][]} widthOf  widthOf[i][j] = width of words i..j-1
 * @returns {{ widest: number, lines: Array<[number, number]> }}
 */
function balancedBreaks(widthOf, n, k) {
  // cost[m][j] = narrowest possible widest-line when words 0..j-1 fill m lines
  const cost = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(Infinity));
  const from = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(0));
  cost[0][0] = 0;
  for (let m = 1; m <= k; m++) {
    for (let j = m; j <= n; j++) {
      // The last line is words i..j-1, for some i.
      for (let i = m - 1; i < j; i++) {
        const c = Math.max(cost[m - 1][i], widthOf[i][j]);
        if (c < cost[m][j]) { cost[m][j] = c; from[m][j] = i; }
      }
    }
  }
  // Walk back through `from` to recover where each line starts.
  const lines = [];
  let j = n;
  for (let m = k; m >= 1; m--) {
    const i = from[m][j];
    lines.unshift([i, j]);
    j = i;
  }
  return { widest: cost[k][n], lines };
}

/** Width of a run of text's visible ink at font size 1. */
function inkWidth(font, str) {
  const b = font.getPath(str, 0, 0, 1, { kerning: true }).getBoundingBox();
  return Math.max(1e-6, b.x2 - b.x1);
}

/**
 * Turn one glyph's outline into a placed letter: apply the jitter (a small
 * turn about its centre and a nudge off the baseline) and pick its knife
 * direction and random seed.
 */
function placeLetter(path, capPx, jitter, rand) {
  const b = path.getBoundingBox();
  const cx = (b.x1 + b.x2) / 2;
  const cy = (b.y1 + b.y2) / 2;

  // Up to 5 degrees of turn and 5% of the cap height up or down at full
  // jitter. rand() is always called the same number of times whatever the
  // jitter, so turning jitter down doesn't reshuffle the knife marks.
  const turn = (rand() * 2 - 1) * (5 * Math.PI / 180) * jitter;
  const dx = (rand() * 2 - 1) * 0.02 * capPx * jitter;
  const dy = (rand() * 2 - 1) * 0.05 * capPx * jitter;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const move = (x, y) => [
    cx + (x - cx) * cos - (y - cy) * sin + dx,
    cy + (x - cx) * sin + (y - cy) * cos + dy,
  ];

  // Transform every point of every command. opentype.js commands are
  // { type: 'M' | 'L' | 'C' | 'Q' | 'Z', x, y, x1, y1, x2, y2 } with the
  // control points (x1/y1, x2/y2) present only on curves.
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const commands = path.commands.map((c) => {
    const out = { type: c.type };
    for (const [kx, ky] of [['x', 'y'], ['x1', 'y1'], ['x2', 'y2']]) {
      if (c[kx] === undefined) continue;
      [out[kx], out[ky]] = move(c[kx], c[ky]);
      box.x0 = Math.min(box.x0, out[kx]);
      box.y0 = Math.min(box.y0, out[ky]);
      box.x1 = Math.max(box.x1, out[kx]);
      box.y1 = Math.max(box.y1, out[ky]);
    }
    return out;
  });

  // Knife direction (y points down, so PI/2 is straight down the canvas).
  // 70%: a downward pull, tilted up to about 15 degrees either way.
  // 30%: a diagonal swipe, about 35 degrees off vertical.
  const diagonal = rand() < 0.3;
  const tilt = diagonal ? (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.2) : (rand() * 2 - 1) * 0.26;
  const angle = Math.PI / 2 + tilt + turn;

  return { commands, box, angle, seed: rand() };
}
