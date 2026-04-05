// Momentum function registry


var functionRegistry = {};

var CATEGORY_NAMES = [
  "shapes",
  "transforms",
  "colors",
  "typography",
  "math",
  "controllers",
  "data",
  "images",
  "tables",
  "environment",
];

function signature(minArgs, maxArgs, returns) {
  var info = {
    minArgs: minArgs,
    maxArgs: maxArgs,
  };

  if (typeof returns === "string") {
    info.returns = returns;
  }

  return info;
}

function assignObject(target) {
  var out = target || {};

  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i];
    if (!source) continue;

    for (var key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        out[key] = source[key];
      }
    }
  }

  return out;
}

function objectKeys(source) {
  var keys = [];
  if (!source) return keys;

  for (var key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      keys.push(key);
    }
  }

  return keys;
}

function entry(internal, options) {
  return assignObject({ internal: internal }, options || {});
}

function constant(internal, options) {
  return entry(internal, assignObject({ type: "constant" }, options || {}));
}

function variable(internal, options) {
  return entry(internal, assignObject({ type: "variable" }, options || {}));
}

function namespace(internal, options) {
  return entry(internal, assignObject({ type: "namespace" }, options || {}));
}

function instanceMethod(internal, receiver, options) {
  return entry(
    internal,
    assignObject(
      {
        type: "instance_method",
        receiver: receiver,
      },
      options || {},
    ),
  );
}

var COLOR_VALUE_SIGNATURES = [
  signature(1, 1),
  signature(2, 2),
  signature(3, 3),
  signature(4, 4),
];

functionRegistry.shapes = {
  ellipse: entry("_ellipse", {
    baseType: "ellipse",
    modes: ["CENTER", "RADIUS", "CORNER", "CORNERS"],
    signatures: [signature(3, 4)],
  }),
  circle: entry("_ellipse", {
    baseType: "ellipse",
    signatures: [signature(3, 3)],
  }),
  triangle: entry("_triangle", {
    baseType: "triangle",
    signatures: [signature(6, 6)],
  }),
  quad: entry("_quad", {
    baseType: "quad",
    signatures: [signature(8, 8)],
  }),
  arc: entry("_arc", {
    baseType: "arc",
    modes: ["OPEN", "CHORD", "PIE"],
    signatures: [signature(6, 7)],
  }),
  rect: entry("_rect", {
    baseType: "rect",
    modes: ["CENTER", "RADIUS", "CORNER", "CORNERS"],
    signatures: [signature(3, 8)],
  }),
  square: entry("_rect", {
    baseType: "rect",
    signatures: [signature(3, 4)],
  }),
  line: entry("_line", {
    baseType: "line",
    signatures: [signature(4, 4)],
  }),
  point: entry("_point", {
    baseType: "point",
    signatures: [
      signature(1, 1),
      signature(2, 2),
    ],
  }),
  background: entry("_background", {
    baseType: "background",
    signatures: COLOR_VALUE_SIGNATURES,
  }),
  beginClip: entry("beginClip", {
    signatures: [
      signature(0, 0),
      signature(1, 1),
    ],
    runtimeModes: ["scene"],
  }),
  clip: entry("clip", {
    signatures: [
      signature(1, 1),
      signature(2, 2),
    ],
    runtimeModes: ["scene"],
  }),
  endClip: entry("endClip", {
    signatures: [signature(0, 0)],
    runtimeModes: ["scene"],
  }),
  text: entry("_text", {
    baseType: "text",
    signatures: [signature(3, 5)],
  }),
  polygon: entry("_polygon", {
    baseType: "polygon",
    closeModes: ["CLOSE"],
    builders: {
      beginShape: { role: "begin" },
      vertex: { role: "add" },
      beginContour: { role: "add" },
      endContour: { role: "add" },
      bezierVertex: { role: "add" },
      quadraticVertex: { role: "add" },
      curveVertex: { role: "add" },
      endShape: { role: "end" },
    },
  }),
  bezier: entry("_bezier", {
    baseType: "bezier",
    signatures: [signature(8, 8)],
  }),
  curve: entry("_curve", {
    baseType: "curve",
    signatures: [signature(8, 8)],
  }),
  image: entry("_image", {
    baseType: "image",
    signatures: [
      signature(3, 3),
      signature(5, 5),
      signature(9, 9),
    ],
  }),
};

functionRegistry.transforms = {
  translate: entry("translate", {
    signatures: [
      signature(1, 1),
      signature(2, 2),
    ],
  }),
  rotate: entry("rotate", {
    signatures: [signature(1, 1)],
  }),
  scale: entry("scale", {
    signatures: [
      signature(1, 1),
      signature(2, 2),
    ],
  }),
  applyMatrix: entry("applyMatrix", {
    signatures: [
      signature(1, 1),
      signature(6, 6),
    ],
  }),
  shearX: entry("shearX", {
    signatures: [signature(1, 1)],
    runtimeModes: ["scene"],
  }),
  shearY: entry("shearY", {
    signatures: [signature(1, 1)],
    runtimeModes: ["scene"],
  }),
  push: entry("push"),
  pop: entry("pop"),
  resetMatrix: entry("resetMatrix"),
};

functionRegistry.colors = {
  fill: entry("fill", {
    signatures: [signature(0, 0)].concat(COLOR_VALUE_SIGNATURES),
  }),
  clear: entry("clear", {
    signatures: [signature(0, 0)],
    runtimeModes: ["scene"],
  }),
  noFill: entry("noFill"),
  stroke: entry("stroke", {
    signatures: [signature(0, 0)].concat(COLOR_VALUE_SIGNATURES),
  }),
  noStroke: entry("noStroke"),
  strokeWeight: entry("strokeWeight", {
    signatures: [signature(1, 1)],
  }),
  strokeCap: entry("strokeCap", {
    signatures: [signature(1, 1)],
    runtimeModes: ["scene"],
  }),
  strokeJoin: entry("strokeJoin", {
    signatures: [signature(1, 1)],
    runtimeModes: ["scene"],
  }),
  blendMode: entry("blendMode", {
    signatures: [signature(1, 1)],
    runtimeModes: ["scene"],
  }),
  erase: entry("erase", {
    signatures: [
      signature(0, 0),
      signature(1, 1),
      signature(2, 2),
    ],
    runtimeModes: ["scene"],
  }),
  noErase: entry("noErase", {
    signatures: [signature(0, 0)],
    runtimeModes: ["scene"],
  }),
  color: entry("color", {
    signatures: COLOR_VALUE_SIGNATURES,
    returns: "Color",
  }),
  lerpColor: entry("lerpColor", {
    signatures: [signature(3, 3, "Color")],
    returns: "Color",
  }),
  colorMode: entry("colorMode", {
    signatures: [
      signature(1, 1),
      signature(2, 2),
      signature(4, 4),
      signature(5, 5),
    ],
  }),
  red: entry("red"),
  green: entry("green"),
  blue: entry("blue"),
  alpha: entry("alpha"),
  hue: entry("hue"),
  saturation: entry("saturation"),
  brightness: entry("brightness"),
  lightness: entry("lightness"),
  RGB: constant("RGB"),
  HSB: constant("HSB"),
  HSL: constant("HSL"),
};

