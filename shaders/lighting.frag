#version 300 es
precision highp float;

// =============================================================================
// lighting.frag
// -----------------------------------------------------------------------------
// This is where the impasto look comes from. The surface texture only stores
// colour + height. Height is invisible by itself: we SEE thick paint because
// light catches the ridges and shadows fall into the grooves. So, for every
// pixel, this shader:
//
//   1. works out which way the paint surface is facing (its "normal"), by
//      comparing the height of neighbouring pixels,
//   2. shades it: brighter where it faces the light, darker where it faces
//      away (diffuse light),
//   3. adds a glossy highlight where the surface reflects the light toward
//      the viewer (specular light: the oily sheen on fresh paint),
//   4. marches a short ray toward the light to see if a taller ridge is in the
//      way (cast shadows),
//   5. darkens small crevices that ambient light can't reach (ambient
//      occlusion).
//
// Plus the canvas itself: its colour shows wherever paint coverage is
// incomplete, and its woven texture shows through where the paint is thin.
// =============================================================================

in vec2 vUv;

uniform sampler2D uPaint;     // rgb = paint colour (sRGB), a = coverage 0..1
uniform sampler2D uHeight;    // r = paint height
uniform vec3  uGround;        // canvas colour under the paint (sRGB)
uniform vec2  uSurfaceSize;   // surface size in pixels
uniform vec2  uTexel;         // size of one pixel in uv units = 1 / size

uniform vec3  uLightDir;      // unit vector pointing TOWARD the light
uniform vec3  uLightColor;    // warm studio lamp colour
uniform float uAmbient;       // light that comes from everywhere (0..1)
uniform float uDepth;         // how many pixels tall 1.0 unit of paint is
uniform float uSpecular;      // highlight strength
uniform float uShininess;     // highlight tightness: higher = smaller, sharper
uniform float uShadow;        // cast shadow strength 0..1
uniform float uOcclusion;     // crevice darkening strength 0..1
uniform float uWeave;         // canvas weave height (in paint units)
uniform float uWeaveScale;    // canvas thread spacing in pixels
uniform int   uViewMode;      // 0 lit, 1 colour only, 2 height, 3 normals

out vec4 outColor;

const float PI = 3.14159265;

// --- Canvas weave -------------------------------------------------------------
// A plain weave: horizontal and vertical threads alternately pass over and
// under each other, like a chequerboard. In each cell of the grid, whichever
// thread is on top makes a little rounded bump.
float weave(vec2 uv) {
  vec2 p = uv * uSurfaceSize / uWeaveScale;  // position in "thread" units
  vec2 cell = floor(p);
  vec2 f = fract(p);                          // position inside the cell 0..1
  float horizontalOnTop = mod(cell.x + cell.y, 2.0);  // chequerboard 0 or 1

  // A horizontal thread is round across its width (y) and dips at the ends
  // of the cell where it dives under the next vertical thread (x).
  float hThread = sin(PI * f.y) * (0.6 + 0.4 * sin(PI * f.x));
  float vThread = sin(PI * f.x) * (0.6 + 0.4 * sin(PI * f.y));
  return mix(vThread, hThread, horizontalOnTop);
}

// --- Total height at a point --------------------------------------------------
// Paint height plus canvas weave. The weave fades out where paint is thick,
// because thick paint buries the texture of the canvas underneath it.
float heightAt(vec2 uv) {
  float paint = texture(uHeight, uv).r;
  float canvasShows = 1.0 - smoothstep(0.0, 0.25, paint);
  return paint + weave(uv) * uWeave * canvasShows;
}

// --- Cast shadows -------------------------------------------------------------
// Walk from this pixel toward the light, a few pixels at a time. At each step
// the imaginary ray climbs (by the light's elevation angle). If the paint at
// that spot is taller than the ray, something is blocking the light.
float castShadow(vec2 uv, float startHeightPx) {
  float flatLen = length(uLightDir.xy);
  if (flatLen < 0.001) return 1.0;           // light straight overhead
  vec2  dir   = uLightDir.xy / flatLen;      // direction across the canvas
  float climb = uLightDir.z / flatLen;       // ray height gained per pixel

  float lit = 1.0;
  float t = 1.0;                             // distance travelled in pixels
  for (int i = 0; i < 24; i++) {
    float rayHeight   = startHeightPx + t * climb;
    float paintHeight = heightAt(uv + dir * t * uTexel) * uDepth;
    // How far the paint pokes above the ray, in pixels. Blend over ~1.5px
    // so shadow edges are slightly soft instead of jagged.
    float blocked = smoothstep(0.0, 1.5, paintHeight - rayHeight);
    lit = min(lit, 1.0 - blocked);
    t += max(1.0, t * 0.2);                  // small steps near, bigger far
  }
  return lit;
}

