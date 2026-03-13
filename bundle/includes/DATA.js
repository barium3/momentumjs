// Data helpers.

function _getDataCoreLib() {
  return [
    "// ===== Data Helpers =====",
    "function _dataIsArray(value) {",
    "  return Object.prototype.toString.call(value) === '[object Array]';",
    "}",
    "function _dataCloneArray(list) {",
    "  if (!_dataIsArray(list)) return [];",
    "  return list.slice(0);",
    "}",
    "function _dataClampIndex(index, length) {",
    "  var n = Math.floor(Number(index) || 0);",
    "  if (n < 0) return 0;",
    "  if (n > length) return length;",
    "  return n;",
    "}",
    "function _dataCompare(a, b) {",
    "  var aNum = typeof a === 'number';",
    "  var bNum = typeof b === 'number';",
    "  if (aNum && bNum) return a - b;",
    "  var aStr = String(a);",
    "  var bStr = String(b);",
    "  if (aStr < bStr) return -1;",
    "  if (aStr > bStr) return 1;",
    "  return 0;",
    "}",
    "function _dataShuffle(list) {",
    "  for (var i = list.length - 1; i > 0; i--) {",
    "    var j = Math.floor(Math.random() * (i + 1));",
    "    var tmp = list[i];",
    "    list[i] = list[j];",
    "    list[j] = tmp;",
    "  }",
    "  return list;",
    "}",
    "function _dataMapArray(list, mapper) {",
    "  if (!_dataIsArray(list)) return [];",
    "  var out = [];",
    "  for (var i = 0; i < list.length; i++) out.push(mapper(list[i]));",
    "  return out;",
    "}",
    "function _dataTrimSingle(value) {",
    "  return String(value === null || value === undefined ? '' : value).replace(/^\\s+|\\s+$/g, '');",
    "}",
    "function _dataRegexSource(pattern) {",
    "  if (pattern && pattern.source !== undefined) return pattern.source;",
    "  return String(pattern === null || pattern === undefined ? '' : pattern);",
    "}",
    "function _dataRegexFlags(pattern, forceGlobal) {",
    "  var flags = '';",
    "  if (pattern) {",
    "    if (pattern.ignoreCase) flags += 'i';",
    "    if (pattern.multiline) flags += 'm';",
    "    if (pattern.unicode) flags += 'u';",
    "    if (pattern.sticky) flags += 'y';",
    "    if (forceGlobal || pattern.global) flags += 'g';",
    "  } else if (forceGlobal) {",
    "    flags = 'g';",
    "  }",
    "  return flags;",
    "}",
    "function _dataRegex(pattern, forceGlobal) {",
    "  return new RegExp(_dataRegexSource(pattern), _dataRegexFlags(pattern, forceGlobal));",
    "}",
    "function _dataRoundAbs(value, right) {",
    "  if (right === undefined || right === null) return String(value);",
    "  return value.toFixed(Math.max(0, _dataIntSingle(right)));",
    "}",
    "function _dataFormatThousands(intPart) {",
    "  return intPart.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');",
    "}",
    "function _dataNFSingle(value, left, right, signMode) {",
    "  var num = _dataFloatSingle(value);",
    "  var negative = num < 0;",
    "  var absNum = Math.abs(num);",
    "  var formatted = _dataRoundAbs(absNum, right);",
    "  var parts = formatted.split('.');",
    "  var intPart = parts[0] || '0';",
    "  var fracPart = parts.length > 1 ? parts[1] : null;",
    "  var minDigits = Math.max(0, _dataIntSingle(left));",
    "  while (intPart.length < minDigits) intPart = '0' + intPart;",
    "  var prefix = negative ? '-' : '';",
    "  if (!negative && signMode === 'plus') prefix = '+';",
    "  if (!negative && signMode === 'space') prefix = ' ';",
    "  return prefix + intPart + (fracPart !== null ? '.' + fracPart : '');",
    "}",
    "function _dataNFCSingle(value, right) {",
    "  var num = _dataFloatSingle(value);",
    "  var negative = num < 0;",
    "  var absNum = Math.abs(num);",
    "  var formatted = _dataRoundAbs(absNum, right);",
    "  var parts = formatted.split('.');",
    "  var intPart = _dataFormatThousands(parts[0] || '0');",
    "  var fracPart = parts.length > 1 ? '.' + parts[1] : '';",
    "  return (negative ? '-' : '') + intPart + fracPart;",
    "}",
    "function _dataBoolSingle(value) {",
    "  if (_dataIsArray(value)) return value.length > 0;",
    "  if (value === null || value === undefined) return false;",
    "  if (typeof value === 'boolean') return value;",
    "  if (typeof value === 'number') return value !== 0;",
    "  if (typeof value === 'string') return value.toLowerCase() === 'true';",
    "  return !!value;",
    "}",
    "function _dataIntSingle(value, radix) {",
    "  if (typeof value === 'boolean') return value ? 1 : 0;",
    "  if (value === null || value === undefined) return 0;",
    "  if (typeof value === 'number') {",
    "    if (!(value === value) || !isFinite(value)) return 0;",
    "    return value < 0 ? Math.ceil(value) : Math.floor(value);",
    "  }",
    "  var base = radix === undefined ? 10 : radix;",
    "  var parsed = parseInt(String(value), base);",
    "  return parsed === parsed ? parsed : 0;",
    "}",
    "function _dataFloatSingle(value) {",
    "  if (typeof value === 'boolean') return value ? 1 : 0;",
    "  if (value === null || value === undefined) return 0;",
    "  var parsed = parseFloat(String(value));",
    "  return parsed === parsed ? parsed : 0;",
    "}",
    "function _dataByteSingle(value) {",
    "  var n = _dataIntSingle(value);",
    "  n = ((n % 256) + 256) % 256;",
    "  return n > 127 ? n - 256 : n;",
    "}",
    "function _dataCharSingle(value) {",
    "  if (value === null || value === undefined) return '';",
    "  if (typeof value === 'number') return String.fromCharCode(_dataIntSingle(value) & 65535);",
    "  if (typeof value === 'string') return String.fromCharCode(_dataIntSingle(value) & 65535);",
    "  return String.fromCharCode(_dataIntSingle(value) & 65535);",
    "}",
    "function _dataUncharSingle(value) {",
    "  if (value === null || value === undefined) return 0;",
    "  var s = String(value);",
    "  return s.length ? s.charCodeAt(0) : 0;",
    "}",
    "function _dataHexSingle(value, digits) {",
    "  var width = digits === undefined ? 8 : Math.max(0, _dataIntSingle(digits));",
    "  var n = _dataIntSingle(value);",
    "  var max = width > 0 ? Math.pow(16, width) : 0;",
    "  if (width > 0) n = ((n % max) + max) % max;",
    "  var out = n.toString(16).toUpperCase();",
    "  while (width > 0 && out.length < width) out = '0' + out;",
    "  return out;",
    "}",
    "function _dataUnhexSingle(value) {",
    "  if (value === null || value === undefined) return 0;",
    "  var s = String(value).replace(/^0x/i, '').replace(/#/g, '');",
    "  var parsed = parseInt(s, 16);",
    "  return parsed === parsed ? parsed : 0;",
    "}",
    "function _dataStrSingle(value) {",
    "  if (value === null || value === undefined) return '';",
    "  return String(value);",
    "}"
  ].join("\n");
}