functionRegistry.typography = {
  loadFont: entry("loadFont", {
    signatures: [
      signature(1, 1, "Font"),
      signature(2, 3, "Font"),
    ],
    returns: "Font",
    runtimeModes: ["scene"],
  }),
  textSize: entry("textSize", {
    signatures: [
      signature(0, 0),
      signature(1, 1),
    ],
  }),
  textLeading: entry("textLeading", {
    signatures: [
      signature(0, 0),
      signature(1, 1),
    ],
  }),
  textFont: entry("textFont", {
    signatures: [
      signature(0, 0),
      signature(1, 2),
    ],
  }),
  textStyle: entry("textStyle", {
    signatures: [
      signature(0, 0),
      signature(1, 1),
    ],
  }),
  textWrap: entry("textWrap", {
    signatures: [
      signature(0, 0),
      signature(1, 1),
    ],
  }),
  textAlign: entry("textAlign", {
    signatures: [
      signature(0, 0),
      signature(1, 2),
    ],
  }),
  textWidth: entry("textWidth", {
    signatures: [signature(1, 1)],
    returns: "number",
  }),
  textAscent: entry("textAscent"),
  textDescent: entry("textDescent"),
  WORD: constant("WORD", { valueType: "string" }),
  CHAR: constant("CHAR", { valueType: "string" }),
  NORMAL: constant("NORMAL", { valueType: "string" }),
  BOLD: constant("BOLD", { valueType: "string" }),
  ITALIC: constant("ITALIC", { valueType: "string" }),
  BOLDITALIC: constant("BOLDITALIC", { valueType: "string" }),
};

functionRegistry.math = {
  PI: constant("PI"),
  TWO_PI: constant("TWO_PI"),
  HALF_PI: constant("HALF_PI"),
  QUARTER_PI: constant("QUARTER_PI"),
  OPEN: constant("OPEN"),
  CHORD: constant("CHORD"),
  PIE: constant("PIE"),
  CLOSE: constant("CLOSE", { valueType: "string" }),
  ROUND: constant("ROUND"),
  SQUARE: constant("SQUARE"),
  PROJECT: constant("PROJECT"),
  BLEND: constant("BLEND", { runtimeModes: ["scene"] }),
  ADD: constant("ADD", { runtimeModes: ["scene"] }),
  DARKEST: constant("DARKEST", { runtimeModes: ["scene"] }),
  LIGHTEST: constant("LIGHTEST", { runtimeModes: ["scene"] }),
  DIFFERENCE: constant("DIFFERENCE", { runtimeModes: ["scene"] }),
  EXCLUSION: constant("EXCLUSION", { runtimeModes: ["scene"] }),
  MULTIPLY: constant("MULTIPLY", { runtimeModes: ["scene"] }),
  SCREEN: constant("SCREEN", { runtimeModes: ["scene"] }),
  REPLACE: constant("REPLACE", { runtimeModes: ["scene"] }),
  REMOVE: constant("REMOVE", { runtimeModes: ["scene"] }),
  OVERLAY: constant("OVERLAY", { runtimeModes: ["scene"] }),
  HARD_LIGHT: constant("HARD_LIGHT", { runtimeModes: ["scene"] }),
  SOFT_LIGHT: constant("SOFT_LIGHT", { runtimeModes: ["scene"] }),
  DODGE: constant("DODGE", { runtimeModes: ["scene"] }),
  BURN: constant("BURN", { runtimeModes: ["scene"] }),
  MITER: constant("MITER"),
  BEVEL: constant("BEVEL"),
  CENTER: constant("CENTER"),
  RADIUS: constant("RADIUS"),
  CORNER: constant("CORNER"),
  CORNERS: constant("CORNERS"),
  LEFT: constant("LEFT"),
  RIGHT: constant("RIGHT"),
  TOP: constant("TOP"),
  BOTTOM: constant("BOTTOM"),
  BASELINE: constant("BASELINE"),
  ellipseMode: entry("ellipseMode", {
    signatures: [signature(1, 1)],
  }),
  rectMode: entry("rectMode", {
    signatures: [signature(1, 1)],
  }),
  sin: entry("sin", {
    signatures: [signature(1, 1)],
  }),
  cos: entry("cos", {
    signatures: [signature(1, 1)],
  }),
  tan: entry("tan", {
    signatures: [signature(1, 1)],
  }),
  acos: entry("acos", {
    signatures: [signature(1, 1)],
  }),
  atan: entry("atan", {
    signatures: [signature(1, 1)],
  }),
  atan2: entry("atan2", {
    signatures: [signature(2, 2)],
  }),
  asin: entry("asin", {
    signatures: [signature(1, 1)],
  }),
  degrees: entry("degrees", {
    signatures: [signature(1, 1)],
  }),
  radians: entry("radians", {
    signatures: [signature(1, 1)],
  }),
  angleMode: entry("angleMode", {
    signatures: [
      signature(0, 0),
      signature(1, 1),
    ],
  }),
  sqrt: entry("sqrt", {
    signatures: [signature(1, 1)],
  }),
  pow: entry("pow", {
    signatures: [signature(2, 2)],
  }),
  abs: entry("abs", {
    signatures: [signature(1, 1)],
  }),
  floor: entry("floor", {
    signatures: [signature(1, 1)],
  }),
  ceil: entry("ceil", {
    signatures: [signature(1, 1)],
  }),
  round: entry("round", {
    signatures: [signature(1, 1)],
  }),
  min: entry("min", {
    signatures: [signature(2, Infinity)],
  }),
  max: entry("max", {
    signatures: [signature(2, Infinity)],
  }),
  exp: entry("exp", {
    signatures: [signature(1, 1)],
  }),
  log: entry("log", {
    signatures: [signature(1, 1)],
  }),
  sq: entry("sq", {
    signatures: [signature(1, 1)],
  }),
  fract: entry("fract", {
    signatures: [signature(1, 1)],
  }),
  norm: entry("norm", {
    signatures: [signature(3, 3)],
  }),
  mag: entry("mag", {
    signatures: [
      signature(2, 2),
      signature(3, 3),
    ],
  }),
  random: entry("random", {
    signatures: [
      signature(0, 0),
      signature(1, 1),
      signature(2, 2),
    ],
    returns: "number",
  }),
  randomGaussian: entry("randomGaussian", {
    signatures: [
      signature(0, 0),
      signature(1, 1),
      signature(2, 2),
    ],
    returns: "number",
  }),
  randomSeed: entry("randomSeed", {
    signatures: [signature(1, 1)],
  }),
  map: entry("map", {
    signatures: [signature(5, 5)],
  }),
  constrain: entry("constrain", {
    signatures: [signature(3, 3)],
  }),
  lerp: entry("lerp", {
    signatures: [signature(3, 3)],
  }),
  dist: entry("dist", {
    signatures: [signature(4, 4)],
  }),
  noise: entry("noise", {
    signatures: [signature(1, 3)],
  }),
  noiseDetail: entry("noiseDetail", {
    signatures: [signature(1, 2)],
  }),
  noiseSeed: entry("noiseSeed", {
    signatures: [signature(1, 1)],
  }),
  bezierPoint: entry("bezierPoint"),
  bezierTangent: entry("bezierTangent"),
  curvePoint: entry("curvePoint"),
  curveTangent: entry("curveTangent"),
  curveTightness: entry("curveTightness", {
    signatures: [signature(1, 1)],
  }),
  p5: namespace("p5"),
  createVector: entry("createVector", {
    signatures: [signature(0, 3)],
    returns: "Vector",
  }),
  DEGREES: constant("DEGREES", { valueType: "string" }),
  RADIANS: constant("RADIANS", { valueType: "string" }),
};

