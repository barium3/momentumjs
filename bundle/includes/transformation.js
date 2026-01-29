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
    "var _scaleX = 1, _scaleY = 1;",
    "var _stack = [];"
  ].join("\n");
}

/**
 * 获取基础变换函数（translate, rotate, scale）
 */
function getTransformBasicLib() {
  return [
    "// Basic Transform Functions",
    "function translate(x, y) { _tx += x; _ty = y !== undefined ? y : _ty + y; }",
    "function rotate(a) { _rotation += a; }",
    "function scale(sx, sy) { sy = sy === undefined ? sx : sy; _scaleX *= sx; _scaleY *= sy; }"
  ].join("\n");
}

/**
 * 获取堆栈函数（push, pop）
 */
function getTransformStackLib() {
  return [
    "// Stack Functions",
    "function push() { _stack.push([_tx, _ty, _rotation, _scaleX, _scaleY]); }",
    "function pop() {",
    "  if (_stack.length > 0) {",
    "    var _v = _stack.pop();",
    "    _tx = _v[0]; _ty = _v[1]; _rotation = _v[2]; _scaleX = _v[3]; _scaleY = _v[4];",
    "  }",
    "}"
  ].join("\n");
}

/**
 * 获取重置矩阵函数
 */
function getResetMatrixLib() {
  return [
    "function resetMatrix() { _tx = 0; _ty = 0; _rotation = 0; _scaleX = 1; _scaleY = 1; _stack = []; }"
  ].join("\n");
}

/**
 * 获取坐标变换函数（形状函数依赖）
 */
function getApplyTransformLib() {
  return [
    "function _applyTransform(x, y) {",
    "  var sx = x * _scaleX, sy = y * _scaleY;",
    "  var c = Math.cos(_rotation), s = Math.sin(_rotation);",
    "  return [sx * c - sy * s + _tx, sx * s + sy * c + _ty];",
    "}"
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
    lib.push("function translate(x, y) { _tx += x; _ty = y !== undefined ? y : _ty + y; }");
  }
  if (deps.rotate) {
    lib.push("function rotate(a) { _rotation += a; }");
  }
  if (deps.scale) {
    lib.push("function scale(sx, sy) { sy = sy === undefined ? sx : sy; _scaleX *= sx; _scaleY *= sy; }");
  }
  if (deps.push) {
    lib.push("function push() { _stack.push([_tx, _ty, _rotation, _scaleX, _scaleY]); }");
  }
  if (deps.pop) {
    lib.push("function pop() { if (_stack.length > 0) { var _v = _stack.pop(); _tx = _v[0]; _ty = _v[1]; _rotation = _v[2]; _scaleX = _v[3]; _scaleY = _v[4]; } }");
  }
  if (deps.resetMatrix) {
    lib.push("function resetMatrix() { _tx = 0; _ty = 0; _rotation = 0; _scaleX = 1; _scaleY = 1; _stack = []; }");
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
  if (typeof functionRegistry !== 'undefined' && functionRegistry.transforms) {
    return Object.keys(functionRegistry.transforms);
  }

  // 备用：硬编码列表
  return ["translate", "rotate", "scale", "push", "pop", "resetMatrix"];
}
