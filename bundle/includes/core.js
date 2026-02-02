// ----------------------------------------
// Momentum.js - Processing Style Compiler
// 将类 Processing 代码编译为 AE 图层结构
// ----------------------------------------

/** ExtendScript 无 Array.isArray，用本地辅助函数判断数组 */
function isArray(arg) {
  return Object.prototype.toString.call(arg) === "[object Array]";
}

// ========================================
// 全局变量
// ========================================
var engineLayer = null;
var engineComp = null;
var shapeQueue = [];

// ========================================
// Public API - 公共接口
// ========================================

// 默认合成配置常量
var DEFAULT_COMP_DURATION = 10; // 默认合成时长（秒）

pub.run = function (code) {
  try {
    shapeQueue = [];
    engineComp = m.composition();
    var parsed = parseProcessingCode(code);
    if (!parsed.drawCode) throw new Error("No draw() function found");
    createEngineLayer(parsed.drawCode, "", parsed.globalVars);
    createShapeLayers();
  } catch (e) {
    alert("m.run error: " + e.message + "\nLine: " + e.line);
    throw e;
  }
};

/**
 * 检查 registry 是否可用
 * @returns {boolean} registry 是否可用
 */
function isRegistryAvailable() {
  return typeof functionRegistry !== "undefined" && functionRegistry !== null;
}

/**
 * 获取图形类型的槽位数（使用 registry）
 * @param {string} type - 图形类型
 * @returns {number} 槽位数
 */
function getShapeSlots(type) {
  if (isRegistryAvailable() && functionRegistry.getShapeSlots) {
    return functionRegistry.getShapeSlots(type);
  }
  // 如果 registry 不可用，抛出错误而不是使用硬编码值
  throw new Error("functionRegistry.getShapeSlots is not available");
}

pub.runParsed = function (
  drawCode,
  setupCode,
  globalCode,
  maxShapes,
  compName,
  compWidth,
  compHeight,
  compFrameRate,
  renderLayersArg,
  dependenciesArg,
) {
  try {
    // 1. 初始化变量
    shapeQueue = [];

    // 2. 处理前端传递的 renderLayers（来自 LayerAnalyzer 分析）
    // 🔧 修复：确保 renderLayersArg 是真正的数组，而不是字符串 "null"
    if (
      renderLayersArg &&
      isArray(renderLayersArg) &&
      renderLayersArg.length > 0
    ) {
      var currentIndex = 0;

      // 检查是新格式（count）还是旧格式（outputIndex/slots）
      var isNewFormat =
        renderLayersArg[0] && renderLayersArg[0].count !== undefined;

      if (isNewFormat) {
        // 新格式: [{ type: "ellipse", count: 50 }, ...]
        // 需要展开 count 并计算输出索引
        // 同时为每个 shape 分配 shapeIndex（同一类型的顺序号）
        var typeCounters = {}; // 跟踪每种类型的当前顺序号

        for (var i = 0; i < renderLayersArg.length; i++) {
          var item = renderLayersArg[i];
          var slots = getShapeSlots(item.type);

          // 初始化类型计数器（如果不存在）
          if (!typeCounters[item.type]) {
            typeCounters[item.type] = 0;
          }

          for (var j = 0; j < item.count; j++) {
            typeCounters[item.type]++; // 递增该类型的顺序号
            shapeQueue.push({
              type: item.type,
              outputIndex: currentIndex,
              slots: slots,
              shapeIndex: typeCounters[item.type], // 添加顺序号
            });
            currentIndex += slots;
          }
        }
      } else {
        // 旧格式: [{ type: "ellipse", outputIndex: 0, slots: 7 }, ...]
        // 保持向后兼容
        var typeCounters = {};
        for (var i = 0; i < renderLayersArg.length; i++) {
          var item = renderLayersArg[i];

          // 初始化类型计数器
          if (!typeCounters[item.type]) {
            typeCounters[item.type] = 0;
          }
          typeCounters[item.type]++;

          shapeQueue.push({
            type: item.type,
            outputIndex: item.outputIndex,
            slots: item.slots,
            shapeIndex: typeCounters[item.type], // 添加顺序号
          });
        }
      }
    }

    // 3. 如果没有渲染图层，说明代码中没有图形函数调用（这是正常的）

    // 4. 提取环境配置并创建合成
    var env = extractEnvironmentConfig(
      setupCode,
      compName,
      compWidth,
      compHeight,
      compFrameRate,
    );
    engineComp = m.composition(
      env.name,
      env.width,
      env.height,
      1,
      DEFAULT_COMP_DURATION,
      env.frameRate,
    );

    // 5. 检查代码块存在性
    var hasDraw = drawCode && drawCode.length > 0;
    var hasSetup = setupCode && setupCode.length > 0;
    var hasGlobal = globalCode && globalCode.length > 0;

    // 6. Processing 逻辑：没有 setup 和 draw 时，把全局代码当作 setup
    if (!hasDraw && !hasSetup && hasGlobal) {
      setupCode = globalCode;
      globalCode = "";
      hasSetup = true;
    }

    // 7. 没有 draw 时创建空函数（允许只有 setup）
    if (!hasDraw) {
      drawCode = "// Empty draw function";
    }

    // 8. 没有任何代码时抛出错误
    if (!hasDraw && !hasSetup && !hasGlobal) {
      throw new Error("No code provided");
    }

    // 9. 如果 renderLayersArg 是 "null"（分析失败或未分析），添加默认图形
    //    如果 renderLayersArg 是 "[]"（分析完成但没有可追踪的渲染函数），不添加
    //    如果 renderLayersArg 有具体内容，使用分析结果
    if (shapeQueue.length === 0 && renderLayersArg === "null") {
      // 使用 registry 获取默认图形的槽位数
      var defaultType = "ellipse";
      var defaultSlots = isRegistryAvailable() ? getShapeSlots(defaultType) : 7; // 仅在 registry 完全不可用时使用默认值
      shapeQueue.push({
        type: defaultType,
        outputIndex: 0,
        slots: defaultSlots,
      });
    }

    // 10. 创建引擎图层和渲染图层（传递依赖信息用于按需加载）
    var deps = null;
    try {
      deps =
        typeof dependenciesArg === "string"
          ? JSON.parse(dependenciesArg)
          : dependenciesArg;
    } catch (e) {
      deps = null;
    }
    createEngineLayer(drawCode || "", setupCode || "", globalCode || "", deps);
    createShapeLayers();
  } catch (e) {
    alert("m.runParsed error: " + e.message + "\nLine: " + e.line);
    throw e;
  }
};

