/**
 * 代码预处理器
 * 在分析/执行前对用户代码进行预处理
 */
window.codePreprocessor = (function () {
  var CALLSITE_PREFIX = "__mcs_";

  /**
   * 移除代码中的注释，避免 Acorn 解析时因注释中的 Unicode 字符报错
   * 正确处理字符串内的 // 和 /*（如 "http://"、'// not comment'）
   * @param {string} code - 原始代码
   * @returns {string} 移除注释后的代码
   */
  function stripComments(code) {
    let result = "";
    let i = 0;
    const len = code.length;
    let inSingle = false;
    let inMulti = false;
    let inStr = false;
    let strChar = "";

    while (i < len) {
      if (inMulti) {
        if (code[i] === "*" && code[i + 1] === "/") {
          inMulti = false;
          i += 2;
          result += " ";
          continue;
        }
        if (code[i] === "\n") result += "\n";
        i++;
        continue;
      }
      if (inSingle) {
        if (code[i] === "\n") {
          inSingle = false;
          result += "\n";
        }
        i++;
        continue;
      }
      if (inStr) {
        if (code[i] === "\\" && i + 1 < len) {
          result += code[i] + code[i + 1];
          i += 2;
          continue;
        }
        if (code[i] === strChar) inStr = false;
        result += code[i];
        i++;
        continue;
      }
      if (code[i] === "/" && code[i + 1] === "/") {
        inSingle = true;
        i += 2;
        continue;
      }
      if (code[i] === "/" && code[i + 1] === "*") {
        inMulti = true;
        i += 2;
        continue;
      }
      if (
        (code[i] === '"' || code[i] === "'" || code[i] === "`") &&
        (i === 0 || code[i - 1] !== "\\")
      ) {
        inStr = true;
        strChar = code[i];
        result += code[i];
        i++;
        continue;
      }
      result += code[i];
      i++;
    }
    return result;
  }

  function collectShapeFunctionNames() {
    var names = {};

    if (
      typeof functionRegistry === "undefined" ||
      !functionRegistry ||
      !functionRegistry.shapes
    ) {
      return names;
    }

    for (var shapeName in functionRegistry.shapes) {
      if (!functionRegistry.shapes.hasOwnProperty(shapeName)) continue;
      names[shapeName] = true;

      var info = functionRegistry.shapes[shapeName];
      if (!info || !info.builders) continue;

      for (var builderName in info.builders) {
        if (info.builders.hasOwnProperty(builderName)) {
          names[builderName] = true;
        }
      }
    }

    return names;
  }

  function walkNode(node, visit) {
    if (!node || typeof node !== "object") {
      return;
    }

    visit(node);

    for (var key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      if (key === "parent") continue;

      var child = node[key];
      if (!child) continue;

      if (Array.isArray(child)) {
        for (var i = 0; i < child.length; i++) {
          if (child[i] && typeof child[i] === "object") {
            walkNode(child[i], visit);
          }
        }
      } else if (typeof child === "object" && child.type) {
        walkNode(child, visit);
      }
    }
  }

  function instrumentShapeCallsites(code) {
    var source = String(code || "");
    if (!source.trim()) {
      return source;
    }

    if (typeof acorn === "undefined") {
      return source;
    }

    var shapeNames = collectShapeFunctionNames();
    if (!Object.keys(shapeNames).length) {
      return source;
    }

    var ast;
    try {
      ast = acorn.parse(source, {
        ecmaVersion: 2020,
        sourceType: "script",
        ranges: false,
      });
    } catch (e) {
      console.warn("[codePreprocessor] 调用点注入失败:", e.message);
      return source;
    }

    var inserts = [];
    var callsiteCounter = 0;

    walkNode(ast, function (node) {
      if (!node || node.type !== "CallExpression" || !node.callee) {
        return;
      }

      if (node.callee.type !== "Identifier") {
        return;
      }

      var calleeName = node.callee.name;
      if (!shapeNames[calleeName]) {
        return;
      }

      var openParen = source.indexOf("(", node.callee.end);
      if (openParen === -1 || openParen > node.end) {
        return;
      }

      callsiteCounter++;
      var callsiteId = CALLSITE_PREFIX + callsiteCounter;
      var insertion =
        JSON.stringify(callsiteId) + (node.arguments.length > 0 ? ", " : "");

      inserts.push({
        pos: openParen + 1,
        text: insertion,
      });
    });

    if (!inserts.length) {
      return source;
    }

    inserts.sort(function (a, b) {
      return b.pos - a.pos;
    });

    var out = source;
    for (var i = 0; i < inserts.length; i++) {
      var insert = inserts[i];
      out = out.slice(0, insert.pos) + insert.text + out.slice(insert.pos);
    }

    return out;
  }

  return {
    stripComments: stripComments,
    instrumentShapeCallsites: instrumentShapeCallsites,
    callsitePrefix: CALLSITE_PREFIX,
  };
})();
