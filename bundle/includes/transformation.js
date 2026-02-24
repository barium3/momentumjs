// ----------------------------------------
// Transformation - 模块化版本
// 处理 Processing 风格的坐标变换 (translate, rotate, scale, push, pop)
// ----------------------------------------

/**
 * 获取变换状态变量（始终需要）
 */
function getTransformStateLib() {
  return [
    "// ===== Transformation State =====",
    "var _tx = 0, _ty = 0;",
    "var _rotation = 0;",
    "var _cosR = 1, _sinR = 0;",
    "var _scaleX = 1, _scaleY = 1;",
    "var _stack = [];",
  ].join("\n");
}

/**
 * 获取基础变换函数（translate, rotate, scale）
 */
function getTransformBasicLib() {
  return [
    "// Basic Transform Functions",
    // p5.js: translate(x, y) 在“当前变换”的坐标系下平移
    // 这里用当前的旋转角度，把局部位移 (x,y) 转成全局，再累加到 (_tx,_ty)
    "function translate(x, y) {",
    "  if (y === undefined) y = 0;",
    "  var c = _cosR, s = _sinR;",
    "  var dx = x * c - y * s;",
    "  var dy = x * s + y * c;",
    "  _tx += dx;",
    "  _ty += dy;",
    "}",
    "function rotate(a) {",
    "  _rotation += a;",
    "  _cosR = Math.cos(_rotation);",
    "  _sinR = Math.sin(_rotation);",
    "}",
    "function scale(sx, sy) { sy = sy === undefined ? sx : sy; _scaleX *= sx; _scaleY *= sy; }",
  ].join("\n");
}

/**
 * 获取堆栈函数（push, pop）
 */
function getTransformStackLib() {
  return [
    "// Stack Functions",
    "// push()/pop() 保存的不只是变换矩阵，还包括各类 mode 与颜色状态，尽量贴近 p5 的行为。",
    "function push() {",
    "  var s = {",
    "    tx: _tx,",
    "    ty: _ty,",
    "    rotation: _rotation,",
    "    scaleX: _scaleX,",
    "    scaleY: _scaleY",
    "  };",
    "  // 形状模式（math.js 注入）",
    "  if (typeof _ellipseMode !== 'undefined') s.elm = _ellipseMode;",
    "  if (typeof _rectMode !== 'undefined') s.rm = _rectMode;",
    "  // 角度模式（math.js 注入）",
    "  if (typeof _angleMode !== 'undefined') s.angm = _angleMode;",
    "  // 颜色模式与范围（color.js 注入）",
    "  if (typeof _colorMode !== 'undefined') {",
    "    s.cm = _colorMode;",
    "    if (typeof _colorMax1 !== 'undefined') s.c1 = _colorMax1;",
    "    if (typeof _colorMax2 !== 'undefined') s.c2 = _colorMax2;",
    "    if (typeof _colorMax3 !== 'undefined') s.c3 = _colorMax3;",
    "    if (typeof _colorMaxA !== 'undefined') s.ca = _colorMaxA;",
    "  }",
    "  // 填充 / 描边状态（color.js 注入）",
    "  if (typeof _fillColor !== 'undefined' && _fillColor) s.fc = _fillColor.slice(0);",
    "  if (typeof _strokeColor !== 'undefined' && _strokeColor) s.sc = _strokeColor.slice(0);",
    "  if (typeof _strokeWeight !== 'undefined') s.sw = _strokeWeight;",
    "  if (typeof _noFill !== 'undefined') s.nf = _noFill;",
    "  if (typeof _noStroke !== 'undefined') s.ns = _noStroke;",
    "  _stack.push(s);",
    "}",
    "function pop() {",
    "  if (_stack.length > 0) {",
    "    var s = _stack.pop();",
    "    // 还原几何变换",
    "    _tx = s.tx; _ty = s.ty; _rotation = s.rotation; _scaleX = s.scaleX; _scaleY = s.scaleY;",
    "    // 确保旋转三角函数与 _rotation 一致",
    "    _cosR = Math.cos(_rotation);",
    "    _sinR = Math.sin(_rotation);",
    "    // 还原形状 / 角度模式",
    "    if (s.elm !== undefined) _ellipseMode = s.elm;",
    "    if (s.rm !== undefined) _rectMode = s.rm;",
    "    if (s.angm !== undefined) _angleMode = s.angm;",
    "    // 还原颜色模式与范围",
    "    if (s.cm !== undefined) {",
    "      _colorMode = s.cm;",
    "      if (s.c1 !== undefined) _colorMax1 = s.c1;",
    "      if (s.c2 !== undefined) _colorMax2 = s.c2;",
    "      if (s.c3 !== undefined) _colorMax3 = s.c3;",
    "      if (s.ca !== undefined) _colorMaxA = s.ca;",
    "    }",
    "    // 还原填充 / 描边状态",
    "    if (s.fc !== undefined) _fillColor = s.fc;",
    "    if (s.sc !== undefined) _strokeColor = s.sc;",
    "    if (s.sw !== undefined) _strokeWeight = s.sw;",
    "    if (s.nf !== undefined) _noFill = s.nf;",
    "    if (s.ns !== undefined) _noStroke = s.ns;",
    "  }",
    "}",
  ].join("\n");
}

