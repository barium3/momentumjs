// Color helpers.

/**
 * Color mode constants.
 */
var COLOR_MODES = {
  RGB: 0,
  HSB: 1,
  HSL: 2
};

/**
 * Default color configuration.
 */
var COLOR_DEFAULTS = {
  mode: COLOR_MODES.RGB,
  maxRGB: [255, 255, 255, 255],
  maxHSB: [360, 100, 100, 1],
  maxHSL: [360, 100, 100, 1],
  fillColor: [1, 1, 1, 1],
  strokeColor: [0, 0, 0, 1],
  strokeWeight: 1
};

/**
 * Build color mode constants for the runtime.
 */
function getColorModeConstantsLib() {
  return [
    "// ===== Color Mode Constants =====",
    "var RGB = " + COLOR_MODES.RGB + ";",
    "var HSB = " + COLOR_MODES.HSB + ";",
    "var HSL = " + COLOR_MODES.HSL + ";"
  ].join("\n");
}

/**
 * Build color state.
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
    "var _hasUserFill = false;",
    "var _hasUserStroke = false;",
    "var _defaultTextFillColor = [0, 0, 0, 1];",
    "var _noFill = false;",
    "var _noStroke = false;",
    "var _lastFillColor = null;",
    "var _lastStrokeColor = null;",
    "var _lastNoFill = null;",
    "var _lastNoStroke = null;",
    "var _lastStrokeWeight = null;",
    "var _lastEncodedColorState = null;"
  ].join("\n");
}

/**
 * Build color conversion helpers.
 */
function getColorConversionLib() {
  return [
    "// ===== Color Conversion Utilities =====",
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
    "}"
  ].join("\n");
}

/**
 * Build colorMode().
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
    "}"
  ].join("\n");
}

/**
 * Build the CSS color parser.
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
    "}"
  ].join("\n");
}

/**
 * Build color().
 */
function getColorFuncLib() {
  return [
    "// ===== color Function =====",
    "function color() {",
    "  var len = arguments.length;",
    "  var v1, v2, v3, a;",
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
    "  var n1 = v1 / _colorMax1;",
    "  var n2 = v2 / _colorMax2;",
    "  var n3 = v3 / _colorMax3;",
    "  var na = a / _colorMaxA;",
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
    "  r = Math.max(0, Math.min(1, r));",
    "  g = Math.max(0, Math.min(1, g));",
    "  b = Math.max(0, Math.min(1, b));",
    "  na = Math.max(0, Math.min(1, na));",

    "  return [r, g, b, na];",
    "}"
  ].join("\n");
}

/**
 * Build fill() and stroke().
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
    "}"
  ].join("\n");
}

/**
 * Build noFill(), noStroke(), and strokeWeight().
 */
function getNoFillStrokeWeightLib() {
  return [
    "function noFill() { _noFill = true; }",
    "function noStroke() { _noStroke = true; }",
    "function strokeWeight(w) { _strokeWeight = w; }"
  ].join("\n");
}

/**
 * Build color channel extractors.
 */
function getColorExtractLib() {
  return [
    "// ===== Color Extract Functions =====",

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
    "function hue(c) {",
    "  if (!c || !c.length) return 0;",
    "  if (_colorMode === RGB) { var hsl = _rgbToHsl(c[0], c[1], c[2]); return hsl[0] * 360; }",
    "  if (_colorMode === HSB) { var hsb = _rgbToHsb(c[0], c[1], c[2]); return hsb[0] * _colorMax1; }",
    "  var hsl = _rgbToHsl(c[0], c[1], c[2]); return hsl[0] * _colorMax1;",
    "}",

    "function saturation(c) {",
    "  if (!c || !c.length) return 0;",
    "  if (_colorMode === HSB) { var hsb = _rgbToHsb(c[0], c[1], c[2]); return hsb[1] * _colorMax2; }",
    "  var hsl = _rgbToHsl(c[0], c[1], c[2]);",
    "  return _colorMode === RGB ? hsl[1] * 100 : hsl[1] * _colorMax2;",
    "}",

    "function brightness(c) {",
    "  if (!c || !c.length) return 0;",
    "  var hsb = _rgbToHsb(c[0], c[1], c[2]);",
    "  return _colorMode === RGB ? hsb[2] * 100 : hsb[2] * _colorMax3;",
    "}",

    "function lightness(c) {",
    "  if (!c || !c.length) return 0;",
    "  var hsl = _rgbToHsl(c[0], c[1], c[2]);",
    "  return _colorMode === RGB ? hsl[2] * 100 : hsl[2] * _colorMax3;",
    "}"
  ].join("\n");
}

