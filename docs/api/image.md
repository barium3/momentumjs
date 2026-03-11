# Image

Image APIs load bitmap assets from `user/` and render them into the Momentum runtime.

These functions are modeled after p5.js, but the final output is rendered through the Momentum compiler, analyzer, and After Effects pipeline.

Because rendering is constrained by the After Effects environment, Momentum only supports p5.js-style pixel reading, not direct pixel modification. In practice, this means pixel sampling workflows such as `img.get(...)` are supported, while workflows that depend on editing image pixels in place are not.

---

## Overview

Image-related APIs:

- `loadImage(path)`
- `image(img, x, y)`
- `image(img, x, y, w, h)`
- `imageMode(mode)`
- `tint(...)`
- `noTint()`
- `img.get(x, y)`
- `img.resize(w, h)`

Supported image mode constants:

- `CORNER`
- `CORNERS`
- `CENTER`

---

## `loadImage(path)`

Loads an image from the `user/` directory.

### Signature

```js
loadImage(path)
```

### Parameters

- `path`: Relative file path under `user/`, for example `"pic.png"` or `"images/pic.png"`.

### Returns

An image object with:

- `width`
- `height`
- `get(...)`
- `resize(...)`

### Example

```js
let img;

function preload() {
  img = loadImage("apple.png");
}
```

### Notes

- Paths are relative to the extension's `user/` folder.
- Image metadata is collected on the frontend before execution.
- If the file cannot be resolved, the image may behave like an empty image with size `0`.

---

## `image(img, x, y, [w], [h])`

Draws an image at a given position, optionally with an explicit output size.

### Signatures

```js
image(img, x, y)
image(img, x, y, w, h)
```

### Parameters

- `img`: Image object returned by `loadImage()` or `img.get(...)`
- `x`: X position
- `y`: Y position
- `w`: Optional target width
- `h`: Optional target height

### Behavior

- If `w` and `h` are omitted, the image is drawn using its current width and height.
- If `w` and `h` are provided, the image is drawn at that output size.

### Examples

```js
image(img, 20, 30);
image(img, 0, 0, 100, 100);
```

### Notes

- Providing `w` and `h` changes the rendered size, not the source pixels.

---

## `imageMode(mode)`

Changes how `image()` interprets `x`, `y`, `w`, and `h`.

### Signature

```js
imageMode(mode)
```

### Parameters

- `mode`: One of `CORNER`, `CORNERS`, or `CENTER`

### Modes

- `CORNER`: `x`, `y` is the top-left corner. `w`, `h` are width and height.
- `CORNERS`: `x`, `y` is one corner. `w`, `h` is the opposite corner.
- `CENTER`: `x`, `y` is the center point. `w`, `h` are width and height.

### Example

```js
imageMode(CENTER);
image(img, width / 2, height / 2, 80, 80);
```

---

## `tint(...)`

Applies a color tint to image rendering.

### Signature

```js
tint(gray)
tint(gray, alpha)
tint(r, g, b)
tint(r, g, b, alpha)
```

### Example

```js
tint(255, 128);
image(img, 0, 0);
```

### Notes

- Tint affects later `image()` calls until changed or reset.
- Alpha in `tint()` affects image opacity.

---

## `noTint()`

Clears the current tint state.

### Signature

```js
noTint()
```

### Example

```js
tint(255, 0, 0);
image(img, 0, 0);

noTint();
image(img, 120, 0);
```

---

## `img.get(x, y)`

Samples a single pixel from the image.

The `x` and `y` coordinates are interpreted in the original image's pixel space.

### Signature

```js
img.get(x, y)
```

### Returns

A color array in normalized color format.

### Example

```js
let c = img.get(10, 20);
fill(c);
square(0, 0, 20);
```

### Notes

- `x` and `y` refer to coordinates in the source image, not the drawn output size on the canvas.
- If `img.resize(...)` has been applied, `img.get(x, y)` samples based on the resized image space.

---

## `img.resize(w, h)`

Resizes an image object while preserving aspect ratio when one dimension is omitted.

### Signature

```js
img.resize(w, h)
```

### Behavior

- If both `w` and `h` are provided, both are used.
- If only one dimension is provided, the other is derived from the current aspect ratio.
- Resizing affects later `image(img, ...)` calls that use the image object's own dimensions.
- Resizing also affects how `img.get(x, y)` maps coordinates when sampling pixels.

### Example

```js
img.resize(100, 100);
image(img, 0, 0);
```

### Example: preserve aspect ratio

```js
img.resize(100);
image(img, 0, 0);
```

---

## Minimal Example

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

---

## Related

- [`README.md`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/README.md)
- [`bundle/includes/image.js`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/bundle/includes/image.js)
- [`bundle/includes/registry.js`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/bundle/includes/registry.js)
