#version 300 es
precision highp float;

// =============================================================================
// composite.frag
// -----------------------------------------------------------------------------
// Lays the stroke buffer (the stroke being painted) on top of the paint
// surface (everything painted so far) and writes the result into a NEW
// surface texture.
//
// Why a new texture? A shader can't safely read from and write to the same
// texture at once. So we keep two surface textures and "ping-pong" between
// them: read from A, write to B, then swap roles. (See surface.js.)
//
// The surface texture packs everything into one RGBA pixel:
//   rgb = paint colour (sRGB, as you'd pick it in a colour picker)
//   a   = paint height (thickness of all the paint stacked at this spot)
// =============================================================================

in vec2 vUv;

uniform sampler2D uSurface;  // everything painted so far
uniform sampler2D uStroke;   // the current stroke: r = thickness, g = coverage
uniform vec3  uColor;        // the brush's paint colour
uniform float uFlatten;      // how much the brush squashes paint underneath it
uniform float uPickup;       // how much wet paint underneath tints the brush
uniform float uThickness;    // the brush's full paint thickness (for comparison)

out vec4 outColor;

void main() {
  vec4 surface = texture(uSurface, vUv);
  vec2 stroke  = texture(uStroke, vUv).rg;
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
  // NOTE: this is a plain RGB blend for now. Phase 2 swaps in Spectral.js
  // (Kubelka-Munk) mixing, so blue + yellow makes green like real paint.
  float wetUnder = smoothstep(0.0, 0.2, surface.a);
  float fullness = clamp(thickness / max(uThickness * 0.75, 0.001), 0.0, 1.0);
  float pickup   = uPickup * wetUnder * smoothstep(0.75, 0.1, fullness);
  vec3 brushColor = mix(uColor, surface.rgb, pickup);

  // New paint covers the old colour according to coverage.
  vec3 color = mix(surface.rgb, brushColor, coverage);

  // --- Height -------------------------------------------------------------------
  // The brush presses down on existing paint (flattening some of it), then
  // its own paint sits on top.
  float height = surface.a * (1.0 - coverage * uFlatten) + thickness;

  outColor = vec4(color, height);
}
