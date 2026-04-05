// Transformation helpers.

function getTransformStateLib() {
  return [
    "// ===== Transformation State =====",
    "var _tx = 0, _ty = 0;",
    "var _rotation = 0;",
    "var _cosR = 1, _sinR = 0;",
    "var _scaleX = 1, _scaleY = 1;",
    "var _stack = [];"
  ].join("\n");
}

function getTransformBasicLib() {
  return [
    "// ===== Transform Functions =====",
    "function translate(x, y) {",
    "  if (x && typeof x === 'object') {",
    "    if (x.x !== undefined || x.y !== undefined) {",
    "      y = x.y !== undefined ? x.y : 0;",
    "      x = x.x !== undefined ? x.x : 0;",
    "    } else if (x.length !== undefined) {",
    "      y = x[1] !== undefined ? x[1] : 0;",
    "      x = x[0] !== undefined ? x[0] : 0;",
    "    }",
    "  }",
    "  if (x === undefined) x = 0;",
    "  if (y === undefined) y = 0;",
    "  var c = _cosR, s = _sinR;",
    "  var dx = x * c - y * s;",
    "  var dy = x * s + y * c;",
    "  _tx += dx;",
    "  _ty += dy;",
    "}",
    "function rotate(a) {",
    "  _rotation += (typeof _angleMode !== 'undefined' && _angleMode === 'DEG') ? a * Math.PI / 180 : a;",
    "  _cosR = Math.cos(_rotation);",
    "  _sinR = Math.sin(_rotation);",
    "}",
    "function scale(sx, sy) {",
    "  if (sx && typeof sx === 'object') {",
    "    if (sx.x !== undefined || sx.y !== undefined) {",
    "      sy = sx.y !== undefined ? sx.y : (sx.x !== undefined ? sx.x : 1);",
    "      sx = sx.x !== undefined ? sx.x : 1;",
    "    } else if (sx.length !== undefined) {",
    "      sy = sx[1] !== undefined ? sx[1] : (sx[0] !== undefined ? sx[0] : 1);",
    "      sx = sx[0] !== undefined ? sx[0] : 1;",
    "    }",
    "  }",
    "  sx = sx === undefined ? 1 : sx;",
    "  sy = sy === undefined ? sx : sy;",
    "  _scaleX *= sx;",
    "  _scaleY *= sy;",
    "}"
  ].join("\n");
}

function getTransformStackLib() {
  return [
    "// ===== Transform Stack =====",
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
    "  if (typeof _textSize !== 'undefined') s.ts = _textSize;",
    "  if (typeof _textLeading !== 'undefined') s.tl = _textLeading;",
    "  if (typeof _textLeadingExplicit !== 'undefined') s.tle = _textLeadingExplicit;",
    "  if (typeof _textAlignH !== 'undefined') s.tah = _textAlignH;",
    "  if (typeof _textAlignV !== 'undefined') s.tav = _textAlignV;",
    "  _stack.push(s);",
    "}",
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
    "    if (s.ts !== undefined) _textSize = s.ts;",
    "    if (s.tl !== undefined) _textLeading = s.tl;",
    "    if (s.tle !== undefined) _textLeadingExplicit = s.tle;",
    "    if (s.tah !== undefined) _textAlignH = s.tah;",
    "    if (s.tav !== undefined) _textAlignV = s.tav;",
    "  }",
    "}"
  ].join("\n");
}

function getResetMatrixLib() {
  return [
    "// ===== Reset Matrix =====",
    "function resetMatrix() {",
    "  _tx = 0; _ty = 0;",
    "  _rotation = 0;",
    "  _cosR = 1; _sinR = 0;",
    "  _scaleX = 1; _scaleY = 1;",
    "  _stack = [];",
    "}"
  ].join("\n");
}

function getApplyTransformLib() {
  return [
    "// ===== Apply Transform =====",
    "function _applyTransform(x, y) {",
    "  var sx = x * _scaleX, sy = y * _scaleY;",
    "  var c = _cosR, s = _sinR;",
    "  return [sx * c - sy * s + _tx, sx * s + sy * c + _ty];",
    "}"
  ].join("\n");
}

// Expression runtime.
function getTransformationLib(deps) {
  if (!deps) deps = {};
  function compactJoin(parts, separator) {
    var compact = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i]) compact.push(parts[i]);
    }
    return compact.join(separator);
  }
  if (deps.state) {
    return compactJoin([
      getTransformStateLib(),
      getApplyTransformLib(),
      getResetMatrixLib()
    ], "\n\n");
  }

  return compactJoin([
    getTransformStateLib(),
    (deps.translate || deps.rotate || deps.scale) ? getTransformBasicLib() : "",
    (deps.push || deps.pop) ? getTransformStackLib() : "",
    deps.resetMatrix ? getResetMatrixLib() : "",
    deps.shape ? getApplyTransformLib() : ""
  ], "\n\n");
}

// Transform function names.
function getTransformFunctionNames() {
  if (typeof functionRegistry !== "undefined" && functionRegistry.transforms) {
    return Object.keys(functionRegistry.transforms);
  }
}
