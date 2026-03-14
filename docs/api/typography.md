# Typography

Typography APIs control text content, font settings, layout, alignment, and text measurement.

Because of limitations in the After Effects environment, Momentum does not support loading fonts with `loadFont()`. Fonts must be installed on the computer before they can be used. For the recommended font-selection workflow, see [`textFont()`](#textfontfont-size).

Because of limitations in the After Effects environment, paragraph text does not support a second correction pass against paragraph bounds. For that reason, paragraph-style text in Momentum is implemented as point text with a custom line-breaking mechanism.

These functions are modeled after p5.js-style text workflows and affect later text drawing calls until the text state changes again.

---

## Overview

Common typography APIs:

- `text(str, x, y)`
- `text(str, x, y, maxWidth)`
- `text(str, x, y, maxWidth, maxHeight)`
- `textSize(size)`
- `textLeading(leading)`
- `textFont(font, [size])`
- `textStyle(style)`
- `textWrap(mode)`
- `textAlign([horizontal], [vertical])`
- `textWidth(str)`
- `textAscent()`
- `textDescent()`

Common text-related constants:

- `LEFT`
- `CENTER`
- `RIGHT`
- `TOP`
- `BOTTOM`
- `BASELINE`
- `WORD`
- `CHAR`
- `NORMAL`
- `BOLD`
- `ITALIC`
- `BOLDITALIC`

---

## Text State

Momentum keeps a current text state for later `text()` calls.

This state includes:

- font
- size
- leading
- alignment
- wrap mode
- style
- fill and stroke settings

Text-setting functions affect later text drawing calls until changed again.

---

## `text(str, x, y, [maxWidth], [maxHeight])`

Draws text at a position, optionally inside a text box.

### Signatures

```js
text(str, x, y)
text(str, x, y, maxWidth)
text(str, x, y, maxWidth, maxHeight)
```

### Parameters

- `str`: Text content
- `x`: X position
- `y`: Y position
- `maxWidth`: Optional text box width
- `maxHeight`: Optional text box height

### Behavior

- Without `maxWidth`, text is drawn as a single text item starting at `x`, `y`.
- With `maxWidth`, Momentum treats the call as boxed text layout.
- With both `maxWidth` and `maxHeight`, text is laid out inside the given bounds.

### Example

```js
text("Hello", 20, 30);
text("Hello world", 20, 30, 120);
text("Hello world", 20, 30, 120, 60);
```

### Notes

- `text()` is affected by the current typography state and current fill/stroke state.
- Boxed text behavior is also affected by `textAlign()`, `textWrap()`, and `rectMode()`.
- When `maxWidth` or `maxHeight` is provided, the text box is interpreted using the current [`rectMode()`](shapes.md).

---

## `textSize(size)`

Sets the text size for later `text()` calls.

### Signature

```js
textSize(size)
```

### Parameters

- `size`: Font size

### Example

```js
textSize(24);
text("Hello", 20, 30);
```

---

## `textLeading(leading)`

Sets the line spacing used for multi-line text.

### Signature

```js
textLeading(leading)
```

### Parameters

- `leading`: Line spacing value

### Example

```js
textLeading(28);
text("Line 1\nLine 2", 20, 30);
```

---

## `textFont(font, [size])`

Sets the font used for later `text()` calls.

### Signatures

```js
textFont(font)
textFont(font, size)
```

### Parameters

- `font`: Font name string
- `size`: Optional font size

### Example

```js
textFont("Arial");
text("Hello", 20, 30);
```

```js
textFont("Arial", 24);
text("Hello", 20, 30);
```

### Notes

- In the editor, `textFont()` shows a font dropdown/autocomplete list inside the first argument. It is recommended to choose fonts from that list instead of typing names manually.
- If a size is provided, it also updates the current text size.
- Final font resolution depends on the available font mapping in the application environment.

---

## `textStyle(style)`

Sets the text style for later `text()` calls.

### Signature

```js
textStyle(style)
```

### Parameters

- `style`: One of `NORMAL`, `BOLD`, `ITALIC`, or `BOLDITALIC`

### Example

```js
textStyle(BOLD);
text("Hello", 20, 30);
```

---

## `textWrap(mode)`

Sets the wrapping mode used for boxed text.

### Signature

```js
textWrap(mode)
```

### Parameters

- `mode`: `WORD` or `CHAR`

### Example

```js
textWrap(WORD);
text("Hello world from Momentum", 20, 30, 100);
```

### Notes

- `textWrap()` mainly affects `text()` calls that use a text box width.

---

## `textAlign([horizontal], [vertical])`

Sets horizontal and optional vertical text alignment.

### Signatures

```js
textAlign()
textAlign(horizontal)
textAlign(horizontal, vertical)
```

### Parameters

- `horizontal`: `LEFT`, `CENTER`, or `RIGHT`
- `vertical`: `TOP`, `CENTER`, `BOTTOM`, or `BASELINE`

### Example

```js
textAlign(CENTER, CENTER);
text("Hello", 50, 50);
```

### Notes

- Alignment affects later `text()` calls.
- Vertical alignment is especially important for boxed text layout.

---

## `textWidth(str)`

Measures the width of a string using the current text state.

### Signature

```js
textWidth(str)
```

### Parameters

- `str`: Text to measure

### Returns

The measured width.

### Example

```js
let w = textWidth("Hello");
```

---

## `textAscent()`

Returns the ascent of the current font and text size.

### Signature

```js
textAscent()
```

### Example

```js
let a = textAscent();
```

---

## `textDescent()`

Returns the descent of the current font and text size.

### Signature

```js
textDescent()
```

### Example

```js
let d = textDescent();
```

---

## Common Pattern

Set the text state before drawing text.

```js
textFont("Arial");
textSize(24);
textAlign(CENTER, CENTER);
fill(255);
text("Hello", 50, 50);
```

---

## Minimal Example

```js
function setup() {
  createCanvas(200, 100);
  background(30);

  fill(255);
  textFont("Arial");
  textSize(24);
  textAlign(CENTER, CENTER);
  text("Hello", width / 2, height / 2);
}
```

---

## Related

- [`README.md`](../../README.md)
- [`bundle/includes/typography.js`](../../bundle/includes/typography.js)
- [`bundle/includes/registry.js`](../../bundle/includes/registry.js)