functionRegistry.instances = {
  Image: {
    pixelDensity: entry("pixelDensity", {
      signatures: [
        signature(0, 0, "number"),
        signature(1, 1, "Image"),
      ],
      returns: "number",
      runtimeModes: ["bitmap"],
    }),
    loadPixels: entry("loadPixels", {
      signatures: [signature(0, 0)],
      runtimeModes: ["bitmap"],
    }),
    updatePixels: entry("updatePixels", {
      signatures: [
        signature(0, 0),
        signature(4, 4),
      ],
      runtimeModes: ["bitmap"],
    }),
    get: entry("get", {
      signatures: [
        signature(0, 0, "Image"),
        signature(2, 2, "array"),
        signature(4, 4, "Image"),
      ],
      returns: "object",
      runtimeModes: ["bitmap"],
    }),
    set: entry("set", {
      signatures: [signature(3, 3)],
      runtimeModes: ["bitmap"],
    }),
    resize: entry("resize", {
      signatures: [signature(2, 2)],
      runtimeModes: ["bitmap"],
    }),
    mask: entry("mask", {
      signatures: [signature(1, 1)],
      runtimeModes: ["bitmap"],
    }),
    copy: entry("copy", {
      signatures: [
        signature(8, 8),
        signature(9, 9),
      ],
      runtimeModes: ["bitmap"],
    }),
    blend: entry("blend", {
      signatures: [
        signature(9, 9),
        signature(10, 10),
      ],
      runtimeModes: ["bitmap"],
    }),
    filter: entry("filter", {
      signatures: [
        signature(1, 1),
        signature(2, 2),
      ],
      runtimeModes: ["bitmap"],
    }),
  },
  Graphics: {
    pixelDensity: entry("pixelDensity", {
      signatures: [
        signature(0, 0, "number"),
        signature(1, 1, "Graphics"),
      ],
      returns: "number",
      runtimeModes: ["bitmap"],
    }),
    loadPixels: entry("loadPixels", {
      signatures: [signature(0, 0)],
      runtimeModes: ["bitmap"],
    }),
    updatePixels: entry("updatePixels", {
      signatures: [
        signature(0, 0),
        signature(4, 4),
      ],
      runtimeModes: ["bitmap"],
    }),
    get: entry("get", {
      signatures: [
        signature(0, 0, "Image"),
        signature(2, 2, "array"),
        signature(4, 4, "Image"),
      ],
      returns: "object",
      runtimeModes: ["bitmap"],
    }),
    set: entry("set", {
      signatures: [signature(3, 3)],
      runtimeModes: ["bitmap"],
    }),
    resize: entry("resize", {
      signatures: [signature(2, 2)],
      runtimeModes: ["bitmap"],
    }),
    mask: entry("mask", {
      signatures: [signature(1, 1)],
      runtimeModes: ["bitmap"],
    }),
    copy: entry("copy", {
      signatures: [
        signature(8, 8),
        signature(9, 9),
      ],
      runtimeModes: ["bitmap"],
    }),
    blend: entry("blend", {
      signatures: [
        signature(9, 9),
        signature(10, 10),
      ],
      runtimeModes: ["bitmap"],
    }),
    filter: entry("filter", {
      signatures: [
        signature(1, 1),
        signature(2, 2),
      ],
      runtimeModes: ["bitmap"],
    }),
    background: entry("background", {
      signatures: COLOR_VALUE_SIGNATURES,
      runtimeModes: ["bitmap"],
    }),
    clear: entry("clear", {
      signatures: [signature(0, 0)],
      runtimeModes: ["bitmap"],
    }),
    colorMode: entry("colorMode", {
      signatures: [
        signature(1, 5),
      ],
      runtimeModes: ["bitmap"],
    }),
    color: entry("color", {
      signatures: COLOR_VALUE_SIGNATURES,
      returns: "Color",
      runtimeModes: ["bitmap"],
    }),
    fill: entry("fill", {
      signatures: COLOR_VALUE_SIGNATURES,
      runtimeModes: ["bitmap"],
    }),
    stroke: entry("stroke", {
      signatures: COLOR_VALUE_SIGNATURES,
      runtimeModes: ["bitmap"],
    }),
    noFill: entry("noFill", {
      signatures: [signature(0, 0)],
      runtimeModes: ["bitmap"],
    }),
    noStroke: entry("noStroke", {
      signatures: [signature(0, 0)],
      runtimeModes: ["bitmap"],
    }),
    strokeWeight: entry("strokeWeight", {
      signatures: [signature(1, 1)],
      runtimeModes: ["bitmap"],
    }),
    strokeCap: entry("strokeCap", {
      signatures: [signature(1, 1)],
      runtimeModes: ["bitmap"],
    }),
    strokeJoin: entry("strokeJoin", {
      signatures: [signature(1, 1)],
      runtimeModes: ["bitmap"],
    }),
    blendMode: entry("blendMode", {
      signatures: [signature(1, 1)],
      runtimeModes: ["bitmap"],
    }),
    erase: entry("erase", {
      signatures: [
        signature(0, 0),
        signature(1, 2),
      ],
      runtimeModes: ["bitmap"],
    }),
    noErase: entry("noErase", {
      signatures: [signature(0, 0)],
      runtimeModes: ["bitmap"],
    }),
    beginClip: entry("beginClip", {
      signatures: [
        signature(0, 0),
        signature(1, 1),
      ],
      runtimeModes: ["bitmap"],
    }),
    endClip: entry("endClip", {
      signatures: [signature(0, 0)],
      runtimeModes: ["bitmap"],
    }),
    angleMode: entry("angleMode", {
      signatures: [signature(1, 1)],
      runtimeModes: ["bitmap"],
    }),
    applyMatrix: entry("applyMatrix", {
      signatures: [
        signature(1, 1),
        signature(6, 6),
      ],
      runtimeModes: ["bitmap"],
    }),
    resetMatrix: entry("resetMatrix", {
      signatures: [signature(0, 0)],
      runtimeModes: ["bitmap"],
    }),
    text: entry("text", {
      signatures: [signature(3, 5)],
      runtimeModes: ["bitmap"],
    }),
    textSize: entry("textSize", {
      signatures: [
        signature(0, 0, "number"),
        signature(1, 1, "number"),
      ],
      returns: "number",
      runtimeModes: ["bitmap"],
    }),
    textLeading: entry("textLeading", {
      signatures: [
        signature(0, 0, "number"),
        signature(1, 1, "number"),
      ],
      returns: "number",
      runtimeModes: ["bitmap"],
    }),
    textFont: entry("textFont", {
      signatures: [signature(0, 2)],
      runtimeModes: ["bitmap"],
    }),
    textStyle: entry("textStyle", {
      signatures: [
        signature(0, 0),
        signature(1, 1),
      ],
      runtimeModes: ["bitmap"],
    }),
    textWrap: entry("textWrap", {
      signatures: [
        signature(0, 0),
        signature(1, 1),
      ],
      runtimeModes: ["bitmap"],
    }),
    textAlign: entry("textAlign", {
      signatures: [
        signature(1, 2),
      ],
      runtimeModes: ["bitmap"],
    }),
    textWidth: entry("textWidth", {
      signatures: [signature(1, 1, "number")],
      returns: "number",
      runtimeModes: ["bitmap"],
    }),
    textAscent: entry("textAscent", {
      signatures: [signature(0, 0, "number")],
      returns: "number",
      runtimeModes: ["bitmap"],
    }),
    textDescent: entry("textDescent", {
      signatures: [signature(0, 0, "number")],
      returns: "number",
      runtimeModes: ["bitmap"],
    }),
    image: entry("image", {
      signatures: [
        signature(3, 3),
        signature(5, 5),
        signature(9, 9),
      ],
      runtimeModes: ["bitmap"],
    }),
    imageMode: entry("imageMode", {
      signatures: [signature(1, 1)],
      runtimeModes: ["bitmap"],
    }),
    tint: entry("tint", {
      signatures: COLOR_VALUE_SIGNATURES,
      runtimeModes: ["bitmap"],
    }),
    noTint: entry("noTint", {
      signatures: [signature(0, 0)],
      runtimeModes: ["bitmap"],
    }),
    rectMode: entry("rectMode", {
      signatures: [signature(1, 1)],
      runtimeModes: ["bitmap"],
    }),
    ellipseMode: entry("ellipseMode", {
      signatures: [signature(1, 1)],
      runtimeModes: ["bitmap"],
    }),
    rect: entry("rect", {
      signatures: [signature(3, 8)],
      runtimeModes: ["bitmap"],
    }),
    square: entry("square", {
      signatures: [signature(3, 4)],
      runtimeModes: ["bitmap"],
    }),
    ellipse: entry("ellipse", {
      signatures: [signature(3, 4)],
      runtimeModes: ["bitmap"],
    }),
    arc: entry("arc", {
      signatures: [signature(6, 7)],
      runtimeModes: ["bitmap"],
    }),
    circle: entry("circle", {
      signatures: [signature(3, 3)],
      runtimeModes: ["bitmap"],
    }),
    triangle: entry("triangle", {
      signatures: [signature(6, 6)],
      runtimeModes: ["bitmap"],
    }),
    quad: entry("quad", {
      signatures: [signature(8, 8)],
      runtimeModes: ["bitmap"],
    }),
    line: entry("line", {
      signatures: [signature(4, 4)],
      runtimeModes: ["bitmap"],
    }),
    point: entry("point", {
      signatures: [
        signature(1, 1),
        signature(2, 2),
      ],
      runtimeModes: ["bitmap"],
    }),
    push: entry("push", {
      signatures: [signature(0, 0)],
      runtimeModes: ["bitmap"],
    }),
    pop: entry("pop", {
      signatures: [signature(0, 0)],
      runtimeModes: ["bitmap"],
    }),
    translate: entry("translate", {
      signatures: [
        signature(1, 1),
        signature(2, 2),
      ],
      runtimeModes: ["bitmap"],
    }),
    rotate: entry("rotate", {
      signatures: [signature(1, 1)],
      runtimeModes: ["bitmap"],
    }),
    scale: entry("scale", {
      signatures: [
        signature(1, 1),
        signature(2, 2),
      ],
      runtimeModes: ["bitmap"],
    }),
    beginShape: entry("beginShape", {
      signatures: [
        signature(0, 0),
        signature(1, 1),
      ],
      runtimeModes: ["bitmap"],
    }),
    vertex: entry("vertex", {
      signatures: [
        signature(2, 2),
        signature(4, 5),
      ],
      runtimeModes: ["bitmap"],
    }),
    bezierVertex: entry("bezierVertex", {
      signatures: [signature(6, 6)],
      runtimeModes: ["bitmap"],
    }),
    quadraticVertex: entry("quadraticVertex", {
      signatures: [signature(4, 4)],
      runtimeModes: ["bitmap"],
    }),
    curveVertex: entry("curveVertex", {
      signatures: [signature(2, 3)],
      runtimeModes: ["bitmap"],
    }),
    endShape: entry("endShape", {
      signatures: [
        signature(0, 0),
        signature(1, 1),
      ],
      runtimeModes: ["bitmap"],
    }),
    bezier: entry("bezier", {
      signatures: [signature(8, 8)],
      runtimeModes: ["bitmap"],
    }),
    curve: entry("curve", {
      signatures: [signature(8, 8)],
      runtimeModes: ["bitmap"],
    }),
    beginContour: entry("beginContour", {
      signatures: [signature(0, 0)],
      runtimeModes: ["bitmap"],
    }),
    endContour: entry("endContour", {
      signatures: [signature(0, 0)],
      runtimeModes: ["bitmap"],
    }),
    curveTightness: entry("curveTightness", {
      signatures: [signature(1, 1)],
      runtimeModes: ["bitmap"],
    }),
  },
  Font: {
    textBounds: entry("textBounds", {
      signatures: [
        signature(4, 4, "object"),
        signature(5, 5, "object"),
      ],
      returns: "object",
      runtimeModes: ["scene"],
    }),
    textToPoints: entry("textToPoints", {
      signatures: [
        signature(4, 4, "array"),
        signature(5, 5, "array"),
      ],
      returns: "array",
      runtimeModes: ["scene"],
    }),
  },
  Color: {
    setRed: entry("setRed", {
      signatures: [signature(1, 1, "Color")],
      returns: "Color",
    }),
    setGreen: entry("setGreen", {
      signatures: [signature(1, 1, "Color")],
      returns: "Color",
    }),
    setBlue: entry("setBlue", {
      signatures: [signature(1, 1, "Color")],
      returns: "Color",
    }),
    setAlpha: entry("setAlpha", {
      signatures: [signature(1, 1, "Color")],
      returns: "Color",
    }),
    toString: entry("toString", {
      signatures: [
        signature(0, 0, "string"),
        signature(1, 1, "string"),
      ],
      returns: "string",
    }),
  },
  Vector: {
    set: entry("set", {
      signatures: [
        signature(1, 1, "Vector"),
        signature(2, 3, "Vector"),
      ],
      returns: "Vector",
    }),
    copy: entry("copy", {
      signatures: [signature(0, 0, "Vector")],
      returns: "Vector",
    }),
    add: entry("add", {
      signatures: [
        signature(1, 1, "Vector"),
        signature(2, 3, "Vector"),
      ],
      returns: "Vector",
    }),
    sub: entry("sub", {
      signatures: [
        signature(1, 1, "Vector"),
        signature(2, 3, "Vector"),
      ],
      returns: "Vector",
    }),
    mult: entry("mult", {
      signatures: [signature(1, 1, "Vector")],
      returns: "Vector",
    }),
    div: entry("div", {
      signatures: [signature(1, 1, "Vector")],
      returns: "Vector",
    }),
    magSq: entry("magSq", {
      signatures: [signature(0, 0, "number")],
      returns: "number",
    }),
    mag: entry("mag", {
      signatures: [signature(0, 0, "number")],
      returns: "number",
    }),
    dot: entry("dot", {
      signatures: [
        signature(1, 1, "number"),
        signature(2, 3, "number"),
      ],
      returns: "number",
    }),
    cross: entry("cross", {
      signatures: [signature(1, 1, "Vector")],
      returns: "Vector",
    }),
    dist: entry("dist", {
      signatures: [signature(1, 1, "number")],
      returns: "number",
    }),
    normalize: entry("normalize", {
      signatures: [signature(0, 0, "Vector")],
      returns: "Vector",
    }),
    limit: entry("limit", {
      signatures: [signature(1, 1, "Vector")],
      returns: "Vector",
    }),
    setMag: entry("setMag", {
      signatures: [signature(1, 1, "Vector")],
      returns: "Vector",
    }),
    heading: entry("heading", {
      signatures: [signature(0, 0, "number")],
      returns: "number",
    }),
    setHeading: entry("setHeading", {
      signatures: [signature(1, 1, "Vector")],
      returns: "Vector",
    }),
    rotate: entry("rotate", {
      signatures: [signature(1, 1, "Vector")],
      returns: "Vector",
    }),
    lerp: entry("lerp", {
      signatures: [
        signature(2, 2, "Vector"),
        signature(4, 4, "Vector"),
      ],
      returns: "Vector",
    }),
    angleBetween: entry("angleBetween", {
      signatures: [signature(1, 1, "number")],
      returns: "number",
    }),
    array: entry("array", {
      signatures: [signature(0, 0, "array")],
      returns: "array",
    }),
    equals: entry("equals", {
      signatures: [
        signature(1, 1, "boolean"),
        signature(2, 3, "boolean"),
      ],
      returns: "boolean",
    }),
    toString: entry("toString", {
      signatures: [signature(0, 0, "string")],
      returns: "string",
    }),
  },
};

