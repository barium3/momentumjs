# Color

Color APIs control fill, stroke, background, blending, erasing, and color conversion behavior for drawing.

If you need bitmap-only features such as `clear()`, `blendMode()`, `erase()`, `noErase()`, `strokeCap()`, or `strokeJoin()`, switch the sketch to Bitmap mode.

These functions affect later drawing calls until the current color state changes again.

---

## Overview

Common color APIs:

- `background(...)`
- `fill(...)`
- `noFill()`
- `stroke(...)`
- `noStroke()`
- `strokeWeight(w)`
- `color(...)`
- `lerpColor(c1, c2, amt)`
- `colorMode(mode, ...)`

Bitmap-only color APIs:

- `clear()`
- `strokeCap(mode)`
- `strokeJoin(mode)`
- `blendMode(mode)`
- `erase([fillAlpha[, strokeAlpha]])`
- `noErase()`

Common color extraction APIs:

- `red(c)`
- `green(c)`
- `blue(c)`
- `alpha(c)`
- `hue(c)`
- `saturation(c)`
- `brightness(c)`
- `lightness(c)`

Supported color mode constants:

- `RGB`
- `HSB`
- `HSL`

Bitmap-only blend constants:

- `BLEND`
- `ADD`
- `DARKEST`
- `LIGHTEST`
- `DIFFERENCE`
- `EXCLUSION`
- `MULTIPLY`
- `SCREEN`
- `REPLACE`
- `REMOVE`
- `OVERLAY`
- `HARD_LIGHT`
- `SOFT_LIGHT`
- `DODGE`
- `BURN`

Bitmap-only stroke constants:

- `ROUND`
- `SQUARE`
- `PROJECT`
- `MITER`
- `BEVEL`

---

## Color State

Mode: Vector, Bitmap

Momentum keeps a current drawing color state for later drawing calls.

This state includes:

- fill color
- stroke color
- stroke weight
- color mode

Color-setting functions affect later shape, text, and image-related styling until changed again.

---

## `background(...)`

Mode: Vector, Bitmap

Sets the background color of the current drawing surface.

### Signatures

```js
background(gray)
background(gray, alpha)
background(r, g, b)
background(r, g, b, alpha)
background(c)
```

### Example

```js
background(30);
```

```js
background(255, 0, 0, 128);
```

### Notes

- `background()` affects the current surface background, not the current fill or stroke state.
- In bitmap mode, this also works on `Graphics` buffers.

---

## `clear()`

Mode: Bitmap

Clears the current bitmap drawing surface.

### Signature

```js
clear()
```

### Notes

- This is only available in Bitmap mode.
- Use `clear()` when you want to reset the current bitmap surface instead of painting a new background color over it.

---

## `fill(...)`

Mode: Vector, Bitmap

Sets the fill color used by later drawing calls.

### Signatures

```js
fill(gray)
fill(gray, alpha)
fill(r, g, b)
fill(r, g, b, alpha)
fill(c)
```

### Example

```js
fill(255, 0, 0);
rect(10, 10, 40, 40);
```

### Notes

- `fill()` affects later filled shapes and text.
- `fill()` does not affect `line()` output.

---

## `noFill()`

Mode: Vector, Bitmap

Disables fill for later drawing calls.

### Signature

```js
noFill()
```

### Example

```js
noFill();
stroke(255);
rect(10, 10, 80, 40);
```

---

## `stroke(...)`

Mode: Vector, Bitmap

Sets the stroke color used by later drawing calls.

### Signatures

```js
stroke(gray)
stroke(gray, alpha)
stroke(r, g, b)
stroke(r, g, b, alpha)
stroke(c)
```

### Example

```js
stroke(255);
line(0, 0, 100, 100);
```

### Notes

- `stroke()` affects later stroked shapes, lines, and points.

---

## `noStroke()`

Mode: Vector, Bitmap

Disables stroke for later drawing calls.

### Signature

```js
noStroke()
```

### Example

```js
fill(255);
noStroke();
circle(50, 50, 40);
```

---

## `strokeWeight(w)`

Mode: Vector, Bitmap

Sets the stroke width used by later drawing calls.

### Signature

```js
strokeWeight(w)
```

### Parameters

- `w`: Stroke width

### Example

```js
stroke(255);
strokeWeight(3);
line(10, 10, 90, 90);
```

---

## `strokeCap(mode)`

Mode: Bitmap

Sets the cap style used for stroked lines.

### Signature

```js
strokeCap(mode)
```

### Parameters

- `mode`: `ROUND`, `SQUARE`, or `PROJECT`

### Supported modes

- `ROUND`: Rounded line caps.
- `SQUARE`: Square caps that stop at the line endpoint.
- `PROJECT`: Square caps that extend past the line endpoint.

### Notes

- This is only available in Bitmap mode.

---

## `strokeJoin(mode)`

Mode: Bitmap

Sets the join style used where stroked segments meet.

### Signature

```js
strokeJoin(mode)
```

### Parameters

- `mode`: `MITER`, `BEVEL`, or `ROUND`

### Supported modes