pub.showContext = function (visible) {
  if (engineLayer) {
    engineLayer.shy = !visible;
    engineLayer.enabled = visible;
    if (engineComp) engineComp.hideShyLayers = !visible;
  }
};

pub.clearContext = function () {
  if (engineLayer) engineLayer.remove();
  engineLayer = null;
  engineComp = null;
  shapeQueue = [];
};

pub.composition = function (
  name,
  width,
  height,
  pixelAspect,
  duration,
  frameRate,
) {
  // 默认配置
  var defaults = {
    name: "New Composition",
    width: 1920,
    height: 1080,
    pixelAspect: 1,
    duration: 10,
    frameRate: 30,
  };

  // 根据参数数量覆盖默认值
  var args = arguments;
  var n = args.length;
  if (n >= 1) defaults.name = typeof name === "string" ? name : String(name);
  if (n >= 2) defaults.width = Number(width);
  if (n >= 3) defaults.height = Number(height);
  if (n >= 4) defaults.pixelAspect = Number(pixelAspect);
  if (n >= 5) defaults.duration = Number(duration);
  if (n >= 6) defaults.frameRate = Number(frameRate);

  // 创建合成并打开查看器
  var comp = app.project.items.addComp(
    defaults.name,
    defaults.width,
    defaults.height,
    defaults.pixelAspect,
    defaults.duration,
    defaults.frameRate,
  );
  comp.openInViewer();
  return comp;
};

error = pub.error = function (msg) {
  throw new Error(msg);
};

// ========================================
// Code Parsing - 代码解析
// ========================================

function parseProcessingCode(code) {
  return {
    drawCode: extractFunctionBody(code, "draw"),
    setupCode: extractFunctionBody(code, "setup"),
    globalVars: removeFunctionBlock(
      removeFunctionBlock(code, "draw"),
      "setup",
    ).replace(/^\s+|\s+$/g, ""),
  };
}