/**
 * 获取重置矩阵函数
 */
function getResetMatrixLib() {
  return [
    "function resetMatrix() {",
    "  _tx = 0; _ty = 0;",
    "  _rotation = 0;",
    "  _cosR = 1; _sinR = 0;",
    "  _scaleX = 1; _scaleY = 1;",
    "  _stack = [];",
    "}",
  ].join("\n");
}

/**
 * 获取坐标变换函数（形状函数依赖）
 */
function getApplyTransformLib() {
  return [
    "function _applyTransform(x, y) {",
    "  var sx = x * _scaleX, sy = y * _scaleY;",
    "  var c = _cosR, s = _sinR;",
    "  return [sx * c - sy * s + _tx, sx * s + sy * c + _ty];",
    "}",
  ].join("\n");
}

/**
 * 获取变换库（根据依赖动态构建）
 * @param {Object} deps - 依赖对象，包含 transforms: { translate, rotate, scale, push, pop, resetMatrix }
 *                           以及 state: true 表示只需要内部函数（状态 + _applyTransform）
 */
function getTransformationLib(deps) {
  if (!deps) deps = {};
  var lib = [];

  // 状态变量始终需要（即使没有使用变换函数，形状也需要状态变量）
  lib.push(getTransformStateLib());

  // 内部模式：只需要状态变量和 _applyTransform（用于形状函数）
  // 注意：即使在内部模式，也需要 resetMatrix 因为形状每帧需要重置
  if (deps.state) {
    lib.push(getApplyTransformLib());
    lib.push(getResetMatrixLib());
    return lib.join("\n\n");
  }

  // 用户使用的变换函数
  if (deps.translate) {
    lib.push(
      // p5.js: translate(x, y) 在“当前变换”的坐标系下平移
      // 这里用当前的旋转角度，把局部位移 (x,y) 转成全局，再累加到 (_tx,_ty)
      "function translate(x, y) {",
      "  if (y === undefined) y = 0;",
      "  var c = _cosR, s = _sinR;",
      "  var dx = x * c - y * s;",
      "  var dy = x * s + y * c;",
      "  _tx += dx;",
      "  _ty += dy;",
      "}",
    );
  }
  if (deps.rotate) {
    lib.push(
      "function rotate(a) {",
      "  _rotation += a;",
      "  _cosR = Math.cos(_rotation);",
      "  _sinR = Math.sin(_rotation);",
      "}",
    );
  }
  if (deps.scale) {
    lib.push(
      "function scale(sx, sy) { sy = sy === undefined ? sx : sy; _scaleX *= sx; _scaleY *= sy; }",
    );
  }
  if (deps.push) {
    lib.push(
      "function push() {",
      "  var s = {",
      "    tx: _tx,",
      "    ty: _ty,",
      "    rotation: _rotation,",
      "    scaleX: _scaleX,",
      "    scaleY: _scaleY",
      "  };",
      "  if (typeof _ellipseMode !== 'undefined') s.elm = _ellipseMode;",
      "  if (typeof _rectMode !== 'undefined') s.rm = _rectMode;",
      "  if (typeof _angleMode !== 'undefined') s.angm = _angleMode;",
      "  if (typeof _colorMode !== 'undefined') {",
      "    s.cm = _colorMode;",
      "    if (typeof _colorMax1 !== 'undefined') s.c1 = _colorMax1;",
      "    if (typeof _colorMax2 !== 'undefined') s.c2 = _colorMax2;",
      "    if (typeof _colorMax3 !== 'undefined') s.c3 = _colorMax3;",
      "    if (typeof _colorMaxA !== 'undefined') s.ca = _colorMaxA;",
      "  }",
      "  if (typeof _fillColor !== 'undefined' && _fillColor) s.fc = _fillColor.slice(0);",
      "  if (typeof _strokeColor !== 'undefined' && _strokeColor) s.sc = _strokeColor.slice(0);",
      "  if (typeof _strokeWeight !== 'undefined') s.sw = _strokeWeight;",
      "  if (typeof _noFill !== 'undefined') s.nf = _noFill;",
      "  if (typeof _noStroke !== 'undefined') s.ns = _noStroke;",
      "  _stack.push(s);",
      "}",
    );
  }
  if (deps.pop) {
    lib.push(
      "function pop() {",
      "  if (_stack.length > 0) {",
      "    var s = _stack.pop();",
      "    _tx = s.tx; _ty = s.ty; _rotation = s.rotation; _scaleX = s.scaleX; _scaleY = s.scaleY;",
      "    _cosR = Math.cos(_rotation);",
      "    _sinR = Math.sin(_rotation);",
      "    if (s.elm !== undefined) _ellipseMode = s.elm;",
      "    if (s.rm !== undefined) _rectMode = s.rm;",
      "    if (s.angm !== undefined) _angleMode = s.angm;",
      "    if (s.cm !== undefined) {",
      "      _colorMode = s.cm;",
      "      if (s.c1 !== undefined) _colorMax1 = s.c1;",
      "      if (s.c2 !== undefined) _colorMax2 = s.c2;",
      "      if (s.c3 !== undefined) _colorMax3 = s.c3;",
      "      if (s.ca !== undefined) _colorMaxA = s.ca;",
      "    }",
      "    if (s.fc !== undefined) _fillColor = s.fc;",
      "    if (s.sc !== undefined) _strokeColor = s.sc;",
      "    if (s.sw !== undefined) _strokeWeight = s.sw;",
      "    if (s.nf !== undefined) _noFill = s.nf;",
      "    if (s.ns !== undefined) _noStroke = s.ns;",
      "  }",
      "}",
    );
  }
  if (deps.resetMatrix) {
    lib.push(
      "function resetMatrix() { _tx = 0; _ty = 0; _rotation = 0; _scaleX = 1; _scaleY = 1; _stack = []; }",
    );
  }
  if (deps.shape) {
    lib.push(getApplyTransformLib());
  }

  return lib.join("\n\n");
}

/**
 * 获取需要替换的变换函数名列表
 */
function getTransformFunctionNames() {
  // 优先使用 registry
  if (typeof functionRegistry !== "undefined" && functionRegistry.transforms) {
    return Object.keys(functionRegistry.transforms);
  }

  // 备用：硬编码列表
  return ["translate", "rotate", "scale", "push", "pop", "resetMatrix"];
}
