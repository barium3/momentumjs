window.compilerSemantics = (function () {
  var DEFAULT_CALLABLES = {
    clearInterval: { callable: true, type: "function" },
    clearTimeout: { callable: true, type: "function" },
    decodeURI: { callable: true, type: "function" },
    decodeURIComponent: { callable: true, type: "function" },
    encodeURI: { callable: true, type: "function" },
    encodeURIComponent: { callable: true, type: "function" },
    isFinite: { callable: true, type: "function" },
    isNaN: { callable: true, type: "function" },
    parseFloat: { callable: true, type: "function" },
    parseInt: { callable: true, type: "function" },
    setInterval: { callable: true, type: "function" },
    setTimeout: { callable: true, type: "function" },
  };

  var DEFAULT_VALUES = {
    Array: { callable: true, type: "function" },
    Boolean: { callable: true, type: "function" },
    Date: { callable: true, type: "function" },
    Error: { callable: true, type: "function" },
    Infinity: { type: "number" },
    JSON: { type: "object" },
    Math: { type: "object" },
    NaN: { type: "number" },
    Number: { callable: true, type: "function" },
    Object: { callable: true, type: "function" },
    RegExp: { callable: true, type: "function" },
    String: { callable: true, type: "function" },
    console: { type: "object" },
    globalThis: { type: "object" },
    undefined: { type: "undefined" },
    window: { type: "object" },
  };

  function buildGlobalBindings() {
    var bindings = Object.create(null);
    copyBindings(DEFAULT_CALLABLES, bindings);
    copyBindings(DEFAULT_VALUES, bindings);

    var registry = window.compilerSymbols.getRegistry();
    if (!registry) {
      return bindings;
    }

    if (typeof registry.getAllFunctions === "function") {
      addCallableNames(bindings, registry.getAllFunctions());
    }

    addRegistryCategory(bindings, registry.shapes, "function", false);
    addRegistryCategory(bindings, registry.transforms, "function", false);
    addRegistryCategory(bindings, registry.colors, "number", false);
    addRegistryCategory(bindings, registry.typography, "number", false);
    addRegistryCategory(bindings, registry.math, "number", false);
    addRegistryCategory(bindings, registry.environment, "number", false);
    addRegistryCategory(bindings, registry.controllers, "function", false);
    addRegistryCategory(bindings, registry.data, "function", false);
    addRegistryCategory(bindings, registry.images, "function", false);
    addRegistryCategory(bindings, registry.tables, "object", true);

    return bindings;
  }

  function buildAllowedGlobals(globalBindings) {
    var names = Object.create(null);
    var bindings = globalBindings || buildGlobalBindings();

    for (var name in bindings) {
      if (Object.prototype.hasOwnProperty.call(bindings, name)) {
        names[name] = true;
      }
    }

    return names;
  }

  function copyBindings(source, target) {
    for (var key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        target[key] = Object.assign({}, source[key]);
      }
    }
  }

  function addCallableNames(target, names) {
    if (!Array.isArray(names)) return;

    for (var i = 0; i < names.length; i++) {
      if (names[i]) {
        target[names[i]] = {
          callable: true,
          type: "function",
        };
      }
    }
  }

  function addRegistryCategory(target, category, defaultType, skipInstanceMethods) {
    if (!category) return;

    for (var name in category) {
      if (!Object.prototype.hasOwnProperty.call(category, name)) continue;
      var item = category[name] || {};
      if (skipInstanceMethods && item.type === "instance_method") {
        continue;
      }

      if (item.type === "constant" || item.type === "variable") {
        var existing = target[name];
        target[name] = {
          callable: false,
          type:
            item.valueType ||
            (existing && existing.callable === false && existing.type) ||
            defaultType ||
            "number",
        };
        continue;
      }

      if (item.type === "namespace") {
        target[name] = {
          callable: false,
          type: "object",
        };
        continue;
      }

      target[name] = {
        callable: true,
        type: "function",
      };
    }
  }

  function createScope(parent) {
    return {
      parent: parent || null,
      bindings: Object.create(null),
    };
  }

  function addBinding(scope, name, info) {
    if (!scope || !name) return;

    scope.bindings[name] = Object.assign(
      {
        callable: null,
        type: "unknown",
      },
      info || {},
    );
  }

  function resolveBinding(scope, name) {
    var current = scope;
    while (current) {
      if (Object.prototype.hasOwnProperty.call(current.bindings, name)) {
        return current.bindings[name];
      }
      current = current.parent;
    }
    return null;
  }

  function collectPatternNames(pattern, out) {
    if (!pattern || !out) return;

    switch (pattern.type) {
      case "Identifier":
        out.push(pattern.name);
        return;
      case "ObjectPattern":
        for (var i = 0; i < (pattern.properties || []).length; i++) {
          var prop = pattern.properties[i];
          if (!prop) continue;
          if (prop.type === "Property") {
            collectPatternNames(prop.value, out);
          } else if (prop.type === "RestElement") {
            collectPatternNames(prop.argument, out);
          }
        }
        return;
      case "ArrayPattern":
        for (var j = 0; j < (pattern.elements || []).length; j++) {
          if (pattern.elements[j]) {
            collectPatternNames(pattern.elements[j], out);
          }
        }
        return;
      case "AssignmentPattern":
        collectPatternNames(pattern.left, out);
        return;
      case "RestElement":
        collectPatternNames(pattern.argument, out);
        return;
    }
  }

  function addPatternBindings(scope, pattern, info) {
    var names = [];
    collectPatternNames(pattern, names);

    for (var i = 0; i < names.length; i++) {
      addBinding(scope, names[i], info);
    }
  }

  function collectHoistedBindings(root, functionScope, options) {
    var body = root && Array.isArray(root.body) ? root.body : [];
    var functionInfo =
      (options && options.functionBindingInfo) || {
        callable: true,
        type: "function",
      };

    for (var i = 0; i < body.length; i++) {
      var statement = body[i];
      if (
        statement &&
        statement.type === "FunctionDeclaration" &&
        statement.id &&
        statement.id.name
      ) {
        addBinding(functionScope, statement.id.name, functionInfo);
      }
    }

    walkVarDeclarations(root);

    function walkVarDeclarations(node) {
      if (!node || typeof node !== "object") return;

      if (
        node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression"
      ) {
        return;
      }

      if (node.type === "VariableDeclaration" && node.kind === "var") {
        for (var i = 0; i < (node.declarations || []).length; i++) {
          var decl = node.declarations[i];
          addPatternBindings(
            functionScope,
            decl && decl.id,
            createBindingInfoFromNode(decl && decl.init, functionScope, options),
          );
        }
      }

      forEachChild(node, walkVarDeclarations);
    }
  }

  function collectLexicalBindings(statements, scope, options) {
    if (!Array.isArray(statements) || !scope) return;

    var functionInfo =
      (options && options.functionBindingInfo) || {
        callable: true,
        type: "function",
      };
    var classInfo =
      (options && options.classBindingInfo) || {
        callable: false,
        type: "function",
      };

    for (var i = 0; i < statements.length; i++) {
      var node = statements[i];
      if (!node) continue;

      if (node.type === "VariableDeclaration") {
        for (var j = 0; j < (node.declarations || []).length; j++) {
          var decl = node.declarations[j];
          addPatternBindings(
            scope,
            decl && decl.id,
            createBindingInfoFromNode(decl && decl.init, scope, options),
          );
        }
        continue;
      }

      if (node.type === "ClassDeclaration" && node.id && node.id.name) {
        addBinding(scope, node.id.name, classInfo);
        continue;
      }

      if (node.type === "FunctionDeclaration" && node.id && node.id.name) {
        addBinding(scope, node.id.name, functionInfo);
      }
    }
  }

  function createLoopScope(parentScope, loopInit, options) {
    var loopScope = createScope(parentScope);

    if (
      loopInit &&
      loopInit.type === "VariableDeclaration" &&
      loopInit.kind !== "var"
    ) {
      for (var i = 0; i < (loopInit.declarations || []).length; i++) {
        var decl = loopInit.declarations[i];
        addPatternBindings(
          loopScope,
          decl && decl.id,
          createBindingInfoFromNode(decl && decl.init, loopScope, options),
        );
      }
    }

    return loopScope;
  }

  function collectLexicalBindingsFromCases(cases, scope, options) {
    if (!Array.isArray(cases) || !scope) return;

    for (var i = 0; i < cases.length; i++) {
      var switchCase = cases[i];
      if (!switchCase) continue;
      collectLexicalBindings(switchCase.consequent || [], scope, options);
    }
  }

  function createBindingInfoFromNode(init, scope, options) {
    if (options && typeof options.getBindingInfo === "function") {
      return options.getBindingInfo(
        init,
        scope || createScope(null),
        (options && options.globals) || Object.create(null),
      );
    }

    if (window.compilerAst.isFunctionLike(init)) {
      return {
        callable: true,
        type: "function",
      };
    }

    return null;
  }

  function isReferenceIdentifier(node) {
    if (!node || node.type !== "Identifier") return false;
    var parent = node.parent;
    if (!parent) return true;

    if (isBindingIdentifier(node)) {
      return false;
    }

    if (
      parent.type === "MemberExpression" &&
      parent.property === node &&
      !parent.computed
    ) {
      return false;
    }

    if (parent.type === "Property") {
      var grandParent = parent.parent;
      if (grandParent && grandParent.type === "ObjectPattern") {
        return false;
      }
      if (parent.key === node && !parent.computed && !parent.shorthand) {
        return false;
      }
    }

    if (parent.type === "MethodDefinition" && parent.key === node && !parent.computed) {
      return false;
    }

    if (
      (parent.type === "LabeledStatement" && parent.label === node) ||
      ((parent.type === "BreakStatement" || parent.type === "ContinueStatement") &&
        parent.label === node)
    ) {
      return false;
    }

    if (
      parent.type === "UnaryExpression" &&
      parent.operator === "typeof" &&
      parent.argument === node
    ) {
      return false;
    }

    if (
      (parent.type === "CallExpression" || parent.type === "NewExpression") &&
      parent.callee === node
    ) {
      return false;
    }

    return true;
  }

  function isBindingIdentifier(node) {
    if (!node || node.type !== "Identifier") return false;

    var parent = node.parent;
    if (!parent) return false;

    if (parent.type === "VariableDeclarator" && isWithin(node, parent.id)) {
      return true;
    }

    if (
      (parent.type === "FunctionDeclaration" ||
        parent.type === "FunctionExpression" ||
        parent.type === "ArrowFunctionExpression") &&
      (parent.id === node || isFunctionParameterIdentifier(node, parent))
    ) {
      return true;
    }

    if (
      (parent.type === "ClassDeclaration" || parent.type === "ClassExpression") &&
      parent.id === node
    ) {
      return true;
    }

    if (parent.type === "CatchClause" && isWithin(node, parent.param)) {
      return true;
    }

    if (parent.type === "ArrayPattern" || parent.type === "ObjectPattern") {
      return true;
    }

    if (
      parent.type === "RestElement" &&
      isWithin(node, parent.argument) &&
      isPatternContext(parent.parent)
    ) {
      return true;
    }

    if (
      parent.type === "AssignmentPattern" &&
      isWithin(node, parent.left) &&
      isPatternContext(parent.parent)
    ) {
      return true;
    }

    if (parent.type === "Property") {
      var grandParent = parent.parent;
      if (grandParent && grandParent.type === "ObjectPattern") {
        if (isWithin(node, parent.value)) {
          return true;
        }
        if (parent.shorthand && parent.key === node) {
          return true;
        }
      }
    }

    return false;
  }

  function isFunctionParameterIdentifier(node, fnNode) {
    var params = fnNode && fnNode.params ? fnNode.params : [];
    for (var i = 0; i < params.length; i++) {
      if (isWithin(node, params[i])) {
        return true;
      }
    }
    return false;
  }

  function isPatternContext(node) {
    if (!node) return false;

    return (
      node.type === "ArrayPattern" ||
      node.type === "ObjectPattern" ||
      node.type === "RestElement" ||
      node.type === "AssignmentPattern" ||
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression" ||
      node.type === "CatchClause" ||
      node.type === "VariableDeclarator"
    );
  }

  function isWithin(node, root) {
    if (!node || !root) return false;

    var current = node;
    while (current) {
      if (current === root) {
        return true;
      }
      current = current.parent;
    }

    return false;
  }

  function forEachChild(node, visitor) {
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
            visitor(child[i]);
          }
        }
      } else if (typeof child === "object" && child.type) {
        visitor(child);
      }
    }
  }

  return {
    addBinding: addBinding,
    addPatternBindings: addPatternBindings,
    buildAllowedGlobals: buildAllowedGlobals,
    buildGlobalBindings: buildGlobalBindings,
    collectHoistedBindings: collectHoistedBindings,
    collectLexicalBindings: collectLexicalBindings,
    collectLexicalBindingsFromCases: collectLexicalBindingsFromCases,
    collectPatternNames: collectPatternNames,
    createLoopScope: createLoopScope,
    createScope: createScope,
    forEachChild: forEachChild,
    isBindingIdentifier: isBindingIdentifier,
    isReferenceIdentifier: isReferenceIdentifier,
    resolveBinding: resolveBinding,
  };
})();