/**
 * Build lerpColor().
 */
function getLerpColorLib() {
  return [
    "// ===== lerpColor Function =====",
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
    "}"
  ].join("\n");
}

/**
 * Build encoded color state.
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
    "}"
  ].join("\n");
}

/**
 * Build the color library for the requested dependencies.
 * @param {Object} deps
 */
function getColorLib(deps) {
  if (!deps) deps = {};
  var lib = [];
  var needsConversion = false;
  var needsColorFunc = false;
  if (
    deps.colorMode ||
    deps.hue ||
    deps.saturation ||
    deps.brightness ||
    deps.lightness
  ) {
    needsConversion = true;
  }
  if (deps.color || deps.fill || deps.stroke) {
    needsColorFunc = true;
  }
  if (needsColorFunc || deps.colorMode || deps.RGB || deps.HSB || deps.HSL) {
    lib.push(getColorModeConstantsLib());
  }
  lib.push(getColorStateLib());
  if (deps.state) {
    if (needsConversion) {
      lib.push(getColorConversionLib());
    }
    lib.push(getEncodeColorStateLib());
    return lib.join("\n\n");
  }
  if (needsConversion) {
    lib.push(getColorConversionLib());
  }
  if (deps.colorMode) {
    lib.push(getColorModeLib());
  }
  if (needsColorFunc) {
    if (!needsConversion) {
      lib.push(getColorConversionLib());
    }
    lib.push(getParseColorStringLib());
    lib.push(getColorFuncLib());
  }
  if (deps.fill) {
    lib.push(
      'function fill() { if (arguments.length === 0) return; if (Object.prototype.toString.call(arguments[0]) === "[object Array]") { _fillColor = arguments[0]; } else { _fillColor = color.apply(null, arguments); } _noFill = false; _hasUserFill = true; }'
    );
  }
  if (deps.stroke) {
    lib.push(
      'function stroke() { if (arguments.length === 0) return; if (Object.prototype.toString.call(arguments[0]) === "[object Array]") { _strokeColor = arguments[0]; } else { _strokeColor = color.apply(null, arguments); } _noStroke = false; _hasUserStroke = true; }'
    );
  }
  if (deps.noFill) {
    lib.push("function noFill() { _noFill = true; }");
  }
  if (deps.noStroke) {
    lib.push("function noStroke() { _noStroke = true; }");
  }
  if (deps.strokeWeight) {
    lib.push("function strokeWeight(w) { _strokeWeight = w; }");
  }
  if (deps.red) {
    lib.push(
      "function red(c) { if (!c || !c.length) return 0; return c[0] * _colorMax1; }"
    );
  }
  if (deps.green) {
    lib.push(
      "function green(c) { if (!c || !c.length) return 0; return c[1] * _colorMax2; }"
    );
  }
  if (deps.blue) {
    lib.push(
      "function blue(c) { if (!c || !c.length) return 0; return c[2] * _colorMax3; }"
    );
  }
  if (deps.alpha) {
    lib.push(
      "function alpha(c) { if (!c || !c.length) return 0; return (c[3] !== undefined ? c[3] : 1) * _colorMaxA; }"
    );
  }
  if (deps.hue) {
    if (!needsConversion) {
      lib.push(getColorConversionLib());
      needsConversion = true;
    }
    lib.push(
      "function hue(c) { if (!c || !c.length) return 0; if (_colorMode === RGB) { var hsl = _rgbToHsl(c[0], c[1], c[2]); return hsl[0] * 360; } if (_colorMode === HSB) { var hsb = _rgbToHsb(c[0], c[1], c[2]); return hsb[0] * _colorMax1; } var hsl = _rgbToHsl(c[0], c[1], c[2]); return hsl[0] * _colorMax1; }"
    );
  }
  if (deps.saturation) {
    if (!needsConversion) {
      lib.push(getColorConversionLib());
      needsConversion = true;
    }
    lib.push(
      "function saturation(c) { if (!c || !c.length) return 0; if (_colorMode === HSB) { var hsb = _rgbToHsb(c[0], c[1], c[2]); return hsb[1] * _colorMax2; } var hsl = _rgbToHsl(c[0], c[1], c[2]); return _colorMode === RGB ? hsl[1] * 100 : hsl[1] * _colorMax2; }"
    );
  }
  if (deps.brightness) {
    if (!needsConversion) {
      lib.push(getColorConversionLib());
      needsConversion = true;
    }
    lib.push(
      "function brightness(c) { if (!c || !c.length) return 0; var hsb = _rgbToHsb(c[0], c[1], c[2]); return _colorMode === RGB ? hsb[2] * 100 : hsb[2] * _colorMax3; }"
    );
  }
  if (deps.lightness) {
    if (!needsConversion) {
      lib.push(getColorConversionLib());
      needsConversion = true;
    }
    lib.push(
      "function lightness(c) { if (!c || !c.length) return 0; var hsl = _rgbToHsl(c[0], c[1], c[2]); return _colorMode === RGB ? hsl[2] * 100 : hsl[2] * _colorMax3; }"
    );
  }
  if (deps.lerpColor) {
    if (!needsConversion) {
      lib.push(getColorConversionLib());
      needsConversion = true;
    }
    lib.push(getLerpColorLib());
  }
  if (deps.shape) {
    lib.push(getEncodeColorStateLib());
  }

  return lib.join("\n\n");
}

