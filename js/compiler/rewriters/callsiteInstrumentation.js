window.compilerCallsiteInstrumentationPass = (function () {
  var CALLSITE_PREFIX = "__mcs_";

  function getShapeNames() {
    var names = {};
    var registryNames = window.compilerSymbols.getShapeNames();
    for (var i = 0; i < registryNames.length; i++) {
      names[registryNames[i]] = true;
    }
    return names;
  }

  function instrument(code, program) {
    var source = String(code || "");
    if (!source.trim()) return source;

    var shapeNames = getShapeNames();
    if (!Object.keys(shapeNames).length) {
      return source;
    }

    var ast = program;
    if (!ast) {
      ast = window.compilerAst.parse(source);
      window.compilerAst.addParentLinks(ast, null);
    }

    var inserts = [];
    var callsiteCounter = 0;

    window.compilerAst.walk(ast, function (node) {
      if (!node || node.type !== "CallExpression" || !node.callee) {
        return;
      }

      if (node.callee.type !== "Identifier") {
        return;
      }

      if (!shapeNames[node.callee.name]) {
        return;
      }

      var openParen = source.indexOf("(", node.callee.end);
      if (openParen === -1 || openParen > node.end) {
        return;
      }

      callsiteCounter++;
      inserts.push({
        start: openParen + 1,
        end: openParen + 1,
        text:
          JSON.stringify(CALLSITE_PREFIX + callsiteCounter) +
          (node.arguments.length > 0 ? ", " : ""),
      });
    });

    return window.compilerAst.applyTextReplacements(source, inserts);
  }

  return {
    callsitePrefix: CALLSITE_PREFIX,
    instrument: instrument,
  };
})();
