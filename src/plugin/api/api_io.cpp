#include "api_internal.h"

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

namespace momentum {

namespace {

struct TableParseOptions {
  bool header = false;
  char delimiter = ',';
};

std::string NormalizeIoSource(const std::string& value) {
  std::string source = value;
  std::replace(source.begin(), source.end(), '\\', '/');
  return source;
}

std::string ResolveIoPath(const std::string& source) {
  const std::filesystem::path sourcePath(source);
  if (sourcePath.is_absolute()) {
    return sourcePath.lexically_normal().string();
  }

  const std::string runtimeDirectory = runtime_internal::GetRuntimeDirectoryPath();
  if (runtimeDirectory.empty()) {
    return sourcePath.lexically_normal().string();
  }

  const std::filesystem::path runtimePath(runtimeDirectory);
  const std::vector<std::filesystem::path> candidates = {
    runtimePath / sourcePath,
    runtimePath / "user" / sourcePath,
  };
  for (const auto& candidate : candidates) {
    const std::string resolved = candidate.lexically_normal().string();
    if (runtime_internal::FileExists(resolved)) {
      return resolved;
    }
  }
  return candidates.front().lexically_normal().string();
}

JSValueRef MakeJsString(JSContextRef ctx, const std::string& value) {
  JSStringRef stringValue = JSStringCreateWithUTF8CString(value.c_str());
  JSValueRef result = JSValueMakeString(ctx, stringValue);
  JSStringRelease(stringValue);
  return result;
}

void SetJsProperty(JSContextRef ctx, JSObjectRef object, const char* name, JSValueRef value) {
  if (!ctx || !object || !name || !value) {
    return;
  }
  JSStringRef key = JSStringCreateWithUTF8CString(name);
  JSObjectSetProperty(ctx, object, key, value, kJSPropertyAttributeNone, NULL);
  JSStringRelease(key);
}

JSValueRef GetJsProperty(JSContextRef ctx, JSObjectRef object, const char* name) {
  if (!ctx || !object || !name) {
    return NULL;
  }
  JSStringRef key = JSStringCreateWithUTF8CString(name);
  JSValueRef value = JSObjectGetProperty(ctx, object, key, NULL);
  JSStringRelease(key);
  return value;
}

JSObjectRef MakeStringArray(JSContextRef ctx, const std::vector<std::string>& values) {
  JSObjectRef array = JSObjectMakeArray(ctx, 0, NULL, NULL);
  for (std::size_t index = 0; index < values.size(); index += 1) {
    JSObjectSetPropertyAtIndex(
      ctx,
      array,
      static_cast<unsigned>(index),
      MakeJsString(ctx, values[index]),
      NULL
    );
  }
  return array;
}

JSObjectRef MakeByteArray(JSContextRef ctx, const std::vector<unsigned char>& values) {
  JSObjectRef array = JSObjectMakeArray(ctx, 0, NULL, NULL);
  for (std::size_t index = 0; index < values.size(); index += 1) {
    JSObjectSetPropertyAtIndex(
      ctx,
      array,
      static_cast<unsigned>(index),
      JSValueMakeNumber(ctx, static_cast<double>(values[index])),
      NULL
    );
  }
  return array;
}

std::optional<std::vector<unsigned char>> ReadBinaryFile(const std::string& path) {
  if (path.empty()) {
    return std::nullopt;
  }

  std::ifstream stream(path.c_str(), std::ios::in | std::ios::binary);
  if (!stream.is_open()) {
    return std::nullopt;
  }
  stream.seekg(0, std::ios::end);
  const std::streamoff endPos = stream.tellg();
  if (endPos < 0) {
    return std::nullopt;
  }
  stream.seekg(0, std::ios::beg);

  std::vector<unsigned char> bytes(static_cast<std::size_t>(endPos));
  if (!bytes.empty()) {
    stream.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
  }
  return bytes;
}

std::vector<std::string> SplitLines(const std::string& text) {
  std::vector<std::string> lines;
  std::string current;
  for (std::size_t index = 0; index < text.size(); index += 1) {
    const char ch = text[index];
    if (ch == '\r') {
      if ((index + 1) < text.size() && text[index + 1] == '\n') {
        index += 1;
      }
      lines.push_back(current);
      current.clear();
      continue;
    }
    if (ch == '\n') {
      lines.push_back(current);
      current.clear();
      continue;
    }
    current.push_back(ch);
  }
  if (!current.empty() || text.empty() || (text.back() != '\n' && text.back() != '\r')) {
    lines.push_back(current);
  }
  return lines;
}

std::vector<std::vector<std::string>> ParseDelimitedText(const std::string& text, char delimiter) {
  std::vector<std::vector<std::string>> rows;
  std::vector<std::string> row;
  std::string field;
  bool inQuotes = false;

  const auto flushField = [&]() {
    row.push_back(field);
    field.clear();
  };
  const auto flushRow = [&]() {
    flushField();
    rows.push_back(row);
    row.clear();
  };

  for (std::size_t index = 0; index < text.size(); index += 1) {
    const char ch = text[index];
    if (inQuotes) {
      if (ch == '"') {
        if ((index + 1) < text.size() && text[index + 1] == '"') {
          field.push_back('"');
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field.push_back(ch);
      }
      continue;
    }

    if (ch == '"') {
      inQuotes = true;
      continue;
    }
    if (ch == delimiter) {
      flushField();
      continue;
    }
    if (ch == '\r') {
      if ((index + 1) < text.size() && text[index + 1] == '\n') {
        index += 1;
      }
      flushRow();
      continue;
    }
    if (ch == '\n') {
      flushRow();
      continue;
    }
    field.push_back(ch);
  }

  if (!field.empty() || !row.empty() || text.empty() || (text.back() != '\n' && text.back() != '\r')) {
    flushRow();
  }

  while (!rows.empty() && rows.back().size() == 1 && rows.back().front().empty()) {
    rows.pop_back();
  }
  return rows;
}

TableParseOptions ParseTableOptions(JSContextRef ctx, JSValueRef value) {
  TableParseOptions options;
  if (!ctx || !value || !JSValueIsObject(ctx, value)) {
    return options;
  }
  JSObjectRef object = JSValueToObject(ctx, value, NULL);
  if (!object) {
    return options;
  }

  const JSValueRef headerValue = GetJsProperty(ctx, object, "header");
  if (headerValue) {
    options.header = JSValueToBoolean(ctx, headerValue);
  }

  std::string delimiter = JsValueToStdString(ctx, GetJsProperty(ctx, object, "delimiter"));
  if (!delimiter.empty()) {
    options.delimiter = delimiter[0];
  }

  const std::string format = JsValueToStdString(ctx, GetJsProperty(ctx, object, "format"));
  if (format == "tsv") {
    options.delimiter = '\t';
  } else if (format == "csv") {
    options.delimiter = ',';
  }

  return options;
}

JSObjectRef MakeLoadDescriptor(JSContextRef ctx, const std::string& source, const std::string& path) {
  JSObjectRef object = JSObjectMake(ctx, NULL, NULL);
  SetJsProperty(ctx, object, "source", MakeJsString(ctx, source));
  SetJsProperty(ctx, object, "path", MakeJsString(ctx, path));
  return object;
}

void PopulateLoadResult(JSContextRef ctx, JSObjectRef object, bool loaded, const std::string& loadError) {
  SetJsProperty(ctx, object, "loaded", JSValueMakeBoolean(ctx, loaded));
  SetJsProperty(ctx, object, "loadError", MakeJsString(ctx, loadError));
}

JSObjectRef MakeTableDescriptor(
  JSContextRef ctx,
  const std::string& source,
  const std::string& path,
  bool loaded,
  const std::string& loadError,
  const std::vector<std::string>& columns,
  const std::vector<std::vector<std::string>>& rows,
  const TableParseOptions& options
) {
  JSObjectRef object = JSObjectMake(ctx, NULL, NULL);
  SetJsProperty(ctx, object, "source", MakeJsString(ctx, source));
  SetJsProperty(ctx, object, "path", MakeJsString(ctx, path));
  SetJsProperty(ctx, object, "loaded", JSValueMakeBoolean(ctx, loaded));
  SetJsProperty(ctx, object, "loadError", MakeJsString(ctx, loadError));
  SetJsProperty(ctx, object, "columns", MakeStringArray(ctx, columns));

  JSObjectRef rowArray = JSObjectMakeArray(ctx, 0, NULL, NULL);
  for (std::size_t rowIndex = 0; rowIndex < rows.size(); rowIndex += 1) {
    JSObjectRef cellArray = MakeStringArray(ctx, rows[rowIndex]);
    JSObjectSetPropertyAtIndex(ctx, rowArray, static_cast<unsigned>(rowIndex), cellArray, NULL);
  }
  SetJsProperty(ctx, object, "rows", rowArray);
  SetJsProperty(ctx, object, "header", JSValueMakeBoolean(ctx, options.header));
  SetJsProperty(ctx, object, "delimiter", MakeJsString(ctx, std::string(1, options.delimiter)));
  return object;
}

constexpr char kBootstrapIoScript[] = R"MOMENTUM_BOOT(
function __momentumNormalizeIoSource(source) {
  return String(source == null ? "" : source).replace(/\\/g, "/");
}

function __momentumIoError(descriptor, fallbackMessage) {
  var message =
    descriptor && descriptor.loadError
      ? descriptor.loadError
      : fallbackMessage;
  return new Error(message);
}

function __momentumAttachIoMetadata(value, descriptor) {
  if (!value || typeof value !== "object" || !descriptor) {
    return value;
  }
  value._momentumPath = String(descriptor.source || "");
  value._momentumResolvedUrl = String(descriptor.path || "");
  value._momentumFullPath = String(descriptor.path || "");
  return value;
}

var __momentumJSONCache = {};
var __momentumStringsCache = {};
var __momentumBytesCache = {};
var __momentumTableCache = {};
var __momentumXMLCache = {};

function __momentumNormalizeTableDescriptor(descriptor) {
  descriptor = descriptor || {};
  var normalized = {
    source: String(descriptor.source || ""),
    path: String(descriptor.path || ""),
    loaded: !!descriptor.loaded,
    loadError: String(descriptor.loadError || ""),
    columns: Array.isArray(descriptor.columns) ? descriptor.columns.slice() : [],
    rows: [],
    header: !!descriptor.header,
    delimiter: String(descriptor.delimiter || ","),
  };
  if (Array.isArray(descriptor.rows)) {
    for (var i = 0; i < descriptor.rows.length; i += 1) {
      normalized.rows.push(
        Array.isArray(descriptor.rows[i]) ? descriptor.rows[i].slice() : [],
      );
    }
  }
  return normalized;
}

function __momentumSyncTableRowObject(rowValue) {
  rowValue.obj = {};
  for (var i = 0; i < rowValue._columns.length; i += 1) {
    rowValue.obj[rowValue._columns[i]] =
      i < rowValue.arr.length ? rowValue.arr[i] : "";
  }
}

function __momentumResolveTableColumnIndex(columns, column) {
  if (typeof column === "number" && isFinite(column)) {
    return Math.max(0, Math.floor(column));
  }
  var name = String(column == null ? "" : column);
  for (var i = 0; i < columns.length; i += 1) {
    if (String(columns[i]) === name) {
      return i;
    }
  }
  return -1;
}

p5.TableRow = function(values, columns) {
  this.__momentumType = "TableRow";
  this.arr = Array.isArray(values) ? values.slice() : [];
  this._columns = Array.isArray(columns) ? columns.slice() : [];
  this.obj = {};
  __momentumSyncTableRowObject(this);
};

p5.TableRow.prototype.get = function(column) {
  return this.getString(column);
};
p5.TableRow.prototype.getString = function(column) {
  var index = __momentumResolveTableColumnIndex(this._columns, column);
  if (index < 0 || index >= this.arr.length) return "";
  return String(this.arr[index]);
};
p5.TableRow.prototype.getNum = function(column) {
  var numeric = parseFloat(this.getString(column));
  return isNaN(numeric) ? 0 : numeric;
};
p5.TableRow.prototype.set = function(column, value) {
  var index = __momentumResolveTableColumnIndex(this._columns, column);
  if (index < 0) return;
  while (this.arr.length <= index) {
    this.arr.push("");
  }
  this.arr[index] = String(value == null ? "" : value);
  __momentumSyncTableRowObject(this);
};
p5.TableRow.prototype.setString = function(column, value) { this.set(column, value); };
p5.TableRow.prototype.setNum = function(column, value) { this.set(column, Number(value) || 0); };

p5.Table = function(tableData) {
  this.__momentumType = "Table";
  this._tableData = __momentumNormalizeTableDescriptor(tableData);
  this.columns = this._tableData.columns.slice();
  this.rows = [];
  for (var i = 0; i < this._tableData.rows.length; i += 1) {
    this.rows.push(new p5.TableRow(this._tableData.rows[i], this.columns));
  }
  __momentumAttachIoMetadata(this, this._tableData);
};

p5.Table.prototype.getRowCount = function() { return this.rows.length; };
p5.Table.prototype.getColumnCount = function() { return this.columns.length; };
p5.Table.prototype.getRow = function(index) {
  index = Math.floor(Number(index) || 0);
  return index >= 0 && index < this.rows.length ? this.rows[index] : null;
};
p5.Table.prototype.getRows = function() { return this.rows.slice(); };
p5.Table.prototype.getColumn = function(column) {
  var index = __momentumResolveTableColumnIndex(this.columns, column);
  if (index < 0) return [];
  return this.rows.map(function(row) { return row.getString(index); });
};
p5.Table.prototype.getColumnTitle = function(index) {
  index = Math.floor(Number(index) || 0);
  return index >= 0 && index < this.columns.length ? this.columns[index] : "";
};
p5.Table.prototype.getString = function(row, column) {
  var rowValue = this.getRow(row);
  return rowValue ? rowValue.getString(column) : "";
};
p5.Table.prototype.getNum = function(row, column) {
  var rowValue = this.getRow(row);
  return rowValue ? rowValue.getNum(column) : 0;
};
p5.Table.prototype.findRow = function(value, column) {
  var target = String(value == null ? "" : value);
  for (var i = 0; i < this.rows.length; i += 1) {
    if (this.rows[i].getString(column) === target) {
      return this.rows[i];
    }
  }
  return null;
};
p5.Table.prototype.findRows = function(value, column) {
  var target = String(value == null ? "" : value);
  return this.rows.filter(function(row) { return row.getString(column) === target; });
};
p5.Table.prototype.matchRow = function(regexp, column) {
  var rows = this.matchRows(regexp, column);
  return rows.length ? rows[0] : null;
};
p5.Table.prototype.matchRows = function(regexp, column) {
  var rx = regexp instanceof RegExp ? regexp : new RegExp(regexp);
  return this.rows.filter(function(row) { return rx.test(row.getString(column)); });
};

function __momentumCreateTable(tableData) {
  return new p5.Table(tableData);
}

function __momentumCreateTableRow(rowData) {
  rowData = rowData || {};
  return new p5.TableRow(
    Array.isArray(rowData.arr) ? rowData.arr.slice() : [],
    Array.isArray(rowData._columns) ? rowData._columns.slice() : [],
  );
}

function __momentumCreateBytes(descriptor) {
  descriptor = descriptor || {};
  return __momentumAttachIoMetadata({
    __momentumType: "Bytes",
    bytes: Array.isArray(descriptor.bytes) ? descriptor.bytes.slice() : [],
    source: String(descriptor.source || ""),
    path: String(descriptor.path || ""),
    loaded: !!descriptor.loaded,
    loadError: String(descriptor.loadError || ""),
  }, descriptor);
}

function __momentumNormalizeXMLDescriptor(descriptor) {
  descriptor = descriptor || {};
  var children = [];
  if (Array.isArray(descriptor.children)) {
    for (var i = 0; i < descriptor.children.length; i += 1) {
      children.push(__momentumNormalizeXMLDescriptor(descriptor.children[i]));
    }
  }
  return {
    source: String(descriptor.source || ""),
    path: String(descriptor.path || ""),
    loaded: !!descriptor.loaded,
    loadError: String(descriptor.loadError || ""),
    name: String(descriptor.name || ""),
    content: String(descriptor.content || ""),
    attributes: descriptor.attributes && typeof descriptor.attributes === "object"
      ? Object.assign({}, descriptor.attributes)
      : {},
    children: children,
  };
}

function __momentumEncodeXML(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function __momentumDecodeXML(value) {
  return String(value == null ? "" : value)
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function __momentumTrimXML(value) {
  return String(value == null ? "" : value).trim();
}

function __momentumParseXMLString(sourceText) {
  var text = String(sourceText == null ? "" : sourceText);
  var cursor = 0;

  function skipWhitespace() {
    while (cursor < text.length && /\s/.test(text.charAt(cursor))) {
      cursor += 1;
    }
  }

  function skipComment() {
    if (text.slice(cursor, cursor + 4) !== "<!--") return false;
    var end = text.indexOf("-->", cursor + 4);
    cursor = end >= 0 ? end + 3 : text.length;
    return true;
  }

  function skipDeclaration() {
    if (text.slice(cursor, cursor + 2) !== "<?") return false;
    var end = text.indexOf("?>", cursor + 2);
    cursor = end >= 0 ? end + 2 : text.length;
    return true;
  }

  function skipDoctype() {
    if (text.slice(cursor, cursor + 9) !== "<!DOCTYPE") return false;
    var depth = 0;
    while (cursor < text.length) {
      var ch = text.charAt(cursor);
      if (ch === "[") depth += 1;
      if (ch === "]" && depth > 0) depth -= 1;
      if (ch === ">" && depth === 0) {
        cursor += 1;
        return true;
      }
      cursor += 1;
    }
    return true;
  }

  function parseName() {
    var start = cursor;
    while (cursor < text.length && /[A-Za-z0-9_.:-]/.test(text.charAt(cursor))) {
      cursor += 1;
    }
    return cursor > start ? text.slice(start, cursor) : "";
  }

  function parseQuotedValue() {
    var quote = text.charAt(cursor);
    if (quote !== '"' && quote !== "'") return null;
    cursor += 1;
    var start = cursor;
    while (cursor < text.length && text.charAt(cursor) !== quote) {
      cursor += 1;
    }
    var raw = text.slice(start, cursor);
    if (cursor < text.length) cursor += 1;
    return __momentumDecodeXML(raw);
  }

  function parseAttributes(target) {
    while (cursor < text.length) {
      skipWhitespace();
      if (text.slice(cursor, cursor + 2) === "/>") {
        cursor += 2;
        return "self";
      }
      if (text.charAt(cursor) === ">") {
        cursor += 1;
        return "open";
      }
      var name = parseName();
      if (!name) return "error";
      skipWhitespace();
      var value = "";
      if (text.charAt(cursor) === "=") {
        cursor += 1;
        skipWhitespace();
        value = parseQuotedValue();
        if (value == null) return "error";
      }
      target.attributes[name] = value;
    }
    return "error";
  }

  function parseNode() {
    skipWhitespace();
    while (skipComment() || skipDeclaration() || skipDoctype()) {
      skipWhitespace();
    }
    if (text.charAt(cursor) !== "<" || text.slice(cursor, cursor + 2) === "</") {
      return null;
    }
    cursor += 1;
    var name = parseName();
    if (!name) return null;
    var node = {
      __momentumType: "XML",
      name: name,
      content: "",
      attributes: {},
      children: [],
    };
    var attrState = parseAttributes(node);
    if (attrState === "self") {
      return node;
    }
    if (attrState !== "open") {
      return null;
    }

    var textContent = "";
    while (cursor < text.length) {
      if (skipComment() || skipDeclaration()) {
        continue;
      }
      if (text.slice(cursor, cursor + 9) === "<![CDATA[") {
        var cdataEnd = text.indexOf("]]>", cursor + 9);
        if (cdataEnd < 0) {
          textContent += text.slice(cursor + 9);
          cursor = text.length;
          break;
        }
        textContent += text.slice(cursor + 9, cdataEnd);
        cursor = cdataEnd + 3;
        continue;
      }
      if (text.slice(cursor, cursor + 2) === "</") {
        cursor += 2;
        var closingName = parseName();
        skipWhitespace();
        if (text.charAt(cursor) === ">") cursor += 1;
        if (closingName !== name) return null;
        node.content = __momentumTrimXML(__momentumDecodeXML(textContent));
        return node;
      }
      if (text.charAt(cursor) === "<") {
        var child = parseNode();
        if (!child) return null;
        node.children.push(child);
        continue;
      }
      textContent += text.charAt(cursor);
      cursor += 1;
    }
    return null;
  }

  var root = parseNode();
  skipWhitespace();
  return root;
}

function __momentumSerializeXMLNode(node) {
  if (!node) return "";
  var attrs = "";
  var names = Object.keys(node.attributes || {});
  for (var i = 0; i < names.length; i += 1) {
    attrs +=
      " " +
      names[i] +
      "=\"" +
      __momentumEncodeXML(node.attributes[names[i]]) +
      "\"";
  }
  var children = "";
  var childList = Array.isArray(node.children) ? node.children : [];
  for (var j = 0; j < childList.length; j += 1) {
    children += __momentumSerializeXMLNode(childList[j]);
  }
  var content = node.content ? __momentumEncodeXML(node.content) : "";
  if (!children && !content) {
    return "<" + node.name + attrs + "/>";
  }
  return "<" + node.name + attrs + ">" + content + children + "</" + node.name + ">";
}

p5.XML = function(xmlData, parent) {
  this.__momentumType = "XML";
  this._xmlData = __momentumNormalizeXMLDescriptor(xmlData);
  this._parent = parent || null;
  this._children = [];
  for (var i = 0; i < this._xmlData.children.length; i += 1) {
    this._children.push(new p5.XML(this._xmlData.children[i], this));
  }
  __momentumAttachIoMetadata(this, this._xmlData);
};

p5.XML.prototype.getParent = function() { return this._parent; };
p5.XML.prototype.getName = function() { return this._xmlData.name; };
p5.XML.prototype.setName = function(value) { this._xmlData.name = String(value == null ? "" : value); };
p5.XML.prototype.hasChildren = function() { return this._children.length > 0; };
p5.XML.prototype.listChildren = function() {
  return this._children.map(function(child) { return child.getName(); });
};
p5.XML.prototype.getChildren = function(name) {
  if (name === undefined) return this._children.slice();
  var target = String(name);
  return this._children.filter(function(child) { return child.getName() === target; });
};
p5.XML.prototype.getChild = function(param) {
  if (typeof param === "number") {
    var index = Math.floor(param);
    return index >= 0 && index < this._children.length ? this._children[index] : null;
  }
  var matches = this.getChildren(param);
  return matches.length ? matches[0] : null;
};
p5.XML.prototype.getContent = function() { return this._xmlData.content || ""; };
p5.XML.prototype.setContent = function(value) { this._xmlData.content = String(value == null ? "" : value); };
p5.XML.prototype.listAttributes = function() { return Object.keys(this._xmlData.attributes || {}); };
p5.XML.prototype.hasAttribute = function(name) {
  return Object.prototype.hasOwnProperty.call(this._xmlData.attributes || {}, String(name));
};
p5.XML.prototype.getAttributeCount = function() { return this.listAttributes().length; };
p5.XML.prototype.getString = function(name, defaultValue) {
  name = String(name);
  if (this.hasAttribute(name)) return String(this._xmlData.attributes[name]);
  return defaultValue === undefined ? null : String(defaultValue);
};
p5.XML.prototype.getNum = function(name, defaultValue) {
  var numeric = parseFloat(this.getString(name, defaultValue === undefined ? "NaN" : defaultValue));
  return isNaN(numeric) ? (defaultValue === undefined ? null : Number(defaultValue) || 0) : numeric;
};
p5.XML.prototype.setAttribute = function(name, value) {
  this._xmlData.attributes[String(name)] = String(value == null ? "" : value);
};
p5.XML.prototype.removeAttribute = function(name) {
  delete this._xmlData.attributes[String(name)];
};
p5.XML.prototype.serialize = function() {
  var node = {
    name: this._xmlData.name,
    content: this._xmlData.content,
    attributes: Object.assign({}, this._xmlData.attributes || {}),
    children: this._children.map(function(child) {
      return child._xmlData;
    }),
  };
  return __momentumSerializeXMLNode(node);
};

function __momentumCreateXML(descriptor) {
  return new p5.XML(descriptor, null);
}

function __momentumSnapshotXMLNode(value) {
  if (!value || value.__momentumType !== "XML") {
    return __momentumNormalizeXMLDescriptor(value);
  }
  var descriptor = __momentumNormalizeXMLDescriptor(value._xmlData || value);
  descriptor.children = Array.isArray(value._children)
    ? value._children.map(function(child) {
        return __momentumSnapshotXMLNode(child);
      })
    : [];
  return descriptor;
}

loadXML = function(path, successCallback, failureCallback) {
  var normalizedSource = __momentumNormalizeIoSource(path);
  if (!normalizedSource) {
    if (typeof failureCallback === "function") {
      failureCallback(new Error("XML source is empty"));
    }
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(__momentumXMLCache, normalizedSource)) {
    var cached = __momentumXMLCache[normalizedSource];
    if (typeof successCallback === "function") successCallback(cached);
    return cached;
  }
  var descriptor = __momentumNativeLoadXML(normalizedSource) || {};
  if (!descriptor.loaded) {
    if (typeof failureCallback === "function") {
      failureCallback(__momentumIoError(descriptor, "Failed to load XML"));
    }
    return null;
  }
  var parsed = __momentumParseXMLString(descriptor.xmlText || "");
  if (!parsed) {
    descriptor.loaded = false;
    descriptor.loadError = "Failed to parse XML file";
    if (typeof failureCallback === "function") {
      failureCallback(__momentumIoError(descriptor, "Failed to parse XML"));
    }
    return null;
  }
  parsed.source = String(descriptor.source || "");
  parsed.path = String(descriptor.path || "");
  parsed.loaded = true;
  parsed.loadError = "";
  var value = __momentumCreateXML(parsed);
  __momentumXMLCache[normalizedSource] = value;
  if (typeof successCallback === "function") successCallback(value);
  return value;
};

loadJSON = function(path, successCallback, failureCallback) {
  var normalizedSource = __momentumNormalizeIoSource(path);
  if (!normalizedSource) {
    if (typeof failureCallback === "function") {
      failureCallback(new Error("JSON source is empty"));
    }
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(__momentumJSONCache, normalizedSource)) {
    var cached = __momentumJSONCache[normalizedSource];
    if (typeof successCallback === "function") successCallback(cached);
    return cached;
  }
  var descriptor = __momentumNativeLoadJSON(normalizedSource) || {};
  if (descriptor.loaded) {
    var value = __momentumAttachIoMetadata(descriptor.data, descriptor);
    __momentumJSONCache[normalizedSource] = value;
    if (typeof successCallback === "function") successCallback(value);
    return value;
  }
  if (typeof failureCallback === "function") {
    failureCallback(__momentumIoError(descriptor, "Failed to load JSON"));
  }
  return null;
};

loadStrings = function(path, successCallback, failureCallback) {
  var normalizedSource = __momentumNormalizeIoSource(path);
  if (!normalizedSource) {
    if (typeof failureCallback === "function") {
      failureCallback(new Error("Strings source is empty"));
    }
    return [];
  }
  if (Object.prototype.hasOwnProperty.call(__momentumStringsCache, normalizedSource)) {
    var cached = __momentumStringsCache[normalizedSource];
    if (typeof successCallback === "function") successCallback(cached);
    return cached;
  }
  var descriptor = __momentumNativeLoadStrings(normalizedSource) || {};
  if (descriptor.loaded) {
    var lines = Array.isArray(descriptor.lines) ? descriptor.lines.slice() : [];
    __momentumAttachIoMetadata(lines, descriptor);
    __momentumStringsCache[normalizedSource] = lines;
    if (typeof successCallback === "function") successCallback(lines);
    return lines;
  }
  if (typeof failureCallback === "function") {
    failureCallback(__momentumIoError(descriptor, "Failed to load strings"));
  }
  return [];
};

loadBytes = function(path, successCallback, failureCallback) {
  var normalizedSource = __momentumNormalizeIoSource(path);
  if (!normalizedSource) {
    var emptyBytes = __momentumCreateBytes({
      source: "",
      path: "",
      loaded: false,
      loadError: "Bytes source is empty",
      bytes: [],
    });
    if (typeof failureCallback === "function") {
      failureCallback(__momentumIoError(emptyBytes, "Failed to load bytes"));
    }
    return emptyBytes;
  }
  if (Object.prototype.hasOwnProperty.call(__momentumBytesCache, normalizedSource)) {
    var cached = __momentumBytesCache[normalizedSource];
    if (typeof successCallback === "function") successCallback(cached);
    return cached;
  }
  var descriptor = __momentumNativeLoadBytes(normalizedSource) || {};
  var value = __momentumCreateBytes(descriptor);
  if (descriptor.loaded) {
    __momentumBytesCache[normalizedSource] = value;
    if (typeof successCallback === "function") successCallback(value);
  } else if (typeof failureCallback === "function") {
    failureCallback(__momentumIoError(descriptor, "Failed to load bytes"));
  }
  return value;
};

loadTable = function(path) {
  var normalizedSource = __momentumNormalizeIoSource(path);
  var successCallback = null;
  var failureCallback = null;
  var options = { header: false, format: "csv", delimiter: "," };
  for (var i = 1; i < arguments.length; i += 1) {
    var arg = arguments[i];
    if (typeof arg === "function") {
      if (!successCallback) successCallback = arg;
      else failureCallback = arg;
      continue;
    }
    if (typeof arg !== "string") continue;
    var token = arg.toLowerCase();
    if (token === "header") {
      options.header = true;
    } else if (token === "tsv") {
      options.format = "tsv";
      options.delimiter = "\t";
    } else if (token === "csv") {
      options.format = "csv";
      options.delimiter = ",";
    }
  }
  if (!normalizedSource) {
    var emptyTable = __momentumCreateTable({
      source: "",
      path: "",
      loaded: false,
      loadError: "Table source is empty",
      columns: [],
      rows: [],
      header: options.header,
      delimiter: options.delimiter,
    });
    if (typeof failureCallback === "function") {
      failureCallback(__momentumIoError(emptyTable._tableData, "Failed to load table"));
    }
    return emptyTable;
  }
  var cacheKey = normalizedSource + "|" + options.format + "|" + (options.header ? "header" : "body");
  if (Object.prototype.hasOwnProperty.call(__momentumTableCache, cacheKey)) {
    var cached = __momentumTableCache[cacheKey];
    if (typeof successCallback === "function") successCallback(cached);
    return cached;
  }
  var descriptor = __momentumNativeLoadTable(normalizedSource, options) || {};
  var table = __momentumCreateTable(descriptor);
  if (descriptor.loaded) {
    __momentumTableCache[cacheKey] = table;
    if (typeof successCallback === "function") successCallback(table);
  } else if (typeof failureCallback === "function") {
    failureCallback(__momentumIoError(descriptor, "Failed to load table"));
  }
  return table;
};

function __momentumReviveIoValue(value) {
  if (value == null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    for (var i = 0; i < value.length; i += 1) {
      value[i] = __momentumReviveIoValue(value[i]);
    }
    return value;
  }
  if (value.__momentumType === "Table") {
    return __momentumCreateTable(value._tableData || value);
  }
  if (value.__momentumType === "TableRow") {
    return __momentumCreateTableRow(value);
  }
  if (value.__momentumType === "Bytes") {
    return __momentumCreateBytes(value);
  }
  if (value.__momentumType === "XML") {
    return __momentumCreateXML(value._xmlData || value);
  }
  Object.keys(value).forEach(function(key) {
    value[key] = __momentumReviveIoValue(value[key]);
  });
  return value;
}

var __momentumBaseSanitize = __momentumSanitize;
__momentumSanitize = function(value) {
  if (value && value.__momentumType === "Table") {
    return {
      __momentumType: "Table",
      _tableData: __momentumNormalizeTableDescriptor(value._tableData || value),
    };
  }
  if (value && value.__momentumType === "TableRow") {
    return {
      __momentumType: "TableRow",
      arr: Array.isArray(value.arr) ? value.arr.slice() : [],
      _columns: Array.isArray(value._columns) ? value._columns.slice() : [],
    };
  }
  if (value && value.__momentumType === "Bytes") {
    return {
      __momentumType: "Bytes",
      bytes: Array.isArray(value.bytes) ? value.bytes.slice() : [],
      source: String(value.source || ""),
      path: String(value.path || ""),
      loaded: !!value.loaded,
      loadError: String(value.loadError || ""),
    };
  }
  if (value && value.__momentumType === "XML") {
    return {
      __momentumType: "XML",
      _xmlData: __momentumSnapshotXMLNode(value),
    };
  }
  return __momentumBaseSanitize(value);
};

var __momentumBaseReviveValue = __momentumReviveValue;
__momentumReviveValue = function(value) {
  var revived = __momentumReviveIoValue(value);
  return __momentumBaseReviveValue(revived);
};

__momentumRegisterBinding("__momentumIOState", function() {
  return {
    jsonCache: __momentumJSONCache,
    stringsCache: __momentumStringsCache,
    bytesCache: __momentumBytesCache,
    tableCache: __momentumTableCache,
    xmlCache: __momentumXMLCache,
  };
}, function(state) {
  state = state || {};
  __momentumJSONCache = __momentumReviveIoValue(state.jsonCache || {});
  __momentumStringsCache = __momentumReviveIoValue(state.stringsCache || {});
  __momentumBytesCache = __momentumReviveIoValue(state.bytesCache || {});
  __momentumTableCache = __momentumReviveIoValue(state.tableCache || {});
  __momentumXMLCache = __momentumReviveIoValue(state.xmlCache || {});
});
)MOMENTUM_BOOT";

}  // namespace

JSValueRef JsMomentumNativeLoadJSON(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  const std::string source =
    argumentCount > 0 ? NormalizeIoSource(JsValueToStdString(ctx, arguments[0])) : "";
  const std::string path = ResolveIoPath(source);
  JSObjectRef descriptor = MakeLoadDescriptor(ctx, source, path);

  const auto text = runtime_internal::ReadTextFile(path);
  if (!text.has_value()) {
    PopulateLoadResult(ctx, descriptor, false, "Failed to read JSON file");
    SetJsProperty(ctx, descriptor, "data", JSValueMakeNull(ctx));
    return descriptor;
  }

  JSStringRef jsonString = JSStringCreateWithUTF8CString(text->c_str());
  JSValueRef jsonValue = JSValueMakeFromJSONString(ctx, jsonString);
  JSStringRelease(jsonString);
  if (!jsonValue) {
    PopulateLoadResult(ctx, descriptor, false, "Failed to parse JSON file");
    SetJsProperty(ctx, descriptor, "data", JSValueMakeNull(ctx));
    return descriptor;
  }

  PopulateLoadResult(ctx, descriptor, true, "");
  SetJsProperty(ctx, descriptor, "data", jsonValue);
  return descriptor;
}

JSValueRef JsMomentumNativeLoadStrings(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  const std::string source =
    argumentCount > 0 ? NormalizeIoSource(JsValueToStdString(ctx, arguments[0])) : "";
  const std::string path = ResolveIoPath(source);
  JSObjectRef descriptor = MakeLoadDescriptor(ctx, source, path);

  const auto text = runtime_internal::ReadTextFile(path);
  if (!text.has_value()) {
    PopulateLoadResult(ctx, descriptor, false, "Failed to read strings file");
    SetJsProperty(ctx, descriptor, "lines", JSObjectMakeArray(ctx, 0, NULL, NULL));
    return descriptor;
  }

  PopulateLoadResult(ctx, descriptor, true, "");
  SetJsProperty(ctx, descriptor, "lines", MakeStringArray(ctx, SplitLines(*text)));
  return descriptor;
}

JSValueRef JsMomentumNativeLoadBytes(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  const std::string source =
    argumentCount > 0 ? NormalizeIoSource(JsValueToStdString(ctx, arguments[0])) : "";
  const std::string path = ResolveIoPath(source);
  JSObjectRef descriptor = MakeLoadDescriptor(ctx, source, path);

  const auto bytes = ReadBinaryFile(path);
  if (!bytes.has_value()) {
    PopulateLoadResult(ctx, descriptor, false, "Failed to read bytes file");
    SetJsProperty(ctx, descriptor, "bytes", JSObjectMakeArray(ctx, 0, NULL, NULL));
    return descriptor;
  }

  PopulateLoadResult(ctx, descriptor, true, "");
  SetJsProperty(ctx, descriptor, "bytes", MakeByteArray(ctx, *bytes));
  return descriptor;
}

JSValueRef JsMomentumNativeLoadTable(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  const std::string source =
    argumentCount > 0 ? NormalizeIoSource(JsValueToStdString(ctx, arguments[0])) : "";
  const std::string path = ResolveIoPath(source);
  const TableParseOptions options =
    argumentCount > 1 ? ParseTableOptions(ctx, arguments[1]) : TableParseOptions();

  const auto text = runtime_internal::ReadTextFile(path);
  if (!text.has_value()) {
    return MakeTableDescriptor(
      ctx,
      source,
      path,
      false,
      "Failed to read table file",
      std::vector<std::string>(),
      std::vector<std::vector<std::string>>(),
      options
    );
  }

  std::vector<std::vector<std::string>> parsedRows = ParseDelimitedText(*text, options.delimiter);
  std::vector<std::string> columns;
  if (options.header && !parsedRows.empty()) {
    columns = parsedRows.front();
    parsedRows.erase(parsedRows.begin());
  } else {
    std::size_t maxColumns = 0;
    for (const auto& row : parsedRows) {
      maxColumns = std::max(maxColumns, row.size());
    }
    columns.reserve(maxColumns);
    for (std::size_t index = 0; index < maxColumns; index += 1) {
      columns.push_back(std::to_string(index));
    }
  }

  return MakeTableDescriptor(ctx, source, path, true, "", columns, parsedRows, options);
}

JSValueRef JsMomentumNativeLoadXML(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  const std::string source =
    argumentCount > 0 ? NormalizeIoSource(JsValueToStdString(ctx, arguments[0])) : "";
  const std::string path = ResolveIoPath(source);
  JSObjectRef descriptor = MakeLoadDescriptor(ctx, source, path);

  const auto text = runtime_internal::ReadTextFile(path);
  if (!text.has_value()) {
    PopulateLoadResult(ctx, descriptor, false, "Failed to read XML file");
    SetJsProperty(ctx, descriptor, "xmlText", MakeJsString(ctx, ""));
    return descriptor;
  }

  PopulateLoadResult(ctx, descriptor, true, "");
  SetJsProperty(ctx, descriptor, "xmlText", MakeJsString(ctx, *text));
  return descriptor;
}

const char* GetIoBootstrapScript() {
  return kBootstrapIoScript;
}

}  // namespace momentum
