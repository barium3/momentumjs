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
    expr.push("function setup() { " + processedSetup + " }");
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
 * @param {boolean} hasDraw - 是否有 draw 函数
 * @param {boolean} hasSetup - 是否有 setup 函数
 * @param {boolean} hasShapes - 是否有形状需要渲染
 * @param {Object} envDeps - 环境依赖对象
 * @returns {Array<string>} 执行逻辑代码数组
 */
function buildExecutionLogic(hasDraw, hasSetup, hasShapes, envDeps) {
  var expr = [];

  // 根据模式执行代码
  if (hasDraw && hasSetup) {
    // 完整模式：有 setup 和 draw
    expr.push("// 执行 Setup (一次)");
    expr.push("setup();");
    expr.push("// 执行 Draw (每帧重放)");
    expr.push(
      "for (var f = 0, targetFrame = currentFrame; f <= targetFrame; f++) {",
    );
    expr.push("  currentFrame = f; currentTime = f / fps;");
    if (envDeps.frameCount) {
      expr.push("  frameCount = currentFrame;  // 同步用户变量");
    }
    expr.push("  _render = (f === targetFrame);");
    if (hasShapes) {
      expr.push("  resetMatrix(); resetColors(); draw();");
    } else {
      expr.push("  draw();");
    }
    expr.push("}");
  } else if (hasDraw) {
    // 只有 draw 模式
    expr.push("// 执行 Draw (每帧重放，无 setup)");
    expr.push(
      "for (var f = 0, targetFrame = currentFrame; f <= targetFrame; f++) {",
    );
    expr.push("  currentFrame = f; currentTime = f / fps;");
    if (envDeps.frameCount) {
      expr.push("  frameCount = currentFrame;  // 同步用户变量");
    }
    expr.push("  _render = (f === targetFrame);");
    if (hasShapes) {
      expr.push("  resetMatrix(); resetColors(); draw();");
    } else {
      expr.push("  draw();");
    }
    expr.push("}");
  } else if (hasSetup) {
    // 只有 setup 模式
    expr.push("// 执行 Setup (一次，无 draw)");
    expr.push("setup();");
    if (hasShapes) {
      expr.push("resetMatrix(); resetColors();");
    }
    expr.push(
      "for (var f = 0, targetFrame = currentFrame; f <= targetFrame; f++) {",
    );
    expr.push("  currentFrame = f; currentTime = f / fps;");
    if (envDeps.frameCount) {
      expr.push("  frameCount = currentFrame;  // 同步用户变量");
    }
    expr.push("}");
  } else {
    // 无代码模式
    expr.push("// 无代码");
    expr.push(
      "for (var f = 0, targetFrame = currentFrame; f <= targetFrame; f++) {",
    );
    expr.push("  currentFrame = f; currentTime = f / fps;");
    if (envDeps.frameCount) {
      expr.push("  frameCount = currentFrame;  // 同步用户变量");
    }
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
 * 构建最终路径创建代码
 * @param {boolean} hasShapes - 是否有形状需要渲染
 * @returns {string} 路径创建代码
 */
function buildPathCreation(hasShapes) {
  if (hasShapes) {
    return "createPath(_out.length > 0 ? _out : [[0, 0]], [], [], false)";
  } else {
    return "createPath([[0, 0]], [], [], false)";
  }
}