functionRegistry.controllers = {
  createSlider: entry("createSlider", {
    signatures: [signature(0, 4)],
    returns: "SliderController",
  }),
  createAngle: entry("createAngle", {
    signatures: [signature(0, 1)],
    returns: "AngleController",
  }),
  createColorPicker: entry("createColorPicker", {
    signatures: [
      signature(0, 0),
      signature(1, 1),
      signature(3, 4),
    ],
    returns: "ColorController",
  }),
  createCheckbox: entry("createCheckbox", {
    signatures: [
      signature(0, 0),
      signature(1, 1),
      signature(2, 2),
    ],
    returns: "CheckboxController",
  }),
  createSelect: entry("createSelect", {
    signatures: [signature(0, 0)],
    returns: "SelectController",
  }),
  createPoint: entry("createPoint", {
    signatures: [signature(0, 2)],
    returns: "PointController",
  }),
};

assignObject(functionRegistry.instances, {
  SliderController: {
    value: entry("value", {
      signatures: [signature(0, 0, "number")],
      returns: "number",
    }),
  },
  AngleController: {
    degrees: entry("degrees", {
      signatures: [signature(0, 0, "number")],
      returns: "number",
    }),
    radians: entry("radians", {
      signatures: [signature(0, 0, "number")],
      returns: "number",
    }),
    value: entry("value", {
      signatures: [signature(0, 0, "number")],
      returns: "number",
    }),
  },
  ColorController: {
    color: entry("color", {
      signatures: [signature(0, 0, "Color")],
      returns: "Color",
    }),
    value: entry("value", {
      signatures: [signature(0, 0, "string")],
      returns: "string",
    }),
  },
  CheckboxController: {
    checked: entry("checked", {
      signatures: [signature(0, 0, "boolean")],
      returns: "boolean",
    }),
    value: entry("value", {
      signatures: [signature(0, 0, "boolean")],
      returns: "boolean",
    }),
  },
  SelectController: {
    index: entry("index", {
      signatures: [signature(0, 0, "number")],
      returns: "number",
    }),
    option: entry("option", {
      signatures: [signature(1, 2, "SelectController")],
      returns: "SelectController",
    }),
    selected: entry("selected", {
      signatures: [
        signature(0, 0, "value"),
        signature(1, 1, "SelectController"),
      ],
    }),
    value: entry("value", {
      signatures: [signature(0, 0, "value")],
      returns: "value",
    }),
  },
  PointController: {
    value: entry("value", {
      signatures: [signature(0, 0, "array")],
      returns: "array",
    }),
    x: entry("x", {
      signatures: [signature(0, 0, "number")],
      returns: "number",
    }),
    y: entry("y", {
      signatures: [signature(0, 0, "number")],
      returns: "number",
    }),
  },
});


