// ----------------------------------------
// Structure - Setup & Draw 函数结构
// 处理 Processing 风格的 setup() 和 draw() 函数定义与执行
// ----------------------------------------

/**
 * 构建 setup 和 draw 函数定义代码
 * @param {string} processedSetup - 处理后的 setup 代码
 * @param {string} processedDraw - 处理后的 draw 代码
 * @param {boolean} hasSetup - 是否有 setup 函数
 * @param {boolean} hasDraw - 是否有 draw 函数
 * @returns {Array<string>} 函数定义代码数组
 */
function buildFunctionDefinitions(
  processedSetup,
  processedDraw,
  hasSetup,
  hasDraw,
) {
  var expr = [];

  // 定义 setup 函数（真正的函数调用，确保变量作用域隔离）
  if (hasSetup) {
    expr.push("// Setup 函数定义");
    
    // 在 setup 函数体开头自动添加 randomSeed() 和 noiseSeed() 调用
    // 使用构建时生成的随机 seed，确保每次脚本运行时 setup 中的 random 和 noise 结果可复现
    // 但不同脚本运行之间 seed 不同，结果也不同
    var randomSeedValue = Math.floor(Math.random() * 1000000);
    var noiseSeedValue = Math.floor(Math.random() * 1000000);
    var setupBody = "randomSeed(" + randomSeedValue + "); noiseSeed(" + noiseSeedValue + "); " + processedSetup;
    
    expr.push("function setup() { " + setupBody + " }");
  }

  // 定义 draw 函数（真正的函数调用）
  if (hasDraw) {
    expr.push("// Draw 函数定义");
    expr.push("function draw() { " + processedDraw + " }");
  }

  return expr;
}

/**
 * 构建执行逻辑代码
 * 遵循 Processing 语义：setup() 执行一次，draw() 每帧执行
 * 优化：使用帧循环缓存机制，只执行新增的帧，避免重复计算
 * @param {boolean} hasDraw - 是否有 draw 函数
 * @param {boolean} hasSetup - 是否有 setup 函数
 * @param {boolean} hasShapes - 是否有形状需要渲染
 * @param {Object} envDeps - 环境依赖对象
 * @returns {Array<string>} 执行逻辑代码数组
 */
function buildExecutionLogic(hasDraw, hasSetup, hasShapes, envDeps) {
  var expr = [];

  // 获取上次计算的帧号（用于缓存机制）
  expr.push("// ========================================");
  expr.push("// 帧循环缓存机制");
  expr.push("// ========================================");
  expr.push("var _lastComputedFrame = _ctx._lastComputedFrame || -1;");
  expr.push("var _needsFullRecompute = false;");

  // 处理时间线回退：如果当前帧小于上次计算的帧，需要清除缓存并重新计算
  expr.push("if (currentFrame < _lastComputedFrame) {");
  expr.push("  // 时间线回退，需要重新计算");
  expr.push("  _lastComputedFrame = -1;");
  expr.push("  _ctx._lastComputedFrame = -1;");
  expr.push("  _needsFullRecompute = true;");
  expr.push("}");

  // 根据模式执行代码
  if (hasDraw && hasSetup) {
    // 完整模式：有 setup 和 draw
    expr.push("// ========================================");
    expr.push("// 执行 Setup (仅在第一次执行或时间线回退后)");
    expr.push("// ========================================");
    expr.push("if (_lastComputedFrame === -1) {");
    expr.push("  setup();");
    expr.push("}");

    expr.push("// ========================================");
    expr.push("// 执行 Draw (增量执行：只执行新增的帧)");
    expr.push("// ========================================");
    expr.push("if (_needsFullRecompute || currentFrame > _lastComputedFrame) {");
    expr.push("  // 时间线回退或需要增量执行：从上次计算到当前帧");
    expr.push("  var startFrame = _needsFullRecompute ? 0 : (_lastComputedFrame + 1);");
    expr.push(
      "  for (var f = startFrame, targetFrame = currentFrame; f <= targetFrame; f++) {",
    );
    expr.push("    currentFrame = f; currentTime = f / fps;");
    if (envDeps.frameCount) {
      expr.push("    frameCount = currentFrame;  // 同步用户变量");
    }
    expr.push("    _render = (f === targetFrame);");
    if (hasShapes) {
      expr.push("    resetMatrix(); resetColors(); draw();");
    } else {
      expr.push("    draw();");
    }
    expr.push("  }");
    expr.push("  // 更新缓存帧号");
    expr.push("  _ctx._lastComputedFrame = currentFrame;");
    expr.push("} else if (currentFrame === _lastComputedFrame) {");
    expr.push("  // 当前帧已计算过，只更新渲染标志");
    expr.push("  _render = true;");
    if (hasShapes) {
      expr.push("  resetMatrix(); resetColors();");
    }
    expr.push("}");

  } else if (hasDraw) {
    // 只有 draw 模式
    expr.push("// ========================================");
    expr.push("// 执行 Draw (增量执行：只执行新增的帧)");
    expr.push("// ========================================");
    expr.push("if (_needsFullRecompute || currentFrame > _lastComputedFrame) {");
    expr.push("  // 时间线回退或需要增量执行：从上次计算到当前帧");
    expr.push("  var startFrame = _needsFullRecompute ? 0 : (_lastComputedFrame + 1);");
    expr.push(
      "  for (var f = startFrame, targetFrame = currentFrame; f <= targetFrame; f++) {",
    );
    expr.push("    currentFrame = f; currentTime = f / fps;");
    if (envDeps.frameCount) {
      expr.push("    frameCount = currentFrame;  // 同步用户变量");
    }
    expr.push("    _render = (f === targetFrame);");
    if (hasShapes) {
      expr.push("    resetMatrix(); resetColors(); draw();");
    } else {
      expr.push("    draw();");
    }
    expr.push("  }");
    expr.push("  // 更新缓存帧号");
    expr.push("  _ctx._lastComputedFrame = currentFrame;");
    expr.push("} else if (currentFrame === _lastComputedFrame) {");
    expr.push("  // 当前帧已计算过，只更新渲染标志");
    expr.push("  _render = true;");
    if (hasShapes) {
      expr.push("  resetMatrix(); resetColors();");
    }
    expr.push("}");

  } else if (hasSetup) {
    // 只有 setup 模式
    expr.push("// ========================================");
    expr.push("// 执行 Setup (仅在第一次执行)");
    expr.push("// ========================================");
    expr.push("if (_lastComputedFrame === -1) {");
    expr.push("  setup();");
    if (hasShapes) {
      expr.push("  resetMatrix(); resetColors();");
    }
    expr.push("}");
    expr.push("// ========================================");
    expr.push("// 更新帧号（即使没有 draw，也需要更新缓存）");
    expr.push("// ========================================");
    expr.push("if (currentFrame > _lastComputedFrame) {");
    expr.push("  _ctx._lastComputedFrame = currentFrame;");
    expr.push("}");

  } else {
    // 无代码模式
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
  // 这里直接返回 JSON 字符串，_ctx 结构在 core.js 中定义
  // 即使没有形状，_ctx 仍然包含环境信息（fps、frame、time、env 等）
  return "JSON.stringify(_ctx)";
}