function _getDataArrayLib(deps) {
  var lib = [];

  if (deps.append) {
    lib.push([
      "function append(list, value) {",
      "  if (!_dataIsArray(list)) return [value];",
      "  list.push(value);",
      "  return list;",
      "}"
    ].join("\n"));
  }

  if (deps.arrayCopy) {
    lib.push([
      "function arrayCopy(src, srcPosition, dst, dstPosition, length) {",
      "  if (!_dataIsArray(src)) return _dataIsArray(dst) ? dst : [];",
      "  var fromIndex = 0;",
      "  var toIndex = 0;",
      "  var target = _dataIsArray(dst) ? dst : [];",
      "  var count = src.length;",
      "  if (arguments.length === 3) {",
      "    target = _dataIsArray(srcPosition) ? srcPosition : [];",
      "    count = Math.max(0, Math.floor(Number(dst) || 0));",
      "  } else if (arguments.length >= 5) {",
      "    fromIndex = Math.max(0, Math.floor(Number(srcPosition) || 0));",
      "    toIndex = Math.max(0, Math.floor(Number(dstPosition) || 0));",
      "    count = Math.max(0, Math.floor(Number(length) || 0));",
      "  }",
      "  for (var i = 0; i < count; i++) {",
      "    var srcIndex = fromIndex + i;",
      "    if (srcIndex >= src.length) break;",
      "    target[toIndex + i] = src[srcIndex];",
      "  }",
      "  return target;",
      "}"
    ].join("\n"));
  }

  if (deps.concat) {
    lib.push([
      "function concat(list0, list1) {",
      "  var left = _dataIsArray(list0) ? list0 : [];",
      "  var right = _dataIsArray(list1) ? list1 : [];",
      "  return left.concat(right);",
      "}"
    ].join("\n"));
  }

  if (deps.reverse) {
    lib.push([
      "function reverse(list) {",
      "  if (!_dataIsArray(list)) return [];",
      "  return list.reverse();",
      "}"
    ].join("\n"));
  }

  if (deps.shorten) {
    lib.push([
      "function shorten(list) {",
      "  if (!_dataIsArray(list)) return [];",
      "  if (list.length > 0) list.pop();",
      "  return list;",
      "}"
    ].join("\n"));
  }

  if (deps.shuffle) {
    lib.push([
      "function shuffle(list, modify) {",
      "  var target = _dataIsArray(list) ? list : [];",
      "  if (!modify) target = _dataCloneArray(target);",
      "  return _dataShuffle(target);",
      "}"
    ].join("\n"));
  }

  if (deps.sort) {
    lib.push([
      "function sort(list, count) {",
      "  if (!_dataIsArray(list)) return [];",
      "  var target = _dataCloneArray(list);",
      "  var limit = target.length;",
      "  if (count !== undefined) {",
      "    limit = Math.max(0, Math.floor(Number(count) || 0));",
      "    if (limit > target.length) limit = target.length;",
      "  }",
      "  var head = target.slice(0, limit);",
      "  head.sort(_dataCompare);",
      "  for (var i = 0; i < head.length; i++) target[i] = head[i];",
      "  return target;",
      "}"
    ].join("\n"));
  }

  if (deps.splice) {
    lib.push([
      "function splice(list, value, index) {",
      "  if (!_dataIsArray(list)) return [];",
      "  var insertAt = _dataClampIndex(index, list.length);",
      "  var values = _dataIsArray(value) ? value : [value];",
      "  var args = [insertAt, 0];",
      "  for (var i = 0; i < values.length; i++) args.push(values[i]);",
      "  list.splice.apply(list, args);",
      "  return list;",
      "}"
    ].join("\n"));
  }

  if (deps.subset) {
    lib.push([
      "function subset(list, start, count) {",
      "  if (!_dataIsArray(list)) return [];",
      "  var begin = Math.max(0, Math.floor(Number(start) || 0));",
      "  if (count === undefined) return list.slice(begin);",
      "  var size = Math.max(0, Math.floor(Number(count) || 0));",
      "  return list.slice(begin, begin + size);",
      "}"
    ].join("\n"));
  }

  return lib.join("\n");
}

