/**
 * 依赖分析器
 * 分析代码中使用的函数、常量和变量
 */

// 需要从外部获取 functionRegistry
var functionRegistry;

/**
 * 初始化 dependencyAnalyzer（由 Runtime 调用）
 */
function initDependencyAnalyzer(registry) {
  functionRegistry = registry;
}

/**
 * 统一解析代码中的常量和变量依赖（适用于所有类别）
 * @param {string} code - 用户代码
 * @param {Object} dependencies - 依赖对象（会被修改）
 */
function parseConstantsAndVariables(code, dependencies) {
  // 支持的类别：math, environment, colors
  var categories = ["math", "environment", "colors"];

  categories.forEach(function (category) {
    if (!functionRegistry[category]) {
      return;
    }

    var categoryData = functionRegistry[category];
    var constants = [];
    var variables = [];
    var functions = [];

    // 分离常量、变量和函数
    for (var name in categoryData) {
      if (categoryData.hasOwnProperty(name)) {
        var item = categoryData[name];
        if (item.type === "constant") {
          constants.push(name);
        } else if (item.type === "variable") {
          variables.push(name);
        } else {
          functions.push(name);
        }
      }
    }

    // 匹配函数调用
    if (functions.length > 0) {
      var funcPattern = new RegExp(
        "\\b(" + functions.join("|") + ")\\s*\\(",
        "g",
      );
      var match;
      while ((match = funcPattern.exec(code)) !== null) {
        var funcName = match[1];
        if (!dependencies[category]) {
          dependencies[category] = {};
        }
        dependencies[category][funcName] = true;
        if (category === "math") {
          dependencies.requires.math = true;
        }
      }
    }

    // 匹配命名空间的使用（如 p5.Vector.fromAngle()、new p5.Vector()）
    var namespaces = [];
    for (var name in categoryData) {
      if (categoryData.hasOwnProperty(name)) {
        var item = categoryData[name];
        if (item.type === "namespace") {
          namespaces.push(name);
        }
      }
    }
    if (namespaces.length > 0) {
      // 匹配 namespace.xxx 的使用（如 p5.Vector）
      var nsPattern = new RegExp(
        "\\b(" + namespaces.join("|") + ")\\s*\\.",
        "g",
      );
      var match;
      while ((match = nsPattern.exec(code)) !== null) {
        var nsName = match[1];
        if (!dependencies[category]) {
          dependencies[category] = {};
        }
        dependencies[category][nsName] = true;
        if (category === "math") {
          dependencies.requires.math = true;
        }
      }
    }

    // 匹配常量使用
    if (constants.length > 0) {
      var constPattern = new RegExp(
        "\\b(" + constants.join("|") + ")\\b(?!\\w)",
        "g",
      );
      var match;
      while ((match = constPattern.exec(code)) !== null) {
        var constName = match[1];
        if (!dependencies[category]) {
          dependencies[category] = {};
        }
        dependencies[category][constName] = true;
        if (category === "math") {
          dependencies.requires.math = true;
        }
      }
    }

    // 匹配变量使用
    if (variables.length > 0) {
      var varPattern = new RegExp(
        "\\b(" + variables.join("|") + ")\\b(?!\\w)",
        "g",
      );
      var match;
      while ((match = varPattern.exec(code)) !== null) {
        var varName = match[1];
        if (!dependencies[category]) {
          dependencies[category] = {};
        }
        dependencies[category][varName] = true;
      }
    }
  });
}
