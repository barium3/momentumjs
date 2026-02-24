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
var setupComp = null; // setup预合成
var drawComp = null; // draw预合成
var setupShapeQueue = []; // setup中的shape队列
var drawShapeQueue = []; // draw中的shape队列
var mainCompName = null; // 主合成名称（用于跨合成表达式通讯）

// ========================================
// Public API - 公共接口
// ========================================

// 默认合成配置常量
var DEFAULT_COMP_DURATION = 10; // 默认合成时长（秒）

/**
 * 获取唯一的合成名称（如果名称已存在，则添加编号）
 * @param {string} baseName - 基础名称
 * @returns {string} 唯一的合成名称
 */
function getUniqueCompName(baseName) {
  if (!baseName || baseName.length === 0) {
    baseName = "New Composition";
  }
  
  // 检查基础名称是否已存在
  var exists = false;
  for (var i = 1; i <= app.project.items.length; i++) {
    var item = app.project.items[i];
    if (item && item.name === baseName) {
      exists = true;
      break;
    }
  }
  
  // 如果不存在，直接返回
  if (!exists) {
    return baseName;
  }
  
  // 如果存在，尝试添加编号
  var counter = 1;
  var newName;
  do {
    newName = baseName + " " + counter;
    exists = false;
    for (var j = 1; j <= app.project.items.length; j++) {
      var item2 = app.project.items[j];
      if (item2 && item2.name === newName) {
        exists = true;
        break;
      }
    }
    if (!exists) {
      return newName;
    }
    counter++;
  } while (counter < 10000); // 防止无限循环，最多尝试10000次
  
  // 如果10000次都失败（理论上不应该发生），返回带时间戳的名称
  return baseName + " " + new Date().getTime();
}

/**
 * 获取唯一的文件夹名称（如果名称已存在，则添加编号）
 * @param {string} baseName - 基础名称
 * @returns {string} 唯一的文件夹名称
 */
function getUniqueFolderName(baseName) {
  if (!baseName || baseName.length === 0) {
    baseName = "New Folder";
  }
  
  // 检查基础名称是否已存在
  var exists = false;
  for (var i = 1; i <= app.project.items.length; i++) {
    var item = app.project.items[i];
    if (item && item instanceof FolderItem && item.name === baseName) {
      exists = true;
      break;
    }
  }
  
  // 如果不存在，直接返回
  if (!exists) {
    return baseName;
  }
  
  // 如果存在，尝试添加编号
  var counter = 1;
  var newName;
  do {
    newName = baseName + " " + counter;
    exists = false;
    for (var j = 1; j <= app.project.items.length; j++) {
      var item2 = app.project.items[j];
      if (item2 && item2 instanceof FolderItem && item2.name === newName) {
        exists = true;
        break;
      }
    }
    if (!exists) {
      return newName;
    }
    counter++;
  } while (counter < 10000); // 防止无限循环，最多尝试10000次
  
  // 如果10000次都失败（理论上不应该发生），返回带时间戳的名称
  return baseName + " " + new Date().getTime();
}

/**
 * 将合成组织到与主合成同名的文件夹中
 * @param {CompItem} mainComp - 主合成
 * @param {CompItem} setupComp - Setup预合成（可选）
 * @param {CompItem} drawComp - Draw预合成（可选）
 * @param {string} folderName - 文件夹名称（通常与主合成名称相同）
 */
function organizeCompsIntoFolder(mainComp, setupComp, drawComp, folderName) {
  if (!mainComp) {
    return; // 如果没有主合成，不执行
  }
  
  try {
    // 获取唯一的文件夹名称
    var uniqueFolderName = getUniqueFolderName(folderName);
    
    // 创建文件夹
    var folder = app.project.items.addFolder(uniqueFolderName);
    
    // 将主合成移动到文件夹中
    mainComp.parentFolder = folder;
    
    // 将setup合成移动到文件夹中（如果存在）
    if (setupComp) {
      setupComp.parentFolder = folder;
    }
    
    // 将draw合成移动到文件夹中（如果存在）
    if (drawComp) {
      drawComp.parentFolder = folder;
    }
  } catch (e) {
    // 如果组织文件夹失败，不影响主流程，静默处理
    // 可以在这里添加日志记录，但不抛出错误
  }
}


