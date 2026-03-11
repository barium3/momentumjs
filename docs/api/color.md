# Color

Color APIs control fill, stroke, opacity, and color conversion behavior for drawing.

These functions are modeled after p5.js-style color workflows and affect later drawing calls until the color state changes again.

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

---

## Color State

Momentum keeps a current drawing color state for later drawing calls.

This state includes:

- fill color
- stroke color
- stroke weight
- color mode

Color-setting functions affect later shape, text, and image-related styling until changed again.

---

## `background(...)`

Sets the sketch background color.

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

- `background()` affects the sketch background, not the current fill or stroke state.
- Unlike `fill()`, `background()` is treated as a separate background operation.
- Transparent background values can affect how previous frame imagery is retained in animated workflows.

---

## `fill(...)`

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

## `color(...)`

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

These functions read components from a color value.

### `red(c)`

Returns the red component.

### `green(c)`

Returns the green component.

### `blue(c)`

Returns the blue component.

### `alpha(c)`

Returns the alpha component.

### `hue(c)`

Returns the hue component.

### `saturation(c)`

Returns the saturation component.

### `brightness(c)`

Returns the brightness component.

### `lightness(c)`

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

- [`README.md`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/README.md)
- [`bundle/includes/color.js`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/bundle/includes/color.js)
- [`bundle/includes/registry.js`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/bundle/includes/registry.js)