function _getDataConversionLib(deps) {
  var lib = [];

  if (deps["float"]) {
    lib.push([
      "function _data_float(value) {",
      "  return _dataIsArray(value) ? _dataMapArray(value, _dataFloatSingle) : _dataFloatSingle(value);",
      "}"
    ].join("\n"));
  }

  if (deps["hex"]) {
    lib.push([
      "function _data_hex(value, digits) {",
      "  if (_dataIsArray(value)) {",
      "    return _dataMapArray(value, function(item) { return _dataHexSingle(item, digits); });",
      "  }",
      "  return _dataHexSingle(value, digits);",
      "}"
    ].join("\n"));
  }

  if (deps["int"]) {
    lib.push([
      "function _data_int(value, radix) {",
      "  if (_dataIsArray(value)) {",
      "    return _dataMapArray(value, function(item) { return _dataIntSingle(item, radix); });",
      "  }",
      "  return _dataIntSingle(value, radix);",
      "}"
    ].join("\n"));
  }

  if (deps["boolean"]) {
    lib.push([
      "function _data_boolean(value) {",
      "  return _dataIsArray(value) ? _dataMapArray(value, _dataBoolSingle) : _dataBoolSingle(value);",
      "}"
    ].join("\n"));
  }

  if (deps["byte"]) {
    lib.push([
      "function _data_byte(value) {",
      "  return _dataIsArray(value) ? _dataMapArray(value, _dataByteSingle) : _dataByteSingle(value);",
      "}"
    ].join("\n"));
  }

  if (deps["char"]) {
    lib.push([
      "function _data_char(value) {",
      "  return _dataIsArray(value) ? _dataMapArray(value, _dataCharSingle) : _dataCharSingle(value);",
      "}"
    ].join("\n"));
  }

  if (deps.unchar) {
    lib.push([
      "function _data_unchar(value) {",
      "  return _dataIsArray(value) ? _dataMapArray(value, _dataUncharSingle) : _dataUncharSingle(value);",
      "}"
    ].join("\n"));
  }

  if (deps.unhex) {
    lib.push([
      "function _data_unhex(value) {",
      "  return _dataIsArray(value) ? _dataMapArray(value, _dataUnhexSingle) : _dataUnhexSingle(value);",
      "}"
    ].join("\n"));
  }

  return lib.join("\n");
}

