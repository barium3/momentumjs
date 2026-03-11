window.compilerDependencyAnalysisPass = (function () {
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
    var shapeTypeMap = window.compilerSymbols.getShapeTypeMap();
    var categoryInfo = window.compilerSymbols.getCategoryInfo();
    var functionMappings = {
      shapes: window.compilerSymbols.buildCategoryMappings("shapes", [
        "transform",
        "color",
      ]),
      transforms: window.compilerSymbols.buildCategoryMappings("transforms", [
        "transform",
      ]),
      colors: window.compilerSymbols.buildCategoryMappings("colors", ["color"]),
      typography: window.compilerSymbols.buildCategoryMappings("typography", [
        "transform",
        "color",
      ]),
      math: window.compilerSymbols.buildCategoryMappings("math", ["math"]),
      data: window.compilerSymbols.buildCategoryMappings("data", []),
      tables: window.compilerSymbols.buildCategoryMappings("tables", []),
    };
    var tableInstanceMethods = window.compilerSymbols.getTableInstanceMethods();
    var registry = window.compilerSymbols.getRegistry();
    var shapeNames = window.compilerSymbols.getCategoryFunctionNames("shapes");
    var transformNames = window.compilerSymbols.getTransformFunctionNames();
    var colorNames = window.compilerSymbols.getColorFunctionNames();

    var shapeRequires = {};
    for (var shapeName in shapeTypeMap) {
      if (Object.prototype.hasOwnProperty.call(shapeTypeMap, shapeName)) {
        var baseType = shapeTypeMap[shapeName];
        if (!Object.prototype.hasOwnProperty.call(shapeRequires, baseType)) {
          shapeRequires[baseType] = false;
        }
      }
    }

    var dependencies = {
      shapes: {},
      transforms: {},
      colors: {},
      typography: {},
      math: {},
      data: {},
      environment: {},
      controllers: {},
      tables: {},
      requires: {
        transform: false,
        color: false,
        math: false,
        shape: shapeRequires,
      },
    };

    if (!program) {
      return dependencies;
    }

    var semantics = window.compilerSemantics;
    var globalScope = semantics.createScope(null);
    var bindingOptions = getBindingOptions(tableInstanceMethods);

    semantics.collectHoistedBindings(program, globalScope, bindingOptions);
    semantics.collectLexicalBindings(program.body, globalScope, bindingOptions);

    var options = {
      bindingOptions: bindingOptions,
      categoryInfo: categoryInfo,
      colorNames: colorNames,
      dependencies: dependencies,
      functionMappings: functionMappings,
      registry: registry,
      shapeNames: shapeNames,
      shapeTypeMap: shapeTypeMap,
      tableInstanceMethods: tableInstanceMethods,
      transformNames: transformNames,
    };

    visitProgram(program, globalScope, globalScope, options);

    return dependencies;
  }

  function getBindingOptions(tableInstanceMethods) {
    return {
      classBindingInfo: CLASS_BINDING_INFO,
      functionBindingInfo: FUNCTION_BINDING_INFO,
      getBindingInfo: function (init, scope) {
        return createBindingInfoFromNode(init, scope, tableInstanceMethods);
      },
      globals: Object.create(null),
    };
  }

  function visitProgram(program, scope, functionScope, options) {
    if (!program || !Array.isArray(program.body)) return;
    visitStatementList(program.body, scope, functionScope, options);
  }

  function visitStatementList(statements, scope, functionScope, options) {
    if (!Array.isArray(statements)) return;

    for (var i = 0; i < statements.length; i++) {
      visitNode(statements[i], scope, functionScope, options);
    }
  }

  function visitNode(node, scope, functionScope, options) {
    if (!node || typeof node !== "object") return;

    var semantics = window.compilerSemantics;

    switch (node.type) {
      case "Program":
        visitProgram(node, scope, functionScope, options);
        return;
      case "BlockStatement": {
        var blockScope = semantics.createScope(scope);
        semantics.collectLexicalBindings(
          node.body,
          blockScope,
          options.bindingOptions,
        );
        visitStatementList(node.body, blockScope, functionScope, options);
        return;
      }
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        visitFunctionNode(node, scope, options);
        return;
      case "CatchClause":
        visitCatchClause(node, scope, functionScope, options);
        return;
      case "ForStatement":
        visitForStatement(node, scope, functionScope, options);
        return;
      case "ForInStatement":
      case "ForOfStatement":
        visitForEachStatement(node, scope, functionScope, options);
        return;
      case "SwitchStatement":
        visitSwitchStatement(node, scope, functionScope, options);
        return;
      case "VariableDeclarator":
        handleVariableDeclarator(node, scope, options.tableInstanceMethods);
        visitDefaultChildren(node, scope, functionScope, options);
        return;
      case "AssignmentExpression":
        handleAssignmentExpression(node, scope, options.tableInstanceMethods);
        visitDefaultChildren(node, scope, functionScope, options);
        return;
      case "CallExpression":
        handleCallExpression(node, scope, options);
        visitDefaultChildren(node, scope, functionScope, options);
        return;
      case "NewExpression":
        handleNewExpression(node, options.dependencies, options.categoryInfo);
        visitDefaultChildren(node, scope, functionScope, options);
        return;
      case "Identifier":
        handleIdentifier(node, options.dependencies, options.categoryInfo);
        return;
      case "MemberExpression":
        handleMemberExpression(node, options.dependencies, options.categoryInfo);
        visitDefaultChildren(node, scope, functionScope, options);
        return;
      default:
        visitDefaultChildren(node, scope, functionScope, options);
    }
  }

  function visitDefaultChildren(node, scope, functionScope, options) {
    window.compilerSemantics.forEachChild(node, function (child) {
      visitNode(child, scope, functionScope, options);
    });
  }

  function visitFunctionNode(node, parentScope, options) {
    var semantics = window.compilerSemantics;
    var functionScope = semantics.createScope(parentScope);

    if (node.id && node.id.type === "Identifier") {
      semantics.addBinding(functionScope, node.id.name, FUNCTION_BINDING_INFO);
    }

    if (node.type !== "ArrowFunctionExpression") {
      semantics.addBinding(functionScope, "arguments", ARGUMENTS_BINDING_INFO);
    }

    for (var i = 0; i < (node.params || []).length; i++) {
      semantics.addPatternBindings(functionScope, node.params[i], UNKNOWN_BINDING_INFO);
    }

    if (node.body && node.body.type === "BlockStatement") {
      semantics.collectHoistedBindings(node.body, functionScope, options.bindingOptions);
      semantics.collectLexicalBindings(
        node.body.body,
        functionScope,
        options.bindingOptions,
      );
      visitStatementList(node.body.body, functionScope, functionScope, options);
      return;
    }

    visitNode(node.body, functionScope, functionScope, options);
  }

  function visitCatchClause(node, scope, functionScope, options) {
    var semantics = window.compilerSemantics;
    var catchScope = semantics.createScope(scope);
    semantics.addPatternBindings(catchScope, node.param, UNKNOWN_BINDING_INFO);

    if (node.body && node.body.type === "BlockStatement") {
      semantics.collectLexicalBindings(
        node.body.body,
        catchScope,
        options.bindingOptions,
      );
      visitStatementList(node.body.body, catchScope, functionScope, options);
      return;
    }

    visitNode(node.body, catchScope, functionScope, options);
  }

  function visitForStatement(node, scope, functionScope, options) {
    var loopScope = window.compilerSemantics.createLoopScope(
      scope,
      node.init,
      options.bindingOptions,
    );

    if (node.init) {
      visitNode(node.init, loopScope, functionScope, options);
    }
    if (node.test) {
      visitNode(node.test, loopScope, functionScope, options);
    }
    if (node.update) {
      visitNode(node.update, loopScope, functionScope, options);
    }
    if (node.body) {
      visitNode(node.body, loopScope, functionScope, options);
    }
  }

  function visitForEachStatement(node, scope, functionScope, options) {
    var loopScope = window.compilerSemantics.createLoopScope(
      scope,
      node.left,
      options.bindingOptions,
    );

    if (node.left) {
      visitNode(node.left, loopScope, functionScope, options);
    }
    if (node.right) {
      visitNode(node.right, loopScope, functionScope, options);
    }
    if (node.body) {
      visitNode(node.body, loopScope, functionScope, options);
    }
  }

  function visitSwitchStatement(node, scope, functionScope, options) {
    if (node.discriminant) {
      visitNode(node.discriminant, scope, functionScope, options);
    }

    var semantics = window.compilerSemantics;
    var switchScope = semantics.createScope(scope);
    semantics.collectLexicalBindingsFromCases(
      node.cases,
      switchScope,
      options.bindingOptions,
    );

    for (var i = 0; i < (node.cases || []).length; i++) {
      var switchCase = node.cases[i];
      if (!switchCase) continue;

      if (switchCase.test) {
        visitNode(switchCase.test, switchScope, functionScope, options);
      }

      visitStatementList(switchCase.consequent || [], switchScope, functionScope, options);
    }
  }

  function markFunctionDependency(category, funcName, dependencies, mappings) {
    if (!dependencies[category]) {
      dependencies[category] = {};
    }
    dependencies[category][funcName] = true;

    if (mappings && mappings[category] && mappings[category][funcName]) {
      var info = mappings[category][funcName];
      var deps = info.deps || [];
      for (var i = 0; i < deps.length; i++) {
        if (Object.prototype.hasOwnProperty.call(dependencies.requires, deps[i])) {
          dependencies.requires[deps[i]] = true;
        }
      }
    }

    if (category === "math") {
      dependencies.requires.math = true;
    }
  }

  function handleCallExpression(node, scope, options) {
    var funcName = window.compilerAst.getCalleeName(node.callee);
    if (!funcName) return;

    if (
      handleTableInstanceCall(
        node,
        scope,
        options.dependencies,
        options.tableInstanceMethods,
        options.functionMappings,
      )
    ) {
      return;
    }

    if (options.shapeNames.indexOf(funcName) !== -1) {
      markFunctionDependency(
        "shapes",
        funcName,
        options.dependencies,
        options.functionMappings,
      );

      var registryBaseType =
        options.registry &&
        options.registry.shapes &&
        options.registry.shapes[funcName]
          ? options.registry.shapes[funcName].baseType
          : null;
      var baseType = options.shapeTypeMap[funcName] || registryBaseType || funcName;

      if (
        options.dependencies.requires.shape &&
        Object.prototype.hasOwnProperty.call(options.dependencies.requires.shape, baseType)
      ) {
        options.dependencies.requires.shape[baseType] = true;
      }
      return;
    }

    var builderInfo = window.compilerSymbols.getBuilderInfo(funcName);
    if (builderInfo && builderInfo.baseType) {
      markFunctionDependency(
        "shapes",
        builderInfo.baseType,
        options.dependencies,
        options.functionMappings,
      );
      if (
        options.dependencies.requires.shape &&
        Object.prototype.hasOwnProperty.call(
          options.dependencies.requires.shape,
          builderInfo.baseType,
        )
      ) {
        options.dependencies.requires.shape[builderInfo.baseType] = true;
      }
      return;
    }

    if (options.transformNames.indexOf(funcName) !== -1) {
      markFunctionDependency(
        "transforms",
        funcName,
        options.dependencies,
        options.functionMappings,
      );
      return;
    }

    if (options.colorNames.indexOf(funcName) !== -1) {
      markFunctionDependency(
        "colors",
        funcName,
        options.dependencies,
        options.functionMappings,
      );
      return;
    }

    for (var cat in options.categoryInfo) {
      if (!Object.prototype.hasOwnProperty.call(options.categoryInfo, cat)) {
        continue;
      }
      var info = options.categoryInfo[cat];
      if (info && info.functions && info.functions[funcName]) {
        if (!options.dependencies[cat]) {
          options.dependencies[cat] = {};
        }
        options.dependencies[cat][funcName] = true;
        if (cat === "math") {
          options.dependencies.requires.math = true;
        }
        return;
      }
    }
  }

  function getTableExprType(node, scope, tableInstanceMethods) {
    if (!node) return null;

    if (node.type === "Identifier") {
      var binding = window.compilerSemantics.resolveBinding(scope, node.name);
      return binding && isKnownTableType(binding.type) ? binding.type : null;
    }

    if (node.type === "CallExpression") {
      var calleeName = window.compilerAst.getCalleeName(node.callee);
      if (calleeName === "loadTable") return "Table";

      if (
        node.callee &&
        node.callee.type === "MemberExpression" &&
        node.callee.property &&
        node.callee.property.type === "Identifier"
      ) {
        var methodName = node.callee.property.name;
        var receiverType = getTableExprType(
          node.callee.object,
          scope,
          tableInstanceMethods,
        );
        var methodInfos =
          tableInstanceMethods && tableInstanceMethods[methodName]
            ? tableInstanceMethods[methodName]
            : null;
        if (!methodInfos || !receiverType) return null;

        for (var i = 0; i < methodInfos.length; i++) {
          if (methodInfos[i].receiver === receiverType) {
            return methodInfos[i].returns || null;
          }
        }
      }
    }

    return null;
  }

  function isKnownTableType(typeName) {
    return typeName === "Table" || typeName === "TableRow";
  }

  function createBindingInfoFromNode(init, scope, tableInstanceMethods) {
    if (!init) {
      return UNKNOWN_BINDING_INFO;
    }

    if (window.compilerAst.isFunctionLike(init)) {
      return FUNCTION_BINDING_INFO;
    }

    var inferredType = getTableExprType(init, scope, tableInstanceMethods);
    if (!inferredType) {
      return UNKNOWN_BINDING_INFO;
    }

    return {
      callable: false,
      type: inferredType,
    };
  }

  function handleVariableDeclarator(node, scope, tableInstanceMethods) {
    if (!node || !node.id || node.id.type !== "Identifier") return;
    var binding = window.compilerSemantics.resolveBinding(scope, node.id.name);
    if (!binding) return;

    if (!node.init) {
      binding.type = "unknown";
      binding.callable = null;
      return;
    }

    var inferredType = getTableExprType(node.init, scope, tableInstanceMethods);
    binding.type = inferredType || "unknown";
    binding.callable = inferredType ? false : null;
  }

  function handleAssignmentExpression(node, scope, tableInstanceMethods) {
    if (!node || !node.left || node.left.type !== "Identifier" || !node.right) {
      return;
    }

    var binding = window.compilerSemantics.resolveBinding(scope, node.left.name);
    if (!binding) return;

    var inferredType = getTableExprType(node.right, scope, tableInstanceMethods);
    binding.type = inferredType || "unknown";
    binding.callable = inferredType ? false : null;
  }

  function handleTableInstanceCall(
    node,
    scope,
    dependencies,
    tableInstanceMethods,
    functionMappings,
  ) {
    if (
      !tableInstanceMethods ||
      !node ||
      !node.callee ||
      node.callee.type !== "MemberExpression" ||
      !node.callee.property ||
      node.callee.property.type !== "Identifier"
    ) {
      return false;
    }

    var methodName = node.callee.property.name;
    var methodInfos = tableInstanceMethods[methodName];
    if (!methodInfos || methodInfos.length === 0) return false;

    var receiverType = getTableExprType(
      node.callee.object,
      scope,
      tableInstanceMethods,
    );
    if (!receiverType) return false;

    for (var i = 0; i < methodInfos.length; i++) {
      if (methodInfos[i].receiver !== receiverType) continue;
      markFunctionDependency("tables", methodName, dependencies, functionMappings);
      return true;
    }

    return false;
  }

  function handleNewExpression(node, dependencies, categoryInfo) {
    if (
      !node ||
      !node.callee ||
      node.callee.type !== "MemberExpression" ||
      !node.callee.object ||
      node.callee.object.type !== "Identifier"
    ) {
      return;
    }

    markNamespaceIfNeeded(node.callee.object.name, dependencies, categoryInfo);
  }

  function handleIdentifier(node, dependencies, categoryInfo) {
    if (!categoryInfo || !node || !node.name || !node.parent) {
      return;
    }

    var parent = node.parent;
    if (
      (parent.type === "VariableDeclarator" && parent.id === node) ||
      (parent.type === "FunctionDeclaration" && parent.id === node) ||
      (parent.type === "FunctionExpression" && parent.id === node) ||
      (parent.type === "ClassDeclaration" && parent.id === node) ||
      (parent.type === "ClassExpression" && parent.id === node) ||
      (parent.type === "CatchClause" && parent.param === node) ||
      (parent.type === "RestElement" && parent.argument === node) ||
      (parent.type === "Property" && parent.key === node && !parent.computed) ||
      (parent.type === "MemberExpression" &&
        parent.property === node &&
        !parent.computed)
    ) {
      return;
    }

    if (
      (parent.type === "CallExpression" || parent.type === "NewExpression") &&
      parent.callee === node
    ) {
      return;
    }

    var name = node.name;
    for (var cat in categoryInfo) {
      if (!Object.prototype.hasOwnProperty.call(categoryInfo, cat)) continue;
      var info = categoryInfo[cat];
      if (!info) continue;

      if ((info.constants && info.constants[name]) || (info.variables && info.variables[name])) {
        if (!dependencies[cat]) {
          dependencies[cat] = {};
        }
        dependencies[cat][name] = true;
        if (cat === "math") {
          dependencies.requires.math = true;
        }
        return;
      }
    }
  }

  function handleMemberExpression(node, dependencies, categoryInfo) {
    if (!node || !node.object) return;

    var root = node.object;
    while (root && root.type === "MemberExpression") {
      root = root.object;
    }

    if (!root || root.type !== "Identifier") return;
    markNamespaceIfNeeded(root.name, dependencies, categoryInfo);
  }

  function markNamespaceIfNeeded(name, dependencies, categoryInfo) {
    if (!categoryInfo) return;

    for (var cat in categoryInfo) {
      if (!Object.prototype.hasOwnProperty.call(categoryInfo, cat)) continue;
      var info = categoryInfo[cat];
      if (info && info.namespaces && info.namespaces[name]) {
        if (!dependencies[cat]) {
          dependencies[cat] = {};
        }
        dependencies[cat][name] = true;
        if (cat === "math") {
          dependencies.requires.math = true;
        }
        return;
      }
    }
  }

  return {
    analyze: analyze,
  };
})();
