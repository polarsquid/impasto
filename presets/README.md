# Background presets

Saved backgrounds, as small JSON files. A preset holds the **seed**, every
**generator setting** (gesture, palette, layers) and the **paint
character**. Loading one repaints the background; the text, light, canvas
colour and orientation stay as they are.

## Using them

In the Generator or Text tab, under **Background presets**:

- **Built-in**: the presets listed in `index.json` (this folder).
- **Save preset**: downloads the current background as a `.json` file.
- **Load file**: opens a `.json` preset from anywhere on your computer.

## Adding your own to the Built-in list

1. Save a preset (it downloads, e.g. `my-background.json`).
2. Copy the file into this `presets/` folder.
3. Add a line for it to `index.json`:

```json
{
  "presets": [
    { "name": "Harbour sweep", "file": "harbour-sweep.json" },
    { "name": "My background", "file": "my-background.json" }
  ]
}
```

`name` is what the dropdown shows; `file` is the file name in this folder.
Mind the commas: every entry except the last ends with one.

## The file format

```json
{
  "format": "impasto-background",
  "version": 1,
  "name": "Harbour sweep",
  "generator": { "seed": 1234, "field": {}, "palette": {}, "coverage": 1, "layers": {} },
  "character": { "tipShape": 2.2, "edgeWobble": 0.5, "bristles": 14 }
}
```

Hand-editing is fine. Anything missing or invalid falls back to its
default, and unknown entries are ignored (see `js/generator/presets.js`).
