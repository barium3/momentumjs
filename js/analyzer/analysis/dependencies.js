// Static dependency analysis over user code.

var functionRegistry;
var _momentumFunctionMappings = null;
var _categoryInfo = null;
var _shapeTypeMap = null;
var _tableInstanceMethods = null;

function initDependencyAnalyzer(registry) {
  functionRegistry = registry;
  _buildAnalyzerCaches();
}

function _buildAnalyzerCaches() {
  if (!functionRegistry) {
    return;
  }

  try {
    if (typeof buildCategoryMappings === "function") {
      _momentumFunctionMappings = {
        shapes: buildCategoryMappings("shapes", ["transform", "color"]),
        transforms: buildCategoryMappings("transforms", ["transform"]),
        colors: buildCategoryMappings("colors", ["color"]),
        typography: buildCategoryMappings("typography", ["transform", "color"]),
        math: buildCategoryMappings("math", ["math"]),
        tables: buildCategoryMappings("tables", []),
      };
    } else {
      _momentumFunctionMappings = null;
    }
  } catch (e) {
    _momentumFunctionMappings = null;
  }

  try {
    if (typeof getShapeTypeMap === "function") {
      _shapeTypeMap = getShapeTypeMap(null);
    } else {
      _shapeTypeMap = null;
    }
  } catch (e2) {
    _shapeTypeMap = null;
  }

  _categoryInfo = {};
  var categories = [
    "math",
    "environment",
    "colors",
    "controllers",
    "typography",
    "images",
    "tables",
  ];

  categories.forEach(function (category) {
    var data = functionRegistry[category];
    if (!data) {
      return;
    }

    var info = {
      functions: {},
      constants: {},
      variables: {},
      namespaces: {},
    };

    for (var name in data) {
      if (!data.hasOwnProperty(name)) continue;
      var item = data[name] || {};
      if (item.type === "constant") {
        info.constants[name] = true;
      } else if (item.type === "variable") {
        info.variables[name] = true;
      } else if (item.type === "namespace") {
        info.namespaces[name] = true;
      } else {
        info.functions[name] = true;
      }
    }

    _categoryInfo[category] = info;
  });

  try {
    if (
      functionRegistry &&
      typeof functionRegistry.getTableInstanceMethods === "function"
    ) {
      _tableInstanceMethods = functionRegistry.getTableInstanceMethods();
    } else {
      _tableInstanceMethods = null;
    }
  } catch (e3) {
    _tableInstanceMethods = null;
  }
}

