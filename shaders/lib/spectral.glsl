// =============================================================================
// spectral.glsl  (GENERATED - do not edit by hand)
// -----------------------------------------------------------------------------
// A GLSL port of the colour mixing in Spectral.js v3.0.0 by Ronald van Wijnen
// (MIT licence, see lib/LICENSES/spectral.js-LICENSE.txt). The data tables
// below were copied programmatically from lib/spectral.js, so the GPU mixes
// colours exactly the way the JavaScript library does.
//
// No #version line here: this file is pasted INTO other shaders by our
// "#include" support in gl-utils.js (GLSL has no includes of its own).
//
// How pigment mixing works (Kubelka-Munk theory), in short:
//   1. Turn each RGB colour into a reflectance SPECTRUM: how much light it
//      reflects at each of 38 wavelengths across the visible range.
//   2. Turn reflectance into K/S, the ratio of light the paint ABSORBS to
//      light it SCATTERS, at each wavelength.
//   3. Mixing paints = averaging their K/S, weighted by concentration.
//   4. Turn the mixed K/S back into reflectance, then into a colour we see
//      (via the CIE colour-matching functions), then back into RGB.
// Because absorption combines (each pigment soaks up its part of the
// spectrum), blue + yellow gives green instead of RGB's dull grey.
// =============================================================================

#define SPECTRAL_SIZE 38

// The 7 "building block" spectra that any RGB colour is made from:
// white, cyan, magenta, yellow, red, green, blue.
const float SPECTRAL_W[SPECTRAL_SIZE] = float[SPECTRAL_SIZE](
  1.00116073, 1.00116065, 1.00116032, 1.00115867, 1.00115260, 1.00113253,
  1.00108501, 1.00099688, 1.00086525, 1.00069629, 1.00050496, 1.00030808,
  1.00011967, 0.999952766, 0.999821837, 0.999738610, 0.999709552, 0.999731930,
  0.999799436, 0.999900330, 1.00002041, 1.00014479, 1.00025998, 1.00035580,
  1.00042754, 1.00047623, 1.00050721, 1.00052519, 1.00053510, 1.00054022,
  1.00054273, 1.00054390, 1.00054448, 1.00054477, 1.00054490, 1.00054496,
  1.00054499, 1.00054500
);
const float SPECTRAL_C[SPECTRAL_SIZE] = float[SPECTRAL_SIZE](
  0.970585001, 0.970592498, 0.970625349, 0.970786806, 0.971368673, 0.973163231,
  0.976740223, 0.981587605, 0.986280266, 0.989949148, 0.992492702, 0.994145680,
  0.995183975, 0.995756750, 0.995912818, 0.995606158, 0.994597601, 0.992215715,
  0.986236453, 0.967943337, 0.891285004, 0.536202478, 0.154108119, 0.0574575093,
  0.0315349873, 0.0222633920, 0.0182022841, 0.0162990560, 0.0153656239, 0.0149111569,
  0.0146954340, 0.0145964147, 0.0145470157, 0.0145228772, 0.0145120341, 0.0145066941,
  0.0145044507, 0.0145038009
);
const float SPECTRAL_M[SPECTRAL_SIZE] = float[SPECTRAL_SIZE](
  0.990673557, 0.990671525, 0.990662582, 0.990618108, 0.990451481, 0.989871081,
  0.988286609, 0.984290693, 0.973934906, 0.941817838, 0.817390326, 0.432472805,
  0.138453978, 0.0537347217, 0.0292174997, 0.0213136518, 0.0201349530, 0.0241323096,
  0.0372236145, 0.0760506553, 0.205375472, 0.541268903, 0.815841685, 0.912817704,
  0.946339830, 0.959927696, 0.966260595, 0.969325970, 0.970854537, 0.971605067,
  0.971962770, 0.972127272, 0.972209418, 0.972249578, 0.972267622, 0.972276509,
  0.972280243, 0.972281325
);
const float SPECTRAL_Y[SPECTRAL_SIZE] = float[SPECTRAL_SIZE](
  0.0210523372, 0.0210564628, 0.0210746179, 0.0211649058, 0.0215027957, 0.0226738799,
  0.0258235650, 0.0334879386, 0.0519069664, 0.100749015, 0.239129900, 0.534804312,
  0.797807579, 0.911449894, 0.953797963, 0.971241615, 0.979303124, 0.983380120,
  0.985461247, 0.986435047, 0.986738251, 0.986617882, 0.986277777, 0.985860592,
  0.985474928, 0.985176935, 0.984971574, 0.984846303, 0.984775352, 0.984738067,
  0.984719648, 0.984711023, 0.984706683, 0.984704554, 0.984703596, 0.984703124,
  0.984702926, 0.984702868
);
const float SPECTRAL_R[SPECTRAL_SIZE] = float[SPECTRAL_SIZE](
  0.0315605738, 0.0315520718, 0.0315148216, 0.0313318045, 0.0306729858, 0.0286480477,
  0.0246450407, 0.0192960754, 0.0142066612, 0.0102942609, 0.00761914605, 0.00589804108,
  0.00482332478, 0.00422987484, 0.00405991713, 0.00435336956, 0.00534344260, 0.00769172010,
  0.0135969796, 0.0316975443, 0.107861196, 0.463812603, 0.847055405, 0.943185409,
  0.968862151, 0.978030667, 0.982043644, 0.983923624, 0.984845484, 0.985294276,
  0.985507295, 0.985605072, 0.985653850, 0.985677685, 0.985688392, 0.985693665,
  0.985695880, 0.985696521
);
const float SPECTRAL_G[SPECTRAL_SIZE] = float[SPECTRAL_SIZE](
  0.00955607476, 0.00955815801, 0.00956732454, 0.00961291263, 0.00978370904, 0.0103786227,
  0.0120026452, 0.0160977721, 0.0267061902, 0.0595555440, 0.186039827, 0.570579820,
  0.861467768, 0.945879090, 0.970465486, 0.978413630, 0.979589031, 0.975533537,
  0.962288755, 0.923121575, 0.793434019, 0.459270136, 0.185574104, 0.0881774960,
  0.0543630229, 0.0406288447, 0.0342215204, 0.0311185791, 0.0295708898, 0.0288108739,
  0.0284486271, 0.0282820302, 0.0281988376, 0.0281581655, 0.0281398910, 0.0281308902,
  0.0281271087, 0.0281260134
);
const float SPECTRAL_B[SPECTRAL_SIZE] = float[SPECTRAL_SIZE](
  0.979404753, 0.979400707, 0.979382903, 0.979294365, 0.978963015, 0.977814467,
  0.974724321, 0.967198482, 0.949079658, 0.900850129, 0.763150445, 0.465922172,
  0.201263280, 0.0877524413, 0.0457176793, 0.0284706051, 0.0205271768, 0.0165302792,
  0.0145135107, 0.0136003509, 0.0133604259, 0.0135488943, 0.0139594356, 0.0144434256,
  0.0148854441, 0.0152254297, 0.0154592848, 0.0156018026, 0.0156824871, 0.0157248764,
  0.0157458109, 0.0157556123, 0.0157605444, 0.0157629638, 0.0157640526, 0.0157645892,
  0.0157648148, 0.0157648801
);

