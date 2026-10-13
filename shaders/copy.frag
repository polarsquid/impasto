#version 300 es
precision highp float;

// =============================================================================
// copy.frag
// -----------------------------------------------------------------------------
// Copies both surface textures (paint + height) pixel for pixel into another
// surface. Used with the scissor test, so only the rectangle a finished
// stroke touched gets copied (see endStroke() in surface.js).
//
// texelFetch reads one exact pixel by its integer coordinates, with no
// smoothing between neighbours. gl_FragCoord.xy is the pixel being written
// (e.g. 10.5, 20.5 = the centre of pixel 10, 20), so this is a 1:1 copy.
// =============================================================================

uniform sampler2D uPaint;
uniform sampler2D uHeight;

layout(location = 0) out vec4 outPaint;
layout(location = 1) out vec4 outHeight;

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  outPaint  = texelFetch(uPaint, pixel, 0);
  outHeight = texelFetch(uHeight, pixel, 0);
}
