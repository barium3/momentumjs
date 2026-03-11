# IO

IO APIs load external structured data such as tables and JSON files from the `user/` directory.

After import, the loaded data is effectively baked into the current execution result. Changes made to the source table or JSON file are not automatically reflected until the sketch is executed again.

For the same reason, Momentum does not support p5-style APIs that save modified data back to the original source file.

These APIs are intended for read-heavy sketch workflows, with table objects also supporting a set of in-memory editing helpers.

---

## Overview

Common IO APIs:

- `loadTable(path)`
- `loadJSON(path)`

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

---

## `loadTable(path)`

Loads table data from the `user/` directory.

### Signature

```js
loadTable(path)
```

### Parameters

- `path`: Relative file path under `user/`

### Returns

A `Table` object.

### Example

```js
let table;

function preload() {
  table = loadTable("data.csv");
}
```

### Notes

- Paths are relative to the extension's `user/` folder.
- Loaded table data is represented as a `Table` object with row and column helpers.

---

## `loadJSON(path)`

Loads JSON data from the `user/` directory.

### Signature

```js
loadJSON(path)
```

### Parameters

- `path`: Relative file path under `user/`

### Returns

A cloned JSON-compatible object or array.

### Example

```js
let data;

function preload() {
  data = loadJSON("config.json");
}
```

### Notes

- Paths are relative to the extension's `user/` folder.
- Returned JSON data is intended to behave like normal JS objects and arrays.

---

## Table Basics

A `Table` object stores:

- rows
- columns
- row count
- column count

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

### Example

```js
let count = table.getRowCount();
let age = table.getNum(0, "age");
let names = table.getColumn("name");
```

---

## Row Access

### `getRow(row)`

Returns a `TableRow` object for a specific row.

### `getObject([row])`

Returns row data as an object.

### `getArray()`

Returns the full table as nested arrays.

### Example

```js
let row = table.getRow(0);
print(row.getString("name"));

let obj = table.getObject(0);
print(obj.name);
```

---

## Searching

### `findRow(value, column)`

Returns the first row that matches a value.

### `findRows(value, column)`

Returns all rows that match a value.

### `matchRow(pattern, column)`

Returns the first row that matches a pattern.

### `matchRows(pattern, column)`

Returns all rows that match a pattern.

### Example

```js
let first = table.findRow("Alice", "name");
let matches = table.matchRows("^A", "name");
```

---

## Editing Table Data

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

### Example

```js
table.setString(0, "name", "Alice");
table.addColumn("score");
table.setNum(0, "score", 100);
```

### Notes

- These edits are in-memory changes to the loaded table object.
- They do not automatically write data back to disk.

---

## `TableRow` Helpers

`TableRow` objects provide row-level convenience methods.

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

### Example

```js
let row = table.getRow(0);
print(row.arr());
print(row.obj());
print(row.getString("name"));
```

---

## Common Pattern

Load external data in `preload()`, then use it during drawing or setup.

```js
let table;

function preload() {
  table = loadTable("people.csv");
}

function setup() {
  createCanvas(100, 100);
  let name = table.getString(0, "name");
  print(name);
}
```

---

## Minimal Example

```js
let config;

function preload() {
  config = loadJSON("config.json");
}

function setup() {
  print(config.title);
}
```

---

## Related

- [`README.md`](../../README.md)
- [`bundle/includes/IO.js`](../../bundle/includes/IO.js)
- [`bundle/includes/registry.js`](../../bundle/includes/registry.js)
