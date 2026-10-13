#version 300 es
precision highp float;  // use full 32-bit float precision for our maths

// =============================================================================
// dab.frag
// -----------------------------------------------------------------------------
// Runs once per pixel covered by a dab, and decides how much paint that pixel
// receives. We write into the STROKE buffer (a temporary texture that holds
// just the stroke currently being painted):
//
//   red   channel = paint thickness  (how tall the paint stands)
//   green channel = paint coverage   (0..1, how much the old surface is hidden)
//
// The stroke buffer is drawn with MAX blending (see surface.js): each pixel
// keeps the largest value any dab gave it. That matters, because dabs overlap
// heavily. If we ADDED them instead, the paint would pile up into a mountain
// wherever the brush moved slowly.
//
// What makes it look like a real loaded brush:
//   1. Cross-section: a flat-ish top with RIDGES near the edges, because a
//      brush pushes paint outwards, where it squeezes up into little walls.
//   2. Bristle grooves: each bristle carves a channel along the stroke. We
//      fake this with 1D noise that only varies ACROSS the stroke, so the
//      grooves come out as long parallel lines running ALONG it.
//   3. Running dry: as the paint load drops, the paint gets thinner and only
//      the "longest" bristles still touch the canvas (broken, scratchy marks).
// =============================================================================

in vec2  vLocal;  // x = along the stroke, y = across it, both -1..+1
in float vLoad;   // paint load 0..1
in float vTravel; // distance along the stroke, in brush radii

uniform float uThickness;  // overall paint thickness of this brush
uniform float uBristles;   // how many bristle grooves fit across the brush
uniform float uGroove;     // groove depth 0..1
uniform float uRidge;      // height of the edge ridges
uniform float uSeed;       // random seed so each stroke's bristles differ
uniform float uTipShape;   // 1 = round brush tip, higher = flatter (squarer ends)
uniform float uEdgeWobble; // how irregular the stroke edges are, 0..1

out vec4 outColor;

// --- Tiny noise helpers ------------------------------------------------------
// hash(): turns any number into a pseudo-random number in 0..1. It's not
// "good" randomness, but it's fast and plenty for visual texture.
float hash(float n) {
  return fract(sin(n * 127.1 + uSeed * 311.7) * 43758.5453);
}

// noise1(): smooth 1D "value noise". It picks random values at whole numbers
// and blends smoothly between them, giving a gentle random wiggle.
float noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);   // smoothstep curve, avoids hard kinks
  return mix(hash(i), hash(i + 1.0), u);
}

void main() {
  // --- 1. Footprint: the shape of the brush tip --------------------------------
  // Squashing the "along" axis turns the round tip into a flat one (an
  // ellipse that's wide across the stroke and thin along it). The stroke's
  // ends then come out squarish instead of as round lollipop blobs.
  float d = length(vec2(vLocal.x * uTipShape, vLocal.y));
  if (d > 1.0) discard;                   // outside the tip: draw nothing
  float footprint = 1.0 - smoothstep(0.9, 1.0, d);   // soft anti-aliased rim

  // --- 2. Cross-section profile (depends on the across position) -------------
  // Because it mostly ignores the "along" position, overlapping dabs produce
  // the same profile all the way down the stroke, and with MAX blending they
  // merge into one continuous ribbon of paint.
  //
  // Edge wobble: real paint edges are ragged. Using the distance travelled,
  // we let each side of the stroke wander in and out a little. Each side gets
  // its own noise (offset by 50) so the two edges don't wobble in sync.
  float side   = vLocal.y > 0.0 ? 50.0 : 0.0;
  float wobble = noise1(vTravel * 0.9 + side) * 0.7 + noise1(vTravel * 3.1 + side) * 0.3;
  float edge   = 1.0 - uEdgeWobble * 0.3 * wobble;  // where this side's edge sits
  float a = abs(vLocal.y) / edge;                   // 0 at centre, 1 at the edge
  if (a > 1.0) discard;
  float ridge   = uRidge * exp(-pow((a - 0.78) / 0.11, 2.0)); // bump near edge
  float edgeOff = 1.0 - smoothstep(0.86, 1.0, a);   // paint thins out at rim
  float profile = (0.75 + ridge) * edgeOff;

  // --- 3. Bristle grooves ------------------------------------------------------
  // Two layers of noise: broad clumps of bristles plus finer individual hairs.
  float b = 0.6 * noise1(vLocal.y * uBristles)
          + 0.4 * noise1(vLocal.y * uBristles * 2.7 + 17.0);
  profile *= mix(1.0 - uGroove, 1.0, b);

  // --- 4. Running dry -----------------------------------------------------------
  // A full brush (load 1) covers everything. As the load drops, a rising
  // threshold means only bristles with a high noise value "b" still deposit
  // paint, which gives the broken, dry-brush look at the end of a long stroke.
  float threshold = (1.0 - vLoad) * 1.05;
  float coverage  = smoothstep(threshold - 0.08, threshold + 0.08, b + 0.1);
  float thickness = profile * mix(0.35, 1.0, vLoad);

  coverage *= footprint;
  outColor = vec4(thickness * uThickness * coverage, coverage, 0.0, 1.0);
}
