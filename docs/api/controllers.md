# Controllers

Controllers are one of Momentum's core features because they make it possible to drive sketch variables with After Effects keyframes.

The main implementation is a dedicated layer named `__controller__`. When a user creates controllers in sketch code, Momentum maps them to After Effects expression controls attached to that layer. Once those expression controls exist, users can change their values directly in After Effects or animate them with keyframes. Those animated control values are then read back by the sketch and used as the values of the corresponding controller-driven variables.

---

## Overview

Controller APIs:

- `createSlider(min, max, value, step)`
- `createAngle(defaultDegrees)`
- `createColorPicker(...)`
- `createCheckbox(label, checked)`
- `createSelect()`
- `createPoint(defaultX, defaultY)`
- `createPathController(name, points, closed)`

Controller values are mapped to a controller layer in After Effects:

- `Slider Control`
- `Angle Control`
- `Color Control`
- `Checkbox Control`
- `Dropdown Menu Control`
- `Point Control`
- `Mask Path`

---

## Controller Layer

Momentum stores controller definitions on a dedicated After Effects layer:

`__controller__`

Each controller call maps to one control entry on that layer.

This means:

- controller values can be edited in After Effects
- the sketch reads those values at evaluation time
- controller order matters because controls are assigned by call sequence

---

## `createSlider(min, max, value, step)`

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

### Returns

A controller object with:

- `value()`

### Example

```js
let speed = createSlider(0, 100, 50, 1);
let v = speed.value();
```

### Notes

- Values are clamped to the configured range.
- If `step` is greater than `0`, values are snapped to that step.

---

## `createAngle(defaultDegrees)`

Creates an angle controller.

### Signature

```js
createAngle(defaultDegrees)
```

### Parameters

- `defaultDegrees`: Default angle in degrees

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

### Notes

- Internally, this controller is degree-based.

---

## `createColorPicker(...)`

Creates a color controller.

### Supported forms

```js
createColorPicker("#ff0000")
createColorPicker(r, g, b)
createColorPicker(r, g, b, a)
```

### Returns

A controller object with:

- `color()`
- `value()`

### Behavior

- `color()` returns a normalized color array
- `value()` returns a hex-style string

### Example

```js
let picker = createColorPicker("#ff0000");
fill(picker.color());
```

---

## `createCheckbox(label, checked)`

Creates a checkbox controller.

### Signature

```js
createCheckbox(label, checked)
```

### Parameters

- `label`: Controller label
- `checked`: Default checked state

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

Creates a point controller.

### Signature

```js
createPoint(defaultX, defaultY)
```

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

## `createPathController(name, points, closed)`

Creates a path controller backed by an AE mask path.

### Signature

```js
createPathController(name, points, closed)
```

### Parameters

- `name`: Path name
- `points`: Default points
- `closed`: Whether the path is closed

### Returns

A controller object with:

- `exists()`
- `closed()`
- `points()`
- `point(t)`
- `tangent(t)`
- `normal(t)`
- `angle(t)`
- `sample(count)`

### Example

```js
let path = createPathController("guide", [[50, 50], [150, 50]], false);
let p = path.point(0.5);
circle(p[0], p[1], 10);
```

### Notes

- This controller is backed by a mask path on the controller layer.
- Path sampling methods use normalized `t` values from `0` to `1`.

---

## Common Pattern

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
