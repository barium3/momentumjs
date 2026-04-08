# Shapes

Shape APIs cover primitive drawing, shape modes, and custom path construction.

These functions are modeled after p5.js-style drawing workflows and are used for geometry, fills, strokes, and path building.

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
- `ellipseMode(mode)`
- `rectMode(mode)`

Custom shape APIs:

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

Mode: Vector, Bitmap

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

Mode: Vector, Bitmap

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

Mode: Vector, Bitmap

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

Mode: Vector, Bitmap

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

Mode: Vector, Bitmap

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

Mode: Vector, Bitmap

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

Mode: Vector, Bitmap

Draws a point.

### Signatures

```js
point(x, y)
point(vec)
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

Mode: Vector, Bitmap

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

Mode: Vector, Bitmap

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

Mode: Vector, Bitmap

Draws an arc.

### Signatures

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

## `ellipseMode(mode)`

Mode: Vector, Bitmap

Controls how `ellipse()` interprets its arguments.

### Signature

```js
ellipseMode(mode)
```

### Supported modes

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

---

## `rectMode(mode)`

Mode: Vector, Bitmap

Controls how `rect()` interprets its arguments.

### Signature

```js
rectMode(mode)
```

### Supported modes

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

---

## Custom Shapes

Mode: Vector, Bitmap

Use `beginShape()` and related vertex functions to build custom geometry.

### Basic polygon

```js
beginShape();
vertex(10, 10);
vertex(90, 10);
vertex(50, 90);
endShape(CLOSE);
```

### `beginShape()`

Mode: Vector, Bitmap

Starts a custom shape.

### `vertex(x, y)`

Mode: Vector, Bitmap

Adds a straight vertex to the current shape.

### `bezierVertex(...)`

Mode: Vector, Bitmap

Adds a bezier segment to the current shape.

### `quadraticVertex(...)`

Mode: Vector, Bitmap

Adds a quadratic bezier segment to the current shape.

### `curveVertex(x, y)`

Mode: Vector, Bitmap

Adds a curve vertex to the current shape.

### `beginContour()`

Mode: Vector, Bitmap

Starts an inner contour in the current shape.

### `endContour()`

Mode: Vector, Bitmap

Ends the current contour.

### `endShape([mode])`

Mode: Vector, Bitmap

Finishes the current custom shape.

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
