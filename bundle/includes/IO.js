// IO helpers.

// Expression runtime.
function getIOLib(deps) {
  if (!deps || (!deps.loadTable && !deps.loadJSON)) return "";
  return [
    "// ===== IO Runtime =====",
    "var _momentumTableData = _td || {};",
    "var _momentumJSONData = _jd || {};",
    "function _normalizeIOPath(path) {",
    "  return String(path || '').replace(/\\\\/g, '/').replace(/^\\/+/, '');",
    "}",
    "function _rows(rows) {",
    "  return rows && rows.length ? rows : [];",
    "}",
    "function _clone(value) {",
    "  if (value === null || value === undefined) return value;",
    "  if (typeof value !== 'object') return value;",
    "  if (value.length !== undefined && typeof value !== 'string') {",
    "    var out = [];",
    "    for (var i = 0; i < value.length; i++) out.push(_clone(value[i]));",
    "    return out;",
    "  }",
    "  var obj = {};",
    "  for (var key in value) {",
    "    if (value.hasOwnProperty && value.hasOwnProperty(key)) obj[key] = _clone(value[key]);",
    "  }",
    "  return obj;",
    "}",
    "function _cols(columns, rows) {",
    "  if (columns && columns.length) return columns;",
    "  if (rows && rows.length && rows[0] && rows[0].length !== undefined) {",
    "    var result = [];",
    "    for (var i = 0; i < rows[0].length; i++) result.push(String(i));",
    "    return result;",
    "  }",
    "  return [];",
    "}",
    "function _col(table, column) {",
    "  if (typeof column === 'number') return column;",
    "  var key = String(column);",
    "  for (var i = 0; i < table.columns.length; i++) {",
    "    if (String(table.columns[i]) === key) return i;",
    "  }",
    "  return -1;",
    "}",
    "function _esc(source) {",
    "  return String(source || '').replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');",
    "}",
    "function _rowsOf(table) {",
    "  if (!table) return [];",
    "  if (!table.rows) table.rows = [];",
    "  if (table._momentumRecord) {",
    "    table._momentumRecord.rows = table.rows;",
    "  }",
    "  return table.rows;",
    "}",
    "function _readTableCell(table, rowIndex, colIndex) {",
    "  if (colIndex < 0 || rowIndex < 0) return null;",
    "  var rows = _rowsOf(table);",
    "  if (!rows[rowIndex]) return null;",
    "  return rows[rowIndex][colIndex] !== undefined ? rows[rowIndex][colIndex] : null;",
    "}",
    "function _sync(table) {",
    "  if (!table) return;",
    "  table.rowCount = table.rows ? table.rows.length : 0;",
    "  table.columnCount = table.columns ? table.columns.length : 0;",
    "  if (table._momentumRecord) {",
    "    table._momentumRecord.rows = table.rows;",
    "    table._momentumRecord.columns = table.columns;",
    "    table._momentumRecord.rowCount = table.rowCount;",
    "    table._momentumRecord.columnCount = table.columnCount;",
    "  }",
    "}",
    "function _emptyRow(table) {",
    "  var row = [];",
    "  var count = table && table.columns ? table.columns.length : 0;",
    "  for (var i = 0; i < count; i++) row.push(null);",
    "  return row;",
    "}",
    "function _setCell(table, rowIndex, colIndex, value) {",
    "  if (!table || rowIndex < 0 || colIndex < 0) return null;",
    "  var rows = _rowsOf(table);",
    "  while (rows.length <= rowIndex) rows.push(_emptyRow(table));",
    "  while (table.columns.length <= colIndex) {",
    "    table.columns.push(String(table.columns.length));",
    "    for (var r = 0; r < rows.length; r++) rows[r].push(null);",
    "  }",
    "  while (rows[rowIndex].length < table.columns.length) rows[rowIndex].push(null);",
    "  rows[rowIndex][colIndex] = value;",
    "  table.rows = rows;",
    "  _sync(table);",
    "  return value;",
    "}",
    "function _rowData(table, source) {",
    "  var row = _emptyRow(table);",
    "  if (source === null || source === undefined) return row;",
    "  if (source.table && source.index !== undefined && typeof source.arr === 'function') return source.arr();",
    "  if (source.length !== undefined && typeof source !== 'string') {",
    "    for (var i = 0; i < row.length && i < source.length; i++) row[i] = source[i];",
    "    return row;",
    "  }",
    "  if (typeof source === 'object') {",
    "    for (var c = 0; c < table.columns.length; c++) {",
    "      var key = String(table.columns[c]);",
    "      if (source.hasOwnProperty && source.hasOwnProperty(key)) row[c] = source[key];",
    "    }",
    "  }",
    "  return row;",
    "}",
    "function _objAt(table, rowIndex) {",
    "  if (rowIndex < 0 || rowIndex >= table.getRowCount()) return null;",
    "  var obj = {};",
    "  for (var i = 0; i < table.columns.length; i++) obj[String(table.columns[i])] = _readTableCell(table, rowIndex, i);",
    "  return obj;",
    "}",
    "function _row(table, rowIndex) {",
    "  if (!table || rowIndex < 0 || rowIndex >= table.getRowCount()) return null;",
    "  var row = { table: table, index: rowIndex };",
    "  var rowMethods = {",
    "    arr: function() {",
    "      var rows = _rowsOf(table);",
    "      return rows[rowIndex] ? rows[rowIndex].slice(0) : [];",
    "    },",
    "    obj: function() { return _objAt(table, rowIndex); },",
    "    get: function(column) { return table.get(rowIndex, column); },",
    "    getString: function(column) { return table.getString(rowIndex, column); },",
    "    getNum: function(column) { return table.getNum(rowIndex, column); },",
    "    set: function(column, value) { return table.set(rowIndex, column, value); },",
    "    setString: function(column, value) { return table.setString(rowIndex, column, value); },",
    "    setNum: function(column, value) { return table.setNum(rowIndex, column, value); }",
    "  };",
    "  for (var methodName in rowMethods) {",
    "    if (rowMethods.hasOwnProperty(methodName)) row[methodName] = rowMethods[methodName];",
    "  }",
    "  return row;",
    "}",
    "function _find(table, matcher, column, useRegex) {",
    "  var results = [];",
    "  var colIndex = _col(table, column);",
    "  if (colIndex < 0) return results;",
    "  var regex = null;",
    "  if (useRegex) {",
    "    try {",
    "      regex = matcher && matcher.test ? matcher : new RegExp(String(matcher || ''));",
    "    } catch (e) {",
    "      regex = new RegExp(_esc(String(matcher || '')));",
    "    }",
    "  }",
    "  for (var i = 0; i < table.getRowCount(); i++) {",
    "    var value = table.getString(i, colIndex);",
    "    if (useRegex ? regex.test(value) : value === String(matcher)) {",
    "      results.push(_row(table, i));",
    "    }",
    "  }",
    "  return results;",
    "}",
    "function _createTableObject(record) {",
    "  var rows = _rows(record && record.rows);",
    "  var rowCount = record && record.rowCount !== undefined ? record.rowCount : rows.length;",
    "  var columns = _cols(record && record.columns, rows);",
    "  var columnCount = record && record.columnCount !== undefined ? record.columnCount : columns.length;",
    "  var table = {",
    "    columns: columns.slice(0),",
    "    rows: rows.slice(0),",
    "    path: record && record.path ? record.path : '',",
    "    fileName: record && record.fileName ? record.fileName : '',",
    "    _momentumPath: record && record.path ? record.path : '',",
    "    _momentumOptions: record && record.options ? record.options : {}",
    "  };",
    "  table._momentumRecord = record || null;",
    "  table.rowCount = rowCount;",
    "  table.columnCount = columnCount;",
    "  var tableMethods = {",
    "    getRowCount: function() { return table.rowCount; },",
    "    getColumnCount: function() { return table.columnCount; },",
    "    getArray: function() {",
    "      var rows = _rowsOf(table);",
    "      var out = [];",
    "      for (var i = 0; i < rows.length; i++) out.push(rows[i].slice(0));",
    "      return out;",
    "    },",
    "    getObject: function(rowIndex) { return _objAt(table, rowIndex); },",
    "    get: function(rowIndex, column) {",
    "      var colIndex = _col(table, column);",
    "      if (colIndex < 0 || rowIndex < 0 || rowIndex >= table.getRowCount()) return null;",
    "      return _readTableCell(table, rowIndex, colIndex);",
    "    },",
    "    getRow: function(rowIndex) { return _row(table, rowIndex); },",
    "    getString: function(rowIndex, column) {",
    "      var value = table.get(rowIndex, column);",
    "      return value === null || value === undefined ? '' : String(value);",
    "    },",
    "    getNum: function(rowIndex, column) {",
    "      var raw = table.get(rowIndex, column);",
    "      if (raw === null || raw === undefined || raw === '') return NaN;",
    "      var value = Number(raw);",
    "      return isNaN(value) ? NaN : value;",
    "    },",
    "    getColumn: function(column) {",
    "      var colIndex = _col(table, column);",
    "      var out = [];",
    "      if (colIndex < 0) return out;",
    "      for (var i = 0; i < table.getRowCount(); i++) out.push(_readTableCell(table, i, colIndex));",
    "      return out;",
    "    },",
    "    findRow: function(value, column) {",
    "      var results = _find(table, value, column, false);",
    "      return results.length > 0 ? results[0] : null;",
    "    },",
    "    findRows: function(value, column) { return _find(table, value, column, false); },",
    "    matchRow: function(pattern, column) {",
    "      var results = _find(table, pattern, column, true);",
    "      return results.length > 0 ? results[0] : null;",
    "    },",
    "    matchRows: function(pattern, column) { return _find(table, pattern, column, true); },",
    "    set: function(rowIndex, column, value) {",
    "      var colIndex = _col(table, column);",
    "      if (typeof column === 'number') colIndex = column;",
    "      if (colIndex < 0) return null;",
    "      return _setCell(table, rowIndex, colIndex, value);",
    "    },",
    "    setString: function(rowIndex, column, value) {",
    "      return table.set(rowIndex, column, value === null || value === undefined ? '' : String(value));",
    "    },",
    "    setNum: function(rowIndex, column, value) {",
    "      var num = Number(value);",
    "      return table.set(rowIndex, column, isNaN(num) ? NaN : num);",
    "    },",
    "    addRow: function(sourceRow) {",
    "      var rows = _rowsOf(table);",
    "      rows.push(_rowData(table, sourceRow));",
    "      table.rows = rows;",
    "      _sync(table);",
    "      return _row(table, rows.length - 1);",
    "    },",
    "    removeRow: function(rowIndex) {",
    "      var rows = _rowsOf(table);",
    "      if (rowIndex < 0 || rowIndex >= rows.length) return null;",
    "      rows.splice(rowIndex, 1);",
    "      table.rows = rows;",
    "      _sync(table);",
    "      return table;",
    "    },",
    "    clearRows: function() {",
    "      table.rows = [];",
    "      _sync(table);",
    "      return table;",
    "    },",
    "    addColumn: function(title) {",
    "      var name = title === undefined || title === null ? String(table.columns.length) : String(title);",
    "      table.columns.push(name);",
    "      var rows = _rowsOf(table);",
    "      for (var i = 0; i < rows.length; i++) rows[i].push(null);",
    "      table.rows = rows;",
    "      _sync(table);",
    "      return name;",
    "    },",
    "    removeColumn: function(column) {",
    "      var colIndex = _col(table, column);",
    "      if (colIndex < 0) return null;",
    "      table.columns.splice(colIndex, 1);",
    "      var rows = _rowsOf(table);",
    "      for (var i = 0; i < rows.length; i++) {",
    "        if (rows[i] && rows[i].length > colIndex) rows[i].splice(colIndex, 1);",
    "      }",
    "      table.rows = rows;",
    "      _sync(table);",
    "      return table;",
    "    }",
    "  };",
    "  for (var methodName in tableMethods) {",
    "    if (tableMethods.hasOwnProperty(methodName)) table[methodName] = tableMethods[methodName];",
    "  }",
    "  return table;",
    "}",
    "function loadTable(path) {",
    "  var key = _normalizeIOPath(path);",
    "  var record = _momentumTableData[key] || _momentumTableData[String(path || '')] || null;",
    "  if (!record) record = { path: key, columns: [], rows: [], options: {} };",
    "  if (!record.path) record.path = key;",
    "  if (!record.rows) record.rows = [];",
    "  return _createTableObject(record);",
    "}",
    "function loadJSON(path) {",
    "  var key = _normalizeIOPath(path);",
    "  var data = _momentumJSONData[key];",
    "  if (data === undefined) data = _momentumJSONData[String(path || '')];",
    "  return _clone(data);",
    "}"
  ].join("\n");
}

