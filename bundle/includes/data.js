// 定义 trim 函数，因为 ExtendScript 不支持 String.prototype.trim
function trim(str) {
  return str.replace(/^\s+|\s+$/g, "");
}

pub.loadTable = function (source, options) {
  options = options || {};
  var delimiter = options.delimiter || ",";
  var header = options.header !== undefined ? options.header : true;

  var file = m.item(source);

  // 检查文件是否有效
  if (
    !(file instanceof FootageItem) ||
    !(file.mainSource instanceof FileSource)
  ) {
    error("m.loadTable(), 无效的源文件");
  }

  var fileExtension = file.file.name.split(".").pop().toLowerCase();
  if (
    fileExtension !== "csv" &&
    fileExtension !== "tsv" &&
    fileExtension !== "txt"
  ) {
    error("m.loadTable(), 不支持的文件格式。请使用 CSV, TSV 或 TXT 文件");
  }

  // 如果是 TSV 文件，使用制表符作为分隔符
  if (fileExtension === "tsv") {
    delimiter = "\t";
  }

  var content = readFile(file.file.fsName);
  var lines = content.split(/\r\n|\n|\r/);
  var table = [];
  var headers = [];

  if (header) {
    if (lines.length === 0) {
      error("m.loadTable(), 文件为空，未找到表头");
    }
    headers = lines.shift().split(delimiter);
  }

  for (var i = 0; i < lines.length; i++) {
    var line = trim(lines[i]); // 使用自定义的 trim 函数
    if (line) {
      var row = line.split(delimiter);
      if (header) {
        var rowObject = {};
        for (var j = 0; j < headers.length; j++) {
          rowObject[headers[j]] = row[j];
        }
        table.push(rowObject);
      } else {
        table.push(row);
      }
    }
  }

  // 构建并返回表格对象
  return {
    data: table,
    headers: headers,
    getRowCount: function () {
      return table.length;
    },
    getColumnCount: function () {
      if (header) {
        return headers.length;
      } else {
        return table.length > 0 && table[0].length ? table[0].length : 0;
      }
    },
    getRow: function (index) {
      if (index >= 0 && index < table.length) {
        return table[index];
      } else {
        error("m.loadTable(), 行索引超出范围");
      }
    },
    getColumn: function (nameOrIndex) {
      var result = [];
      if (typeof nameOrIndex === "number") {
        var colName = header ? headers[nameOrIndex] : nameOrIndex;
        for (var i = 0; i < table.length; i++) {
          if (header) {
            result.push(table[i][colName]);
          } else {
            result.push(table[i][nameOrIndex]);
          }
        }
        return result;
      } else if (typeof nameOrIndex === "string") {
        if (!header) {
          error("m.loadTable(), 没有表头，无法通过列名获取列");
        }
        var colIndex = -1;
        for (var k = 0; k < headers.length; k++) {
          if (headers[k] === nameOrIndex) {
            colIndex = k;
            break;
          }
        }
        if (colIndex === -1) {
          error("m.loadTable(), 找不到列名: " + nameOrIndex);
        }
        for (var mIndex = 0; mIndex < table.length; mIndex++) {
          result.push(table[mIndex][nameOrIndex]);
        }
        return result;
      } else {
        error("m.loadTable(), 无效的列名或索引");
      }
    },
    getString: function (row, col) {
      var value = this.get(row, col);
      return value !== undefined ? value.toString() : "";
    },
    getNum: function (row, col) {
      var value = this.get(row, col);
      return value !== undefined ? parseFloat(value) : NaN;
    },
    get: function (row, col) {
      if (typeof col === "string") {
        if (!header) {
          error("m.loadTable(), 没有表头，无法通过列名获取值");
        }
        return table[row][col];
      } else if (typeof col === "number") {
        if (header) {
          var colName = headers[col];
          if (colName === undefined) {
            error("m.loadTable(), 列索引超出范围");
          }
          return table[row][colName];
        } else {
          return table[row][col];
        }
      } else {
        error("m.loadTable(), 无效的列名或索引");
      }
    },
    getObject: function (row) {
      if (row >= 0 && row < table.length) {
        return table[row];
      } else {
        error("m.loadTable(), 行索引超出范围");
      }
    },
    findRow: function (value, column) {
      for (var i = 0; i < table.length; i++) {
        if (this.get(i, column) == value) {
          return this.getObject(i);
        }
      }
      return null;
    },
    findRows: function (value, column) {
      var foundRows = [];
      for (var i = 0; i < table.length; i++) {
        if (this.get(i, column) == value) {
          foundRows.push(this.getObject(i));
        }
      }
      return foundRows;
    },
    getStringColumn: function (column) {
      var col = this.getColumn(column);
      var result = [];
      for (var i = 0; i < col.length; i++) {
        result.push(String(col[i]));
      }
      return result;
    },
    getNumColumn: function (column) {
      var col = this.getColumn(column);
      var result = [];
      for (var i = 0; i < col.length; i++) {
        result.push(parseFloat(col[i]));
      }
      return result;
    },
    removeColumn: function (column) {
      var index;
      if (typeof column === "string") {
        index = headers.indexOf(column);
        if (index === -1) return;
      } else if (typeof column === "number") {
        if (header) {
          if (column >= headers.length) return;
          column = headers[column];
        }
      } else {
        error("m.loadTable(), 无效的列名或索引");
      }

      if (header) {
        index = headers.indexOf(column);
        if (index > -1) {
          headers.splice(index, 1);
        }
      }

      for (var i = 0; i < table.length; i++) {
        delete table[i][column];
      }
    },
    addColumn: function (title, data) {
      if (header) {
        headers.push(title);
      }
      for (var i = 0; i < table.length; i++) {
        table[i][title] = data[i];
      }
    },
  };
};

// 读取文件内容
function readFile(filePath) {
  var file = new File(filePath);
  file.encoding = "UTF-8";
  if (!file.exists) {
    error("m.loadTable(), 文件不存在: " + filePath);
  }
  var opened = file.open("r");
  if (!opened) {
    error("m.loadTable(), 无法打开文件: " + filePath);
  }
  var content = file.read();
  file.close();
  return content;
}
