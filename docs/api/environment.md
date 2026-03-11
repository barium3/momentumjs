# Environment

Environment APIs control sketch-level configuration and expose global environment values such as canvas size and frame state.

These APIs define how the sketch is interpreted and updated across frames.

---

## Overview

Environment APIs:

- `createCanvas(width, height)`
- `frameRate(fps)`
- `duration(seconds)`
- `duration(h, m, s, f)`
- `isLooping()`
- `loop()`
- `noLoop()`
- `redraw()`

Environment values:

- `width`
- `height`
- `frameCount`

---

## `createCanvas(width, height)`

Defines the After Effects composition size used by the sketch.

### Signature

```js
createCanvas(width, height)
```

### Parameters

- `width`: Composition width
- `height`: Composition height

### Example

```js
createCanvas(1920, 1080);
```

### Notes

- This corresponds to the size of the main After Effects composition.
- `width` and `height` reflect this configured size.

---

## `frameRate(fps)`

Defines the sketch frame rate.

### Signature

```js
frameRate(fps)
```

### Parameters

- `fps`: Frames per second

### Example

```js
frameRate(30);
```

### Notes

- This affects time-based sketch progression and `frameCount` behavior.

---

## `duration(...)`

This is not a standard p5.js API. In Momentum, its main purpose is to define the duration of the After Effects composition.

### Signatures

```js
duration(seconds)
duration(hours, minutes, seconds, frames)
```

### Parameters

- `seconds`: Total duration in seconds
- `hours`: Hours component
- `minutes`: Minutes component
- `seconds`: Seconds component
- `frames`: Additional frame component

### Example

```js
duration(10);
```

```js
duration(0, 0, 5, 12);
```

### Notes

- `duration()` is used for composition timing, not for delaying code execution.
- This function is specific to Momentum and is mainly used to control AE composition length.

---

## `width`

Global width of the sketch.

### Example

```js
circle(width / 2, 50, 20);
```

---

## `height`

Global height of the sketch.

### Example

```js
circle(50, height / 2, 20);
```

---

## `frameCount`

Current frame index of the sketch.

### Example

```js
let x = frameCount % width;
circle(x, 50, 10);
```

### Notes

- `frameCount` changes as the sketch advances.
- Use it for frame-based animation logic.

---

## `isLooping()`

Returns whether the sketch is currently looping.

### Signature

```js
isLooping()
```

### Example

```js
if (!isLooping()) {
  loop();
}
```

---

## `loop()`

Enables sketch looping.

### Signature

```js
loop()
```

### Example

```js
loop();
```

---

## `noLoop()`

Disables continuous sketch looping.

### Signature

```js
noLoop()
```

### Example

```js
noLoop();
```

### Notes

- Use `noLoop()` when you only want the sketch to update on demand.

---

## `redraw()`

Requests another update when looping is disabled.

### Signature

```js
redraw()
```

### Example

```js
noLoop();
redraw();
```

### Notes

- `redraw()` is mainly useful together with `noLoop()`.

---

## Common Pattern

Define the environment in `setup()` before sketch logic depends on it.

```js
function setup() {
  createCanvas(1920, 1080);
  frameRate(30);
  duration(10);
}
```

---

## Minimal Example

```js
function setup() {
  createCanvas(200, 100);
  frameRate(30);
}

function draw() {
  background(30);
  circle(frameCount % width, height / 2, 10);
}
```

---

## Related

- [`README.md`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/README.md)
- [`bundle/includes/environment.js`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/bundle/includes/environment.js)
- [`bundle/includes/registry.js`](/Library/Application%20Support/Adobe/CEP/extensions/momentumjs/bundle/includes/registry.js)
