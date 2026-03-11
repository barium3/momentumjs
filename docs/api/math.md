# Math

Math APIs provide numeric helpers, constants, angle utilities, random functions, noise functions, and vector-related helpers used in Momentum sketches.

These functions are mostly modeled after p5.js math behavior.

---

## Overview

Common math constants:

- `PI`
- `TWO_PI`
- `HALF_PI`
- `QUARTER_PI`

Common angle and mode constants:

- `DEGREES`
- `RADIANS`
- `CENTER`
- `RADIUS`
- `CORNER`
- `CORNERS`
- `OPEN`
- `CHORD`
- `PIE`
- `CLOSE`
- `LEFT`
- `RIGHT`
- `TOP`
- `BOTTOM`
- `BASELINE`

Common math APIs:

- `sin(v)`
- `cos(v)`
- `tan(v)`
- `asin(v)`
- `acos(v)`
- `atan(v)`
- `atan2(y, x)`
- `degrees(rad)`
- `radians(deg)`
- `angleMode(mode)`
- `sqrt(v)`
- `pow(a, b)`
- `abs(v)`
- `floor(v)`
- `ceil(v)`
- `round(v)`
- `min(...)`
- `max(...)`
- `exp(v)`
- `log(v)`
- `sq(v)`
- `fract(v)`
- `norm(v, a, b)`
- `mag(x, y)`
- `map(v, a1, b1, a2, b2)`
- `constrain(v, minV, maxV)`
- `lerp(a, b, t)`
- `dist(x1, y1, x2, y2)`
- `random()`
- `random(max)`
- `random(min, max)`
- `randomGaussian()`
- `randomSeed(seed)`
- `noise(x, [y], [z])`
- `noiseDetail(lod, [falloff])`
- `noiseSeed(seed)`
- `bezierPoint(...)`
- `bezierTangent(...)`
- `curvePoint(...)`
- `curveTangent(...)`
- `curveTightness(v)`
- `createVector(x, [y], [z])`

---

## Constants

### `PI`

The value of pi.

### `TWO_PI`

Two times pi.

### `HALF_PI`

Half pi.

### `QUARTER_PI`

Quarter pi.

### Example

```js
rotate(PI / 4);
arc(50, 50, 80, 80, 0, HALF_PI);
```

---

## Angle Functions

### `degrees(rad)`

Converts radians to degrees.

```js
let d = degrees(PI);
```

### `radians(deg)`

Converts degrees to radians.

```js
let r = radians(180);
```

### `angleMode(mode)`

Controls how angle-based functions interpret input.

#### Signature

```js
angleMode(mode)
```

#### Parameters

- `mode`: `DEGREES` or `RADIANS`

#### Example

```js
angleMode(DEGREES);
rotate(45);
```

### Notes

- `angleMode()` affects later angle-based operations such as `rotate()` and trigonometric workflows that follow current sketch angle conventions.

---

## Trigonometric Functions

### Functions

- `sin(v)`
- `cos(v)`
- `tan(v)`
- `asin(v)`
- `acos(v)`
- `atan(v)`
- `atan2(y, x)`

### Example

```js
let x = cos(PI / 4) * 50;
let y = sin(PI / 4) * 50;
line(0, 0, x, y);
```

---

## Basic Numeric Functions

### Functions

- `sqrt(v)`
- `pow(a, b)`
- `abs(v)`
- `floor(v)`
- `ceil(v)`
- `round(v)`
- `min(...)`
- `max(...)`
- `exp(v)`
- `log(v)`
- `sq(v)`
- `fract(v)`

### Example

```js
let a = sqrt(25);
let b = pow(2, 4);
let c = floor(3.8);
```

---

## Range and Mapping Functions

### `norm(v, a, b)`

Normalizes `v` from range `[a, b]` into a `0..1` style value.

### `map(v, a1, b1, a2, b2)`

Maps a value from one range into another.

### `constrain(v, minV, maxV)`

Constrains a value into the given range.

### `lerp(a, b, t)`

Interpolates between two values.

### Example

```js
let n = norm(25, 0, 100);
let x = map(n, 0, 1, 10, 90);
let y = constrain(x, 20, 80);
```

---

## Distance and Magnitude

### `mag(x, y)`

Returns the magnitude of a 2D vector.

### `dist(x1, y1, x2, y2)`

Returns the distance between two points.

### Example

```js
let d = dist(0, 0, 100, 100);
let m = mag(3, 4);
```

---

## Random Functions

### `random()`

Returns a random value.

### `random(max)`

Returns a random value from `0` to `max`.

### `random(min, max)`

Returns a random value from `min` to `max`.

### `randomGaussian()`

Returns a Gaussian-distributed random value.

### `randomSeed(seed)`

Sets the seed for random generation.

### Example

```js
randomSeed(1);
let x = random(100);
let y = random(20, 80);
```

### Notes

- Use `randomSeed()` when you need repeatable results.

---

## Noise Functions

### `noise(x, [y], [z])`

Returns Perlin-style noise.

### `noiseDetail(lod, [falloff])`

Adjusts noise detail settings.

### `noiseSeed(seed)`

Sets the seed for noise generation.

### Example

```js
noiseSeed(1);
let n = noise(frameCount * 0.01);
let x = map(n, 0, 1, 0, width);
```

---

## Curve Helpers

### Functions

- `bezierPoint(...)`
- `bezierTangent(...)`
- `curvePoint(...)`
- `curveTangent(...)`
- `curveTightness(v)`

### Example

```js
let x = bezierPoint(0, 20, 80, 100, 0.5);
let y = bezierPoint(0, 80, 20, 100, 0.5);
point(x, y);
```

---

## Vector Helper

### `createVector(x, [y], [z])`

Creates a vector object.

### Signature

```js
createVector()
createVector(x)
createVector(x, y)
createVector(x, y, z)
```

### Example

```js
let v = createVector(10, 20);
```

### Notes

- Vector support depends on the available p5-style runtime support in the frontend environment.

---

## Common Pattern

Use math helpers to drive drawing parameters.

```js
let a = frameCount * 0.05;
let x = 50 + cos(a) * 20;
let y = 50 + sin(a) * 20;
circle(x, y, 10);
```

---

## Minimal Example

```js
function setup() {
  createCanvas(100, 100);
  background(30);

  let x = 50 + cos(PI / 4) * 20;
  let y = 50 + sin(PI / 4) * 20;

  circle(x, y, 10);
}
```

---

## Related

- [`README.md`](../../README.md)
- [`bundle/includes/math.js`](../../bundle/includes/math.js)
- [`bundle/includes/registry.js`](../../bundle/includes/registry.js)