/**
 * 提取函数体内容
 * @param {string} code - 完整代码
 * @param {string} funcName - 函数名
 * @returns {string} 函数体内容
 */
function extractFunctionBody(code, funcName) {
  // 查找函数定义起始位置
  var startIdx = code.indexOf("function " + funcName);
  if (startIdx === -1) startIdx = code.indexOf("function  " + funcName);
  if (startIdx === -1) return "";

  // 查找匹配的右括号
  var braceStart = code.indexOf("{", startIdx);
  if (braceStart === -1) return "";

  var endIdx = findMatchingBrace(code, braceStart);
  if (endIdx === -1) return "";

  return code.substring(braceStart + 1, endIdx).replace(/^\s+|\s+$/g, "");
}

/**
 * 移除函数块
 * @param {string} code - 完整代码
 * @param {string} funcName - 函数名
 * @returns {string} 移除函数后的代码
 */
function removeFunctionBlock(code, funcName) {
  var startIdx = code.indexOf("function " + funcName);
  if (startIdx === -1) return code;

  var braceStart = code.indexOf("{", startIdx);
  if (braceStart === -1) return code;

  var endIdx = findMatchingBrace(code, braceStart);
  if (endIdx === -1) return code;

  return code.substring(0, startIdx) + code.substring(endIdx + 1);
}

/**
 * 查找匹配的右大括号位置
 * @param {string} str - 代码字符串
 * @param {number} openBracePos - 左大括号位置
 * @returns {number} 匹配的右大括号位置，-1 表示未找到
 */
function findMatchingBrace(str, openBracePos) {
  var braceCount = 1;
  var i = openBracePos + 1;

  while (i < str.length && braceCount > 0) {
    if (str.charAt(i) === "{") braceCount++;
    if (str.charAt(i) === "}") braceCount--;
    i++;
  }

  return braceCount === 0 ? i - 1 : -1;
}

// ========================================
// Engine Layer - 引擎图层
// ========================================

function createEngineLayer(drawCode, setupCode, globalVars, deps) {
  // 1. 清理已存在的 __engine__ 图层
  cleanupEngineLayer();

  // 2. 创建新的图层结构
  var ctxLayer = engineComp.layers.addShape();
  ctxLayer.name = "__engine__";

  var contents = ctxLayer.property("Contents");
  var group = contents.addProperty("ADBE Vector Group");
  group.name = "Program";

  var pathProp = group
    .property("Contents")
    .addProperty("ADBE Vector Shape - Group");
  pathProp.name = "Main";

  // 3. 预处理代码（移除配置函数，替换形状函数名）
  var processedDraw = drawCode
    ? replaceShapeFunctions(removeConfigFunctions(drawCode))
    : "";
  var processedSetup = setupCode
    ? replaceShapeFunctions(removeConfigFunctions(setupCode))
    : "";
  var processedGlobal = globalVars
    ? replaceShapeFunctions(removeConfigFunctions(globalVars))
    : "";

  // 4. 确定代码块存在性
  var hasDraw =
    drawCode && drawCode.length > 0 && !drawCode.match(/^\/\/\s*Empty/);
  var hasSetup = setupCode && setupCode.length > 0;

  // 5. 构建表达式
  // 获取每种渲染函数需要的数量，用于初始化计数器
  var shapeCounts = {};
  for (var i = 0; i < shapeQueue.length; i++) {
    var item = shapeQueue[i];
    if (!shapeCounts[item.type]) {
      shapeCounts[item.type] = 0;
    }
    shapeCounts[item.type]++;
  }

  // 传递依赖信息用于按需加载
  var expr = buildExpression(
    processedDraw,
    processedSetup,
    processedGlobal,
    hasDraw,
    hasSetup,
    shapeCounts,
    deps,
  );

  // 6. 应用表达式并设置图层属性
  pathProp.property("Path").expression = expr.join("\n");
  ctxLayer.shy = true;
  ctxLayer.enabled = false;
  ctxLayer.moveToEnd();
  engineComp.hideShyLayers = true;
  engineLayer = ctxLayer;
}

