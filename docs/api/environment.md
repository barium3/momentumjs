# Environment

Environment APIs control sketch-level configuration and expose global runtime values such as canvas size and frame state.

If you need bitmap-only features such as `pixelDensity()`, switch the sketch to Bitmap mode.

Loop-control APIs such as `isLooping()`, `loop()`, `noLoop()`, and `redraw()` are currently not supported in Bitmap mode. Bitmap rendering is driven by the After Effects effect host, so p5-style loop control is not available there yet.

---

## Overview

Common environment APIs:

- `createCanvas(width, height)`
- `frameRate(fps)`
- `duration(seconds)`
- `duration(h, m, s, f)`

Bitmap-only environment APIs:

- `pixelDensity([value])`

Vector-only environment APIs:

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

Mode: Vector

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

### Notes

- Bitmap mode does not support this yet.
- Because bitmap rendering is driven by the After Effects plugin host, loop state is not exposed in the same p5-style way.

---

## `loop()`

Mode: Vector

Enables sketch looping.

### Signature

```js
loop()
```

### Example

```js
loop();
```

### Notes

- Bitmap mode does not support this yet.
- Due to the After Effects plugin runtime model, bitmap rendering cannot currently opt into p5-style loop control.

---

## `noLoop()`

Mode: Vector

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

- Bitmap mode does not support this yet.
- Due to the After Effects plugin runtime model, bitmap rendering is evaluated by the host instead of being paused with p5-style loop control.

---

## `redraw()`

Mode: Vector

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

- Bitmap mode does not support this yet.
- Due to the After Effects plugin runtime model, there is currently no direct equivalent to p5-style manual redraw requests.

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