functionRegistry.data = {
  append: entry("append"),
  arrayCopy: entry("arrayCopy"),
  "boolean": entry("_data_boolean"),
  "byte": entry("_data_byte"),
  "char": entry("_data_char"),
  concat: entry("concat"),
  "float": entry("_data_float", { returns: "number" }),
  "hex": entry("_data_hex"),
  "int": entry("_data_int", {
    signatures: [signature(1, 2)],
    returns: "number",
  }),
  join: entry("join"),
  match: entry("match"),
  matchAll: entry("matchAll"),
  nf: entry("nf", {
    signatures: [signature(1, 3)],
  }),
  nfc: entry("nfc", {
    signatures: [signature(1, 2)],
  }),
  nfp: entry("nfp", {
    signatures: [signature(1, 3)],
  }),
  nfs: entry("nfs", {
    signatures: [signature(1, 3)],
  }),
  print: entry("print"),
  reverse: entry("reverse"),
  shorten: entry("shorten"),
  split: entry("split"),
  splitTokens: entry("splitTokens"),
  str: entry("str"),
  shuffle: entry("shuffle"),
  sort: entry("sort"),
  splice: entry("splice"),
  subset: entry("subset"),
  trim: entry("trim"),
  unchar: entry("_data_unchar"),
  unhex: entry("_data_unhex"),
};

