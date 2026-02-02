// ----------------------------------------
// Math Library - 模块化版本
// Processing 风格的数学函数库（用于注入到 AE 表达式）
// ----------------------------------------

/**
 * 获取核心常量（始终需要）
 */
function getMathCoreLib() {
  return [
    "// Processing Constants",
    "var PI = Math.PI;",
    "var TWO_PI = Math.PI * 2;",
    "var HALF_PI = Math.PI / 2;",
    "var QUARTER_PI = Math.PI / 4;",
  ].join("\n");
}

/**
 * 获取基础数学函数（sin, cos, tan, sqrt, pow, abs, floor, ceil, round, min, max）
 */
function getMathBasicLib() {
  return [
    "// Basic Math Functions",
    "var cos = Math.cos;",
    "var sin = Math.sin;",
    "var tan = Math.tan;",
    "var sqrt = Math.sqrt;",
    "var pow = Math.pow;",
    "var abs = Math.abs;",
    "var floor = Math.floor;",
    "var ceil = Math.ceil;",
    "var round = Math.round;",
    "var min = Math.min;",
    "var max = Math.max;",
  ].join("\n");
}

/**
 * 获取扩展数学函数（random, map, constrain, lerp, dist）
 */
function getMathExtendedLib() {
  return [
    "// Extended Math Functions",
    "var random = function(a, b) { if (b === undefined) { b = a; a = 0; } return a + Math.random() * (b - a); };",
    "var map = function(v, a, b, c, d) { return c + (v - a) / (b - a) * (d - c); };",
    "var constrain = function(v, lo, hi) { return Math.min(Math.max(v, lo), hi); };",
    "var lerp = function(a, b, t) { return a + (b - a) * t; };",
    "var dist = function(x1, y1, x2, y2) { return Math.sqrt((x2-x1)*(x2-x1) + (y2-y1)*(y2-y1)); };",
  ].join("\n");
}

/**
 * 获取 Perlin Noise 库（可选，需要时才加载）
 */
function getNoiseLib() {
  return [
    "// Perlin Noise",
    "var PERLIN_SIZE = 4096;",
    "var PERLIN = null;",
    "var perlin_init = function() {",
    "  if (PERLIN == null) {",
    "    PERLIN = [];",
    "    for (var i = 0; i < PERLIN_SIZE; i++) PERLIN[i] = Math.random();",
    "  }",
    "};",
    "var fade = function(t) { return t * t * t * (t * (t * 6 - 15) + 10); };",
    "var lerp = function(a, b, t) { return a + t * (b - a); };",
    "var grad = function(hash, x, y, z) {",
    "  var h = Math.floor(hash) & 15;",
    "  var u = h < 8 ? x : y;",
    "  var v = h < 4 ? y : (h === 12 || h === 14 ? x : z);",
    "  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);",
    "};",
    "var noise = function(x, y, z) {",
    "  perlin_init();",
    "  if (y === undefined) {",
    "    var X = Math.floor(x) & 255;",
    "    x -= Math.floor(x);",
    "    var u = fade(x);",
    "    return lerp(PERLIN[X], PERLIN[X + 1], u) * 2 - 1;",
    "  } else if (z === undefined) {",
    "    var X = Math.floor(x) & 255, Y = Math.floor(y) & 255;",
    "    x -= Math.floor(x); y -= Math.floor(y);",
    "    var u = fade(x), v = fade(y);",
    "    var A = PERLIN[X] + Y, AA = PERLIN[A], AB = PERLIN[A + 1];",
    "    var B = PERLIN[X + 1] + Y, BA = PERLIN[B], BB = PERLIN[B + 1];",
    "    return lerp(lerp(grad(PERLIN[AA], x, y, 0), grad(PERLIN[BA], x - 1, y, 0), u),",
    "                lerp(grad(PERLIN[AB], x, y - 1, 0), grad(PERLIN[BB], x - 1, y - 1, 0), u), v);",
    "  } else {",
    "    var X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;",
    "    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);",
    "    var u = fade(x), v = fade(y), w = fade(z);",
    "    var A = PERLIN[X] + Y, AA = PERLIN[A] + Z, AB = PERLIN[A + 1] + Z;",
    "    var B = PERLIN[X + 1] + Y, BA = PERLIN[B] + Z, BB = PERLIN[B + 1] + Z;",
    "    return lerp(lerp(lerp(grad(PERLIN[AA], x, y, z), grad(PERLIN[BA], x - 1, y, z), u),",
    "                lerp(grad(PERLIN[AB], x, y - 1, z), grad(PERLIN[BB], x - 1, y - 1, z), u), v),",
    "                lerp(lerp(grad(PERLIN[AA + 1], x, y, z - 1), grad(PERLIN[BA + 1], x - 1, y, z - 1), u),",
    "                lerp(grad(PERLIN[AB + 1], x, y - 1, z - 1), grad(PERLIN[BB + 1], x - 1, y - 1, z - 1), u), v), w);",
    "  }",
    "};",
  ].join("\n");
}

