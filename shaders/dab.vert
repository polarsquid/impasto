#version 300 es

// =============================================================================
// dab.vert
// -----------------------------------------------------------------------------
// A brush stroke is built from many overlapping "dabs" (imprints of the brush
// tip), spaced closely along the path the brush travels. This is how most
// digital painting apps work.
//
// We draw every dab of a stroke in ONE draw call using *instancing*: the GPU
// draws the same little square (6 vertices = 2 triangles) once per dab, and
// each copy ("instance") reads its own position/angle/paint-load from a buffer.
//
// The square is rotated so its local x axis points ALONG the stroke and its
// local y axis points ACROSS it. The fragment shader uses those local
// coordinates to shape the paint (ridges at the edges, bristle grooves, etc).
// =============================================================================

// Per-instance data, one vec4 per dab, uploaded from JavaScript:
//   x, y  = dab centre in surface pixels (y pointing DOWN, like the mouse)
//   z     = stroke direction angle in radians
//   w     = paint load 0..1 (1 = freshly loaded brush, 0 = bone dry)
layout(location = 0) in vec4 aDab;
// A second per-dab value: how far along the stroke this dab is, in pixels.
// Lets the fragment shader vary things ALONG the stroke (wobbly edges).
layout(location = 1) in float aTravel;

uniform vec2  uSurfaceSize;  // surface size in pixels, e.g. (1080, 1350)
uniform float uRadius;       // brush radius in pixels

out vec2  vLocal;  // position inside the dab: x = along, y = across, -1..+1
out float vLoad;   // paint load, passed through to the fragment shader
out float vTravel; // distance along the stroke in brush radii

// The 6 corners of our square (two triangles), in local -1..+1 space.
const vec2 CORNERS[6] = vec2[6](
  vec2(-1.0, -1.0), vec2( 1.0, -1.0), vec2( 1.0,  1.0),
  vec2(-1.0, -1.0), vec2( 1.0,  1.0), vec2(-1.0,  1.0)
);

void main() {
  vec2 corner = CORNERS[gl_VertexID];

  // Build the two axes of the rotated square from the stroke angle.
  float c = cos(aDab.z);
  float s = sin(aDab.z);
  vec2 along  = vec2( c, s);   // unit vector pointing along the stroke
  vec2 across = vec2(-s, c);   // perpendicular to it

  // Corner position in surface pixels.
  vec2 pos = aDab.xy + (corner.x * along + corner.y * across) * uRadius;

  // Pixels -> clip space (-1..+1). We flip y because the mouse/our stroke
  // data has y pointing DOWN, but clip space has y pointing UP. Doing the flip
  // here means the painting comes out the right way up on screen.
  vec2 clip = vec2(pos.x / uSurfaceSize.x * 2.0 - 1.0,
                   1.0 - pos.y / uSurfaceSize.y * 2.0);

  vLocal = corner;
  vLoad  = aDab.w;
  vTravel = aTravel / uRadius;  // in radii, so wobble scales with brush size
  gl_Position = vec4(clip, 0.0, 1.0);
}
