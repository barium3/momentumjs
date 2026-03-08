// ----------------------------------------
// Core
// 负责主合成 / 预合成创建、engine 表达式生成与图层装配
// ----------------------------------------

function isArray(arg) {
  return Object.prototype.toString.call(arg) === "[object Array]";
}

var engineLayer = null;
var engineComp = null;
var shapeQueue = [];
var setupComp = null;
var drawComp = null;
var setupShapeQueue = [];
var drawShapeQueue = [];
var mainCompName = null;
var _globalRenderIndex = null;

var DEFAULT_COMP_DURATION = 10;

function _findProjectItemByName(name, predicate) {
  for (var i = 1; i <= app.project.items.length; i++) {
    var item = app.project.items[i];
    if (!item || item.name !== name) continue;
    if (!predicate || predicate(item)) return item;
  }
  return null;
}

function _uniqueProjectItemName(baseName, fallbackName, predicate) {
  var name = baseName && baseName.length ? baseName : fallbackName;
  if (!_findProjectItemByName(name, predicate)) {
    return name;
  }

  var counter = 1;
  do {
    var newName = name + " " + counter;
    if (!_findProjectItemByName(newName, predicate)) {
      return newName;
    }
    counter++;
  } while (counter < 10000);

  return name + " " + new Date().getTime();
}

function getUniqueCompName(baseName) {
  return _uniqueProjectItemName(baseName, "New Composition");
}

function getUniqueFolderName(baseName) {
  return _uniqueProjectItemName(baseName, "New Folder", function (item) {
    return item instanceof FolderItem;
  });
}

function createCompFolder(folderName) {
  return app.project.items.addFolder(getUniqueFolderName(folderName));
}

function isRegistryAvailable() {
  return typeof functionRegistry !== "undefined" && functionRegistry !== null;
}

function setCompBackgroundColor(comp, hasSetupOrDraw) {
  if (hasSetupOrDraw) {
    comp.bgColor = [1, 1, 1];
  } else {
    comp.bgColor = [200 / 255, 200 / 255, 200 / 255];
  }
}

function _parseJSONArg(arg) {
  if (arg === undefined || arg === null || arg === "null") return null;
  try {
    return typeof arg === "string" ? JSON.parse(arg) : arg;
  } catch (e) {
    return null;
  }
}

function _parseRenderLayersArg(arg) {
  var parsed = _parseJSONArg(arg);
  return isArray(parsed) ? parsed : null;
}

function _mergeShapeCounts(queue) {
  var counts = {};
  for (var i = 0; i < queue.length; i++) {
    var item = queue[i];
    if (!item || !item.type) continue;
    if (!counts[item.type]) counts[item.type] = 0;
    counts[item.type]++;
  }
  return counts;
}

