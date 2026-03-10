// ----------------------------------------
// IO - Table / JSON 数据库
// 当前目标：
//   1. AE 表达式端提供与前端一致的 loadTable() 入口
//   2. CSV / TSV / JSON 均由脚本端预读取并直接注入表达式上下文
//   3. Table 在表达式端表现为可变内存表，而不是 footage 代理
// ----------------------------------------

// ----------------------------------------
// 表达式端：生成 loadTable / loadJSON 运行时库
// ----------------------------------------
function getIOLib(deps) {
  if (!deps || (!deps.loadTable && !deps.loadJSON)) return "";

  var lines = [];
  lines.push("// IO 库");
  lines.push("var _momentumTableData = _td || {};");
  lines.push("var _momentumJSONData = _jd || {};");
  lines.push("function _normalizeIOPath(path) {");
  lines.push(
    "  return String(path || '').replace(/\\\\/g, '/').replace(/^\\/+/, '');"
  );
  lines.push("}");
  lines.push("function _rows(rows) {");
  lines.push("  return rows && rows.length ? rows : [];");
  lines.push("}");
  lines.push("function _clone(value) {");
  lines.push("  if (value === null || value === undefined) return value;");
  lines.push("  if (typeof value !== 'object') return value;");
  lines.push(
    "  if (value.length !== undefined && typeof value !== 'string') {"
  );
  lines.push("    var out = [];");
  lines.push(
    "    for (var i = 0; i < value.length; i++) out.push(_clone(value[i]));"
  );
  lines.push("    return out;");
  lines.push("  }");
  lines.push("  var obj = {};");
  lines.push("  for (var key in value) {");
  lines.push(
    "    if (value.hasOwnProperty && value.hasOwnProperty(key)) obj[key] = _clone(value[key]);"
  );
  lines.push("  }");
  lines.push("  return obj;");
  lines.push("}");
  lines.push("function _cols(columns, rows) {");
  lines.push("  if (columns && columns.length) return columns;");
  lines.push(
    "  if (rows && rows.length && rows[0] && rows[0].length !== undefined) {"
  );
  lines.push("    var result = [];");
  lines.push(
    "    for (var i = 0; i < rows[0].length; i++) result.push(String(i));"
  );
  lines.push("    return result;");
  lines.push("  }");
  lines.push("  return [];");
  lines.push("}");
  lines.push("function _col(table, column) {");
  lines.push("  if (typeof column === 'number') return column;");
  lines.push("  var key = String(column);");
  lines.push("  for (var i = 0; i < table.columns.length; i++) {");
  lines.push("    if (String(table.columns[i]) === key) return i;");
  lines.push("  }");
  lines.push("  return -1;");
  lines.push("}");
  lines.push("function _esc(source) {");
  lines.push(
    "  return String(source || '').replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');"
  );
  lines.push("}");
  lines.push("function _rowsOf(table) {");
  lines.push("  if (!table) return [];");
  lines.push("  if (!table.rows) table.rows = [];");
  lines.push("  if (table._momentumRecord) {");
  lines.push("    table._momentumRecord.rows = table.rows;");
  lines.push("  }");
  lines.push("  return table.rows;");
  lines.push("}");
  lines.push("function _readTableCell(table, rowIndex, colIndex) {");
  lines.push("  if (colIndex < 0 || rowIndex < 0) return null;");
  lines.push("  var rows = _rowsOf(table);");
  lines.push("  if (!rows[rowIndex]) return null;");
  lines.push(
    "  return rows[rowIndex][colIndex] !== undefined ? rows[rowIndex][colIndex] : null;"
  );
  lines.push("}");
  lines.push("function _sync(table) {");
  lines.push("  if (!table) return;");
  lines.push("  table.rowCount = table.rows ? table.rows.length : 0;");
  lines.push("  table.columnCount = table.columns ? table.columns.length : 0;");
  lines.push("  if (table._momentumRecord) {");
  lines.push("    table._momentumRecord.rows = table.rows;");
  lines.push("    table._momentumRecord.columns = table.columns;");
  lines.push("    table._momentumRecord.rowCount = table.rowCount;");
  lines.push("    table._momentumRecord.columnCount = table.columnCount;");
  lines.push("  }");
  lines.push("}");
  lines.push("function _emptyRow(table) {");
  lines.push("  var row = [];");
  lines.push(
    "  var count = table && table.columns ? table.columns.length : 0;"
  );
  lines.push("  for (var i = 0; i < count; i++) row.push(null);");
  lines.push("  return row;");
  lines.push("}");
  lines.push("function _setCell(table, rowIndex, colIndex, value) {");
  lines.push("  if (!table || rowIndex < 0 || colIndex < 0) return null;");
  lines.push("  var rows = _rowsOf(table);");
  lines.push("  while (rows.length <= rowIndex) rows.push(_emptyRow(table));");
  lines.push("  while (table.columns.length <= colIndex) {");
  lines.push("    table.columns.push(String(table.columns.length));");
  lines.push("    for (var r = 0; r < rows.length; r++) rows[r].push(null);");
  lines.push("  }");
  lines.push(
    "  while (rows[rowIndex].length < table.columns.length) rows[rowIndex].push(null);"
  );
  lines.push("  rows[rowIndex][colIndex] = value;");
  lines.push("  table.rows = rows;");
  lines.push("  _sync(table);");
  lines.push("  return value;");
  lines.push("}");
  lines.push("function _rowData(table, source) {");
  lines.push("  var row = _emptyRow(table);");
  lines.push("  if (source === null || source === undefined) return row;");
  lines.push(
    "  if (source.table && source.index !== undefined && typeof source.arr === 'function') return source.arr();"
  );
  lines.push(
    "  if (source.length !== undefined && typeof source !== 'string') {"
  );
  lines.push(
    "    for (var i = 0; i < row.length && i < source.length; i++) row[i] = source[i];"
  );
  lines.push("    return row;");
  lines.push("  }");
  lines.push("  if (typeof source === 'object') {");
  lines.push("    for (var c = 0; c < table.columns.length; c++) {");
  lines.push("      var key = String(table.columns[c]);");
  lines.push(
    "      if (source.hasOwnProperty && source.hasOwnProperty(key)) row[c] = source[key];"
  );
  lines.push("    }");
  lines.push("  }");
  lines.push("  return row;");
  lines.push("}");
  lines.push("function _objAt(table, rowIndex) {");
  lines.push(
    "  if (rowIndex < 0 || rowIndex >= table.getRowCount()) return null;"
  );
  lines.push("  var obj = {};");
  lines.push(
    "  for (var i = 0; i < table.columns.length; i++) obj[String(table.columns[i])] = _readTableCell(table, rowIndex, i);"
  );
  lines.push("  return obj;");
  lines.push("}");
  lines.push("function _row(table, rowIndex) {");
  lines.push(
    "  if (!table || rowIndex < 0 || rowIndex >= table.getRowCount()) return null;"
  );
  lines.push("  var row = { table: table, index: rowIndex };");
  lines.push("  var rowMethods = {");
  lines.push("    arr: function() {");
  lines.push("      var rows = _rowsOf(table);");
  lines.push("      return rows[rowIndex] ? rows[rowIndex].slice(0) : [];");
  lines.push("    },");
  lines.push("    obj: function() { return _objAt(table, rowIndex); },");
  lines.push(
    "    get: function(column) { return table.get(rowIndex, column); },"
  );
  lines.push(
    "    getString: function(column) { return table.getString(rowIndex, column); },"
  );
  lines.push(
    "    getNum: function(column) { return table.getNum(rowIndex, column); },"
  );
  lines.push(
    "    set: function(column, value) { return table.set(rowIndex, column, value); },"
  );
  lines.push(
    "    setString: function(column, value) { return table.setString(rowIndex, column, value); },"
  );
  lines.push(
    "    setNum: function(column, value) { return table.setNum(rowIndex, column, value); }"
  );
  lines.push("  };");
  lines.push("  for (var methodName in rowMethods) {");
  lines.push(
    "    if (rowMethods.hasOwnProperty(methodName)) row[methodName] = rowMethods[methodName];"
  );
  lines.push("  }");
  lines.push("  return row;");
  lines.push("}");
  lines.push("function _find(table, matcher, column, useRegex) {");
  lines.push("  var results = [];");
  lines.push("  var colIndex = _col(table, column);");
  lines.push("  if (colIndex < 0) return results;");
  lines.push("  var regex = null;");
  lines.push("  if (useRegex) {");
  lines.push("    try {");
  lines.push(
    "      regex = matcher && matcher.test ? matcher : new RegExp(String(matcher || ''));"
  );
  lines.push("    } catch (e) {");
  lines.push("      regex = new RegExp(_esc(String(matcher || '')));");
  lines.push("    }");
  lines.push("  }");
  lines.push("  for (var i = 0; i < table.getRowCount(); i++) {");
  lines.push("    var value = table.getString(i, colIndex);");
  lines.push(
    "    if (useRegex ? regex.test(value) : value === String(matcher)) {"
  );
  lines.push("      results.push(_row(table, i));");
  lines.push("    }");
  lines.push("  }");
  lines.push("  return results;");
  lines.push("}");
  lines.push("function _createTableObject(record) {");
  lines.push("  var rows = _rows(record && record.rows);");
  lines.push(
    "  var rowCount = record && record.rowCount !== undefined ? record.rowCount : rows.length;"
  );
  lines.push("  var columns = _cols(record && record.columns, rows);");
  lines.push(
    "  var columnCount = record && record.columnCount !== undefined ? record.columnCount : columns.length;"
  );
  lines.push("  var table = {");
  lines.push("    columns: columns.slice(0),");
  lines.push("    rows: rows.slice(0),");
  lines.push("    path: record && record.path ? record.path : '',");
  lines.push("    fileName: record && record.fileName ? record.fileName : '',");
  lines.push("    _momentumPath: record && record.path ? record.path : '',");
  lines.push(
    "    _momentumOptions: record && record.options ? record.options : {}"
  );
  lines.push("  };");
  lines.push("  table._momentumRecord = record || null;");
  lines.push("  table.rowCount = rowCount;");
  lines.push("  table.columnCount = columnCount;");
  lines.push("  var tableMethods = {");
  lines.push("    getRowCount: function() { return table.rowCount; },");
  lines.push("    getColumnCount: function() { return table.columnCount; },");
  lines.push("    getArray: function() {");
  lines.push("      var rows = _rowsOf(table);");
  lines.push("      var out = [];");
  lines.push(
    "      for (var i = 0; i < rows.length; i++) out.push(rows[i].slice(0));"
  );
  lines.push("      return out;");
  lines.push("    },");
  lines.push(
    "    getObject: function(rowIndex) { return _objAt(table, rowIndex); },"
  );
  lines.push("    get: function(rowIndex, column) {");
  lines.push("      var colIndex = _col(table, column);");
  lines.push(
    "      if (colIndex < 0 || rowIndex < 0 || rowIndex >= table.getRowCount()) return null;"
  );
  lines.push("      return _readTableCell(table, rowIndex, colIndex);");
  lines.push("    },");
  lines.push(
    "    getRow: function(rowIndex) { return _row(table, rowIndex); },"
  );
  lines.push("    getString: function(rowIndex, column) {");
  lines.push("      var value = table.get(rowIndex, column);");
  lines.push(
    "      return value === null || value === undefined ? '' : String(value);"
  );
  lines.push("    },");
  lines.push("    getNum: function(rowIndex, column) {");
  lines.push("      var raw = table.get(rowIndex, column);");
  lines.push(
    "      if (raw === null || raw === undefined || raw === '') return NaN;"
  );
  lines.push("      var value = Number(raw);");
  lines.push("      return isNaN(value) ? NaN : value;");
  lines.push("    },");
  lines.push("    getColumn: function(column) {");
  lines.push("      var colIndex = _col(table, column);");
  lines.push("      var out = [];");
  lines.push("      if (colIndex < 0) return out;");
  lines.push(
    "      for (var i = 0; i < table.getRowCount(); i++) out.push(_readTableCell(table, i, colIndex));"
  );
  lines.push("      return out;");
  lines.push("    },");
  lines.push("    findRow: function(value, column) {");
  lines.push("      var results = _find(table, value, column, false);");
  lines.push("      return results.length > 0 ? results[0] : null;");
  lines.push("    },");
  lines.push(
    "    findRows: function(value, column) { return _find(table, value, column, false); },"
  );
  lines.push("    matchRow: function(pattern, column) {");
  lines.push("      var results = _find(table, pattern, column, true);");
  lines.push("      return results.length > 0 ? results[0] : null;");
  lines.push("    },");
  lines.push(
    "    matchRows: function(pattern, column) { return _find(table, pattern, column, true); },"
  );
  lines.push("    set: function(rowIndex, column, value) {");
  lines.push("      var colIndex = _col(table, column);");
  lines.push("      if (typeof column === 'number') colIndex = column;");
  lines.push("      if (colIndex < 0) return null;");
  lines.push("      return _setCell(table, rowIndex, colIndex, value);");
  lines.push("    },");
  lines.push("    setString: function(rowIndex, column, value) {");
  lines.push(
    "      return table.set(rowIndex, column, value === null || value === undefined ? '' : String(value));"
  );
  lines.push("    },");
  lines.push("    setNum: function(rowIndex, column, value) {");
  lines.push("      var num = Number(value);");
  lines.push(
    "      return table.set(rowIndex, column, isNaN(num) ? NaN : num);"
  );
  lines.push("    },");
  lines.push("    addRow: function(sourceRow) {");
  lines.push("      var rows = _rowsOf(table);");
  lines.push("      rows.push(_rowData(table, sourceRow));");
  lines.push("      table.rows = rows;");
  lines.push("      _sync(table);");
  lines.push("      return _row(table, rows.length - 1);");
  lines.push("    },");
  lines.push("    removeRow: function(rowIndex) {");
  lines.push("      var rows = _rowsOf(table);");
  lines.push("      if (rowIndex < 0 || rowIndex >= rows.length) return null;");
  lines.push("      rows.splice(rowIndex, 1);");
  lines.push("      table.rows = rows;");
  lines.push("      _sync(table);");
  lines.push("      return table;");
  lines.push("    },");
  lines.push("    clearRows: function() {");
  lines.push("      table.rows = [];");
  lines.push("      _sync(table);");
  lines.push("      return table;");
  lines.push("    },");
  lines.push("    addColumn: function(title) {");
  lines.push(
    "      var name = title === undefined || title === null ? String(table.columns.length) : String(title);"
  );
  lines.push("      table.columns.push(name);");
  lines.push("      var rows = _rowsOf(table);");
  lines.push("      for (var i = 0; i < rows.length; i++) rows[i].push(null);");
  lines.push("      table.rows = rows;");
  lines.push("      _sync(table);");
  lines.push("      return name;");
  lines.push("    },");
  lines.push("    removeColumn: function(column) {");
  lines.push("      var colIndex = _col(table, column);");
  lines.push("      if (colIndex < 0) return null;");
  lines.push("      table.columns.splice(colIndex, 1);");
  lines.push("      var rows = _rowsOf(table);");
  lines.push("      for (var i = 0; i < rows.length; i++) {");
  lines.push(
    "        if (rows[i] && rows[i].length > colIndex) rows[i].splice(colIndex, 1);"
  );
  lines.push("      }");
  lines.push("      table.rows = rows;");
  lines.push("      _sync(table);");
  lines.push("      return table;");
  lines.push("    }");
  lines.push("  };");
  lines.push("  for (var methodName in tableMethods) {");
  lines.push(
    "    if (tableMethods.hasOwnProperty(methodName)) table[methodName] = tableMethods[methodName];"
  );
  lines.push("  }");
  lines.push("  return table;");
  lines.push("}");
  lines.push("function loadTable(path) {");
  lines.push("  var key = _normalizeIOPath(path);");
  lines.push(
    "  var record = _momentumTableData[key] || _momentumTableData[String(path || '')] || null;"
  );
  lines.push(
    "  if (!record) record = { path: key, columns: [], rows: [], options: {} };"
  );
  lines.push("  if (!record.path) record.path = key;");
  lines.push("  if (!record.rows) record.rows = [];");
  lines.push("  return _createTableObject(record);");
  lines.push("}");
  lines.push("function loadJSON(path) {");
  lines.push("  var key = _normalizeIOPath(path);");
  lines.push("  var data = _momentumJSONData[key];");
  lines.push(
    "  if (data === undefined) data = _momentumJSONData[String(path || '')];"
  );
  lines.push("  return _clone(data);");
  lines.push("}");

  return lines.join("\n");
}
// ----------------------------------------
// AE 脚本端：收集并解析 user/ 下的 IO 数据文件
// ----------------------------------------

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
