#version 300 es
precision highp float;

// =============================================================================
// text.frag
// -----------------------------------------------------------------------------
// Paints the message in thick white palette-knife paint, on top of the
// painting. It runs once per pixel over the rectangle around the text (see
// PaintSurface.applyPass), reads the painting so far, and writes the new
// colour, coverage, height and gloss, exactly like a brush stroke would. So
// the lighting pass lights, shadows and glosses the letters like everything
// else.
//
// Its main input is the "text field" (built by js/text/text-field.js):
//   r = signed distance to the nearest letter edge (px, negative inside)
//   g = that letter's knife direction (radians, y down)
//   b = that letter's random seed (0..1)
//   a = distance along the knife's path from where it touched down (px)
//
// What a palette knife does, and how each part is faked here:
//
//   1. EDGES. A knife leaves a sharp, steep edge, but not a typeset one.
//      Noise is added to the distance, which pushes the edge in and out:
//      a slow wobble, a finer grain, and the odd bigger bite ("chips").
//   2. A FLAT TOP. The knife is a flat blade, so inside the letter the paint
//      is levelled off at one height: a plateau, not a brush's grooves.
//   3. KNIFE PASSES. A letter is laid with a few broad passes side by side,
//      each held at a slightly different height and tilt, which leaves
//      faint steps (seams) between them; plus fine scrape lines and gentle
//      "chatter" ripples along the direction of travel.
//   4. SKIPS. Where the blade lifted, paint is thin and patchy, and the
//      background peeks through.
//   5. A RIDGE just inside the edge, where paint squeezes out from under
//      the blade, and a little SPILL of paint just outside it.
//   6. SCRAPING. The knife glides at its own level, so where the background
//      has a tall ridge of its own, the blade scrapes over it and leaves
//      only a thin coat, letting the colour underneath show.
//   7. WHITE PAINT that's never pure white: warm and cool whites drift
//      across each letter. Where the knife first touched down it picked up
//      some of the wet background, so streaks of tinted white fade out
//      along the stroke ("contamination"), mixed like real pigment.
// =============================================================================

#include "lib/spectral.glsl"

uniform sampler2D uPaint;     // the painting so far: rgb colour, a coverage
uniform sampler2D uHeight;    // the painting so far: r thickness, g gloss
uniform sampler2D uText;      // the text field (see above)
uniform vec2  uFieldOrigin;   // where the text field's top-left sits, surface px
uniform vec2  uFieldSize;     // the text field's size in px
uniform vec2  uSurfaceSize;   // surface size in px
uniform float uScale;         // letter size / 250px: keeps marks in proportion
uniform float uSeed;          // overall random seed (from the generator seed)
uniform float uRoughness;     // edge roughness 0..1
uniform float uTextHeight;    // how tall the knife paint stands (paint units)
uniform float uKnife;         // strength of knife marks 0..1
uniform float uContamination; // how much background colour gets picked up 0..1

layout(location = 0) out vec4 outPaint;
layout(location = 1) out vec4 outHeight;

// --- Noise helpers ------------------------------------------------------------
// hash(): a quick pseudo-random number 0..1 from a 2D point.
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21) + uSeed * 0.0137);
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float hash1(float n) { return hash(vec2(n, n * 0.618 + 7.0)); }

// noise(): smooth 2D "value noise", 0..1. Random values sit on a grid of
// whole numbers and are blended smoothly in between, giving soft blobs
// about one unit across. Scale the input to choose the blob size.
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);   // smoothstep curve, no kinks at grid lines
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// The height a knife pass leaves, before scrapes and skips. Each pass
// (numbered `band`) sits at its own level and is tilted a little, as the
// blade is never held perfectly flat. `f` is 0..1 across the pass.
float passLevel(float band, float f, float seed) {
  float level = (hash1(band + seed * 97.0) - 0.5) * 0.30;
  float tilt  = (hash1(band * 1.7 + seed * 53.0) - 0.5) * 0.45;
  return level + (f - 0.5) * tilt;
}

