// Core composition and engine assembly for Momentum sketches.
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
var DEFAULT_COMP_DURATION = 10;

function hasProjectItemNamed(name, itemClass) {
  for (var i = 1; i <= app.project.items.length; i++) {
    var item = app.project.items[i];
    if (!item || item.name !== name) continue;
    if (!itemClass || item instanceof itemClass) return true;
  }
  return false;
}

function getUniqueProjectItemName(baseName, fallbackName, itemClass) {
  var name = baseName && baseName.length ? baseName : fallbackName;
  if (!hasProjectItemNamed(name, itemClass)) return name;

  for (var counter = 1; counter < 10000; counter++) {
    var nextName = name + " " + counter;
    if (!hasProjectItemNamed(nextName, itemClass)) return nextName;
  }
  return name + " " + new Date().getTime();
}

function getUniqueCompName(baseName) {
  return getUniqueProjectItemName(baseName, "New Composition", null);
}

function getUniqueFolderName(baseName) {
  return getUniqueProjectItemName(baseName, "New Folder", FolderItem);
}

function createCompFolder(folderName) {
  var uniqueFolderName = getUniqueFolderName(folderName);
  return app.project.items.addFolder(uniqueFolderName);
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

function createManagedComp(
  name,
  width,
  height,
  duration,
  frameRate,
  folder,
  hasSetupOrDraw
) {
  var comp = app.project.items.addComp(
    name,
    width,
    height,
    1,
    duration,
    frameRate
  );
  setCompBackgroundColor(comp, hasSetupOrDraw);
  if (folder) comp.parentFolder = folder;
  return comp;
}

function parseMaybeJSONArg(value) {
  try {
    if (typeof value === "string" && value !== "null") {
      return JSON.parse(value);
    }
    if (typeof value === "object" && value !== null) {
      return value;
    }
  } catch (e) {}
  return null;
}

function parseRenderLayersArg(value) {
  var parsed = parseMaybeJSONArg(value);
  return isArray(parsed) ? parsed : null;
}

function countShapesByType(queue) {
  var counts = {};
  var items = queue || [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!item || !item.type) continue;
    if (!counts[item.type]) counts[item.type] = 0;
    counts[item.type]++;
  }
  return counts;
}

function resolveDrawBackgroundCount(drawBackgroundCountArg, renderLayers) {
  if (
    typeof drawBackgroundCountArg === "number" &&
    !isNaN(drawBackgroundCountArg)
  ) {
    return Math.max(0, drawBackgroundCountArg);
  }

  var count = 0;
  var items = isArray(renderLayers) ? renderLayers : [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!item || typeof item !== "object") continue;

    if (item.type === "background") {
      count += typeof item.count === "number" ? item.count : 1;
    }
  }
  return count;
}

function joinIOCode(
  globalCode,
  preloadFullCodeArg,
  setupCode,
  drawCode
) {
  return (
    String(globalCode || "") +
    "\n" +
    String(preloadFullCodeArg || "") +
    "\n" +
    String(setupCode || "") +
    "\n" +
    String(drawCode || "")
  );
}