functionRegistry.images = {
  loadImage: entry("loadImage", {
    signatures: [signature(1, 3)],
    returns: "Image",
  }),
  createGraphics: entry("createGraphics", {
    signatures: [signature(2, 2)],
    returns: "Graphics",
    runtimeModes: ["bitmap"],
  }),
  createImage: entry("createImage", {
    signatures: [signature(2, 2)],
    returns: "Image",
    runtimeModes: ["bitmap"],
  }),
  pixelDensity: entry("pixelDensity", {
    signatures: [
      signature(0, 0, "number"),
      signature(1, 1, "number"),
    ],
    returns: "number",
    runtimeModes: ["bitmap"],
  }),
  imageMode: entry("imageMode", {
    signatures: [signature(1, 1)],
  }),
  loadPixels: entry("loadPixels", {
    signatures: [signature(0, 0)],
    runtimeModes: ["bitmap"],
  }),
  updatePixels: entry("updatePixels", {
    signatures: [
      signature(0, 0),
      signature(4, 4),
    ],
    runtimeModes: ["bitmap"],
  }),
  get: entry("get", {
    signatures: [
      signature(0, 0, "Image"),
      signature(2, 2, "array"),
      signature(4, 4, "Image"),
    ],
    returns: "object",
    runtimeModes: ["bitmap"],
  }),
  set: entry("set", {
    signatures: [signature(3, 3)],
    runtimeModes: ["bitmap"],
  }),
  copy: entry("copy", {
    signatures: [
      signature(8, 8),
      signature(9, 9),
    ],
    runtimeModes: ["bitmap"],
  }),
  blend: entry("blend", {
    signatures: [
      signature(9, 9),
      signature(10, 10),
    ],
    runtimeModes: ["bitmap"],
  }),
  filter: entry("filter", {
    signatures: [
      signature(1, 1),
      signature(2, 2),
    ],
    runtimeModes: ["bitmap"],
  }),
  pixels: variable("pixels", {
    valueType: "array",
    runtimeModes: ["bitmap"],
  }),
  tint: entry("tint", { signatures: COLOR_VALUE_SIGNATURES }),
  noTint: entry("noTint"),
  CORNER: constant("CORNER", { valueType: "number" }),
  CORNERS: constant("CORNERS", { valueType: "number" }),
  CENTER: constant("CENTER", { valueType: "number" }),
  THRESHOLD: constant("THRESHOLD", { valueType: "string", runtimeModes: ["bitmap"] }),
  GRAY: constant("GRAY", { valueType: "string", runtimeModes: ["bitmap"] }),
  OPAQUE: constant("OPAQUE", { valueType: "string", runtimeModes: ["bitmap"] }),
  INVERT: constant("INVERT", { valueType: "string", runtimeModes: ["bitmap"] }),
  POSTERIZE: constant("POSTERIZE", { valueType: "string", runtimeModes: ["bitmap"] }),
  BLUR: constant("BLUR", { valueType: "string", runtimeModes: ["bitmap"] }),
  ERODE: constant("ERODE", { valueType: "string", runtimeModes: ["bitmap"] }),
  DILATE: constant("DILATE", { valueType: "string", runtimeModes: ["bitmap"] }),
};