/**
 * 获取数学库（根据依赖动态构建，每个函数单独控制）
 * @param {Object} deps - 依赖对象，每个键对应一个函数名
 * 例如: { PI: true, sin: true, cos: true, random: true, noise: true }
 */
function getMathLib(deps) {
  if (!deps) deps = {};
  var lines = [];
  var hasAny = false;

  // 检查是否有任何数学函数被使用
  for (var key in deps) {
    if (deps.hasOwnProperty(key) && deps[key]) {
      hasAny = true;
      break;
    }
  }

  if (!hasAny) return "";

  lines.push("// Math Functions");

  // 常量
  if (deps.PI) lines.push("const PI = Math.PI;");
  if (deps.TWO_PI) lines.push("const TWO_PI = Math.PI * 2;");
  if (deps.HALF_PI) lines.push("const HALF_PI = Math.PI / 2;");
  if (deps.QUARTER_PI) lines.push("const QUARTER_PI = Math.PI / 4;");

  // 基础数学函数
  if (deps.sin) lines.push("var sin = Math.sin;");
  if (deps.cos) lines.push("var cos = Math.cos;");
  if (deps.tan) lines.push("var tan = Math.tan;");
  if (deps.sqrt) lines.push("var sqrt = Math.sqrt;");
  if (deps.pow) lines.push("var pow = Math.pow;");
  if (deps.abs) lines.push("var abs = Math.abs;");
  if (deps.floor) lines.push("var floor = Math.floor;");
  if (deps.ceil) lines.push("var ceil = Math.ceil;");
  if (deps.round) lines.push("var round = Math.round;");
  if (deps.min) lines.push("var min = Math.min;");
  if (deps.max) lines.push("var max = Math.max;");

  // 扩展数学函数
  if (deps.random) {
    lines.push(
      "var random = function(a, b) { if (b === undefined) { b = a; a = 0; } return a + Math.random() * (b - a); };",
    );
  }
  if (deps.map) {
    lines.push(
      "var map = function(v, a, b, c, d) { return c + (v - a) / (b - a) * (d - c); };",
    );
  }
  if (deps.constrain) {
    lines.push(
      "var constrain = function(v, lo, hi) { return Math.min(Math.max(v, lo), hi); };",
    );
  }
  if (deps.lerp) {
    lines.push("var lerp = function(a, b, t) { return a + (b - a) * t; };");
  }
  if (deps.dist) {
    lines.push(
      "var dist = function(x1, y1, x2, y2) { return Math.sqrt((x2-x1)*(x2-x1) + (y2-y1)*(y2-y1)); };",
    );
  }

  // 噪声函数（需要包含辅助函数）
  if (deps.noise) {
    lines.push(getNoiseLib());
  }

  return lines.join("\n");
}
