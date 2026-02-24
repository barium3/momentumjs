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
} else {
  throw new Error(
    "[Runtime] functionRegistry not found! " +
      "Please ensure bundle/includes/registry.js is loaded before this script.",
  );
}

// 初始化子模块
initRegistryUtils(functionRegistry);
initDependencyAnalyzer(functionRegistry);

// ========================================
// 内部工具函数
// ========================================

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
 * 获取 p5 函数（从原型或实例）
 * @param {Object} p - p5 实例
 * @param {string} funcName - 函数名
 * @returns {Function|null} p5 函数或 null
 */
function getP5Function(p, funcName) {
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
 * 创建 shape 状态管理器
 * 支持多个需要状态管理的 shape（如 polygon）
 * @returns {Object} 状态管理器对象
 */
function createShapeStateManager() {
  var states = {}; // key: shapeName, value: { hasVertexInCurrentShape: boolean }
  
  return {
    getState: function(shapeName) {
      if (!states[shapeName]) {
        states[shapeName] = { hasVertexInCurrentShape: false };
      }
      return states[shapeName];
    },
    reset: function(shapeName) {
      if (states[shapeName]) {
        states[shapeName].hasVertexInCurrentShape = false;
      }
    },
    clear: function() {
      states = {};
    }
  };
}

/**
 * 记录 shape 函数执行（用于普通 shape 和构建器 shape 的 end 角色）
 * @param {Object} context - 上下文对象
 * @param {string} baseType - baseType（用于统计）
 * @param {string} funcName - 函数名（用于依赖收集）
 */
function recordShapeExecution(context, baseType, funcName) {
  // 依赖分析模式
  if (typeof context.collectShape === "function") {
    context.collectShape(baseType);
  }
  if (typeof context.collectDeps === "function") {
    context.collectDeps("shapes", funcName || baseType);
  }
  
  // 执行统计模式
  if (context.loopExecutions) {
    context.loopExecutions.value++;
    if (context.loopExecutions.value > context.maxLoopCount) {
      throw new Error("循环次数超过上限");
    }
  }
  if (context.renderOrder) {
    context.renderOrder.push(baseType);
  }
}

/**
 * 创建 shape 构建器函数的包装器
 * @param {Object} options - 配置选项
 * @param {Function} options.original - 原始 p5 函数
 * @param {Object} options.p - p5 实例
 * @param {string} options.funcName - 函数名
 * @param {string} options.shapeName - shape 名称（如 "polygon"）
 * @param {string} options.baseType - baseType（用于统计）
 * @param {string} options.role - 构建器角色（"begin", "add", "end"）
 * @param {Object} options.stateManager - 状态管理器
 * @param {Object} options.context - 上下文对象（包含回调函数等）
 * @returns {Function} 包装后的函数
 */
function createShapeBuilderWrapper(options) {
  var original = options.original;
  var p = options.p;
  var funcName = options.funcName;
  var shapeName = options.shapeName;
  var baseType = options.baseType;
  var role = options.role;
  var stateManager = options.stateManager;
  var context = options.context || {};
  
  var state = stateManager.getState(shapeName);
  
  if (role === "begin") {
    // begin 角色：重置状态
    return function() {
      state.hasVertexInCurrentShape = false;
      return original.apply(p, arguments);
    };
  } else if (role === "add") {
    // add 角色：标记有顶点，并收集函数依赖（如 beginContour, endContour）
    return function() {
      state.hasVertexInCurrentShape = true;
      // 收集构建器函数的依赖（如 beginContour, endContour）
      if (typeof context.collectDeps === "function") {
        context.collectDeps("shapes", funcName);
      }
      return original.apply(p, arguments);
    };
  } else if (role === "end") {
    // end 角色：如果有效则统计
    return function() {
      if (state.hasVertexInCurrentShape) {
        recordShapeExecution(context, baseType, baseType);
        state.hasVertexInCurrentShape = false;
      }
      return original.apply(p, arguments);
    };
  }
  
  // 未知角色，直接返回原始函数
  return function() {
    return original.apply(p, arguments);
  };
}

/**
 * 创建普通 shape 函数的包装器
 * @param {Object} options - 配置选项
 * @param {Function} options.original - 原始 p5 函数
 * @param {Object} options.p - p5 实例
 * @param {string} options.funcName - 函数名
 * @param {string} options.baseType - baseType（用于统计）
 * @param {Object} options.context - 上下文对象
 * @returns {Function} 包装后的函数
 */
function createShapeWrapper(options) {
  var original = options.original;
  var p = options.p;
  var funcName = options.funcName;
  var baseType = options.baseType;
  var context = options.context || {};
  
  return function() {
    recordShapeExecution(context, baseType, funcName);
    return original.apply(p, arguments);
  };
}

/**
 * 统一的函数暴露方法（支持执行模式和分析模式）
 * @param {Object} context - 上下文对象
 * @param {string} mode - 模式：'execution' 或 'analysis'
 */
function exposeFunctions(context, mode) {
  var p = context.p;
  var allFunctions = context.allFunctions;
  var renderFunctions = context.renderFunctions;
  var getShapeTypeMap = context.getShapeTypeMap;
  
  // 执行模式特有的参数
  var renderOrder = context.renderOrder;
  var loopExecutions = context.loopExecutions;
  var maxLoopCount = context.maxLoopCount;
  
  // 分析模式特有的参数
  var getTransformFunctionNames = context.getTransformFunctionNames;
  var getColorFunctionNames = context.getColorFunctionNames;
  var getEnvironmentFunctionNames = context.getEnvironmentFunctionNames;
  var collectDeps = context.collectDeps;
  var collectShape = context.collectShape;

  var shapeTypeMap = getShapeTypeMap ? getShapeTypeMap(context.cache) : {};
  var transformFuncs = mode === "analysis" && getTransformFunctionNames ? getTransformFunctionNames() : [];
  var colorFuncs = mode === "analysis" && getColorFunctionNames ? getColorFunctionNames() : [];
  var envFuncs = mode === "analysis" && getEnvironmentFunctionNames ? getEnvironmentFunctionNames() : [];

  var stateManager = createShapeStateManager();

  allFunctions.forEach(function (funcName) {
    var original = getP5Function(p, funcName);
    
    // 检查是否为某个 shape 的构建器函数
    var builderInfo = getBuilderInfo(funcName);

    if (original) {
      // 处理 shape 构建器函数（需要状态管理）
      if (builderInfo) {
        var builderContext = mode === "execution" ? {
          renderOrder: renderOrder,
          loopExecutions: loopExecutions,
          maxLoopCount: maxLoopCount,
        } : {
          collectShape: collectShape,
          collectDeps: collectDeps,
        };
        
        window[funcName] = createShapeBuilderWrapper({
          original: original,
          p: p,
          funcName: funcName,
          shapeName: builderInfo.shapeName,
          baseType: builderInfo.baseType,
          role: builderInfo.role,
          stateManager: stateManager,
          context: builderContext,
        });
      }
      // 处理普通 shape 函数
      else if (renderFunctions.indexOf(funcName) !== -1) {
        if (mode === "execution") {
          window[funcName] = createShapeWrapper({
            original: original,
            p: p,
            funcName: funcName,
            baseType: shapeTypeMap[funcName] || funcName,
            context: {
              renderOrder: renderOrder,
              loopExecutions: loopExecutions,
              maxLoopCount: maxLoopCount,
            },
          });
        } else {
          // 分析模式：普通 shape 函数
          window[funcName] = function () {
            var baseType = shapeTypeMap[funcName] || funcName;
            if (typeof collectShape === "function") {
              collectShape(baseType);
            }
            if (typeof collectDeps === "function") {
              collectDeps("shapes", funcName);
            }
            return original.apply(p, arguments);
          };
        }
      }
      // 处理其他函数
      else {
        if (mode === "execution") {
          // 执行模式：直接转发
          window[funcName] = function () {
            return original.apply(p, arguments);
          };
        } else {
          // 分析模式：收集依赖
          window[funcName] = function () {
            if (typeof collectDeps === "function") {
              if (transformFuncs.indexOf(funcName) !== -1) {
                collectDeps("transforms", funcName);
              } else if (colorFuncs.indexOf(funcName) !== -1) {
                collectDeps("colors", funcName);
              }
            }
            return original.apply(p, arguments);
          };
        }
      }
    } else {
      // 环境函数（仅分析模式需要空实现）
      if (mode === "analysis" && envFuncs.indexOf(funcName) !== -1) {
        window[funcName] = function () {
          // 空实现
        };
      }
    }
  });
}

/**
 * 暴露 p5 函数到全局作用域
 * @param {Object} context - 上下文对象
 * @param {string} mode - 模式：'execution' 或 'analysis'
 */
function exposeP5Functions(context, mode) {
  exposeFunctions(context, mode);
}

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
    this.conditionalAnalyzer = new ConditionalAnalyzer();

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
    return await this.executeWithBranches(code, null, null);
  }

  /**
   * 执行代码，处理条件分支
   * @param {string} code - 用户代码
   * @param {string|null} globalCode - 全局代码（可选）
   * @param {string|null} entryPoint - 入口函数名（'setup' 或 'draw'，null 表示执行 setup 和 draw）
   * @returns {Promise<Object>} 执行结果
   */
  async executeWithBranches(code, globalCode, entryPoint) {
    const fullCode = globalCode ? (globalCode + "\n" + code) : code;
    const conditions = this.conditionalAnalyzer.findBranchesWithRender(fullCode);

    if (conditions.length === 0) {
      return await this.executeCodeBlock(fullCode, entryPoint);
    }
    
    // 有条件分支，使用单次执行方案：
    // 1. 强制所有条件为 true
    // 2. 将 else/else if 转换为独立 if
    // 3. 只执行一次，不需要合并结果
    try {
      const modifiedCode = this.conditionalAnalyzer.convertElseToIndependentIf(fullCode, conditions);
      return await this.executeCodeBlock(modifiedCode, entryPoint);
    } catch (e) {
      console.error(`[Runtime] 条件分支处理失败:`, e);
      // 如果转换失败，回退到原始代码执行
      return await this.executeCodeBlock(fullCode, entryPoint);
    }
  }
  
  /**
   * 执行代码块
   * @param {string} fullCode - 完整代码
   * @param {string|null} entryPoint - 入口函数名（'setup' 或 'draw'，null 表示执行 setup 和 draw）
   * @returns {Promise<Object>} 执行结果
   */
  async executeCodeBlock(fullCode, entryPoint) {
    var self = this;
    
    return new Promise(function (resolve, reject) {
      var timeoutId = setTimeout(function () {
        var errorMsg = entryPoint ? `${entryPoint}执行超时` : "执行超时";
        reject(new Error(errorMsg));
      }, self.options.timeout);

      try {
        var p = self.p5Instance;
        var renderOrder = [];
        var loopExecutions = { value: 0 };

        exposeVariables(self.allVariables, p);

        exposeP5Functions({
          p: p,
          allFunctions: self.allFunctions,
          renderFunctions: self.renderFunctions,
          renderOrder: renderOrder,
          getShapeTypeMap: getShapeTypeMap,
          cache: self,
          loopExecutions: loopExecutions,
          maxLoopCount: self.options.maxLoopCount,
        }, "execution");

        clearUserEntryPoints();
        
        if (fullCode.trim()) {
          try {
            window.eval(fullCode);
          } catch (evalErr) {
            console.error(`[Runtime] eval 执行失败`, evalErr);
            throw evalErr;
          }
        }

        // 根据 entryPoint 决定执行哪些函数
        const shouldRunSetup = entryPoint === "setup" || entryPoint === null;
        const shouldRunDraw = entryPoint === "draw" || entryPoint === null;
        
        if (shouldRunSetup && typeof window.setup === "function") {
          try {
            window.setup();
          } catch (setupErr) {
            console.error(`[Runtime] setup() 调用失败`, setupErr);
            throw setupErr;
          }
        }
        
        if (shouldRunDraw && typeof window.draw === "function") {
          try {
            window.draw();
          } catch (drawErr) {
            console.error(`[Runtime] draw() 调用失败`, drawErr);
            throw drawErr;
          }
        }

        cleanupGlobals(self.allFunctions, self.allVariables);

        const result = {
          renderOrder: renderOrder,
          loopExecutions: loopExecutions.value,
        };
        
        clearTimeout(timeoutId);
        resolve(result);
      } catch (err) {
        clearTimeout(timeoutId);
        cleanupGlobals(self.allFunctions, self.allVariables);
        var errorMsg = entryPoint ? `${entryPoint}执行错误` : "执行错误";
        console.error(`[Runtime] executeCodeBlock 执行失败`, err);
        reject(new Error(err.message || errorMsg));
      }
    });
  }

  /**
   * 分别执行 setup 和 draw 代码（先 setup 后 draw），分别统计 shape 调用
   * @param {string} setupCode - setup函数代码
   * @param {string} drawCode - draw函数代码
   * @param {string} globalCode - 全局代码
   * @returns {Promise<Object>} 执行结果，包含setupResult和drawResult
   */
  async executeSetupAndDraw(setupCode, drawCode, globalCode) {
    // 构建函数定义代码
    const functionDefs = [];
    if (setupCode && setupCode.trim()) {
      functionDefs.push(`function setup() { ${setupCode} }`);
    }
    if (drawCode && drawCode.trim()) {
      functionDefs.push(`function draw() { ${drawCode} }`);
    }
    
    // 组合完整代码：globalCode + 函数定义
    const fullCode = globalCode 
      ? (globalCode + "\n" + functionDefs.join("\n"))
      : functionDefs.join("\n");
    
    // 找到所有条件分支（包括setup和draw中的）
    const allConditions = this.conditionalAnalyzer.findBranchesWithRender(fullCode);
    
    // 如果没有条件分支，直接执行
    if (allConditions.length === 0) {
      const { setupResult, drawResult } = await this.executeSetupThenDraw(fullCode);
      return { setupResult, drawResult };
    }
    
    // 有条件分支，使用单次执行方案：
    // 1. 强制所有条件为 true
    // 2. 将 else/else if 转换为独立 if
    // 3. 只执行一次，不需要合并结果
    try {
      const modifiedCode = this.conditionalAnalyzer.convertElseToIndependentIf(fullCode, allConditions);
      const { setupResult, drawResult } = await this.executeSetupThenDraw(modifiedCode);
      return { setupResult, drawResult };
    } catch (e) {
      console.error(`[Runtime] 条件分支处理失败:`, e);
      // 如果转换失败，回退到原始代码执行
      const { setupResult, drawResult } = await this.executeSetupThenDraw(fullCode);
      return { setupResult, drawResult };
    }
  }

  /**
   * 在同一执行环境中先执行 setup，再执行 draw
   * @param {string} fullCode - 完整代码（包含globalCode + setupCode + drawCode）
   * @returns {Promise<Object>} 执行结果，包含setupResult和drawResult
   */
  async executeSetupThenDraw(fullCode) {
    var self = this;
    
    return new Promise(function (resolve, reject) {
      var timeoutId = setTimeout(function () {
        var errorMsg = "执行超时";
        reject(new Error(errorMsg));
      }, self.options.timeout * 2); // 给两倍超时时间，因为要执行setup和draw

      try {
        var p = self.p5Instance;
        
        // setup 的统计
        var setupRenderOrder = [];
        var setupLoopExecutions = { value: 0 };
        
        // draw 的统计
        var drawRenderOrder = [];
        var drawLoopExecutions = { value: 0 };

        exposeVariables(self.allVariables, p);

        // 先执行 setup
        exposeP5Functions({
          p: p,
          allFunctions: self.allFunctions,
          renderFunctions: self.renderFunctions,
          renderOrder: setupRenderOrder,
          getShapeTypeMap: getShapeTypeMap,
          cache: self,
          loopExecutions: setupLoopExecutions,
          maxLoopCount: self.options.maxLoopCount,
        }, "execution");

        clearUserEntryPoints();
        
        if (fullCode.trim()) {
          try {
            window.eval(fullCode);
          } catch (evalErr) {
            console.error(`[Runtime] eval 执行失败`, evalErr);
            throw evalErr;
          }
        }

        // 执行 setup
        if (typeof window.setup === "function") {
          try {
            window.setup();
          } catch (setupErr) {
            console.error(`[Runtime] setup() 调用失败`, setupErr);
            throw setupErr;
          }
        }

        // 现在执行 draw（在同一个环境中，可以访问setup中创建的变量）
        exposeP5Functions({
          p: p,
          allFunctions: self.allFunctions,
          renderFunctions: self.renderFunctions,
          renderOrder: drawRenderOrder,
          getShapeTypeMap: getShapeTypeMap,
          cache: self,
          loopExecutions: drawLoopExecutions,
          maxLoopCount: self.options.maxLoopCount,
        }, "execution");

        // 执行 draw
        if (typeof window.draw === "function") {
          try {
            window.draw();
          } catch (drawErr) {
            console.error(`[Runtime] draw() 调用失败`, drawErr);
            throw drawErr;
          }
        }

        cleanupGlobals(self.allFunctions, self.allVariables);

        const setupResult = {
          renderOrder: setupRenderOrder,
          loopExecutions: setupLoopExecutions.value,
        };
        
        const drawResult = {
          renderOrder: drawRenderOrder,
          loopExecutions: drawLoopExecutions.value,
        };
        
        clearTimeout(timeoutId);
        resolve({
          setupResult: setupResult,
          drawResult: drawResult,
        });
      } catch (err) {
        clearTimeout(timeoutId);
        cleanupGlobals(self.allFunctions, self.allVariables);
        var errorMsg = "执行错误";
        console.error(`[Runtime] executeSetupThenDraw 执行失败`, err);
        reject(new Error(err.message || errorMsg));
      }
    });
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
      throw new Error("[Runtime] functionRegistry.shapes not found!");
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
      } else {
        // 即使函数不在 momentumFunctions 中，也收集依赖（用于构建器函数如 beginContour）
        // 这样可以检测到使用了哪些构建器函数
        if (!dependencies[category]) {
          dependencies[category] = {};
        }
        dependencies[category][funcName] = true;
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

        exposeP5Functions({
          p: p,
          allFunctions: self.allFunctions,
          renderFunctions: self.renderFunctions,
          cache: self,
          getShapeTypeMap: getShapeTypeMap,
          getTransformFunctionNames: getTransformFunctionNames,
          getColorFunctionNames: getColorFunctionNames,
          getEnvironmentFunctionNames: getEnvironmentFunctionNames,
          collectDeps: collectDeps,
          collectShape: collectShape,
        }, "analysis");

        clearUserEntryPoints();
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

}

// ========================================
// 导出
// ========================================
if (typeof module !== "undefined" && module.exports) {
  module.exports = P5Runtime;
}

// 全局可用（保持向后兼容）
window.P5Runtime = P5Runtime;
