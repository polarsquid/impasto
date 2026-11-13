# Impasto

A browser-based generator for paintings that look like thick oil paint
(impasto), built with plain JavaScript and WebGL2. No build step, no
install, no AI: everything is procedural and runs on your GPU.

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

## Tabs: one per build phase

Each build phase has its own tab (and address: `index.html#brush`,
`index.html#generator`, `index.html#text`). Tabs are cumulative: a later phase shows everything
the earlier ones do, plus its new features. They all run on the same shared
engine, so engine improvements (like better colour mixing) show up in every
tab. Each tab keeps its own painting while you switch around. For exact
snapshots of past versions, use git tags (`git tag phase-2`).

| Tab | Adds |
| --- | --- |
| 1 Brush and light | Lit height field, hand brush, light pad, canvas colour |
| 2 Generator | Procedural backgrounds: flow fields, weighted palettes, three layers, seeds, pigment mixing |
| 3 Text | Your message in white palette-knife impasto (XBAND Rough or Open Sans ExtraBold) over the generated background |

The canvas can be **portrait** (1080 × 1350) or **landscape** (1350 × 1080),
set in the shared Canvas section. Switching repaints every tab at the new
shape.

## How it works

Paint is stored on the GPU as a **height field**: every pixel has a paint
colour, a coverage (how much of the canvas the paint hides), a paint
thickness and a gloss (palette-knife paint is shinier than brushed paint). Thickness alone is invisible; impasto reads as
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
   presses on, and it picks up a little wet colour in its thin parts, mixed
   like real pigment (`shaders/lib/spectral.glsl`). Colour and height go to
   two textures in one pass (multiple render targets). Only the stroke's
   bounding box is processed (the scissor test), which keeps the generator
   fast.
4. **Lighting** (`shaders/lighting.frag`). Surface normals from neighbouring
   heights, diffuse light, a glossy sheen, ray-marched cast shadows,
   crevice darkening, and canvas weave where the paint is thin. The canvas
   colour is mixed in here using the coverage, which is why changing it
   updates instantly, even under existing paint.

### The generator (phase 2)

```
settings + seed ──> composer.js ──────────────> stroke-runner.js ──> surface
                    flow field (gesture)        all at once, or over
                    palette (weighted, mixed)   ~4 seconds
                    3 layers, coverage targets  ("watch it paint")
```

`js/generator/composer.js` plans every stroke as plain data from the
settings and a seed (same seed + settings = same painting), and
`js/generator/stroke-runner.js` paints the plan. Strokes follow a flow field
(`flow-field.js`), get colours from a weighted palette with real pigment
mixing (`palettes.js`, via Spectral.js), and are spread evenly with a
jittered grid, coarse to fine. Each layer's Amount is the fraction of the
canvas it covers: `coverage.js` keeps score while planning, and at Amount 1
the composer aims extra strokes at every remaining gap. The underpainting
uses only the last two palette colours (marked "base" in the panel).

### The lettering (phase 3)

```
message ──> layout.js ──────────> text-field.js ──────────> text.frag ──> surface
            balanced line breaks   letters drawn, then a      knife paint: plateau,
            auto-fit, jitter,      signed distance field      ridge, spill, passes,
            knife direction        (distance to the edge)     skips, white + pickup
```

`js/text/layout.js` breaks the message into balanced lines (or uses your own
line breaks), fits it to the canvas and places each letter, with a little
optional jitter. `js/text/text-field.js` draws the letters and computes a
**signed distance field**: for every pixel, how far it is from the nearest
letter edge (negative inside). `shaders/text.frag` turns that into palette
knife paint: rough edges (noise added to the distance), a flat top laid in
broad passes with steps, scrapes and skips, a ridge just inside the edge,
a little spill outside, warm and cool whites, and background colour picked
up where the knife touched down. It writes into the same surface textures
as the brushes, so the letters are lit and shadowed like everything else.

The background is snapshotted when it's finished, so changing the text
only repaints the lettering, never the background.

Every file is heavily commented; start at `js/main.js` and follow the
imports. To see how a tab is put together, read `js/phases/phase1-brush.js`
(the simplest), then `js/phases/phase2-generator.js` and
`js/phases/phase3-text.js` (which builds on it).

## Project layout

```
index.html                 page shell: canvas + panel
css/painter.css            styles
js/main.js                 app shell: settings, tabs, render loop
js/phases/
  phase1-brush.js          tab 1: brush and light
  phase2-generator.js      tab 2: generator
  phase3-text.js           tab 3: palette-knife text
js/renderer/
  gl-utils.js              WebGL helpers: programs, targets, #include, scissor
  surface.js               the paint surface and stroke pipeline
  lighting.js              final lighting pass
js/strokes/
  stroke-path.js           path -> evenly spaced dabs
  pointer-brush.js         paint by hand with mouse / touch / pen
  test-strokes.js          quick test composition (tab 1)
js/generator/
  composer.js              plans a painting: layers, placement, paths
  coverage.js              tracks how much of the canvas a layer covers
  flow-field.js            stroke direction patterns (the gesture)
  palettes.js              palette presets and per-stroke colour picking
  stroke-runner.js         paints a plan, instantly or progressively
  random.js                seeded random numbers
js/text/
  font.js                  loads the lettering font (opentype.js)
  layout.js                line breaks, fitting, letter placement
  text-field.js            letters -> signed distance field
  text-painter.js          uploads the field and runs text.frag
js/color/
  pigment.js               colour helpers + pigment mixing (Spectral.js)
js/ui/
  shared-sections.js       light, canvas, paint character, brush, view
  controls.js              sliders, sections, buttons, tooltips
  light-pad.js             drag-the-lamp light control
  tabs.js                  the phase tab bar
shaders/                   GLSL shader programs
shaders/lib/spectral.glsl  GLSL port of Spectral.js (generated)
lib/                       vendored libraries + their licences
fonts/                     lettering fonts: XBAND_Rough.ttf, OpenSans-ExtraBold.ttf
                           (Open Sans licence is in lib/LICENSES/)
presets/                   saved background presets (from phase 4)
```

## Roadmap

- [x] **Phase 1:** lit height field, test brush, light controls
- [x] **Phase 2:** procedural background generator (flow fields, layered
      coarse-to-fine strokes, Spectral.js pigment mixing), tabs
- [x] **Phase 3:** palette-knife text: font outlines -> signed distance
      field -> raised white lettering; portrait or landscape canvas
- [ ] **Phase 4:** art-direction controls, text safe zone, presets,
      touch-up brush

## Credits

- Pigment mixing: [Spectral.js](https://github.com/rvanwijnen/spectral.js)
  v3.0.0 by Ronald van Wijnen, MIT licence. `shaders/lib/spectral.glsl` is
  a GLSL port generated from its data tables.
- Font outlines: [opentype.js](https://github.com/opentypejs/opentype.js)
  v2.0.0 by Frederik De Bleser and contributors, MIT licence.
- Noise: [simplex-noise](https://github.com/jwagner/simplex-noise.js)
  v4.0.3 by Jonas Wagner, MIT licence.
- Font: XBAND Rough, kept in this private repo for personal use only.
- Font: [Open Sans](https://github.com/googlefonts/opensans) ExtraBold by
  the Open Sans Project Authors, SIL Open Font Licence 1.1.
