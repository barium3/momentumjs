// Structure - setup/draw definition and execution.

function buildUserScope(
  processedGlobal,
  processedPreloadFull,
  processedSetupFull,
  processedDrawFull,
  hasSetup,
  hasDraw,
  globalVarNames,
  pullFromMainComp
) {
  var expr = [];

  function addUserCode(label, source) {
    if (!source) return;
    expr.push("// User " + label);
    var lines = String(source).split("\n");
    for (var i = 0; i < lines.length; i++) {
      expr.push(lines[i]);
    }
  }

  addUserCode("globals", processedGlobal);
  addUserCode("preload", processedPreloadFull);
  addUserCode("setup", processedSetupFull);
  addUserCode("draw", processedDrawFull);

  if (hasSetup && processedSetupFull) {
    var randomSeedValue = Math.floor(Math.random() * 1000000);
    var noiseSeedValue = Math.floor(Math.random() * 1000000);
    expr.push("if (typeof setup === 'function') {");
    expr.push("  var __momentumOriginalSetup = setup;");
    expr.push("  setup = function () {");
    expr.push("    randomSeed(" + randomSeedValue + ");");
    expr.push("    noiseSeed(" + noiseSeedValue + ");");
    expr.push("    return __momentumOriginalSetup.apply(this, arguments);");
    expr.push("  };");
    expr.push("}");
  }

  if (pullFromMainComp && globalVarNames && globalVarNames.length > 0) {
    expr.push("// Pull globals from main comp");
    for (var i = 0; i < globalVarNames.length; i++) {
      var varName = globalVarNames[i];
      expr.push(
        "var __pull_" +
          varName +
          ' = _getMainCompGlobalVar("' +
          varName +
          '");'
      );
      expr.push(
        "if (__pull_" +
          varName +
          " !== undefined) " +
          varName +
          " = __pull_" +
          varName +
          ";"
      );
    }
  }

  expr.push("var __user__ = {");
  expr.push("  preload: (typeof preload === 'function') ? preload : null,");
  expr.push("  setup: (typeof setup === 'function') ? setup : null,");
  expr.push("  draw: (typeof draw === 'function') ? draw : null");
  expr.push("};");

  return expr;
}