functionRegistry.tables = {
  loadTable: entry("loadTable", {
    signatures: [signature(1, Infinity)],
    returns: "Table",
  }),
  loadJSON: entry("loadJSON", {
    signatures: [signature(1, Infinity)],
    returns: "object",
  }),
  loadStrings: entry("loadStrings", {
    signatures: [signature(1, Infinity)],
    returns: "array",
    runtimeModes: ["bitmap"],
  }),
  loadBytes: entry("loadBytes", {
    signatures: [signature(1, Infinity)],
    returns: "object",
    runtimeModes: ["bitmap"],
  }),
  loadXML: entry("loadXML", {
    signatures: [signature(1, Infinity)],
    returns: "XML",
    runtimeModes: ["bitmap"],
  }),
  getParent: instanceMethod("getParent", "XML", {
    returns: "XML",
    signatures: [signature(0, 0, "XML")],
  }),
  getName: instanceMethod("getName", "XML", {
    returns: "string",
    signatures: [signature(0, 0, "string")],
  }),
  setName: instanceMethod("setName", "XML", {
    returns: "value",
    signatures: [signature(1, 1, "value")],
  }),
  hasChildren: instanceMethod("hasChildren", "XML", {
    returns: "boolean",
    signatures: [signature(0, 0, "boolean")],
  }),
  listChildren: instanceMethod("listChildren", "XML", {
    returns: "array",
    signatures: [signature(0, 0, "array")],
  }),
  getChildren: instanceMethod("getChildren", "XML", {
    returns: "array",
    signatures: [
      signature(0, 0, "array"),
      signature(1, 1, "array"),
    ],
  }),
  getChild: instanceMethod("getChild", "XML", {
    returns: "XML",
    signatures: [signature(1, 1, "XML")],
  }),
  getContent: instanceMethod("getContent", "XML", {
    returns: "string",
    signatures: [signature(0, 0, "string")],
  }),
  setContent: instanceMethod("setContent", "XML", {
    returns: "value",
    signatures: [signature(1, 1, "value")],
  }),
  listAttributes: instanceMethod("listAttributes", "XML", {
    returns: "array",
    signatures: [signature(0, 0, "array")],
  }),
  hasAttribute: instanceMethod("hasAttribute", "XML", {
    returns: "boolean",
    signatures: [signature(1, 1, "boolean")],
  }),
  getAttributeCount: instanceMethod("getAttributeCount", "XML", {
    returns: "number",
    signatures: [signature(0, 0, "number")],
  }),
  getStringAttr: instanceMethod("getString", "XML", {
    alias: "getString",
    returns: "string",
    signatures: [
      signature(1, 1, "string"),
      signature(2, 2, "string"),
    ],
  }),
  getNumAttr: instanceMethod("getNum", "XML", {
    alias: "getNum",
    returns: "number",
    signatures: [
      signature(1, 1, "number"),
      signature(2, 2, "number"),
    ],
  }),
  setAttribute: instanceMethod("setAttribute", "XML", {
    returns: "value",
    signatures: [signature(2, 2, "value")],
  }),
  removeAttribute: instanceMethod("removeAttribute", "XML", {
    returns: "value",
    signatures: [signature(1, 1, "value")],
  }),
  serialize: instanceMethod("serialize", "XML", {
    returns: "string",
    signatures: [signature(0, 0, "string")],
  }),
  getRowCount: instanceMethod("getRowCount", "Table", {
    returns: "number",
    signatures: [signature(0, 0, "number")],
  }),
  getColumnCount: instanceMethod("getColumnCount", "Table", {
    returns: "number",
    signatures: [signature(0, 0, "number")],
  }),
  get: instanceMethod("get", "Table", {
    returns: "value",
    signatures: [signature(2, 2, "value")],
  }),
  getRow: instanceMethod("getRow", "Table", {
    returns: "TableRow",
    signatures: [signature(1, 1, "TableRow")],
  }),
  getString: instanceMethod("getString", "Table", {
    returns: "string",
    signatures: [signature(2, 2, "string")],
  }),
  getNum: instanceMethod("getNum", "Table", {
    returns: "number",
    signatures: [signature(2, 2, "number")],
  }),
  getColumn: instanceMethod("getColumn", "Table", {
    returns: "array",
    signatures: [signature(1, 1, "array")],
  }),
  getObject: instanceMethod("getObject", "Table", {
    returns: "object",
    signatures: [signature(0, 1, "object")],
  }),
  getArray: instanceMethod("getArray", "Table", {
    returns: "array",
    signatures: [signature(0, 0, "array")],
  }),
  findRow: instanceMethod("findRow", "Table", {
    returns: "TableRow",
    signatures: [signature(2, 2, "TableRow")],
  }),
  findRows: instanceMethod("findRows", "Table", {
    returns: "TableRowArray",
    signatures: [signature(2, 2, "array")],
  }),
  matchRow: instanceMethod("matchRow", "Table", {
    returns: "TableRow",
    signatures: [signature(2, 2, "TableRow")],
  }),
  matchRows: instanceMethod("matchRows", "Table", {
    returns: "TableRowArray",
    signatures: [signature(2, 2, "array")],
  }),
  set: instanceMethod("set", "Table", {
    returns: "value",
    signatures: [signature(3, 3, "value")],
  }),
  setString: instanceMethod("setString", "Table", {
    returns: "string",
    signatures: [signature(3, 3, "string")],
  }),
  setNum: instanceMethod("setNum", "Table", {
    returns: "number",
    signatures: [signature(3, 3, "number")],
  }),
  addRow: instanceMethod("addRow", "Table", {
    returns: "TableRow",
    signatures: [signature(0, 0, "TableRow")],
  }),
  removeRow: instanceMethod("removeRow", "Table", {
    returns: "Table",
    signatures: [signature(1, 1, "Table")],
  }),
  clearRows: instanceMethod("clearRows", "Table", {
    returns: "Table",
    signatures: [signature(0, 0, "Table")],
  }),
  addColumn: instanceMethod("addColumn", "Table", {
    returns: "string",
    signatures: [signature(1, 1, "string")],
  }),
  removeColumn: instanceMethod("removeColumn", "Table", {
    returns: "Table",
    signatures: [signature(1, 1, "Table")],
  }),
  arr: instanceMethod("arr", "TableRow", {
    returns: "array",
    signatures: [signature(0, 0, "array")],
  }),
  obj: instanceMethod("obj", "TableRow", {
    returns: "object",
    signatures: [signature(0, 0, "object")],
  }),
  rowGet: instanceMethod("get", "TableRow", {
    alias: "get",
    returns: "value",
    signatures: [signature(1, 1, "value")],
  }),
  rowGetString: instanceMethod("getString", "TableRow", {
    alias: "getString",
    returns: "string",
    signatures: [signature(1, 1, "string")],
  }),
  rowGetNum: instanceMethod("getNum", "TableRow", {
    alias: "getNum",
    returns: "number",
    signatures: [signature(1, 1, "number")],
  }),
  rowSet: instanceMethod("set", "TableRow", {
    alias: "set",
    returns: "value",
    signatures: [signature(2, 2, "value")],
  }),
  rowSetString: instanceMethod("setString", "TableRow", {
    alias: "setString",
    returns: "string",
    signatures: [signature(2, 2, "string")],
  }),
  rowSetNum: instanceMethod("setNum", "TableRow", {
    alias: "setNum",
    returns: "number",
    signatures: [signature(2, 2, "number")],
  }),
};

