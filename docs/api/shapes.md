# Shapes

Shape APIs create vector-based geometry as shape groups inside After Effects layers.

In After Effects terms, the smallest shape unit in Momentum is:

`Layer -> Contents -> Shape Group`

Each shape call such as `rect()`, `circle()`, or `triangle()` is represented as one shape group under a layer's `Contents`. This is the basic unit used to build and organize shape output.

These functions are modeled after p5.js and are intended for sketch-style drawing workflows such as primitives, paths, fills, and strokes.

---

## Overview

Common shape APIs:

- `ellipse(x, y, w, [h])`
- `circle(x, y, d)`
- `rect(x, y, w, [h])`
- `square(x, y, s)`
- `line(x1, y1, x2, y2)`
- `point(x, y)`
- `triangle(x1, y1, x2, y2, x3, y3)`
- `quad(x1, y1, x2, y2, x3, y3, x4, y4)`
- `arc(x, y, w, h, start, stop, [mode])`
- `beginShape()`
- `vertex(x, y)`
- `bezierVertex(...)`
- `quadraticVertex(...)`
- `curveVertex(x, y)`
- `beginContour()`
- `endContour()`
- `endShape([mode])`

Common related style APIs:

- `fill(...)`
- `noFill()`
- `stroke(...)`
- `noStroke()`
- `strokeWeight(w)`

Common related mode constants:

- `CENTER`
- `RADIUS`
- `CORNER`
- `CORNERS`
- `OPEN`
- `CHORD`
- `PIE`
- `CLOSE`

---

## Shape Styling

Most shape functions use the current drawing style.

### Fill

```js
fill(255, 0, 0);
rect(10, 10, 40, 40);
```

### Stroke

```js
stroke(255);
strokeWeight(2);
line(0, 0, 100, 100);
```

### Disable fill or stroke

```js
noFill();
stroke(255);
rect(10, 10, 80, 40);
```

```js
fill(255);
noStroke();
circle(50, 50, 40);
```

---

## `ellipse(x, y, w, [h])`

Draws an ellipse.

### Signatures

```js
ellipse(x, y, w)
ellipse(x, y, w, h)
```

### Parameters

- `x`: X position
- `y`: Y position
- `w`: Width
- `h`: Optional height. If omitted, `w` is used.

### Example

```js
ellipse(50, 50, 80, 40);
ellipse(50, 50, 40);
```

### Notes

- `ellipse()` is affected by `ellipseMode()`.

---

## `circle(x, y, d)`

Draws a circle.

### Signature

```js
circle(x, y, d)
```

### Parameters

- `x`: X position
- `y`: Y position
- `d`: Diameter

### Example

```js
circle(50, 50, 40);
```

### Notes

- `circle()` is affected by `ellipseMode()`.

---

## `rect(x, y, w, [h])`

Draws a rectangle.

### Signatures

```js
rect(x, y, w)
rect(x, y, w, h)
```

### Parameters

- `x`: X position
- `y`: Y position
- `w`: Width
- `h`: Optional height. If omitted, `w` is used.

### Example

```js
rect(10, 10, 80, 40);
rect(20, 20, 40);
```

### Notes

- `rect()` is affected by `rectMode()`.

---

## `square(x, y, s)`

Draws a square.

### Signature

```js
square(x, y, s)
```

### Parameters

- `x`: X position
- `y`: Y position
- `s`: Side length

### Example

```js
square(20, 20, 40);
```

### Notes

- `square()` is affected by `rectMode()`.

---

## `line(x1, y1, x2, y2)`

Draws a line segment.

### Signature

```js
line(x1, y1, x2, y2)
```

### Example

```js
line(0, 0, 100, 100);
```

### Notes

- `line()` only uses stroke-related styling.
- `fill()` does not affect `line()`.

---

## `point(x, y)`

Draws a point.

### Signature

```js
point(x, y)
```

### Example

```js
stroke(255);
strokeWeight(4);
point(50, 50);
```

### Notes

- `point()` uses the current stroke color and stroke weight.

---

## `triangle(x1, y1, x2, y2, x3, y3)`

Draws a triangle.

### Signature

```js
triangle(x1, y1, x2, y2, x3, y3)
```

### Example

```js
triangle(20, 80, 50, 20, 80, 80);
```

---

## `quad(x1, y1, x2, y2, x3, y3, x4, y4)`

Draws a quadrilateral.

### Signature

```js
quad(x1, y1, x2, y2, x3, y3, x4, y4)
```

### Example