void main() {
  // This pixel's position on the surface, in pixels with y pointing DOWN
  // (gl_FragCoord's y points up, so flip it), like everything in JS.
  vec2 p = vec2(gl_FragCoord.x, uSurfaceSize.y - gl_FragCoord.y);

  vec4  old       = texture(uPaint, gl_FragCoord.xy / uSurfaceSize);
  vec2  oldHG     = texture(uHeight, gl_FragCoord.xy / uSurfaceSize).rg;
  float oldHeight = oldHG.r;
  float oldGloss  = oldHG.g;

  // Read the text field. texelFetch reads one exact pixel; the field's rows
  // were uploaded top row first, which matches our y-down position.
  ivec2 cell = ivec2(floor(p - uFieldOrigin));
  if (any(lessThan(cell, ivec2(0))) || any(greaterThanEqual(cell, ivec2(uFieldSize)))) {
    // Outside the field (can only happen at its very edge): leave the
    // painting exactly as it was.
    outPaint = old;
    outHeight = vec4(oldHG, 0.0, 1.0);
    return;
  }
  vec4  field    = texelFetch(uText, cell, 0);
  float dist     = field.r;   // ('distance' is a built-in GLSL function name)
  float angle    = field.g;
  float seed     = field.b;
  float along    = field.a;

  float s = uScale;   // shorthand: every size below grows with the letters

  // Knife coordinates: `along` runs in the direction the knife travels,
  // `across` at right angles to it.
  vec2  dir    = vec2(cos(angle), sin(angle));
  float across = dot(p, vec2(-dir.y, dir.x));

  // --- 1. Rough edges -------------------------------------------------------------
  // Noise is stretched along the knife direction (streaks rather than blobs),
  // because the blade drags the edge as it goes.
  vec2  q      = vec2(across, dot(p, dir));
  float wobble = noise(q / vec2(9.0 * s, 22.0 * s) + seed * 31.0) * 2.0 - 1.0;
  float grain  = noise(p / (2.5 * s) + seed * 57.0) * 2.0 - 1.0;
  float chips  = smoothstep(0.66, 0.82, noise(p / (16.0 * s) + seed * 13.0));
  // Roughness only half follows letter size: small letters still need
  // edges rough enough to read as hand-knifed.
  float roughScale = 0.5 + 0.5 * s;
  float rough  = uRoughness * roughScale * (wobble * 4.0 + grain * 1.2 + chips * 7.0);
  // Depth inside the (roughened) letter, in px: positive inside, negative out.
  float depth  = -(dist + rough);

  // How much of this pixel the letter covers, with a 1.4px soft edge so it's
  // smooth (anti-aliased) rather than jagged.
  float inside = smoothstep(-0.7, 0.7, depth);

  // --- 3. Knife passes ---------------------------------------------------------------
  // Split the letter into side-by-side passes about 40px (at 250px letters)
  // wide. Each has its own level; near a seam, blend over ~1.2px into the
  // previous pass so the step is crisp but not jagged.
  float passWidth = 40.0 * s * (0.8 + 0.4 * seed);
  float bandPos   = across / passWidth + seed * 13.7;
  float band      = floor(bandPos);
  float f         = fract(bandPos);
  float blend     = smoothstep(0.0, 1.2 / passWidth, f);
  float plateau   = mix(passLevel(band - 1.0, f + 1.0, seed), passLevel(band, f, seed), blend);
  // A low ridge at the far side of each pass, where its paint was pushed.
  plateau += 0.18 * exp(-pow((1.0 - f) * passWidth / (2.0 * s), 2.0));

  // Fine scrape lines along the direction of travel (very stretched noise),
  // and chatter: gentle ripples across it, from the blade skipping slightly.
  float scrape  = noise(vec2(across / (1.6 * s), along / (70.0 * s)) + seed * 9.0) - 0.5;
  float chatter = sin(along / (5.0 * s) + noise(vec2(across / (25.0 * s), seed * 40.0)) * 6.0);
  float surface = plateau - scrape * 0.16 + chatter * 0.025;

  // --- 4. Skips --------------------------------------------------------------------
  // Patches where the blade lifted: big, soft, streaky blobs of noise.
  float skip = smoothstep(0.70, 0.84,
    noise(vec2(across / (14.0 * s), along / (80.0 * s)) + seed * 5.0 + band * 3.1)) * uKnife;

  // The knife's level above the canvas, with the marks scaled by uKnife.
  float top = uTextHeight * (1.0 + surface * uKnife);

  // --- 5. Edge ridge -------------------------------------------------------------
  // A bump about 4px inside the edge (never less than 2.5px, so it still
  // shows on small letters), its height wandering along the edge.
  float ridgeAt = max(4.0 * s, 2.5);
  float ridge   = uTextHeight * 0.32 * (0.5 + noise(p / (12.0 * s) + seed * 3.3))
                * exp(-pow((depth - ridgeAt) / (ridgeAt * 0.65), 2.0));
  top += ridge;

  // --- 6. Scraping over the background ---------------------------------------------
  // The knife presses the wet paint under it down a little ("pressed"), then
  // its paint fills up to the knife's level. Where the background still
  // pokes up through that level, the blade only leaves a thin coat there.
  float pressed   = oldHeight * 0.6;
  const float THIN_COAT = 0.08;
  float scraped   = smoothstep(-0.15, 0.25, pressed + THIN_COAT - top);
  float thickness = max(top - pressed, THIN_COAT) * (1.0 - 0.8 * skip);
  float letterHeight = pressed + thickness;

  // The edge rises steeply over about 2px: a cut edge, not a soft mound.
  float rise = smoothstep(-0.6, 1.4, depth);

  // --- 5b. Spill just outside the edge ----------------------------------------------
  // Thin, patchy paint squeezed out past the edge, fading over a few px.
  float outside   = 1.0 - inside;
  float spillFade = exp(min(depth, 0.0) / (5.0 * s));
  float spillMask = smoothstep(0.35, 0.75, noise(p / (6.0 * s) + seed * 3.0));
  float spillCov  = 0.85 * spillMask * spillFade * outside;
  float spillThick = uTextHeight * 0.22 * spillMask * spillFade;

  // --- Coverage and height ------------------------------------------------------------
  // Skips and scraped spots are thin, so the background shows through them.
  float coverage = inside * (1.0 - 0.75 * skip) * (1.0 - 0.6 * scraped);
  coverage = max(coverage, spillCov);
  float height = mix(oldHeight + spillThick * outside, letterHeight, rise);

  // --- 7. Colour: white, never pure white --------------------------------------------
  vec3 warmWhite = vec3(0.955, 0.935, 0.885);
  vec3 coolWhite = vec3(0.905, 0.925, 0.950);
  float tint = noise(p / (70.0 * s) + seed * 7.0) * 0.6 + hash1(band + seed * 11.0) * 0.4;
  vec3 white = mix(coolWhite, warmWhite, tint) * (0.97 + 0.03 * noise(p / (3.0 * s)));

  // Contamination: strongest where the knife touched down (small `along`),
  // fading over ~90px (at 250px letters), in streaks across the pass. Thin
  // spots (skips, scrapes) drag in more of the colour underneath. Only where
  // there's background paint to pick up (old.a).
  float touchdown = max(along - hash1(band + seed * 19.0) * 25.0 * s, 0.0);
  float fade      = exp(-touchdown / (90.0 * s));
  float streaks   = smoothstep(0.3, 0.9, noise(vec2(across / (3.0 * s), along / (120.0 * s)) + seed * 21.0));
  float pickup    = uContamination * old.a
                  * (fade * (0.35 + 0.65 * streaks) + 0.5 * (skip + scraped));
  pickup = clamp(pickup * 0.8, 0.0, 0.85);
  // Pigment mixing is costly (38 wavelengths), so only where it matters.
  vec3 paintColor = pickup > 0.002 ? spectralMix(white, old.rgb, pickup) : white;

  // "Over" compositing, as in composite.frag: new paint covers `coverage`
  // of the pixel and the old paint shows in the rest (a plain average:
  // side-by-side specks blend like light, not like mixed pigment).
  float newCoverage = coverage + old.a * (1.0 - coverage);
  vec3 color = newCoverage > 0.0
    ? (paintColor * coverage + old.rgb * old.a * (1.0 - coverage)) / newCoverage
    : vec3(0.0);

  // Gloss: knife paint is smooth and shiny (1), a bit less so where it skipped.
  float gloss = mix(oldGloss, 1.0 - 0.4 * skip, max(rise * inside, spillCov));

  outPaint  = vec4(color, newCoverage);
  outHeight = vec4(height, gloss, 0.0, 1.0);
}