/**
 * 清理已存在的引擎图层
 */
function cleanupEngineLayer() {
  for (var i = 1; i <= engineComp.numLayers; i++) {
    if (engineComp.layer(i).name === "__engine__") {
      engineComp.layer(i).remove();
      break;
    }
  }
}

/**
 * 检查对象是否有属性值（AEScript 兼容，不支持 Object.keys）
 * 检查属性是否存在且为 true/false（不检查 undefined）
 */
function hasKeys(obj) {
  if (!obj) return false;
  for (var key in obj) {
    if (obj.hasOwnProperty(key) && obj[key] !== undefined) return true;
  }
  return false;
}

/**
 * 从 registry 自动构建某个类别的依赖对象
 * @param {Object} categoryDeps - 依赖信息对象，如 transformDeps
 * @param {string} registryKey - registry 中的键名，如 'transforms'
 * @returns {Object} 构建好的依赖对象
 */
function buildDepsFromRegistry(categoryDeps, registryKey) {
  var result = {};

  // 从 registry 获取该类别的所有函数名（ES3 兼容，使用 for...in）
  if (isRegistryAvailable() && functionRegistry[registryKey]) {
    var category = functionRegistry[registryKey];

    // 为每个函数设置依赖状态
    for (var funcName in category) {
      if (category.hasOwnProperty(funcName)) {
        result[funcName] = categoryDeps[funcName] || false;
      }
    }
  }

  return result;
}

/**
 * 从 registry 和 shapeCounts 自动构建形状库依赖对象
 * @param {Object} shapeCounts - 形状计数对象，如 {ellipse: 2, rect: 1}
 * @returns {Object} 构建好的形状依赖对象
 */
function buildShapeDepsFromRegistry(shapeCounts) {
  var result = {};

  // 从 registry 获取所有形状函数名（ES3 兼容，使用 for...in）
  if (isRegistryAvailable() && functionRegistry.shapes) {
    var shapes = functionRegistry.shapes;

    // 为每个形状函数设置依赖状态（根据 count > 0）
    for (var shapeName in shapes) {
      if (shapes.hasOwnProperty(shapeName)) {
        result[shapeName] = (shapeCounts[shapeName] || 0) > 0;
      }
    }
  }

  return result;
}

/**
 * 检测用户代码中是否使用了某个变量或函数
 * @param {string} code - 用户代码
 * @param {string} name - 变量/函数名
 * @returns {boolean} - 是否使用
 */
function detectUsage(code, name) {
  if (!code) return false;
  // 使用词边界确保匹配完整名称（避免 frameCount2 被识别为 frameCount）
  var pattern = new RegExp("\\b" + name + "\\b");
  return pattern.test(code);
}

/**
 * 构建表达式代码 - 按需加载版本
 * 遵循 Processing 语义：setup() 和 draw() 是真正的函数调用
 * 这样可以确保变量作用域正确隔离
 * @param {Object} shapeCounts - 每种渲染函数需要的数量 {ellipse: 2, rect: 1, ...}
 * @param {Object} deps - 依赖分析结果（来自 P5Runtime.analyzeDependencies）
 */
