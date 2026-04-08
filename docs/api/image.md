# Image

Image APIs cover image loading, drawing, offscreen bitmap buffers, and pixel operations.

If you need bitmap-only features such as mutable image buffers, pixel access, offscreen graphics, filters, masking, or blend operations, switch the sketch to Bitmap mode.

---

## Overview

Core image APIs:

- `loadImage(path)`
- `image(img, x, y)`
- `image(img, x, y, w, h)`
- `imageMode(mode)`
- `tint(...)`
- `noTint()`

Bitmap-only image and pixel APIs:

- `createGraphics(w, h)`
- `createImage(w, h)`
- `pixelDensity([value])`
- `loadPixels()`
- `updatePixels([x, y, w, h])`
- `get(...)`
- `set(x, y, value)`
- `copy(...)`
- `blend(...)`
- `filter(kind, [value])`
- `pixels`

Bitmap-only `Image` methods:

- `Image.pixelDensity([value])`
- `Image.loadPixels()`
- `Image.updatePixels([x, y, w, h])`
- `Image.get(...)`
- `Image.set(x, y, value)`
- `Image.copy(...)`
- `Image.blend(...)`
- `Image.filter(kind, [value])`
- `Image.resize(w, h)`
- `Image.mask(maskImage)`

Supported image mode constants:

- `CORNER`
- `CORNERS`
- `CENTER`

Bitmap-only filter constants:

- `THRESHOLD`
- `GRAY`
- `OPAQUE`
- `INVERT`
- `POSTERIZE`
- `BLUR`
- `ERODE`
- `DILATE`

---

## `loadImage(path[, successCallback[, failureCallback]])`

Mode: Vector, Bitmap

Loads an image from the `user/` directory.

### Signatures

```js
loadImage(path)
loadImage(path, successCallback)
loadImage(path, successCallback, failureCallback)
```

### Parameters

- `path`: Relative file path under `user/`, for example `"pic.png"` or `"images/pic.png"`.
- `successCallback`: Optional callback for bitmap-style loading flows.
- `failureCallback`: Optional callback if loading fails.

### Returns

An image object.

### Example

```js
let img;

function preload() {
  img = loadImage("apple.png");
}
```

### Notes

