// Structure - setup/draw definition and execution.

function buildUserScope(
  processedGlobal,
  processedSetup,
  processedDraw,
  hasSetup,
  hasDraw,
  globalVarNames,
  pullFromMainComp,
) {
  var expr = [];
  expr.push("var __user__ = (function () {");

  if (processedGlobal) {
    expr.push("  // User globals");
    var globalLines = String(processedGlobal).split("\n");
    var indentedGlobal = [];
    for (var g = 0; g < globalLines.length; g++) {
      indentedGlobal.push("  " + globalLines[g]);
    }
    expr.push(indentedGlobal.join("\n"));
  }

  if (pullFromMainComp && globalVarNames && globalVarNames.length > 0) {
    expr.push("  // Pull globals from main comp");
    for (var i = 0; i < globalVarNames.length; i++) {
      var varName = globalVarNames[i];
      expr.push(
        "  var __pull_" +
          varName +
          ' = _getMainCompGlobalVar("' +
          varName +
          '");',
      );
      expr.push(
        "  if (__pull_" +
          varName +
          " !== undefined) " +
          varName +
          " = __pull_" +
          varName +
          ";",
      );
    }
  }

  if (hasSetup) {
    var randomSeedValue = Math.floor(Math.random() * 1000000);
    var noiseSeedValue = Math.floor(Math.random() * 1000000);
    var setupBody =
      "randomSeed(" +
      randomSeedValue +
      "); noiseSeed(" +
      noiseSeedValue +
      "); " +
      processedSetup;
    expr.push("  function setup() { " + setupBody + " }");
  }

  if (hasDraw) {
    expr.push("  function draw() { " + processedDraw + " }");
  }

  expr.push("  return {");
  expr.push("    preload: (typeof preload === 'function') ? preload : null,");
  expr.push("    setup: (typeof setup === 'function') ? setup : null,");
  expr.push("    draw: (typeof draw === 'function') ? draw : null");
  expr.push("  };");
  expr.push("})();");

  return expr;
}