function _countBackgroundItems(renderLayers) {
  var count = 0;
  if (!renderLayers || !isArray(renderLayers)) return count;
  for (var i = 0; i < renderLayers.length; i++) {
    var item = renderLayers[i];
    if (!item) continue;
    if (typeof item === "string") {
      if (item === "background") count++;
      continue;
    }
    if (item.type === "background") {
      count += typeof item.count === "number" ? item.count : 1;
    }
  }
  return count;
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
  hasSetupOrDrawArg,
  drawBackgroundCountArg,
  drawNeedsEchoArg,
  fontMetricsArg,
  imageMetadataArg,
) {
  try {
    shapeQueue = [];
    setupShapeQueue = [];
    drawShapeQueue = [];
    setupComp = null;
    drawComp = null;
    _globalRenderIndex = {};

    var parsedSetupRenderLayers = _parseRenderLayersArg(setupRenderLayersArg);
    var parsedDrawRenderLayers = _parseRenderLayersArg(drawRenderLayersArg);

    if (parsedSetupRenderLayers || parsedDrawRenderLayers) {
      if (parsedSetupRenderLayers && parsedSetupRenderLayers.length > 0) {
        setupShapeQueue = processRenderLayers(parsedSetupRenderLayers);
      }
      if (parsedDrawRenderLayers && parsedDrawRenderLayers.length > 0) {
        drawShapeQueue = processRenderLayers(parsedDrawRenderLayers);
      }
      shapeQueue = setupShapeQueue.concat(drawShapeQueue);
    }

    var parsedFontMetrics = _parseJSONArg(fontMetricsArg);
    var parsedImageMetadata = _parseJSONArg(imageMetadataArg);

    var combinedCodeForTables =
      String(globalCode || "") +
      "\n" +
      String(setupCode || "") +
      "\n" +
      String(drawCode || "");
    var parsedTableData = collectTableDataFromCode(combinedCodeForTables);
    var parsedJSONData = collectJSONDataFromCode(combinedCodeForTables);

    var env = extractEnvironmentConfig(
      setupCode,
      compName,
      compWidth,
      compHeight,
      compFrameRate,
    );
    var uniqueMainCompName = getUniqueCompName(env.name);
    engineComp = m.composition(
      uniqueMainCompName,
      env.width,
      env.height,
      1,
      DEFAULT_COMP_DURATION,
      env.frameRate,
    );
    var hasSetupOrDraw =
      hasSetupOrDrawArg !== undefined && hasSetupOrDrawArg !== null
        ? Boolean(hasSetupOrDrawArg)
        : false;
    setCompBackgroundColor(engineComp, hasSetupOrDraw);

    var compFolder = createCompFolder(uniqueMainCompName);
    engineComp.parentFolder = compFolder;

    var hasDraw = drawCode && drawCode.length > 0;
    var hasSetup = setupCode && setupCode.length > 0;
    var hasGlobal = globalCode && globalCode.length > 0;

    if (!hasDraw && !hasSetup && hasGlobal) {
      setupCode = globalCode;
      globalCode = "";
      hasSetup = true;
    }

    if (!hasDraw) {
      drawCode = "// Empty draw function";
    }

    if (!hasDraw && !hasSetup && !hasGlobal) {
      throw new Error("No code provided");
    }

    var deps = _parseJSONArg(dependenciesArg);
    var useSeparatedComps =
      setupShapeQueue.length > 0 || drawShapeQueue.length > 0;

    if (useSeparatedComps) {
      mainCompName = uniqueMainCompName;

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
        setCompBackgroundColor(setupComp, hasSetupOrDraw);

        setupComp.parentFolder = compFolder;

        var originalEngineComp = engineComp;
        engineComp = setupComp;
        shapeQueue = setupShapeQueue;
        createShapeLayers(mainCompName, compFolder);
        engineComp = originalEngineComp;
        shapeQueue = [];
      }

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
        setCompBackgroundColor(drawComp, hasSetupOrDraw);

        drawComp.parentFolder = compFolder;

        var originalEngineComp2 = engineComp;
        engineComp = drawComp;
        shapeQueue = drawShapeQueue;
        createShapeLayers(mainCompName, compFolder);

        engineComp = originalEngineComp2;
        shapeQueue = [];
      }

      var allShapesQueue = setupShapeQueue.concat(drawShapeQueue);
      var mergedShapeCounts = _mergeShapeCounts(allShapesQueue);
      var originalShapeQueue = shapeQueue;
      shapeQueue = [];
      createEngineLayer(
        drawCode || "",
        setupCode || "",
        globalCode || "",
        deps,
        null,
        mergedShapeCounts,
        allShapesQueue,
        parsedFontMetrics,
        parsedImageMetadata,
        parsedTableData,
        parsedJSONData,
      );
      ensureImageSampleLayers(parsedImageMetadata, compFolder, engineComp);
      shapeQueue = originalShapeQueue;

      if (setupComp) {
        var setupLayer = engineComp.layers.add(setupComp);
        setupLayer.name = "__setup__";
        setupLayer.startTime = 0;
      }
      if (drawComp) {
        var drawLayer = engineComp.layers.add(drawComp);
        drawLayer.name = "__draw__";
        drawLayer.startTime = 0;

        var drawBackgroundCount = 0;
        if (
          typeof drawBackgroundCountArg === "number" &&
          !isNaN(drawBackgroundCountArg)
        ) {
          drawBackgroundCount = Math.max(0, drawBackgroundCountArg);
        } else if (parsedDrawRenderLayers) {
          drawBackgroundCount = _countBackgroundItems(parsedDrawRenderLayers);
        }

        var drawNeedsEcho =
          drawNeedsEchoArg !== undefined && drawNeedsEchoArg !== null
            ? !!drawNeedsEchoArg
            : drawBackgroundCount === 0;

        if (drawNeedsEcho) {
          addEchoEffect(
            drawLayer,
            engineComp,
            uniqueMainCompName,
            drawBackgroundCount,
          );
        }
      }

      controllerSliderCount = setupControllersFromConfigs(engineComp, null);
      engineComp.openInViewer();
    } else {
      mainCompName = uniqueMainCompName;

      var mergedShapeCounts = _mergeShapeCounts(shapeQueue);

      createEngineLayer(
        drawCode || "",
        setupCode || "",
        globalCode || "",
        deps,
        null,
        mergedShapeCounts,
        shapeQueue,
        parsedFontMetrics,
        parsedImageMetadata,
        parsedTableData,
        parsedJSONData,
      );
      ensureImageSampleLayers(parsedImageMetadata, compFolder, engineComp);

      createShapeLayers(mainCompName, compFolder);

      controllerSliderCount = setupControllersFromConfigs(engineComp, null);
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
  var defaults = {
    name: "New Composition",
    width: 100,
    height: 100,
    pixelAspect: 1,
    duration: 10,
    frameRate: 30,
  };

  var args = arguments;
  var n = args.length;
  if (n >= 1) defaults.name = typeof name === "string" ? name : String(name);
  if (n >= 2) defaults.width = Number(width);
  if (n >= 3) defaults.height = Number(height);
  if (n >= 4) defaults.pixelAspect = Number(pixelAspect);
  if (n >= 5) defaults.duration = Number(duration);
  if (n >= 6) defaults.frameRate = Number(frameRate);

  var uniqueName = getUniqueCompName(defaults.name);

  var comp = app.project.items.addComp(
    uniqueName,
    defaults.width,
    defaults.height,
    defaults.pixelAspect,
    defaults.duration,
    defaults.frameRate,
  );
  setCompBackgroundColor(comp, false);
  comp.openInViewer();
  return comp;
};

