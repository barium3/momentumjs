window.compilerReservedDataPass = (function () {
  var RESERVED_DATA_HELPERS = {
    boolean: "_data_boolean",
    byte: "_data_byte",
    char: "_data_char",
    float: "_data_float",
    hex: "_data_hex",
    int: "_data_int",
    unchar: "_data_unchar",
    unhex: "_data_unhex",
  };

  function rewrite(source, program) {
    var code = String(source || "");
    if (!code.trim()) return code;

    try {
      var ast = program || window.compilerAst.parse(code);
      var replacements = [];

      window.compilerAst.walk(ast, function (node) {
        if (!node || node.type !== "CallExpression" || !node.callee) {
          return;
        }

        if (node.callee.type !== "Identifier") {
          return;
        }

        var alias = RESERVED_DATA_HELPERS[node.callee.name];
        if (!alias) return;

        replacements.push({
          start: node.callee.start,
          end: node.callee.end,
          text: alias,
        });
      });

      return window.compilerAst.applyTextReplacements(code, replacements);
    } catch (error) {
      return fallbackRewrite(code);
    }
  }

  function rewriteCodeSet(codes) {
    return {
      drawCode: rewrite(codes.drawCode || ""),
      setupCode: rewrite(codes.setupCode || ""),
      globalCode: rewrite(codes.globalCode || ""),
      drawFullCode: rewrite(codes.drawFullCode || ""),
      setupFullCode: rewrite(codes.setupFullCode || ""),
      preloadFullCode: rewrite(codes.preloadFullCode || ""),
    };
  }

  function fallbackRewrite(code) {
    var source = String(code || "");
    var out = "";
    var i = 0;
    var inStr = false;
    var strChar = "";

    while (i < source.length) {
      var ch = source[i];

      if (inStr) {
        out += ch;
        if (ch === "\\" && i + 1 < source.length) {
          out += source[i + 1];
          i += 2;
          continue;
        }
        if (ch === strChar) {
          inStr = false;
        }
        i++;
        continue;
      }

      if (ch === '"' || ch === "'" || ch === "`") {
        inStr = true;
        strChar = ch;
        out += ch;
        i++;
        continue;
      }

      if (/[A-Za-z_$]/.test(ch)) {
        var j = i + 1;
        while (j < source.length && /[A-Za-z0-9_$]/.test(source[j])) {
          j++;
        }

        var word = source.slice(i, j);
        var alias = Object.prototype.hasOwnProperty.call(RESERVED_DATA_HELPERS, word)
          ? RESERVED_DATA_HELPERS[word]
          : null;
        var prev = i > 0 ? source[i - 1] : "";

        if (alias && prev !== "." && !/[A-Za-z0-9_$]/.test(prev)) {
          var k = j;
          while (k < source.length && /\s/.test(source[k])) {
            k++;
          }
          if (source[k] === "(") {
            out += alias;
            i = j;
            continue;
          }
        }

        out += word;
        i = j;
        continue;
      }

      out += ch;
      i++;
    }

    return out;
  }

  return {
    rewrite: rewrite,
    rewriteCodeSet: rewriteCodeSet,
  };
})();