```js
quad(20, 20, 80, 20, 90, 80, 10, 80);
```

---

## `arc(x, y, w, h, start, stop, [mode])`

Draws an arc.

### Signature

```js
arc(x, y, w, h, start, stop)
arc(x, y, w, h, start, stop, mode)
```

### Parameters

- `x`: X position
- `y`: Y position
- `w`: Width
- `h`: Height
- `start`: Start angle
- `stop`: End angle
- `mode`: Optional arc mode: `OPEN`, `CHORD`, or `PIE`

### Example

```js
arc(50, 50, 80, 80, 0, PI, PIE);
```

### Arc modes

#### `OPEN`

Draws only the arc edge between `start` and `stop`.

```js
arc(50, 50, 80, 80, 0, PI, OPEN);
```

#### `CHORD`

Draws the arc edge and closes the shape with a straight line between the two arc endpoints.

```js
arc(50, 50, 80, 80, 0, PI, CHORD);
```

#### `PIE`

Draws the arc edge and closes the shape back to the center, producing a pie-slice shape.

```js
arc(50, 50, 80, 80, 0, PI, PIE);
```

### Notes

- `arc()` is affected by its own `mode` argument: `OPEN`, `CHORD`, or `PIE`.

---

## Shape Modes

Some shape functions depend on drawing mode.

### `ellipseMode(mode)`

Controls how `ellipse()` interprets its arguments.

Supported modes:

- `CENTER`
- `RADIUS`
- `CORNER`
- `CORNERS`

#### `CENTER`

- `x`, `y`: center of the ellipse
- `w`: width
- `h`: height

```js
ellipseMode(CENTER);
ellipse(50, 50, 80, 40);
```

#### `RADIUS`

- `x`, `y`: center of the ellipse
- `w`: horizontal radius
- `h`: vertical radius

```js
ellipseMode(RADIUS);
ellipse(50, 50, 40, 20);
```

This produces the same final size as `ellipse(50, 50, 80, 40)` in `CENTER` mode.

#### `CORNER`

- `x`, `y`: top-left corner of the ellipse bounds
- `w`: width
- `h`: height

```js
ellipseMode(CORNER);
ellipse(10, 20, 80, 40);
```

#### `CORNERS`

- `x`, `y`: one corner of the ellipse bounds
- `w`, `h`: opposite corner of the ellipse bounds

```js
ellipseMode(CORNERS);
ellipse(10, 20, 90, 60);
```

### `rectMode(mode)`

Controls how `rect()` interprets its arguments.

Supported modes:

- `CENTER`
- `RADIUS`
- `CORNER`
- `CORNERS`

#### `CENTER`

- `x`, `y`: center of the rectangle
- `w`: width
- `h`: height

```js
rectMode(CENTER);
rect(50, 50, 40, 20);
```

#### `RADIUS`

- `x`, `y`: center of the rectangle
- `w`: half-width
- `h`: half-height

```js
rectMode(RADIUS);
rect(50, 50, 20, 10);
```

This produces the same final size as `rect(50, 50, 40, 20)` in `CENTER` mode.

#### `CORNER`

- `x`, `y`: top-left corner
- `w`: width
- `h`: height

```js
rectMode(CORNER);
rect(10, 20, 40, 20);
```

#### `CORNERS`

- `x`, `y`: one corner
- `w`, `h`: opposite corner

```js
rectMode(CORNERS);
rect(10, 20, 50, 40);
```

### Example

```js
rectMode(CENTER);
rect(50, 50, 40, 20);
```

---

## Custom Shapes

Use `beginShape()` and related vertex functions to build custom geometry.

### Basic polygon

```js
beginShape();
vertex(10, 10);
vertex(90, 10);
vertex(50, 90);
endShape(CLOSE);
```

### Supported builder functions

- `vertex(x, y)`
- `bezierVertex(...)`
- `quadraticVertex(...)`
- `curveVertex(x, y)`
- `beginContour()`
- `endContour()`
- `endShape([mode])`

### Notes

- Use `CLOSE` in `endShape(CLOSE)` to close the path.
- `beginContour()` and `endContour()` are used for inner contours.

---

## Minimal Example

```js
function setup() {
  createCanvas(100, 100);
  background(30);

  fill(255, 100, 100);
  noStroke();
  circle(50, 50, 40);
}
```

---

## Related

- [`README.md`](../../README.md)
- [`bundle/includes/shape.js`](../../bundle/includes/shape.js)
- [`bundle/includes/registry.js`](../../bundle/includes/registry.js)
