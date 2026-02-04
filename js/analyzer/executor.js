/**
 * 代码执行器
 * 处理 p5.js 代码的执行、变量暴露和函数调用
 */

// 需要从外部获取 functionRegistry
var functionRegistry;

/**
 * 初始化 executor（由 P5Runtime 调用）
 */
function initExecutor(registry) {
  functionRegistry = registry;
}

/**
 * 确保 p5.Vector 可用
 * @param {Object} p - p5 实例
 */
function ensureP5Vector(p) {
  // 方式1：从 p5 实例的构造函数获取 Vector（最可靠）
  if (p && p.constructor && p.constructor.Vector) {
    var P5Vector = p.constructor.Vector;
    window.createVector = function (x, y, z) {
      return new P5Vector(x, y, z);
    };
    // 确保 window.p5.Vector 也可用
    if (typeof window.p5 === "undefined") {
      window.p5 = p.constructor;
    }
    return;
  }
}

/**
 * 暴露环境变量到全局作用域
 * @param {Array<string>} variables - 变量名列表
 * @param {Object} p - p5 实例
 */
function exposeVariables(variables, p) {
  if (!p) {
    return;
  }

  // 确保 p5.Vector 可用（传入 p5 实例）
  ensureP5Vector(p);

  variables.forEach(function (varName) {
    if (window.hasOwnProperty(varName) && window[varName] !== undefined) {
      return;
    }

    // 从 p5 实例获取（包括原型链）
    if (varName in p && p[varName] !== undefined) {
      window[varName] = p[varName];
      return;
    }

    // 从 p5 全局对象获取
    if (typeof p5 !== "undefined") {
      if (
        p5.hasOwnProperty &&
        p5.hasOwnProperty(varName) &&
        p5[varName] !== undefined
      ) {
        window[varName] = p5[varName];
        return;
      }
      if (
        p5.prototype &&
        varName in p5.prototype &&
        p5.prototype[varName] !== undefined
      ) {
        window[varName] = p5.prototype[varName];
        return;
      }
    }

    // 从 Math 对象获取
    if (typeof Math !== "undefined" && Math.hasOwnProperty(varName)) {
      window[varName] = Math[varName];
      return;
    }
  });
}

/**
 * 清除用户定义的 p5 入口函数（setup、draw）
 * 必须在每次 eval 前调用，否则当新代码未定义 draw 时，会错误执行上一轮残留的 draw
 */
function clearUserEntryPoints() {
  if (typeof window.setup !== "undefined") delete window.setup;
  if (typeof window.draw !== "undefined") delete window.draw;
}

/**
 * 清理全局作用域中的函数和变量
 * @param {Array<string>} allFunctions - 所有函数名列表
 * @param {Array<string>} allVariables - 所有变量名列表
 */
function cleanupGlobals(allFunctions, allVariables) {
  allFunctions.forEach(function (funcName) {
    if (window[funcName]) {
      delete window[funcName];
    }
  });
  allVariables.forEach(function (varName) {
    if (window.hasOwnProperty(varName)) {
      delete window[varName];
    }
  });
}

/**
 * 获取 p5 原型或实例方法
 * @param {Object} p - p5 实例
 * @param {string} funcName - 函数名
 * @returns {Function|null} p5 方法或 null
 */
function getP5Method(p, funcName) {
  var p5Proto =
    p.constructor && p.constructor.prototype
      ? p.constructor.prototype
      : p5.prototype;
  var original = p5Proto ? p5Proto[funcName] : null;
  if (!original && p[funcName]) {
    original = p[funcName];
  }
  return original && typeof original === "function" ? original : null;
}

/**
 * 暴露 p5 函数到全局作用域（用于依赖分析）
 * @param {Object} context - 上下文对象（包含所需的方法和数据）
 */
function exposeFunctionsForAnalysis(context) {
  var p = context.p;
  var allFunctions = context.allFunctions;
  var renderFunctions = context.renderFunctions;
  var getShapeTypeMap = context.getShapeTypeMap;
  var getTransformFunctionNames = context.getTransformFunctionNames;
  var getColorFunctionNames = context.getColorFunctionNames;
  var getEnvironmentFunctionNames = context.getEnvironmentFunctionNames;
  var collectDeps = context.collectDeps;
  var collectShape = context.collectShape;

  var shapeTypeMap = getShapeTypeMap(context.cache);
  var transformFuncs = getTransformFunctionNames();
  var colorFuncs = getColorFunctionNames();
  var envFuncs = getEnvironmentFunctionNames();

  allFunctions.forEach(function (funcName) {
    var original = getP5Method(p, funcName);

    if (original) {
      window[funcName] = function () {
        if (renderFunctions.indexOf(funcName) !== -1) {
          var baseType = shapeTypeMap[funcName] || funcName;
          collectShape(baseType);
          collectDeps("shapes", funcName);
        }
        if (transformFuncs.indexOf(funcName) !== -1) {
          collectDeps("transforms", funcName);
        }
        if (colorFuncs.indexOf(funcName) !== -1) {
          collectDeps("colors", funcName);
        }
        return original.apply(p, arguments);
      };
    } else {
      if (envFuncs.indexOf(funcName) !== -1) {
        window[funcName] = function () {
          // 空实现
        };
      }
    }
  });
}

/**
 * 暴露 p5 函数到全局作用域（用于代码执行）
 * @param {Object} context - 上下文对象
 *   - renderOrder: 按执行顺序记录的渲染调用 [baseType, baseType, ...]
 */
function exposeFunctionsForExecution(context) {
  var p = context.p;
  var allFunctions = context.allFunctions;
  var renderFunctions = context.renderFunctions;
  var renderCounts = context.renderCounts;
  var renderOrder = context.renderOrder;
  var getShapeTypeMap = context.getShapeTypeMap;
  var loopExecutions = context.loopExecutions;
  var maxLoopCount = context.maxLoopCount;

  var shapeTypeMap = getShapeTypeMap ? getShapeTypeMap(context.cache) : {};

  allFunctions.forEach(function (funcName) {
    var original = getP5Method(p, funcName);
    if (original) {
      if (renderFunctions.indexOf(funcName) !== -1) {
        window[funcName] = function () {
          loopExecutions.value++;
          if (loopExecutions.value > maxLoopCount) {
            throw new Error("循环次数超过上限");
          }
          renderCounts[funcName]++;
          if (renderOrder) {
            var baseType = shapeTypeMap[funcName] || funcName;
            renderOrder.push(baseType);
          }
          return original.apply(p, arguments);
        };
      } else {
        window[funcName] = function () {
          return original.apply(p, arguments);
        };
      }
    }
  });
}
