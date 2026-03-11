window.compilerTypeInference = (function () {
  function getRegistry() {
    return window.compilerSymbols.getRegistry();
  }

  function getFunctionReturnType(name) {
    var registry = getRegistry();
    if (!registry || typeof registry.getFunctionReturnType !== "function") {
      return null;
    }
    return registry.getFunctionReturnType(name);
  }

  function getMethodSignatures(receiverType, methodName) {
    var registry = getRegistry();
    if (!registry || typeof registry.getMethodSignatures !== "function") {
      return null;
    }
    return registry.getMethodSignatures(receiverType, methodName);
  }

  function resolveBinding(scope, name) {
    return window.compilerSemantics.resolveBinding(scope, name);
  }

  function createScope(parent) {
    return window.compilerSemantics.createScope(parent);
  }

  function createBindingInfoFromInit(init, scope, globals) {
    if (!init) {
      return {
        callable: null,
        type: "unknown",
      };
    }

    if (window.compilerAst.isFunctionLike(init)) {
      return {
        callable: true,
        type: "function",
      };
    }

    var inferredType = inferExpressionType(
      init,
      scope || createScope(null),
      globals || Object.create(null),
    );

    return {
      callable: inferredType === "function" ? true : inferredType === "unknown" ? null : false,
      type: inferredType,
    };
  }

  function inferExpressionType(node, scope, globals) {
    if (!node) return "unknown";

    switch (node.type) {
      case "Literal":
        if (typeof node.value === "number") return "number";
        if (typeof node.value === "string") return "string";
        if (typeof node.value === "boolean") return "boolean";
        if (node.value === null) return "null";
        return "unknown";
      case "TemplateLiteral":
        return "string";
      case "ArrayExpression":
        return "array";
      case "ObjectExpression":
        return "object";
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        return "function";
      case "NewExpression":
        return "object";
      case "Identifier": {
        var binding = resolveBinding(scope, node.name);
        if (binding && binding.type) return binding.type;
        var globalInfo = globals[node.name];
        return globalInfo && globalInfo.type ? globalInfo.type : "unknown";
      }
      case "UnaryExpression":
        if (node.operator === "!" || node.operator === "delete") return "boolean";
        if (node.operator === "+" || node.operator === "-" || node.operator === "~") {
          return "number";
        }
        if (node.operator === "typeof") return "string";
        return inferExpressionType(node.argument, scope, globals);
      case "UpdateExpression":
        return "number";
      case "BinaryExpression":
        return inferBinaryType(node, scope, globals);
      case "LogicalExpression": {
        var leftType = inferExpressionType(node.left, scope, globals);
        var rightType = inferExpressionType(node.right, scope, globals);
        return leftType === rightType ? leftType : "unknown";
      }
      case "ConditionalExpression": {
        var consequentType = inferExpressionType(node.consequent, scope, globals);
        var alternateType = inferExpressionType(node.alternate, scope, globals);
        return consequentType === alternateType ? consequentType : "unknown";
      }
      case "AssignmentExpression":
        return inferExpressionType(node.right, scope, globals);
      case "SequenceExpression":
        if (!node.expressions || !node.expressions.length) return "unknown";
        return inferExpressionType(
          node.expressions[node.expressions.length - 1],
          scope,
          globals,
        );
      case "CallExpression":
        return inferCallType(node, scope, globals);
      case "MemberExpression":
        return "unknown";
      default:
        return "unknown";
    }
  }

  function inferBinaryType(node, scope, globals) {
    if (!node) return "unknown";

    if (
      node.operator === "===" ||
      node.operator === "!==" ||
      node.operator === "==" ||
      node.operator === "!=" ||
      node.operator === ">" ||
      node.operator === ">=" ||
      node.operator === "<" ||
      node.operator === "<=" ||
      node.operator === "in" ||
      node.operator === "instanceof"
    ) {
      return "boolean";
    }

    if (node.operator === "+") {
      var leftType = inferExpressionType(node.left, scope, globals);
      var rightType = inferExpressionType(node.right, scope, globals);
      if (leftType === "string" || rightType === "string") {
        return "string";
      }
      if (leftType === "number" && rightType === "number") {
        return "number";
      }
      return "unknown";
    }

    if (
      node.operator === "-" ||
      node.operator === "*" ||
      node.operator === "/" ||
      node.operator === "%" ||
      node.operator === "**" ||
      node.operator === "|" ||
      node.operator === "&" ||
      node.operator === "^" ||
      node.operator === "<<" ||
      node.operator === ">>" ||
      node.operator === ">>>"
    ) {
      return "number";
    }

    return "unknown";
  }

  function inferCallType(node, scope, globals) {
    if (!node || !node.callee) {
      return "unknown";
    }

    if (node.callee.type === "MemberExpression") {
      return inferMemberCallType(node.callee, scope, globals);
    }

    if (node.callee.type !== "Identifier") {
      return "unknown";
    }

    var name = node.callee.name;
    var knownReturnType = getFunctionReturnType(name);
    if (knownReturnType) {
      return knownReturnType;
    }

    var binding = resolveBinding(scope, name);
    if (binding && binding.returnType) {
      return binding.returnType;
    }

    var globalInfo = globals[name];
    if (globalInfo && globalInfo.returnType) {
      return globalInfo.returnType;
    }

    return "unknown";
  }

  function inferMemberCallType(member, scope, globals) {
    if (!member || member.computed || !member.property || member.property.type !== "Identifier") {
      return "unknown";
    }

    var receiverType = normalizeReceiverType(
      inferExpressionType(member.object, scope, globals),
    );
    if (!receiverType || !hasKnownMethodReceiver(receiverType)) {
      return "unknown";
    }

    var signatures = getMethodSignatures(receiverType, member.property.name);
    if (!signatures || !signatures.length) {
      return "unknown";
    }

    for (var i = 0; i < signatures.length; i++) {
      if (signatures[i].returns) {
        return signatures[i].returns;
      }
    }

    return "unknown";
  }

  function hasKnownMethodReceiver(receiverType) {
    if (!receiverType) {
      return false;
    }
    var registry = getRegistry();
    return !!(
      registry &&
      typeof registry.getMethodSignatures === "function" &&
      (
        (registry.instances && registry.instances[receiverType]) ||
        hasKnownTableReceiver(registry, receiverType)
      )
    );
  }

  function hasKnownTableReceiver(registry, receiverType) {
    if (!registry || !registry.tables) {
      return false;
    }

    for (var name in registry.tables) {
      if (!Object.prototype.hasOwnProperty.call(registry.tables, name)) continue;
      var entry = registry.tables[name];
      if (!entry || entry.type !== "instance_method") continue;
      if (entry.receiver === receiverType) {
        return true;
      }
    }

    return false;
  }

  function normalizeReceiverType(typeName) {
    if (!typeName || typeName === "unknown" || typeName === "value") {
      return null;
    }

    switch (typeName) {
      case "table":
        return "Table";
      case "table_row":
      case "tablerow":
        return "TableRow";
      case "table_row_array":
      case "tablerowarray":
        return "TableRowArray";
      default:
        return typeName;
    }
  }

  return {
    createBindingInfoFromInit: createBindingInfoFromInit,
    hasKnownMethodReceiver: hasKnownMethodReceiver,
    inferExpressionType: inferExpressionType,
    normalizeReceiverType: normalizeReceiverType,
  };
})();
