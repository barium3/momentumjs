// ----------------------------------------
// Color - 模块化版本
// 处理 Processing 风格的颜色操作
// 支持 RGB, HSB, HSL 颜色模式
// ----------------------------------------

/**
 * 颜色模式常量
 */
var COLOR_MODES = {
  RGB: 0,
  HSB: 1,
  HSL: 2,
};

/**
 * 默认颜色配置
 */
var COLOR_DEFAULTS = {
  mode: COLOR_MODES.RGB,
  maxRGB: [255, 255, 255, 255], // [r, g, b, a] max values for RGB
  maxHSB: [360, 100, 100, 1], // [h, s, b, a] max values for HSB
  maxHSL: [360, 100, 100, 1], // [h, s, l, a] max values for HSL
  fillColor: [1, 1, 1, 1], // 默认填充色 (白色)
  strokeColor: [0, 0, 0, 1], // 默认描边色 (黑色)
  strokeWeight: 1,
};

/**
 * 获取颜色模式常量定义
 */
function getColorModeConstantsLib() {
  return [
    "// ===== Color Mode Constants =====",
    "var RGB = " + COLOR_MODES.RGB + ";",
    "var HSB = " + COLOR_MODES.HSB + ";",
    "var HSL = " + COLOR_MODES.HSL + ";",
  ].join("\n");
}

/**
 * 获取颜色状态变量
 */
function getColorStateLib() {
  var defaults = COLOR_DEFAULTS;
  return [
    "// ===== Color State =====",
    "var _colorMode = " + defaults.mode + ";",
    "var _colorMax1 = " + defaults.maxRGB[0] + ";",
    "var _colorMax2 = " + defaults.maxRGB[1] + ";",
    "var _colorMax3 = " + defaults.maxRGB[2] + ";",
    "var _colorMaxA = " + defaults.maxRGB[3] + ";",
    "var _fillColor = [" + defaults.fillColor.join(", ") + "];",
    "var _strokeColor = [" + defaults.strokeColor.join(", ") + "];",
    "var _strokeWeight = " + defaults.strokeWeight + ";",
    "var _noFill = false;",
    "var _noStroke = false;",
    "var _lastFillColor = null;",
    "var _lastStrokeColor = null;",
    "var _lastNoFill = null;",
    "var _lastNoStroke = null;",
    "var _lastStrokeWeight = null;",
    "var _lastEncodedColorState = null;",
  ].join("\n");
}

/**
 * 获取颜色转换工具函数
 */
function getColorConversionLib() {
  return [
    "// ===== Color Conversion Utilities =====",

    // RGB -> HSB
    "function _rgbToHsb(r, g, b) {",
    "  var max = Math.max(r, g, b), min = Math.min(r, g, b);",
    "  var h, s, v = max;",
    "  var d = max - min;",
    "  s = max === 0 ? 0 : d / max;",
    "  if (max === min) { h = 0; }",
    "  else {",
    "    switch (max) {",
    "      case r: h = (g - b) / d + (g < b ? 6 : 0); break;",
    "      case g: h = (b - r) / d + 2; break;",
    "      case b: h = (r - g) / d + 4; break;",
    "    }",
    "    h /= 6;",
    "  }",
    "  return [h, s, v];",
    "}",

    // HSB -> RGB
    "function _hsbToRgb(h, s, v) {",
    "  var r, g, b;",
    "  var i = Math.floor(h * 6);",
    "  var f = h * 6 - i;",
    "  var p = v * (1 - s);",
    "  var q = v * (1 - f * s);",
    "  var t = v * (1 - (1 - f) * s);",
    "  switch (i % 6) {",
    "    case 0: r = v; g = t; b = p; break;",
    "    case 1: r = q; g = v; b = p; break;",
    "    case 2: r = p; g = v; b = t; break;",
    "    case 3: r = p; g = q; b = v; break;",
    "    case 4: r = t; g = p; b = v; break;",
    "    case 5: r = v; g = p; b = q; break;",
    "  }",
    "  return [r, g, b];",
    "}",

    // RGB -> HSL
    "function _rgbToHsl(r, g, b) {",
    "  var max = Math.max(r, g, b), min = Math.min(r, g, b);",
    "  var h, s, l = (max + min) / 2;",
    "  if (max === min) { h = s = 0; }",
    "  else {",
    "    var d = max - min;",
    "    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);",
    "    switch (max) {",
    "      case r: h = (g - b) / d + (g < b ? 6 : 0); break;",
    "      case g: h = (b - r) / d + 2; break;",
    "      case b: h = (r - g) / d + 4; break;",
    "    }",
    "    h /= 6;",
    "  }",
    "  return [h, s, l];",
    "}",

    // HSL -> RGB
    "function _hslToRgb(h, s, l) {",
    "  var r, g, b;",
    "  if (s === 0) { r = g = b = l; }",
    "  else {",
    "    function hue2rgb(p, q, t) {",
    "      if (t < 0) t += 1;",
    "      if (t > 1) t -= 1;",
    "      if (t < 1/6) return p + (q - p) * 6 * t;",
    "      if (t < 1/2) return q;",
    "      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;",
    "      return p;",
    "    }",
    "    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;",
    "    var p = 2 * l - q;",
    "    r = hue2rgb(p, q, h + 1/3);",
    "    g = hue2rgb(p, q, h);",
    "    b = hue2rgb(p, q, h - 1/3);",
    "  }",
    "  return [r, g, b];",
    "}",
  ].join("\n");
}

