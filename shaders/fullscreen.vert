#version 300 es
// ^ This line MUST be the very first line of every shader (no comments above
//   it). It tells the browser we're writing GLSL ES 3.00, the WebGL2 dialect.

// =============================================================================
// fullscreen.vert
// -----------------------------------------------------------------------------
// A "fullscreen pass" is the bread and butter of GPU image processing: we draw
// one shape that covers the whole output, and the fragment shader then runs
// once for every pixel. Compositing and lighting both work this way.
//
// The trick here: instead of uploading a rectangle made of two triangles, we
// draw ONE oversized triangle that covers the screen. Anything outside the
// screen is clipped away for free. We don't even need a vertex buffer: WebGL2
// gives us gl_VertexID (0, 1, 2) and we compute the corners from that.
//
//      (0,2) *
//            | .
//            |    .
//      (0,1) +------+ (1,1)   <- the visible screen is the unit square
//            |      |  .         inside the big triangle
//            |      |     .
//      (0,0) *------+-------* (2,0)
// =============================================================================

// "out" variables are passed from this vertex shader to the fragment shader,
// smoothly interpolated across the triangle.
out vec2 vUv;   // texture coordinate: (0,0) bottom-left, (1,1) top-right

void main() {
  // Bit tricks to turn the vertex index into (0,0), (2,0), (0,2):
  //   id 0 -> x = 0, y = 0
  //   id 1 -> x = 2, y = 0
  //   id 2 -> x = 0, y = 2
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));

  vUv = p;

  // gl_Position is in "clip space", where the screen spans -1..+1 on both
  // axes. So we map 0..2 -> -1..+3.
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
