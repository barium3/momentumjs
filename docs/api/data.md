# Data

Data APIs provide helpers for array manipulation, string matching, conversion, formatting, and printing.

These functions are modeled after p5.js-style data helpers where possible.

---

## Overview

Common data APIs:

- `append(list, value)`
- `arrayCopy(...)`
- `concat(a, b)`
- `reverse(list)`
- `shorten(list)`
- `shuffle(list)`
- `sort(list)`
- `splice(list, values, index)`
- `subset(list, start, [count])`
- `join(list, separator)`
- `split(str, delimiter)`
- `splitTokens(str, [tokens])`
- `trim(value)`
- `match(str, pattern)`
- `matchAll(str, pattern)`
- `nf(value, [left], [right])`
- `nfc(value, [right])`
- `nfp(value, [left], [right])`
- `nfs(value, [left], [right])`
- `str(value)`
- `boolean(value)`
- `byte(value)`
- `char(value)`
- `float(value)`
- `hex(value, [digits])`
- `int(value, [radix])`
- `unchar(value)`
- `unhex(value)`
- `print(...)`

---

## Array Helpers

Mode: Vector, Bitmap

### `append(list, value)`

Appends a value to an array.

```js
let values = [1, 2];
append(values, 3);
```

### `arrayCopy(...)`

Copies values from one array into another.

```js
arrayCopy(src, dst);
```

### `concat(a, b)`

Returns a concatenated array.

```js
let merged = concat([1, 2], [3, 4]);
```

### `reverse(list)`

Returns a reversed array.

### `shorten(list)`

Returns an array with the last element removed.

### `shuffle(list)`

Returns a shuffled array.

### `sort(list)`

Returns a sorted array.

### `splice(list, values, index)`

Inserts values into an array at a given index.

### `subset(list, start, [count])`

Returns a slice of an array.

### Example

```js
let items = [10, 20, 30, 40];
let part = subset(items, 1, 2);
```

---

## String and Token Helpers

Mode: Vector, Bitmap

### `join(list, separator)`

Joins an array into a string.

```js
let s = join(["a", "b", "c"], "-");
```

### `split(str, delimiter)`

Splits a string using a delimiter.

```js
let parts = split("a,b,c", ",");
```

### `splitTokens(str, [tokens])`

Splits a string using token characters.

```js
let parts = splitTokens("a, b; c");
```

### `trim(value)`

Trims surrounding whitespace from a string or list of strings.

```js
let s = trim("  hello  ");
```

---

## Matching Helpers

Mode: Vector, Bitmap

### `match(str, pattern)`

Returns the first regex-style match.

### `matchAll(str, pattern)`

Returns all regex-style matches.

### Example

```js
let first = match("abc123", "\\d+");
let all = matchAll("a1 b2 c3", "\\d");
```

---

## Number Formatting

Mode: Vector, Bitmap

### `nf(value, [left], [right])`

Formats a number with digit padding.

### `nfc(value, [right])`

Formats a number with separators.

### `nfp(value, [left], [right])`

Formats a number and always includes a sign for positive numbers.

### `nfs(value, [left], [right])`

Formats a number and prefixes positive values with a space.

### Example

```js
let a = nf(12.3, 2, 1);
let b = nfc(12345.67, 2);
```

---

## Type Conversion

Mode: Vector, Bitmap

### `str(value)`

Converts a value to a string.

### `boolean(value)`

Converts a value to boolean-like output.

### `byte(value)`

Converts a value to byte-like output.

### `char(value)`

Converts a value to a character.

### `float(value)`

Converts a value to a floating-point number.

### `hex(value, [digits])`

Converts a value to hexadecimal text.

### `int(value, [radix])`

Converts a value to an integer.

### `unchar(value)`

Converts a character into its numeric code.

### `unhex(value)`

Converts hexadecimal text into a number.

### Example

```js
let a = int("42");
let b = float("3.14");
let c = hex(255);
```

---

## `print(...)`

Mode: Vector, Bitmap

Prints values to the console output.

### Signature

```js
print(...)
```

### Example

```js
print("hello", 42);
```

### Notes

- `print()` is intended for debugging and inspection.
- Output is shown through the Momentum frontend console handling.

---

## Common Pattern

Mode: Vector, Bitmap

Use data helpers to prepare values before drawing.

```js
let raw = "10,20,30";
let parts = split(raw, ",");
let a = int(parts[0]);
let b = int(parts[1]);
let c = int(parts[2]);

print(a, b, c);
```

---

## Minimal Example

```js
function setup() {
  let values = [1, 2, 3];
  append(values, 4);

  let label = join(values, ", ");
  print(label);
}
```

---

## Related

- [`README.md`](../../README.md)
- [`bundle/includes/DATA.js`](../../bundle/includes/DATA.js)
- [`bundle/includes/registry.js`](../../bundle/includes/registry.js)
