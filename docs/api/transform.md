# Transform

Transform APIs control how later drawing commands are positioned, rotated, and scaled.

These functions affect subsequent shape, image, and text calls until the transform state is changed again or restored.

---

## Overview

Transform APIs:

- `translate(x, y)`
- `rotate(angle)`
- `scale(s)`
- `scale(x, y)`
- `push()`
- `pop()`
- `resetMatrix()`

---

## Transform State

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

Moves the coordinate system for subsequent drawing.

### Signature

```js
translate(x, y)
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
- Angle interpretation follows the current angle-related math behavior in the sketch.

---

## `scale(s)`

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

## `push()`

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
  createCanvas(100, 100);
  background(30);

  push();
  translate(50, 50);
  rotate(PI / 4);
  rectMode(CENTER);
  rect(0, 0, 30, 20);
  pop();
}
```

---

## Related

- [`README.md`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/README.md)
- [`bundle/includes/transformation.js`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/bundle/includes/transformation.js)
- [`bundle/includes/registry.js`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/bundle/includes/registry.js)
