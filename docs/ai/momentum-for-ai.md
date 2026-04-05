# Momentum For AI

This document is for AI code generation.

Momentum is a sketch-oriented scripting system for After Effects. It is inspired by p5.js, but it is not a browser canvas runtime. Generate Momentum code, not generic p5.js web code.

## Core Model

- User code is analyzed first.
- Momentum must know the render structure before After Effects layers are created.
- The engine creates an internal `__engine__` text layer that stores computed render data.
- Vector geometry is then mapped into After Effects shape content.
- Controllers are mapped onto a `__controller__` layer as AE expression controls.

For vector shapes, the practical render unit is:

`Layer -> Contents -> Shape Group`

One shape call such as `rect()`, `circle()`, `triangle()`, `line()`, or a finished custom shape produces one render slot. In AE terms, that becomes one shape group under `Contents`.

## Non-Negotiable Limitation: No Unbounded Shape Generation

Do not generate Momentum code that can create an unbounded or unknown number of render calls.

This is the most important constraint in the system.

Why:

- After Effects expressions cannot freely create new render layers or shape groups at runtime.
- Momentum therefore analyzes render calls first, assigns `slotKey`s, and builds AE layers/groups ahead of time.
- If the number of shape calls cannot be bounded in advance, Momentum cannot safely allocate the render structure.

Avoid these patterns when they control `rect()`, `ellipse()`, `image()`, `text()`, `beginShape()/endShape()`, or any other render call:

- Infinite loops
- Open-ended `while` / `do...while` patterns
- Event-driven or callback-driven render creation with no fixed upper bound
- Shape counts controlled by unsupported dynamic sources
- Browser or async flows that would add render calls later

Prefer these patterns:

- Fixed numeric loop bounds
- Small, clearly finite loops
- Bounds derived from static values
- Bounds derived from `frameCount`, `random(...)`, `createSlider(...)`, or `createAngle(...)` only when the final maximum is still finite

Important implementation detail:

- The current loop max analysis only has special bound handling for `frameCount`, `random(...)`, `createSlider(...)`, and `createAngle(...)`.
- Do not use `createCheckbox`, `createSelect`, `createPoint`, or `createColorPicker` to decide how many shapes to generate.

## General Generation Rules

- Prefer plain `preload()`, `setup()`, and `draw()` structure.
- Use only APIs that Momentum actually supports.
- If a p5.js example uses unsupported APIs, rewrite it into Momentum-compatible code.
- Do not assume browser DOM APIs exist.
- Do not assume HTML canvas exists.
- Do not assume p5 DOM element objects exist.
- Do not generate async rendering logic.

Compiler rule:

- Only registry-listed Momentum functions and methods should be used.
- Unknown global functions fail validation.
- Unknown controller or object methods fail validation.

## Environment Rules

- `createCanvas(w, h)` defines the After Effects composition size.
- `duration(...)` is Momentum-specific. It controls the AE composition duration.
- `frameRate(...)` controls comp frame rate.
- `width`, `height`, and `frameCount` are environment values inside the engine.

For reliable comp configuration, prefer direct literal calls in global scope or `setup()`:

```js
createCanvas(1920, 1080);
frameRate(30);
duration(8);
```

Avoid relying on computed arguments for comp settings such as:

```js
const w = 1920;
createCanvas(w, 1080);
```

Use literal values instead.

## File Loading Rules

- Put external files under the `user/` directory.
- Treat `user/` as the root for asset paths.
- Write paths relative to `user/`, not relative to the sketch file.
- Do not include the `user/` prefix in code.
- Do not use `loadFont(...)`. Momentum does not support loading font files at runtime in the AE environment.
- Fonts must already be installed on the user's computer.
- When choosing fonts, use `textFont(...)`. In the editor, prefer the `textFont(...)` dropdown/autocomplete list.

Correct:

```js
loadImage("images/apple.png");
loadJSON("data/config.json");
loadTable("tables/people.csv", "header");
```

Incorrect:

```js
loadImage("user/images/apple.png");
loadJSON("./data/config.json");
```

## p5.js Differences That Matter

### Browser and DOM APIs

Do not use browser-only APIs such as:

- `describe()`
- DOM element APIs
- HTML or CSS manipulation
- `window`, `document`, or DOM event workflows for rendering

### Shapes

- Shape calls do not return persistent DOM-like objects.
- A render call becomes preallocated AE render structure.
- Runtime code should not assume shapes can be created later on demand beyond what analysis already found.

### Text

- Momentum text is rendered through AE text layers, not browser text layout.
- Boxed text is not native AE paragraph text with a second-pass box correction.
- Momentum uses point text plus custom line breaking when width and height constraints are involved.
- `text(str, x, y, maxWidth, maxHeight)` is affected by `rectMode()`.
- Do not generate `loadFont(...)` workflows.
- Use installed fonts with `textFont(...)`, and prefer names that can be selected from the editor dropdown.

### Images

