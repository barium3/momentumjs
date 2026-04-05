#include "api_internal.h"

namespace momentum {

namespace {

constexpr char kBootstrapDataScript[] = R"MOMENTUM_BOOT(
function float(value) {
  if (Array.isArray(value)) {
    return value.map(float);
  }
  var parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

function boolean(value) {
  if (Array.isArray(value)) {
    return value.map(boolean);
  }
  if (typeof value === "string") {
    var normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    if (normalized === "") return false;
    var parsed = parseFloat(normalized);
    return !isNaN(parsed) && parsed !== 0;
  }
  return !!value;
}

function str(value) {
  if (Array.isArray(value)) {
    return value.map(str);
  }
  return String(value);
}

function byte(value) {
  if (Array.isArray(value)) {
    return value.map(byte);
  }
  var numeric = int(value);
  return ((numeric % 256) + 256) % 256;
}

function char(value) {
  if (Array.isArray(value)) {
    return value.map(char);
  }
  if (typeof value === "number") {
    return String.fromCharCode(byte(value));
  }
  var text = String(value == null ? "" : value);
  return text.length ? text.charAt(0) : "";
}

function unchar(value) {
  if (Array.isArray(value)) {
    return value.map(unchar);
  }
  var text = String(value == null ? "" : value);
  return text.length ? text.charCodeAt(0) : 0;
}

function hex(value, digits) {
  if (Array.isArray(value)) {
    return value.map(function(item) {
      return hex(item, digits);
    });
  }
  var numeric = Math.floor(Number(value) || 0);
  var output = (numeric >>> 0).toString(16).toUpperCase();
  var minDigits = Math.max(0, Math.floor(Number(digits) || 0));
  if (minDigits > 0 && output.length < minDigits) {
    output = new Array(minDigits - output.length + 1).join("0") + output;
  }
  return output;
}

function unhex(value) {
  if (Array.isArray(value)) {
    return value.map(unhex);
  }
  var parsed = parseInt(String(value == null ? "" : value), 16);
  return isNaN(parsed) ? 0 : parsed;
}

function join(list, separator) {
  return Array.isArray(list) ? list.join(separator === undefined ? "" : String(separator)) : "";
}

function match(str, regexp) {
  try {
    var rx = regexp instanceof RegExp ? regexp : new RegExp(regexp);
    return String(str == null ? "" : str).match(rx);
  } catch (error) {
    return null;
  }
}

function matchAll(str, regexp) {
  try {
    var rx = regexp instanceof RegExp ? regexp : new RegExp(regexp, "g");
    if (!rx.global) {
      rx = new RegExp(rx.source, rx.flags + "g");
    }
    return Array.from(String(str == null ? "" : str).matchAll(rx));
  } catch (error) {
    return [];
  }
}

function split(value, delimiter) {
  return String(value == null ? "" : value).split(String(delimiter == null ? "" : delimiter));
}

function splitTokens(value, tokens) {
  var text = String(value == null ? "" : value);
  var delimiters = tokens == null ? " \t\n\r\f" : String(tokens);
  if (!delimiters) {
    return [text];
  }
  var escaped = delimiters.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.split(new RegExp("[" + escaped + "]+", "g")).filter(function(item) {
    return item.length > 0;
  });
}

function trim(value) {
  if (Array.isArray(value)) {
    return value.map(trim);
  }
  return String(value == null ? "" : value).trim();
}

function append(arrayValue, value) {
  var result = Array.isArray(arrayValue) ? arrayValue.slice() : [];
  result.push(value);
  return result;
}

function arrayCopy(src, srcPosition, dst, dstPosition, length) {
  if (!Array.isArray(src) || !Array.isArray(dst)) {
    return dst;
  }
  if (arguments.length === 2) {
    dst = srcPosition;
    if (!Array.isArray(dst)) return dst;
    srcPosition = 0;
    dstPosition = 0;
    length = src.length;
  } else if (arguments.length === 3) {
    dstPosition = 0;
    length = Number(srcPosition) || 0;
    srcPosition = 0;
  }
  srcPosition = Math.max(0, Math.floor(Number(srcPosition) || 0));
  dstPosition = Math.max(0, Math.floor(Number(dstPosition) || 0));
  length = Math.max(0, Math.floor(Number(length) || 0));
  for (var i = 0; i < length && (srcPosition + i) < src.length; i += 1) {
    dst[dstPosition + i] = src[srcPosition + i];
  }
  return dst;
}

function concat(list0, list1) {
  return (Array.isArray(list0) ? list0 : []).concat(Array.isArray(list1) ? list1 : []);
}

function reverse(list) {
  var result = Array.isArray(list) ? list.slice() : [];
  result.reverse();
  return result;
}

function shorten(list) {
  var result = Array.isArray(list) ? list.slice() : [];
  result.pop();
  return result;
}

function shuffle(list, modify) {
  var target = modify && Array.isArray(list) ? list : (Array.isArray(list) ? list.slice() : []);
  for (var i = target.length - 1; i > 0; i -= 1) {
    var j = Math.floor(random(i + 1));
    var temp = target[i];
    target[i] = target[j];
    target[j] = temp;
  }
  return target;
}

function sort(list, count) {
  var result = Array.isArray(list) ? list.slice() : [];
  var limit = count === undefined ? result.length : Math.max(0, Math.floor(Number(count) || 0));
  var head = result.slice(0, limit);
  var tail = result.slice(limit);
  var numeric = head.every(function(item) {
    return typeof item === "number";
  });
  head.sort(function(a, b) {
    if (numeric) {
      return a - b;
    }
    return String(a).localeCompare(String(b));
  });
  return head.concat(tail);
}

function splice(list, value, index) {
  var result = Array.isArray(list) ? list.slice() : [];
  var insertIndex = Math.max(0, Math.floor(Number(index) || 0));
  var insertion = Array.isArray(value) ? value : [value];
  result.splice.apply(result, [insertIndex, 0].concat(insertion));
  return result;
}

function subset(list, start, count) {
  var source = Array.isArray(list) ? list : [];
  var offset = Math.max(0, Math.floor(Number(start) || 0));
  if (count === undefined) {
    return source.slice(offset);
  }
  var limit = Math.max(0, Math.floor(Number(count) || 0));
  return source.slice(offset, offset + limit);
}

function __momentumFormatFixed(value, left, right, groupThousands, positivePrefix) {
  var numeric = Number(value) || 0;
  var negative = numeric < 0 || Object.is(numeric, -0);
  numeric = Math.abs(numeric);
  var digitsRight = right === undefined ? 0 : Math.max(0, Math.floor(Number(right) || 0));
  var formatted = numeric.toFixed(digitsRight);
  var parts = formatted.split(".");
  var whole = parts[0];
  var fraction = parts.length > 1 ? parts[1] : "";
  var minLeft = Math.max(0, Math.floor(Number(left) || 0));
  while (whole.length < minLeft) {
    whole = "0" + whole;
  }
  if (groupThousands) {
    whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  var sign = negative ? "-" : (positivePrefix || "");
  return sign + whole + (fraction ? "." + fraction : "");
}

function nf(value, left, right) {
  if (Array.isArray(value)) {
    return value.map(function(item) {
      return nf(item, left, right);
    });
  }
  return __momentumFormatFixed(value, left, right, false, "");
}

function nfc(value, right) {
  if (Array.isArray(value)) {
    return value.map(function(item) {
      return nfc(item, right);
    });
  }
  return __momentumFormatFixed(value, 0, right, true, "");
}

function nfp(value, left, right) {
  if (Array.isArray(value)) {
    return value.map(function(item) {
      return nfp(item, left, right);
    });
  }
  return __momentumFormatFixed(value, left, right, false, "+");
}

function nfs(value, left, right) {
  if (Array.isArray(value)) {
    return value.map(function(item) {
      return nfs(item, left, right);
    });
  }
  return __momentumFormatFixed(value, left, right, false, " ");
}

function year() { return new Date().getFullYear(); }
function month() { return new Date().getMonth() + 1; }
function day() { return new Date().getDate(); }
function hour() { return new Date().getHours(); }
function minute() { return new Date().getMinutes(); }
function second() { return new Date().getSeconds(); }
)MOMENTUM_BOOT";

}  // namespace

const char* GetDataBootstrapScript() {
  return kBootstrapDataScript;
}

}  // namespace momentum