function _getDataStringLib(deps) {
  var lib = [];

  if (deps.join) {
    lib.push([
      "function join(list, separator) {",
      "  if (!_dataIsArray(list)) return '';",
      "  return list.join(separator === undefined ? '' : String(separator));",
      "}"
    ].join("\n"));
  }

  if (deps.match) {
    lib.push([
      "function match(str, reg) {",
      "  var source = String(str === null || str === undefined ? '' : str);",
      "  var regex = _dataRegex(reg, false);",
      "  return source.match(regex);",
      "}"
    ].join("\n"));
  }

  if (deps.matchAll) {
    lib.push([
      "function matchAll(str, reg) {",
      "  var source = String(str === null || str === undefined ? '' : str);",
      "  var regex = _dataRegex(reg, true);",
      "  var result = [];",
      "  var found;",
      "  while ((found = regex.exec(source)) !== null) {",
      "    result.push(found);",
      "    if (found[0] === '') regex.lastIndex++;",
      "  }",
      "  return result.length ? result : null;",
      "}"
    ].join("\n"));
  }

  if (deps.split) {
    lib.push([
      "function split(str, delim) {",
      "  var source = String(str === null || str === undefined ? '' : str);",
      "  return source.split(delim === undefined ? '' : String(delim));",
      "}"
    ].join("\n"));
  }

  if (deps.splitTokens) {
    lib.push([
      "function splitTokens(str, tokens) {",
      "  var source = String(str === null || str === undefined ? '' : str);",
      "  var delims = tokens === undefined ? ' \\n\\t\\r\\f' : String(tokens);",
      "  var esc = delims.replace(/[\\\\\\]\\-\\^]/g, '\\\\$&');",
      "  var parts = source.split(new RegExp('[' + esc + ']+'));",
      "  var out = [];",
      "  for (var i = 0; i < parts.length; i++) {",
      "    if (parts[i] !== '') out.push(parts[i]);",
      "  }",
      "  return out;",
      "}"
    ].join("\n"));
  }

  if (deps.str) {
    lib.push([
      "function str(value) {",
      "  return _dataIsArray(value) ? _dataMapArray(value, _dataStrSingle) : _dataStrSingle(value);",
      "}"
    ].join("\n"));
  }

  if (deps.trim) {
    lib.push([
      "function trim(value) {",
      "  return _dataIsArray(value) ? _dataMapArray(value, _dataTrimSingle) : _dataTrimSingle(value);",
      "}"
    ].join("\n"));
  }

  return lib.join("\n");
}

function _getDataFormatLib(deps) {
  var lib = [];

  if (deps.nf) {
    lib.push([
      "function nf(value, left, right) {",
      "  if (_dataIsArray(value)) return _dataMapArray(value, function(item) { return _dataNFSingle(item, left, right, 'none'); });",
      "  return _dataNFSingle(value, left, right, 'none');",
      "}"
    ].join("\n"));
  }

  if (deps.nfc) {
    lib.push([
      "function nfc(value, right) {",
      "  if (_dataIsArray(value)) return _dataMapArray(value, function(item) { return _dataNFCSingle(item, right); });",
      "  return _dataNFCSingle(value, right);",
      "}"
    ].join("\n"));
  }

  if (deps.nfp) {
    lib.push([
      "function nfp(value, left, right) {",
      "  if (_dataIsArray(value)) return _dataMapArray(value, function(item) { return _dataNFSingle(item, left, right, 'plus'); });",
      "  return _dataNFSingle(value, left, right, 'plus');",
      "}"
    ].join("\n"));
  }

  if (deps.nfs) {
    lib.push([
      "function nfs(value, left, right) {",
      "  if (_dataIsArray(value)) return _dataMapArray(value, function(item) { return _dataNFSingle(item, left, right, 'space'); });",
      "  return _dataNFSingle(value, left, right, 'space');",
      "}"
    ].join("\n"));
  }

  if (deps.print) {
    lib.push([
      "function print() {",
      "  if (typeof _ctx !== 'undefined' && _ctx && _ctx.globals) {",
      "    if (!_ctx.globals.__printLogs) _ctx.globals.__printLogs = [];",
      "    var parts = [];",
      "    for (var i = 0; i < arguments.length; i++) parts.push(String(arguments[i]));",
      "    _ctx.globals.__printLogs.push(parts.join(' '));",
      "  }",
      "}"
    ].join("\n"));
  }

  return lib.join("\n");
}

function getDataLib(deps) {
  if (!deps) return "";

  var needsAny = false;
  for (var key in deps) {
    if (deps.hasOwnProperty(key) && deps[key]) {
      needsAny = true;
      break;
    }
  }
  if (!needsAny) return "";

  var lib = [
    _getDataCoreLib(),
    _getDataArrayLib(deps),
    _getDataConversionLib(deps),
    _getDataStringLib(deps),
    _getDataFormatLib(deps)
  ];
  var out = [];
  for (var i = 0; i < lib.length; i++) {
    if (lib[i]) out.push(lib[i]);
  }
  return out.join("\n");
}