error = pub.error = function (msg) {
  throw new Error(msg);
};

function createEngineLayer(
  drawCode,
  setupCode,
  globalVars,
  deps,
  mainCompNameParam,
  shapeCountsParam,
  shapeQueueParam,
  fontMetricsParam,
  imageMetadataParam,
  tableDataParam,
  jsonDataParam,
) {
  cleanupEngineLayer();

  var ctxLayer = engineComp.layers.addText("");
  ctxLayer.name = "__engine__";
  var textProp = ctxLayer.property("Source Text");

  var processedDraw = drawCode
    ? replaceShapeFunctions(removeConfigFunctions(drawCode))
    : "";
  var processedSetup = setupCode
    ? replaceShapeFunctions(removeConfigFunctions(setupCode))
    : "";
  var processedGlobal = globalVars
    ? replaceShapeFunctions(removeConfigFunctions(globalVars))
    : "";

  var hasDraw =
    drawCode && drawCode.length > 0 && !drawCode.match(/^\/\/\s*Empty/);
  var hasSetup = setupCode && setupCode.length > 0;

  var shapeCounts = {};
  if (shapeCountsParam) {
    shapeCounts = shapeCountsParam;
  } else {
    for (var i = 0; i < shapeQueue.length; i++) {
      var item = shapeQueue[i];
      if (!shapeCounts[item.type]) {
        shapeCounts[item.type] = 0;
      }
      shapeCounts[item.type]++;
    }
  }

  var expr = buildExpression(
    processedDraw,
    processedSetup,
    processedGlobal,
    hasDraw,
    hasSetup,
    shapeCounts,
    deps,
    mainCompNameParam,
    shapeQueueParam,
    fontMetricsParam,
    imageMetadataParam,
    tableDataParam,
    jsonDataParam,
  );

  textProp.expression = expr.join("\n");
  ctxLayer.shy = true;
  ctxLayer.enabled = false;
  ctxLayer.moveToEnd();
  engineComp.hideShyLayers = true;
  engineLayer = ctxLayer;
}

function cleanupEngineLayer() {
  for (var i = 1; i <= engineComp.numLayers; i++) {
    if (engineComp.layer(i).name === "__engine__") {
      engineComp.layer(i).remove();
      break;
    }
  }
}