// CIE colour-matching functions (D65 daylight): how strongly each
// wavelength contributes to the X, Y and Z colour channels.
const float SPECTRAL_CMF_X[SPECTRAL_SIZE] = float[SPECTRAL_SIZE](
  0.0000646919990, 0.000219409900, 0.00112057435, 0.00376661341, 0.0118805536, 0.0232864424,
  0.0345594182, 0.0372237901, 0.0324183761, 0.0212332056, 0.0104909908, 0.00329583758,
  0.000507035163, 0.000948674206, 0.00627371810, 0.0168646242, 0.0286896490, 0.0426748125,
  0.0562547481, 0.0694703973, 0.0830531517, 0.0861260963, 0.0904661377, 0.0850038651,
  0.0709066691, 0.0506288916, 0.0354739619, 0.0214682103, 0.0125164568, 0.00680458164,
  0.00346456579, 0.00149760975, 0.000769700481, 0.000407368058, 0.000169010403, 0.0000952245150,
  0.0000490309873, 0.0000199961492
);
const float SPECTRAL_CMF_Y[SPECTRAL_SIZE] = float[SPECTRAL_SIZE](
  0.00000184428944, 0.00000620532359, 0.0000310096047, 0.000104748385, 0.000353640530, 0.000951471406,
  0.00228226317, 0.00420732904, 0.00668879837, 0.00988839602, 0.0152494514, 0.0214183109,
  0.0334229302, 0.0513100135, 0.0704020839, 0.0878387073, 0.0942490536, 0.0979566703,
  0.0941521857, 0.0867810237, 0.0788565339, 0.0635267026, 0.0537414168, 0.0426460644,
  0.0316173493, 0.0208852059, 0.0138601101, 0.00810264020, 0.00463010226, 0.00249138001,
  0.00125930337, 0.000541646522, 0.000277952892, 0.000147108067, 0.0000610327473, 0.0000343873230,
  0.0000177059860, 0.00000722097491
);
const float SPECTRAL_CMF_Z[SPECTRAL_SIZE] = float[SPECTRAL_SIZE](
  0.000305017148, 0.00103680667, 0.00531313633, 0.0179543926, 0.0570775815, 0.113651619,
  0.173358726, 0.196206576, 0.186082371, 0.139950475, 0.0891745294, 0.0478962114,
  0.0281456254, 0.0161376623, 0.00775910192, 0.00429614837, 0.00200550921, 0.000861471110,
  0.000369038718, 0.000191428729, 0.000149555586, 0.0000923109285, 0.0000681349182, 0.0000288263656,
  0.0000157671821, 0.00000394060410, 0.00000158401259, 0.00000000, 0.00000000, 0.00000000,
  0.00000000, 0.00000000, 0.00000000, 0.00000000, 0.00000000, 0.00000000,
  0.00000000, 0.00000000
);

