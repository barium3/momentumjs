window.compilerEntryPointsPass = (function () {
  function findEntry(program, code, name) {
    if (!program || !Array.isArray(program.body)) return null;

    for (var i = 0; i < program.body.length; i++) {
      var node = program.body[i];

      if (
        node &&
        node.type === "FunctionDeclaration" &&
        node.id &&
        node.id.name === name
      ) {
        return createFunctionEntry(node, code, name, "function");
      }

      if (node && node.type === "VariableDeclaration") {
        for (var j = 0; j < (node.declarations || []).length; j++) {
          var decl = node.declarations[j];
          if (
            decl &&
            decl.id &&
            decl.id.type === "Identifier" &&
            decl.id.name === name &&
            window.compilerAst.isFunctionLike(decl.init)
          ) {
            return createVariableEntry(node, decl, code, name);
          }
        }
      }
    }

    return null;
  }

  function createFunctionEntry(node, code, name, kind) {
    return {
      kind: kind,
      name: name,
      body:
        node.body && node.body.type === "BlockStatement"
          ? code.slice(node.body.start + 1, node.body.end - 1).trim()
          : "",
      full: code.slice(node.start, node.end),
      start: node.start,
      end: node.end,
      node: node,
      bodyNode: node.body || null,
    };
  }

  function createVariableEntry(node, decl, code, name) {
    var fnNode = decl.init;
    var body = "";
    var bodyNode = fnNode && fnNode.body ? fnNode.body : null;

    if (bodyNode && bodyNode.type === "BlockStatement") {
      body = code.slice(bodyNode.start + 1, bodyNode.end - 1).trim();
    } else if (bodyNode) {
      body = "return " + code.slice(bodyNode.start, bodyNode.end).trim() + ";";
    }

    return {
      kind: "variable",
      name: name,
      body: body,
      full: code.slice(node.start, node.end),
      start: node.start,
      end: node.end,
      node: fnNode,
      bodyNode: bodyNode,
    };
  }

  function collect(program, code) {
    return {
      draw: findEntry(program, code, "draw"),
      setup: findEntry(program, code, "setup"),
      preload: findEntry(program, code, "preload"),
    };
  }

  return {
    collect: collect,
    findEntry: findEntry,
  };
})();