// renderLayers 使用基础类型的全局递增索引，保证 setup / draw 共用稳定 id。
function processRenderLayers(renderLayersArg) {
  var queue = [];
  if (
    renderLayersArg &&
    isArray(renderLayersArg) &&
    renderLayersArg.length > 0
  ) {
    var renderIndex = _globalRenderIndex || {};
    for (var i = 0; i < renderLayersArg.length; i++) {
      var item = renderLayersArg[i];
      var type = null;

      if (item && typeof item === "object") {
        if (item.type) {
          type = item.type;
        }
      } else if (typeof item === "string") {
        type = item;
      }

      if (!type) {
        continue;
      }

      if (isRegistryAvailable() && functionRegistry.getShapeInfo) {
        var info = functionRegistry.getShapeInfo(type);
        if (info && info.baseType) {
          type = info.baseType;
        }
      }

      if (!renderIndex[type]) {
        renderIndex[type] = 0;
      }
      renderIndex[type]++;

      var typeCode = 0;
      if (
        typeof functionRegistry !== "undefined" &&
        functionRegistry.shapeTypeCode
      ) {
        var map = functionRegistry.shapeTypeCode;
        if (map.hasOwnProperty(type)) {
          typeCode = map[type];
        }
      }

      var id = typeCode * 10000 + renderIndex[type];

      var entry = {
        type: type,
        id: id,
      };

      if (item && typeof item === "object") {
        for (var key in item) {
          if (item.hasOwnProperty(key) && key !== "type") {
            entry[key] = item[key];
          }
        }
      }
      queue.push(entry);
    }
    _globalRenderIndex = renderIndex;
  }
  return queue;
}

function hasKeys(obj) {
  if (!obj) return false;
  for (var key in obj) {
    if (obj.hasOwnProperty(key) && obj[key] !== undefined) return true;
  }
  return false;
}

function buildDepsFromRegistry(categoryDeps, registryKey) {
  var result = {};
  if (isRegistryAvailable() && functionRegistry[registryKey]) {
    var category = functionRegistry[registryKey];
    for (var funcName in category) {
      if (category.hasOwnProperty(funcName)) {
        result[funcName] = categoryDeps[funcName] || false;
      }
    }
  }

  return result;
}

function buildShapeDepsFromRegistry(shapeCounts) {
  var result = {};
  if (isRegistryAvailable() && functionRegistry.shapes) {
    var shapes = functionRegistry.shapes;
    for (var shapeName in shapes) {
      if (shapes.hasOwnProperty(shapeName)) {
        result[shapeName] = (shapeCounts[shapeName] || 0) > 0;
      }
    }
  }

  return result;
}

function detectUsage(code, name) {
  if (!code) return false;
  var pattern = new RegExp("\\b" + name + "\\b");
  return pattern.test(code);
}