- `MITER`: Sharp corner joins.
- `BEVEL`: Flattened corner joins.
- `ROUND`: Rounded corner joins.

### Notes

- This is only available in Bitmap mode.

---

## `blendMode(mode)`

Mode: Bitmap

Sets the blend mode used by later bitmap drawing calls.

### Signature

```js
blendMode(mode)
```

### Parameters

- `mode`: One of the bitmap blend constants listed above

### Supported modes

- `BLEND`: Normal alpha compositing.
- `ADD`: Additive blending.
- `DARKEST`: Keeps the darker result.
- `LIGHTEST`: Keeps the lighter result.
- `DIFFERENCE`: Uses absolute channel difference.
- `EXCLUSION`: Softer difference-style blend.
- `MULTIPLY`: Darkens by multiplying colors.
- `SCREEN`: Lightens by screening colors.
- `REPLACE`: Replaces destination pixels directly.
- `REMOVE`: Removes overlapping color contribution.
- `OVERLAY`: Combines multiply and screen behavior.
- `HARD_LIGHT`: Strong directional light blend.
- `SOFT_LIGHT`: Softer light blend.
- `DODGE`: Brightens highlights.
- `BURN`: Darkens shadows.

### Example

```js
blendMode(MULTIPLY);
```

### Notes

- This is only available in Bitmap mode.

---

## `erase([fillAlpha[, strokeAlpha]])`

Mode: Bitmap

Enters bitmap erase mode for later drawing calls.

### Signatures

```js
erase()
erase(fillAlpha)
erase(fillAlpha, strokeAlpha)
```

### Notes

- This is only available in Bitmap mode.
- Use `noErase()` to return to normal drawing.

---

## `noErase()`

Mode: Bitmap

Leaves bitmap erase mode and returns to normal drawing.

### Signature

```js
noErase()
```

---

## `color(...)`

Mode: Vector, Bitmap

Creates a color value.

### Signatures

```js
color(gray)
color(gray, alpha)
color(r, g, b)
color(r, g, b, alpha)
```

### Returns

A color value that can be passed into APIs such as `fill()`, `stroke()`, `background()`, or `tint()`.

### Example

```js
let c = color(255, 100, 100);
fill(c);
rect(10, 10, 40, 40);
```

---

## `lerpColor(c1, c2, amt)`

Mode: Vector, Bitmap

Interpolates between two colors.

### Signature

```js
lerpColor(c1, c2, amt)
```

### Parameters

- `c1`: Start color
- `c2`: End color
- `amt`: Interpolation amount, usually between `0` and `1`

### Example

```js
let a = color(255, 0, 0);
let b = color(0, 0, 255);
let c = lerpColor(a, b, 0.5);
fill(c);
rect(10, 10, 40, 40);
```

---

## `colorMode(mode, ...)`

Mode: Vector, Bitmap

Changes how color values are interpreted.

### Signatures

```js
colorMode(mode)
colorMode(mode, max)
colorMode(mode, max1, max2, max3)
colorMode(mode, max1, max2, max3, maxA)
```

### Parameters

- `mode`: `RGB`, `HSB`, or `HSL`
- `max`, `max1`, `max2`, `max3`, `maxA`: Optional component ranges

### Example

```js
colorMode(RGB, 255);
fill(255, 0, 0);
```

```js
colorMode(HSB, 360, 100, 100, 1);
fill(30, 80, 100, 1);
```

### Notes

- `colorMode()` affects later calls to color-related functions such as `fill()`, `stroke()`, `color()`, and `tint()`.

---

## Channel Extraction

Mode: Vector, Bitmap

These functions read components from a color value.

### `red(c)`

Mode: Vector, Bitmap

Returns the red component.

### `green(c)`

Mode: Vector, Bitmap

Returns the green component.

### `blue(c)`

Mode: Vector, Bitmap

Returns the blue component.

### `alpha(c)`

Mode: Vector, Bitmap

Returns the alpha component.

### `hue(c)`

Mode: Vector, Bitmap

Returns the hue component.

### `saturation(c)`

Mode: Vector, Bitmap

Returns the saturation component.

### `brightness(c)`

Mode: Vector, Bitmap

Returns the brightness component.

### `lightness(c)`

Mode: Vector, Bitmap

Returns the lightness component.

### Example

```js
let c = color(255, 100, 50, 200);
let r = red(c);
let a = alpha(c);
```

---

## Common Pattern

Set drawing colors before drawing the shapes that should use them.

```js
fill(255, 0, 0);
stroke(255);
strokeWeight(2);
rect(10, 10, 40, 40);

noStroke();
fill(0, 200, 255);
circle(70, 70, 20);
```

---

## Minimal Example

```js
function setup() {
  createCanvas(100, 100);
  background(30);

  fill(255, 0, 0);
  stroke(255);
  strokeWeight(2);
  rect(20, 20, 60, 40);
}
```

---

## Related

- [`README.md`](../../README.md)
- [`bundle/includes/color.js`](../../bundle/includes/color.js)
- [`bundle/includes/registry.js`](../../bundle/includes/registry.js)
