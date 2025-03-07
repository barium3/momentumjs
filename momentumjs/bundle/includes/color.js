pub.color = function () {
  var a = arguments[0],
    b = arguments[1],
    c = arguments[2],
    d = arguments[3];
  var colorErrorMsg =
    "m.color(), 参数错误。请使用: " +
    (currColorMode === "RGB"
      ? "R,G,B"
      : currColorMode === "HSB"
      ? "H,S,B"
      : "C,M,Y,K") +
    " 或 十六进制字符串 或 GREY。";

  function reMap(value, max) {
    return pub.map(value, 0, max, 0, 1);
  }

  if (arguments.length === 1) {
    if (typeof a === "string") {
      if (a.charAt(0) === "#") {
        // 处理十六进制颜色
        var hex = a.substring(1);
        var r = parseInt(hex.substr(0, 2), 16);
        var g = parseInt(hex.substr(2, 2), 16);
        var b = parseInt(hex.substr(4, 2), 16);
        return [reMap(r, 255), reMap(g, 255), reMap(b, 255), 1];
      }
    } else if (typeof a === "number") {
      // GREY
      return [reMap(a, 255), reMap(a, 255), reMap(a, 255), 1];
    } else {
      error("m.color(), 第一个参数类型错误。");
    }
  } else if (arguments.length === 3) {
    if (currColorMode === "RGB") {
      // R G B
      return [reMap(a, 255), reMap(b, 255), reMap(c, 255), 1];
    } else if (currColorMode === "HSB") {
      // H S B
      var rgb = hsbToRgb(a, b, c);
      return [reMap(rgb[0], 255), reMap(rgb[1], 255), reMap(rgb[2], 255), 1];
    }
  } else if (currColorMode === "CMYK" && arguments.length === 4) {
    // C M Y K
    var rgb = cmykToRgb(a, b, c, d);
    return [reMap(rgb[0], 255), reMap(rgb[1], 255), reMap(rgb[2], 255), 1];
  } else {
    error(colorErrorMsg);
  }
};

pub.colorMode = function (colorMode) {
  if (colorMode === "RGB" || colorMode === "HSB" || colorMode === "CMYK") {
    currColorMode = colorMode;
  } else {
    error("m.colorMode(), 不支持的颜色模式。请使用 'RGB'、'HSB' 或 'CMYK'。");
  }
};

function hsbToRgb(h, s, b) {
  h = h % 360;
  s = s / 100;
  b = b / 100;

  var c = b * s;
  var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  var m = b - c;

  var r, g, bl;

  if (h >= 0 && h < 60) {
    r = c;
    g = x;
    bl = 0;
  } else if (h >= 60 && h < 120) {
    r = x;
    g = c;
    bl = 0;
  } else if (h >= 120 && h < 180) {
    r = 0;
    g = c;
    bl = x;
  } else if (h >= 180 && h < 240) {
    r = 0;
    g = x;
    bl = c;
  } else if (h >= 240 && h < 300) {
    r = x;
    g = 0;
    bl = c;
  } else {
    r = c;
    g = 0;
    bl = x;
  }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((bl + m) * 255),
  ];
}

function cmykToRgb(c, m, y, k) {
  c = c / 100;
  m = m / 100;
  y = y / 100;
  k = k / 100;

  var r = 255 * (1 - c) * (1 - k);
  var g = 255 * (1 - m) * (1 - k);
  var b = 255 * (1 - y) * (1 - k);

  return [Math.round(r), Math.round(g), Math.round(b)];
}

pub.fill = function () {
  if (Array.isArray(arguments[0])) {
    currFillColor = arguments[0];
  } else if (
    typeof arguments[0] === "string" &&
    arguments[0].charAt(0) !== "#"
  ) {
    // 处理任何可能的表达式
    currFillColor = arguments[0];
  } else {
    currFillColor = pub.color.apply(null, arguments);
  }

  return;
};

pub.noFill = function () {
  currFillColor = null;
};

pub.stroke = function () {
  if (Array.isArray(arguments[0])) {
    currStrokeColor = arguments[0];
  } else if (
    typeof arguments[0] === "string" &&
    arguments[0].charAt(0) !== "#"
  ) {
    // 处理任何可能的表达式
    currStrokeColor = arguments[0];
  } else {
    currStrokeColor = pub.color.apply(null, arguments);
  }
  return;
};

pub.noStroke = function () {
  currStrokeColor = null;
};

pub.strokeWeight = function (weight) {
  if (typeof weight === "string" || typeof weight === "number") {
    currStrokeWeight = [weight];
  } else {
    error(
      "m.strokeWeight, not supported type. Please make sure the strokeweight is a number or string"
    );
  }
};

pub.opacity = function (opacity) {
  currOpacity = opacity;
  return;
};

pub.layerOpacity = function (layerOpacity) {
  currLayerOpacity = layerOpacity;
  return;
};

pub.blendMode = function (mode) {
  if (arguments.length === 0) {
    return currBlendMode;
  }

  var validModes = {
    NORMAL: BlendingMode.NORMAL,
    ADD: BlendingMode.ADD,
    MULTIPLY: BlendingMode.MULTIPLY,
    SCREEN: BlendingMode.SCREEN,
    OVERLAY: BlendingMode.OVERLAY,
    DARKEN: BlendingMode.DARKEN,
    LIGHTEN: BlendingMode.LIGHTEN,
    COLOR_DODGE: BlendingMode.COLOR_DODGE,
    COLOR_BURN: BlendingMode.COLOR_BURN,
    HARD_LIGHT: BlendingMode.HARD_LIGHT,
    SOFT_LIGHT: BlendingMode.SOFT_LIGHT,
    DIFFERENCE: BlendingMode.DIFFERENCE,
    EXCLUSION: BlendingMode.EXCLUSION,
    HUE: BlendingMode.HUE,
    SATURATION: BlendingMode.SATURATION,
    COLOR: BlendingMode.COLOR,
    LUMINOSITY: BlendingMode.LUMINOSITY,
  };

  if (mode in validModes) {
    currBlendMode = validModes[mode];
  } else {
    error("m.blendMode(), 不支持的叠加模式。请使用有效的叠加模式。");
  }
};

pub.lerpColor = function (c1, c2, amt) {
  if (
    typeof c1 !== "object" ||
    typeof c2 !== "object" ||
    typeof amt !== "number"
  ) {
    error("m.lerpColor(), 参数错误。请使用: 两个颜色对象和一个数字。");
  }

  if (c1.length !== c2.length) {
    error("m.lerpColor(), 两个颜色对象必须是相同的颜色模式。");
  }

  var result = [];
  for (var i = 0; i < c1.length; i++) {
    result[i] = pub.lerp(c1[i], c2[i], amt);
  }

  if (currColorMode === "RGB" || currColorMode === "HSB") {
    return [result[0], result[1], result[2], 1];
  } else if (currColorMode === "CMYK") {
    return [result[0], result[1], result[2], result[3]];
  }
};