function buildExecutionLogic(hasDraw, hasSetup, hasShapes, envDeps) {
  var expr = [];

  function addPreloadRun(rewindLabel) {
    expr.push("// ========================================");
    expr.push("// Run preload on first execution" + rewindLabel);
    expr.push("// ========================================");
    expr.push("if (_lastComputedFrame === -1 && __user__.preload) {");
    expr.push("  __user__.preload();");
    expr.push("}");
  }

  function addDrawCall() {
    if (hasShapes) {
      expr.push("      __momentumPhase = 'draw'; resetMatrix(); __user__.draw();");
    } else {
      expr.push("      __momentumPhase = 'draw'; __user__.draw();");
    }
  }

  function addDrawIdle() {
    expr.push("  _render = true;");
    if (hasShapes) {
      expr.push("  __momentumPhase = 'draw'; resetMatrix();");
    } else {
      expr.push("  __momentumPhase = 'draw';");
    }
  }

  function addDrawLoop() {
    expr.push("// ========================================");
    expr.push("// Run draw incrementally for newly requested frames");
    expr.push("// ========================================");
    expr.push(
      "if (_needsFullRecompute || currentFrame > _lastComputedFrame) {"
    );
    expr.push("  // On rewind or incremental update, replay from last frame");
    expr.push(
      "  var startFrame = _needsFullRecompute ? 0 : (_lastComputedFrame + 1);"
    );
    expr.push(
      "  for (var f = startFrame, targetFrame = currentFrame; f <= targetFrame; f++) {"
    );
    expr.push("    currentFrame = f; currentTime = f / fps;");
    if (envDeps.frameCount) {
      expr.push("    frameCount = currentFrame;");
    }
    expr.push("    _render = (f === targetFrame);");
    expr.push(
      "    if (_ctx._looping !== false || _ctx._redrawRequested === true) {"
    );
    addDrawCall();
    expr.push("      _ctx._redrawRequested = false;");
    expr.push("    }");
    expr.push("  }");
    expr.push("  _ctx._lastComputedFrame = currentFrame;");
    expr.push("} else if (currentFrame === _lastComputedFrame) {");
    addDrawIdle();
    expr.push("}");
  }

  expr.push("// ========================================");
  expr.push("// Frame loop cache");
  expr.push("// ========================================");
  expr.push("var _lastComputedFrame = _ctx._lastComputedFrame || -1;");
  expr.push("var _needsFullRecompute = false;");

  expr.push("if (currentFrame < _lastComputedFrame) {");
  expr.push("  _lastComputedFrame = -1;");
  expr.push("  _ctx._lastComputedFrame = -1;");
  expr.push("  _needsFullRecompute = true;");
  expr.push("}");

  if (hasDraw && hasSetup) {
    addPreloadRun(" or timeline rewind");

    expr.push("// ========================================");
    expr.push("// Run setup on first execution or timeline rewind");
    expr.push("// ========================================");
    expr.push("if (_lastComputedFrame === -1) {");
    expr.push("  _render = true;");
    expr.push("  __momentumPhase = 'setup';");
    expr.push("  __user__.setup();");
    expr.push("}");
    addDrawLoop();
  } else if (hasDraw) {
    addPreloadRun(" or timeline rewind");
    addDrawLoop();
  } else if (hasSetup) {
    addPreloadRun("");

    expr.push("// ========================================");
    expr.push("// Run setup on first execution");
    expr.push("// ========================================");
    expr.push("if (_lastComputedFrame === -1) {");
    expr.push("  _render = true;");
    expr.push("  __momentumPhase = 'setup';");
    expr.push("  __user__.setup();");
    if (hasShapes) {
      expr.push("  resetMatrix();");
    }
    expr.push("}");
    expr.push("// ========================================");
    expr.push("// Update cached frame even without draw");
    expr.push("// ========================================");
    expr.push("if (currentFrame > _lastComputedFrame) {");
    expr.push("  _ctx._lastComputedFrame = currentFrame;");
    expr.push("}");
  } else {
    expr.push("// ========================================");
    expr.push("// No user code; only update cached frame");
    expr.push("// ========================================");
    expr.push("if (currentFrame > _lastComputedFrame) {");
    expr.push("  _ctx._lastComputedFrame = currentFrame;");
    expr.push("}");
  }

  return expr;
}

/**
 * 构建最终上下文创建代码
 * 当前使用 Text JSON 作为引擎上下文载体：
 * - _ctx 由 core.js 中的 buildExpression 负责构建
 * - 这里仅负责将 _ctx 序列化为 JSON 字符串
 *
 * @returns {string} 上下文创建代码（返回 JSON 字符串）
 */
function buildPathCreation() {
  // 这里返回 JSON 字符串，_ctx 结构在 core.js 中定义
  // 即使没有形状，_ctx 仍然包含环境信息（fps、frame、time、env 等）
  //
  // 性能优化：为 shape 图层表达式提供 slotKey -> index 的快速索引，避免每次都线性扫描 shapes 数组
  // 注意：只存索引（不存对象引用），避免 JSON 体积指数膨胀
  return [
    "var _slotIndex = {};",
    "var _arr = _ctx.shapes || [];",
    "for (var i = 0; i < _arr.length; i++) {",
    "  var s = _arr[i];",
    "  if (s && s.slotKey) _slotIndex[s.slotKey] = i;",
    "}",
    "_ctx.slotIndex = _slotIndex;",
    "var _bgSlotIndex = {};",
    "var _bgs = _ctx.backgrounds || [];",
    "for (var j = 0; j < _bgs.length; j++) {",
    "  var bg = _bgs[j];",
    "  if (bg && bg.slotKey) _bgSlotIndex[bg.slotKey] = j;",
    "}",
    "_ctx.backgroundSlotIndex = _bgSlotIndex;",
    "JSON.stringify(_ctx)"
  ].join("\n");
}
