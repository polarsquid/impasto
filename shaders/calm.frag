#version 300 es
precision highp float;

// =============================================================================
// calm.frag
// -----------------------------------------------------------------------------
// The text "safe zone": quietens the background behind the lettering so the
// white letters read clearly, without a box or a dark scrim. It runs over the
// finished background (just before the letters are painted) and, inside a
// soft-edged band around the text block:
//
//   1. FLATTENS the relief, so fewer ridges catch the light and fewer cast
//      shadows compete with the letters' own;
//   2. LOWERS THE CONTRAST, by pulling each pixel's colour toward the average
//      colour of the paint around it (a small blur), so busy light-and-dark
//      stroke patterns soften while the overall colour stays the same;
//   3. DARKENS a touch, so white letters stand out more.
//
// The band is a rounded rectangle around the text, with a wide, slightly
// irregular feathered edge, so it fades into the painting rather than
// reading as a shape.
// =============================================================================

uniform sampler2D uPaint;     // the background: rgb colour, a coverage
uniform sampler2D uHeight;    // the background: r thickness, g gloss
uniform vec2  uSurfaceSize;   // surface size in px
uniform vec4  uTextBox;       // the text block: x0, y0, x1, y1 (px, y down)
uniform float uPad;           // full-strength area reaches this far past the text (px)
uniform float uFeather;       // then fades out over this many px
uniform float uStrength;      // 0 = no change, 1 = strongest calming

layout(location = 0) out vec4 outPaint;
layout(location = 1) out vec4 outHeight;

// Smooth 2D value noise, 0..1 (see text.frag for how it works).
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Distance from point p to a rounded rectangle centred at the origin with
// half-size b and corner radius r: negative inside, positive outside.
// (The standard "signed distance to a box" formula, with rounded corners.)
float roundedBoxDistance(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uSurfaceSize;
  vec4 paint = texture(uPaint, uv);
  vec2 hg    = texture(uHeight, uv).rg;

  // Position in px with y DOWN, to match the text box from JavaScript.
  vec2 p = vec2(gl_FragCoord.x, uSurfaceSize.y - gl_FragCoord.y);

  // --- How strongly this pixel is calmed (0..1) ------------------------------------
  vec2 centre = (uTextBox.xy + uTextBox.zw) * 0.5;
  vec2 halfSize = (uTextBox.zw - uTextBox.xy) * 0.5 + uPad;
  float d = roundedBoxDistance(p - centre, halfSize, min(halfSize.x, halfSize.y) * 0.6);
  // Wobble the edge with slow noise, so the fade isn't a perfect rounded box.
  d += (noise(p / (uFeather * 0.8)) - 0.5) * uFeather * 0.6;
  float amount = (1.0 - smoothstep(0.0, uFeather, d)) * uStrength;

  if (amount < 0.002) {   // outside the band: unchanged
    outPaint = paint;
    outHeight = vec4(hg, 0.0, 1.0);
    return;
  }

  // --- Local average colour: a ring of 12 samples, 10px out, plus this pixel ----------
  // Weighted by coverage, so bare canvas (no paint) doesn't pull the average.
  vec3  sum    = paint.rgb * paint.a;
  float weight = paint.a;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5236;               // 30 degrees apart
    vec2 offset = vec2(cos(a), sin(a)) * 10.0 / uSurfaceSize;
    vec4 s = texture(uPaint, uv + offset);
    sum += s.rgb * s.a;
    weight += s.a;
  }
  vec3 average = weight > 0.0 ? sum / weight : paint.rgb;

  // --- Calm it ------------------------------------------------------------------------
  vec3 color = mix(paint.rgb, average, 0.6 * amount);   // 2. lower contrast
  color *= 1.0 - 0.25 * amount;                          // 3. darken a touch
  float height = hg.r * (1.0 - 0.75 * amount);           // 1. flatten

  outPaint  = vec4(color, paint.a);
  outHeight = vec4(height, hg.g, 0.0, 1.0);
}
