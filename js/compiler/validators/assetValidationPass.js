window.compilerAssetValidationPass = (function () {
  var LOAD_FUNCTIONS = {
    loadImage: true,
    loadJSON: true,
    loadTable: true,
    loadStrings: true,
    loadBytes: true,
    loadXML: true,
  };

  function analyze(program) {
    var diagnostics = [];
    if (
      !program ||
      !window.compilerAst ||
      typeof window.compilerAst.walk !== "function"
    ) {
      return diagnostics;
    }

    window.compilerAst.walk(program, function (node) {
      if (!node || node.type !== "CallExpression") {
        return;
      }

      var funcName = window.compilerAst.getCalleeName(node.callee);
      if (!LOAD_FUNCTIONS[funcName]) {
        return;
      }

      var pathNode = node.arguments && node.arguments[0];
      var relativePath = window.compilerAst.getStringLiteralValue(pathNode);
      if (!relativePath) {
        return;
      }

      var fullPath = resolveAssetPath(relativePath);
      if (!fullPath || assetExists(fullPath)) {
        return;
      }

      diagnostics.push({
        code: "COMPILER_ASSET_NOT_FOUND",
        message: 'Asset for ' + funcName + ' not found: "' + relativePath + '"',
        severity: "error",
        phase: "semantic",
        fatal: true,
        loc:
          pathNode && pathNode.loc && pathNode.loc.start
            ? {
                line: pathNode.loc.start.line,
                column: pathNode.loc.start.column,
              }
            : null,
      });
    });

    return diagnostics;
  }

  function resolveAssetPath(relativePath) {
    var userDir = getUserDirectory();
    var normalizedPath = normalizeAssetPath(relativePath);
    if (!userDir || !normalizedPath) {
      return null;
    }

    return userDir + "/" + normalizedPath;
  }

  function getUserDirectory() {
    if (!window.extensionPath) {
      return null;
    }

    return String(window.extensionPath).replace(/[\\\/]+$/, "") + "/user";
  }

  function normalizeAssetPath(path) {
    return String(path || "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "");
  }

  function assetExists(fullPath) {
    if (
      !window.cep ||
      !window.cep.fs ||
      typeof window.cep.fs.stat !== "function"
    ) {
      return true;
    }

    try {
      var result = window.cep.fs.stat(fullPath);
      return !!(result && result.err === 0);
    } catch (error) {
      return true;
    }
  }

  return {
    analyze: analyze,
  };
})();
