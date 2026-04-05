#include "api_internal.h"
#include "api_controller.cpp"

#include <string>

namespace momentum {

namespace {

struct JsCallbackRegistration {
  const char* name;
  JSObjectCallAsFunctionCallback callback;
};

constexpr JsCallbackRegistration kRuntimeCallbackRegistrations[] = {
  {"createCanvas", JsCreateCanvas},
  {"frameRate", JsFrameRate},
  {"background", JsBackground},
  {"clear", JsClear},
  {"fill", JsFill},
  {"stroke", JsStroke},
  {"colorMode", JsColorMode},
  {"color", JsColor},
  {"noFill", JsNoFill},
  {"noStroke", JsNoStroke},
  {"strokeWeight", JsStrokeWeight},
  {"strokeCap", JsStrokeCap},
  {"strokeJoin", JsStrokeJoin},
  {"blendMode", JsBlendMode},
  {"erase", JsErase},
  {"noErase", JsNoErase},
  {"beginClip", JsBeginClip},
  {"endClip", JsEndClip},
  {"randomSeed", JsRandomSeed},
  {"random", JsRandom},
  {"randomGaussian", JsRandomGaussian},
  {"noise", JsNoise},
  {"noiseDetail", JsNoiseDetail},
  {"noiseSeed", JsNoiseSeed},
  {"angleMode", JsAngleMode},
  {"translate", JsTranslate},
  {"rotate", JsRotate},
  {"scale", JsScale},
  {"applyMatrix", JsApplyMatrix},
  {"resetMatrix", JsResetMatrix},
  {"text", JsText},
  {"textSize", JsTextSize},
  {"textLeading", JsTextLeading},
  {"textFont", JsTextFont},
  {"textStyle", JsTextStyle},
  {"textWrap", JsTextWrap},
  {"textAlign", JsTextAlign},
  {"textWidth", JsTextWidth},
  {"textAscent", JsTextAscent},
  {"textDescent", JsTextDescent},
  {"image", JsImage},
  {"imageMode", JsImageMode},
  {"pixelDensity", JsPixelDensity},
  {"tint", JsTint},
  {"noTint", JsNoTint},
  {"createImage", JsMomentumNativeCreateImage},
  {"__momentumNativeLoadFont", JsMomentumNativeLoadFont},
  {"__momentumNativeFontTextBounds", JsMomentumNativeFontTextBounds},
  {"__momentumNativeFontTextToPoints", JsMomentumNativeFontTextToPoints},
  {"__momentumNativeLoadImage", JsMomentumNativeLoadImage},
  {"__momentumNativeLoadJSON", JsMomentumNativeLoadJSON},
  {"__momentumNativeLoadStrings", JsMomentumNativeLoadStrings},
  {"__momentumNativeLoadBytes", JsMomentumNativeLoadBytes},
  {"__momentumNativeLoadXML", JsMomentumNativeLoadXML},
  {"__momentumNativeLoadTable", JsMomentumNativeLoadTable},
  {"__momentumNativeBackgroundImage", JsMomentumNativeBackgroundImage},
  {"__momentumNativeImageLoadPixels", JsMomentumNativeImageLoadPixels},
  {"__momentumNativeImageUpdatePixels", JsMomentumNativeImageUpdatePixels},
  {"__momentumNativeImageClone", JsMomentumNativeImageClone},
  {"__momentumNativeImageGetPixel", JsMomentumNativeImageGetPixel},
  {"__momentumNativeImageGetRegion", JsMomentumNativeImageGetRegion},
  {"__momentumNativeImageSetColor", JsMomentumNativeImageSetColor},
  {"__momentumNativeImageSetImage", JsMomentumNativeImageSetImage},
  {"__momentumNativeImageResize", JsMomentumNativeImageResize},
  {"__momentumNativeImageMask", JsMomentumNativeImageMask},
  {"__momentumNativeImageCopy", JsMomentumNativeImageCopy},
  {"__momentumNativeImageBlend", JsMomentumNativeImageBlend},
  {"__momentumNativeImageFilter", JsMomentumNativeImageFilter},
  {"__momentumNativeCanvasImage", JsMomentumNativeCanvasImage},
  {"__momentumNativeCreateGraphics", JsMomentumNativeCreateGraphics},
  {"__momentumNativeEnterGraphics", JsMomentumNativeEnterGraphics},
  {"__momentumNativeExitGraphics", JsMomentumNativeExitGraphics},
  {"__momentumNativePrepareGraphicsBitmap", JsMomentumNativePrepareGraphicsBitmap},
  {"__momentumNativeCommitGraphicsBitmap", JsMomentumNativeCommitGraphicsBitmap},
  {"rectMode", JsRectMode},
  {"ellipseMode", JsEllipseMode},
  {"push", JsPush},
  {"pop", JsPop},
  {"ellipse", JsEllipse},
  {"arc", JsArc},
  {"circle", JsCircle},
  {"rect", JsRect},
  {"square", JsSquare},
  {"triangle", JsTriangle},
  {"quad", JsQuad},
  {"line", JsLine},
  {"point", JsPoint},
  {"beginShape", JsBeginShape},
  {"vertex", JsVertex},
  {"bezierVertex", JsBezierVertex},
  {"quadraticVertex", JsQuadraticVertex},
  {"curveVertex", JsCurveVertex},
  {"endShape", JsEndShape},
  {"bezier", JsBezier},
  {"curve", JsCurve},
  {"beginContour", JsBeginContour},
  {"endContour", JsEndContour},
  {"curveTightness", JsCurveTightness},
};

constexpr char kBootstrapFoundationScript[] = R"MOMENTUM_BOOT(
var console = { log: function(){}, info: function(){}, warn: function(){}, error: function(){} };
var PI = Math.PI;
var TWO_PI = Math.PI * 2;
var HALF_PI = Math.PI * 0.5;
var QUARTER_PI = Math.PI * 0.25;
function duration() {}
var CORNER = 0;
var CORNERS = 1;
var CENTER = 2;
var RADIUS = 3;
var LEFT = 0;
var RIGHT = 1;
var TOP = 0;
var BOTTOM = 1;
var BASELINE = 3;
var DEGREES = 'degrees';
var RADIANS = 'radians';
var RGB = 0;
var HSB = 1;
var HSL = 2;
var WORD = 'WORD';
var CHAR = 'CHAR';
var NORMAL = 'NORMAL';
var BOLD = 'BOLD';
var ITALIC = 'ITALIC';
var BOLDITALIC = 'BOLDITALIC';
var CLOSE = 100;
var OPEN = 100;
var CHORD = 101;
var PIE = 102;
var POINTS = 10;
var LINES = 11;
var TRIANGLES = 12;
var TRIANGLE_FAN = 13;
var TRIANGLE_STRIP = 14;
var QUADS = 15;
var QUAD_STRIP = 16;
var TESS = 17;
var ROUND = 200;
var SQUARE = 201;
var PROJECT = 202;
var MITER = 300;
var BEVEL = 301;
var BLEND = 400;
var ADD = 401;
var DARKEST = 402;
var LIGHTEST = 403;
var DIFFERENCE = 404;
var EXCLUSION = 405;
var MULTIPLY = 406;
var SCREEN = 407;
var REPLACE = 408;
var REMOVE = 409;
var OVERLAY = 410;
var HARD_LIGHT = 411;
var SOFT_LIGHT = 412;
var DODGE = 413;
var BURN = 414;
var THRESHOLD = 'THRESHOLD';
var GRAY = 'GRAY';
var OPAQUE = 'OPAQUE';
var INVERT = 'INVERT';
var POSTERIZE = 'POSTERIZE';
var BLUR = 'BLUR';
var ERODE = 'ERODE';
var DILATE = 'DILATE';
function __momentumToRadians(value) {
  return angleMode() === DEGREES ? radians(value) : value;
}
function __momentumFromRadians(value) {
  return angleMode() === DEGREES ? degrees(value) : value;
}
function sin(value) {
  return Math.sin(__momentumToRadians(Number(value) || 0));
}
function cos(value) {
  return Math.cos(__momentumToRadians(Number(value) || 0));
}
function tan(value) {
  return Math.tan(__momentumToRadians(Number(value) || 0));
}
function shearX(angle) {
  return applyMatrix(1, 0, Math.tan(__momentumToRadians(angle)), 1, 0, 0);
}
function shearY(angle) {
  return applyMatrix(1, Math.tan(__momentumToRadians(angle)), 0, 1, 0, 0);
}
function asin(value) {
  return __momentumFromRadians(Math.asin(Number(value) || 0));
}
function acos(value) {
  return __momentumFromRadians(Math.acos(Number(value) || 0));
}
function atan(value) {
  return __momentumFromRadians(Math.atan(Number(value) || 0));
}
function atan2(y, x) {
  return __momentumFromRadians(Math.atan2(Number(y) || 0, Number(x) || 0));
}
var abs = Math.abs;
var min = Math.min;
var max = Math.max;
var floor = Math.floor;
var ceil = Math.ceil;
var round = Math.round;
var exp = Math.exp;
var log = Math.log;
function int(value) {
  if (Array.isArray(value)) {
    return value.map(int);
  }
  if (typeof value === 'string') {
    var parsed = parseInt(value, 10);
    return isNaN(parsed) ? 0 : parsed;
  }
  var number = Number(value);
  if (!isFinite(number) || isNaN(number)) {
    return 0;
  }
  return number < 0 ? Math.ceil(number) : Math.floor(number);
}
var sqrt = Math.sqrt;
var pow = Math.pow;
function constrain(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}
function map(value, inMin, inMax, outMin, outMax) {
  if (inMax === inMin) { return outMin; }
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}
function lerp(start, stop, amount) {
  return start + (stop - start) * amount;
}
function sq(value) {
  value = Number(value) || 0;
  return value * value;
}
function fract(value) {
  value = Number(value) || 0;
  return value - Math.floor(value);
}
function norm(value, start, stop) {
  if (stop === start) { return 0; }
  return (value - start) / (stop - start);
}
function mag(x, y, z) {
  x = Number(x) || 0;
  y = Number(y) || 0;
  z = Number(z) || 0;
  return Math.sqrt(x * x + y * y + z * z);
}
function radians(degrees) {
  return degrees * (Math.PI / 180);
}
function degrees(radiansValue) {
  return radiansValue * (180 / Math.PI);
}
function bezierPoint(a, b, c, d, t) {
  var omt = 1 - t;
  return omt * omt * omt * a + 3 * omt * omt * t * b + 3 * omt * t * t * c + t * t * t * d;
}
function bezierTangent(a, b, c, d, t) {
  var omt = 1 - t;
  return 3 * omt * omt * (b - a) + 6 * omt * t * (c - b) + 3 * t * t * (d - c);
}
var __momentumCurveTightness = 0;
function curvePoint(a, b, c, d, t) {
  var scale = (1 - __momentumCurveTightness) * 0.5;
  var m1 = (c - a) * scale;
  var m2 = (d - b) * scale;
  var t2 = t * t;
  var t3 = t2 * t;
  var h00 = 2 * t3 - 3 * t2 + 1;
  var h10 = t3 - 2 * t2 + t;
  var h01 = -2 * t3 + 3 * t2;
  var h11 = t3 - t2;
  return h00 * b + h10 * m1 + h01 * c + h11 * m2;
}
function curveTangent(a, b, c, d, t) {
  var scale = (1 - __momentumCurveTightness) * 0.5;
  var m1 = (c - a) * scale;
  var m2 = (d - b) * scale;
  var t2 = t * t;
  var dh00 = 6 * t2 - 6 * t;
  var dh10 = 3 * t2 - 4 * t + 1;
  var dh01 = -6 * t2 + 6 * t;
  var dh11 = 3 * t2 - 2 * t;
  return dh00 * b + dh10 * m1 + dh01 * c + dh11 * m2;
}
var __momentumNativeCurveTightness = curveTightness;
curveTightness = function(amount) {
  __momentumCurveTightness = Number(amount) || 0;
  return __momentumNativeCurveTightness(__momentumCurveTightness);
};
function dist(x1, y1, x2, y2) {
  var dx = x2 - x1;
  var dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}
function __momentumVectorNumber(value) {
  value = Number(value);
  return isFinite(value) && !isNaN(value) ? value : 0;
}
function __momentumVectorComponents(x, y, z) {
  if (Array.isArray(x)) {
    return [__momentumVectorNumber(x[0]), __momentumVectorNumber(x[1]), __momentumVectorNumber(x[2])];
  }
  if (typeof x === 'object' && x) {
    return [__momentumVectorNumber(x.x), __momentumVectorNumber(x.y), __momentumVectorNumber(x.z)];
  }
  return [__momentumVectorNumber(x), __momentumVectorNumber(y), __momentumVectorNumber(z)];
}
function __momentumVectorSet(target, x, y, z) {
  var components = __momentumVectorComponents(x, y, z);
  target.x = components[0];
  target.y = components[1];
  target.z = components[2];
  return target;
}
function __momentumVectorAngleBetween(a, b) {
  var denominator = a.mag() * b.mag();
  if (!denominator) {
    return 0;
  }
  return __momentumFromRadians(Math.acos(constrain(a.dot(b) / denominator, -1, 1)));
}
var p5 = { Vector: function(x, y, z) { __momentumVectorSet(this, x, y, z); } };
p5.Vector.prototype.set = function(x, y, z) { return __momentumVectorSet(this, x, y, z); };
p5.Vector.prototype.copy = function() { return createVector(this.x, this.y, this.z); };
p5.Vector.prototype.add = function(x, y, z) {
  var components = __momentumVectorComponents(x, y, z);
  this.x += components[0];
  this.y += components[1];
  this.z += components[2];
  return this;
};
p5.Vector.prototype.sub = function(x, y, z) {
  var components = __momentumVectorComponents(x, y, z);
  this.x -= components[0];
  this.y -= components[1];
  this.z -= components[2];
  return this;
};
p5.Vector.prototype.mult = function(value) {
  var numeric = __momentumVectorNumber(value);
  this.x *= numeric;
  this.y *= numeric;
  this.z *= numeric;
  return this;
};
p5.Vector.prototype.div = function(value) {
  var numeric = __momentumVectorNumber(value);
  if (!numeric) {
    return this;
  }
  this.x /= numeric;
  this.y /= numeric;
  this.z /= numeric;
  return this;
};
p5.Vector.prototype.magSq = function() { return this.x * this.x + this.y * this.y + this.z * this.z; };
p5.Vector.prototype.mag = function() { return Math.sqrt(this.magSq()); };
p5.Vector.prototype.dot = function(x, y, z) {
  var components = __momentumVectorComponents(x, y, z);
  return this.x * components[0] + this.y * components[1] + this.z * components[2];
};
p5.Vector.prototype.cross = function(x, y, z) {
  var components = __momentumVectorComponents(x, y, z);
  return createVector(
    this.y * components[2] - this.z * components[1],
    this.z * components[0] - this.x * components[2],
    this.x * components[1] - this.y * components[0]
  );
};
p5.Vector.prototype.dist = function(x, y, z) {
  var components = __momentumVectorComponents(x, y, z);
  var dx = this.x - components[0];
  var dy = this.y - components[1];
  var dz = this.z - components[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};
p5.Vector.prototype.normalize = function() {
  var magnitude = this.mag();
  if (magnitude > 0) {
    this.div(magnitude);
  }
  return this;
};
p5.Vector.prototype.limit = function(maxValue) {
  maxValue = __momentumVectorNumber(maxValue);
  if (this.magSq() > maxValue * maxValue) {
    this.setMag(maxValue);
  }
  return this;
};
p5.Vector.prototype.setMag = function(length) { return this.normalize().mult(length); };
p5.Vector.prototype.heading = function() { return __momentumFromRadians(Math.atan2(this.y, this.x)); };
p5.Vector.prototype.setHeading = function(angle) {
  var magnitude = this.mag();
  angle = __momentumToRadians(angle);
  this.x = Math.cos(angle) * magnitude;
  this.y = Math.sin(angle) * magnitude;
  return this;
};
p5.Vector.prototype.rotate = function(angle) { return this.setHeading(this.heading() + angle); };
p5.Vector.prototype.lerp = function(x, y, z, amt) {
  var components;
  if (typeof x === 'object' && x) {
    components = __momentumVectorComponents(x);
    amt = __momentumVectorNumber(y);
  } else {
    components = __momentumVectorComponents(x, y, arguments.length > 3 ? z : 0);
    amt = __momentumVectorNumber(arguments.length > 3 ? amt : z);
  }
  this.x += (components[0] - this.x) * amt;
  this.y += (components[1] - this.y) * amt;
  this.z += (components[2] - this.z) * amt;
  return this;
};
p5.Vector.prototype.angleBetween = function(vector) { return __momentumVectorAngleBetween(this, createVector(vector)); };
p5.Vector.prototype.array = function() { return [this.x, this.y, this.z]; };
p5.Vector.prototype.equals = function(x, y, z) {
  var components = __momentumVectorComponents(x, y, z);
  return this.x === components[0] && this.y === components[1] && this.z === components[2];
};
p5.Vector.prototype.toString = function() { return 'p5.Vector Object : [' + this.x + ', ' + this.y + ', ' + this.z + ']'; };
p5.Vector.prototype.constructor = p5.Vector;
function createVector(x, y, z) { return new p5.Vector(x, y, z); }
p5.Vector.add = function(a, b, target) { target = target && typeof target.set === 'function' ? target : createVector(); return target.set(a).add(b); };
p5.Vector.sub = function(a, b, target) { target = target && typeof target.set === 'function' ? target : createVector(); return target.set(a).sub(b); };
p5.Vector.mult = function(vector, value, target) { target = target && typeof target.set === 'function' ? target : createVector(); return target.set(vector).mult(value); };
p5.Vector.div = function(vector, value, target) { target = target && typeof target.set === 'function' ? target : createVector(); return target.set(vector).div(value); };
p5.Vector.dot = function(a, b) { return createVector(a).dot(b); };
p5.Vector.cross = function(a, b) { return createVector(a).cross(b); };
p5.Vector.dist = function(a, b) { return createVector(a).dist(b); };
p5.Vector.lerp = function(a, b, amt, target) { target = target && typeof target.set === 'function' ? target : createVector(); return target.set(a).lerp(b, amt); };
p5.Vector.mag = function(vector) { return createVector(vector).mag(); };
p5.Vector.normalize = function(vector, target) { target = target && typeof target.set === 'function' ? target : createVector(); return target.set(vector).normalize(); };
p5.Vector.limit = function(vector, maxValue, target) { target = target && typeof target.set === 'function' ? target : createVector(); return target.set(vector).limit(maxValue); };
p5.Vector.setMag = function(vector, length, target) { target = target && typeof target.set === 'function' ? target : createVector(); return target.set(vector).setMag(length); };
p5.Vector.heading = function(vector) { return createVector(vector).heading(); };
p5.Vector.angleBetween = function(a, b) { return __momentumVectorAngleBetween(createVector(a), createVector(b)); };
p5.Vector.fromAngle = function(angle, length) {
  angle = __momentumToRadians(angle);
  length = length === undefined ? 1 : __momentumVectorNumber(length);
  return createVector(Math.cos(angle) * length, Math.sin(angle) * length, 0);
};
p5.Vector.random2D = function() {
  var angle = random() * Math.PI * 2;
  return createVector(Math.cos(angle), Math.sin(angle), 0);
};
p5.Vector.random3D = function() {
  var angle = random() * Math.PI * 2;
  var z = random(-1, 1);
  var planar = Math.sqrt(Math.max(0, 1 - z * z));
  return createVector(planar * Math.cos(angle), planar * Math.sin(angle), z);
};
)MOMENTUM_BOOT";

constexpr char kBootstrapP5CompatScript[] = R"MOMENTUM_BOOT(
var __momentumNativeBackground = background;
var __momentumNativeFill = fill;
var __momentumNativeStroke = stroke;
var __momentumNativeNoFill = noFill;
var __momentumNativeNoStroke = noStroke;
var __momentumNativeColorMode = colorMode;
var __momentumNativeBeginClip = beginClip;
var __momentumNativeEndClip = endClip;
var __momentumColorMode = RGB;
var __momentumColorMaxes = [255, 255, 255, 255];

function __momentumClamp(value, minimum, maximum) {
  value = Number(value);
  if (!isFinite(value) || isNaN(value)) {
    value = 0;
  }
  return Math.min(Math.max(value, minimum), maximum);
}

function __momentumClamp01(value) {
  return __momentumClamp(value, 0, 1);
}

function __momentumByteFromUnit(value) {
  return Math.round(__momentumClamp01(value) * 255);
}

function __momentumAlphaString(value) {
  value = __momentumClamp01(value);
  if (Math.abs(value - Math.round(value)) < 1e-6) {
    return String(Math.round(value));
  }
  return String(Math.round(value * 1000) / 1000);
}

function __momentumCopyArray(values) {
  return [values[0], values[1], values[2], values[3]];
}

function __momentumCurrentColorMaxes() {
  return __momentumCopyArray(__momentumColorMaxes);
}

function __momentumNormalizeHue(value) {
  value = Number(value);
  if (!isFinite(value) || isNaN(value)) {
    return 0;
  }
  value = value % 1;
  return value < 0 ? value + 1 : value;
}

function __momentumRgbToHsb(r, g, b) {
  var maxValue = Math.max(r, g, b);
  var minValue = Math.min(r, g, b);
  var delta = maxValue - minValue;
  var hueValue = 0;
  if (delta !== 0) {
    if (maxValue === r) {
      hueValue = ((g - b) / delta) % 6;
    } else if (maxValue === g) {
      hueValue = (b - r) / delta + 2;
    } else {
      hueValue = (r - g) / delta + 4;
    }
    hueValue /= 6;
    if (hueValue < 0) {
      hueValue += 1;
    }
  }
  return [
    hueValue,
    maxValue === 0 ? 0 : delta / maxValue,
    maxValue,
  ];
}

function __momentumHsbToRgb(h, s, v) {
  h = __momentumNormalizeHue(h);
  s = __momentumClamp01(s);
  v = __momentumClamp01(v);
  var sector = Math.floor(h * 6);
  var fraction = h * 6 - sector;
  var p = v * (1 - s);
  var q = v * (1 - fraction * s);
  var t = v * (1 - (1 - fraction) * s);
  switch (sector % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

function __momentumRgbToHsl(r, g, b) {
  var maxValue = Math.max(r, g, b);
  var minValue = Math.min(r, g, b);
  var delta = maxValue - minValue;
  var lightnessValue = (maxValue + minValue) * 0.5;
  var hueValue = 0;
  var saturationValue = 0;
  if (delta !== 0) {
    saturationValue = lightnessValue > 0.5
      ? delta / (2 - maxValue - minValue)
      : delta / (maxValue + minValue);
    if (maxValue === r) {
      hueValue = ((g - b) / delta) % 6;
    } else if (maxValue === g) {
      hueValue = (b - r) / delta + 2;
    } else {
      hueValue = (r - g) / delta + 4;
    }
    hueValue /= 6;
    if (hueValue < 0) {
      hueValue += 1;
    }
  }
  return [hueValue, saturationValue, lightnessValue];
}

function __momentumHueToRgb(p, q, t) {
  t = __momentumNormalizeHue(t);
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function __momentumHslToRgb(h, s, l) {
  h = __momentumNormalizeHue(h);
  s = __momentumClamp01(s);
  l = __momentumClamp01(l);
  if (s === 0) {
    return [l, l, l];
  }
  var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  var p = 2 * l - q;
  return [
    __momentumHueToRgb(p, q, h + 1 / 3),
    __momentumHueToRgb(p, q, h),
    __momentumHueToRgb(p, q, h - 1 / 3),
  ];
}

function __momentumParseCssColor(value) {
  if (typeof value !== "string") {
    return null;
  }
  var text = value.trim().toLowerCase();
  if (!text) {
    return null;
  }
  if (text === "transparent") {
    return [0, 0, 0, 0];
  }
  var named = {
    black: [0, 0, 0],
    white: [1, 1, 1],
    red: [1, 0, 0],
    green: [0, 0.5, 0],
    blue: [0, 0, 1],
    yellow: [1, 1, 0],
    cyan: [0, 1, 1],
    magenta: [1, 0, 1],
    gray: [0.5, 0.5, 0.5],
    grey: [0.5, 0.5, 0.5],
    orange: [1, 0.6470588235, 0],
    purple: [0.5, 0, 0.5],
    pink: [1, 0.7529411765, 0.7960784314],
    brown: [0.6470588235, 0.1647058824, 0.1647058824],
  };
  if (named[text]) {
    return [named[text][0], named[text][1], named[text][2], 1];
  }

  var hexMatch = text.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hexMatch) {
    var hex = hexMatch[1];
    if (hex.length === 3 || hex.length === 4) {
      var shortRed = parseInt(hex.charAt(0) + hex.charAt(0), 16) / 255;
      var shortGreen = parseInt(hex.charAt(1) + hex.charAt(1), 16) / 255;
      var shortBlue = parseInt(hex.charAt(2) + hex.charAt(2), 16) / 255;
      var shortAlpha = hex.length === 4 ? parseInt(hex.charAt(3) + hex.charAt(3), 16) / 255 : 1;
      return [shortRed, shortGreen, shortBlue, shortAlpha];
    }

    var redValue = parseInt(hex.slice(0, 2), 16) / 255;
    var greenValue = parseInt(hex.slice(2, 4), 16) / 255;
    var blueValue = parseInt(hex.slice(4, 6), 16) / 255;
    var alphaValue = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return [redValue, greenValue, blueValue, alphaValue];
  }

  var rgbMatch = text.match(/^rgba?\(\s*([+-]?[\d.]+%?)\s*,\s*([+-]?[\d.]+%?)\s*,\s*([+-]?[\d.]+%?)(?:\s*,\s*([+-]?[\d.]+%?))?\s*\)$/);
  if (rgbMatch) {
    function parseRgbChannel(channel) {
      if (/%$/.test(channel)) {
        return __momentumClamp(parseFloat(channel) / 100, 0, 1);
      }
      return __momentumClamp(parseFloat(channel) / 255, 0, 1);
    }
    function parseAlphaChannel(channel) {
      if (channel === undefined) {
        return 1;
      }
      if (/%$/.test(channel)) {
        return __momentumClamp(parseFloat(channel) / 100, 0, 1);
      }
      var numeric = parseFloat(channel);
      if (numeric > 1) {
        numeric /= 255;
      }
      return __momentumClamp(numeric, 0, 1);
    }
    return [
      parseRgbChannel(rgbMatch[1]),
      parseRgbChannel(rgbMatch[2]),
      parseRgbChannel(rgbMatch[3]),
      parseAlphaChannel(rgbMatch[4]),
    ];
  }

  var hslMatch = text.match(/^hsla?\(\s*([+-]?[\d.]+)\s*,\s*([+-]?[\d.]+)%\s*,\s*([+-]?[\d.]+)%(?:\s*,\s*([+-]?[\d.]+%?))?\s*\)$/);
  if (hslMatch) {
    var hueValue = __momentumNormalizeHue(parseFloat(hslMatch[1]) / 360);
    var saturationValue = __momentumClamp(parseFloat(hslMatch[2]) / 100, 0, 1);
    var lightnessValue = __momentumClamp(parseFloat(hslMatch[3]) / 100, 0, 1);
    var alphaValue = 1;
    if (hslMatch[4] !== undefined) {
      alphaValue = /%$/.test(hslMatch[4])
        ? __momentumClamp(parseFloat(hslMatch[4]) / 100, 0, 1)
        : __momentumClamp(parseFloat(hslMatch[4]), 0, 1);
    }
    var hslRgb = __momentumHslToRgb(hueValue, saturationValue, lightnessValue);
    return [hslRgb[0], hslRgb[1], hslRgb[2], alphaValue];
  }

  return null;
}

function __momentumMakeColorData(rgba, mode, maxes) {
  return {
    rgba: [
      __momentumClamp01(rgba[0]),
      __momentumClamp01(rgba[1]),
      __momentumClamp01(rgba[2]),
      __momentumClamp01(rgba[3]),
    ],
    mode: mode,
    maxes: __momentumCopyArray(maxes),
  };
}

function __momentumCreateColor(rgba, mode, maxes) {
  return new p5.Color(rgba, mode, maxes);
}

function __momentumIsColorObject(value) {
  return !!value && value instanceof p5.Color && value._colorData;
}

function __momentumColorBytes(colorValue) {
  var rgba = colorValue._colorData.rgba;
  return [
    __momentumByteFromUnit(rgba[0]),
    __momentumByteFromUnit(rgba[1]),
    __momentumByteFromUnit(rgba[2]),
    __momentumByteFromUnit(rgba[3]),
  ];
}

function __momentumCoerceColorInput(value) {
  if (__momentumIsColorObject(value)) {
    return value;
  }
  if (value && value.__momentumType === "ColorController") {
    if (typeof value.color === "function") {
      return color.apply(null, value.color());
    }
    if (value._controllerData && Array.isArray(value._controllerData.value)) {
      return color.apply(null, value._controllerData.value);
    }
  }
  if (Array.isArray(value)) {
    return color.apply(null, value);
  }
  return color(value);
}

function __momentumColorFromArgs(argsLike) {
  var args = Array.prototype.slice.call(argsLike || []);
  var length = args.length;
  var mode = __momentumColorMode;
  var maxes = __momentumCurrentColorMaxes();
  var alphaValue = maxes[3];
  var rgba = null;

  if (length === 1) {
    var single = args[0];
    if (__momentumIsColorObject(single)) {
      return __momentumCreateColor(single._colorData.rgba, single._colorData.mode, single._colorData.maxes);
    }
    if (single && single.__momentumType === "ColorController") {
      if (typeof single.color === "function") {
        return __momentumColorFromArgs(single.color());
      }
      if (single._controllerData && Array.isArray(single._controllerData.value)) {
        return __momentumColorFromArgs(single._controllerData.value);
      }
    }
    if (Array.isArray(single)) {
      return __momentumColorFromArgs(single);
    }
    if (typeof single === "string") {
      rgba = __momentumParseCssColor(single);
      if (rgba) {
        return __momentumCreateColor(rgba, mode, maxes);
      }
    }
    var grayValue = __momentumClamp(Number(single) || 0, 0, maxes[2] || 0);
    var normalizedGray = maxes[2] ? __momentumClamp01(grayValue / maxes[2]) : 0;
    if (mode === RGB) {
      rgba = [normalizedGray, normalizedGray, normalizedGray, 1];
    } else if (mode === HSB) {
      rgba = __momentumHsbToRgb(0, 0, normalizedGray);
      rgba[3] = 1;
    } else {
      rgba = __momentumHslToRgb(0, 0, normalizedGray);
      rgba[3] = 1;
    }
    return __momentumCreateColor(rgba, mode, maxes);
  }

  if (length === 2) {
    var gray = __momentumClamp(Number(args[0]) || 0, 0, maxes[2] || 0);
    alphaValue = __momentumClamp(Number(args[1]) || 0, 0, maxes[3] || 0);
    var normalized = maxes[2] ? __momentumClamp01(gray / maxes[2]) : 0;
    if (mode === RGB) {
      rgba = [normalized, normalized, normalized, maxes[3] ? __momentumClamp01(alphaValue / maxes[3]) : 1];
    } else if (mode === HSB) {
      rgba = __momentumHsbToRgb(0, 0, normalized);
      rgba[3] = maxes[3] ? __momentumClamp01(alphaValue / maxes[3]) : 1;
    } else {
      rgba = __momentumHslToRgb(0, 0, normalized);
      rgba[3] = maxes[3] ? __momentumClamp01(alphaValue / maxes[3]) : 1;
    }
    return __momentumCreateColor(rgba, mode, maxes);
  }

  if (length >= 3) {
    var v1 = maxes[0] ? __momentumClamp01((Number(args[0]) || 0) / maxes[0]) : 0;
    var v2 = maxes[1] ? __momentumClamp01((Number(args[1]) || 0) / maxes[1]) : 0;
    var v3 = maxes[2] ? __momentumClamp01((Number(args[2]) || 0) / maxes[2]) : 0;
    var normalizedAlpha = length > 3 && maxes[3]
      ? __momentumClamp01((Number(args[3]) || 0) / maxes[3])
      : 1;
    if (mode === RGB) {
      rgba = [v1, v2, v3, normalizedAlpha];
    } else if (mode === HSB) {
      rgba = __momentumHsbToRgb(v1, v2, v3);
      rgba[3] = normalizedAlpha;
    } else {
      rgba = __momentumHslToRgb(v1, v2, v3);
      rgba[3] = normalizedAlpha;
    }
    return __momentumCreateColor(rgba, mode, maxes);
  }

  return __momentumCreateColor([1, 1, 1, 1], mode, maxes);
}

function __momentumFormatPercent(value) {
  return String(Math.round(__momentumClamp01(value) * 1000) / 10) + "%";
}

function __momentumColorToString(colorValue, format) {
  var rgba = colorValue._colorData.rgba;
  var rgbBytes = __momentumColorBytes(colorValue);
  var hsb = __momentumRgbToHsb(rgba[0], rgba[1], rgba[2]);
  var hsl = __momentumRgbToHsl(rgba[0], rgba[1], rgba[2]);
  var resolvedFormat = format == null ? "rgba" : String(format).toLowerCase();

  function hexChannel(value) {
    var text = value.toString(16);
    return text.length < 2 ? "0" + text : text;
  }

  switch (resolvedFormat) {
    case "#rgb":
      return "#" +
        Math.round(rgbBytes[0] / 17).toString(16) +
        Math.round(rgbBytes[1] / 17).toString(16) +
        Math.round(rgbBytes[2] / 17).toString(16);
    case "#rgba":
      return "#" +
        Math.round(rgbBytes[0] / 17).toString(16) +
        Math.round(rgbBytes[1] / 17).toString(16) +
        Math.round(rgbBytes[2] / 17).toString(16) +
        Math.round(rgbBytes[3] / 17).toString(16);
    case "#rrggbb":
    case "hex":
      return "#" + hexChannel(rgbBytes[0]) + hexChannel(rgbBytes[1]) + hexChannel(rgbBytes[2]);
    case "#rrggbbaa":
      return "#" + hexChannel(rgbBytes[0]) + hexChannel(rgbBytes[1]) + hexChannel(rgbBytes[2]) + hexChannel(rgbBytes[3]);
    case "rgb":
      return "rgb(" + rgbBytes[0] + ", " + rgbBytes[1] + ", " + rgbBytes[2] + ")";
    case "rgb%":
      return "rgb(" +
        __momentumFormatPercent(rgba[0]) + ", " +
        __momentumFormatPercent(rgba[1]) + ", " +
        __momentumFormatPercent(rgba[2]) + ")";
    case "rgba%":
      return "rgba(" +
        __momentumFormatPercent(rgba[0]) + ", " +
        __momentumFormatPercent(rgba[1]) + ", " +
        __momentumFormatPercent(rgba[2]) + ", " +
        __momentumAlphaString(rgba[3]) + ")";
    case "hsl":
      return "hsl(" +
        Math.round(hsl[0] * 360) + ", " +
        Math.round(hsl[1] * 100) + "%, " +
        Math.round(hsl[2] * 100) + "%)";
    case "hsla":
      return "hsla(" +
        Math.round(hsl[0] * 360) + ", " +
        Math.round(hsl[1] * 100) + "%, " +
        Math.round(hsl[2] * 100) + "%, " +
        __momentumAlphaString(rgba[3]) + ")";
    case "hsl%":
      return "hsl(" +
        __momentumFormatPercent(hsl[0]) + ", " +
        __momentumFormatPercent(hsl[1]) + ", " +
        __momentumFormatPercent(hsl[2]) + ")";
    case "hsla%":
      return "hsla(" +
        __momentumFormatPercent(hsl[0]) + ", " +
        __momentumFormatPercent(hsl[1]) + ", " +
        __momentumFormatPercent(hsl[2]) + ", " +
        __momentumAlphaString(rgba[3]) + ")";
    case "hsb":
      return "hsb(" +
        Math.round(hsb[0] * 360) + ", " +
        Math.round(hsb[1] * 100) + "%, " +
        Math.round(hsb[2] * 100) + "%)";
    case "hsba":
      return "hsba(" +
        Math.round(hsb[0] * 360) + ", " +
        Math.round(hsb[1] * 100) + "%, " +
        Math.round(hsb[2] * 100) + "%, " +
        __momentumAlphaString(rgba[3]) + ")";
    case "hsb%":
      return "hsb(" +
        __momentumFormatPercent(hsb[0]) + ", " +
        __momentumFormatPercent(hsb[1]) + ", " +
        __momentumFormatPercent(hsb[2]) + ")";
    case "hsba%":
      return "hsba(" +
        __momentumFormatPercent(hsb[0]) + ", " +
        __momentumFormatPercent(hsb[1]) + ", " +
        __momentumFormatPercent(hsb[2]) + ", " +
        __momentumAlphaString(rgba[3]) + ")";
    case "rgba":
    default:
      return "rgba(" + rgbBytes[0] + ", " + rgbBytes[1] + ", " + rgbBytes[2] + ", " + __momentumAlphaString(rgba[3]) + ")";
  }
}

function __momentumColorChannelRange(colorValue, channelName) {
  if (channelName === "alpha") {
    return colorValue._colorData.maxes[3];
  }
  if (colorValue._colorData.mode === RGB) {
    if (channelName === "red") return colorValue._colorData.maxes[0];
    if (channelName === "green") return colorValue._colorData.maxes[1];
    return colorValue._colorData.maxes[2];
  }
  return 255;
}

function __momentumSetColorChannel(colorValue, channelIndex, channelName, nextValue) {
  var rgba = __momentumCopyArray(colorValue._colorData.rgba);
  var range = __momentumColorChannelRange(colorValue, channelName);
  rgba[channelIndex] = range ? __momentumClamp01((Number(nextValue) || 0) / range) : 0;
  colorValue._colorData = __momentumMakeColorData(rgba, colorValue._colorData.mode, colorValue._colorData.maxes);
  return colorValue;
}

function __momentumNormalizeLerpColor(colorValue, mode) {
  var rgba = colorValue._colorData.rgba;
  if (mode === RGB) {
    return [rgba[0], rgba[1], rgba[2]];
  }
  if (mode === HSB) {
    return __momentumRgbToHsb(rgba[0], rgba[1], rgba[2]);
  }
  return __momentumRgbToHsl(rgba[0], rgba[1], rgba[2]);
}

p5.Color = function(rgba, mode, maxes) {
  this._colorData = __momentumMakeColorData(rgba || [1, 1, 1, 1], mode == null ? __momentumColorMode : mode, maxes || __momentumCurrentColorMaxes());
};
p5.Color.prototype.toString = function(format) {
  return __momentumColorToString(this, format);
};
p5.Color.prototype.setRed = function(value) {
  return __momentumSetColorChannel(this, 0, "red", value);
};
p5.Color.prototype.setGreen = function(value) {
  return __momentumSetColorChannel(this, 1, "green", value);
};
p5.Color.prototype.setBlue = function(value) {
  return __momentumSetColorChannel(this, 2, "blue", value);
};
p5.Color.prototype.setAlpha = function(value) {
  return __momentumSetColorChannel(this, 3, "alpha", value);
};
p5.Color.prototype.constructor = p5.Color;

colorMode = function(mode, max1, max2, max3, maxA) {
  __momentumColorMode = mode === HSB || mode === HSL ? mode : RGB;
  if (arguments.length === 1) {
    __momentumColorMaxes = __momentumColorMode === RGB
      ? [255, 255, 255, 255]
      : [360, 100, 100, 1];
  } else if (arguments.length === 2) {
    __momentumColorMaxes = [max1, max1, max1, max1];
  } else if (arguments.length === 4) {
    __momentumColorMaxes = [max1, max2, max3, __momentumColorMaxes[3]];
  } else if (arguments.length >= 5) {
    __momentumColorMaxes = [max1, max2, max3, maxA];
  }
  __momentumNativeColorMode(__momentumColorMode);
};

color = function() {
  return __momentumColorFromArgs(arguments);
};

fill = function() {
  if (arguments.length === 0) {
    return;
  }
  __momentumNativeFill(__momentumColorBytes(color.apply(null, arguments)));
};

stroke = function() {
  if (arguments.length === 0) {
    return;
  }
  __momentumNativeStroke(__momentumColorBytes(color.apply(null, arguments)));
};

background = function() {
  if (arguments.length === 0) {
    return;
  }
  if (arguments[0] && arguments[0].__momentumType === "Image") {
    __momentumInvalidateCanvasPixels();
    __momentumCanvasImage = null;
    return __momentumNativeBackgroundImage(
      arguments[0]._imageData,
      arguments.length > 1 ? Number(arguments[1]) || 0 : 255
    );
  }
  __momentumInvalidateCanvasPixels();
  __momentumCanvasImage = null;
  __momentumNativeBackground(__momentumColorBytes(color.apply(null, arguments)));
};

noFill = function() {
  return __momentumNativeNoFill();
};

noStroke = function() {
  return __momentumNativeNoStroke();
};

clip = function(callback, options) {
  if (typeof callback !== "function") {
    return;
  }
  __momentumNativeBeginClip(options);
  try {
    callback();
  } finally {
    __momentumNativeEndClip();
  }
};

function red(value) {
  var colorValue = __momentumCoerceColorInput(value);
  return colorValue._colorData.rgba[0] * (__momentumColorMode === RGB ? __momentumColorMaxes[0] : 255);
}

function green(value) {
  var colorValue = __momentumCoerceColorInput(value);
  return colorValue._colorData.rgba[1] * (__momentumColorMode === RGB ? __momentumColorMaxes[1] : 255);
}

function blue(value) {
  var colorValue = __momentumCoerceColorInput(value);
  return colorValue._colorData.rgba[2] * (__momentumColorMode === RGB ? __momentumColorMaxes[2] : 255);
}

function alpha(value) {
  var colorValue = __momentumCoerceColorInput(value);
  return colorValue._colorData.rgba[3] * __momentumColorMaxes[3];
}

function hue(value) {
  var colorValue = __momentumCoerceColorInput(value);
  var hsl = __momentumRgbToHsl(colorValue._colorData.rgba[0], colorValue._colorData.rgba[1], colorValue._colorData.rgba[2]);
  return hsl[0] * ((__momentumColorMode === HSB || __momentumColorMode === HSL) ? __momentumColorMaxes[0] : 360);
}

function saturation(value) {
  var colorValue = __momentumCoerceColorInput(value);
  if (__momentumColorMode === HSB) {
    var hsb = __momentumRgbToHsb(colorValue._colorData.rgba[0], colorValue._colorData.rgba[1], colorValue._colorData.rgba[2]);
    return hsb[1] * __momentumColorMaxes[1];
  }
  var hsl = __momentumRgbToHsl(colorValue._colorData.rgba[0], colorValue._colorData.rgba[1], colorValue._colorData.rgba[2]);
  return hsl[1] * (__momentumColorMode === HSL ? __momentumColorMaxes[1] : 100);
}

function brightness(value) {
  var colorValue = __momentumCoerceColorInput(value);
  var hsb = __momentumRgbToHsb(colorValue._colorData.rgba[0], colorValue._colorData.rgba[1], colorValue._colorData.rgba[2]);
  return hsb[2] * (__momentumColorMode === HSB ? __momentumColorMaxes[2] : 100);
}

function lightness(value) {
  var colorValue = __momentumCoerceColorInput(value);
  var hsl = __momentumRgbToHsl(colorValue._colorData.rgba[0], colorValue._colorData.rgba[1], colorValue._colorData.rgba[2]);
  return hsl[2] * (__momentumColorMode === HSL ? __momentumColorMaxes[2] : 100);
}

function lerpColor(startColor, stopColor, amount) {
  var fromColor = __momentumCoerceColorInput(startColor);
  var toColor = __momentumCoerceColorInput(stopColor);
  var clampedAmount = __momentumClamp(amount, 0, 1);
  var rgba;
  if (__momentumColorMode === RGB) {
    rgba = [
      fromColor._colorData.rgba[0] + (toColor._colorData.rgba[0] - fromColor._colorData.rgba[0]) * clampedAmount,
      fromColor._colorData.rgba[1] + (toColor._colorData.rgba[1] - fromColor._colorData.rgba[1]) * clampedAmount,
      fromColor._colorData.rgba[2] + (toColor._colorData.rgba[2] - fromColor._colorData.rgba[2]) * clampedAmount,
      fromColor._colorData.rgba[3] + (toColor._colorData.rgba[3] - fromColor._colorData.rgba[3]) * clampedAmount,
    ];
  } else {
    var fromValues = __momentumNormalizeLerpColor(fromColor, __momentumColorMode);
    var toValues = __momentumNormalizeLerpColor(toColor, __momentumColorMode);
    var fromHue = fromValues[0];
    var toHue = toValues[0];
    if (Math.abs(toHue - fromHue) > 0.5) {
      if (fromHue > toHue) {
        toHue += 1;
      } else {
        fromHue += 1;
      }
    }
    var mixedHue = __momentumNormalizeHue(fromHue + (toHue - fromHue) * clampedAmount);
    var mixedSaturation = fromValues[1] + (toValues[1] - fromValues[1]) * clampedAmount;
    var mixedThird = fromValues[2] + (toValues[2] - fromValues[2]) * clampedAmount;
    var mixedAlpha = fromColor._colorData.rgba[3] + (toColor._colorData.rgba[3] - fromColor._colorData.rgba[3]) * clampedAmount;
    rgba = (__momentumColorMode === HSB
      ? __momentumHsbToRgb(mixedHue, mixedSaturation, mixedThird)
      : __momentumHslToRgb(mixedHue, mixedSaturation, mixedThird));
    rgba[3] = mixedAlpha;
  }
  return __momentumCreateColor(rgba, __momentumColorMode, __momentumCurrentColorMaxes());
}

function __momentumNormalizeFontSource(source) {
  return String(source == null ? "" : source).replace(/\\/g, "/");
}

function __momentumNormalizeFontData(fontData) {
  fontData = fontData || {};
  return {
    source: __momentumNormalizeFontSource(fontData.source),
    fontName: String(fontData.fontName || ""),
    fontPath: String(fontData.fontPath || ""),
    fontSourceKind: fontData.fontSourceKind === "file" ? "file" : "system",
    loaded: !!fontData.loaded,
    loadError: String(fontData.loadError || ""),
  };
}

function __momentumCreateFontMeta(fontData) {
  return {
    familyName: fontData.fontName,
    path: fontData.fontPath,
    source: fontData.source,
    loaded: fontData.loaded,
  };
}

p5.Font = function(fontData) {
  this.__momentumType = "Font";
  this._fontData = __momentumNormalizeFontData(fontData);
  this.font = __momentumCreateFontMeta(this._fontData);
};

function __momentumCreateFont(fontData) {
  return new p5.Font(fontData);
}

function __momentumReviveFontValue(value) {
  if (value == null) {
    return value;
  }
  if (Array.isArray(value)) {
    for (var i = 0; i < value.length; i += 1) {
      value[i] = __momentumReviveFontValue(value[i]);
    }
    return value;
  }
  if (typeof value !== "object") {
    return value;
  }
  if (value.__momentumType === "Graphics" || value.__momentumType === "Image") {
    return value;
  }
  if (value.__momentumType === "Font") {
    if (!(value instanceof p5.Font)) {
      value = __momentumCreateFont(value._fontData || value);
    } else {
      value._fontData = __momentumNormalizeFontData(value._fontData);
      value.font = __momentumCreateFontMeta(value._fontData);
    }
    return value;
  }
  Object.keys(value).forEach(function(key) {
    value[key] = __momentumReviveFontValue(value[key]);
  });
  return value;
}

function __momentumFontError(fontValue) {
  var message =
    fontValue &&
    fontValue._fontData &&
    fontValue._fontData.loadError
      ? fontValue._fontData.loadError
      : "Failed to load font";
  return new Error(message);
}

var __momentumNativeTextFont = textFont;
var __momentumFontCache = {};
var __momentumCurrentFontValue = __momentumNativeTextFont();

loadFont = function(path, successCallback, failureCallback) {
  var normalizedSource = __momentumNormalizeFontSource(path);
  if (!normalizedSource) {
    var emptyFont = __momentumCreateFont({
      source: "",
      loaded: false,
      loadError: "Font source is empty",
    });
    if (typeof failureCallback === "function") {
      failureCallback(__momentumFontError(emptyFont));
    }
    return emptyFont;
  }

  if (__momentumFontCache[normalizedSource]) {
    var cachedFont = __momentumFontCache[normalizedSource];
    if (cachedFont._fontData.loaded) {
      if (typeof successCallback === "function") {
        successCallback(cachedFont);
      }
    } else if (typeof failureCallback === "function") {
      failureCallback(__momentumFontError(cachedFont));
    }
    return cachedFont;
  }

  var descriptor = __momentumNativeLoadFont(normalizedSource) || {};
  descriptor.source = descriptor.source || normalizedSource;
  var loadedFont = __momentumCreateFont(descriptor);
  __momentumFontCache[normalizedSource] = loadedFont;

  if (loadedFont._fontData.loaded) {
    if (typeof successCallback === "function") {
      successCallback(loadedFont);
    }
  } else if (typeof failureCallback === "function") {
    failureCallback(__momentumFontError(loadedFont));
  }

  return loadedFont;
};

textFont = function(fontOrName, size) {
  if (arguments.length === 0) {
    return __momentumCurrentFontValue;
  }

  if (fontOrName && fontOrName.__momentumType === "Font") {
    if (fontOrName._fontData && fontOrName._fontData.loaded) {
      __momentumNativeTextFont(fontOrName._fontData, size);
      __momentumCurrentFontValue = fontOrName;
    }
    return;
  }

  __momentumNativeTextFont(fontOrName, size);
  __momentumCurrentFontValue = String(fontOrName || "Arial");
};

p5.Font.prototype.textBounds = function(textValue, x, y, fontSize) {
  return __momentumNativeFontTextBounds(
    this._fontData,
    String(textValue == null ? "" : textValue),
    Number(x) || 0,
    Number(y) || 0,
    Number(fontSize) > 0 ? Number(fontSize) : (__momentumNativeTextFont ? Number(textSize()) || 12 : 12)
  );
};

p5.Font.prototype.textToPoints = function(textValue, x, y, fontSize, options) {
  options = options && typeof options === "object" ? options : {};
  return __momentumNativeFontTextToPoints(
    this._fontData,
    String(textValue == null ? "" : textValue),
    Number(x) || 0,
    Number(y) || 0,
    Number(fontSize) > 0 ? Number(fontSize) : (Number(textSize()) || 12),
    Number(options.sampleFactor) > 0 ? Number(options.sampleFactor) : 0.1,
    Number(options.simplifyThreshold) > 0 ? Number(options.simplifyThreshold) : 0
  );
};

p5.Font.prototype.constructor = p5.Font;

function __momentumNormalizeImageData(imageData) {
  imageData = imageData || {};
  return {
    id: Number(imageData.id) > 0 ? Number(imageData.id) : 0,
    source: String(imageData.source || ""),
    path: String(imageData.path || ""),
    width: Math.max(0, Math.floor(Number(imageData.width) || 0)),
    height: Math.max(0, Math.floor(Number(imageData.height) || 0)),
    pixelDensity: Math.max(1, Number(imageData.pixelDensity) || 1),
    loaded: !!imageData.loaded,
    loadError: String(imageData.loadError || ""),
  };
}

function __momentumCreateImageMeta(imageData) {
  return {
    id: imageData.id,
    source: imageData.source,
    path: imageData.path,
    width: imageData.width,
    height: imageData.height,
    loaded: imageData.loaded,
  };
}

p5.Image = function(imageData) {
  this.__momentumType = "Image";
  this._imageData = __momentumNormalizeImageData(imageData);
  this.width = this._imageData.width;
  this.height = this._imageData.height;
  this._pixels = [];
  this._pixelsLoaded = false;
  this.canvas = null;
  this.drawingContext = null;
};

Object.defineProperty(p5.Image.prototype, 'pixels', {
  get: function() {
    return this._pixels;
  },
  set: function(value) {
    this._pixels = Array.isArray(value) ? value.slice() : [];
    this._pixelsLoaded = true;
  },
  enumerable: false,
  configurable: true
});

function __momentumCreateImage(imageData) {
  return new p5.Image(imageData);
}

function __momentumSyncImageInstance(imageValue, descriptor) {
  if (!imageValue || !descriptor) {
    return imageValue;
  }
  var currentPixelDensity =
    imageValue._imageData && Number(imageValue._imageData.pixelDensity) > 0
      ? Number(imageValue._imageData.pixelDensity)
      : 1;
  if (!(Number(descriptor.pixelDensity) > 0)) {
    descriptor = Object.assign({}, descriptor, { pixelDensity: currentPixelDensity });
  }
  imageValue._imageData = __momentumNormalizeImageData(descriptor);
  imageValue.width = imageValue._imageData.width;
  imageValue.height = imageValue._imageData.height;
  return imageValue;
}

function __momentumInvalidateImagePixels(imageValue) {
  if (!imageValue) return imageValue;
  imageValue._pixels = [];
  imageValue._pixelsLoaded = false;
  return imageValue;
}

function __momentumCacheImagePixel(imageValue, x, y, colorValue) {
  if (!imageValue || !imageValue._pixelsLoaded) {
    return;
  }
  var width = Number(imageValue.width) || 0;
  var height = Number(imageValue.height) || 0;
  var density = __momentumImageDensity(imageValue);
  var pixelX = Math.floor(Number(x) || 0);
  var pixelY = Math.floor(Number(y) || 0);
  if (pixelX < 0 || pixelY < 0 || pixelX >= width || pixelY >= height) {
    return;
  }

  var colorArray = __momentumNormalizeImageSetValue(colorValue);
  var denseWidth = width * density;
  for (var dy = 0; dy < density; dy += 1) {
    for (var dx = 0; dx < density; dx += 1) {
      var offset = (((pixelY * density + dy) * denseWidth) + (pixelX * density + dx)) * 4;
      imageValue._pixels[offset + 0] = Number(colorArray[0]) || 0;
      imageValue._pixels[offset + 1] = Number(colorArray[1]) || 0;
      imageValue._pixels[offset + 2] = Number(colorArray[2]) || 0;
      imageValue._pixels[offset + 3] =
        colorArray.length > 3 ? Number(colorArray[3]) || 0 : 255;
    }
  }
}

function __momentumReviveImageValue(value) {
  if (value == null) return value;
  if (Array.isArray(value)) {
    for (var i = 0; i < value.length; i += 1) {
      value[i] = __momentumReviveImageValue(value[i]);
    }
    return value;
  }
  if (typeof value !== "object") return value;
  if (value.__momentumType === "Font") {
    return value;
  }
  if (value.__momentumType === "Graphics") {
    return value;
  }
  if (value.__momentumType === "Image") {
    if (!(value instanceof p5.Image)) {
      value = __momentumCreateImage(value._imageData || value);
    } else {
      __momentumSyncImageInstance(value, value._imageData);
    }
    return value;
  }
  Object.keys(value).forEach(function(key) {
    value[key] = __momentumReviveImageValue(value[key]);
  });
  return value;
}

function __momentumReviveGraphicsValue(value) {
  if (value == null) return value;
  if (Array.isArray(value)) {
    for (var i = 0; i < value.length; i += 1) {
      value[i] = __momentumReviveGraphicsValue(value[i]);
    }
    return value;
  }
  if (typeof value !== "object") return value;
  if (value.__momentumType === "Font" || value.__momentumType === "Image") {
    return value;
  }
  if (value.__momentumType === "Graphics") {
    var graphicsBindings = value._graphicsBindings || null;
    if (!(value instanceof p5.Graphics)) {
      value = __momentumCreateGraphics({
        id: value._graphicsId,
        imageData: value._imageData || value.imageData || {}
      });
    } else {
      __momentumSyncGraphicsInstance(value, {
        id: value._graphicsId,
        imageData: value._imageData || value.imageData || {}
      });
    }
    value._graphicsBindings = graphicsBindings;
    return value;
  }
  Object.keys(value).forEach(function(key) {
    value[key] = __momentumReviveGraphicsValue(value[key]);
  });
  return value;
}

function __momentumReviveValue(value) {
  if (value == null) {
    return value;
  }
  if (Array.isArray(value)) {
    for (var i = 0; i < value.length; i += 1) {
      value[i] = __momentumReviveValue(value[i]);
    }
    return value;
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (value.__momentumType === 'Graphics') {
    return __momentumReviveGraphicsValue(value);
  }
  if (value.__momentumType === 'Image') {
    return __momentumReviveImageValue(value);
  }
  if (value.__momentumType === 'Font') {
    return __momentumReviveFontValue(value);
  }
  Object.keys(value).forEach(function(key) {
    value[key] = __momentumReviveValue(value[key]);
  });
  return value;
}

function __momentumImageError(imageValue) {
  var message =
    imageValue &&
    imageValue._imageData &&
    imageValue._imageData.loadError
      ? imageValue._imageData.loadError
      : "Failed to load image";
  return new Error(message);
}

function __momentumNormalizeImageSource(source) {
  return String(source == null ? "" : source).replace(/\\/g, "/");
}

function __momentumNormalizeImageSetValue(value) {
  if (value && value.__momentumType === "Image") {
    return value;
  }
  if (__momentumIsColorObject(value)) {
    return __momentumColorBytes(value);
  }
  if (Array.isArray(value)) {
    return [
      Number(value[0]) || 0,
      Number(value[1]) || 0,
      Number(value[2]) || 0,
      value.length > 3 ? Number(value[3]) || 0 : 255,
    ];
  }
  if (typeof value === 'number') {
    var channel = Number(value) || 0;
    return [channel, channel, channel, 255];
  }
  return [0, 0, 0, 255];
}

var __momentumNativeCreateImage = createImage;
var __momentumImageCache = {};
var __momentumCanvasImage = null;
var __momentumCanvasPixels = [];
var __momentumCanvasPixelsLoaded = false;

loadImage = function(path, successCallback, failureCallback) {
  var normalizedSource = __momentumNormalizeImageSource(path);
  if (!normalizedSource) {
    var emptyImage = __momentumCreateImage({
      source: "",
      loaded: false,
      loadError: "Image source is empty",
    });
    if (typeof failureCallback === "function") {
      failureCallback(__momentumImageError(emptyImage));
    }
    return emptyImage;
  }

  if (__momentumImageCache[normalizedSource]) {
    var cachedImage = __momentumImageCache[normalizedSource];
    if (cachedImage._imageData.loaded) {
      if (typeof successCallback === "function") {
        successCallback(cachedImage);
      }
    } else if (typeof failureCallback === "function") {
      failureCallback(__momentumImageError(cachedImage));
    }
    return cachedImage;
  }

  var descriptor = __momentumNativeLoadImage(normalizedSource) || {};
  descriptor.source = descriptor.source || normalizedSource;
  var loadedImage = __momentumCreateImage(descriptor);
  __momentumImageCache[normalizedSource] = loadedImage;
  if (loadedImage._imageData.loaded) {
    if (typeof successCallback === "function") {
      successCallback(loadedImage);
    }
  } else if (typeof failureCallback === "function") {
    failureCallback(__momentumImageError(loadedImage));
  }
  return loadedImage;
};

createImage = function(width, height) {
  return __momentumCreateImage(__momentumNativeCreateImage(width, height) || {});
};

function __momentumGetCanvasImage(forceSnapshot) {
  var descriptor =
    __momentumNativeCanvasImage(forceSnapshot ? "snapshot" : "scene") || {};
  return __momentumSyncCanvasImageDescriptor(descriptor);
}

function __momentumGetMutableCanvasImage() {
  var descriptor = __momentumNativeCanvasImage("mutable") || {};
  return __momentumSyncCanvasImageDescriptor(descriptor);
}

function __momentumSyncCanvasImageDescriptor(descriptor) {
  if (!__momentumCanvasImage || __momentumCanvasImage.__momentumType !== "Image") {
    __momentumCanvasImage = __momentumCreateImage(descriptor);
  } else {
    __momentumSyncImageInstance(__momentumCanvasImage, descriptor);
  }
  return __momentumCanvasImage;
}

function __momentumCanvasDensity() {
  return Math.max(1, Math.round(Number(pixelDensity()) || 1));
}

function __momentumImageDensity(imageValue) {
  return imageValue && imageValue._imageData && Number(imageValue._imageData.pixelDensity) > 0
    ? Math.max(1, Math.round(Number(imageValue._imageData.pixelDensity) || 1))
    : 1;
}

function __momentumExpandCanvasPixels(imagePixels, imageWidth, imageHeight, density) {
  var denseWidth = imageWidth * density;
  var denseHeight = imageHeight * density;
  var expanded = new Array(denseWidth * denseHeight * 4);
  for (var y = 0; y < denseHeight; y += 1) {
    var sourceY = Math.min(imageHeight - 1, Math.floor(y / density));
    for (var x = 0; x < denseWidth; x += 1) {
      var sourceX = Math.min(imageWidth - 1, Math.floor(x / density));
      var sourceIndex = (sourceY * imageWidth + sourceX) * 4;
      var destIndex = (y * denseWidth + x) * 4;
      expanded[destIndex + 0] = Number(imagePixels[sourceIndex + 0]) || 0;
      expanded[destIndex + 1] = Number(imagePixels[sourceIndex + 1]) || 0;
      expanded[destIndex + 2] = Number(imagePixels[sourceIndex + 2]) || 0;
      expanded[destIndex + 3] = Number(imagePixels[sourceIndex + 3]) || 0;
    }
  }
  return expanded;
}

function __momentumCompressCanvasPixels(densePixels, imageWidth, imageHeight, density) {
  var denseWidth = imageWidth * density;
  var compressed = new Array(imageWidth * imageHeight * 4);
  for (var y = 0; y < imageHeight; y += 1) {
    for (var x = 0; x < imageWidth; x += 1) {
      var denseIndex = ((y * density) * denseWidth + (x * density)) * 4;
      var destIndex = (y * imageWidth + x) * 4;
      compressed[destIndex + 0] = Number(densePixels[denseIndex + 0]) || 0;
      compressed[destIndex + 1] = Number(densePixels[denseIndex + 1]) || 0;
      compressed[destIndex + 2] = Number(densePixels[denseIndex + 2]) || 0;
      compressed[destIndex + 3] = Number(densePixels[denseIndex + 3]) || 0;
    }
  }
  return compressed;
}

function __momentumExpandImagePixels(imageValue, imagePixels) {
  return __momentumExpandCanvasPixels(
    imagePixels || [],
    Number(imageValue && imageValue.width) || 0,
    Number(imageValue && imageValue.height) || 0,
    __momentumImageDensity(imageValue)
  );
}

function __momentumCompressImagePixels(imageValue, densePixels) {
  return __momentumCompressCanvasPixels(
    densePixels || [],
    Number(imageValue && imageValue.width) || 0,
    Number(imageValue && imageValue.height) || 0,
    __momentumImageDensity(imageValue)
  );
}

function __momentumInvalidateCanvasPixels() {
  __momentumCanvasPixels = [];
  __momentumCanvasPixelsLoaded = false;
}

function __momentumRefreshCanvasPixelsFromImage(canvasImage) {
  if (!canvasImage) {
    __momentumInvalidateCanvasPixels();
    return;
  }
  if (!__momentumCanvasPixelsLoaded) {
    return;
  }
  __momentumCanvasPixels = __momentumExpandCanvasPixels(
    __momentumNativeImageLoadPixels(canvasImage._imageData) || [],
    Number(canvasImage.width) || 0,
    Number(canvasImage.height) || 0,
    __momentumCanvasDensity()
  );
  __momentumCanvasPixelsLoaded = true;
}

Object.defineProperty(globalThis, "pixels", {
  get: function() {
    return __momentumCanvasPixelsLoaded ? __momentumCanvasPixels : [];
  },
  set: function(value) {
    __momentumCanvasPixels = Array.isArray(value) ? value.slice() : [];
    __momentumCanvasPixelsLoaded = true;
  },
  enumerable: true,
  configurable: true,
});

loadPixels = function() {
  var canvasImage = __momentumGetCanvasImage(true);
  __momentumCanvasPixels = __momentumExpandCanvasPixels(
    __momentumNativeImageLoadPixels(canvasImage._imageData) || [],
    Number(canvasImage.width) || 0,
    Number(canvasImage.height) || 0,
    __momentumCanvasDensity()
  );
  __momentumCanvasPixelsLoaded = true;
};

updatePixels = function(x, y, width, height) {
  var canvasImage = __momentumGetMutableCanvasImage();
  if (!__momentumCanvasPixelsLoaded) {
    return canvasImage.updatePixels.apply(canvasImage, arguments);
  }
  var nativePixels = __momentumCompressCanvasPixels(
    __momentumCanvasPixels,
    Number(canvasImage.width) || 0,
    Number(canvasImage.height) || 0,
    __momentumCanvasDensity()
  );
  var descriptor =
    arguments.length === 4
      ? __momentumNativeImageUpdatePixels(
          canvasImage._imageData,
          nativePixels,
          Number(x) || 0,
          Number(y) || 0,
          Number(width) || 0,
          Number(height) || 0
        )
      : __momentumNativeImageUpdatePixels(canvasImage._imageData, nativePixels);
  __momentumSyncImageInstance(canvasImage, descriptor || canvasImage._imageData);
  return;
};

get = function(x, y, width, height) {
  var canvasImage = __momentumGetCanvasImage(true);
  return canvasImage.get.apply(canvasImage, arguments);
};

set = function(x, y, value) {
  var canvasImage = __momentumGetMutableCanvasImage();
  var result = canvasImage.set.apply(canvasImage, arguments);
  __momentumRefreshCanvasPixelsFromImage(canvasImage);
  return result;
};

copy = function() {
  var canvasImage = __momentumGetMutableCanvasImage();
  var result = canvasImage.copy.apply(canvasImage, arguments);
  __momentumRefreshCanvasPixelsFromImage(canvasImage);
  return result;
};

blend = function() {
  var canvasImage = __momentumGetMutableCanvasImage();
  var result = canvasImage.blend.apply(canvasImage, arguments);
  __momentumRefreshCanvasPixelsFromImage(canvasImage);
  return result;
};

filter = function(filterKind, value) {
  var canvasImage = __momentumGetMutableCanvasImage();
  var result = canvasImage.filter.apply(canvasImage, arguments);
  __momentumRefreshCanvasPixelsFromImage(canvasImage);
  return result;
};

p5.Image.prototype.loadPixels = function() {
  this.pixels = __momentumExpandImagePixels(this, __momentumNativeImageLoadPixels(this._imageData) || []);
};

p5.Image.prototype.updatePixels = function(x, y, width, height) {
  if (!this._pixelsLoaded) {
    return;
  }
  var nativePixels = __momentumCompressImagePixels(this, this._pixels);
  var descriptor =
    arguments.length === 4
      ? __momentumNativeImageUpdatePixels(this._imageData, nativePixels, Number(x) || 0, Number(y) || 0, Number(width) || 0, Number(height) || 0)
      : __momentumNativeImageUpdatePixels(this._imageData, nativePixels);
  __momentumSyncImageInstance(this, descriptor || this._imageData);
};

p5.Image.prototype.get = function(x, y, width, height) {
  if (arguments.length === 0) {
    return __momentumCreateImage(__momentumNativeImageClone(this._imageData) || {});
  }
  if (arguments.length === 2) {
    return __momentumNativeImageGetPixel(this._imageData, Number(x) || 0, Number(y) || 0) || [0, 0, 0, 0];
  }
  if (arguments.length === 4) {
    return __momentumCreateImage(
      __momentumNativeImageGetRegion(this._imageData, Number(x) || 0, Number(y) || 0, Number(width) || 0, Number(height) || 0) || {}
    );
  }
  return __momentumCreateImage(__momentumNativeImageClone(this._imageData) || {});
};

p5.Image.prototype.set = function(x, y, value) {
  var descriptor;
  if (value && value.__momentumType === "Image") {
    descriptor = __momentumNativeImageSetImage(this._imageData, Number(x) || 0, Number(y) || 0, value._imageData);
    __momentumSyncImageInstance(this, descriptor || this._imageData);
    if (this._pixelsLoaded) {
      this.loadPixels();
    } else {
      __momentumInvalidateImagePixels(this);
    }
  } else {
    descriptor = __momentumNativeImageSetColor(this._imageData, Number(x) || 0, Number(y) || 0, __momentumNormalizeImageSetValue(value));
    __momentumSyncImageInstance(this, descriptor || this._imageData);
    __momentumCacheImagePixel(this, x, y, value);
  }
};

p5.Image.prototype.resize = function(width, height) {
  __momentumSyncImageInstance(
    this,
    __momentumNativeImageResize(this._imageData, Number(width) || 0, Number(height) || 0) || this._imageData
  );
  __momentumInvalidateImagePixels(this);
};

p5.Image.prototype.mask = function(imageValue) {
  if (!imageValue || imageValue.__momentumType !== "Image") return;
  __momentumSyncImageInstance(this, __momentumNativeImageMask(this._imageData, imageValue._imageData) || this._imageData);
  __momentumInvalidateImagePixels(this);
};

p5.Image.prototype.copy = function() {
  var args = Array.prototype.slice.call(arguments);
  var sourceValue = this._imageData;
  if (args[0] && args[0].__momentumType === "Image") {
    sourceValue = args.shift()._imageData;
  }
  __momentumSyncImageInstance(
    this,
    __momentumNativeImageCopy.apply(null, [this._imageData, sourceValue].concat(args.map(function(value) { return Number(value) || 0; }))) || this._imageData
  );
  __momentumInvalidateImagePixels(this);
};

p5.Image.prototype.blend = function() {
  var args = Array.prototype.slice.call(arguments);
  var sourceValue = this._imageData;
  if (args[0] && args[0].__momentumType === "Image") {
    sourceValue = args.shift()._imageData;
  }
  var blendMode = args.length > 0 ? args.pop() : BLEND;
  __momentumSyncImageInstance(
    this,
    __momentumNativeImageBlend.apply(
      null,
      [this._imageData, sourceValue]
        .concat(args.map(function(value) { return Number(value) || 0; }))
        .concat([blendMode])
    ) || this._imageData
  );
  __momentumInvalidateImagePixels(this);
};

p5.Image.prototype.filter = function(filterKind, value) {
  __momentumSyncImageInstance(
    this,
    __momentumNativeImageFilter(this._imageData, String(filterKind || ""), arguments.length > 1 ? Number(value) || 0 : 0) || this._imageData
  );
  __momentumInvalidateImagePixels(this);
};

p5.Image.prototype.pixelDensity = function(value) {
  if (arguments.length === 0) {
    return Number(this._imageData && this._imageData.pixelDensity) || 1;
  }
  var nextDensity = Math.max(1, Number(value) || 1);
  this._imageData = __momentumNormalizeImageData(
    Object.assign({}, this._imageData || {}, { pixelDensity: nextDensity })
  );
  __momentumInvalidateImagePixels(this);
  return this;
};

p5.Image.prototype.constructor = p5.Image;

function __momentumNormalizeGraphicsData(graphicsData) {
  graphicsData = graphicsData || {};
  return {
    id: Number(graphicsData.id) > 0 ? Number(graphicsData.id) : 0,
    imageData: __momentumNormalizeImageData(graphicsData.imageData || graphicsData._imageData || {}),
  };
}

p5.Graphics = function(graphicsData) {
  graphicsData = __momentumNormalizeGraphicsData(graphicsData);
  p5.Image.call(this, graphicsData.imageData);
  this.__momentumType = "Graphics";
  this._graphicsId = graphicsData.id;
  this.canvas = this;
  this.elt = this;
  this.drawingContext = null;
  this._graphicsBindings = __momentumDefaultGraphicsBindings(this);
};

p5.Graphics.prototype = Object.create(p5.Image.prototype);

function __momentumCreateGraphics(graphicsData) {
  return new p5.Graphics(graphicsData);
}

function __momentumSyncGraphicsInstance(graphicsValue, descriptor) {
  if (!graphicsValue || !descriptor) {
    return graphicsValue;
  }
  var normalized = __momentumNormalizeGraphicsData(descriptor);
  graphicsValue._graphicsId = normalized.id;
  __momentumSyncImageInstance(graphicsValue, normalized.imageData);
  graphicsValue.width = graphicsValue._imageData.width;
  graphicsValue.height = graphicsValue._imageData.height;
  if (!graphicsValue._graphicsBindings) {
    graphicsValue._graphicsBindings = __momentumDefaultGraphicsBindings(graphicsValue);
  } else {
    graphicsValue._graphicsBindings.width = graphicsValue.width;
    graphicsValue._graphicsBindings.height = graphicsValue.height;
    graphicsValue._graphicsBindings.canvasImageData =
      graphicsValue._imageData
        ? {
            __momentumType: "Image",
            _imageData: __momentumNormalizeImageData(graphicsValue._imageData),
          }
        : null;
  }
  return graphicsValue;
}

function __momentumCaptureGraphicsBindings() {
  return {
    width: Number(globalThis.width) || 0,
    height: Number(globalThis.height) || 0,
    colorMode: __momentumColorMode,
    colorMaxes: __momentumCurrentColorMaxes(),
    currentFontValue: __momentumCurrentFontValue,
    canvasImageData:
      __momentumCanvasImage && __momentumCanvasImage._imageData
        ? {
            __momentumType: "Image",
            _imageData: __momentumNormalizeImageData(__momentumCanvasImage._imageData),
          }
        : null,
    canvasPixels: Array.isArray(__momentumCanvasPixels) ? __momentumCanvasPixels.slice() : [],
    canvasPixelsLoaded: !!__momentumCanvasPixelsLoaded,
    curveTightness: Number(__momentumCurveTightness) || 0,
  };
}

function __momentumRestoreGraphicsBindings(state) {
  state = state || {};
  globalThis.width = Number(state.width) || 0;
  globalThis.height = Number(state.height) || 0;
  __momentumColorMode = state.colorMode === HSB || state.colorMode === HSL ? state.colorMode : RGB;
  if (state.colorMaxes && state.colorMaxes.length >= 4) {
    __momentumColorMaxes = [
      Number(state.colorMaxes[0]) || 255,
      Number(state.colorMaxes[1]) || 255,
      Number(state.colorMaxes[2]) || 255,
      Number(state.colorMaxes[3]) || 255,
    ];
  } else {
    __momentumColorMaxes = [255, 255, 255, 255];
  }
  __momentumNativeColorMode(__momentumColorMode);
  __momentumCurrentFontValue = __momentumReviveFontValue(state.currentFontValue);
  __momentumCanvasImage = __momentumReviveImageValue(state.canvasImageData || null);
  __momentumCanvasPixels = Array.isArray(state.canvasPixels) ? state.canvasPixels.slice() : [];
  __momentumCanvasPixelsLoaded = !!state.canvasPixelsLoaded;
  __momentumCurveTightness = Number(state.curveTightness) || 0;
}

function __momentumDefaultGraphicsBindings(graphicsValue) {
  return {
    width: Number(graphicsValue && graphicsValue.width) || 0,
    height: Number(graphicsValue && graphicsValue.height) || 0,
    colorMode: RGB,
    colorMaxes: [255, 255, 255, 255],
    currentFontValue: "Arial",
    canvasImageData:
      graphicsValue && graphicsValue._imageData
        ? {
            __momentumType: "Image",
            _imageData: __momentumNormalizeImageData(graphicsValue._imageData),
          }
        : null,
    canvasPixels: [],
    canvasPixelsLoaded: false,
    curveTightness: 0,
  };
}

function __momentumWithGraphics(graphicsValue, callback, argsLike) {
  if (!graphicsValue || graphicsValue.__momentumType !== "Graphics") {
    return;
  }

  var mainBindings = __momentumCaptureGraphicsBindings();
  var entered = false;
  try {
    if (!__momentumNativeEnterGraphics(graphicsValue._graphicsId)) {
      return;
    }
    entered = true;
    __momentumRestoreGraphicsBindings(graphicsValue._graphicsBindings || __momentumDefaultGraphicsBindings(graphicsValue));
    var result = callback.apply(globalThis, Array.prototype.slice.call(argsLike || []));
    graphicsValue._graphicsBindings = __momentumCaptureGraphicsBindings();
    var descriptor = __momentumNativeExitGraphics(graphicsValue._graphicsId) || {};
    entered = false;
    __momentumSyncGraphicsInstance(graphicsValue, descriptor);
    __momentumInvalidateImagePixels(graphicsValue);
    return result;
  } finally {
    if (entered) {
      var exitDescriptor = __momentumNativeExitGraphics(graphicsValue._graphicsId) || {};
      __momentumSyncGraphicsInstance(graphicsValue, exitDescriptor);
      __momentumInvalidateImagePixels(graphicsValue);
    }
    __momentumRestoreGraphicsBindings(mainBindings);
  }
}

function __momentumPrepareGraphicsBitmap(graphicsValue) {
  if (!graphicsValue || graphicsValue.__momentumType !== "Graphics") {
    return graphicsValue;
  }
  var descriptor = __momentumNativePrepareGraphicsBitmap(graphicsValue._graphicsId) || null;
  if (descriptor) {
    __momentumSyncGraphicsInstance(graphicsValue, descriptor);
  }
  return graphicsValue;
}

function __momentumCommitGraphicsBitmap(graphicsValue) {
  if (!graphicsValue || graphicsValue.__momentumType !== "Graphics") {
    return graphicsValue;
  }
  var descriptor = __momentumNativeCommitGraphicsBitmap(graphicsValue._graphicsId) || null;
  if (descriptor) {
    __momentumSyncGraphicsInstance(graphicsValue, descriptor);
  }
  return graphicsValue;
}

function __momentumInstallGraphicsMethod(name) {
  if (typeof globalThis[name] !== "function") {
    return;
  }
  p5.Graphics.prototype[name] = function() {
    return __momentumWithGraphics(this, globalThis[name], arguments);
  };
}

[
  "background",
  "clear",
  "fill",
  "stroke",
  "colorMode",
  "color",
  "noFill",
  "noStroke",
  "strokeWeight",
  "strokeCap",
  "strokeJoin",
  "blendMode",
  "erase",
  "noErase",
  "beginClip",
  "endClip",
  "angleMode",
  "translate",
  "rotate",
  "scale",
  "applyMatrix",
  "resetMatrix",
  "text",
  "textSize",
  "textLeading",
  "textFont",
  "textStyle",
  "textWrap",
  "textAlign",
  "textWidth",
  "textAscent",
  "textDescent",
  "image",
  "imageMode",
  "pixelDensity",
  "tint",
  "noTint",
  "rectMode",
  "ellipseMode",
  "push",
  "pop",
  "ellipse",
  "arc",
  "circle",
  "rect",
  "square",
  "triangle",
  "quad",
  "line",
  "point",
  "beginShape",
  "vertex",
  "bezierVertex",
  "quadraticVertex",
  "curveVertex",
  "endShape",
  "bezier",
  "curve",
  "beginContour",
  "endContour",
  "curveTightness"
].forEach(__momentumInstallGraphicsMethod);

p5.Graphics.prototype.constructor = p5.Graphics;

p5.Graphics.prototype.loadPixels = function() {
  __momentumPrepareGraphicsBitmap(this);
  p5.Image.prototype.loadPixels.call(this);
};

p5.Graphics.prototype.updatePixels = function(x, y, width, height) {
  __momentumPrepareGraphicsBitmap(this);
  p5.Image.prototype.updatePixels.apply(this, arguments);
  __momentumCommitGraphicsBitmap(this);
};

p5.Graphics.prototype.get = function() {
  __momentumPrepareGraphicsBitmap(this);
  return p5.Image.prototype.get.apply(this, arguments);
};

p5.Graphics.prototype.set = function() {
  __momentumPrepareGraphicsBitmap(this);
  var result = p5.Image.prototype.set.apply(this, arguments);
  __momentumCommitGraphicsBitmap(this);
  return result;
};

p5.Graphics.prototype.copy = function() {
  __momentumPrepareGraphicsBitmap(this);
  var result = p5.Image.prototype.copy.apply(this, arguments);
  __momentumCommitGraphicsBitmap(this);
  return result;
};

p5.Graphics.prototype.blend = function() {
  __momentumPrepareGraphicsBitmap(this);
  var result = p5.Image.prototype.blend.apply(this, arguments);
  __momentumCommitGraphicsBitmap(this);
  return result;
};

p5.Graphics.prototype.filter = function() {
  __momentumPrepareGraphicsBitmap(this);
  var result = p5.Image.prototype.filter.apply(this, arguments);
  __momentumCommitGraphicsBitmap(this);
  return result;
};

createGraphics = function(width, height) {
  return __momentumCreateGraphics(__momentumNativeCreateGraphics(width, height) || {});
};
)MOMENTUM_BOOT";

constexpr char kBootstrapStateCaptureScript[] = R"MOMENTUM_BOOT(
var __momentumBaselineGlobals = {};
var __momentumRegisteredBindings = [];
Object.getOwnPropertyNames(globalThis).forEach(function(key) { __momentumBaselineGlobals[key] = true; });
function __momentumRegisterBinding(name, getter, restorer) {
  __momentumRegisteredBindings.push({ name: name, getter: getter, restorer: restorer });
}
__momentumRegisterBinding('__momentumColorState', function() {
  return { mode: __momentumColorMode, maxes: __momentumCurrentColorMaxes() };
}, function(state) {
  if (!state) return;
  __momentumColorMode = state.mode === HSB || state.mode === HSL ? state.mode : RGB;
  if (state.maxes && state.maxes.length >= 4) {
    __momentumColorMaxes = [state.maxes[0], state.maxes[1], state.maxes[2], state.maxes[3]];
  }
  __momentumNativeColorMode(__momentumColorMode);
});
__momentumRegisterBinding('__momentumTypographyState', function() {
  return {
    currentFontValue: __momentumCurrentFontValue,
    fontCache: __momentumFontCache,
  };
}, function(state) {
  if (!state) return;
  __momentumCurrentFontValue = __momentumReviveFontValue(state.currentFontValue);
  __momentumFontCache = __momentumReviveFontValue(state.fontCache || {});
});
__momentumRegisterBinding('__momentumImageState', function() {
  return {
    imageCache: __momentumImageCache,
    canvasImageData: __momentumCanvasImage,
  };
}, function(state) {
  if (!state) return;
  __momentumImageCache = __momentumReviveImageValue(state.imageCache || {});
  __momentumCanvasImage = __momentumReviveImageValue(state.canvasImageData || null);
});
function __momentumSanitize(value) {
  if (value === null) return null;
  var type = typeof value;
  if (type === 'number' || type === 'string' || type === 'boolean') return value;
  if (type === 'function' || type === 'undefined' || type === 'symbol') return undefined;
  if (Array.isArray(value)) {
    return value.map(function(item) { return __momentumSanitize(item); });
  }
  if (type === 'object') {
    if (value.__momentumType === 'Graphics') {
      return {
        __momentumType: 'Graphics',
        _graphicsId: value._graphicsId,
        _imageData: __momentumSanitize(value._imageData),
      };
    }
    if (value.__momentumType === 'Image') {
      return {
        __momentumType: 'Image',
        _imageData: __momentumSanitize(value._imageData),
      };
    }
    if (value.__momentumType === 'Font') {
      return {
        __momentumType: 'Font',
        _fontData: __momentumSanitize(value._fontData),
      };
    }
    var output = {};
    Object.keys(value).forEach(function(key) {
      var sanitized = __momentumSanitize(value[key]);
      if (sanitized !== undefined) output[key] = sanitized;
    });
    return output;
  }
  return undefined;
}
function __momentumCaptureState() {
  var state = {};
  Object.getOwnPropertyNames(globalThis).forEach(function(key) {
    if (__momentumBaselineGlobals[key]) return;
    var sanitized = __momentumSanitize(globalThis[key]);
    if (sanitized !== undefined) state[key] = sanitized;
  });
  __momentumRegisteredBindings.forEach(function(entry) {
    try {
      var sanitized = __momentumSanitize(entry.getter());
      if (sanitized !== undefined) state[entry.name] = sanitized;
    } catch (error) {}
  });
  return JSON.stringify(state);
}
function __momentumDeepAssign(target, source) {
  if (source === null || typeof source !== 'object') return source;
  if (Array.isArray(source)) {
    if (!Array.isArray(target)) target = [];
    target.length = source.length;
    for (var i = 0; i < source.length; i += 1) {
      target[i] = __momentumDeepAssign(target[i], source[i]);
    }
    return target;
  }
  if (!target || typeof target !== 'object') target = {};
  Object.keys(source).forEach(function(key) {
    target[key] = __momentumDeepAssign(target[key], source[key]);
  });
  return target;
}
function __momentumRestoreState(json) {
  var state = JSON.parse(json);
  Object.keys(state).forEach(function(key) {
    if (typeof globalThis[key] === 'function') return;
    globalThis[key] = __momentumReviveValue(__momentumDeepAssign(globalThis[key], state[key]));
  });
  __momentumRegisteredBindings.forEach(function(entry) {
    if (!Object.prototype.hasOwnProperty.call(state, entry.name)) return;
    try { entry.restorer(state[entry.name]); } catch (error) {}
  });
}
)MOMENTUM_BOOT";

void InstallJsCallback(
  JSContextRef ctx,
  JSObjectRef globalObject,
  const char* name,
  JSObjectCallAsFunctionCallback callback
) {
  JSStringRef functionName = JSStringCreateWithUTF8CString(name);
  JSObjectRef function = JSObjectMakeFunctionWithCallback(ctx, functionName, callback);
  JSObjectSetProperty(
    ctx,
    globalObject,
    functionName,
    function,
    kJSPropertyAttributeNone,
    NULL
  );
  JSStringRelease(functionName);
}

void InstallRuntimeCallbacks(JSContextRef ctx, JSObjectRef globalObject) {
  for (const JsCallbackRegistration& registration : kRuntimeCallbackRegistrations) {
    InstallJsCallback(ctx, globalObject, registration.name, registration.callback);
  }
}

std::string BuildBootstrapSource() {
  std::string source;
  source.reserve(
    sizeof(kBootstrapFoundationScript) +
    std::char_traits<char>::length(GetDataBootstrapScript()) +
    sizeof(kBootstrapP5CompatScript) +
    sizeof(kBootstrapStateCaptureScript) +
    std::char_traits<char>::length(GetIoBootstrapScript()) +
    std::char_traits<char>::length(GetControllerBootstrapScript())
  );
  source.append(kBootstrapFoundationScript);
  source.append(GetDataBootstrapScript());
  source.append(kBootstrapP5CompatScript);
  source.append(kBootstrapStateCaptureScript);
  source.append(GetIoBootstrapScript());
  source.append(GetControllerBootstrapScript());
  return source;
}

void EvaluateBootstrapSource(JSContextRef ctx, const std::string& source) {
  JSStringRef script = JSStringCreateWithUTF8CString(source.c_str());
  JSStringRef sourceURL = JSStringCreateWithUTF8CString("momentum-bootstrap");
  JSValueRef exception = NULL;
  JSEvaluateScript(ctx, script, NULL, sourceURL, 0, &exception);
  JSStringRelease(sourceURL);
  JSStringRelease(script);
  (void)exception;
}

}  // namespace

void SetJsNumber(JSContextRef ctx, JSObjectRef object, const char* name, double value) {
  JSStringRef key = JSStringCreateWithUTF8CString(name);
  JSObjectSetProperty(
    ctx,
    object,
    key,
    JSValueMakeNumber(ctx, value),
    kJSPropertyAttributeNone,
    NULL
  );
  JSStringRelease(key);
}

void InstallRuntimeBootstrap(JSContextRef ctx, JSObjectRef globalObject) {
  InstallRuntimeCallbacks(ctx, globalObject);
  EvaluateBootstrapSource(ctx, BuildBootstrapSource());
}

}  // namespace momentum
