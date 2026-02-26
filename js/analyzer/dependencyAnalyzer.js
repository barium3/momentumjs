/**
 * 依赖分析器
 * 分析代码中使用的函数、常量和变量
 */

// 需要从外部获取 functionRegistry
var functionRegistry;
var _momentumFunctionMappings = null;
var _categoryInfo = null;
var _shapeTypeMap = null;

/**
 * 初始化 dependencyAnalyzer（由 Runtime 调用）
 */
function initDependencyAnalyzer(registry) {
  functionRegistry = registry;
  _buildAnalyzerCaches();
}

/**
 * 构建内部缓存：函数映射、类别信息等
 */
function _buildAnalyzerCaches() {
  if (!functionRegistry) {
    return;
  }

  // Momentum 函数映射：用于确定使用某个函数时需要开启哪些内部依赖
  try {
    if (typeof buildCategoryMappings === "function") {
      _momentumFunctionMappings = {
        shapes: buildCategoryMappings("shapes", ["transform", "color"]),
        transforms: buildCategoryMappings("transforms", ["transform"]),
        colors: buildCategoryMappings("colors", ["color"]),
        math: buildCategoryMappings("math", ["math"]),
      };
    } else {
      _momentumFunctionMappings = null;
    }
  } catch (e) {
    // 在极端情况下（registry 尚未完全就绪）允许静默失败，后续分析会退化为只标记当前类别
    _momentumFunctionMappings = null;
  }

  // 形状基础类型映射（circle -> ellipse, square -> rect 等）
  try {
    if (typeof getShapeTypeMap === "function") {
      _shapeTypeMap = getShapeTypeMap(null);
    } else {
      _shapeTypeMap = null;
    }
  } catch (e2) {
    _shapeTypeMap = null;
  }

  // math / environment / colors / controllers 的符号信息
  _categoryInfo = {};
  var categories = ["math", "environment", "colors", "controllers"];

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
        // 默认视为函数（包括环境函数、控制器等）
        info.functions[name] = true;
        }
      }

    _categoryInfo[category] = info;
  });
}

/**
 * 使用 AST 分析整段代码的依赖
 * @param {string} code - 用户代码
 * @returns {Object} 依赖对象（与原 Runtime.analyzeDependencies 返回结构兼容）
 */
