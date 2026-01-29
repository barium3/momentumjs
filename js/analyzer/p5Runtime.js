/**
 * p5.js 运行时执行器
 *
 * 功能：
 * 1. 在隐藏的 canvas 中执行 p5.js 代码
 * 2. 对包含渲染函数的条件分支分别强制执行
 * 3. 统计渲染函数调用次数并合并结果
 * 4. 分析代码依赖关系
 */

// ========================================
// Registry 加载检查
// ========================================
var functionRegistry;
if (typeof window !== "undefined" && window.functionRegistry) {
  functionRegistry = window.functionRegistry;
  console.log(
    "[P5Runtime] Registry loaded successfully from window.functionRegistry",
  );
} else {
  throw new Error(
    "[P5Runtime] functionRegistry not found! " +
      "Please ensure bundle/includes/registry.js is loaded before this script.",
  );
}

// 初始化子模块
initRegistry(functionRegistry);
initExecutor(functionRegistry);
initDependencies(functionRegistry);

// ========================================
// P5Runtime 类
// ========================================
class P5Runtime {
  constructor(options = {}) {
    this.options = {
      timeout: options.timeout || 2000,
      maxLoopCount: options.maxLoopCount || 1000,
      canvasContainer: options.canvasContainer || document.body,
    };

    // 从 registry 获取函数列表
    this.renderFunctions = functionRegistry.getRenderFunctions();
    this.p5Functions = functionRegistry.getP5Functions();
    this.allFunctions = functionRegistry.getAllFunctions();
    this.allVariables = functionRegistry.getAllVariables
      ? functionRegistry.getAllVariables()
      : [];

    // p5 实例状态
    this.p5Instance = null;
    this.initialized = false;
    this.container = null;
    this.initPromise = null;

    // 条件分支识别器
    this.conditionalFinder = new ConditionalFinder();

    // Momentum 库函数映射（用于依赖分析）
    this.momentumFunctions = {
      shapes: buildCategoryMappings("shapes", ["transform", "color"]),
      transforms: buildCategoryMappings("transforms", ["transform"]),
      colors: buildCategoryMappings("colors", ["color"]),
      math: buildCategoryMappings("math", ["math"]),
    };

    // 缓存形状类型映射
    this._shapeTypeMapCache = null;
  }

  // ========================================
  // 公共方法：初始化和清理
  // ========================================

  /**
   * 初始化 p5 实例
   */
  async init() {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    var self = this;
    this.initPromise = new Promise(function (resolve, reject) {
      if (typeof p5 === "undefined") {
        reject(new Error("p5.js 未加载"));
        return;
      }

      try {
        self.container = document.createElement("div");
        self.container.id = "p5-analyzer-container";
        self.container.style.cssText =
          "position: absolute; left: -9999px; top: -9999px;";
        self.options.canvasContainer.appendChild(self.container);

        var sketch = function (p) {
          p.setup = function () {
            p.createCanvas(100, 100);
            p.noCanvas();
          };
        };

        self.p5Instance = new p5(sketch, self.container);
        self.initialized = true;

        setTimeout(function () {
          resolve();
        }, 100);
      } catch (err) {
        reject(new Error(err.message || "p5 初始化失败"));
      }
    });

    return this.initPromise;
  }

  /**
   * 清理资源
   */
  destroy() {
    cleanupGlobals(this.allFunctions, this.allVariables);

    if (this.p5Instance) {
      try {
        this.p5Instance.remove();
      } catch (e) {
        // 忽略清理错误
      }
      this.p5Instance = null;
    }

    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
      this.container = null;
    }