// XYZ -> linear RGB. GLSL matrices are written column by column.
const mat3 SPECTRAL_XYZ_TO_RGB = mat3(
  3.24096994, -0.969243636, 0.0556300797,   // column 1
  -1.53738318, 1.87596750, -0.203976959,   // column 2
  -0.498610760, 0.0415550574, 1.05697151    // column 3
);

float spectral_uncompand(float x) { return x > 0.04045 ? pow((x + 0.055) / 1.055, 2.4) : x / 12.92; }
float spectral_compand(float x)   { return x > 0.0031308 ? 1.055 * pow(x, 1.0 / 2.4) - 0.055 : x * 12.92; }

// Step 1: linear RGB -> reflectance at wavelength i.
// The colour is split into a white part plus cyan/magenta/yellow and
// red/green/blue parts, each with a known spectrum.
float spectral_reflectance(vec3 lrgb, int i) {
  float w = min(lrgb.r, min(lrgb.g, lrgb.b));
  vec3 c3 = lrgb - w;
  float c = min(c3.g, c3.b);
  float m = min(c3.r, c3.b);
  float y = min(c3.r, c3.g);
  float r = max(0.0, min(c3.r - c3.b, c3.r - c3.g));
  float g = max(0.0, min(c3.g - c3.b, c3.g - c3.r));
  float b = max(0.0, min(c3.b - c3.g, c3.b - c3.r));
  return max(1e-7, w * SPECTRAL_W[i] + c * SPECTRAL_C[i] + m * SPECTRAL_M[i]
                 + y * SPECTRAL_Y[i] + r * SPECTRAL_R[i] + g * SPECTRAL_G[i] + b * SPECTRAL_B[i]);
}

// Step 2 and back: reflectance <-> K/S (absorption over scattering).
float spectral_ks(float R) { return (1.0 - R) * (1.0 - R) / (2.0 * R); }
float spectral_km(float ks) { return 1.0 + ks - sqrt(ks * ks + 2.0 * ks); }

/**
 * Mix two paint colours like real pigment.
 * a, b : sRGB colours, 0..1 (as you'd pick them)
 * t    : 0 = all a, 1 = all b
 * Same result as spectral.mix([a, 1 - t], [b, t]) in Spectral.js.
 */
vec3 spectralMix(vec3 a, vec3 b, float t) {
  vec3 la = vec3(spectral_uncompand(a.r), spectral_uncompand(a.g), spectral_uncompand(a.b));
  vec3 lb = vec3(spectral_uncompand(b.r), spectral_uncompand(b.g), spectral_uncompand(b.b));

  // Step 1 for both colours, computed once and kept: each colour's
  // reflectance spectrum, plus its brightness (the Y of XYZ). Brightness
  // weights the mix: a dark pigment needs less paint for the same effect.
  float Ra[SPECTRAL_SIZE];
  float Rb[SPECTRAL_SIZE];
  float lumA = 0.0;
  float lumB = 0.0;
  for (int i = 0; i < SPECTRAL_SIZE; i++) {
    Ra[i] = spectral_reflectance(la, i);
    Rb[i] = spectral_reflectance(lb, i);
    lumA += SPECTRAL_CMF_Y[i] * Ra[i];
    lumB += SPECTRAL_CMF_Y[i] * Rb[i];
  }

  // Concentration of each paint in the mix (Spectral.js: factor^2 * luminance).
  float ca = (1.0 - t) * (1.0 - t) * max(lumA, 1e-7);
  float cb = t * t * max(lumB, 1e-7);
  float total = max(ca + cb, 1e-7);

  // Steps 2 to 4: average K/S at every wavelength, convert back to
  // reflectance, and add up its contribution to X, Y and Z as we go.
  vec3 xyz = vec3(0.0);
  for (int i = 0; i < SPECTRAL_SIZE; i++) {
    float ks = (spectral_ks(Ra[i]) * ca + spectral_ks(Rb[i]) * cb) / total;
    float R = spectral_km(ks);
    xyz += vec3(SPECTRAL_CMF_X[i], SPECTRAL_CMF_Y[i], SPECTRAL_CMF_Z[i]) * R;
  }

  vec3 lrgb = clamp(SPECTRAL_XYZ_TO_RGB * xyz, 0.0, 1.0);
  return vec3(spectral_compand(lrgb.r), spectral_compand(lrgb.g), spectral_compand(lrgb.b));
}
