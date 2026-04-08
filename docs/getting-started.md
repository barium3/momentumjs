# Getting Started

This guide covers the shortest path to writing and running a Momentum sketch in After Effects.

Momentum is not a browser canvas runtime. It is a sketch system that targets After Effects, so your code is translated into AE-native structures or into a native bitmap effect workflow depending on the selected mode.

---

## Open The Panel

Open the Momentum panel inside After Effects from:

- `Window > Extensions > momentum.js`
- or, on some AE versions, `Window > Extensions (Legacy) > momentum.js`

Once the panel is open, you will see the editor, the mode switcher, and the run button.

---

## Preparation

If you want to use `Bitmap` mode, first make sure GPU acceleration is enabled for the current After Effects project.

Open:

`File > Project Settings > Video Rendering and Effects > Use > Mercury GPU Acceleration`

If the project is set to software-only rendering, Momentum can fall back to CPU mode, but Bitmap performance and compatibility will generally be worse.

---

## Two Modes

Momentum currently has two runtime modes:

### Vector Mode

Vector mode converts sketch output into normal After Effects structures.

Typical results include:

- shape layers
- shape groups
- text layers
- image layers
- a dedicated `__controller__` layer for expression controls

This mode is best when:

- you want generated results to stay editable as native AE vector graphics and text objects
- your sketch is mostly shapes, transforms, text, color, and controllers
- you want to keep working with the generated layer structure after the sketch runs

Tradeoffs:

- AE structures have to be prepared ahead of time
- After Effects places tighter limits on what can be generated dynamically at runtime
- image/pixel workflows are not the main strength of this mode

### Bitmap Mode

Bitmap mode renders through the native `Momentum.plugin` effect.

This mode is best when:

- you want a more complete rendering API than the AE-native vector path can provide
- you want GPU-backed rendering
- you expect larger render object counts than the vector path is comfortable with
- you need pixel APIs such as `loadPixels()`, `updatePixels()`, `get()`, `set()`
- you need `createGraphics()` or `createImage()`
- you need bitmap filters or blend operations
- you need font loading and font metadata APIs such as `loadFont()`, `Font.textBounds()`, or `Font.textToPoints()`

Tradeoffs:

- the result is a plugin-rendered bitmap layer, not a tree of editable AE shape groups
- some p5 loop-control APIs such as `isLooping()`, `loop()`, `noLoop()`, and `redraw()` are not currently supported in Bitmap mode because rendering is driven by the AE effect host
- Bitmap support is currently more mature on macOS. Windows compatibility is still weaker.

---

## How Each Mode Runs

### Vector Runtime

In Vector mode, Momentum:

1. analyzes your sketch in the panel
2. estimates the structures that need to exist in AE
3. creates the required AE-side layers and groups
4. creates a hidden `__engine__` text layer that acts as the expression-side runtime bridge
5. wires the visible AE structures to that engine state through expressions

In practice, you can think of it like this:

`Sketch code -> frontend analysis -> AE script generation -> hidden __engine__ expression bridge -> AE-native result`

This is why Vector mode is fundamentally based on scripts and expressions. Momentum prepares AE-native layers up front, then uses the hidden `__engine__` layer as an internal state carrier so the visible layers can read the evaluated sketch result.

### Bitmap Runtime

In Bitmap mode, Momentum:

1. analyzes the sketch in the panel
2. packages the source, runtime metadata, assets, and controller config
3. creates or updates a layer with the `Momentum` effect
4. hands that payload to `Momentum.plugin`
5. lets the native plugin render the sketch as bitmap output inside AE
6. uses AE SDK plugin APIs instead of the expression engine to drive rendering

In practice, you can think of it like this:

`Sketch code -> frontend analysis -> plugin payload -> C++ plugin built on the AE SDK -> bitmap output`

This is why Bitmap mode has a different ceiling. Instead of being limited to the script-and-expression path, it runs through a native C++ plugin built on top of the After Effects SDK, which gives Momentum access to stronger render-time capabilities such as bitmap processing, richer offscreen buffers, GPU paths, and higher render-object throughput.

---

## Basic Workflow

The basic Momentum workflow is:

1. Open the Momentum panel in After Effects
2. Write sketch code in the editor
3. Choose `Vector` or `Bitmap` mode
4. Run the sketch
5. Adjust AE-side layers, keyframes, and controller values when needed

As a rough rule:

- start with `Vector` if you are drawing AE-native geometry
- switch to `Bitmap` if you need image, pixel, filter, graphics buffer, or font-metadata workflows

You can also use the [p5.js reference](https://p5js.org/reference/) as a source of examples, but Momentum is not a full browser p5 runtime. When Momentum documentation and p5 documentation differ, treat Momentum documentation as the source of truth.

---

## Your First Sketch

```js
function setup() {
  createCanvas(100, 100);
  background(30);

  fill(255, 100, 100);
  noStroke();
  circle(50, 50, 40);
}
```

This sketch:

- creates a `100 x 100` canvas
- paints the background
- draws a circle

In `Vector` mode, that result becomes AE-native geometry.

In `Bitmap` mode, that result is rendered by `Momentum.plugin`.

---

## `preload()`, `setup()`, and `draw()`

Momentum follows the familiar p5-style entry point pattern:

- `preload()`
  Use for asset loading such as `loadImage()`, `loadJSON()`, `loadTable()`, `loadFont()`, `loadXML()`
- `setup()`
  Use for one-time initialization and static setup work
- `draw()`
  Use for frame-based drawing and animation logic

Example:

```js
let img;

function preload() {
  img = loadImage("images/apple.png");
}

function setup() {
  createCanvas(200, 200);
}

function draw() {
  background(30);
  image(img, 50, 50, 100, 100);
}
```

---
## The `user/` Directory

Momentum uses the extension's `user/` directory as the working area for sketch assets.

Typical install location of the CEP extension:

- macOS:
  `~/Library/Application Support/Adobe/CEP/extensions/momentumjs`
- Windows:
  `C:\\Users\\YourUsername\\AppData\\Roaming\\Adobe\\CEP\\extensions\\momentumjs`

Inside that extension directory, Momentum expects assets under:

- `user/`

Typical examples:

- `user/images/apple.png`
- `user/data/people.csv`
- `user/config/settings.json`
- `user/fonts/SourceHanSansSC-Regular.otf`

When you reference files in code, use paths relative to `user/`.

Example:

```js
let img;
let data;
let font;

function preload() {
  img = loadImage("images/apple.png");
  data = loadJSON("config/settings.json");
  font = loadFont("fonts/SourceHanSansSC-Regular.otf");
}
```

---


## Next Steps

- [API Reference](api/index.md)
- [Shapes](api/shapes.md)
- [Image](api/image.md)
- [Controllers](api/controllers.md)
- [Environment](api/environment.md)
