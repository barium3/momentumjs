# Controllers

Controllers are one of Momentum's core features because they make it possible to drive sketch variables with After Effects keyframes.

In vector mode, controllers are AE expression controls on a dedicated `__controller__` layer.

In bitmap mode, controllers are plugin controls on the bitmap effect layer.

In both cases, sketch code reads the host-side control values back into the runtime.

---

## Overview

Controller APIs:

- `createSlider([min], [max], [value], [step])`
- `createAngle([defaultDegrees])`
- `createColorPicker(...)`
- `createCheckbox([label], [checked])`
- `createSelect()`
- `createPoint([defaultX], [defaultY])`

---

## `createSlider([min], [max], [value], [step])`

Mode: Vector, Bitmap

Creates a slider controller.

### Signature

```js
createSlider(min, max, value, step)
```

### Parameters

- `min`: Minimum value
- `max`: Maximum value
- `value`: Default value
- `step`: Step size

### Notes

- All parameters are optional.
- Defaults are `min = 0`, `max = 100`, `step = 0`.

### Returns

A controller object with:

- `value()`

### Example

```js
let speed = createSlider(0, 100, 50, 1);
let v = speed.value();
```

- Values are clamped to the configured range.
- If `step` is greater than `0`, values are snapped to that step.

---

## `createAngle([defaultDegrees])`

Mode: Vector, Bitmap

Creates an angle controller.

### Signature

```js
createAngle(defaultDegrees)
```

### Parameters

- `defaultDegrees`: Default angle in degrees

### Notes

- The argument is optional.

### Returns

A controller object with:

- `value()`
- `degrees()`
- `radians()`

### Example

```js
let ang = createAngle(45);
rotate(radians(ang.value()));
```

- Internally, this controller is degree-based.

---

## `createColorPicker(...)`

Mode: Vector, Bitmap

Creates a color controller.

### Supported forms

```js
createColorPicker()
createColorPicker("#ff0000")
createColorPicker(r, g, b)
createColorPicker(r, g, b, a)
```

### Returns

A controller object with:

- `color()`
- `value()`

### Behavior

- `color()` returns a Momentum color value
- `value()` returns a hex-style string

### Example

```js
let picker = createColorPicker("#ff0000");
fill(picker.color());
```

---

## `createCheckbox([label], [checked])`

Mode: Vector, Bitmap

Creates a checkbox controller.

### Signature

```js
createCheckbox(label, checked)
```

### Parameters

- `label`: Controller label
- `checked`: Default checked state

### Notes

- Both arguments are optional.

### Returns

A controller object with:

- `value()`
- `checked()`

### Example

```js
let enabled = createCheckbox("Show shape", true);

if (enabled.checked()) {
  circle(50, 50, 20);
}
```

---

## `createSelect()`

Mode: Vector, Bitmap

Creates a dropdown-style selection controller.

### Signature

```js
createSelect()
```

### Returns

A controller object with:

- `option(label, [value])`
- `index()`
- `value()`
- `selected()`
- `selected(v)`

### Example

```js
let sel = createSelect();
sel.option("A");
sel.option("B");
sel.selected("B");

let v = sel.value();
```

### Notes

- Options are defined in sketch code order.
- The selected result is read back from the AE dropdown control.

---

## `createPoint(defaultX, defaultY)`

Mode: Vector, Bitmap

Creates a point controller.

### Signature

```js
createPoint(defaultX, defaultY)
```

### Notes

- Both arguments are optional.

### Returns

A controller object with:

- `value()`
- `x()`
- `y()`

### Example

```js
let pt = createPoint(100, 200);
circle(pt.x(), pt.y(), 20);
```

---

## Common Pattern

Mode: Vector, Bitmap

Create controllers once, then read them in setup or draw logic.

```js
let sizeCtrl;
let colorCtrl;

function setup() {
  sizeCtrl = createSlider(10, 100, 40, 1);
  colorCtrl = createColorPicker("#00aaff");
}

function draw() {
  fill(colorCtrl.color());
  circle(50, 50, sizeCtrl.value());
}
```

---

## Minimal Example

Mode: Vector, Bitmap

```js
let sizeCtrl;

function setup() {
  createCanvas(200, 100);
  sizeCtrl = createSlider(10, 80, 30, 1);
}

function draw() {
  background(30);
  circle(100, 50, sizeCtrl.value());
}
```

---

## Related

- [`README.md`](../../README.md)
- [`bundle/includes/controller.js`](../../bundle/includes/controller.js)
- [`bundle/includes/registry.js`](../../bundle/includes/registry.js)
