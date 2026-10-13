#version 300 es
precision highp float;

// =============================================================================
// composite.frag
// -----------------------------------------------------------------------------
// Lays the stroke buffer (the stroke being painted) on top of the paint
// surface (everything painted so far) and writes the result into a NEW
// surface.
//
// Why a new surface? A shader can't safely read from and write to the same
// texture at once. So we keep two surfaces and "ping-pong" between them:
// read from A, write to B, then swap roles. (See surface.js.)
//
// A surface is TWO textures, written in one go (multiple render targets):
//
//   paint  (output 0)  rgb = paint colour (sRGB, as you'd pick it)
//                      a   = coverage: how much paint hides the canvas, 0..1
//   height (output 1)  r   = paint thickness of all the paint stacked here
//
// The canvas (ground) colour is deliberately NOT stored here. The lighting
// shader mixes it in using the coverage, so it can be changed at any time
// without repainting.
// =============================================================================

// Pigment mixing (a GLSL port of Spectral.js). Our shader loader pastes the
// file's contents in place of this line; see loadShaderSources() in gl-utils.js.
#include "lib/spectral.glsl"

in vec2 vUv;

uniform sampler2D uPaint;    // surface so far: colour + coverage
uniform sampler2D uHeight;   // surface so far: thickness
uniform sampler2D uStroke;   // the current stroke: r = thickness, g = coverage
uniform vec3  uColor;        // the brush's paint colour
uniform float uFlatten;      // how much the brush squashes paint underneath it
uniform float uPickup;       // how much wet paint underneath tints the brush
uniform float uThickness;    // the brush's full paint thickness (for comparison)

// Two outputs: location 0 goes to the paint texture, 1 to the height texture.
layout(location = 0) out vec4 outPaint;
layout(location = 1) out vec4 outHeight;

void main() {
  vec4  old       = texture(uPaint, vUv);
  float oldHeight = texture(uHeight, vUv).r;
  vec2  stroke    = texture(uStroke, vUv).rg;
  float thickness = stroke.r;
  float coverage  = stroke.g;

  // --- Colour ------------------------------------------------------------------
  // Wet-on-wet "pickup": where there's already paint underneath, the brush
  // drags some of it along, so the new colour gets contaminated.
  // (Bare canvas has height ~0, so nothing gets picked up there.)
  //
  // It's streaky, not even: the thin parts of the stroke (bristle grooves,
  // dry-brush tails) show more of the old colour, while the thick ridges stay
  // pure. "fullness" is how thick the paint is here compared with the body
  // of a fully loaded stroke (the body sits at ~75% of uThickness, see
  // dab.frag), 0..1. Pickup only kicks in once fullness drops below 75%.
  //
  // The picked-up paint is mixed like real pigment (spectralMix), so blue
  // dragged through wet yellow turns green rather than a dull grey. Pigment
  // mixing is expensive (38 wavelengths), so it only runs where some pickup
  // actually happens.
  float wetUnder = smoothstep(0.0, 0.2, oldHeight);
  float fullness = clamp(thickness / max(uThickness * 0.75, 0.001), 0.0, 1.0);
  float pickup   = uPickup * wetUnder * smoothstep(0.75, 0.1, fullness);
  vec3 brushColor = pickup > 0.002 ? spectralMix(uColor, old.rgb, pickup) : uColor;

  // "Over" compositing: the new paint covers `coverage` of the pixel, and the
  // old paint shows through in what's left. (This is a plain average, not
  // pigment mixing: partial coverage means separate specks of paint side by
  // side, which the eye blends like light, not like mixed pigment.) Total coverage only ever grows:
  //   newCoverage = new + old * (1 - new)
  // The colour is the coverage-weighted average of new and old paint.
  float newCoverage = coverage + old.a * (1.0 - coverage);
  vec3 color = newCoverage > 0.0
    ? (brushColor * coverage + old.rgb * old.a * (1.0 - coverage)) / newCoverage
    : vec3(0.0);

  // --- Height -------------------------------------------------------------------
  // The brush presses down on existing paint (flattening some of it), then
  // its own paint sits on top.
  float height = oldHeight * (1.0 - coverage * uFlatten) + thickness;

  outPaint  = vec4(color, newCoverage);
  outHeight = vec4(height, 0.0, 0.0, 1.0);
}