function analyzeDependenciesAST(code) {
  if (!functionRegistry) {
    throw new Error(
      "[dependencyAnalyzer] functionRegistry not initialized. Call initDependencyAnalyzer first.",
      );
  }

  if (!_categoryInfo) {
    _buildAnalyzerCaches();
  }

  // 初始化 shapeRequires 结构，保持与旧实现兼容
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
    math: {},
    environment: {},
    controllers: {},
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

  // 使用 Acorn 解析代码
  var ast;
  try {
    ast = acorn.parse(code, { ecmaVersion: 2020, sourceType: "script" });
  } catch (e) {
    // 解析失败时返回空依赖，避免直接抛错影响上层逻辑
    if (typeof console !== "undefined" && console.error) {
      console.error("[dependencyAnalyzer] AST 解析失败:", e);
        }
    return dependencies;
    }

  // 补充 parent 指针，便于判断标识符的使用场景
  _addParentLinks(ast, null);

  // 预先构建一些快速访问的集合
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

  // 遍历 AST，收集依赖
  _walkAST(ast, function (node) {
    switch (node.type) {
      case "CallExpression":
        _handleCallExpression(
          node,
          dependencies,
          shapeNames,
          transformNames,
          colorNames,
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

/**
 * 为 AST 节点添加 parent 指针
 */
function _addParentLinks(node, parent) {
  if (!node || typeof node !== "object") return;
  node.parent = parent || null;

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
    var child = node[key];
    if (Array.isArray(child)) {
      for (var i = 0; i < child.length; i++) {
        if (child[i] && typeof child[i] === "object") {
          _addParentLinks(child[i], node);
        }
      }
    } else if (child && typeof child === "object") {
      _addParentLinks(child, node);
    }
  }
}

/**
 * 通用 AST 遍历
 * @param {Object} node
 * @param {Function} callback - 回调，如果返回 true 则中止遍历
 */
function _walkAST(node, callback) {
  if (!node || typeof node !== "object") return;

  if (callback(node) === true) {
    return;
  }

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
    var child = node[key];
    if (Array.isArray(child)) {
      for (var i = 0; i < child.length; i++) {
        var childNode = child[i];
        if (childNode && typeof childNode === "object") {
          _walkAST(childNode, callback);
        }
      }
    } else if (child && typeof child === "object") {
      _walkAST(child, callback);
    }
  }
}

/**
 * 从 callee 中提取函数名（Identifier 或 MemberExpression.property）
 */
function _getCalleeName(callee) {
  if (!callee) return null;
  if (callee.type === "Identifier") {
    return callee.name;
  }
  if (callee.type === "MemberExpression") {
    if (callee.property && !callee.computed && callee.property.type === "Identifier") {
      return callee.property.name;
    }
  }
  return null;
}

/**
 * 在使用某个函数时，记录依赖并根据 momentum 映射开启 requires 标记
 */
function _markFunctionDependency(category, funcName, dependencies) {
        if (!dependencies[category]) {
          dependencies[category] = {};
        }
  dependencies[category][funcName] = true;

  if (_momentumFunctionMappings &&
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

  // math 额外标记（保持与旧实现兼容）
        if (category === "math") {
          dependencies.requires.math = true;
        }
      }

/**
 * 处理函数调用（CallExpression）
 */
function _handleCallExpression(
  node,
  dependencies,
  shapeNames,
  transformNames,
  colorNames,
) {
  var funcName = _getCalleeName(node.callee);
  if (!funcName) return;

  // 1. shape 函数（ellipse / rect / line / polygon 等）
  if (shapeNames.indexOf(funcName) !== -1) {
    _markFunctionDependency("shapes", funcName, dependencies);

    if (dependencies.requires.shape && functionRegistry.shapes) {
      var info = functionRegistry.shapes[funcName] || {};
      var baseType = (info && info.baseType) || (_shapeTypeMap && _shapeTypeMap[funcName]) || funcName;
      if (dependencies.requires.shape.hasOwnProperty(baseType)) {
        dependencies.requires.shape[baseType] = true;
      }
    }
    return;
  }

  // 2. 形状构建器函数（beginShape / vertex / endShape / beginContour / endContour 等）
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

  // 3. 变换函数（translate / rotate / scale / push / pop 等）
  if (transformNames.indexOf(funcName) !== -1) {
    _markFunctionDependency("transforms", funcName, dependencies);
    return;
  }

  // 4. 颜色函数（fill / stroke / background / color 等）
  if (colorNames.indexOf(funcName) !== -1) {
    _markFunctionDependency("colors", funcName, dependencies);
    return;
  }

  // 5. math / environment / colors / controllers 中声明的函数
  if (_categoryInfo) {
    // 优先级：controllers > math > environment > colors
    // 这样当同名符号同时存在于多个类别（例如 environment 与 controllers）时，
    // 会优先归类到更具体的 controllers，而不是较泛的 environment
    var cats = ["controllers", "math", "environment", "colors"];
    for (var i = 0; i < cats.length; i++) {
      var cat = cats[i];
      var info = _categoryInfo[cat];
      if (info && info.functions && info.functions[funcName]) {
        if (!dependencies[cat]) {
          dependencies[cat] = {};
        }
        dependencies[cat][funcName] = true;
        if (cat === "math") {
          dependencies.requires.math = true;
        }
        break;
      }
    }
      }
    }

/**
 * 处理 new 表达式（主要用于命名空间，如 new p5.Vector(...)）
 */
function _handleNewExpression(node, dependencies) {
  if (!node.callee) return;

  // 例如：new p5.Vector(...)
  if (
    node.callee.type === "MemberExpression" &&
    node.callee.object &&
    node.callee.object.type === "Identifier"
  ) {
    var objName = node.callee.object.name;
    _markNamespaceIfNeeded(objName, dependencies);
  }
}

/**
 * 处理标识符使用（常量 / 变量）
 */
function _handleIdentifier(node, dependencies) {
  if (!_categoryInfo) return;
  var name = node.name;
  if (!name) return;

  var parent = node.parent;
  if (!parent) return;

  // 排除声明位置：函数名、变量名、参数名、属性 key 等
  if (
    (parent.type === "VariableDeclarator" && parent.id === node) ||
    (parent.type === "FunctionDeclaration" && parent.id === node) ||
    (parent.type === "FunctionExpression" && parent.id === node) ||
    (parent.type === "ClassDeclaration" && parent.id === node) ||
    (parent.type === "ClassExpression" && parent.id === node) ||
    (parent.type === "CatchClause" && parent.param === node) ||
    (parent.type === "RestElement" && parent.argument === node) ||
    (parent.type === "Property" && parent.key === node && !parent.computed) ||
    (parent.type === "MemberExpression" && parent.property === node && !parent.computed)
  ) {
    return;
  }

  // 排除函数调用场景（callee 在 CallExpression 中会由 _handleCallExpression 处理）
  if (
    (parent.type === "CallExpression" || parent.type === "NewExpression") &&
    parent.callee === node
  ) {
    return;
  }

  // 处理 math / environment / colors / controllers 中声明的常量和变量
  // 同样使用统一的优先级顺序，确保与函数归类一致
  var cats = ["controllers", "math", "environment", "colors"];
  for (var i = 0; i < cats.length; i++) {
    var cat = cats[i];
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

/**
 * 处理成员表达式（主要用于命名空间，如 p5.Vector.fromAngle()）
 */
function _handleMemberExpression(node, dependencies) {
  if (!node.object) return;

  // 只关心根对象为 Identifier 的情况，例如 p5.Vector / p5.foo.bar
  var root = node.object;
  while (root && root.type === "MemberExpression") {
    root = root.object;
  }
  if (!root || root.type !== "Identifier") return;

  var objName = root.name;
  _markNamespaceIfNeeded(objName, dependencies);
}

/**
 * 如果名称是某个命名空间（当前主要是 math.p5），则记录依赖
 */
function _markNamespaceIfNeeded(name, dependencies) {
  if (!_categoryInfo) return;

  // 命名空间优先级与函数/变量保持一致
  var cats = ["controllers", "math", "environment", "colors"];
  for (var i = 0; i < cats.length; i++) {
    var cat = cats[i];
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

// 保持向后兼容：旧代码如果仍然调用 parseConstantsAndVariables，则直接转发到 AST 分析
function parseConstantsAndVariables(code, dependencies) {
  var fullDeps = analyzeDependenciesAST(code);
  // 将 AST 结果合并到传入的 dependencies 对象中（仅限非 shapes/transforms）
  if (!dependencies) return fullDeps;

  // 合并类别时也遵循相同的顺序（虽然当前不会产生冲突，但保持一致性）
  var categories = ["controllers", "math", "environment", "colors"];
  for (var i = 0; i < categories.length; i++) {
    var cat = categories[i];
    if (!fullDeps[cat]) continue;
    if (!dependencies[cat]) dependencies[cat] = {};
    for (var key in fullDeps[cat]) {
      if (fullDeps[cat].hasOwnProperty(key)) {
        dependencies[cat][key] = fullDeps[cat][key];
      }
    }
  }

  if (fullDeps.requires && fullDeps.requires.math) {
    if (!dependencies.requires) dependencies.requires = {};
    dependencies.requires.math = true;
}

  return dependencies;
}