/**
 * 获取 colorMode 函数
 */
function getColorModeLib() {
  return [
    "// ===== colorMode Function =====",
    "function colorMode(mode, max1, max2, max3, maxA) {",
    "  _colorMode = mode;",
    "  if (arguments.length === 2) {",
    "    _colorMax1 = _colorMax2 = _colorMax3 = max1;",
    "    _colorMaxA = max1;",
    "  } else if (arguments.length === 4) {",
    "    _colorMax1 = max1;",
    "    _colorMax2 = max2;",
    "    _colorMax3 = max3;",
    "  } else if (arguments.length >= 5) {",
    "    _colorMax1 = max1;",
    "    _colorMax2 = max2;",
    "    _colorMax3 = max3;",
    "    _colorMaxA = maxA;",
    "  }",
    "}",
  ].join("\n");
}

/**
 * 获取 CSS 颜色解析函数（与 p5.js 兼容）
 * 支持: 命名颜色、#rgb、#rrggbb、rgb()、rgba()、hsl()、hsla()
 */
function getParseColorStringLib() {
  return [
    "// ===== CSS Color String Parser =====",
    "function _parseColorString(str) {",
    "  if (typeof str !== 'string') return null;",
    "  var s = str.trim().toLowerCase();",
    "  if (s === 'transparent') return [0, 0, 0, 0];",
    "  var named = {black:[0,0,0],white:[1,1,1],red:[1,0,0],lime:[0,1,0],blue:[0,0,1],yellow:[1,1,0],cyan:[0,1,1],magenta:[1,0,1],gray:[0.5,0.5,0.5],grey:[0.5,0.5,0.5],orange:[1,0.65,0],purple:[0.5,0,0.5],pink:[1,0.75,0.8],green:[0,0.5,0],navy:[0,0,0.5],teal:[0,0.5,0.5],maroon:[0.5,0,0],olive:[0.5,0.5,0],silver:[0.75,0.75,0.75],aqua:[0,1,1],fuchsia:[1,0,1]};",
    "  if (named[s]) return [named[s][0], named[s][1], named[s][2], 1];",
    "  var hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{8})$/i);",
    "  if (hex) {",
    "    var h = hex[1];",
    "    var r,g,b,a=1;",
    "    if (h.length === 3) { r=parseInt(h[0]+h[0],16)/255; g=parseInt(h[1]+h[1],16)/255; b=parseInt(h[2]+h[2],16)/255; }",
    "    else if (h.length === 6) { r=parseInt(h.substr(0,2),16)/255; g=parseInt(h.substr(2,2),16)/255; b=parseInt(h.substr(4,2),16)/255; }",
    "    else if (h.length === 4) { r=parseInt(h[0]+h[0],16)/255; g=parseInt(h[1]+h[1],16)/255; b=parseInt(h[2]+h[2],16)/255; a=parseInt(h[3]+h[3],16)/255; }",
    "    else { r=parseInt(h.substr(0,2),16)/255; g=parseInt(h.substr(2,2),16)/255; b=parseInt(h.substr(4,2),16)/255; a=parseInt(h.substr(6,2),16)/255; }",
    "    return [r,g,b,a];",
    "  }",
    "  var rgb = s.match(/^rgba?\\(\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*(?:,\\s*([\\d.]+)\\s*)?\\)$/);",
    "  if (rgb) {",
    "    var a = rgb[4] !== undefined ? parseFloat(rgb[4]) : 1;",
    "    if (a > 1) a /= 255;",
    "    return [parseFloat(rgb[1])/255, parseFloat(rgb[2])/255, parseFloat(rgb[3])/255, a];",
    "  }",
    "  var rgbPct = s.match(/^rgba?\\(\\s*([\\d.]+)%\\s*,\\s*([\\d.]+)%\\s*,\\s*([\\d.]+)%\\s*(?:,\\s*([\\d.]+)\\s*)?\\)$/);",
    "  if (rgbPct) {",
    "    var a = rgbPct[4] !== undefined ? parseFloat(rgbPct[4]) : 1;",
    "    if (a > 1) a /= 255;",
    "    return [parseFloat(rgbPct[1])/100, parseFloat(rgbPct[2])/100, parseFloat(rgbPct[3])/100, a];",
    "  }",
    "  var hsl = s.match(/^hsla?\\(\\s*([\\d.]+)\\s*,\\s*([\\d.]+)%\\s*,\\s*([\\d.]+)%\\s*(?:,\\s*([\\d.]+)\\s*)?\\)$/);",
    "  if (hsl) {",
    "    var h = parseFloat(hsl[1]) / 360;",
    "    if (h < 0) h += 1; if (h > 1) h -= Math.floor(h);",
    "    var sl = parseFloat(hsl[2]) / 100;",
    "    var l = parseFloat(hsl[3]) / 100;",
    "    var a = hsl[4] !== undefined ? parseFloat(hsl[4]) : 1;",
    "    if (a > 1) a /= 255;",
    "    var rgb = _hslToRgb(h, sl, l);",
    "    return [rgb[0], rgb[1], rgb[2], a];",
    "  }",
    "  return null;",
    "}",
  ].join("\n");
}

