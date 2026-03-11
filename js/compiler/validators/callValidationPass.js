window.compilerCallValidationPass = (function () {
  var FUNCTION_BINDING_INFO = {
    callable: true,
    type: "function",
  };

  var CLASS_BINDING_INFO = {
    callable: false,
    type: "function",
  };

  var UNKNOWN_BINDING_INFO = {
    callable: null,
    type: "unknown",
  };

  var ARGUMENTS_BINDING_INFO = {
    callable: false,
    type: "object",
  };

  function analyze(program) {
    var diagnostics = [];
    if (!program) return diagnostics;

    var globals = window.compilerSemantics.buildGlobalBindings();
    var reported = Object.create(null);
    var globalScope = window.compilerSemantics.createScope(null);

    collectHoistedBindings(program, globalScope);
    collectLexicalBindings(program.body, globalScope);
    visitProgram(program, globalScope, globals, diagnostics, reported);

    return diagnostics;
  }

  function collectHoistedBindings(root, functionScope) {
    window.compilerSemantics.collectHoistedBindings(
      root,
      functionScope,
      getBindingOptions(Object.create(null)),
    );
  }

  function collectLexicalBindings(statements, scope) {
    window.compilerSemantics.collectLexicalBindings(
      statements,
      scope,
      getBindingOptions(Object.create(null)),
    );
  }

  function collectLexicalBindingsFromCases(cases, scope) {
    window.compilerSemantics.collectLexicalBindingsFromCases(
      cases,
      scope,
      getBindingOptions(Object.create(null)),
    );
  }

  function createLoopScope(parentScope, loopInit, globals) {
    return window.compilerSemantics.createLoopScope(
      parentScope,
      loopInit,
      getBindingOptions(globals),
    );
  }

  function getBindingOptions(globals) {
    return {
      classBindingInfo: CLASS_BINDING_INFO,
      functionBindingInfo: FUNCTION_BINDING_INFO,
      getBindingInfo: window.compilerTypeInference.createBindingInfoFromInit,
      globals: globals || Object.create(null),
    };
  }

  function visitProgram(program, scope, globals, diagnostics, reported) {
    if (!program || !Array.isArray(program.body)) return;
    visitStatementList(program.body, scope, scope, globals, diagnostics, reported);
  }

  function visitStatementList(statements, scope, functionScope, globals, diagnostics, reported) {
    if (!Array.isArray(statements)) return;
    for (var i = 0; i < statements.length; i++) {
      visitNode(statements[i], scope, functionScope, globals, diagnostics, reported);
    }
  }

  function visitNode(node, scope, functionScope, globals, diagnostics, reported) {
    if (!node || typeof node !== "object") return;

    switch (node.type) {
      case "Program":
        visitProgram(node, scope, globals, diagnostics, reported);
        return;
      case "BlockStatement":
        visitBlockStatement(node, scope, functionScope, globals, diagnostics, reported);
        return;
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
      case "AssignmentExpression":
        visitAssignmentExpression(node, scope, functionScope, globals, diagnostics, reported);
        return;
      case "CallExpression":
        visitCallExpression(node, scope, functionScope, globals, diagnostics, reported);
        return;
      default:
        forEachChild(node, function (child) {
          visitNode(child, scope, functionScope, globals, diagnostics, reported);
        });
    }
  }

  function visitBlockStatement(node, scope, functionScope, globals, diagnostics, reported) {
    var blockScope = window.compilerSemantics.createScope(scope);
    collectLexicalBindings(node.body, blockScope);
    visitStatementList(node.body, blockScope, functionScope, globals, diagnostics, reported);
  }

  function visitFunctionNode(node, parentScope, globals, diagnostics, reported) {
    var functionScope = window.compilerSemantics.createScope(parentScope);

    if (node.id && node.id.type === "Identifier") {
      window.compilerSemantics.addBinding(functionScope, node.id.name, FUNCTION_BINDING_INFO);
    }

    if (node.type !== "ArrowFunctionExpression") {
      window.compilerSemantics.addBinding(functionScope, "arguments", ARGUMENTS_BINDING_INFO);
    }

    for (var i = 0; i < (node.params || []).length; i++) {
      window.compilerSemantics.addPatternBindings(
        functionScope,
        node.params[i],
        UNKNOWN_BINDING_INFO,
      );
    }

    if (node.body && node.body.type === "BlockStatement") {
      collectHoistedBindings(node.body, functionScope);
      collectLexicalBindings(node.body.body, functionScope);
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
    var catchScope = window.compilerSemantics.createScope(scope);
    window.compilerSemantics.addPatternBindings(catchScope, node.param, UNKNOWN_BINDING_INFO);

    if (node.body && node.body.type === "BlockStatement") {
      collectLexicalBindings(node.body.body, catchScope);
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

  function visitAssignmentExpression(node, scope, functionScope, globals, diagnostics, reported) {
    if (!node) return;

    if (node.right) {
      visitNode(node.right, scope, functionScope, globals, diagnostics, reported);
    }

    updateBindingFromAssignment(node, scope, globals);

    if (node.left && node.left.type !== "Identifier") {
      visitNode(node.left, scope, functionScope, globals, diagnostics, reported);
    }
  }

  function visitForStatement(node, scope, functionScope, globals, diagnostics, reported) {
    var loopScope = createLoopScope(scope, node.init, globals);

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
    var loopScope = createLoopScope(scope, node.left, globals);

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
    if (node.discriminant) {
      visitNode(node.discriminant, scope, functionScope, globals, diagnostics, reported);
    }

    var switchScope = window.compilerSemantics.createScope(scope);
    collectLexicalBindingsFromCases(node.cases, switchScope);

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

  function visitCallExpression(node, scope, functionScope, globals, diagnostics, reported) {
    validateCallExpression(node, scope, globals, diagnostics, reported);
    forEachChild(node, function (child) {
      visitNode(child, scope, functionScope, globals, diagnostics, reported);
    });
  }

  function validateCallExpression(node, scope, globals, diagnostics, reported) {
    if (!node || !node.callee) {
      return;
    }

    if (node.callee.type === "MemberExpression") {
      validateMemberCallExpression(node, scope, globals, diagnostics, reported);
      return;
    }

    if (node.callee.type !== "Identifier") {
      return;
    }

    var name = node.callee.name;
    var resolution = window.compilerCallValidation.resolveCallTarget(scope, globals, name);

    if (resolution.kind === "unknown") {
      window.compilerCallValidation.reportDiagnostic(
        "COMPILER_UNKNOWN_FUNCTION",
        'Unknown function "' + name + '"',
        node.callee,
        diagnostics,
        reported,
      );
      return;
    }

    if (resolution.kind === "noncallable") {
      window.compilerCallValidation.reportDiagnostic(
        "COMPILER_NON_CALLABLE_IDENTIFIER",
        'Identifier "' + name + '" is not callable',
        node.callee,
        diagnostics,
        reported,
      );
      return;
    }

    if (resolution.kind !== "global") {
      return;
    }

    var signatures = window.compilerCallValidation.getFunctionSignatures(name);
    if (!signatures || !signatures.length) {
      return;
    }

    var args = window.compilerCallValidation.getEffectiveArguments(node);
    var matchingCount = window.compilerCallValidation.filterMatchingSignatures(
      signatures,
      args.length,
    );

    if (!matchingCount.length) {
      window.compilerCallValidation.reportDiagnostic(
        "COMPILER_INVALID_ARGUMENT_COUNT",
        window.compilerCallValidation.buildCountErrorMessage(name, signatures, args.length),
        node.callee,
        diagnostics,
        reported,
      );
      return;
    }

  }

  function validateMemberCallExpression(node, scope, globals, diagnostics, reported) {
    var member = node.callee;
    if (!member || member.computed || !member.property || member.property.type !== "Identifier") {
      return;
    }

    var receiverType = window.compilerTypeInference.normalizeReceiverType(
      window.compilerTypeInference.inferExpressionType(member.object, scope, globals),
    );
    if (!receiverType || !window.compilerTypeInference.hasKnownMethodReceiver(receiverType)) {
      return;
    }

    var methodName = member.property.name;
    var signatures = window.compilerCallValidation.getMethodSignatures(receiverType, methodName);
    if (!signatures || !signatures.length) {
      window.compilerCallValidation.reportDiagnostic(
        "COMPILER_UNKNOWN_METHOD",
        'Unknown method "' + methodName + '" on ' + receiverType,
        member.property,
        diagnostics,
        reported,
      );
      return;
    }

    var args = Array.isArray(node.arguments) ? node.arguments : [];
    var matchingCount = window.compilerCallValidation.filterMatchingSignatures(
      signatures,
      args.length,
    );

    if (!matchingCount.length) {
      window.compilerCallValidation.reportDiagnostic(
        "COMPILER_INVALID_ARGUMENT_COUNT",
        window.compilerCallValidation.buildMethodCountErrorMessage(
          receiverType,
          methodName,
          signatures,
          args.length,
        ),
        member.property,
        diagnostics,
        reported,
      );
      return;
    }

  }

  function updateBindingFromAssignment(node, scope, globals) {
    if (
      !node ||
      node.operator !== "=" ||
      !node.left ||
      node.left.type !== "Identifier"
    ) {
      return;
    }

    var binding = window.compilerSemantics.resolveBinding(scope, node.left.name);
    if (!binding) {
      return;
    }

    var nextInfo = window.compilerTypeInference.createBindingInfoFromInit(
      node.right,
      scope,
      globals,
    );
    binding.callable = nextInfo.callable;
    binding.type = nextInfo.type;
  }

  function forEachChild(node, visitor) {
    window.compilerSemantics.forEachChild(node, visitor);
  }

  return {
    analyze: analyze,
  };
})();
