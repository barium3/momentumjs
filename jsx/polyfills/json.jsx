(function (global) {
  if (
    global.JSON &&
    typeof global.JSON.stringify === "function" &&
    typeof global.JSON.parse === "function"
  ) {
    return;
  }

  var objectProto = Object.prototype;
  var toString = objectProto.toString;
  var hasOwn = objectProto.hasOwnProperty;
  var escapable = /[\\\"\u0000-\u001f\u2028\u2029]/g;
  var dangerous = /^[\],:{}\s]*$/;
  var escapeSequence = /\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g;
  var valueToken =
    /"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g;
  var arrayLeader = /(?:^|:|,)(?:\s*\[)+/g;
  var meta = {
    "\b": "\\b",
    "\t": "\\t",
    "\n": "\\n",
    "\f": "\\f",
    "\r": "\\r",
    "\"": "\\\"",
    "\\": "\\\\"
  };

  function isArray(value) {
    return toString.call(value) === "[object Array]";
  }

  function repeatSpaces(count) {
    var result = "";
    var i;
    for (i = 0; i < count; i += 1) {
      result += " ";
    }
    return result;
  }

  function quoteString(value) {
    escapable.lastIndex = 0;

    return "\"" + String(value).replace(escapable, function (character) {
      var replacement = meta[character];
      if (replacement) {
        return replacement;
      }

      var hex = character.charCodeAt(0).toString(16);
      while (hex.length < 4) {
        hex = "0" + hex;
      }
      return "\\u" + hex;
    }) + "\"";
  }

  function buildPropertyList(replacer) {
    var seen = {};
    var properties = [];
    var i;

    if (!isArray(replacer)) {
      return null;
    }

    for (i = 0; i < replacer.length; i += 1) {
      var item = replacer[i];
      var key = null;

      if (typeof item === "string" || typeof item === "number") {
        key = String(item);
      } else if (
        item &&
        (item instanceof String || item instanceof Number)
      ) {
        key = String(item.valueOf());
      }

      if (key !== null && !seen[key]) {
        seen[key] = true;
        properties.push(key);
      }
    }

    return properties;
  }

  function stringifyValue(holder, key, replacer, propertyList, gap, indent, stack) {
    var value = holder[key];
    var i;

    if (value && typeof value === "object" && typeof value.toJSON === "function") {
      value = value.toJSON(key);
    }

    if (typeof replacer === "function") {
      value = replacer.call(holder, key, value);
    }

    if (value instanceof String || value instanceof Number || value instanceof Boolean) {
      value = value.valueOf();
    }

    if (value === null) {
      return "null";
    }

    if (typeof value === "string") {
      return quoteString(value);
    }

    if (typeof value === "number") {
      return isFinite(value) ? String(value) : "null";
    }

    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }

    if (typeof value === "undefined" || typeof value === "function") {
      return undefined;
    }

    for (i = 0; i < stack.length; i += 1) {
      if (stack[i] === value) {
        throw new Error("Converting circular structure to JSON");
      }
    }

    stack.push(value);

    var nextIndent = indent + gap;
    var partial = [];
    var result;

    if (isArray(value)) {
      for (i = 0; i < value.length; i += 1) {
        var itemValue = stringifyValue(
          value,
          String(i),
          replacer,
          propertyList,
          gap,
          nextIndent,
          stack
        );
        partial.push(typeof itemValue === "undefined" ? "null" : itemValue);
      }

      if (!partial.length) {
        result = "[]";
      } else if (gap) {
        result =
          "[\n" +
          nextIndent +
          partial.join(",\n" + nextIndent) +
          "\n" +
          indent +
          "]";
      } else {
        result = "[" + partial.join(",") + "]";
      }

      stack.pop();
      return result;
    }

    var keys = propertyList;
    if (!keys) {
      keys = [];
      for (var property in value) {
        if (!hasOwn.call(value, property)) {
          continue;
        }
        keys.push(property);
      }
    }

    for (i = 0; i < keys.length; i += 1) {
      var name = keys[i];
      var member = stringifyValue(
        value,
        name,
        replacer,
        propertyList,
        gap,
        nextIndent,
        stack
      );

      if (typeof member !== "undefined") {
        partial.push(quoteString(name) + (gap ? ": " : ":") + member);
      }
    }

    if (!partial.length) {
      result = "{}";
    } else if (gap) {
      result =
        "{\n" +
        nextIndent +
        partial.join(",\n" + nextIndent) +
        "\n" +
        indent +
        "}";
    } else {
      result = "{" + partial.join(",") + "}";
    }

    stack.pop();
    return result;
  }

  function stringify(value, replacer, space) {
    var gap = "";

    if (typeof replacer !== "function" && replacer && !isArray(replacer)) {
      throw new Error("JSON.stringify");
    }

    if (typeof space === "number") {
      gap = repeatSpaces(Math.min(10, Math.max(0, Math.floor(space))));
    } else if (typeof space === "string") {
      gap = String(space).substring(0, 10);
    }

    return stringifyValue(
      { "": value },
      "",
      replacer,
      buildPropertyList(replacer),
      gap,
      "",
      []
    );
  }

  function walk(holder, key, reviver) {
    var value = holder[key];
    var i;

    if (value && typeof value === "object") {
      if (isArray(value)) {
        for (i = 0; i < value.length; i += 1) {
          var revivedArrayValue = walk(value, String(i), reviver);
          if (typeof revivedArrayValue === "undefined") {
            delete value[i];
          } else {
            value[i] = revivedArrayValue;
          }
        }
      } else {
        for (var property in value) {
          if (!hasOwn.call(value, property)) {
            continue;
          }
          var revivedValue = walk(value, property, reviver);
          if (typeof revivedValue === "undefined") {
            delete value[property];
          } else {
            value[property] = revivedValue;
          }
        }
      }
    }

    return reviver.call(holder, key, value);
  }

  function parse(text, reviver) {
    var source = String(text == null ? "" : text);

    if (source.charCodeAt(0) === 0xfeff) {
      source = source.substring(1);
    }

    if (
      !dangerous.test(
        source
          .replace(escapeSequence, "@")
          .replace(valueToken, "]")
          .replace(arrayLeader, "")
      )
    ) {
      throw new Error("JSON.parse");
    }

    var value = eval("(" + source + ")");

    if (typeof reviver === "function") {
      return walk({ "": value }, "", reviver);
    }

    return value;
  }

  global.JSON = global.JSON || {};

  if (typeof global.JSON.stringify !== "function") {
    global.JSON.stringify = stringify;
  }

  if (typeof global.JSON.parse !== "function") {
    global.JSON.parse = parse;
  }
})($.global);
