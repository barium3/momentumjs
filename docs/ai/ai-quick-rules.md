# Momentum AI Quick Rules

Use this as a short prompt for AI code generation.

## What Momentum Is

- Momentum is an After Effects sketch scripting system.
- It is p5.js-inspired, but it is not a browser canvas runtime.
- Generate Momentum-compatible sketch code, not generic web p5.js code.

## Hard Rules

- Use only Momentum-supported APIs.
- Prefer `preload()`, `setup()`, and `draw()`.
- `createCanvas(w, h)` defines the AE composition size.
- `duration(...)` is Momentum-only and controls AE composition duration.
- Put external files under `user/`.
- In code, write file paths relative to `user/`.
- Do not write paths with a `user/` prefix.

## Render Structure Rule

- Do not generate code that creates an unbounded number of shapes.
- Momentum must know render counts before AE layers and shape groups are built.
- Avoid infinite loops, open-ended `while` loops, and event-driven shape creation.
- Prefer fixed, finite loop counts.

## Unsupported Web Patterns

- Do not use `describe()`.
- Do not use DOM APIs.
- Do not use HTML/CSS APIs.
- Do not use browser event UI code.
- Do not use async rendering flows.

## Image Rules

- Use `preload()` for `loadImage(...)`.
- Supported: `image(...)`, `imageMode(...)`, `tint(...)`, `noTint()`, `img.resize(...)`, `img.get(x, y)`.
- Do not use `img.get(x, y, w, h)` in generated code.
- Do not use pixel-writing APIs such as `loadPixels()`, `updatePixels()`, `pixels[]`, or `set(...)`.

## IO Rules

- Use `preload()` for `loadTable(...)` and `loadJSON(...)`.
- Loaded table and JSON data is baked into the current run.
- Mutating table data does not write back to the source file.
- Do not generate save-back-to-file APIs.

## Controller Rules

- Controllers are AE expression controls on a `__controller__` layer.
- Use controllers when a value should be keyframed in AE.
- Do not treat controllers like p5 DOM elements.

Supported factories:

- `createSlider(min, max, value, step)`
- `createAngle(defaultDegrees)`
- `createColorPicker(...)`
- `createCheckbox(label, checked)`
- `createSelect()`
- `createPoint(defaultX, defaultY)`
- `createPathController(name, points, closed)`

Supported methods only:

- Slider: `value()`
- Angle: `value()`, `degrees()`, `radians()`
- Color: `color()`, `value()`
- Checkbox: `checked()`, `value()`
- Select: `option(...)`, `selected(...)`, `value()`, `index()`
- Point: `value()`, `x()`, `y()`
- Path: `exists()`, `closed()`, `points()`, `point(t)`, `tangent(t)`, `normal(t)`, `angle(t)`, `sample(count)`

Do not generate methods such as:

- `.position(...)`
- `.size(...)`
- `.style(...)`
- `.show()`
- `.hide()`
- `.mousePressed(...)`
- `.changed(...)`
- `.input(...)`

## Text Rules

- Momentum text is rendered through AE text layers.
- Boxed text uses custom line breaking, not native web text layout.
- `text(str, x, y, maxWidth, maxHeight)` is affected by `rectMode()`.

## Minimal Safe Template

```js
let img;
let sizeCtrl;

function preload() {
  img = loadImage("images/apple.png");
}

function setup() {
  createCanvas(1920, 1080);
  frameRate(30);
  duration(6);
  sizeCtrl = createSlider(50, 400, 180, 1);
}

function draw() {
  background(20);
  image(img, 100, 100, 300, 300);
  circle(width / 2, height / 2, sizeCtrl.value());
}
```