- `loadImage(path)` returns a Momentum image object.
- `image(img, x, y)` and `image(img, x, y, w, h)` are supported.
- `imageMode(CORNER | CORNERS | CENTER)` is supported.
- `img.resize(w, h)` is supported.
- `img.get(x, y)` is supported for pixel reading.

Do not generate pixel-writing workflows.

Unsupported or unsafe-for-generation image patterns:

- `loadPixels()`
- `updatePixels()`
- direct `pixels[]` editing
- `set(...)` pixel mutation workflows

Important caveat:

- `img.get(x, y, w, h)` should not be used for AI-generated code.
- The current runtime does not implement true cropped sub-images from those four arguments.
- Treat `img.get(x, y)` as the reliable image sampling API.

Another image caveat:

- `img.get(x, y)` samples through the current Momentum image object size mapping.
- After `img.resize(...)`, later `get()` calls are affected by the resized logical dimensions.

### IO

- `loadTable(...)` and `loadJSON(...)` are supported.
- All loaded file paths are rooted at `user/`.
- Nested directories under `user/` are allowed.
- Imported data is baked into the current run.
- Source file edits do not live-update an already generated result.
- Table mutations are in-memory only.
- Do not generate p5 save-back APIs that write changes into the original source file.

## Controllers

Controllers are one of Momentum's core AE-specific features.

They let a sketch variable be driven by AE expression controls and keyframes.

Implementation model:

- Momentum creates or reuses a layer named `__controller__`.
- Controller factories map to AE expression controls on that layer.
- Reading controller values in code pulls values from those AE controls.
- Keyframing the AE controls changes the values seen by the sketch.

Do not treat Momentum controllers as full p5 DOM elements.

They are not UI elements with layout, styling, visibility, or event methods.

### Supported Controller Factories

- `createSlider(min, max, value, step)`
- `createAngle(defaultDegrees)`
- `createColorPicker(...)`
- `createCheckbox(label, checked)`
- `createSelect()`
- `createPoint(defaultX, defaultY)`

### Supported Controller Methods

`createSlider(...)` returns an object with:

- `value()`

`createAngle(...)` returns an object with:

- `value()`
- `degrees()`
- `radians()`

`createColorPicker(...)` returns an object with:

- `color()`
- `value()`

`createCheckbox(...)` returns an object with:

- `checked()`
- `value()`

`createSelect()` returns an object with:

- `option(label, value)`
- `selected(v)`
- `value()`
- `index()`

`createPoint(...)` returns an object with:

- `value()`
- `x()`
- `y()`

### Unsupported p5-Like Controller Methods

Do not generate methods such as:

- `.position(...)`
- `.size(...)`
- `.style(...)`
- `.show()`
- `.hide()`
- `.parent(...)`
- `.class(...)`
- `.id(...)`
- `.attribute(...)`
- `.mousePressed(...)`
- `.changed(...)`
- `.input(...)`

If a method is not in the supported list above, do not use it.

### Controller-Specific Caveats

- `createColorPicker(...)` accepts either a hex string or 3 to 4 numeric channel arguments.
- Do not use the old array-style color picker input.
- `createSelect().selected(v)` should be treated as selecting a default value for the controller object, not as a general DOM-style live setter API.

## Safe API Mindset

When converting p5.js examples, keep this rule:

- If the code depends on browser behavior, replace it.
- If the code depends on live pixel mutation, replace it.
- If the code depends on unlimited runtime shape creation, replace it.
- If the code depends on controller layout or DOM methods, replace it.

When in doubt:

- Prefer fixed geometry
- Prefer finite loops
- Prefer direct controller value reads
- Prefer documented Momentum methods only

## Good Patterns

Use controllers to drive values:

```js
let radiusCtrl;

function setup() {
  createCanvas(1920, 1080);
  duration(6);
  radiusCtrl = createSlider(20, 400, 120, 1);
}

function draw() {
  background(0);
  circle(width / 2, height / 2, radiusCtrl.value());
}
```

Use finite loops for render calls:

```js
function setup() {
  createCanvas(800, 800);
}

function draw() {
  background(255);
  for (let i = 0; i < 12; i++) {
    circle(80 + i * 50, 400, 30);
  }
}
```

Use supported image sampling only:

```js
let img;

function preload() {
  img = loadImage("images/apple.png");
}

function setup() {
  createCanvas(400, 400);
}

function draw() {
  background(30);
  image(img, 0, 0, 200, 200);
  let c = img.get(10, 10);
  fill(c);
  circle(300, 100, 40);
}
```

## Bad Patterns

Do not generate code like this:

```js
while (someUnknownCondition()) {
  rect(random(width), random(height), 10, 10);
}
```

```js
let s = createSlider(0, 100, 50);
s.position(10, 10);
s.style("width", "200px");
```

```js
img.loadPixels();
img.pixels[0] = 255;
img.updatePixels();
```

```js
let sub = img.get(10, 10, 100, 100);
image(sub, 0, 0);
```

## Final Instruction For AI

Write Momentum sketches as AE-oriented, preallocatable, finite p5-style code.

Do not write browser p5 code.
Do not write DOM-controller code.
Do not write live pixel-editing code.
Do not write unbounded render-generation code.
