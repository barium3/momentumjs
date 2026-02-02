// ----------------------------------------
// Color - 模块化版本
// 处理 Processing 风格的颜色操作 (fill, stroke, noFill, noStroke, strokeWeight)
// ----------------------------------------

/**
 * 获取颜色状态变量（始终需要）
 */
function getColorStateLib() {
  return [
    "// ===== Color State =====",
    "var _fillColor = [1, 1, 1, 1];",
    "var _strokeColor = [0, 0, 0, 1];",
    "var _strokeWeight = 1;",
    "var _noFill = false;",
    "var _noStroke = true;",
  ].join("\n");
}

/**
 * 获取 color 函数（颜色创建）
 */
function getColorFuncLib() {
  return [
    "function color() {",
    "  var a = arguments[0], b = arguments[1], c = arguments[2], d = arguments[3];",
    "  function reMap(v) { return v / 255; }",
    "  if (arguments.length === 1) {",
    "    if (typeof a === 'number') { var g = reMap(a); return [g, g, g, 1]; }",
    "  } else if (arguments.length === 2) {",
    "    var g = reMap(a); return [g, g, g, b / 255];",
    "  } else if (arguments.length === 3) {",
    "    return [reMap(a), reMap(b), reMap(c), 1];",
    "  } else if (arguments.length === 4) {",
    "    return [reMap(a), reMap(b), reMap(c), d / 255];",
    "  }",
    "  return [1, 1, 1, 1];",
    "}",
  ].join("\n");
}

/**
 * 获取 fill/stroke 函数库
 */
function getFillStrokeLib() {
  return [
    "function fill() {",
    "  if (arguments.length === 0) return;",
    '  if (Object.prototype.toString.call(arguments[0]) === "[object Array]") { _fillColor = arguments[0]; }',
    "  else { _fillColor = color.apply(null, arguments); }",
    "  _noFill = false;",
    "}",
    "function stroke() {",
    "  if (arguments.length === 0) return;",
    '  if (Object.prototype.toString.call(arguments[0]) === "[object Array]") { _strokeColor = arguments[0]; }',
    "  else { _strokeColor = color.apply(null, arguments); }",
    "  _noStroke = false;",
    "}",
  ].join("\n");
}

/**
 * 获取 noFill/noStroke/strokeWeight 函数库
 */
function getNoFillStrokeWeightLib() {
  return [
    "function noFill() { _noFill = true; }",
    "function noStroke() { _noStroke = true; }",
    "function strokeWeight(w) { _strokeWeight = w; }",
  ].join("\n");
}

/**
 * 获取 lerpColor 函数库
 */
function getLerpColorLib() {
  return [
    "function lerpColor(c1, c2, amt) {",
    "  var r = [];",
    "  for (var i = 0; i < c1.length; i++) { r[i] = c1[i] + (c2[i] - c1[i]) * amt; }",
    "  return r;",
    "}",
  ].join("\n");
}

/**
 * 获取颜色重置函数
 */
function getResetColorsLib() {
  return [
    "function resetColors() {",
    "  _fillColor = [1, 1, 1, 1];",
    "  _strokeColor = [0, 0, 0, 1];",
    "  _strokeWeight = 1;",
    "  _noFill = false;",
    "  _noStroke = true;",
    "}",
  ].join("\n");
}

/**
 * 获取颜色编码函数（形状函数依赖）
 */
function getEncodeColorStateLib() {
  return [
    "function _encodeColorState() {",
    "  var fill = _noFill ? [-1, -1] : [_fillColor[0], _fillColor[1]];",
    "  var fill2 = _noFill ? [-1, -1] : [_fillColor[2], _fillColor[3] || 1];",
    "  var stroke = _noStroke ? [-1, -1] : [_strokeColor[0], _strokeColor[1]];",
    "  var stroke2 = _noStroke ? [-1, _strokeWeight] : [_strokeColor[2], _strokeWeight];",
    "  return [fill, fill2, stroke, stroke2];",
    "}",
  ].join("\n");
}

/**
 * 获取颜色库（根据依赖动态构建）
 * @param {Object} deps - 依赖对象，包含 colors: { color, fill, stroke, noFill, noStroke, strokeWeight, lerpColor }
 *                       以及 state: true 表示只需要内部函数（状态 + _encodeColorState）
 */
function getColorLib(deps) {
  if (!deps) deps = {};
  var lib = [];

  // 状态变量始终需要（即使没有使用颜色函数，形状也需要状态变量）
  lib.push(getColorStateLib());

  // 内部模式：只需要状态变量和 _encodeColorState（用于形状函数）
  // 注意：即使在内部模式，也需要 resetColors 因为形状每帧需要重置
  if (deps.state) {
    lib.push(getEncodeColorStateLib());
    lib.push(getResetColorsLib());
    return lib.join("\n\n");
  }

  // color 函数
  if (deps.color) {
    lib.push(getColorFuncLib());
  }

  // fill/stroke - 这些函数内部依赖 color()，所以必须同时加载 color 函数
  if (deps.fill) {
    lib.push(getColorFuncLib()); // 先定义 color 函数
    lib.push(
      'function fill() { if (arguments.length === 0) return; if (Object.prototype.toString.call(arguments[0]) === "[object Array]") { _fillColor = arguments[0]; } else { _fillColor = color.apply(null, arguments); } _noFill = false; }',
    );
  }
  if (deps.stroke) {
    if (!deps.fill) lib.push(getColorFuncLib()); // 只在还没定义 color 时添加
    lib.push(
      'function stroke() { if (arguments.length === 0) return; if (Object.prototype.toString.call(arguments[0]) === "[object Array]") { _strokeColor = arguments[0]; } else { _strokeColor = color.apply(null, arguments); } _noStroke = false; }',
    );
  }

  // noFill/noStroke/strokeWeight
  if (deps.noFill) {
    lib.push("function noFill() { _noFill = true; }");
  }
  if (deps.noStroke) {
    lib.push("function noStroke() { _noStroke = true; }");
  }
  if (deps.strokeWeight) {
    lib.push("function strokeWeight(w) { _strokeWeight = w; }");
  }

  // lerpColor
  if (deps.lerpColor) {
    lib.push(getLerpColorLib());
  }

  // 形状函数需要 _encodeColorState 和 resetColors
  if (deps.shape) {
    lib.push(getEncodeColorStateLib());
    lib.push(getResetColorsLib());
  }

  return lib.join("\n\n");
}

/**
 * 获取需要替换的颜色函数名列表
 */
function getColorFunctionNames() {
  // 优先使用 registry
  if (typeof functionRegistry !== "undefined" && functionRegistry.colors) {
    return Object.keys(functionRegistry.colors);
  }

  // 备用：硬编码列表
  return [
    "fill",
    "stroke",
    "noFill",
    "noStroke",
    "strokeWeight",
    "color",
    "lerpColor",
  ];
}