/**
 * 获取 color 函数（颜色创建）
 * 返回 [r, g, b, a] 格式，其中 r, g, b, a 都是 0-1 范围
 * 支持 p5: 数字、数组、CSS 字符串
 */
function getColorFuncLib() {
  return [
    "// ===== color Function =====",
    "function color() {",
    "  var len = arguments.length;",
    "  var v1, v2, v3, a;",

    // 单参数：数组、字符串、数字
    "  if (len === 1) {",
    "    var arg = arguments[0];",
    "    if (typeof arg === 'object' && arg.length) {",
    "      return arg;",
    "    }",
    "    if (typeof arg === 'string') {",
    "      var parsed = _parseColorString(arg);",
    "      if (parsed) return parsed;",
    "    }",
    "    v1 = v2 = v3 = arg;",
    "    a = _colorMaxA;",
    "  } else if (len === 2) {",
    "    v1 = v2 = v3 = arguments[0];",
    "    a = arguments[1];",
    "  } else if (len === 3) {",
    "    v1 = arguments[0];",
    "    v2 = arguments[1];",
    "    v3 = arguments[2];",
    "    a = _colorMaxA;",
    "  } else if (len >= 4) {",
    "    v1 = arguments[0];",
    "    v2 = arguments[1];",
    "    v3 = arguments[2];",
    "    a = arguments[3];",
    "  } else {",
    "    return [1, 1, 1, 1];",
    "  }",

    // 归一化值
    "  var n1 = v1 / _colorMax1;",
    "  var n2 = v2 / _colorMax2;",
    "  var n3 = v3 / _colorMax3;",
    "  var na = a / _colorMaxA;",

    // 根据颜色模式转换为 RGB
    "  var r, g, b;",
    "  if (_colorMode === RGB) {",
    "    r = n1; g = n2; b = n3;",
    "  } else if (_colorMode === HSB) {",
    "    var rgb = _hsbToRgb(n1, n2, n3);",
    "    r = rgb[0]; g = rgb[1]; b = rgb[2];",
    "  } else if (_colorMode === HSL) {",
    "    var rgb = _hslToRgb(n1, n2, n3);",
    "    r = rgb[0]; g = rgb[1]; b = rgb[2];",
    "  } else {",
    "    r = n1; g = n2; b = n3;",
    "  }",

    // 限制范围
    "  r = Math.max(0, Math.min(1, r));",
    "  g = Math.max(0, Math.min(1, g));",
    "  b = Math.max(0, Math.min(1, b));",
    "  na = Math.max(0, Math.min(1, na));",

    "  return [r, g, b, na];",
    "}",
  ].join("\n");
}