// AE script helpers.

function _trim(str) {
  return String(str || "").replace(/^\s+|\s+$/g, "");
}

function _rel(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function _parseLoadTableCallArgs(argString) {
  var result = {
    format: "csv",
    header: false
  };
  var source = String(argString || "");
  var tokenRegex = /["']([^"']+)["']/g;
  var match;

  while ((match = tokenRegex.exec(source)) !== null) {
    var token = _trim(match[1]).toLowerCase();
    if (token === "csv" || token === "tsv") {
      result.format = token;
    } else if (token === "header") {
      result.header = true;
    }
  }

  return result;
}

function _collectTableRequestsFromCode(code) {
  var requests = {};
  if (!code || !code.length) return requests;

  var regex = /loadTable\s*\(\s*(["'])([^"']+)\1([\s\S]*?)\)/g;
  var match;
  while ((match = regex.exec(code)) !== null) {
    var relativePath = _rel(match[2]);
    if (!relativePath) continue;

    var options = _parseLoadTableCallArgs(match[3] || "");
    if (!requests[relativePath]) {
      requests[relativePath] = {
        path: relativePath,
        format: options.format,
        header: options.header
      };
    } else if (options.header) {
      requests[relativePath].header = true;
    }
  }

  return requests;
}

function _read(file) {
  if (!file || !file.exists) return null;

  file.encoding = "UTF-8";
  if (!file.open("r")) return null;

  var content = null;
  try {
    content = file.read();
  } catch (e) {
    content = null;
  }
  file.close();
  return content;
}

function _parseDelimitedTableText(text, delimiter, hasHeader) {
  var source = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  var lines = source.split("\n");
  var rows = [];
  var columns = [];

  for (var i = 0; i < lines.length; i++) {
    if (lines[i] === "" && i === lines.length - 1) continue;
    rows.push(lines[i].split(delimiter));
  }

  if (hasHeader && rows.length > 0) {
    columns = rows.shift();
  } else if (rows.length > 0) {
    for (var j = 0; j < rows[0].length; j++) {
      columns.push(String(j));
    }
  }

  return {
    columns: columns,
    rows: rows
  };
}

function collectTableDataFromCode(code) {
  var requests = _collectTableRequestsFromCode(code);
  var tableData = {};
  var userDir = _getUserDirectory ? _getUserDirectory() : null;

  if (!userDir) return tableData;

  for (var relativePath in requests) {
    if (!requests.hasOwnProperty(relativePath)) continue;

    var request = requests[relativePath];
    var fullPath = userDir + "/" + relativePath;
    var file = new File(fullPath);
    var text = _read(file);
    if (text === null) continue;

    var delimiter = request.format === "tsv" ? "\t" : ",";
    var parsed = _parseDelimitedTableText(text, delimiter, request.header);

    tableData[relativePath] = {
      path: relativePath,
      fullPath: fullPath,
      fileName: file.name,
      columns: parsed.columns,
      rows: parsed.rows,
      rowCount: parsed.rows.length,
      columnCount: parsed.columns.length,
      options: {
        format: request.format,
        header: request.header
      }
    };
  }

  return tableData;
}

function _collectJSONRequestsFromCode(code) {
  var requests = {};
  if (!code || !code.length) return requests;

  var regex = /loadJSON\s*\(\s*(["'])([^"']+)\1/g;
  var match;
  while ((match = regex.exec(code)) !== null) {
    var relativePath = _rel(match[2]);
    if (!relativePath) continue;
    requests[relativePath] = {
      path: relativePath
    };
  }

  return requests;
}

function _parseJSONText(text) {
  var source = String(text || "");
  try {
    return JSON.parse(source);
  } catch (e) {
    try {
      return eval("(" + source + ")");
    } catch (e2) {
      return null;
    }
  }
}

function collectJSONDataFromCode(code) {
  var requests = _collectJSONRequestsFromCode(code);
  var jsonData = {};
  var userDir = _getUserDirectory ? _getUserDirectory() : null;

  if (!userDir) return jsonData;

  for (var relativePath in requests) {
    if (!requests.hasOwnProperty(relativePath)) continue;

    var fullPath = userDir + "/" + relativePath;
    var file = new File(fullPath);
    var text = _read(file);
    if (text === null) continue;

    var parsed = _parseJSONText(text);
    if (parsed === null || parsed === undefined) continue;

    jsonData[relativePath] = parsed;
  }

  return jsonData;
}