- For where `user/` lives and how relative asset paths work, see [The `user/` Directory](../getting-started.md#the-user-directory).
- In vector mode, images are ultimately placed through the AE generation pipeline.
- In bitmap mode, the returned image can also participate in pixel workflows.

---

## `image(img, x, y, [w], [h])`

Mode: Vector, Bitmap

Draws an image at a given position, optionally with an explicit output size.

### Signatures

```js
image(img, x, y)
image(img, x, y, w, h)
```

### Parameters

- `img`: Image object
- `x`: X position
- `y`: Y position
- `w`: Optional target width
- `h`: Optional target height

### Notes

- Providing `w` and `h` changes the rendered size, not the source pixels.
- In vector mode this maps to AE-side image placement.
- In bitmap mode this draws into the current bitmap canvas or graphics buffer.

---

## `imageMode(mode)`

Mode: Vector, Bitmap

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

---

## `tint(...)`

Mode: Vector, Bitmap

Applies a color tint to later `image()` calls.

### Signature

```js
tint(gray)
tint(gray, alpha)
tint(r, g, b)
tint(r, g, b, alpha)
```

### Notes

- Tint affects later `image()` calls until changed or reset.
- Alpha in `tint()` affects image opacity.

---

## `noTint()`

Mode: Vector, Bitmap

Clears the current tint state.

### Signature

```js
noTint()
```

---

## `createGraphics(w, h)`

Mode: Bitmap

Creates an offscreen bitmap drawing buffer.

### Signature

```js
createGraphics(w, h)
```

### Returns

A `Graphics` object.

### Notes

- `Graphics` supports drawing commands plus bitmap-only pixel operations.
- Use this when you want an offscreen surface, then draw it back with `image(pg, ...)`.

---

## `createImage(w, h)`

Mode: Bitmap

Creates a mutable bitmap image buffer.

### Signature

```js
createImage(w, h)
```

### Returns

An `Image` object.

---

## `pixelDensity([value])`

Mode: Bitmap
Available on: canvas, `Image`, `Graphics`

Gets or sets the current canvas pixel density.

### Signatures

```js
pixelDensity()
pixelDensity(value)
```

### Notes

- This API is bitmap-only.
- The same method name also exists on `Image` and `Graphics` instances.

---

## `loadPixels()`

Mode: Bitmap
Available on: canvas, `Image`, `Graphics`

Loads the current canvas pixels into the `pixels` array.

### Signature

```js
loadPixels()
```

### Notes

- Bitmap-only.
- Use before reading or modifying `pixels`.
- The same method name also exists on `Image` and `Graphics` instances.

---

## `updatePixels([x, y, w, h])`

Mode: Bitmap
Available on: canvas, `Image`, `Graphics`

Commits changes from `pixels` back to the current canvas.

### Signatures

```js
updatePixels()
updatePixels(x, y, w, h)
```

### Notes

- Bitmap-only.
- The 4-argument form updates a sub-rectangle.
- The same method name also exists on `Image` and `Graphics` instances.

---

## `pixels`

Mode: Bitmap

The current canvas pixel array.

### Notes

- Bitmap-only.
- Use together with `loadPixels()` and `updatePixels()`.

---

## `get(...)`

Mode: Bitmap
Available on: canvas, `Image`, `Graphics`

Reads pixels from the current canvas.

### Signatures

```js
get()
get(x, y)
get(x, y, w, h)
```

### Returns

- `get()` returns an `Image`
- `get(x, y)` returns a color array
- `get(x, y, w, h)` returns an `Image`

---

## `set(x, y, value)`

Mode: Bitmap
Available on: canvas, `Image`, `Graphics`

Writes a color or image into the current canvas.

### Signature

```js
set(x, y, value)
```

---

## `copy(...)`

Mode: Bitmap
Available on: canvas, `Image`, `Graphics`

Copies pixels between image sources and destinations.

### Signatures

```js
copy(sx, sy, sw, sh, dx, dy, dw, dh)
copy(src, sx, sy, sw, sh, dx, dy, dw, dh)
```

---

## `blend(...)`

Mode: Bitmap
Available on: canvas, `Image`, `Graphics`

Copies pixels using a blend mode.

### Signatures

```js
blend(sx, sy, sw, sh, dx, dy, dw, dh, mode)
blend(src, sx, sy, sw, sh, dx, dy, dw, dh, mode)
```

### Notes

- `blend(...)` uses the same bitmap blend constants as `blendMode()`. See [Color](./color.md#blendmodemode).

---

## `filter(kind, [value])`

Mode: Bitmap
Available on: canvas, `Image`, `Graphics`

Applies a bitmap filter to the current canvas.

### Signatures

```js
filter(kind)
filter(kind, value)
```

### Supported filter constants

- `THRESHOLD`: Converts pixels into a thresholded black/white result.
- `GRAY`: Converts the image to grayscale.
- `OPAQUE`: Forces pixels fully opaque.
- `INVERT`: Inverts the color channels.
- `POSTERIZE`: Reduces the number of color levels.
- `BLUR`: Applies a blur filter.
- `ERODE`: Shrinks bright regions.
- `DILATE`: Expands bright regions.

---

## `resize(w, h)`

Mode: Bitmap
Available on: `Image`, `Graphics`

Resizes an image object while preserving aspect ratio when one dimension is omitted.

### Signature

```js
img.resize(w, h)
```

### Notes

- If only one dimension is provided, the other is derived from the current aspect ratio.

---

## `mask(maskImage)`

Mode: Bitmap
Available on: `Image`, `Graphics`

Applies an image mask to an image buffer.

### Signature

```js
img.mask(maskImage)
```

---

## `Image.pixelDensity([value])`

Mode: Bitmap

Gets or sets pixel density on an `Image` object.

### Signatures

```js
img.pixelDensity()
img.pixelDensity(value)
```

### Notes

- This is the `Image` instance form of `pixelDensity([value])`.

---

## `Image.loadPixels()`

Mode: Bitmap

Loads image pixels into the image's `pixels` array.

### Signature

```js
img.loadPixels()
```

### Notes

- Use before reading or modifying `img.pixels`.

---

## `Image.updatePixels([x, y, w, h])`

Mode: Bitmap

Commits changes from `img.pixels` back to the image.

### Signatures

```js
img.updatePixels()
img.updatePixels(x, y, w, h)
```

---

## `Image.get(...)`

Mode: Bitmap

Reads pixels from an `Image` object.

### Signatures

```js
img.get()
img.get(x, y)
img.get(x, y, w, h)
```

### Returns

- `img.get()` returns an `Image`
- `img.get(x, y)` returns a color array
- `img.get(x, y, w, h)` returns an `Image`

---

## `Image.set(x, y, value)`

Mode: Bitmap

Writes a color or image into an `Image` object.

### Signature

```js
img.set(x, y, value)
```

---

## `Image.copy(...)`

Mode: Bitmap

Copies pixels into an `Image` object.

### Signatures

```js
img.copy(sx, sy, sw, sh, dx, dy, dw, dh)
img.copy(src, sx, sy, sw, sh, dx, dy, dw, dh)
```

---

## `Image.blend(...)`

Mode: Bitmap

Copies pixels into an `Image` object using a blend mode.

### Signatures

```js
img.blend(sx, sy, sw, sh, dx, dy, dw, dh, mode)
img.blend(src, sx, sy, sw, sh, dx, dy, dw, dh, mode)
```

### Notes

- `Image.blend(...)` uses the same bitmap blend constants as `blendMode()`. See [Color](./color.md#blendmodemode).

---

## `Image.filter(kind, [value])`

Mode: Bitmap

Applies a bitmap filter to an `Image` object.

### Signatures

```js
img.filter(kind)
img.filter(kind, value)
```

### Supported filter constants

- `THRESHOLD`: Converts pixels into a thresholded black/white result.
- `GRAY`: Converts the image to grayscale.
- `OPAQUE`: Forces pixels fully opaque.
- `INVERT`: Inverts the color channels.
- `POSTERIZE`: Reduces the number of color levels.
- `BLUR`: Applies a blur filter.
- `ERODE`: Shrinks bright regions.
- `DILATE`: Expands bright regions.

---

## `Image.resize(w, h)`

Mode: Bitmap

Resizes an `Image` object while preserving aspect ratio when one dimension is omitted.

### Signature

```js
img.resize(w, h)
```

### Notes

- If only one dimension is provided, the other is derived from the current aspect ratio.

---

## `Image.mask(maskImage)`

Mode: Bitmap

Applies an image mask to an `Image` object.

### Signature

```js
img.mask(maskImage)
```

---

## Minimal Example

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