/**
 * 获取 fill/stroke 函数库
 */
function getFillStrokeLib() {
  return [
    "// ===== fill/stroke Functions =====",
    "function fill() {",
    "  if (arguments.length === 0) return;",
    '  if (Object.prototype.toString.call(arguments[0]) === "[object Array]") {',
    "    _fillColor = arguments[0];",
    "  } else {",
    "    _fillColor = color.apply(null, arguments);",
    "  }",
    "  _noFill = false;",
    "}",
    "function stroke() {",
    "  if (arguments.length === 0) return;",
    '  if (Object.prototype.toString.call(arguments[0]) === "[object Array]") {',
    "    _strokeColor = arguments[0];",
    "  } else {",
    "    _strokeColor = color.apply(null, arguments);",
    "  }",
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
 * 获取颜色提取函数库
 * p5 兼容：RGB 模式下 hue/saturation/brightness/lightness 使用固定默认范围
 * - hue: 0-360 (HSL)
 * - saturation: 0-100 (HSL)
 * - brightness: 0-100 (HSB)
 * - lightness: 0-100 (HSL)
 * HSB/HSL 模式下使用 _colorMax 范围
 */
function getColorExtractLib() {
  return [
    "// ===== Color Extract Functions (p5 compatible) =====",

    "function red(c) {",
    "  if (!c || !c.length) return 0;",
    "  return c[0] * _colorMax1;",
    "}",

    "function green(c) {",
    "  if (!c || !c.length) return 0;",
    "  return c[1] * _colorMax2;",
    "}",

    "function blue(c) {",
    "  if (!c || !c.length) return 0;",
    "  return c[2] * _colorMax3;",
    "}",

    "function alpha(c) {",
    "  if (!c || !c.length) return 0;",
    "  return (c[3] !== undefined ? c[3] : 1) * _colorMaxA;",
    "}",

    // hue: RGB 模式默认 0-360(HSL)，HSB/HSL 模式用 _colorMax1
    "function hue(c) {",
    "  if (!c || !c.length) return 0;",
    "  if (_colorMode === RGB) { var hsl = _rgbToHsl(c[0], c[1], c[2]); return hsl[0] * 360; }",
    "  if (_colorMode === HSB) { var hsb = _rgbToHsb(c[0], c[1], c[2]); return hsb[0] * _colorMax1; }",
    "  var hsl = _rgbToHsl(c[0], c[1], c[2]); return hsl[0] * _colorMax1;",
    "}",

    // saturation: RGB 模式默认 0-100(HSL)，HSB/HSL 模式用 _colorMax2
    "function saturation(c) {",
    "  if (!c || !c.length) return 0;",
    "  if (_colorMode === HSB) { var hsb = _rgbToHsb(c[0], c[1], c[2]); return hsb[1] * _colorMax2; }",
    "  var hsl = _rgbToHsl(c[0], c[1], c[2]);",
    "  return _colorMode === RGB ? hsl[1] * 100 : hsl[1] * _colorMax2;",
    "}",

    // brightness: RGB 模式默认 0-100(HSB)，HSB 模式用 _colorMax3
    "function brightness(c) {",
    "  if (!c || !c.length) return 0;",
    "  var hsb = _rgbToHsb(c[0], c[1], c[2]);",
    "  return _colorMode === RGB ? hsb[2] * 100 : hsb[2] * _colorMax3;",
    "}",

    // lightness: RGB 模式默认 0-100(HSL)，HSL 模式用 _colorMax3
    "function lightness(c) {",
    "  if (!c || !c.length) return 0;",
    "  var hsl = _rgbToHsl(c[0], c[1], c[2]);",
    "  return _colorMode === RGB ? hsl[2] * 100 : hsl[2] * _colorMax3;",
    "}",
  ].join("\n");
}

/**
 * 获取 lerpColor 函数库
 * p5 兼容：amt 限制 [0,1]，HSB/HSL 模式下色相沿色轮最短路径插值
 */
function getLerpColorLib() {
  return [
    "// ===== lerpColor Function (p5 compatible) =====",
    "function lerpColor(c1, c2, amt) {",
    "  if (!c1 || !c2) return [1, 1, 1, 1];",
    "  amt = Math.max(0, Math.min(1, amt));",
    "  if (_colorMode === RGB) {",
    "    var r = [];",
    "    var len = Math.min(c1.length, c2.length);",
    "    for (var i = 0; i < len; i++) { r[i] = c1[i] + (c2[i] - c1[i]) * amt; }",
    "    if (r.length < 4) r[3] = 1;",
    "    return r;",
    "  }",
    "  var fromArr, toArr;",
    "  if (_colorMode === HSB) {",
    "    fromArr = _rgbToHsb(c1[0], c1[1], c1[2]);",
    "    toArr = _rgbToHsb(c2[0], c2[1], c2[2]);",
    "  } else {",
    "    fromArr = _rgbToHsl(c1[0], c1[1], c1[2]);",
    "    toArr = _rgbToHsl(c2[0], c2[1], c2[2]);",
    "  }",
    "  var a1 = c1[3] !== undefined ? c1[3] : 1;",
    "  var a2 = c2[3] !== undefined ? c2[3] : 1;",
    "  var h1 = fromArr[0], h2 = toArr[0];",
    "  if (Math.abs(h2 - h1) > 0.5) { if (h1 > h2) h2 += 1; else h1 += 1; }",
    "  var lh = h1 + (h2 - h1) * amt;",
    "  if (lh >= 1) lh -= 1; if (lh < 0) lh += 1;",
    "  var ls = fromArr[1] + (toArr[1] - fromArr[1]) * amt;",
    "  var lv = fromArr[2] + (toArr[2] - fromArr[2]) * amt;",
    "  var la = a1 + (a2 - a1) * amt;",
    "  var rgb;",
    "  if (_colorMode === HSB) rgb = _hsbToRgb(lh, ls, lv); else rgb = _hslToRgb(lh, ls, lv);",
    "  return [rgb[0], rgb[1], rgb[2], la];",
    "}",
  ].join("\n");
}

/**
 * 获取颜色编码函数（形状函数依赖）
 * 编码结构: [fill1, fill2, stroke1, stroke2, opacity]
 * - fill1: [r, g]
 * - fill2: [b, a]
 * - stroke1: [r, g]
 * - stroke2: [b, a]
 * - opacity: [fillOpacity(0-100), strokeOpacity(0-100)]
 */
function getEncodeColorStateLib() {
  return [
    "function _encodeColorState() {",
    "  if (_fillColor === _lastFillColor &&",
    "      _strokeColor === _lastStrokeColor &&",
    "      _noFill === _lastNoFill &&",
    "      _noStroke === _lastNoStroke &&",
    "      _strokeWeight === _lastStrokeWeight &&",
    "      _lastEncodedColorState !== null) {",
    "    return _lastEncodedColorState;",
    "  }",
    "  var fill1 = _noFill ? [-1, -1] : [_fillColor[0], _fillColor[1]];",
    "  var fill2 = _noFill ? [-1, -1] : [_fillColor[2], _fillColor[3] !== undefined ? _fillColor[3] : 1];",
    "  var stroke1 = _noStroke ? [-1, -1] : [_strokeColor[0], _strokeColor[1]];",
    "  var stroke2 = _noStroke ? [-1, -1] : [_strokeColor[2], _strokeColor[3] !== undefined ? _strokeColor[3] : 1];",
    "  var opacity = [",
    "    _noFill ? 0 : (_fillColor[3] !== undefined ? _fillColor[3] : 1) * 100,",
    "    _noStroke ? 0 : (_strokeColor[3] !== undefined ? _strokeColor[3] : 1) * 100",
    "  ];",
    "  _lastFillColor = _fillColor;",
    "  _lastStrokeColor = _strokeColor;",
    "  _lastNoFill = _noFill;",
    "  _lastNoStroke = _noStroke;",
    "  _lastStrokeWeight = _strokeWeight;",
    "  _lastEncodedColorState = [fill1, fill2, stroke1, stroke2, opacity, [_strokeWeight, 0]];",
    "  return _lastEncodedColorState;",
    "}",
  ].join("\n");
}

/**
 * 获取颜色库（根据依赖动态构建）
 * @param {Object} deps - 依赖对象
 */
function getColorLib(deps) {
  if (!deps) deps = {};
  var lib = [];
  var needsConversion = false;
  var needsColorFunc = false;

  // 检查是否需要颜色转换函数
  if (
    deps.colorMode ||
    deps.hue ||
    deps.saturation ||
    deps.brightness ||
    deps.lightness
  ) {
    needsConversion = true;
  }

  // 检查是否需要 color 函数
  if (deps.color || deps.fill || deps.stroke) {
    needsColorFunc = true;
  }

  // 颜色模式常量（如果使用了任何颜色函数）
  if (needsColorFunc || deps.colorMode || deps.RGB || deps.HSB || deps.HSL) {
    lib.push(getColorModeConstantsLib());
  }

  // 状态变量始终需要
  lib.push(getColorStateLib());

  // 内部模式：只需要状态变量和 _encodeColorState
  if (deps.state) {
    if (needsConversion) {
      lib.push(getColorConversionLib());
    }
    lib.push(getEncodeColorStateLib());
    return lib.join("\n\n");
  }

  // 颜色转换函数（如果需要）
  if (needsConversion) {
    lib.push(getColorConversionLib());
  }

  // colorMode 函数
  if (deps.colorMode) {
    lib.push(getColorModeLib());
  }

  // color 函数
  if (needsColorFunc) {
    // color 需要颜色转换（非 RGB 模式 + CSS hsl 解析）
    if (!needsConversion) {
      lib.push(getColorConversionLib());
    }
    lib.push(getParseColorStringLib());
    lib.push(getColorFuncLib());
  }

  // fill/stroke
  // fill/stroke 支持数组、CSS 字符串、数字参数（通过 color 解析）
  if (deps.fill) {
    lib.push(
      'function fill() { if (arguments.length === 0) return; if (Object.prototype.toString.call(arguments[0]) === "[object Array]") { _fillColor = arguments[0]; } else { _fillColor = color.apply(null, arguments); } _noFill = false; }',
    );
  }
  if (deps.stroke) {
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

  // 颜色提取函数
  if (deps.red) {
    lib.push(
      "function red(c) { if (!c || !c.length) return 0; return c[0] * _colorMax1; }",
    );
  }
  if (deps.green) {
    lib.push(
      "function green(c) { if (!c || !c.length) return 0; return c[1] * _colorMax2; }",
    );
  }
  if (deps.blue) {
    lib.push(
      "function blue(c) { if (!c || !c.length) return 0; return c[2] * _colorMax3; }",
    );
  }
  if (deps.alpha) {
    lib.push(
      "function alpha(c) { if (!c || !c.length) return 0; return (c[3] !== undefined ? c[3] : 1) * _colorMaxA; }",
    );
  }
  if (deps.hue) {
    if (!needsConversion) {
      lib.push(getColorConversionLib());
      needsConversion = true;
    }
    lib.push(
      "function hue(c) { if (!c || !c.length) return 0; if (_colorMode === RGB) { var hsl = _rgbToHsl(c[0], c[1], c[2]); return hsl[0] * 360; } if (_colorMode === HSB) { var hsb = _rgbToHsb(c[0], c[1], c[2]); return hsb[0] * _colorMax1; } var hsl = _rgbToHsl(c[0], c[1], c[2]); return hsl[0] * _colorMax1; }",
    );
  }
  if (deps.saturation) {
    if (!needsConversion) {
      lib.push(getColorConversionLib());
      needsConversion = true;
    }
    lib.push(
      "function saturation(c) { if (!c || !c.length) return 0; if (_colorMode === HSB) { var hsb = _rgbToHsb(c[0], c[1], c[2]); return hsb[1] * _colorMax2; } var hsl = _rgbToHsl(c[0], c[1], c[2]); return _colorMode === RGB ? hsl[1] * 100 : hsl[1] * _colorMax2; }",
    );
  }
  if (deps.brightness) {
    if (!needsConversion) {
      lib.push(getColorConversionLib());
      needsConversion = true;
    }
    lib.push(
      "function brightness(c) { if (!c || !c.length) return 0; var hsb = _rgbToHsb(c[0], c[1], c[2]); return _colorMode === RGB ? hsb[2] * 100 : hsb[2] * _colorMax3; }",
    );
  }
  if (deps.lightness) {
    if (!needsConversion) {
      lib.push(getColorConversionLib());
      needsConversion = true;
    }
    lib.push(
      "function lightness(c) { if (!c || !c.length) return 0; var hsl = _rgbToHsl(c[0], c[1], c[2]); return _colorMode === RGB ? hsl[2] * 100 : hsl[2] * _colorMax3; }",
    );
  }

  // lerpColor（HSB/HSL 插值需要颜色转换）
  if (deps.lerpColor) {
    if (!needsConversion) {
      lib.push(getColorConversionLib());
      needsConversion = true;
    }
    lib.push(getLerpColorLib());
  }

  // 形状函数需要 _encodeColorState
  if (deps.shape) {
    lib.push(getEncodeColorStateLib());
  }

  return lib.join("\n\n");
}

// ========================================
// background - 渲染函数（纯色图层）
// 颜色逻辑与 color() 一致
// ========================================

/**
 * 获取 background 内部函数
 * p5 逻辑：background 完全独立于 fill/stroke，仅使用传入的参数
 * 支持: background(gray), background(gray,a), background(v1,v2,v3), background(v1,v2,v3,a)
 * 以及 background(c) 其中 c 为 color() 返回的数组
 * 输出格式（语义化 JSON）: { id, type:"background", color:[r,g,b,a] }
 */
function getBackgroundLib() {
  return [
    "function _background() {",
    "  if (!_render) return;",
    "  _backgroundCount++;",
    "  var m = _backgroundCount;",
    "  var id = _shapeTypeCode.background * 10000 + m;",
    "  var c = color.apply(null, arguments);",
    "  var col = [c[0], c[1], c[2], c[3] !== undefined ? c[3] : 1];",
    "  _backgrounds.push({",
    '    id:id, type:"background",',
    "    color: col",
    "  });",
    "}",
  ].join("\n");
}

/**
 * 创建 background 图层
 * 纯色图层，使用形状矩形 + 填色效果（效果-生成-填色）
 * 数据格式（语义化 JSON）: { id, type:"background", color:[r,g,b,a] }
 */
function createBackgroundFromContext(index, renderIndex, mainCompName) {
  var layer = engineComp.layers.addShape();
  layer.name = "Background_" + index;

  var shapeGroup = layer.property("Contents").addProperty("ADBE Vector Group");
  var rect = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Shape - Rect");
  var transform = shapeGroup.property("Transform");

  var engineLayerExpr;
  if (mainCompName) {
    // 从主合成读取，通过合成名称直接调用
    // 转义合成名称中的引号（如果存在）
    var escapedName = mainCompName.replace(/"/g, '\\"');
    engineLayerExpr = 'comp("' + escapedName + '").layer("__engine__").text.sourceText';
  } else {
    // 从当前合成读取
    engineLayerExpr = 'thisComp.layer("__engine__").text.sourceText';
  }

  var indexFind = [
    'var raw = ' + engineLayerExpr + ';',
    "var json = raw && raw.toString ? raw.toString() : raw;",
    "var data = JSON.parse(json);",
    "var backgrounds = data.backgrounds || [];",
    "var targetId = " + renderIndex + ";",
    "var bg = null;",
    "for (var i = backgrounds.length - 1; i >= 0; i--) {",
    "  if (backgrounds[i] && backgrounds[i].id === targetId) {",
    "    bg = backgrounds[i];",
    "    break;",
    "  }",
    "}",
  ].join("\n");

  // 矩形覆盖整个合成：锚点左上角，位置 (0,0)，尺寸为合成宽高
  transform.property("Anchor Point").setValue([0, 0]);
  transform.property("Position").setValue([0, 0]);
  rect.property("Size").expression = [
    indexFind,
    "!bg ? [0, 0] : [thisComp.width, thisComp.height]",
  ].join("\n");
  transform.property("Rotation").setValue(0);

  // 填色效果：颜色和不透明度从 path 读取
  var fill = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Graphic - Fill");

  fill.property("Color").expression = [
    indexFind,
    "if (!bg || !bg.color) [1, 1, 1, 1];",
    "var c = bg.color;",
    "[c[0], c[1], c[2], 1]",
  ].join("\n");

  fill.property("Opacity").expression = [
    indexFind,
    "if (!bg || !bg.color) 100;",
    "var c = bg.color;",
    "c[3] !== undefined ? c[3] * 100 : 100",
  ].join("\n");
}

/**
 * 获取需要替换的颜色函数名列表
 */
function getColorFunctionNames() {
  if (typeof functionRegistry !== "undefined" && functionRegistry.colors) {
    return Object.keys(functionRegistry.colors);
  }
}
