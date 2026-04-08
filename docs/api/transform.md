# Transform

Transform APIs control how later drawing commands are positioned, rotated, scaled, and otherwise transformed.

These functions affect subsequent shape, image, and text calls until the transform state is changed again or restored.

---

## Overview

Common transform APIs:

- `translate(x, y)`
- `rotate(angle)`
- `scale(s)`
- `scale(x, y)`
- `applyMatrix(...)`
- `push()`
- `pop()`
- `resetMatrix()`

Bitmap-only transform APIs:

- `shearX(angle)`
- `shearY(angle)`

---

## Transform State

Mode: Vector, Bitmap

Momentum keeps a current transform state that affects later drawing calls.

This state includes:

- translation
- rotation
- scale

Transform calls are cumulative.

```js
translate(20, 0);
translate(10, 0);
// later drawing is shifted by 30 on x
```

---

## `translate(x, y)`

Mode: Vector, Bitmap

Moves the coordinate system for subsequent drawing.

### Signatures

```js
translate(x, y)
translate(vec)
```

### Parameters

- `x`: Horizontal offset
- `y`: Vertical offset

### Example

```js
translate(20, 10);
rect(0, 0, 40, 20);
```

### Notes

- `translate()` affects all later draw calls until the transform state changes again.
- Translation is applied in the current transformed coordinate system.

---

## `rotate(angle)`

Mode: Vector, Bitmap

Rotates the coordinate system for subsequent drawing.

### Signature

```js
rotate(angle)
```

### Parameters

- `angle`: Rotation amount

### Example

```js
translate(50, 50);
rotate(PI / 4);
rect(0, 0, 40, 20);
```

### Notes

- `rotate()` affects all later draw calls until the transform state changes again.
- Rotation is cumulative.
- Angle interpretation follows the current angle mode in the sketch.

---

## `scale(s)`

Mode: Vector, Bitmap

Scales the coordinate system uniformly.

### Signature

```js
scale(s)
```

### Parameters

- `s`: Uniform scale factor

### Example

```js
scale(2);
circle(20, 20, 10);
```

---

## `scale(x, y)`

Mode: Vector, Bitmap

Scales the coordinate system independently on each axis.

### Signature

```js
scale(x, y)
```

### Parameters

- `x`: Horizontal scale factor
- `y`: Vertical scale factor

### Example

```js
scale(2, 0.5);
ellipse(50, 50, 40, 40);
```

### Notes

- `scale()` affects all later draw calls until the transform state changes again.
- Scale is cumulative.
- Non-uniform scale changes width and height independently.

---

## `applyMatrix(...)`

Mode: Vector, Bitmap

Applies a custom transform matrix.

### Signatures

```js
applyMatrix(mat)
applyMatrix(a, b, c, d, e, f)
```

### Notes

- Use this when you need direct control over the transform matrix.
- `shearX()` and `shearY()` are built on top of `applyMatrix(...)`.

---

## `shearX(angle)`

Mode: Bitmap

Applies an X-axis shear transform.

### Signature

```js
shearX(angle)
```

### Notes

- This is currently documented as Bitmap-only.
- Internally it is implemented through `applyMatrix(...)`.

---

## `shearY(angle)`

Mode: Bitmap

Applies a Y-axis shear transform.

### Signature

```js
shearY(angle)
```

### Notes

- This is currently documented as Bitmap-only.
- Internally it is implemented through `applyMatrix(...)`.

---

## `push()`

Mode: Vector, Bitmap

Saves the current drawing state.

### Signature

```js
push()
```

### Example

```js
translate(20, 20);

push();
rotate(PI / 4);
rect(0, 0, 40, 20);
pop();

rect(0, 0, 40, 20);
```

### Notes

- `push()` saves the current transform state.
- It is typically paired with `pop()`.
- Use it to isolate local drawing changes.

---

## `pop()`

Mode: Vector, Bitmap

Restores the most recently saved drawing state.

### Signature

```js
pop()
```

### Example

```js
push();
translate(50, 0);
circle(0, 0, 20);
pop();

circle(0, 0, 20);
```

### Notes

- `pop()` restores the state saved by the most recent `push()`.
- If you use `push()`, you should normally use a matching `pop()`.

---

## `resetMatrix()`

Mode: Vector, Bitmap

Resets the current transform state.

### Signature

```js
resetMatrix()
```

### Example

```js
translate(50, 50);
rotate(PI / 4);

resetMatrix();
rect(0, 0, 20, 20);
```

### Notes

- `resetMatrix()` clears translation, rotation, and scale state.
- Use it when you want later drawing to return to the default coordinate system.

---

## Common Pattern

Mode: Vector, Bitmap

Use `push()` and `pop()` to apply local transforms without affecting later drawing.

```js
rect(0, 0, 20, 20);

push();
translate(50, 50);
rotate(PI / 4);
rect(0, 0, 20, 20);
pop();

rect(80, 0, 20, 20);
```

---

## Minimal Example

```js
function setup() {
  createCanvas(120, 120);
}

function draw() {
  background(30);

  push();
  translate(60, 60);
  rotate(PI / 4);
  rect(-20, -10, 40, 20);
  pop();
}
```
