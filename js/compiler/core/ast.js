window.compilerAst = (function () {
  var OMITTED_CANONICAL_KEYS = {
    start: true,
    end: true,
    loc: true,
    range: true,
    raw: true,
    parent: true,
  };

  function canonicalValue(value) {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "bigint") return "bigint:" + String(value);
    if (typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) {
      return "[" + value.map(canonicalValue).join(",") + "]";
    }
    var keys = Object.keys(value)
      .filter(function (key) { return !OMITTED_CANONICAL_KEYS[key]; })
      .sort();
    return "{" + keys.map(function (key) {
      return JSON.stringify(key) + ":" + canonicalValue(value[key]);
    }).join(",") + "}";
  }

  function parse(code, options) {
    if (typeof acorn === "undefined") {
      throw new Error("Acorn is not available");
    }

    var source = String(code || "");
    var parseOptions = Object.assign(
      {
        ecmaVersion: 2020,
        sourceType: "script",
        locations: true,
      },
      options || {},
    );

    return acorn.parse(source, parseOptions);
  }

  function addParentLinks(node, parent) {
    if (!node || typeof node !== "object") return;
    node.parent = parent || null;

    for (var key in node) {
      if (
        key === "type" ||
        key === "start" ||
        key === "end" ||
        key === "loc" ||
        key === "parent"
      ) {
        continue;
      }

      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      var child = node[key];
      if (!child) continue;

      if (Array.isArray(child)) {
        for (var i = 0; i < child.length; i++) {
          if (child[i] && typeof child[i] === "object") {
            addParentLinks(child[i], node);
          }
        }
      } else if (typeof child === "object" && child.type) {
        addParentLinks(child, node);
      }
    }
  }

  function walk(node, visitor) {
    if (!node || typeof node !== "object") return;
    if (visitor(node) === false) return;

    for (var key in node) {
      if (
        key === "type" ||
        key === "start" ||
        key === "end" ||
        key === "loc" ||
        key === "parent"
      ) {
        continue;
      }

      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      var child = node[key];
      if (!child) continue;

      if (Array.isArray(child)) {
        for (var i = 0; i < child.length; i++) {
          if (child[i] && typeof child[i] === "object") {
            walk(child[i], visitor);
          }
        }
      } else if (typeof child === "object" && child.type) {
        walk(child, visitor);
      }
    }
  }

  function getCalleeName(callee) {
    if (!callee) return null;

    if (callee.type === "Identifier") {
      return callee.name;
    }

    if (
      callee.type === "MemberExpression" &&
      !callee.computed &&
      callee.property &&
      callee.property.type === "Identifier"
    ) {
      return callee.property.name;
    }

    return null;
  }

  function isFunctionLike(node) {
    return (
      !!node &&
      (node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression")
    );
  }

  function getStringLiteralValue(node) {
    return node && node.type === "Literal" && typeof node.value === "string"
      ? node.value
      : null;
  }

  function getStaticNumber(node, numericBindings) {
    if (!node) return null;

    if (node.type === "Literal" && typeof node.value === "number") {
      return isNaN(node.value) ? null : node.value;
    }

    if (node.type === "Identifier") {
      if (
        numericBindings &&
        Object.prototype.hasOwnProperty.call(numericBindings, node.name)
      ) {
        return numericBindings[node.name];
      }
      return null;
    }

    if (
      node.type === "UnaryExpression" &&
      (node.operator === "-" || node.operator === "+")
    ) {
      var nested = getStaticNumber(node.argument, numericBindings);
      if (nested === null) return null;
      return node.operator === "-" ? -nested : nested;
    }

    if (node.type === "BinaryExpression") {
      var left = getStaticNumber(node.left, numericBindings);
      var right = getStaticNumber(node.right, numericBindings);

      if (left === null || right === null) {
        return null;
      }

      switch (node.operator) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return right === 0 ? null : left / right;
        case "%":
          return right === 0 ? null : left % right;
        case "**":
          return Math.pow(left, right);
        default:
          return null;
      }
    }

    return null;
  }

  function slice(code, nodeOrRange) {
    if (!nodeOrRange) return "";
    return String(code || "").slice(nodeOrRange.start, nodeOrRange.end);
  }

  function removeRanges(code, ranges) {
    if (!ranges || !ranges.length) return String(code || "");

    var sorted = ranges
      .filter(function (range) {
        return (
          range &&
          typeof range.start === "number" &&
          typeof range.end === "number"
        );
      })
      .sort(function (a, b) {
        return b.start - a.start;
      });

    var out = String(code || "");
    for (var i = 0; i < sorted.length; i++) {
      var range = sorted[i];
      out = out.slice(0, range.start) + out.slice(range.end);
    }
    return out;
  }

  function applyTextReplacements(code, replacements) {
    if (!replacements || !replacements.length) {
      return String(code || "");
    }

    var sorted = replacements
      .filter(function (item) {
        return (
          item &&
          typeof item.start === "number" &&
          typeof item.end === "number" &&
          typeof item.text === "string"
        );
      })
      .sort(function (a, b) {
        return b.start - a.start;
      });

    var out = String(code || "");
    for (var i = 0; i < sorted.length; i++) {
      out = out.slice(0, sorted[i].start) + sorted[i].text + out.slice(sorted[i].end);
    }
    return out;
  }

  return {
    addParentLinks: addParentLinks,
    applyTextReplacements: applyTextReplacements,
    canonicalValue: canonicalValue,
    getCalleeName: getCalleeName,
    getStaticNumber: getStaticNumber,
    getStringLiteralValue: getStringLiteralValue,
    isFunctionLike: isFunctionLike,
    parse: parse,
    removeRanges: removeRanges,
    slice: slice,
    walk: walk,
  };
})();