function buildExpression(
  processedDraw,
  processedSetup,
  processedGlobal,
  hasDraw,
  hasSetup,
  shapeCounts,
  deps,
) {
  // 计算每种图形的槽位数（使用 registry）
  var totalSlots = 0;
  for (var type in shapeCounts) {
    var slots = getShapeSlots(type);
    totalSlots += shapeCounts[type] * slots;
  }

  // 解析依赖对象
  var mathDeps = deps && deps.math ? deps.math : {};
  var transformDeps = deps && deps.transforms ? deps.transforms : {};
  var colorDeps = deps && deps.colors ? deps.colors : {};
  var shapeDeps = deps && deps.shapes ? deps.shapes : {};

  // 环境依赖：如果前端未提供，则自动检测环境变量和常量使用
  var envDeps = deps && deps.environment ? deps.environment : {};

  // 自动检测环境变量和常量使用（如果前端未提供）
  // 注意：现在统一由前端的 parseConstantsAndVariables 处理，这里只作为备用
  if (!deps || !deps.environment) {
    var allCode = [processedDraw, processedSetup, processedGlobal].join(" ");
    if (isRegistryAvailable() && functionRegistry.environment) {
      var envItems = functionRegistry.environment;
      for (var envName in envItems) {
        if (envItems.hasOwnProperty(envName)) {
          var item = envItems[envName];
          // 检测所有类型（variable 和 constant）
          if (item.type === "variable" || item.type === "constant") {
            envDeps[envName] = detectUsage(allCode, envName);
          }
        }
      }
    }
  }

  // 检查是否有任何形状需要渲染（动态检查）
  var hasShapes = false;
  for (var key in shapeCounts) {
    if (shapeCounts[key] > 0) {
      hasShapes = true;
      break;
    }
  }

  var expr = [
    "// =======================================",
    "// 动态索引分配模式 - 按需加载",
    "// =======================================",
    "// 初始化各类型图形的计数器（仅当需要时）",
  ];

  // 根据实际需要的形状添加计数器（动态生成）
  for (var shapeType in shapeCounts) {
    if (shapeCounts[shapeType] > 0) {
      // 获取基础类型（circle -> ellipse, square -> rect）
      var shapeInfo = null;
      if (isRegistryAvailable() && functionRegistry.getShapeInfo) {
        shapeInfo = functionRegistry.getShapeInfo(shapeType);
      }
      if (!shapeInfo) {
        throw new Error(
          "functionRegistry.getShapeInfo is not available for type: " +
            shapeType,
        );
      }
      var internalName = shapeInfo.internal;
      // 提取内部函数名中的计数器名 (_ellipseCount)
      var counterName = internalName + "Count";
      expr.push("var " + counterName + " = 0;");
    }
  }

  // 基础变量定义（内部系统，始终需要）
  expr.push(
    "// ========================================",
    "// 环境变量（内部系统）",
    "// ========================================",
    "var fps = 1 / thisComp.frameDuration;",
    "var currentFrame = timeToFrames(time);",
    "var currentTime = time;",
  );

  // 按需加载环境变量库
  if (hasKeys(envDeps)) {
    expr.push("// 环境变量库（按需加载）");
    expr.push(getEnvironmentLib(envDeps));
  }

  // 按需加载数学库（每个函数单独判断）
  if (hasKeys(mathDeps)) {
    expr.push("// 数学库（按需加载）");
    // 从 registry 自动构建数学依赖对象，每个函数单独加载
    expr.push(getMathLib(buildDepsFromRegistry(mathDeps, "math")));
  }

  // 输出数组（形状需要）
  if (hasShapes) {
    expr.push("var _out = [];");
  }

  // 按需加载变换库
  // state 模式：只加载形状函数需要的内部函数（状态 + _applyTransform + resetMatrix）
  // 用户函数模式：加载用户显式使用的变换函数
  if (hasShapes) {
    expr.push("// 变换库（内部函数）");
    expr.push(getTransformationLib({ state: true }));
  }
  if (hasKeys(transformDeps)) {
    expr.push("// 变换库（用户函数）");
    // 从 registry 自动构建依赖对象，不需要手动维护函数列表
    expr.push(
      getTransformationLib(buildDepsFromRegistry(transformDeps, "transforms")),
    );
  }

  // 按需加载颜色库
  // state 模式：只加载形状函数需要的内部函数（颜色状态 + _encodeColorState + resetColors）
  // 用户函数模式：加载用户显式使用的颜色函数
  if (hasShapes) {
    expr.push("// 颜色库（内部函数）");
    expr.push(getColorLib({ state: true }));
  }
  if (hasKeys(colorDeps)) {
    expr.push("// 颜色库（用户函数）");
    // 从 registry 自动构建依赖对象，不需要手动维护函数列表
    expr.push(getColorLib(buildDepsFromRegistry(colorDeps, "colors")));
  }

  // 按需加载形状函数
  if (hasShapes) {
    expr.push("// 形状函数库（按需加载）");
    // 从 registry 自动构建形状依赖对象，不需要手动维护函数列表
    expr.push(getShapeLib(buildShapeDepsFromRegistry(shapeCounts)));
  }

  // 全局变量
  if (processedGlobal) {
    expr.push("// Global (变量声明)");
    expr.push(processedGlobal);
  }

  // 构建 setup 和 draw 函数定义
  expr.push.apply(
    expr,
    buildFunctionDefinitions(processedSetup, processedDraw, hasSetup, hasDraw),
  );

  // 构建执行逻辑
  expr.push.apply(
    expr,
    buildExecutionLogic(hasDraw, hasSetup, hasShapes, envDeps),
  );

  // 最终路径创建（仅当有形状时）
  expr.push(buildPathCreation(hasShapes));

  return expr;
}

