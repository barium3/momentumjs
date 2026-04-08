# Typography

Typography APIs control text content, font settings, layout, alignment, text measurement, and font metadata workflows.

Bitmap mode also supports font loading and font metadata APIs such as `loadFont(...)`, `textBounds(...)`, and `textToPoints(...)`.

Paragraph-style text is also not a direct browser text flow. Momentum uses its own layout behavior on top of After Effects and the bitmap runtime.

---

## Overview

Common typography APIs:

- `text(str, x, y)`
- `text(str, x, y, maxWidth)`
- `text(str, x, y, maxWidth, maxHeight)`
- `textSize(size)`
- `textLeading(leading)`
- `textFont(font, [size])`
- `textStyle(style)`
- `textWrap(mode)`
- `textAlign([horizontal], [vertical])`
- `textWidth(str)`
- `textAscent()`
- `textDescent()`
- `loadFont(path[, successCallback[, failureCallback]])`

Bitmap-only `Font` methods:

- `textBounds(text, x, y[, fontSize])`
- `textToPoints(text, x, y[, fontSize[, options]])`

Common text-related constants:

- `LEFT`
- `CENTER`
- `RIGHT`
- `TOP`
- `BOTTOM`
- `BASELINE`
- `WORD`
- `CHAR`
- `NORMAL`
- `BOLD`
- `ITALIC`
- `BOLDITALIC`

---

## Text State

Mode: Vector, Bitmap

Momentum keeps a current text state for later `text()` calls.

This state includes:

- font
- size
- leading
- alignment
- wrap mode
- style
- fill and stroke settings

In bitmap mode, the same state model also applies to `Graphics` buffers.

---

## `text(str, x, y, [maxWidth], [maxHeight])`

Mode: Vector, Bitmap

Draws text at a position, optionally inside a text box.

### Signatures

```js
text(str, x, y)
text(str, x, y, maxWidth)
text(str, x, y, maxWidth, maxHeight)
```

### Notes

- `text()` is affected by the current typography state and current fill/stroke state.
- Boxed text behavior is also affected by `textAlign()`, `textWrap()`, and `rectMode()`.
- In vector mode, text ultimately becomes AE text output.
- In bitmap mode, text is rasterized into the current bitmap surface.

---

## `textSize(size)`

Mode: Vector, Bitmap

Sets the text size for later `text()` calls.

### Signatures

```js
textSize()
textSize(size)
```

---

## `textLeading(leading)`

Mode: Vector, Bitmap

Sets the line spacing used for multi-line text.

### Signatures

```js
textLeading()
textLeading(leading)
```

---

## `textFont(font, [size])`

Mode: Vector, Bitmap

Sets the font used for later `text()` calls.

### Signatures

```js
textFont()
textFont(font)
textFont(font, size)
```

### Notes

- In the editor, `textFont()` shows a font dropdown/autocomplete list inside the first argument.
- If a size is provided, it also updates the current text size.
- Final font resolution depends on fonts available on the machine.
- In Bitmap mode, you can also pass a `Font` object returned by `loadFont(...)`.

---

## `textStyle(style)`

Mode: Vector, Bitmap

Sets the text style for later `text()` calls.

### Signatures

```js
textStyle()
textStyle(style)
```

### Parameters

- `style`: `NORMAL`, `BOLD`, `ITALIC`, or `BOLDITALIC`

---

## `textWrap(mode)`

Mode: Vector, Bitmap

Sets the wrapping mode used for boxed text.

### Signatures

```js
textWrap()
textWrap(mode)
```

### Parameters

- `mode`: `WORD` or `CHAR`

---

## `textAlign([horizontal], [vertical])`

Mode: Vector, Bitmap

Sets horizontal and optional vertical text alignment.

### Signatures

```js
textAlign(horizontal)
textAlign(horizontal, vertical)
```

### Parameters

- `horizontal`: `LEFT`, `CENTER`, or `RIGHT`
- `vertical`: `TOP`, `CENTER`, `BOTTOM`, or `BASELINE`

---

## `textWidth(str)`

Mode: Vector, Bitmap

Measures the width of a string using the current text state.

### Signature

```js
textWidth(str)
```

---

## `textAscent()`

Mode: Vector, Bitmap

Returns the ascent of the current font and text size.

### Signature

```js
textAscent()
```

---

## `textDescent()`

Mode: Vector, Bitmap

Returns the descent of the current font and text size.

### Signature

```js
textDescent()
```

---

## `loadFont(path[, successCallback[, failureCallback]])`

Mode: Bitmap

Loads a font and returns a `Font` object for font metadata workflows.

### Signatures

```js
loadFont(path)
loadFont(path, successCallback)
loadFont(path, successCallback, failureCallback)
```

### Notes

- This is intended for Bitmap mode.
- You can pass a font file path such as `"fonts/MyFont.otf"`.
- For where `user/` lives and how relative asset paths work, see [The `user/` Directory](../getting-started.md#the-user-directory).
- Use the returned `Font` object with `textBounds(...)`, `textToPoints(...)`, or `textFont(font)`.

### Example

```js
let font;

function preload() {
  font = loadFont("fonts/SourceHanSansSC-Regular.otf");
}

function setup() {
  createCanvas(600, 200);
  textFont(font, 48);
}

function draw() {
  background(20);
  fill(255);
  text("Momentum", 40, 110);
}
```

---

## `textBounds(text, x, y[, fontSize])`

Mode: Bitmap

Returns a bounds object for a piece of text using the loaded font.

### Signatures

```js
font.textBounds(text, x, y)
font.textBounds(text, x, y, fontSize)
```

### Returns

An object describing the text bounds.

### Notes

- Use this when layout depends on exact font metrics.
- If `fontSize` is omitted, Momentum uses the current text size.

### Example

```js
let font;

function preload() {
  font = loadFont("fonts/SourceHanSansSC-Regular.otf");
}

function setup() {
  createCanvas(700, 220);
}

function draw() {
  background(20);
  let bounds = font.textBounds("Momentum", 40, 120, 72);

  noFill();
  stroke(255, 120, 120);
  rect(bounds.x, bounds.y, bounds.w, bounds.h);

  fill(255);
  noStroke();
  textFont(font, 72);
  text("Momentum", 40, 120);
}
```

---

## `textToPoints(text, x, y[, fontSize[, options]])`

Mode: Bitmap

Converts text outlines into sampled points using the loaded font.

### Signatures

```js
font.textToPoints(text, x, y, fontSize)
font.textToPoints(text, x, y, fontSize, options)
```

### Options

- `sampleFactor`: Sampling density
- `simplifyThreshold`: Optional point simplification amount

### Notes

- Use this when you want to build point clouds, particles, or custom outline-driven motion from text.
- Higher `sampleFactor` produces more points.

### Example

```js
let font;
let pts = [];

function preload() {
  font = loadFont("fonts/SourceHanSansSC-Regular.otf");
}

function setup() {
  createCanvas(800, 240);
  pts = font.textToPoints("Hi", 80, 160, 160, {
    sampleFactor: 0.18,
  });
}

function draw() {
  background(20);
  stroke(255);
  strokeWeight(3);

  for (let i = 0; i < pts.length; i++) {
    point(pts[i].x, pts[i].y);
  }
}
```

---

## Common Pattern

Mode: Vector, Bitmap

Set the text state before drawing text.

```js
textFont("Arial");
textSize(24);
textAlign(CENTER, CENTER);
fill(255);
text("Hello", width / 2, height / 2);
```