// ========================================
// background helper
// ========================================

/**
 * Build background().
 */
function getBackgroundLib() {
  return [
    "function _background() {",
    "  if (!_render) return;",
    "  var __shapeArgs = _consumeShapeArgs(arguments);",
    "  var args = __shapeArgs.values;",
    "  var callsiteId = __shapeArgs.callsiteId;",
    "  var ref = _nextShapeRef('background', callsiteId);",
    "  var slotKey = ref.slotKey;",
    "  var hasExplicitAlpha = false;",
    "  if (args.length === 2 || args.length === 4) {",
    "    hasExplicitAlpha = true;",
    "  } else if (args.length === 1) {",
    "    var arg0 = args[0];",
    "    if (arg0 && typeof arg0 === 'object' && arg0.length !== undefined) {",
    "      hasExplicitAlpha = arg0.length >= 4;",
    "    }",
    "  }",
    "  var c = color.apply(null, args);",
    "  var col = [c[0], c[1], c[2], c[3] !== undefined ? c[3] : 1];",
    "  _backgrounds.push({",
    '    slotKey:slotKey, type:"background",',
    "    color: col,",
    "    explicitAlpha: hasExplicitAlpha",
    "  });",
    "}",
    "function background(){ return _background.apply(this, arguments); }"
  ].join("\n");
}

/**
 * Create a background layer from exported data.
 */
function createBackgroundFromContext(index, slotKey, mainCompName, targetLayer) {
  var layer = targetLayer || engineComp.layers.addShape();
  if (!targetLayer) {
    layer.name = "Background_" + index;
  }

  var shapeGroup = layer.property("Contents").addProperty("ADBE Vector Group");
  try {
    shapeGroup.name = "Background_" + index;
  } catch (e0) {}
  var rect = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Shape - Rect");
  var transform = shapeGroup.property("Transform");

  var engineLayerExpr;
  if (mainCompName) {
    var escapedName = mainCompName.replace(/"/g, '\\"');
    engineLayerExpr =
      'comp("' + escapedName + '").layer("__engine__").text.sourceText';
  } else {
    engineLayerExpr = 'thisComp.layer("__engine__").text.sourceText';
  }

  var indexFind = [
    "var raw = " + engineLayerExpr + ";",
    "var json = raw && raw.toString ? raw.toString() : raw;",
    "var data = JSON.parse(json);",
    "var backgrounds = data.backgrounds || [];",
    "var idx = data.backgroundSlotIndex || {};",
    "var targetKey = " + JSON.stringify(slotKey) + ";",
    "var bg = (idx && idx[targetKey] !== undefined) ? backgrounds[idx[targetKey]] : null;"
  ].join("\n");
  if (!targetLayer) {
    layer.property("Transform").property("Anchor Point").setValue([0, 0]);
    layer.property("Transform").property("Position").setValue([0, 0]);
  }
  transform.property("Anchor Point").setValue([0, 0]);
  transform.property("Position").setValue([
    engineComp.width / 2,
    engineComp.height / 2
  ]);
  rect.property("Size").expression = [
    indexFind,
    "!bg ? [0, 0] : [thisComp.width, thisComp.height]"
  ].join("\n");
  transform.property("Rotation").setValue(0);
  var fill = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Graphic - Fill");
  fill.property("Color").expression = [
    indexFind,
    "if (!bg || !bg.color) [1, 1, 1, 1];",
    "var c = bg.color;",
    "[c[0], c[1], c[2], 1]"
  ].join("\n");

  fill.property("Opacity").expression = [
    indexFind,
    "if (!bg || !bg.color) 100;",
    "var c = bg.color;",
    "c[3] !== undefined ? c[3] * 100 : 100"
  ].join("\n");
}

/**
 * Return color function names.
 */
function getColorFunctionNames() {
  if (typeof functionRegistry !== "undefined" && functionRegistry.colors) {
    return Object.keys(functionRegistry.colors);
  }
}