    this.initialized = false;
    this.initPromise = null;
    this._shapeTypeMapCache = null;
  }

  // ========================================
  // 公共方法：代码执行
  // ========================================

  /**
   * 执行 p5.js 代码
   * @param {string} code - 用户代码
   * @returns {Promise<Object>} 渲染计数结果
   */
  async execute(code) {
    await this.init();

    const conditions = this.conditionalFinder.findConditionsWithRender(code);

    if (conditions.length === 0) {
      return await this.executeSingle(code);
    }

    const results = [];

    try {
      results.push(await this.executeSingle(code));
    } catch (e) {
      console.warn("[P5Runtime] 原始代码执行失败:", e.message);
    }

    for (const cond of conditions) {
      if (cond.hasThen) {
        try {
          const forcedCode = this.conditionalFinder.forceCondition(
            code,
            cond.condition,
            "then",
          );
          results.push(await this.executeSingle(forcedCode));
        } catch (e) {
          console.warn(`[P5Runtime] then 分支执行失败:`, e.message);
        }
      }

      if (cond.hasElse) {
        try {
          const forcedCode = this.conditionalFinder.forceCondition(
            code,
            cond.condition,
            "else",
          );
          results.push(await this.executeSingle(forcedCode));
        } catch (e) {
          console.warn(`[P5Runtime] else 分支执行失败:`, e.message);
        }
      }
    }

    return this.mergeResults(results);
  }

  /**
   * 单次执行代码
   * @param {string} code - 用户代码
   * @returns {Promise<Object>} 执行结果
   */
  async executeSingle(code) {
    var self = this;
    var renderCounts = {};
    var loopExecutions = { value: 0 };

    this.renderFunctions.forEach(function (func) {
      renderCounts[func] = 0;
    });

    return new Promise(function (resolve, reject) {
      var timeoutId = setTimeout(function () {
        reject(new Error("执行超时"));
      }, self.options.timeout);

      try {
        var p = self.p5Instance;

        exposeVariables(self.allVariables, p);

        exposeFunctionsForExecution({
          p: p,
          allFunctions: self.allFunctions,
          renderFunctions: self.renderFunctions,
          renderCounts: renderCounts,
          loopExecutions: loopExecutions,
          maxLoopCount: self.options.maxLoopCount,
        });

        window.eval(code);

        if (typeof window.draw === "function") {
          window.draw();
        }

        cleanupGlobals(self.allFunctions, self.allVariables);

        clearTimeout(timeoutId);
        resolve({
          renderCounts: renderCounts,
          loopExecutions: loopExecutions.value,
        });
      } catch (err) {
        clearTimeout(timeoutId);
        cleanupGlobals(self.allFunctions, self.allVariables);
        reject(new Error(err.message || "执行错误"));
      }
    });
  }

  /**
   * 合并多个执行结果
   * @param {Array<Object>} results - 执行结果数组
   * @returns {Object} 合并后的结果
   */
  mergeResults(results) {
    var mergedCounts = {};
    var maxLoopExecutions = 0;

    this.renderFunctions.forEach(function (func) {
      mergedCounts[func] = 0;
    });

    results.forEach(function (result) {
      if (result.renderCounts) {
        for (var type in result.renderCounts) {
          if (
            result.renderCounts.hasOwnProperty(type) &&
            mergedCounts.hasOwnProperty(type)
          ) {
            if (result.renderCounts[type] > mergedCounts[type]) {
              mergedCounts[type] = result.renderCounts[type];
            }
          }
        }
      }
      if (result.loopExecutions > maxLoopExecutions) {
        maxLoopExecutions = result.loopExecutions;
      }
    });

    return { renderCounts: mergedCounts, loopExecutions: maxLoopExecutions };
  }

  // ========================================
  // 公共方法：依赖分析
  // ========================================

  /**
   * 分析代码依赖
   * @param {string} code - 用户代码
   * @returns {Promise<Object>} 依赖分析结果
   */
  async analyzeDependencies(code) {
    await this.init();

    var self = this;

    var shapeRequires = {};
    if (!functionRegistry.shapes) {
      throw new Error("[P5Runtime] functionRegistry.shapes not found!");
    }
    for (var name in functionRegistry.shapes) {
      if (functionRegistry.shapes.hasOwnProperty(name)) {
        var info = functionRegistry.shapes[name];
        var baseType = info.baseType || name;
        if (!shapeRequires.hasOwnProperty(baseType)) {
          shapeRequires[baseType] = false;
        }
      }
    }

    const dependencies = {
      shapes: {},
      transforms: {},
      colors: {},
      math: {},
      requires: {
        transform: false,
        color: false,
        math: false,
        shape: shapeRequires,
      },
    };

    const collectDeps = function (category, funcName) {
      if (
        self.momentumFunctions[category] &&
        self.momentumFunctions[category][funcName]
      ) {
        const info = self.momentumFunctions[category][funcName];
        dependencies[category][funcName] = true;
        if (info.deps) {
          info.deps.forEach(function (dep) {
            dependencies.requires[dep] = true;
          });
        }
      }
    };

    const collectShape = function (shapeType) {
      if (dependencies.requires.shape.hasOwnProperty(shapeType)) {
        dependencies.requires.shape[shapeType] = true;
      }
    };

    return new Promise(function (resolve, reject) {
      var timeoutId = setTimeout(function () {
        reject(new Error("依赖分析超时"));
      }, self.options.timeout);

      try {
        var p = self.p5Instance;

        exposeVariables(self.allVariables, p);

        exposeFunctionsForAnalysis({
          p: p,
          allFunctions: self.allFunctions,
          renderFunctions: self.renderFunctions,
          cache: self, // 传递缓存对象
          getShapeTypeMap: getShapeTypeMap,
          getTransformFunctionNames: getTransformFunctionNames,
          getColorFunctionNames: getColorFunctionNames,
          getEnvironmentFunctionNames: getEnvironmentFunctionNames,
          collectDeps: collectDeps,
          collectShape: collectShape,
        });

        window.eval(code);

        parseConstantsAndVariables(code, dependencies);

        if (typeof window.setup === "function") {
          window.setup();
        }

        if (typeof window.draw === "function") {
          window.draw();
        }

        cleanupGlobals(self.allFunctions, self.allVariables);

        clearTimeout(timeoutId);
        resolve(dependencies);
      } catch (err) {
        clearTimeout(timeoutId);
        cleanupGlobals(self.allFunctions, self.allVariables);
        reject(new Error(err.message || "依赖分析错误"));
      }
    });
  }

  /**
   * 解析代码中的常量和变量依赖
   * @param {string} code - 用户代码
   * @param {Object} dependencies - 依赖对象（会被修改）
   */
  parseConstantsAndVariables(code, dependencies) {
    parseConstantsAndVariables(code, dependencies);
  }

  /**
   * 解析代码中的数学函数依赖（保持向后兼容）
   * @deprecated 使用 parseConstantsAndVariables 代替
   */
  parseMathDependencies(code, dependencies) {
    parseConstantsAndVariables(code, dependencies);
  }
}

// ========================================
// 导出
// ========================================
if (typeof module !== "undefined" && module.exports) {
  module.exports = P5Runtime;
}