function buildExecutionLogic(hasDraw, hasSetup, hasShapes, envDeps) {
  var expr = [];

  expr.push("// ========================================");
  expr.push("// 帧循环缓存机制");
  expr.push("// ========================================");
  expr.push("var _lastComputedFrame = _ctx._lastComputedFrame || -1;");
  expr.push("var _needsFullRecompute = false;");

  expr.push("if (currentFrame < _lastComputedFrame) {");
  expr.push("  _lastComputedFrame = -1;");
  expr.push("  _ctx._lastComputedFrame = -1;");
  expr.push("  _needsFullRecompute = true;");
  expr.push("}");

  if (hasDraw && hasSetup) {
    expr.push("// ========================================");
    expr.push("// 执行 Preload (仅在第一次执行或时间线回退后)");
    expr.push("// ========================================");
    expr.push("if (_lastComputedFrame === -1 && __user__.preload) {");
    expr.push("  __user__.preload();");
    expr.push("}");

    expr.push("// ========================================");
    expr.push("// 执行 Setup (仅在第一次执行或时间线回退后)");
    expr.push("// ========================================");
    expr.push("if (_lastComputedFrame === -1) {");
    expr.push("  _render = true;");
    expr.push("  __user__.setup();");
    expr.push("}");

    expr.push("// ========================================");
    expr.push("// 执行 Draw (增量执行：只执行新增的帧)");
    expr.push("// ========================================");
    expr.push(
      "if (_needsFullRecompute || currentFrame > _lastComputedFrame) {",
    );
    expr.push("  // 时间线回退或需要增量执行：从上次计算到当前帧");
    expr.push(
      "  var startFrame = _needsFullRecompute ? 0 : (_lastComputedFrame + 1);",
    );
    expr.push(
      "  for (var f = startFrame, targetFrame = currentFrame; f <= targetFrame; f++) {",
    );
    expr.push("    currentFrame = f; currentTime = f / fps;");
    if (envDeps.frameCount) {
      expr.push("    frameCount = currentFrame;");
    }
    expr.push("    _render = (f === targetFrame);");
    expr.push(
      "    if (_ctx._looping !== false || _ctx._redrawRequested === true) {",
    );
    if (hasShapes) {
      expr.push("      resetMatrix(); __user__.draw();");
    } else {
      expr.push("      __user__.draw();");
    }
    expr.push("      _ctx._redrawRequested = false;");
    expr.push("    }");
    expr.push("  }");
    expr.push("  _ctx._lastComputedFrame = currentFrame;");
    expr.push("} else if (currentFrame === _lastComputedFrame) {");
    expr.push("  _render = true;");
    if (hasShapes) {
      expr.push("  resetMatrix();");
    }
    expr.push("}");
  } else if (hasDraw) {
    expr.push("// ========================================");
    expr.push("// 执行 Preload (仅在第一次执行或时间线回退后)");
    expr.push("// ========================================");
    expr.push("if (_lastComputedFrame === -1 && __user__.preload) {");
    expr.push("  __user__.preload();");
    expr.push("}");

    expr.push("// ========================================");
    expr.push("// 执行 Draw (增量执行：只执行新增的帧)");
    expr.push("// ========================================");
    expr.push(
      "if (_needsFullRecompute || currentFrame > _lastComputedFrame) {",
    );
    expr.push("  // 时间线回退或需要增量执行：从上次计算到当前帧");
    expr.push(
      "  var startFrame = _needsFullRecompute ? 0 : (_lastComputedFrame + 1);",
    );
    expr.push(
      "  for (var f = startFrame, targetFrame = currentFrame; f <= targetFrame; f++) {",
    );
    expr.push("    currentFrame = f; currentTime = f / fps;");
    if (envDeps.frameCount) {
      expr.push("    frameCount = currentFrame;");
    }
    expr.push("    _render = (f === targetFrame);");
    expr.push(
      "    if (_ctx._looping !== false || _ctx._redrawRequested === true) {",
    );
    if (hasShapes) {
      expr.push("      resetMatrix(); __user__.draw();");
    } else {
      expr.push("      __user__.draw();");
    }
    expr.push("      _ctx._redrawRequested = false;");
    expr.push("    }");
    expr.push("  }");
    expr.push("  _ctx._lastComputedFrame = currentFrame;");
    expr.push("} else if (currentFrame === _lastComputedFrame) {");
    expr.push("  _render = true;");
    if (hasShapes) {
      expr.push("  resetMatrix();");
    }
    expr.push("}");
  } else if (hasSetup) {
    expr.push("// ========================================");
    expr.push("// 执行 Preload (仅在第一次执行)");
    expr.push("// ========================================");
    expr.push("if (_lastComputedFrame === -1 && __user__.preload) {");
    expr.push("  __user__.preload();");
    expr.push("}");

    expr.push("// ========================================");
    expr.push("// 执行 Setup (仅在第一次执行)");
    expr.push("// ========================================");
    expr.push("if (_lastComputedFrame === -1) {");
    expr.push("  _render = true;");
    expr.push("  __user__.setup();");
    if (hasShapes) {
      expr.push("  resetMatrix();");
    }
    expr.push("}");
    expr.push("// ========================================");
    expr.push("// 更新帧号（即使没有 draw，也需要更新缓存）");
    expr.push("// ========================================");
    expr.push("if (currentFrame > _lastComputedFrame) {");
    expr.push("  _ctx._lastComputedFrame = currentFrame;");
    expr.push("}");
  } else {
    expr.push("// ========================================");
    expr.push("// 无代码（仅更新帧号）");
    expr.push("// ========================================");
    expr.push("if (currentFrame > _lastComputedFrame) {");
    expr.push("  _ctx._lastComputedFrame = currentFrame;");
    expr.push("}");
  }

  return expr;
}

/**
 * 构建帧循环的通用部分
 * @param {Object} envDeps - 环境依赖对象
 * @returns {Array<string>} 帧循环代码数组
 */
function buildFrameLoop(envDeps) {
  var expr = [];
  expr.push(
    "for (var f = 0, targetFrame = currentFrame; f <= targetFrame; f++) {",
  );
  expr.push("  currentFrame = f; currentTime = f / fps;");
  if (envDeps.frameCount) {
    expr.push("  frameCount = currentFrame;  // 同步用户变量");
  }
  return expr;
}

/**
 * 构建最终上下文创建代码
 * 当前使用 Text JSON 作为引擎上下文载体：
 * - _ctx 由 core.js 中的 buildExpression 负责构建
 * - 这里仅负责将 _ctx 序列化为 JSON 字符串
 *
 * @param {boolean} hasShapes - 是否有形状需要渲染（目前保留参数以兼容旧签名）
 * @returns {string} 上下文创建代码（返回 JSON 字符串）
 */
function buildPathCreation(hasShapes) {
  // 这里返回 JSON 字符串，_ctx 结构在 core.js 中定义
  // 即使没有形状，_ctx 仍然包含环境信息（fps、frame、time、env 等）
  //
  // 性能优化：为 shape 图层表达式提供 id -> index 的快速索引，避免每次都线性扫描 shapes 数组
  // 注意：只存索引（不存对象引用），避免 JSON 体积指数膨胀
  return [
    "var _shapeIndex = {};",
    "var _arr = _ctx.shapes || [];",
    "for (var i = 0; i < _arr.length; i++) {",
    "  var s = _arr[i];",
    "  if (s && s.id !== undefined) _shapeIndex[s.id] = i;",
    "}",
    "_ctx.shapeIndex = _shapeIndex;",
    "JSON.stringify(_ctx)",
  ].join("\n");
}
