window.compilerUndeclaredIdentifiersPass = (function () {
  function analyze(program) {
    var diagnostics = [];
    if (!program) return diagnostics;

    var semantics = window.compilerSemantics;
    var globals = semantics.buildGlobalBindings();
    var reported = Object.create(null);
    var globalScope = semantics.createScope(null);

    semantics.collectHoistedBindings(program, globalScope);
    semantics.collectLexicalBindings(program.body, globalScope);
    visitProgram(program, globalScope, globals, diagnostics, reported);

    return diagnostics;
  }

  function visitProgram(program, scope, globals, diagnostics, reported) {
    if (!program || !Array.isArray(program.body)) return;
    visitStatementList(program.body, scope, scope, globals, diagnostics, reported);
  }

  function visitStatementList(
    statements,
    scope,
    functionScope,
    globals,
    diagnostics,
    reported,
  ) {
    if (!Array.isArray(statements)) return;

    for (var i = 0; i < statements.length; i++) {
      visitNode(statements[i], scope, functionScope, globals, diagnostics, reported);
    }
  }

  function visitNode(node, scope, functionScope, globals, diagnostics, reported) {
    if (!node || typeof node !== "object") return;

    var semantics = window.compilerSemantics;

    switch (node.type) {
      case "Program":
        visitProgram(node, scope, globals, diagnostics, reported);
        return;
      case "BlockStatement": {
        var blockScope = semantics.createScope(scope);
        semantics.collectLexicalBindings(node.body, blockScope);
        visitStatementList(
          node.body,
          blockScope,
          functionScope,
          globals,
          diagnostics,
          reported,
        );
        return;
      }
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        visitFunctionNode(node, scope, globals, diagnostics, reported);
        return;
      case "CatchClause":
        visitCatchClause(node, scope, functionScope, globals, diagnostics, reported);
        return;
      case "ForStatement":
        visitForStatement(node, scope, functionScope, globals, diagnostics, reported);
        return;
      case "ForInStatement":
      case "ForOfStatement":
        visitForEachStatement(node, scope, functionScope, globals, diagnostics, reported);
        return;
      case "SwitchStatement":
        visitSwitchStatement(node, scope, functionScope, globals, diagnostics, reported);
        return;
      case "Identifier":
        if (
          semantics.isReferenceIdentifier(node) &&
          !isKnownIdentifier(node.name, scope, globals)
        ) {
          reportUndeclared(node, diagnostics, reported);
        }
        return;
      default:
        semantics.forEachChild(node, function (child) {
          visitNode(child, scope, functionScope, globals, diagnostics, reported);
        });
    }
  }

  function visitFunctionNode(node, parentScope, globals, diagnostics, reported) {
    var semantics = window.compilerSemantics;
    var functionScope = semantics.createScope(parentScope);

    if (node.id && node.id.type === "Identifier") {
      semantics.addBinding(functionScope, node.id.name);
    }

    if (node.type !== "ArrowFunctionExpression") {
      semantics.addBinding(functionScope, "arguments");
    }

    for (var i = 0; i < (node.params || []).length; i++) {
      semantics.addPatternBindings(functionScope, node.params[i]);
    }

    for (var j = 0; j < (node.params || []).length; j++) {
      visitNode(node.params[j], functionScope, functionScope, globals, diagnostics, reported);
    }

    if (node.body && node.body.type === "BlockStatement") {
      semantics.collectHoistedBindings(node.body, functionScope);
      semantics.collectLexicalBindings(node.body.body, functionScope);
      visitStatementList(
        node.body.body,
        functionScope,
        functionScope,
        globals,
        diagnostics,
        reported,
      );
      return;
    }

    visitNode(node.body, functionScope, functionScope, globals, diagnostics, reported);
  }

  function visitCatchClause(node, scope, functionScope, globals, diagnostics, reported) {
    var semantics = window.compilerSemantics;
    var catchScope = semantics.createScope(scope);

    semantics.addPatternBindings(catchScope, node.param);

    if (node.param) {
      visitNode(node.param, catchScope, functionScope, globals, diagnostics, reported);
    }

    if (node.body && node.body.type === "BlockStatement") {
      semantics.collectLexicalBindings(node.body.body, catchScope);
      visitStatementList(
        node.body.body,
        catchScope,
        functionScope,
        globals,
        diagnostics,
        reported,
      );
      return;
    }

    visitNode(node.body, catchScope, functionScope, globals, diagnostics, reported);
  }

  function visitForStatement(node, scope, functionScope, globals, diagnostics, reported) {
    var semantics = window.compilerSemantics;
    var loopScope = semantics.createLoopScope(scope, node.init);

    if (node.init) {
      visitNode(node.init, loopScope, functionScope, globals, diagnostics, reported);
    }

    if (node.test) {
      visitNode(node.test, loopScope, functionScope, globals, diagnostics, reported);
    }

    if (node.update) {
      visitNode(node.update, loopScope, functionScope, globals, diagnostics, reported);
    }

    if (node.body) {
      visitNode(node.body, loopScope, functionScope, globals, diagnostics, reported);
    }
  }

  function visitForEachStatement(node, scope, functionScope, globals, diagnostics, reported) {
    var semantics = window.compilerSemantics;
    var loopScope = semantics.createLoopScope(scope, node.left);

    if (node.left) {
      visitNode(node.left, loopScope, functionScope, globals, diagnostics, reported);
    }

    if (node.right) {
      visitNode(node.right, loopScope, functionScope, globals, diagnostics, reported);
    }

    if (node.body) {
      visitNode(node.body, loopScope, functionScope, globals, diagnostics, reported);
    }
  }

  function visitSwitchStatement(node, scope, functionScope, globals, diagnostics, reported) {
    var semantics = window.compilerSemantics;

    if (node.discriminant) {
      visitNode(node.discriminant, scope, functionScope, globals, diagnostics, reported);
    }

    var switchScope = semantics.createScope(scope);
    semantics.collectLexicalBindingsFromCases(node.cases, switchScope);

    for (var i = 0; i < (node.cases || []).length; i++) {
      var switchCase = node.cases[i];
      if (!switchCase) continue;

      if (switchCase.test) {
        visitNode(switchCase.test, switchScope, functionScope, globals, diagnostics, reported);
      }

      visitStatementList(
        switchCase.consequent || [],
        switchScope,
        functionScope,
        globals,
        diagnostics,
        reported,
      );
    }
  }

  function isKnownIdentifier(name, scope, globals) {
    return !!window.compilerSemantics.resolveBinding(scope, name) || !!globals[name];
  }

  function reportUndeclared(node, diagnostics, reported) {
    var key =
      node.name +
      ":" +
      (node.loc && node.loc.start ? node.loc.start.line : 0) +
      ":" +
      (node.loc && node.loc.start ? node.loc.start.column : 0);

    if (reported[key]) {
      return;
    }
    reported[key] = true;

    diagnostics.push({
      code: "COMPILER_UNDECLARED_IDENTIFIER",
      message: 'Undeclared variable "' + node.name + '"',
      severity: "error",
      phase: "semantic",
      fatal: true,
      loc:
        node.loc && node.loc.start
          ? {
              line: node.loc.start.line,
              column: node.loc.start.column,
            }
          : null,
    });
  }

  return {
    analyze: analyze,
  };
})();