functionRegistry.environment = {
  createCanvas: entry("createCanvas", {
    signatures: [signature(2, 2)],
  }),
  frameRate: entry("frameRate", {
    signatures: [signature(1, 1)],
  }),
  duration: entry("duration", {
    signatures: [
      signature(1, 1),
      signature(1, 4),
    ],
  }),
  isLooping: entry("isLooping"),
  loop: entry("loop"),
  noLoop: entry("noLoop"),
  redraw: entry("redraw"),
  frameCount: variable("frameCount"),
  width: constant("width"),
  height: constant("height"),
};

// polygonBuilders 旧定义已废弃，相关信息已完全整合到 shapes.polygon.builders。

functionRegistry.getShapeNames = function () {
  return objectKeys(this.shapes);
};

functionRegistry.getShapeInfo = function (name) {
  return this.shapes[name] || null;
};

functionRegistry.getRenderFunctions = function () {
  return objectKeys(this.shapes);
};

functionRegistry.getP5Functions = function () {
  var result = [];
  appendCallableNames(result, this.transforms);
  appendCallableNames(result, this.colors);
  appendCallableNames(result, this.math);
  appendCallableNames(result, this.environment);
  appendCallableNames(result, this.typography);
  appendCallableNames(result, this.controllers);
  appendCallableNames(result, this.data);
  appendCallableNames(result, this.images);
  appendCallableNames(result, this.tables);
  if (this.shapes) {
    for (var shapeName in this.shapes) {
      if (!Object.prototype.hasOwnProperty.call(this.shapes, shapeName)) continue;
      var shapeInfo = this.shapes[shapeName];
      if (shapeInfo.builders) {
        result.push.apply(result, objectKeys(shapeInfo.builders));
      }
    }
  }

  return result;
};

function appendCallableNames(target, category) {
  if (!category) return;

  for (var name in category) {
    if (!Object.prototype.hasOwnProperty.call(category, name)) continue;
    var item = category[name] || {};
    if (
      item.type === "constant" ||
      item.type === "variable" ||
      item.type === "namespace" ||
      item.type === "instance_method"
    ) {
      continue;
    }
    target.push(name);
  }
}

functionRegistry.getTableInstanceMethods = function () {
  var result = {};
  if (!this.tables) return result;

  for (var name in this.tables) {
    if (!Object.prototype.hasOwnProperty.call(this.tables, name)) continue;
    var info = this.tables[name];
    if (!info || info.type !== "instance_method") continue;

    var methodName = info.alias || name;
    if (!result[methodName]) {
      result[methodName] = [];
    }

    result[methodName].push({
      receiver: info.receiver,
      returns: info.returns || null,
      internal: info.internal || methodName,
      signatures: info.signatures || null,
    });
  }

  return result;
};

functionRegistry.getFunctionEntry = function (name) {
  if (!name) return null;

  for (var i = 0; i < CATEGORY_NAMES.length; i++) {
    var category = this[CATEGORY_NAMES[i]];
    if (!category) continue;
    if (!Object.prototype.hasOwnProperty.call(category, name)) continue;
    if (category[name] && category[name].type !== "instance_method") {
      return category[name];
    }
  }

  return null;
};

functionRegistry.getFunctionSignatures = function (name) {
  var info = this.getFunctionEntry(name);
  return info && info.signatures ? info.signatures : null;
};

functionRegistry.getFunctionReturnType = function (name) {
  var info = this.getFunctionEntry(name);
  return info && info.returns ? info.returns : null;
};

functionRegistry.getMethodEntry = function (receiverType, methodName) {
  if (!receiverType || !methodName) return null;

  if (this.instances && this.instances[receiverType]) {
    var instanceEntry = this.instances[receiverType][methodName];
    if (instanceEntry) {
      return instanceEntry;
    }
  }

  if (!this.tables) {
    return null;
  }

  for (var name in this.tables) {
    if (!Object.prototype.hasOwnProperty.call(this.tables, name)) continue;
    var entryInfo = this.tables[name];
    if (!entryInfo || entryInfo.type !== "instance_method") continue;
    if (entryInfo.receiver !== receiverType) continue;
    if ((entryInfo.alias || name) === methodName) {
      return entryInfo;
    }
  }

  return null;
};

functionRegistry.getMethodSignatures = function (receiverType, methodName) {
  var info = this.getMethodEntry(receiverType, methodName);
  return info && info.signatures ? info.signatures : null;
};

functionRegistry.getMethodReturnType = function (receiverType, methodName) {
  var info = this.getMethodEntry(receiverType, methodName);
  if (!info) return null;
  if (info.returns) return info.returns;

  var signatures = info.signatures || [];
  for (var i = 0; i < signatures.length; i++) {
    if (signatures[i] && signatures[i].returns) {
      return signatures[i].returns;
    }
  }

  return null;
};

functionRegistry.getShapeBuilders = function (shapeName) {
  if (!this.shapes || !this.shapes[shapeName]) {
    return null;
  }
  return this.shapes[shapeName].builders || null;
};

functionRegistry.getBuilderInfo = function (funcName) {
  if (!this.shapes) {
    return null;
  }

  for (var shapeName in this.shapes) {
    if (!Object.prototype.hasOwnProperty.call(this.shapes, shapeName)) continue;
    var shapeInfo = this.shapes[shapeName];
    if (shapeInfo.builders && shapeInfo.builders[funcName]) {
      return {
        shapeName: shapeName,
        role: shapeInfo.builders[funcName].role,
        baseType: shapeInfo.baseType || shapeName,
      };
    }
  }

  return null;
};

functionRegistry.getAllFunctions = function () {
  return this.getRenderFunctions().concat(this.getP5Functions());
};

functionRegistry.getItemsByType = function (category, types) {
  var result = [];
  if (!category) return result;

  for (var name in category) {
    if (!Object.prototype.hasOwnProperty.call(category, name)) continue;
    if (category[name].type && types.indexOf(category[name].type) !== -1) {
      result.push(name);
    }
  }

  return result;
};

functionRegistry.getAllVariables = function () {
  var result = [];
  var types = ["variable", "constant"];

  result.push.apply(result, this.getItemsByType(this.environment, types));
  result.push.apply(result, this.getItemsByType(this.math, types));
  result.push.apply(result, this.getItemsByType(this.transforms, types));
  result.push.apply(result, this.getItemsByType(this.colors, types));
  result.push.apply(result, this.getItemsByType(this.typography, types));

  return result;
};

if (typeof window !== "undefined") {
  window.functionRegistry = functionRegistry;
}

if (typeof $ !== "undefined" && $.global) {
  $.global.functionRegistry = functionRegistry;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = functionRegistry;
}
