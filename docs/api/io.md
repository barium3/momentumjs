# IO

IO APIs load external structured data from the `user/` directory.

If you need bitmap-only loaders such as `loadStrings()`, `loadBytes()`, or `loadXML()`, switch the sketch to Bitmap mode.

After import, the loaded data is part of the current execution state. Changes made to source files are not reflected until the sketch is run again.

Momentum does not support p5-style save-back-to-disk workflows.

---

## Overview

Common IO APIs:

- `loadTable(path[, ...])`
- `loadJSON(path[, ...])`

Bitmap-only IO APIs:

- `loadStrings(path[, ...])`
- `loadBytes(path[, ...])`
- `loadXML(path[, ...])`

Common `Table` methods:

- `getRowCount()`
- `getColumnCount()`
- `get(row, column)`
- `getRow(row)`
- `getString(row, column)`
- `getNum(row, column)`
- `getColumn(column)`
- `getObject([row])`
- `getArray()`
- `findRow(value, column)`
- `findRows(value, column)`
- `matchRow(pattern, column)`
- `matchRows(pattern, column)`
- `set(row, column, value)`
- `setString(row, column, value)`
- `setNum(row, column, value)`
- `addRow()`
- `removeRow(row)`
- `clearRows()`
- `addColumn(title)`
- `removeColumn(column)`

Common `TableRow` methods:

- `arr()`
- `obj()`
- `get(column)`
- `getString(column)`
- `getNum(column)`
- `set(column, value)`
- `setString(column, value)`
- `setNum(column, value)`

Bitmap-only `XML` methods:

- `getParent()`
- `getName()`
- `setName(value)`
- `hasChildren()`
- `listChildren()`
- `getChildren([name])`
- `getChild(param)`
- `getContent()`
- `setContent(value)`
- `listAttributes()`
- `hasAttribute(name)`
- `getAttributeCount()`
- `getString(name[, defaultValue])`
- `getNum(name[, defaultValue])`
- `setAttribute(name, value)`
- `removeAttribute(name)`
- `serialize()`

---

## `loadTable(path[, ...])`

Mode: Vector, Bitmap

Loads table data from the `user/` directory.

### Signature

```js
loadTable(path[, ...])
```

### Returns

A `Table` object.

### Notes

- For where `user/` lives and how relative paths work, see [The `user/` Directory](../getting-started.md#the-user-directory).
- Loaded table data is represented as a `Table` object with row and column helpers.

---

## `loadJSON(path[, ...])`

Mode: Vector, Bitmap

Loads JSON data from the `user/` directory.

### Signature

```js
loadJSON(path[, ...])
```

### Returns

A cloned JSON-compatible object or array.

### Notes

- For where `user/` lives and how relative paths work, see [The `user/` Directory](../getting-started.md#the-user-directory).
- Returned JSON data is intended to behave like normal JS objects and arrays.

---

## `loadStrings(path[, successCallback[, failureCallback]])`

Mode: Bitmap

Loads a text file and returns an array of lines.

### Signature

```js
loadStrings(path)
loadStrings(path, successCallback)
loadStrings(path, successCallback, failureCallback)
```

### Returns

An array of strings.

### Notes

- For where `user/` lives and how relative paths work, see [The `user/` Directory](../getting-started.md#the-user-directory).

---

## `loadBytes(path[, successCallback[, failureCallback]])`

Mode: Bitmap

Loads a file as raw bytes.

### Signature

```js
loadBytes(path)
loadBytes(path, successCallback)
loadBytes(path, successCallback, failureCallback)
```

### Returns

A byte container object.

### Notes

- For where `user/` lives and how relative paths work, see [The `user/` Directory](../getting-started.md#the-user-directory).

---

## `loadXML(path[, successCallback[, failureCallback]])`

Mode: Bitmap

Loads an XML file from the `user/` directory.

### Signature

```js
loadXML(path)
loadXML(path, successCallback)
loadXML(path, successCallback, failureCallback)
```

### Returns

An `XML` object.

### Notes

- For where `user/` lives and how relative paths work, see [The `user/` Directory](../getting-started.md#the-user-directory).

---

## Table Basics

Mode: Vector, Bitmap

A `Table` object stores rows, columns, and row/column helpers.

Columns can be accessed by:

- numeric index
- column name

### Example

```js
let table;

function preload() {
  table = loadTable("people.csv");
}

function setup() {
  print(table.getRowCount());
  print(table.getString(0, "name"));
}
```

---

## Reading Table Data

Mode: Vector, Bitmap

### `getRowCount()`

Returns the number of rows.

### `getColumnCount()`

Returns the number of columns.

### `get(row, column)`

Returns a raw cell value.

### `getString(row, column)`

Returns a cell value as a string.

### `getNum(row, column)`

Returns a cell value as a number.

### `getColumn(column)`

Returns all values from a column.

---

## Row Access

Mode: Vector, Bitmap

### `getRow(row)`

Returns a `TableRow` object for a specific row.

### `getObject([row])`

Returns row data as an object.

### `getArray()`

Returns the full table as nested arrays.

---

## Searching

Mode: Vector, Bitmap

### `findRow(value, column)`

Returns the first row that matches a value.

### `findRows(value, column)`

Returns all rows that match a value.

### `matchRow(pattern, column)`

Returns the first row that matches a pattern.

### `matchRows(pattern, column)`

Returns all rows that match a pattern.

---

## Editing Table Data

Mode: Vector, Bitmap

### `set(row, column, value)`

Sets a raw cell value.

### `setString(row, column, value)`

Sets a string value.

### `setNum(row, column, value)`

Sets a numeric value.

### `addRow()`

Adds a new row.

### `removeRow(row)`

Removes a row.

### `clearRows()`

Removes all rows.

### `addColumn(title)`

Adds a column.

### `removeColumn(column)`

Removes a column.

### Notes

- These edits are in-memory changes to the loaded table object.
- They do not automatically write data back to disk.

---

## `TableRow` Helpers

Mode: Vector, Bitmap

### `arr()`

Returns the row as an array.

### `obj()`

Returns the row as an object.

### `get(column)`

Returns a raw value from the row.

### `getString(column)`

Returns a string value from the row.

### `getNum(column)`

Returns a numeric value from the row.

### `set(column, value)`

Sets a raw value in the row.

### `setString(column, value)`

Sets a string value in the row.

### `setNum(column, value)`

Sets a numeric value in the row.

---

## XML Helpers

Mode: Bitmap

### `getParent()`

Returns the parent XML node.

### `getName()`

Returns the node name.

### `setName(value)`

Sets the node name.

### `hasChildren()`

Returns whether the node has children.

### `listChildren()`

Returns child names.

### `getChildren([name])`

Returns child nodes, optionally filtered by name.

### `getChild(param)`

Returns a child node by index or name.

### `getContent()`

Returns the node text content.

### `setContent(value)`

Sets the node text content.

### `listAttributes()`

Returns attribute names.

### `hasAttribute(name)`

Returns whether the node has a named attribute.

### `getAttributeCount()`

Returns the number of attributes.

### `getString(name[, defaultValue])`

Returns an attribute value as a string.

### `getNum(name[, defaultValue])`

Returns an attribute value as a number.

### `setAttribute(name, value)`

Sets an attribute value.

### `removeAttribute(name)`

Removes an attribute.

### `serialize()`

Returns the XML node as a serialized string.