function analyzeDependenciesAST(code) {
  if (!functionRegistry) {
    throw new Error(
      "[dependencyAnalyzer] functionRegistry not initialized. Call initDependencyAnalyzer first.",
    );
  }

  if (!_categoryInfo) {
    _buildAnalyzerCaches();
  }

  var shapeRequires = {};
  if (functionRegistry.shapes) {
    for (var name in functionRegistry.shapes) {
      if (functionRegistry.shapes.hasOwnProperty(name)) {
        var info = functionRegistry.shapes[name];
        var baseType = info.baseType || name;
        if (!shapeRequires.hasOwnProperty(baseType)) {
          shapeRequires[baseType] = false;
        }
      }
    }
  }

  var dependencies = {
    shapes: {},
    transforms: {},
    colors: {},
    typography: {},
    math: {},
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

  if (!code || !code.trim()) {
    return dependencies;
  }

  var ast;
  try {
    ast = acorn.parse(code, { ecmaVersion: 2020, sourceType: "script" });
  } catch (e) {
    if (typeof console !== "undefined" && console.error) {
      console.error("[dependencyAnalyzer] AST 解析失败:", e);
    }
    return dependencies;
  }

  addAstParentLinks(ast, null);

  var shapeNames = functionRegistry.shapes
    ? Object.keys(functionRegistry.shapes)
    : [];
  var transformNames =
    typeof getTransformFunctionNames === "function"
      ? getTransformFunctionNames()
      : functionRegistry.transforms
        ? Object.keys(functionRegistry.transforms)
        : [];
  var colorNames =
    typeof getColorFunctionNames === "function"
      ? getColorFunctionNames()
      : functionRegistry.colors
        ? Object.keys(functionRegistry.colors)
        : [];

  var tableVarTypes = {};
  walkAst(ast, function (node) {
    switch (node.type) {
      case "VariableDeclarator":
        _handleVariableDeclarator(node, tableVarTypes);
        break;
      case "AssignmentExpression":
        _handleAssignmentExpression(node, tableVarTypes);
        break;
      case "CallExpression":
        _handleCallExpression(
          node,
          dependencies,
          shapeNames,
          transformNames,
          colorNames,
          tableVarTypes,
        );
        break;
      case "NewExpression":
        _handleNewExpression(node, dependencies);
        break;
      case "Identifier":
        _handleIdentifier(node, dependencies);
        break;
      case "MemberExpression":
        _handleMemberExpression(node, dependencies);
        break;
      default:
        break;
    }
  });

  return dependencies;
}

function _markFunctionDependency(category, funcName, dependencies) {
  if (!dependencies[category]) {
    dependencies[category] = {};
  }
  dependencies[category][funcName] = true;

  if (
    _momentumFunctionMappings &&
    _momentumFunctionMappings[category] &&
    _momentumFunctionMappings[category][funcName]
  ) {
    var info = _momentumFunctionMappings[category][funcName];
    var deps = info.deps || [];
    for (var i = 0; i < deps.length; i++) {
      var dep = deps[i];
      if (dependencies.requires.hasOwnProperty(dep)) {
        dependencies.requires[dep] = true;
      }
    }
  }

  if (category === "math") {
    dependencies.requires.math = true;
  }
}

function _handleCallExpression(
  node,
  dependencies,
  shapeNames,
  transformNames,
  colorNames,
  tableVarTypes,
) {
  var funcName = getAstCalleeName(node.callee);
  if (!funcName) return;

  if (_handleTableInstanceCall(node, dependencies, tableVarTypes)) {
    return;
  }

  if (shapeNames.indexOf(funcName) !== -1) {
    _markFunctionDependency("shapes", funcName, dependencies);

    if (dependencies.requires.shape && functionRegistry.shapes) {
      var info = functionRegistry.shapes[funcName] || {};
      var baseType =
        (info && info.baseType) ||
        (_shapeTypeMap && _shapeTypeMap[funcName]) ||
        funcName;
      if (dependencies.requires.shape.hasOwnProperty(baseType)) {
        dependencies.requires.shape[baseType] = true;
      }
    }
    return;
  }

  if (typeof getBuilderInfo === "function") {
    var builderInfo = getBuilderInfo(funcName);
    if (builderInfo && builderInfo.baseType) {
      _markFunctionDependency("shapes", builderInfo.baseType, dependencies);
      var baseType2 = builderInfo.baseType;
      if (
        dependencies.requires.shape &&
        dependencies.requires.shape.hasOwnProperty(baseType2)
      ) {
        dependencies.requires.shape[baseType2] = true;
      }
      return;
    }
  }

  if (transformNames.indexOf(funcName) !== -1) {
    _markFunctionDependency("transforms", funcName, dependencies);
    return;
  }

  if (colorNames.indexOf(funcName) !== -1) {
    _markFunctionDependency("colors", funcName, dependencies);
    return;
  }

  if (_categoryInfo) {
    for (var cat in _categoryInfo) {
      if (!_categoryInfo.hasOwnProperty(cat)) continue;
      var info = _categoryInfo[cat];
      if (info && info.functions && info.functions[funcName]) {
        if (!dependencies[cat]) {
          dependencies[cat] = {};
        }
        dependencies[cat][funcName] = true;
        if (cat === "math") {
          dependencies.requires.math = true;
        }
        return;
      }
    }
  }
}

function _getTableExprType(node, tableVarTypes) {
  if (!node) return null;

  if (node.type === "Identifier") {
    return tableVarTypes && tableVarTypes[node.name]
      ? tableVarTypes[node.name]
      : null;
  }

  if (node.type === "CallExpression") {
    var calleeName = getAstCalleeName(node.callee);
    if (calleeName === "loadTable") return "Table";

    if (
      node.callee &&
      node.callee.type === "MemberExpression" &&
      node.callee.property &&
      node.callee.property.type === "Identifier"
    ) {
      var methodName = node.callee.property.name;
      var receiverType = _getTableExprType(node.callee.object, tableVarTypes);
      var methodInfos =
        _tableInstanceMethods && _tableInstanceMethods[methodName]
          ? _tableInstanceMethods[methodName]
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

function _handleVariableDeclarator(node, tableVarTypes) {
  if (!node || !node.id || node.id.type !== "Identifier" || !node.init) return;
  var inferredType = _getTableExprType(node.init, tableVarTypes);
  if (inferredType) {
    tableVarTypes[node.id.name] = inferredType;
  }
}

function _handleAssignmentExpression(node, tableVarTypes) {
  if (!node || !node.left || node.left.type !== "Identifier" || !node.right)
    return;
  var inferredType = _getTableExprType(node.right, tableVarTypes);
  if (inferredType) {
    tableVarTypes[node.left.name] = inferredType;
  }
}

function _handleTableInstanceCall(node, dependencies, tableVarTypes) {
  if (
    !_tableInstanceMethods ||
    !node ||
    !node.callee ||
    node.callee.type !== "MemberExpression" ||
    !node.callee.property ||
    node.callee.property.type !== "Identifier"
  ) {
    return false;
  }

  var methodName = node.callee.property.name;
  var methodInfos = _tableInstanceMethods[methodName];
  if (!methodInfos || methodInfos.length === 0) return false;

  var receiverType = _getTableExprType(node.callee.object, tableVarTypes);
  if (!receiverType) return false;

  for (var i = 0; i < methodInfos.length; i++) {
    var info = methodInfos[i];
    if (info.receiver !== receiverType) continue;
    _markFunctionDependency("tables", methodName, dependencies);
    return true;
  }

  return false;
}

function _handleNewExpression(node, dependencies) {
  if (!node.callee) return;

  if (
    node.callee.type === "MemberExpression" &&
    node.callee.object &&
    node.callee.object.type === "Identifier"
  ) {
    var objName = node.callee.object.name;
    _markNamespaceIfNeeded(objName, dependencies);
  }
}

function _handleIdentifier(node, dependencies) {
  if (!_categoryInfo) return;
  var name = node.name;
  if (!name) return;

  var parent = node.parent;
  if (!parent) return;

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

  for (var cat in _categoryInfo) {
    if (!_categoryInfo.hasOwnProperty(cat)) continue;
    var info = _categoryInfo[cat];
    if (!info) continue;

    if (info.constants && info.constants[name]) {
      if (!dependencies[cat]) dependencies[cat] = {};
      dependencies[cat][name] = true;
      if (cat === "math") {
        dependencies.requires.math = true;
      }
      return;
    }

    if (info.variables && info.variables[name]) {
      if (!dependencies[cat]) dependencies[cat] = {};
      dependencies[cat][name] = true;
      if (cat === "math") {
        dependencies.requires.math = true;
      }
      return;
    }
  }
}

function _handleMemberExpression(node, dependencies) {
  if (!node.object) return;

  var root = node.object;
  while (root && root.type === "MemberExpression") {
    root = root.object;
  }
  if (!root || root.type !== "Identifier") return;

  var objName = root.name;
  _markNamespaceIfNeeded(objName, dependencies);
}

function _markNamespaceIfNeeded(name, dependencies) {
  if (!_categoryInfo) return;

  for (var cat in _categoryInfo) {
    if (!_categoryInfo.hasOwnProperty(cat)) continue;
    var info = _categoryInfo[cat];
    if (info && info.namespaces && info.namespaces[name]) {
      if (!dependencies[cat]) dependencies[cat] = {};
      dependencies[cat][name] = true;
      if (cat === "math") {
        dependencies.requires.math = true;
      }
      return;
    }
  }
}