function createEngineTextLayer(
  drawCode,
  setupCode,
  globalCode,
  drawFullCodeArg,
  setupFullCodeArg,
  preloadFullCodeArg,
  deps,
  shapeCounts,
  parsedFontMetrics,
  parsedImageMetadata,
  parsedTableData,
  parsedJSONData,
  parsedGlobalVarNames
) {
  createEngineLayer(
    drawCode || "",
    setupCode || "",
    globalCode || "",
    drawFullCodeArg || "",
    setupFullCodeArg || "",
    preloadFullCodeArg || "",
    deps,
    null,
    shapeCounts,
    parsedFontMetrics,
    parsedImageMetadata,
    parsedTableData,
    parsedJSONData,
    parsedGlobalVarNames
  );
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
  setupFullCodeArg,
  drawFullCodeArg,
  preloadFullCodeArg,
  globalVarNamesArg
) {
  try {
    shapeQueue = [];
    setupShapeQueue = [];
    drawShapeQueue = [];
    setupComp = null;
    drawComp = null;

    var parsedSetupRenderLayers = parseRenderLayersArg(setupRenderLayersArg);
    var parsedDrawRenderLayers = parseRenderLayersArg(drawRenderLayersArg);

    if (parsedSetupRenderLayers || parsedDrawRenderLayers) {
      if (
        parsedSetupRenderLayers &&
        isArray(parsedSetupRenderLayers) &&
        parsedSetupRenderLayers.length > 0
      ) {
        setupShapeQueue = processRenderLayers(parsedSetupRenderLayers);
      }
      if (
        parsedDrawRenderLayers &&
        isArray(parsedDrawRenderLayers) &&
        parsedDrawRenderLayers.length > 0
      ) {
        drawShapeQueue = processRenderLayers(parsedDrawRenderLayers);
      }
      shapeQueue = setupShapeQueue.concat(drawShapeQueue);
    }

    var parsedFontMetrics = parseMaybeJSONArg(fontMetricsArg);
    var parsedImageMetadata = parseMaybeJSONArg(imageMetadataArg);
    var parsedGlobalVarNames = parseMaybeJSONArg(globalVarNamesArg);

    var combinedCodeForTables = joinIOCode(
      globalCode,
      preloadFullCodeArg,
      setupCode,
      drawCode
    );
    var parsedTableData = collectTableDataFromCode(combinedCodeForTables);
    var parsedJSONData = collectJSONDataFromCode(combinedCodeForTables);

    var configCode = String(globalCode || "") + "\n" + String(setupCode || "");
    var env = extractEnvironmentConfig(
      configCode,
      compName,
      compWidth,
      compHeight,
      compFrameRate
    );
    var compDuration = env.duration || DEFAULT_COMP_DURATION;
    var uniqueMainCompName = getUniqueCompName(env.name);
    engineComp = m.composition(
      uniqueMainCompName,
      env.width,
      env.height,
      1,
      compDuration,
      env.frameRate
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

    var deps = null;
    try {
      deps =
        typeof dependenciesArg === "string"
          ? JSON.parse(dependenciesArg)
          : dependenciesArg;
    } catch (e) {
      deps = null;
    }
    var useSeparatedComps =
      setupShapeQueue.length > 0 || drawShapeQueue.length > 0;

    if (useSeparatedComps) {
      mainCompName = uniqueMainCompName;

      if (setupShapeQueue.length > 0 && hasSetup) {
        var setupCompName = getUniqueCompName(uniqueMainCompName + "_Setup");
        setupComp = createManagedComp(
          setupCompName,
          env.width,
          env.height,
          compDuration,
          env.frameRate,
          compFolder,
          hasSetupOrDraw
        );
      }

      if (drawShapeQueue.length > 0 && hasDraw) {
        var drawCompName = getUniqueCompName(uniqueMainCompName + "_Draw");
        drawComp = createManagedComp(
          drawCompName,
          env.width,
          env.height,
          compDuration,
          env.frameRate,
          compFolder,
          hasSetupOrDraw
        );
      }

      if (setupComp && setupShapeQueue.length > 0 && hasSetup) {
        var originalEngineComp = engineComp;
        engineComp = setupComp;
        shapeQueue = setupShapeQueue;
        createShapeLayers(mainCompName, compFolder);
        engineComp = originalEngineComp;
        shapeQueue = [];
      }

      if (drawComp && drawShapeQueue.length > 0 && hasDraw) {
        var originalEngineComp2 = engineComp;
        engineComp = drawComp;
        shapeQueue = drawShapeQueue;
        createShapeLayers(mainCompName, compFolder);
        engineComp = originalEngineComp2;
        shapeQueue = [];
      }

      var allShapesQueue = setupShapeQueue.concat(drawShapeQueue);
      var mergedShapeCounts = countShapesByType(allShapesQueue);
      var originalShapeQueue = shapeQueue;
      shapeQueue = [];
      createEngineTextLayer(
        drawCode,
        setupCode,
        globalCode,
        drawFullCodeArg,
        setupFullCodeArg,
        preloadFullCodeArg,
        deps,
        mergedShapeCounts,
        parsedFontMetrics,
        parsedImageMetadata,
        parsedTableData,
        parsedJSONData,
        parsedGlobalVarNames
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
        var drawBackgroundCount = resolveDrawBackgroundCount(
          drawBackgroundCountArg,
          parsedDrawRenderLayers
        );
        var drawNeedsEcho =
          drawNeedsEchoArg !== undefined && drawNeedsEchoArg !== null
            ? !!drawNeedsEchoArg
            : drawBackgroundCount === 0;

        if (drawNeedsEcho) {
          addEchoEffect(
            drawLayer,
            engineComp,
            uniqueMainCompName,
            drawBackgroundCount
          );
        }
      }

      controllerSliderCount = setupControllersFromConfigs(engineComp, null);
      engineComp.openInViewer();
    } else {
      mainCompName = uniqueMainCompName;
      var mergedShapeCounts = countShapesByType(shapeQueue);
      createEngineTextLayer(
        drawCode,
        setupCode,
        globalCode,
        drawFullCodeArg,
        setupFullCodeArg,
        preloadFullCodeArg,
        deps,
        mergedShapeCounts,
        parsedFontMetrics,
        parsedImageMetadata,
        parsedTableData,
        parsedJSONData,
        parsedGlobalVarNames
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
  frameRate
) {
  var defaults = {
    name: "New Composition",
    width: 100,
    height: 100,
    pixelAspect: 1,
    duration: 10,
    frameRate: 30
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
    defaults.frameRate
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
  drawFullCode,
  setupFullCode,
  preloadFullCode,
  deps,
  mainCompNameParam,
  shapeCountsParam,
  fontMetricsParam,
  imageMetadataParam,
  tableDataParam,
  jsonDataParam,
  globalVarNamesParam
) {
  cleanupEngineLayer();

  var ctxLayer = engineComp.layers.addText("");
  ctxLayer.name = "__engine__";
  var textProp = ctxLayer.property("Source Text");
  var processedGlobal = globalVars
    ? removeConfigFunctions(globalVars)
    : "";
  var processedDrawFull = drawFullCode
    ? removeConfigFunctions(drawFullCode)
    : "";
  var processedSetupFull = setupFullCode
    ? removeConfigFunctions(setupFullCode)
    : "";
  var processedPreloadFull = preloadFullCode
    ? removeConfigFunctions(preloadFullCode)
    : "";

  var hasDraw =
    drawCode && drawCode.length > 0 && !drawCode.match(/^\/\/\s*Empty/);
  var hasSetup = setupCode && setupCode.length > 0;

  var shapeCounts = shapeCountsParam || countShapesByType(shapeQueue);
  var expr = buildExpression(
    processedGlobal,
    processedDrawFull,
    processedSetupFull,
    processedPreloadFull,
    hasDraw,
    hasSetup,
    shapeCounts,
    deps,
    mainCompNameParam,
    fontMetricsParam,
    imageMetadataParam,
    tableDataParam,
    jsonDataParam,
    globalVarNamesParam
  );

  textProp.expression = expr;
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

function processRenderLayers(renderLayersArg) {
  var queue = [];
  if (
    renderLayersArg &&
    isArray(renderLayersArg) &&
    renderLayersArg.length > 0
  ) {
    for (var i = 0; i < renderLayersArg.length; i++) {
      var item = renderLayersArg[i];
      var type = null;
      var slotKey = null;

      if (item && typeof item === "object") {
        if (item.type) {
          type = item.type;
        }
        if (item.slotKey) {
          slotKey = String(item.slotKey);
        }
      }

      if (!type) {
        continue;
      }

      if (!slotKey) {
        throw new Error(
          "[processRenderLayers] Missing slotKey for render layer type: " +
            type
        );
      }

      if (isRegistryAvailable() && functionRegistry.getShapeInfo) {
        var info = functionRegistry.getShapeInfo(type);
        if (info && info.baseType) {
          type = info.baseType;
        }
      }

      var entry = {
        type: type,
        slotKey: slotKey
      };

      for (var key in item) {
        if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
        if (key === "type" || key === "slotKey") continue;
        entry[key] = item[key];
      }

      queue.push(entry);
    }
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

function pushLib(parts, label, code) {
  if (!code) return;
  parts.push(["// " + label, code].join("\n"));
}

function getCorePreludeLib() {
  return [
    "var fps = 1 / thisComp.frameDuration;",
    "var currentFrame = timeToFrames(time);",
    "var currentTime = time;"
  ].join("\n");
}

function getEngineStateLib(
  fontMetricsParam,
  imageMetadataParam,
  tableDataParam,
  jsonDataParam
) {
  var fontMetricsJson = JSON.stringify(
    fontMetricsParam && typeof fontMetricsParam === "object"
      ? fontMetricsParam
      : {}
  );
  var imageMetadataJson = JSON.stringify(
    imageMetadataParam && typeof imageMetadataParam === "object"
      ? imageMetadataParam
      : {}
  );
  var tableDataJson = JSON.stringify(
    tableDataParam && typeof tableDataParam === "object" ? tableDataParam : {}
  );
  var jsonDataJson = JSON.stringify(
    jsonDataParam && typeof jsonDataParam === "object" ? jsonDataParam : {}
  );

  return [
    "var _ctx = {",
    "  version: 1,",
    "  fps: fps,",
    "  frame: currentFrame,",
    "  time: currentTime,",
    "  env: { frameCount: currentFrame, width: thisComp.width, height: thisComp.height },"
    ,
    "  shapes: [],",
    "  backgrounds: [],",
    "  globals: {},",
    "  controllers: [],",
    "  _lastComputedFrame: -1,",
    "  _looping: true,",
    "  _redrawRequested: false",
    "};",
    "var _fm = " + fontMetricsJson + ";",
    "var _imd = " + imageMetadataJson + ";",
    "var _td = " + tableDataJson + ";",
    "var _jd = " + jsonDataJson + ";",
    "var __momentumPhase = 'global';",
    "var _shapes = _ctx.shapes;",
    "var _backgrounds = _ctx.backgrounds;"
  ].join("\n");
}

function getMainCompGlobalsBridgeLib(mainCompNameParam) {
  if (!mainCompNameParam) return "";
  return [
    "// Main comp globals bridge",
    "function _getMainCompGlobalVar(varName) {",
    "  try {",
    '    var mainComp = comp("' + mainCompNameParam + '");',
    '    var engineLayer = mainComp.layer("__engine__");',
    '    var ctxJson = engineLayer.property("Source Text").value;',
    "    var ctx = JSON.parse(ctxJson);",
    "    if (ctx.globals && ctx.globals.hasOwnProperty(varName)) {",
    "      return ctx.globals[varName];",
    "    }",
    "    return undefined;",
    "  } catch (e) {",
    "    return undefined;",
    "  }",
    "}"
  ].join("\n");
}

function buildExpression(
  processedGlobal,
  processedDrawFull,
  processedSetupFull,
  processedPreloadFull,
  hasDraw,
  hasSetup,
  shapeCounts,
  deps,
  mainCompNameParam,
  fontMetricsParam,
  imageMetadataParam,
  tableDataParam,
  jsonDataParam,
  globalVarNamesParam
) {
  var mathDeps = deps && deps.math ? deps.math : {};
  var transformDeps = deps && deps.transforms ? deps.transforms : {};
  var colorDeps = deps && deps.colors ? deps.colors : {};
  var typographyDeps = deps && deps.typography ? deps.typography : {};
  var controllerDeps = deps && deps.controllers ? deps.controllers : {};
  var dataDeps = deps && deps.data ? deps.data : {};
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

  var parts = [];
  parts.push(getCorePreludeLib());
  pushLib(
    parts,
    "Environment",
    hasKeys(envDeps) ? getEnvironmentLib(envDeps) : ""
  );
  pushLib(
    parts,
    "Engine State",
    getEngineStateLib(
      fontMetricsParam,
      imageMetadataParam,
      tableDataParam,
      jsonDataParam
    )
  );

  pushLib(
    parts,
    "Controllers",
    hasKeys(controllerDeps)
      ? getControllerLib(buildDepsFromRegistry(controllerDeps, "controllers"))
      : ""
  );
  pushLib(
    parts,
    "Math",
    hasKeys(mathDeps)
      ? getMathLib(buildDepsFromRegistry(mathDeps, "math"))
      : ""
  );
  pushLib(
    parts,
    "Data",
    hasKeys(dataDeps)
      ? getDataLib(buildDepsFromRegistry(dataDeps, "data"))
      : ""
  );
  if (hasShapes) {
    pushLib(parts, "Transform State", getTransformationLib({ state: true }));
  }
  pushLib(
    parts,
    "Transforms",
    hasKeys(transformDeps)
      ? getTransformationLib(buildDepsFromRegistry(transformDeps, "transforms"))
      : ""
  );

  if (hasShapes) {
    pushLib(parts, "Color State", getColorLib({ state: true }));
  }
  pushLib(
    parts,
    "Colors",
    hasKeys(colorDeps)
      ? getColorLib(buildDepsFromRegistry(colorDeps, "colors"))
      : ""
  );

  if (hasShapes) {
    pushLib(
      parts,
      "Shapes",
      getShapeLib(buildShapeDepsFromRegistry(shapeCounts))
    );
  }

  if (shapeCounts && shapeCounts.image > 0) {
    if (!colorDeps.color) colorDeps = colorDeps || {};
    colorDeps.color = true;
    pushLib(parts, "Images", getImageLib({ image: true }));
  }

  pushLib(
    parts,
    "IO",
    hasKeys(tableDeps)
      ? getIOLib(buildDepsFromRegistry(tableDeps, "tables"))
      : ""
  );

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
      BASELINE: !!typographyDeps.BASELINE
    };
    pushLib(parts, "Typography", getTypographyLib(typoDepsForLib));
  }

  pushLib(parts, "Main Comp Bridge", getMainCompGlobalsBridgeLib(mainCompNameParam));

  var globalVarNames =
    globalVarNamesParam && isArray(globalVarNamesParam)
      ? globalVarNamesParam
      : [];

  parts.push(
    buildUserScope(
      processedGlobal,
      processedPreloadFull,
      processedSetupFull,
      processedDrawFull,
      hasSetup,
      hasDraw,
      globalVarNames,
      !!mainCompNameParam
    ).join("\n")
  );

  parts.push(
    buildExecutionLogic(hasDraw, hasSetup, hasShapes, envDeps).join("\n")
  );

  parts.push(buildPathCreation());

  return parts.join("\n\n");
}