// sRGB <-> linear. Lighting maths only works properly on "linear" light
// values, but colour pickers and screens use sRGB, which is gamma-encoded.
// So: convert to linear, do the lighting, convert back.
vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c)   { return pow(c, vec3(1.0 / 2.2)); }

void main() {
  vec4  paint       = texture(uPaint, vUv);
  float paintHeight = texture(uHeight, vUv).r;
  float h = heightAt(vUv);

  // What colour is this spot? Paint over canvas, by coverage. Because the
  // ground colour is mixed in HERE rather than stored in the paint, changing
  // the canvas colour updates instantly, even under existing strokes.
  vec3 surfaceColor = mix(uGround, paint.rgb, paint.a);

  // --- 1. Surface normal from neighbouring heights -----------------------------
  // The slope in x is (height on the right - height on the left) / 2 pixels.
  // A surface rising to the right faces left, hence the minus signs (written
  // here as left - right). uDepth turns paint units into pixels so the slope
  // is measured in the same units in all three directions.
  float hL = heightAt(vUv - vec2(uTexel.x, 0.0));
  float hR = heightAt(vUv + vec2(uTexel.x, 0.0));
  float hD = heightAt(vUv - vec2(0.0, uTexel.y));
  float hU = heightAt(vUv + vec2(0.0, uTexel.y));
  vec3 normal = normalize(vec3((hL - hR) * uDepth * 0.5,
                               (hD - hU) * uDepth * 0.5,
                               1.0));

  // Debug views, handy for understanding what's going on.
  if (uViewMode == 1) { outColor = vec4(surfaceColor, 1.0); return; }
  if (uViewMode == 2) { outColor = vec4(vec3(h * 0.6), 1.0); return; }
  if (uViewMode == 3) { outColor = vec4(normal * 0.5 + 0.5, 1.0); return; }

  // --- 2. Diffuse light ------------------------------------------------------------
  // The dot product is 1 when the surface faces the light directly, 0 when
  // the light grazes along it, and negative when it faces away.
  float diffuse = max(dot(normal, uLightDir), 0.0);

  // --- 3. Specular highlight (Blinn-Phong) ----------------------------------------
  // The viewer looks straight down at the canvas: view direction (0,0,1).
  // The "half vector" sits halfway between light and view. The closer the
  // normal is to it, the stronger the reflection.
  vec3 halfVec = normalize(uLightDir + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(normal, halfVec), 0.0), uShininess);
  // Oil paint is glossy; bare canvas is matte.
  float paintiness = smoothstep(0.02, 0.2, paintHeight);
  spec *= uSpecular * mix(0.05, 1.0, paintiness);

  // --- 4. Cast shadows --------------------------------------------------------------
  float shadow = mix(1.0, castShadow(vUv, h * uDepth), uShadow);

  // --- 5. Ambient occlusion -------------------------------------------------------
  // Compare this pixel with the average height of a ring around it. If the
  // neighbours are taller, we're in a crevice and get less ambient light.
  float ring = 0.0;
  for (int i = 0; i < 8; i++) {
    float ang = float(i) * PI * 0.25;
    ring += heightAt(vUv + vec2(cos(ang), sin(ang)) * 5.0 * uTexel);
  }
  float cavity = ring / 8.0 - h;             // positive = we're in a dip
  float ao = 1.0 - clamp(cavity * uDepth * 0.12 * uOcclusion, 0.0, 0.6);

  // --- Combine ----------------------------------------------------------------------
  vec3 albedo = toLinear(surfaceColor);
  vec3 light  = uAmbient * ao + uLightColor * diffuse * shadow;
  vec3 color  = albedo * light + uLightColor * spec * shadow;

  outColor = vec4(toSrgb(color), 1.0);
}
