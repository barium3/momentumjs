# Environment

Environment APIs control sketch-level configuration and expose global runtime values such as canvas size and frame state.

`createCanvas()`, `frameRate()`, and `duration()` define the After Effects
composition contract. Momentum accepts these calls wherever normal code can
run, but Bitmap Code keyframes must retain the same calls and values. Change
them from the main Momentum editor instead.

The setter form of `pixelDensity(value)` remains a bitmap runtime setting and
is not part of that Code keyframe restriction.

If you need bitmap-only features such as `pixelDensity()`, switch the sketch to Bitmap mode.

Loop-control APIs follow the p5.js 1.9 lifecycle in both render modes. In
Bitmap mode, `noLoop()` pauses JavaScript state progression while After Effects
continues requesting frames; the last rendered bitmap remains frozen until the
loop resumes or an external callback requests `redraw()`.

---

## Overview

Common environment APIs:

- `createCanvas(width, height)`
- `frameRate(fps)`
- `duration(seconds)`
- `duration(h, m, s, f)`

Bitmap-only environment APIs:

- `pixelDensity([value])`

Common loop-control APIs:

- `isLooping()`
- `loop()`
- `noLoop()`
- `redraw()`

Common environment values:

- `width`
- `height`
- `frameCount`

---

## `createCanvas(width, height)`

Mode: Vector, Bitmap

Defines the sketch canvas size.

### Signature

```js
createCanvas(width, height)
```

### Parameters

- `width`: Canvas width
- `height`: Canvas height

### Example

```js
createCanvas(1920, 1080);
```

### Notes

- In vector mode, this defines the main composition size used by the sketch pipeline.
- In bitmap mode, this defines the bitmap canvas rendered by `Momentum.plugin`.
- Global `width` and `height` reflect this configured size.

---

## `frameRate(fps)`

Mode: Vector, Bitmap

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

Mode: Vector, Bitmap

Defines the sketch duration used by Momentum.

This is not a standard p5.js API. In Momentum, its main purpose is to control the duration of the generated AE result.

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

---

## `pixelDensity([value])`

Mode: Bitmap

Gets or sets the bitmap canvas pixel density.

### Signatures

```js
pixelDensity()
pixelDensity(value)
```

### Parameters

- `value`: Target density multiplier

### Example

```js
pixelDensity(2);
```

### Notes

- This is only available in Bitmap mode.
- `Image` and `Graphics` objects also expose their own `pixelDensity()` methods. See [Image](./image.md).

---

## `width`

Mode: Vector, Bitmap

Global width of the current sketch canvas.

### Example

```js
circle(width / 2, 50, 20);
```

---

## `height`

Mode: Vector, Bitmap

Global height of the current sketch canvas.

### Example

```js
circle(50, height / 2, 20);
```

---

## `frameCount`

Mode: Vector, Bitmap

Number of user `draw()` calls made by the sketch. The first call observes
`frameCount === 1`.

### Example

```js
let x = frameCount % width;
circle(x, 50, 10);
```

### Notes

- `frameCount` increments only when the user's `draw()` actually runs. A paused
  AE timeline frame does not increment it.
- Use it for frame-based animation logic.

---

## `isLooping()`

Mode: Vector, Bitmap

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

In Bitmap mode this reports the replayable loop state owned by the effect's
JavaScript evaluator, not whether After Effects itself is requesting frames.

---

## `loop()`

Mode: Vector, Bitmap

Enables sketch looping.

### Signature

```js
loop()
```

### Example

```js
loop();
```

Momentum resumes `draw()` on the current or next host evaluation. This is the
After Effects equivalent of p5.js scheduling another animation update; it does
not start a separate browser animation loop.

---

## `noLoop()`

Mode: Vector, Bitmap

Disables continuous sketch looping.

### Signature

```js
noLoop()
```

### Example

```js
noLoop();
```

The current `draw()` completes before later timeline frames freeze. Calling
`noLoop()` from `setup()` still allows the mandatory first `draw()`, matching
p5.js.

---

## `redraw()`

Mode: Vector, Bitmap

Requests one or more explicit `draw()` calls.

### Signature

```js
redraw([n])
```

### Example

Bitmap controller-event example:

```js
let sizeCtrl;

function setup() {
  sizeCtrl = createSlider(10, 200, 60, 1);
  noLoop();
  sizeCtrl.changed(function () {
    redraw();
  });
}

function draw() {
  background(30);
  circle(width / 2, height / 2, sizeCtrl.value());
}
```

### Parameters

- `n` (optional): Number of `draw()` calls. It is parsed as an integer;
  omitted, invalid, or values below `1` default to `1`.

### Notes

- Like p5.js 1.9, calls made before `setup()` completes or from inside the
  user's `draw()` are ignored. Calling it at the end of `setup()` therefore
  does not create a second first frame.
- `redraw()` is valid whether looping is enabled or disabled.
- Bitmap controller `.changed()` callbacks provide the external event phase
  needed for interactive redraws. They execute before that host frame's normal
  draw decision.
- To keep an AE render request bounded, Momentum limits a single queued batch
  to `1000` draw calls.

---

## Common Pattern

Define the environment in `setup()` before later drawing logic depends on it.

```js
function setup() {
  createCanvas(1920, 1080);
  frameRate(30);
  duration(10);
}
```