function buildExpression(
  processedDraw,
  processedSetup,
  processedGlobal,
  hasDraw,
  hasSetup,
  shapeCounts,
  deps,
  mainCompNameParam,
  shapeQueueParam,
  fontMetricsParam,
  imageMetadataParam,
  tableDataParam,
  jsonDataParam,
) {
  var mathDeps = deps && deps.math ? deps.math : {};
  var transformDeps = deps && deps.transforms ? deps.transforms : {};
  var colorDeps = deps && deps.colors ? deps.colors : {};
  var shapeDeps = deps && deps.shapes ? deps.shapes : {};
  var typographyDeps = deps && deps.typography ? deps.typography : {};
  var controllerDeps = deps && deps.controllers ? deps.controllers : {};
  var tableDeps = deps && deps.tables ? deps.tables : {};

  if (shapeCounts.background > 0) {
    if (!colorDeps.color) colorDeps = colorDeps || {};
    colorDeps.color = true;
  }

  if (shapeCounts.curve > 0) {
    if (!mathDeps._curveTightnessVar) mathDeps = mathDeps || {};
    mathDeps._curveTightnessVar = true;
  }

  if (shapeCounts.text > 0) {
    if (!mathDeps.rectMode) mathDeps = mathDeps || {};
    mathDeps.rectMode = true;
    if (!mathDeps.CORNER) mathDeps.CORNER = true;
  }

  if (hasSetup) {
    if (!mathDeps.randomSeed) mathDeps = mathDeps || {};
    mathDeps.randomSeed = true;
    if (!mathDeps.noiseSeed) mathDeps = mathDeps || {};
    mathDeps.noiseSeed = true;
  }

  var envDeps = deps && deps.environment ? deps.environment : {};

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

  for (var shapeType in shapeCounts) {
    if (shapeCounts[shapeType] > 0) {
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
      var counterName = internalName + "Count";
      expr.push("var " + counterName + " = 0;");
    }
  }

  expr.push(
    "// ========================================",
    "// 环境变量（内部系统）",
    "// ========================================",
    "var fps = 1 / thisComp.frameDuration;",
    "var currentFrame = timeToFrames(time);",
    "var currentTime = time;",
  );

  if (hasKeys(envDeps)) {
    expr.push("// 环境变量库（按需加载）");
    expr.push(getEnvironmentLib(envDeps));
  }

  var fontMetricsMap = {};
  if (fontMetricsParam && typeof fontMetricsParam === "object") {
    fontMetricsMap = fontMetricsParam;
  }

  // 冷数据只供 engine 内部使用，不导出到最终 JSON。
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
  expr.push("  controllers: [],");
  var fontMetricsJson = JSON.stringify(fontMetricsMap);
  var imageMetadataJson = JSON.stringify(
    imageMetadataParam && typeof imageMetadataParam === "object"
      ? imageMetadataParam
      : {},
  );
  var tableDataJson = JSON.stringify(
    tableDataParam && typeof tableDataParam === "object" ? tableDataParam : {},
  );
  var jsonDataJson = JSON.stringify(
    jsonDataParam && typeof jsonDataParam === "object" ? jsonDataParam : {},
  );
  expr.push("  _lastComputedFrame: -1");
  expr.push("};");
  expr.push("var _fm = " + fontMetricsJson + ";");
  expr.push("var _imd = " + imageMetadataJson + ";");
  expr.push("var _td = " + tableDataJson + ";");
  expr.push("var _jd = " + jsonDataJson + ";");
  expr.push("var _shapes = _ctx.shapes;");
  expr.push("var _backgrounds = _ctx.backgrounds;");

  if (hasKeys(controllerDeps)) {
    expr.push("// 控制器库（按需加载）");
    expr.push(
      getControllerLib(buildDepsFromRegistry(controllerDeps, "controllers")),
    );
  }

  if (hasKeys(mathDeps)) {
    expr.push("// 数学库（按需加载）");
    expr.push(getMathLib(buildDepsFromRegistry(mathDeps, "math")));
  }

  if (hasShapes) {
    expr.push("// 变换库（内部函数）");
    expr.push(getTransformationLib({ state: true }));
  }
  if (hasKeys(transformDeps)) {
    expr.push("// 变换库（用户函数）");
    expr.push(
      getTransformationLib(buildDepsFromRegistry(transformDeps, "transforms")),
    );
  }

  if (hasShapes) {
    expr.push("// 颜色库（内部函数）");
    expr.push(getColorLib({ state: true }));
  }
  if (hasKeys(colorDeps)) {
    expr.push("// 颜色库（用户函数）");
    expr.push(getColorLib(buildDepsFromRegistry(colorDeps, "colors")));
  }

  if (hasShapes) {
    expr.push("// 形状函数库（按需加载）");
    expr.push(getShapeLib(buildShapeDepsFromRegistry(shapeCounts)));
  }

  if (shapeCounts && shapeCounts.image > 0) {
    if (!colorDeps.color) colorDeps = colorDeps || {};
    colorDeps.color = true;
    expr.push("// 图像库（按需加载）");
    expr.push(getImageLib({ image: true }));
  }

  if (hasKeys(tableDeps)) {
    expr.push("// IO 库（按需加载）");
    expr.push(getIOLib(buildDepsFromRegistry(tableDeps, "tables")));
  }

  var needsTextShape = shapeCounts && shapeCounts.text > 0;
  var hasTypographyFuncs = hasKeys(typographyDeps);

  if (needsTextShape || hasTypographyFuncs) {
    var typoDepsForLib = {
      text: needsTextShape,
      textSize: !!typographyDeps.textSize,
      textLeading: !!typographyDeps.textLeading,
      textWrap: !!typographyDeps.textWrap,
      textFont: !!typographyDeps.textFont,
      textStyle: !!typographyDeps.textStyle,
      textAlign: !!typographyDeps.textAlign,
      textWidth: !!typographyDeps.textWidth,
      textAscent: !!typographyDeps.textAscent,
      textDescent: !!typographyDeps.textDescent,
      WORD: !!typographyDeps.WORD,
      CHAR: !!typographyDeps.CHAR,
      LEFT: !!typographyDeps.LEFT,
      CENTER: !!typographyDeps.CENTER,
      RIGHT: !!typographyDeps.RIGHT,
      TOP: !!typographyDeps.TOP,
      BOTTOM: !!typographyDeps.BOTTOM,
      BASELINE: !!typographyDeps.BASELINE,
    };
    expr.push("// 排版 / 文本库（按需加载）");
    expr.push(getTypographyLib(typoDepsForLib));
  }

  if (mainCompNameParam) {
    expr.push("// ========================================");
    expr.push("// 跨合成全局变量访问（仅子合成需要）");
    expr.push("// ========================================");
    expr.push("function _getMainCompGlobalVar(varName) {");
    expr.push("  try {");
    expr.push('    var mainComp = comp("' + mainCompNameParam + '");');
    expr.push('    var engineLayer = mainComp.layer("__engine__");');
    expr.push('    var ctxJson = engineLayer.property("Source Text").value;');
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

  if (processedGlobal) {
    expr.push("// Global (变量声明)");
    expr.push(processedGlobal);

    if (mainCompNameParam) {
      var globalVarNames = [];
      var globalLines = processedGlobal.split("\n");
      for (var i = 0; i < globalLines.length; i++) {
        var line = globalLines[i];
        if (line && typeof line === "string") {
          line = line.replace(/^\s+|\s+$/g, "");
          var varMatch = line.match(/^var\s+(\w+)\s*(?:=\s*(.+))?;?$/);
          if (varMatch) {
            globalVarNames.push(varMatch[1]);
          }
        }
      }
      if (globalVarNames.length > 0) {
        expr.push("// 从主合成读取全局变量（仅子合成需要）");
        for (var j = 0; j < globalVarNames.length; j++) {
          var varName = globalVarNames[j];
          expr.push("{");
          expr.push(
            "  var " +
              varName +
              '_main = _getMainCompGlobalVar("' +
              varName +
              '");',
          );
          expr.push(
            "  if (" +
              varName +
              "_main !== undefined) " +
              varName +
              " = " +
              varName +
              "_main;",
          );
          expr.push("}");
        }
      }
    }
  }

  expr.push.apply(
    expr,
    buildFunctionDefinitions(processedSetup, processedDraw, hasSetup, hasDraw),
  );

  expr.push.apply(
    expr,
    buildExecutionLogic(hasDraw, hasSetup, hasShapes, envDeps),
  );

  expr.push(buildPathCreation(hasShapes));

  return expr;
}

function replaceShapeFunctions(code) {
  var funcMap = {};

  if (isRegistryAvailable() && functionRegistry.shapes) {
    for (var name in functionRegistry.shapes) {
      if (functionRegistry.shapes.hasOwnProperty(name)) {
        var info = functionRegistry.shapes[name];
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

function isIdentifierChar(c) {
  return (
    (c >= "a" && c <= "z") ||
    (c >= "A" && c <= "Z") ||
    (c >= "0" && c <= "9") ||
    c === "_"
  );
}

function isInComment(code, pos) {
  for (var i = pos - 1; i >= 0; i--) {
    if (code.charAt(i) === "\n") {
      return code.substring(i + 1, pos).indexOf("//") !== -1;
    }
  }
  return code.substring(0, pos).indexOf("//") !== -1;
}

function replaceFunctionCalls(code, oldName, newName) {
  var result = "";
  var idx = 0;
  var lastIdx = 0;
  var searchStr = oldName + "(";

  while ((idx = code.indexOf(searchStr, lastIdx)) !== -1) {
    var prevChar = idx > 0 ? code.charAt(idx - 1) : "";

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