// ========================================
// Shape Analysis - 图形分析
// ========================================

function replaceShapeFunctions(code) {
  // 从 registry 获取形状映射
  var funcMap = {};

  if (isRegistryAvailable() && functionRegistry.shapes) {
    for (var name in functionRegistry.shapes) {
      if (functionRegistry.shapes.hasOwnProperty(name)) {
        var info = functionRegistry.shapes[name];
        // 内部函数名去掉前缀 '_' 作为映射目标
        var target = info.internal.replace(/^_/, "");
        funcMap[name] = target;
      }
    }
  } else {
    throw new Error("functionRegistry.shapes is not available");
  }

  for (var f in funcMap) {
    code = replaceFunctionCalls(code, f, "_" + funcMap[f]);
  }
  return code;
}

function analyzeShapeCalls(code) {
  // 从 registry 获取形状信息
  var shapeTypes = {};

  if (isRegistryAvailable() && functionRegistry.shapes) {
    for (var name in functionRegistry.shapes) {
      if (functionRegistry.shapes.hasOwnProperty(name)) {
        var info = functionRegistry.shapes[name];
        // 内部函数名去掉前缀 '_' 作为 mapTo
        var mapTo = info.internal.replace(/^_/, "");
        shapeTypes[name] = {
          slots: info.slots,
          mapTo: mapTo,
        };
      }
    }
  } else {
    throw new Error("functionRegistry.shapes is not available");
  }

  var idx = 0;
  var shapeIndex = 0;

  while (idx < code.length) {
    var found = null;
    var pos = -1;

    // 查找下一个形状函数调用
    for (var funcName in shapeTypes) {
      var p = code.indexOf(funcName + "(", idx);
      if (p !== -1 && (pos === -1 || p < pos)) {
        var prevChar = p > 0 ? code.charAt(p - 1) : "";
        if (!isIdentifierChar(prevChar)) {
          pos = p;
          found = funcName;
        }
      }
    }

    if (!found) break;

    // 检查是否在注释中
    if (!isInComment(code, pos)) {
      var shapeInfo = shapeTypes[found];
      shapeQueue.push({
        type: shapeInfo.mapTo,
        outputIndex: shapeIndex,
        slots: shapeInfo.slots,
      });
      shapeIndex += shapeInfo.slots;
    }

    idx = pos + found.length + 1;
  }
}

// ========================================
// Utilities - 工具函数
// ========================================

function isIdentifierChar(c) {
  return (
    (c >= "a" && c <= "z") ||
    (c >= "A" && c <= "Z") ||
    (c >= "0" && c <= "9") ||
    c === "_"
  );
}

function isInComment(code, pos) {
  // 从当前位置向前查找
  for (var i = pos - 1; i >= 0; i--) {
    if (code.charAt(i) === "\n") {
      // 检查行注释
      return code.substring(i + 1, pos).indexOf("//") !== -1;
    }
  }
  // 检查文件开头的注释
  return code.substring(0, pos).indexOf("//") !== -1;
}

function replaceFunctionCalls(code, oldName, newName) {
  var result = "";
  var idx = 0;
  var lastIdx = 0;
  var searchStr = oldName + "(";

  while ((idx = code.indexOf(searchStr, lastIdx)) !== -1) {
    var prevChar = idx > 0 ? code.charAt(idx - 1) : "";

    // 确保不是标识符的一部分，且不在注释中
    if (!isIdentifierChar(prevChar) && !isInComment(code, idx)) {
      result += code.substring(lastIdx, idx) + newName + "(";
      lastIdx = idx + oldName.length + 1;
    } else {
      result += code.substring(lastIdx, idx + 1);
      lastIdx = idx + 1;
    }
  }

  return result + code.substring(lastIdx);
}