/**
 * 检查 registry 是否可用
 * @returns {boolean} registry 是否可用
 */
function isRegistryAvailable() {
  return typeof functionRegistry !== "undefined" && functionRegistry !== null;
}

/**
 * 设置合成背景色
 * @param {CompItem} comp - 合成对象
 * @param {boolean} hasSetupOrDraw - 是否有 setup 或 draw 函数
 */
function setCompBackgroundColor(comp, hasSetupOrDraw) {
  if (hasSetupOrDraw) {
    // 纯白色 RGB(255, 255, 255)
    comp.bgColor = [1, 1, 1];
  } else {
    // p5.js 默认灰色 RGB(200, 200, 200)
    // After Effects 中颜色值范围是 0-1
    comp.bgColor = [200 / 255, 200 / 255, 200 / 255];
  }
}


pub.runParsed = function (
  drawCode,
  setupCode,
  globalCode,
  compName,
  compWidth,
  compHeight,
  compFrameRate,
  dependenciesArg,
  setupRenderLayersArg,
  drawRenderLayersArg,
  hasBackgroundWithoutOpacityArg,
  hasSetupOrDrawArg,
) {
  try {
    // 1. 初始化变量
    shapeQueue = [];
    setupShapeQueue = [];
    drawShapeQueue = [];
    setupComp = null;
    drawComp = null;

    // 2. 解析renderLayers参数（可能是字符串或对象）
    var parsedSetupRenderLayers = null;
    var parsedDrawRenderLayers = null;
    
    try {
      if (typeof setupRenderLayersArg === "string" && setupRenderLayersArg !== "null") {
        parsedSetupRenderLayers = JSON.parse(setupRenderLayersArg);
      } else if (isArray(setupRenderLayersArg)) {
        parsedSetupRenderLayers = setupRenderLayersArg;
      }
    } catch (e) {
      parsedSetupRenderLayers = null;
    }

    try {
      if (typeof drawRenderLayersArg === "string" && drawRenderLayersArg !== "null") {
        parsedDrawRenderLayers = JSON.parse(drawRenderLayersArg);
      } else if (isArray(drawRenderLayersArg)) {
        parsedDrawRenderLayers = drawRenderLayersArg;
      }
    } catch (e) {
      parsedDrawRenderLayers = null;
    }

    // 3. 处理前端传递的 renderLayers（仅使用新的分别分析结果）
    if (parsedSetupRenderLayers || parsedDrawRenderLayers) {
      // 使用新的分别分析结果
      if (parsedSetupRenderLayers && isArray(parsedSetupRenderLayers) && parsedSetupRenderLayers.length > 0) {
        setupShapeQueue = processRenderLayers(parsedSetupRenderLayers);
      }
      if (parsedDrawRenderLayers && isArray(parsedDrawRenderLayers) && parsedDrawRenderLayers.length > 0) {
        drawShapeQueue = processRenderLayers(parsedDrawRenderLayers);
      }
      // 合并到shapeQueue，供后续统计使用
      shapeQueue = setupShapeQueue.concat(drawShapeQueue);
    }

    // 提取环境配置并创建合成
    var env = extractEnvironmentConfig(
      setupCode,
      compName,
      compWidth,
      compHeight,
      compFrameRate,
    );
    // 获取唯一的合成名称
    var uniqueMainCompName = getUniqueCompName(env.name);
    engineComp = m.composition(
      uniqueMainCompName,
      env.width,
      env.height,
      1,
      DEFAULT_COMP_DURATION,
      env.frameRate,
    );
    // 根据前端 AST 判断：当有 setup 或 draw 时，设置合成背景色为纯白色
    // 否则使用 p5.js 默认灰色 RGB(200, 200, 200)
    var hasSetupOrDraw = hasSetupOrDrawArg !== undefined && hasSetupOrDrawArg !== null 
      ? Boolean(hasSetupOrDrawArg) 
      : false;
    setCompBackgroundColor(engineComp, hasSetupOrDraw);

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

    // 9. 解析依赖信息
    var deps = null;
    try {
      deps =
        typeof dependenciesArg === "string"
          ? JSON.parse(dependenciesArg)
          : dependenciesArg;
    } catch (e) {
      deps = null;
    }

    // 10. 解析 hasBackgroundWithoutOpacity 参数（前端 AST 分析结果）
    var hasBackgroundWithoutOpacity = false;
    if (hasBackgroundWithoutOpacityArg !== undefined && hasBackgroundWithoutOpacityArg !== null) {
      hasBackgroundWithoutOpacity = Boolean(hasBackgroundWithoutOpacityArg);
    }

    // 11. 根据是否有分别分析结果，决定创建方式
    var useSeparatedComps = setupShapeQueue.length > 0 || drawShapeQueue.length > 0;
    
    if (useSeparatedComps) {
      // 新架构：分别创建setup和draw预合成
      
      // 设置主合成名称（用于跨合成表达式通讯）
      mainCompName = uniqueMainCompName;
      
      // 创建setup预合成（如果有setup中的shape）
      if (setupShapeQueue.length > 0 && hasSetup) {
        var setupCompName = getUniqueCompName(uniqueMainCompName + "_Setup");
        setupComp = app.project.items.addComp(
          setupCompName,
          env.width,
          env.height,
          1,
          DEFAULT_COMP_DURATION, // setup合成时长与主合成一致
          env.frameRate,
        );
        // 根据前端 AST 判断：当有 setup 或 draw 时，设置合成背景色为纯白色
        setCompBackgroundColor(setupComp, hasSetupOrDraw);
        
        // 临时设置engineComp为setupComp，创建setup中的图层
        var originalEngineComp = engineComp;
        engineComp = setupComp;
        shapeQueue = setupShapeQueue;
        // 子合成中不创建engine图层，渲染图层通过表达式引用父合成的engine
        createShapeLayers(mainCompName);
        engineComp = originalEngineComp;
        shapeQueue = [];
      }
      
      // 创建draw预合成（如果有draw中的shape）
      if (drawShapeQueue.length > 0 && hasDraw) {
        var drawCompName = getUniqueCompName(uniqueMainCompName + "_Draw");
        drawComp = app.project.items.addComp(
          drawCompName,
          env.width,
          env.height,
          1,
          DEFAULT_COMP_DURATION,
          env.frameRate,
        );
        // 根据前端 AST 判断：当有 setup 或 draw 时，设置合成背景色为纯白色
        setCompBackgroundColor(drawComp, hasSetupOrDraw);
        
        // 临时设置engineComp为drawComp，创建draw中的图层
        var originalEngineComp2 = engineComp;
        engineComp = drawComp;
        shapeQueue = drawShapeQueue;
        // 子合成中不创建engine图层，渲染图层通过表达式引用父合成的engine
        createShapeLayers(mainCompName);
        
        engineComp = originalEngineComp2;
        shapeQueue = [];
      }
      
      // 在主合成中创建engine图层（用于全局代码和协调）
      // 合并所有子合成中的图形信息，用于统计 shapeCounts
      var allShapesQueue = setupShapeQueue.concat(drawShapeQueue);
      var mergedShapeCounts = {};
      for (var i = 0; i < allShapesQueue.length; i++) {
        var item = allShapesQueue[i];
        if (!mergedShapeCounts[item.type]) {
          mergedShapeCounts[item.type] = 0;
        }
        mergedShapeCounts[item.type]++;
      }
      // 恢复shapeQueue为空，因为主合成不需要创建shape图层
      var originalShapeQueue = shapeQueue;
      shapeQueue = [];
      // 主合成的 __engine__ 图层需要执行所有代码（setup + draw），以便生成 shapes 数据
      // 子合成中的形状图层会通过表达式从主合成的 __engine__ 图层读取数据
      // 主合成中的 engine 图层不需要跨合成访问，传入 null
      createEngineLayer(drawCode || "", setupCode || "", globalCode || "", deps, null, mergedShapeCounts);
      shapeQueue = originalShapeQueue;
      
      // 在主合成中添加预合成图层
      if (setupComp) {
        var setupLayer = engineComp.layers.add(setupComp);
        setupLayer.name = "__setup__";
        setupLayer.startTime = 0;
      }
      if (drawComp) {
        var drawLayer = engineComp.layers.add(drawComp);
        drawLayer.name = "__draw__";
        drawLayer.startTime = 0;
        
        // 计算draw中background的数量
        var drawBackgroundCount = 0;
        if (parsedDrawRenderLayers && isArray(parsedDrawRenderLayers)) {
          for (var i = 0; i < parsedDrawRenderLayers.length; i++) {
            if (parsedDrawRenderLayers[i].type === "background") {
              drawBackgroundCount = parsedDrawRenderLayers[i].count || 0;
              break;
            }
          }
        }
        
        // 添加Echo效果来模拟draw中的透明background拖尾效果
        // 如果draw中有background且没有不透明度参数，则不添加残影（由前端AST分析决定）
        if (!hasBackgroundWithoutOpacity) {
          addEchoEffect(drawLayer, engineComp, uniqueMainCompName, drawBackgroundCount);
        }
      }
      
      // 组织合成到文件夹中
      organizeCompsIntoFolder(engineComp, setupComp, drawComp, uniqueMainCompName);
      
      // 最终跳转到主合成
      engineComp.openInViewer();
    } else {
      // 没有分别分析结果时，使用新架构但只在主合成中创建图层
      mainCompName = uniqueMainCompName;
      
      // 合并所有图形信息用于统计
      var mergedShapeCounts = {};
      for (var i = 0; i < shapeQueue.length; i++) {
        var item = shapeQueue[i];
        if (!mergedShapeCounts[item.type]) {
          mergedShapeCounts[item.type] = 0;
        }
        mergedShapeCounts[item.type]++;
      }
      
      // 在主合成中创建engine图层
      // 主合成中的 engine 图层不需要跨合成访问，传入 null
      createEngineLayer(drawCode || "", setupCode || "", globalCode || "", deps, null, mergedShapeCounts);
      
      // 在主合成中创建shape图层
      createShapeLayers(mainCompName);
      
      // 组织合成到文件夹中
      organizeCompsIntoFolder(engineComp, null, null, uniqueMainCompName);
      
      // 最终跳转到主合成
      engineComp.openInViewer();
    }
  } catch (e) {
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
  // 默认配置（与 p5.js 一致）
  var defaults = {
    name: "New Composition",
    width: 100,
    height: 100,
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

  // 获取唯一的合成名称
  var uniqueName = getUniqueCompName(defaults.name);
  
  // 创建合成并打开查看器
  var comp = app.project.items.addComp(
    uniqueName,
    defaults.width,
    defaults.height,
    defaults.pixelAspect,
    defaults.duration,
    defaults.frameRate,
  );
  // 设置合成背景色为 p5.js 默认灰色（pub.composition 默认没有 setup/draw）
  setCompBackgroundColor(comp, false);
  comp.openInViewer();
  return comp;
};

error = pub.error = function (msg) {
  throw new Error(msg);
};

// ========================================
// Engine Layer - 引擎图层
// ========================================

function createEngineLayer(drawCode, setupCode, globalVars, deps, mainCompNameParam, shapeCountsParam) {
  // 1. 清理已存在的 __engine__ 图层
  cleanupEngineLayer();

  // 2. 创建新的引擎图层（使用 Text 作为上下文载体）
  var ctxLayer = engineComp.layers.addText("");
  ctxLayer.name = "__engine__";

  // Text 图层的 Source Text 属性承载 JSON 上下文
  var textProp = ctxLayer.property("Source Text");

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
  // 如果传入了 shapeCountsParam，使用它；否则从 shapeQueue 统计
  var shapeCounts = {};
  if (shapeCountsParam) {
    // 使用传入的 shapeCounts（合并了所有子合成的图形信息）
    shapeCounts = shapeCountsParam;
  } else {
    // 从 shapeQueue 统计（向后兼容）
    for (var i = 0; i < shapeQueue.length; i++) {
      var item = shapeQueue[i];
      if (!shapeCounts[item.type]) {
        shapeCounts[item.type] = 0;
      }
      shapeCounts[item.type]++;
    }
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
    mainCompNameParam,
  );

  // 6. 应用表达式并设置图层属性（Source Text 表达式返回 JSON 字符串）
  textProp.expression = expr.join("\n");
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
 * 处理renderLayers数组，构建shapeQueue
 * @param {Array} renderLayersArg - renderLayers数组
 * @returns {Array} shapeQueue数组
 */
function processRenderLayers(renderLayersArg) {
  var queue = [];
  if (
    renderLayersArg &&
    isArray(renderLayersArg) &&
    renderLayersArg.length > 0
  ) {
    var renderIndex = 0;

    // 支持精确调用序列格式：
    // ["ellipse", "rect", "ellipse", ...] 或 [{ type: "ellipse" }, { type: "rect" }, ...]
    for (var i = 0; i < renderLayersArg.length; i++) {
      var item = renderLayersArg[i];
      var type = null;

      // 对象格式：{ type: "ellipse" }
      if (item && typeof item === "object") {
        if (item.type) {
          type = item.type;
        }
      } else if (typeof item === "string") {
        // 字符串格式："ellipse"
        type = item;
      }

      // 无法识别的条目直接跳过
      if (!type) {
        continue;
      }

      // 归一化到基础类型（circle -> ellipse, square -> rect, ...）
      // 保证后续 createShapeLayers 的 creator map 可以命中
      if (isRegistryAvailable() && functionRegistry.getShapeInfo) {
        var info = functionRegistry.getShapeInfo(type);
        if (info && info.baseType) {
          type = info.baseType;
        }
      }

      // 计算该类型的调用次数，用于生成稳定的 id（类型前缀 + 调用次数）
      if (!renderIndex) {
        renderIndex = {};
      }
      if (!renderIndex[type]) {
        renderIndex[type] = 0;
      }
      renderIndex[type]++;

      // 从 registry 中读取各基础图形类型的前缀编码（1xxxx = ellipse, 2xxxx = rect, ...）
      var typeCode = 0;
      if (typeof functionRegistry !== "undefined" && functionRegistry.shapeTypeCode) {
        var map = functionRegistry.shapeTypeCode;
        if (map.hasOwnProperty(type)) {
          typeCode = map[type];
        }
      }

      var id = typeCode * 10000 + renderIndex[type];

      queue.push({
        type: type,
        id: id,
      });
    }
  }
  return queue;
}

// （已废弃）静态 renderIndex 注入逻辑已移除，运行时改为简单顺序 index

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
  mainCompNameParam,
) {
  // 解析依赖对象
  var mathDeps = deps && deps.math ? deps.math : {};
  var transformDeps = deps && deps.transforms ? deps.transforms : {};
  var colorDeps = deps && deps.colors ? deps.colors : {};
  var shapeDeps = deps && deps.shapes ? deps.shapes : {};

  // background 依赖 color()，确保加载 color 函数
  if (shapeCounts.background > 0) {
    if (!colorDeps.color) colorDeps = colorDeps || {};
    colorDeps.color = true;
  }

  // curve 依赖 _curveTightness 变量，确保加载该变量
  if (shapeCounts.curve > 0) {
    if (!mathDeps._curveTightnessVar) mathDeps = mathDeps || {};
    mathDeps._curveTightnessVar = true;
  }

  // setup 函数中自动调用 randomSeed() 和 noiseSeed()，确保这两个函数始终被注入
  if (hasSetup) {
    if (!mathDeps.randomSeed) mathDeps = mathDeps || {};
    mathDeps.randomSeed = true;
    if (!mathDeps.noiseSeed) mathDeps = mathDeps || {};
    mathDeps.noiseSeed = true;
  }

  // 环境依赖：由前端的 parseConstantsAndVariables 统一处理
  var envDeps = deps && deps.environment ? deps.environment : {};

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

  // 上下文对象：统一承载环境信息与渲染结果（语义化 JSON）
  // - version: 协议版本，便于未来演进
  // - fps/frame/time: 当前合成播放状态
  // - env: 环境信息（frameCount/width/height）
  // - shapes: 形状对象数组（由形状库填充）
  // - backgrounds: 背景对象数组（由 background 库填充）
  // - globals: 全局变量对象（用于跨合成访问）
  expr.push("var _ctx = {");
  expr.push("  version: 1,");
  expr.push("  fps: fps,");
  expr.push("  frame: currentFrame,");
  expr.push("  time: currentTime,");
  expr.push(
    "  env: { frameCount: currentFrame, width: thisComp.width, height: thisComp.height },",
  );
  expr.push("  shapes: [],");
  expr.push("  backgrounds: [],");
  expr.push("  globals: {},");
  expr.push("  _lastComputedFrame: -1  // 帧循环缓存：记录上次计算的帧号");
  expr.push("};");
  expr.push("var _shapes = _ctx.shapes;");
  expr.push("var _backgrounds = _ctx.backgrounds;");

  // 按需加载数学库（每个函数单独判断）
  if (hasKeys(mathDeps)) {
    expr.push("// 数学库（按需加载）");
    // 从 registry 自动构建数学依赖对象，每个函数单独加载
    expr.push(getMathLib(buildDepsFromRegistry(mathDeps, "math")));
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
  // state 模式：只加载形状函数需要的内部函数（颜色状态 + _encodeColorState）
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

  // 跨合成全局变量访问支持（仅在子合成中生成，主合成不需要）
  // 主合成中的 engine 图层直接使用本地全局变量，不需要跨合成访问
  if (mainCompNameParam) {
    expr.push("// ========================================");
    expr.push("// 跨合成全局变量访问（仅子合成需要）");
    expr.push("// ========================================");
    expr.push("function _getMainCompGlobalVar(varName) {");
    expr.push("  try {");
    expr.push("    var mainComp = comp(\"" + mainCompNameParam + "\");");
    expr.push("    var engineLayer = mainComp.layer(\"__engine__\");");
    expr.push("    var ctxJson = engineLayer.property(\"Source Text\").value;");
    expr.push("    var ctx = JSON.parse(ctxJson);");
    expr.push("    if (ctx.globals && ctx.globals.hasOwnProperty(varName)) {");
    expr.push("      return ctx.globals[varName];");
    expr.push("    }");
    expr.push("    return undefined;");
    expr.push("  } catch (e) {");
    expr.push("    return undefined;");
    expr.push("  }");
    expr.push("}");
    expr.push("");
  }

  // 全局变量
  if (processedGlobal) {
    expr.push("// Global (变量声明)");
    expr.push(processedGlobal);
    
    // 如果是在子合成中，在执行逻辑之前从主合成读取全局变量
    // 主合成中的 engine 图层不需要此逻辑，因为全局变量就在本地
    if (mainCompNameParam) {
      // 解析全局变量声明，提取变量名
      var globalVarNames = [];
      var globalLines = processedGlobal.split("\n");
      for (var i = 0; i < globalLines.length; i++) {
        var line = globalLines[i];
        if (line && typeof line === "string") {
          // ExtendScript 兼容的 trim 方法
          line = line.replace(/^\s+|\s+$/g, "");
          // 匹配变量声明：var variableName = value; 或 var variableName;
          var varMatch = line.match(/^var\s+(\w+)\s*(?:=\s*(.+))?;?$/);
          if (varMatch) {
            globalVarNames.push(varMatch[1]);
          }
        }
      }
      // 在执行逻辑之前，从主合成读取全局变量并覆盖本地变量
      if (globalVarNames.length > 0) {
        expr.push("// 从主合成读取全局变量（仅子合成需要）");
        for (var j = 0; j < globalVarNames.length; j++) {
          var varName = globalVarNames[j];
          expr.push("{");
          expr.push("  var " + varName + "_main = _getMainCompGlobalVar(\"" + varName + "\");");
          expr.push("  if (" + varName + "_main !== undefined) " + varName + " = " + varName + "_main;");
          expr.push("}");
        }
      }
    }
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
