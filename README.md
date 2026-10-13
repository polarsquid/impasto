# Impasto

A browser-based generator for paintings that look like thick oil paint
(impasto), built with plain JavaScript and WebGL2. No build step, no
dependencies, no AI: everything is procedural and runs on your GPU.

The eventual app: procedural painted backgrounds with art-direction
controls, with a short message laid over the top in white palette-knife
lettering (XBAND Rough).

## Running it

The page loads its shaders with `fetch()`, which browsers block when you
open a file straight from disk. Serve the folder over http instead:

```bash
npx serve .            # then open the address it prints
# or
python3 -m http.server # then open http://localhost:8000
```

VS Code's Live Server extension works too.

Needs a WebGL2 browser (any current Chrome, Firefox, Safari or Edge).

## How it works

Paint is stored on the GPU as a **height field**: every pixel has a colour
and a paint thickness. Thickness alone is invisible; impasto reads as
impasto because light catches the ridges and shadows fall into the grooves.
So the image you see is a lighting calculation run over that height field
every time something changes.

```
pointer / generator          StrokePath            PaintSurface               LightingPass
 ───────────────────>  points ──> evenly spaced ──> stroke buffer (MAX blend)
                                   dabs              + composite into surface ──> normals, diffuse,
                                                       (ping-pong textures)       sheen, shadows,
                                                                                  weave ──> screen
```

1. **Dabs** (`js/strokes/stroke-path.js`). A stroke is many overlapping
   imprints of the brush tip, spaced evenly along its path. Each dab knows
   its direction, how much paint is left on the brush, and how far along
   the stroke it is.
2. **Stroke buffer** (`shaders/dab.frag`). Dabs are stamped with MAX
   blending into a scratch texture, so they merge into one smooth ribbon
   instead of piling up. The shader shapes the paint: edge ridges, bristle
   grooves, ragged edges, and dry-brush breakup as the load runs out.
3. **Composite** (`shaders/composite.frag`). The finished stroke is laid on
   the painting: its height stacks on top, the brush flattens the paint it
   presses on, and it picks up a little wet colour in its thin parts.
4. **Lighting** (`shaders/lighting.frag`). Surface normals from neighbouring
   heights, diffuse light, a glossy sheen, ray-marched cast shadows,
   crevice darkening, and canvas weave where the paint is thin.

Every file is heavily commented; start at `js/main.js` and follow the
imports.

## Project layout

```
index.html              page structure
css/painter.css         styles
js/main.js              entry point: settings, panel, render loop
js/renderer/
  gl-utils.js           WebGL helpers: programs, render targets
  surface.js            the paint surface and stroke pipeline
  lighting.js           final lighting pass
js/strokes/
  stroke-path.js        path -> evenly spaced dabs
  pointer-brush.js      paint by hand with mouse / touch / pen
  test-strokes.js       quick test composition (placeholder for phase 2)
js/ui/
  light-pad.js          drag-the-lamp light control
  controls.js           slider builder
shaders/                GLSL shader programs
fonts/                  XBAND_Rough.ttf (used from phase 3)
presets/                saved background presets (from phase 4)
```

## Roadmap

- [x] **Phase 1:** lit height field, test brush, light controls
- [ ] **Phase 2:** procedural background generator (flow fields, layered
      coarse-to-fine strokes, Spectral.js pigment mixing)
- [ ] **Phase 3:** palette-knife text: font outlines -> signed distance
      field -> raised white lettering
- [ ] **Phase 4:** art-direction controls, text safe zone, presets,
      touch-up brush

## Credits

- Pigment mixing (from phase 2): [Spectral.js](https://github.com/rvanwijnen/spectral.js)
  by Ronald van Wijnen, MIT licence.
- Font: XBAND Rough, kept in this private repo for personal use only.
