# Getting Started

This guide covers the shortest path to writing and running your first Momentum sketch in After Effects.

Momentum lets you write p5.js-style sketch code, then turns that code into After Effects layers, shape groups, images, text, and controller-driven animation structures.

---

## How It Works

Momentum is best understood as a sketch-oriented scripting system for After Effects rather than a normal realtime canvas runtime.

When you run a sketch, Momentum does not draw directly into a browser canvas. Instead, it first uses JavaScript on the frontend to preprocess and analyze your code. During this stage, it determines which supported APIs are used and estimates how many renderable objects may need to exist ahead of time.

This preprocessing step is necessary because After Effects cannot freely create new shape structures at expression runtime. As a result, Momentum needs to prepare the required AE layers and shape groups in advance. This is also why some p5.js patterns that depend on unrestricted or infinite runtime shape creation are not supported in Momentum.

After analysis, the computed result is passed to an After Effects script. That script builds the required AE structures, including a text layer named `__engine__`. This layer stores an AE expression that carries the compiled user logic and runtime state. At the same time, Momentum creates the corresponding shape layers, image layers, text layers, and controller structures, then lets those layers read from the engine result.

In practice, you can think of the workflow like this:

`Sketch code -> frontend preprocessing and analysis -> AE structure generation -> __engine__ expression -> result distributed to render layers`

---

## Basic Workflow

The basic Momentum workflow is:

1. Write sketch code in the Momentum editor
2. Use APIs such as shapes, text, image, color, and controllers
3. Run the sketch
4. Let Momentum generate the corresponding After Effects result
5. Adjust AE-side properties such as controller values, keyframes, and layer settings when needed

You can also use the [p5.js reference](https://p5js.org/reference/) as a practical source of test cases. In many cases, you can copy any example that uses a Momentum-supported API into the Momentum editor and get a result that is usually close to what you would see in the p5 editor.

Before testing copied examples, remove any `describe();` calls. `describe()` is a web-environment API and is not supported in Momentum.

---

## Where Files Go

The Momentum extension itself is typically installed in the Adobe CEP extensions directory.

The folder name should be exactly `momentumjs`. If the extracted folder is named something like `momentumjs-main`, remove the extra suffix before installing it.

Typical installation paths:

- Windows:
  `C:\Users\YourUsername\AppData\Roaming\Adobe\CEP\extensions\momentumjs`
- macOS:
  `/Users/YourUsername/Library/Application Support/Adobe/CEP/extensions/momentumjs`


Momentum uses the extension's `user/` directory as the working area for sketch assets.

Typical examples:

- Sketch code files
- Images for `loadImage(...)`
- CSV or table files for `loadTable(...)`
- JSON files for `loadJSON(...)`

You can also organize files inside nested subdirectories under `user/`.

Examples:

- `user/images/apple.png`
- `user/data/people.csv`
- `user/config/settings.json`

When you reference files in code, use paths relative to `user/`.

Example:

```js
img = loadImage("images/apple.png");
data = loadJSON("config/settings.json");
table = loadTable("data/people.csv");
```

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

- creates an After Effects composition sized to `100 x 100`
- fills the background
- creates a circle as a shape group inside an AE layer

---

## Using `setup()`, `draw()`, and `preload()`

Momentum follows the familiar p5.js entry point pattern:

- `preload()`
  - use for loading images, tables, and JSON
- `setup()`
  - use for one-time setup and static drawing
- `draw()`
  - use for frame-based drawing and animation logic

Example:

```js
let img;

function preload() {
  img = loadImage("apple.png");
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

## What Momentum Generates in After Effects

Momentum does not render the sketch as a normal browser canvas.

Instead, it converts sketch instructions into After Effects structures such as:

- compositions
- shape layers
- shape groups
- image layers
- text layers
- controller layers

For example:

- a shape call such as `rect(...)` becomes a shape group under a layer's `Contents`
- a controller call such as `createSlider(...)` becomes an expression control on the `__controller__` layer
- `createCanvas(...)` defines the AE composition size

---

## Example: Images

```js
let img;

function preload() {
  img = loadImage("apple.png");
}

function setup() {
  createCanvas(100, 100);
  background(50);
  image(img, 0, 0, 100, 100);
}
```

Important notes:

- image paths are relative to `user/`
- `img.get(x, y)` reads pixels
- direct pixel modification is not supported

See also:

- [`docs/api/image.md`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/api/image.md)

---

## Example: Controllers

```js
let sizeCtrl;

function setup() {
  createCanvas(200, 100);
  sizeCtrl = createSlider(10, 80, 30, 1);
}

function draw() {
  background(30);
  circle(100, 50, sizeCtrl.value());
}
```

This creates a controller on the AE `__controller__` layer.

You can:

- change the controller value directly in After Effects
- add keyframes to that controller
- let the keyframed value drive the sketch variable over time

See also:

- [`docs/api/controllers.md`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/api/controllers.md)

---

## Common Concepts

### Shapes

Shape calls create vector-based geometry in After Effects.

See:

- [`docs/api/shapes.md`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/api/shapes.md)

### Transform

Transform calls affect later drawing operations.

See:

- [`docs/api/transform.md`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/api/transform.md)

### Typography

Text uses Momentum's text layout logic on top of After Effects text support.

See:

- [`docs/api/typography.md`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/api/typography.md)

### Color

Color APIs control fill, stroke, tint, and background behavior.

See:

- [`docs/api/color.md`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/api/color.md)

### Data and IO

Table and JSON loading pull data from `user/` and bake it into the current execution result.

See:

- [`docs/api/data.md`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/api/data.md)
- [`docs/api/io.md`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/api/io.md)

---

## Common Limitations

- Some APIs are p5.js-inspired rather than exact p5.js implementations.
- Image workflows support pixel reading, not direct pixel writing.
- Imported table and JSON data does not auto-refresh when source files change; rerun the sketch after editing the source file.
- Some features are adapted to fit After Effects structures rather than browser canvas behavior.

---

## Next Steps

After finishing this guide, the most useful next pages are:

- [`docs/api/shapes.md`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/api/shapes.md)
- [`docs/api/image.md`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/api/image.md)
- [`docs/api/controllers.md`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/api/controllers.md)
- [`docs/api/environment.md`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/docs/api/environment.md)
