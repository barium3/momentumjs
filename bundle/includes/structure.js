// Structure helpers.

function getUserCodeLib(label, source) {
  if (!source) return "";
  return [
    "// ===== User " + label + " =====",
    String(source)
  ].join("\n");
}

function getSetupSeedWrapperLib(hasSetup, processedSetupFull) {
  if (!(hasSetup && processedSetupFull)) return "";
  var randomSeedValue = Math.floor(Math.random() * 1000000);
  var noiseSeedValue = Math.floor(Math.random() * 1000000);
  return [
    "if (typeof setup === 'function') {",
    "  var __momentumOriginalSetup = setup;",
    "  setup = function () {",
    "    randomSeed(" + randomSeedValue + ");",
    "    noiseSeed(" + noiseSeedValue + ");",
    "    return __momentumOriginalSetup.apply(this, arguments);",
    "  };",
    "}"
  ].join("\n");
}

function getMainCompGlobalsLib(globalVarNames, pullFromMainComp) {
  if (!(pullFromMainComp && globalVarNames && globalVarNames.length > 0)) {
    return "";
  }
  var block = ["// ===== Main Comp Globals ====="];
  for (var i = 0; i < globalVarNames.length; i++) {
    var varName = globalVarNames[i];
    block.push(
      "var __pull_" + varName + ' = _getMainCompGlobalVar("' + varName + '");'
    );
    block.push(
      "if (__pull_" + varName + " !== undefined) " + varName + " = __pull_" + varName + ";"
    );
  }
  return block.join("\n");
}

function getUserRegistryLib() {
  return [
    "var __user__ = {",
    "  preload: (typeof preload === 'function') ? preload : null,",
    "  setup: (typeof setup === 'function') ? setup : null,",
    "  draw: (typeof draw === 'function') ? draw : null",
    "};"
  ].join("\n");
}

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
  return [
    getUserCodeLib("globals", processedGlobal),
    getUserCodeLib("preload", processedPreloadFull),
    getUserCodeLib("setup", processedSetupFull),
    getUserCodeLib("draw", processedDrawFull),
    getSetupSeedWrapperLib(hasSetup, processedSetupFull),
    getMainCompGlobalsLib(globalVarNames, pullFromMainComp),
    getUserRegistryLib()
  ].filter(Boolean);
}

function getPreloadRunLib(rewindLabel) {
  return [
    "// ===== Preload =====",
    "// Run preload on first execution" + rewindLabel,
    "if (_lastComputedFrame === -1 && __user__.preload) {",
    "  __user__.preload();",
    "}"
  ].join("\n");
}

function getDrawCallLine(hasShapes) {
  if (hasShapes) {
    return "      __momentumPhase = 'draw'; resetMatrix(); __user__.draw();";
  }
  return "      __momentumPhase = 'draw'; __user__.draw();";
}

function getDrawIdleLib(hasShapes) {
  return [
    "  _render = true;",
    hasShapes ? "  __momentumPhase = 'draw'; resetMatrix();" : "  __momentumPhase = 'draw';"
  ].join("\n");
}

function getDrawLoopLib(hasShapes, envDeps) {
  var block = [
    "// ===== Draw Loop =====",
    "// Run draw incrementally for newly requested frames",
    "if (_needsFullRecompute || currentFrame > _lastComputedFrame) {",
    "  // Replay from the last cached frame.",
    "  var startFrame = _needsFullRecompute ? 0 : (_lastComputedFrame + 1);",
    "  for (var f = startFrame, targetFrame = currentFrame; f <= targetFrame; f++) {",
    "    currentFrame = f; currentTime = f / fps;"
  ];
  if (envDeps.frameCount) {
    block.push("    frameCount = currentFrame;");
  }
  block.push(
    "    _render = (f === targetFrame);",
    "    if (_ctx._looping !== false || _ctx._redrawRequested === true) {",
    getDrawCallLine(hasShapes),
    "      _ctx._redrawRequested = false;",
    "    }",
    "  }",
    "  _ctx._lastComputedFrame = currentFrame;",
    "} else if (currentFrame === _lastComputedFrame) {",
    getDrawIdleLib(hasShapes),
    "}"
  );
  return block.join("\n");
}

function getFrameCachePreludeLib() {
  return [
    "// ===== Frame Cache =====",
    "var _lastComputedFrame = _ctx._lastComputedFrame || -1;",
    "var _needsFullRecompute = false;",
    "if (currentFrame < _lastComputedFrame) {",
    "  _lastComputedFrame = -1;",
    "  _ctx._lastComputedFrame = -1;",
    "  _needsFullRecompute = true;",
    "}"
  ].join("\n");
}

function getSetupLib(label, hasShapes) {
  var block = [
    "// ===== Setup =====",
    label,
    "if (_lastComputedFrame === -1) {",
    "  _render = true;",
    "  __momentumPhase = 'setup';",
    "  __user__.setup();"
  ];
  if (hasShapes && label === "// Run setup on first execution") {
    block.push("  resetMatrix();");
  }
  block.push("}");
  return block.join("\n");
}

function getFrameCacheUpdateLib(label) {
  return [
    "// ===== Frame Cache =====",
    label,
    "if (currentFrame > _lastComputedFrame) {",
    "  _ctx._lastComputedFrame = currentFrame;",
    "}"
  ].join("\n");
}

function buildExecutionLogic(hasDraw, hasSetup, hasShapes, envDeps) {
  var expr = [getFrameCachePreludeLib()];

  if (hasDraw && hasSetup) {
    return expr.concat([
      getPreloadRunLib(" or timeline rewind"),
      getSetupLib("// Run setup on first execution or timeline rewind"),
      getDrawLoopLib(hasShapes, envDeps)
    ]).filter(Boolean);
  } else if (hasDraw) {
    return expr.concat([
      getPreloadRunLib(" or timeline rewind"),
      getDrawLoopLib(hasShapes, envDeps)
    ]).filter(Boolean);
  } else if (hasSetup) {
    return expr.concat([
      getPreloadRunLib(""),
      getSetupLib("// Run setup on first execution", hasShapes),
      getFrameCacheUpdateLib("// Update cached frame even without draw")
    ]).filter(Boolean);
  }

  return expr.concat([
    getFrameCacheUpdateLib("// No user code; only update cached frame")
  ]).filter(Boolean);
}

// Context serialization.
function buildPathCreation() {
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
