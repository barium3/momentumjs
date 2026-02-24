// =============================================================================
// Math Library - 模块化版本
// =============================================================================
// Processing 风格的数学函数库，用于注入到 After Effects 表达式环境。
// 支持按需加载：Noise、Random、Vector 等子库仅在依赖时注入。
// =============================================================================

// -----------------------------------------------------------------------------
// Perlin Noise 库
// -----------------------------------------------------------------------------
// 兼容 Processing API：noise() 返回 [0,1]，支持 noiseSeed()、noiseDetail(lod, falloff)

/**
 * 获取 Perlin Noise 库源码
 * @returns {string} 可注入的 Perlin Noise 代码
 */
function getNoiseLib() {
  return [
    "// Perlin Noise (Processing-style: 0..1, noiseSeed, noiseDetail)",
    "var PERLIN_SIZE = 512;",
    "var PERLIN = null;",
    "var _noiseSeed = null;",
    "var _noiseLod = 4;",
    "var _noiseFalloff = 0.5;",
    "var _seededRandom = function(seed) {",
    "  return function() {",
    "    seed = (seed * 1103515245 + 12345) & 0x7fffffff;",
    "    return seed / 0x7fffffff;",
    "  };",
    "};",
    "var perlin_init = function() {",
    "  if (PERLIN === null) {",
    "    PERLIN = [];",
    "    var rng = _noiseSeed !== null ? _seededRandom(_noiseSeed) : Math.random;",
    "    for (var i = 0; i < PERLIN_SIZE; i++) PERLIN[i] = rng();",
    "  }",
    "};",
    "var fade = function(t) { return t * t * t * (t * (t * 6 - 15) + 10); };",
    "var _noiseLerp = function(a, b, t) { return a + t * (b - a); };",
    "var _noiseGrad = function(hash, x, y, z) {",
    "  var h = Math.floor(hash) & 15;",
    "  var u = h < 8 ? x : y;",
    "  var v = h < 4 ? y : (h === 12 || h === 14 ? x : z);",
    "  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);",
    "};",
    "var _rawNoise = function(x, y, z) {",
    "  perlin_init();",
    "  var v;",
    "  if (y === undefined) {",
    "    var X = Math.floor(x) & 255;",
    "    x -= Math.floor(x);",
    "    v = _noiseLerp(PERLIN[X % PERLIN_SIZE], PERLIN[(X + 1) % PERLIN_SIZE], fade(x));",
    "    return v;",
    "  }",
    "  if (z === undefined) {",
    "    var X = Math.floor(x) & 255, Y = Math.floor(y) & 255;",
    "    x -= Math.floor(x); y -= Math.floor(y);",
    "    var u = fade(x), vf = fade(y);",
    "    var A = (PERLIN[X] + Y) % PERLIN_SIZE, B = (PERLIN[X + 1] + Y) % PERLIN_SIZE;",
    "    v = _noiseLerp(",
    "      _noiseLerp(_noiseGrad(PERLIN[A], x, y, 0), _noiseGrad(PERLIN[B], x - 1, y, 0), u),",
    "      _noiseLerp(_noiseGrad(PERLIN[(A + 1) % PERLIN_SIZE], x, y - 1, 0), _noiseGrad(PERLIN[(B + 1) % PERLIN_SIZE], x - 1, y - 1, 0), u), vf);",
    "    return (v + 1) * 0.5;",
    "  }",
    "  var X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;",
    "  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);",
    "  var u = fade(x), vf = fade(y), w = fade(z);",
    "  var A = (PERLIN[X] + Y) % PERLIN_SIZE, B = (PERLIN[X + 1] + Y) % PERLIN_SIZE;",
    "  var AA = (PERLIN[A] + Z) % PERLIN_SIZE, AB = (PERLIN[A + 1] + Z) % PERLIN_SIZE;",
    "  var BA = (PERLIN[B] + Z) % PERLIN_SIZE, BB = (PERLIN[B + 1] + Z) % PERLIN_SIZE;",
    "  v = _noiseLerp(",
    "    _noiseLerp(_noiseLerp(_noiseGrad(PERLIN[AA], x, y, z), _noiseGrad(PERLIN[BA], x - 1, y, z), u),",
    "      _noiseLerp(_noiseGrad(PERLIN[AB], x, y - 1, z), _noiseGrad(PERLIN[BB], x - 1, y - 1, z), u), vf),",
    "    _noiseLerp(_noiseLerp(_noiseGrad(PERLIN[AA + 1], x, y, z - 1), _noiseGrad(PERLIN[BA + 1], x - 1, y, z - 1), u),",
    "      _noiseLerp(_noiseGrad(PERLIN[AB + 1], x, y - 1, z - 1), _noiseGrad(PERLIN[BB + 1], x - 1, y - 1, z - 1), u), vf), w);",
    "  return (v + 1) * 0.5;",
    "};",
    "var noiseDetail = function(lod, falloff) {",
    "  _noiseLod = lod !== undefined ? lod : 4;",
    "  _noiseFalloff = falloff !== undefined ? falloff : 0.5;",
    "};",
    "var noiseSeed = function(seed) {",
    "  _noiseSeed = seed;",
    "  PERLIN = null;",
    "};",
    "var noise = function(x, y, z) {",
    "  var sum = 0, amp = 1, f = 1, norm = 0;",
    "  for (var i = 0; i < _noiseLod; i++) {",
    "    sum += amp * _rawNoise(x * f, y !== undefined ? y * f : undefined, z !== undefined ? z * f : undefined);",
    "    norm += amp;",
    "    amp *= _noiseFalloff;",
    "    f *= 2;",
    "  }",
    "  return norm > 0 ? sum / norm : 0;",
    "};",
  ].join("\n");
}

// -----------------------------------------------------------------------------
// Random 库
// -----------------------------------------------------------------------------
// random / randomGaussian / randomSeed 共用同一库
// 兼容 Processing：random() 支持 [0,1]、区间、数组；randomGaussian(mean, sd)；randomSeed(seed) 可复现

/**
 * 获取 Random 库源码
 * @returns {string} 可注入的 Random 代码
 */
function getRandomLib() {
  return [
    "// Random (Processing-style: randomSeed, randomGaussian, random with array)",
    "var _randomSeededRng = function(seed) {",
    "  return function() {",
    "    seed = (seed * 1103515245 + 12345) & 0x7fffffff;",
    "    return seed / 0x7fffffff;",
    "  };",
    "};",
    "var _randomRng = Math.random;",
    "var randomSeed = function(seed) {",
    "  _randomRng = _randomSeededRng(seed);",
    "};",
    "var random = function(a, b) {",
    "  var r = _randomRng();",
    "  if (a === undefined) return r;",
    "  if (typeof a === 'number' && b === undefined) return r * a;",
    "  if (typeof a === 'number' && typeof b === 'number') return a + r * (b - a);",
    "  if (a && typeof a.length === 'number') return a[Math.floor(r * a.length)];",
    "  return a + r * (b - a);",
    "};",
    "var randomGaussian = function(mean, sd) {",
    "  var u1 = 1 - _randomRng();",
    "  if (u1 <= 0) u1 = 1e-10;",
    "  var u2 = _randomRng();",
    "  var z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);",
    "  if (mean === undefined) mean = 0;",
    "  if (sd === undefined) sd = 1;",
    "  return mean + z * sd;",
    "};",
  ].join("\n");
}

// -----------------------------------------------------------------------------
// Vector 库（p5.js 风格）
// -----------------------------------------------------------------------------
// 使用 p5.Vector 命名空间，完全兼容 p5.js API

/**
 * 获取 Vector 库源码
 * @returns {string} 可注入的 p5.Vector 代码
 */
function getVectorLib() {
  return [
    "// p5 namespace with Vector class (p5.js style)",
    "var p5 = p5 || {};",
    "",
    "// p5.Vector 构造函数",
    "p5.Vector = function(x, y, z) {",
    "  this.x = x || 0;",
    "  this.y = y || 0;",
    "  this.z = z || 0;",
    "};",
    "",
    "// 设置向量分量",
    "p5.Vector.prototype.set = function(x, y, z) {",
    "  if (x instanceof p5.Vector) {",
    "    this.x = x.x; this.y = x.y; this.z = x.z;",
    "  } else if (x instanceof Array) {",
    "    this.x = x[0] || 0; this.y = x[1] || 0; this.z = x[2] || 0;",
    "  } else {",
    "    this.x = x || 0; this.y = y || 0; this.z = z || 0;",
    "  }",
    "  return this;",
    "};",
    "",
    "// 复制向量",
    "p5.Vector.prototype.copy = function() {",
    "  return new p5.Vector(this.x, this.y, this.z);",
    "};",
    "",
    "// 向量加法",
    "p5.Vector.prototype.add = function(x, y, z) {",
    "  if (x instanceof p5.Vector) {",
    "    this.x += x.x; this.y += x.y; this.z += x.z;",
    "  } else if (x instanceof Array) {",
    "    this.x += x[0] || 0; this.y += x[1] || 0; this.z += x[2] || 0;",
    "  } else {",
    "    this.x += x || 0; this.y += y || 0; this.z += z || 0;",
    "  }",
    "  return this;",
    "};",
    "",
    "// 向量减法",
    "p5.Vector.prototype.sub = function(x, y, z) {",
    "  if (x instanceof p5.Vector) {",
    "    this.x -= x.x; this.y -= x.y; this.z -= x.z;",
    "  } else if (x instanceof Array) {",
    "    this.x -= x[0] || 0; this.y -= x[1] || 0; this.z -= x[2] || 0;",
    "  } else {",
    "    this.x -= x || 0; this.y -= y || 0; this.z -= z || 0;",
    "  }",
    "  return this;",
    "};",
    "",
    "// 向量乘法（标量或分量）",
    "p5.Vector.prototype.mult = function(x, y, z) {",
    "  if (x instanceof p5.Vector) {",
    "    this.x *= x.x; this.y *= x.y; this.z *= x.z;",
    "  } else if (x instanceof Array) {",
    "    this.x *= x[0] || 1; this.y *= x[1] || 1; this.z *= x[2] || 1;",
    "  } else if (y === undefined) {",
    "    this.x *= x; this.y *= x; this.z *= x;",
    "  } else {",
    "    this.x *= x || 1; this.y *= y || 1; this.z *= z || 1;",
    "  }",
    "  return this;",
    "};",
    "",
    "// 向量除法（标量或分量）",
    "p5.Vector.prototype.div = function(x, y, z) {",
    "  if (x instanceof p5.Vector) {",
    "    if (x.x !== 0) this.x /= x.x;",
    "    if (x.y !== 0) this.y /= x.y;",
    "    if (x.z !== 0) this.z /= x.z;",
    "  } else if (x instanceof Array) {",
    "    if (x[0] !== 0) this.x /= x[0];",
    "    if (x[1] !== 0) this.y /= x[1];",
    "    if (x[2] !== 0) this.z /= x[2];",
    "  } else if (y === undefined) {",
    "    if (x !== 0) { this.x /= x; this.y /= x; this.z /= x; }",
    "  } else {",
    "    if (x !== 0) this.x /= x;",
    "    if (y !== 0) this.y /= y;",
    "    if (z !== 0) this.z /= z;",
    "  }",
    "  return this;",
    "};",
    "",
    "// 取余运算",
    "p5.Vector.prototype.rem = function(x, y, z) {",
    "  if (x instanceof p5.Vector) {",
    "    if (x.x !== 0) this.x = this.x % x.x;",
    "    if (x.y !== 0) this.y = this.y % x.y;",
    "    if (x.z !== 0) this.z = this.z % x.z;",
    "  } else if (x instanceof Array) {",
    "    if (x[0] !== 0) this.x = this.x % x[0];",
    "    if (x[1] !== 0) this.y = this.y % x[1];",
    "    if (x[2] !== 0) this.z = this.z % x[2];",
    "  } else if (y === undefined) {",
    "    if (x !== 0) { this.x = this.x % x; this.y = this.y % x; this.z = this.z % x; }",
    "  } else {",
    "    if (x !== 0) this.x = this.x % x;",
    "    if (y !== 0) this.y = this.y % y;",
    "    if (z !== 0) this.z = this.z % z;",
    "  }",
    "  return this;",
    "};",
    "",
    "// 向量长度（模）",
    "p5.Vector.prototype.mag = function() {",
    "  return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);",
    "};",
    "",
    "// 向量长度平方",
    "p5.Vector.prototype.magSq = function() {",
    "  return this.x * this.x + this.y * this.y + this.z * this.z;",
    "};",
    "",
    "// 点积",
    "p5.Vector.prototype.dot = function(x, y, z) {",
    "  if (x instanceof p5.Vector) {",
    "    return this.x * x.x + this.y * x.y + this.z * x.z;",
    "  }",
    "  return this.x * (x || 0) + this.y * (y || 0) + this.z * (z || 0);",
    "};",
    "",
    "// 叉积（返回新向量）",
    "p5.Vector.prototype.cross = function(v) {",
    "  var cx = this.y * v.z - this.z * v.y;",
    "  var cy = this.z * v.x - this.x * v.z;",
    "  var cz = this.x * v.y - this.y * v.x;",
    "  return new p5.Vector(cx, cy, cz);",
    "};",
    "",
    "// 两点距离",
    "p5.Vector.prototype.dist = function(v) {",
    "  var dx = v.x - this.x;",
    "  var dy = v.y - this.y;",
    "  var dz = v.z - this.z;",
    "  return Math.sqrt(dx * dx + dy * dy + dz * dz);",
    "};",
    "",
    "// 归一化（单位向量）",
    "p5.Vector.prototype.normalize = function() {",
    "  var len = this.mag();",
    "  if (len > 0) this.mult(1 / len);",
    "  return this;",
    "};",
    "",
    "// 限制长度",
    "p5.Vector.prototype.limit = function(max) {",
    "  var mSq = this.magSq();",
    "  if (mSq > max * max) {",
    "    this.div(Math.sqrt(mSq)).mult(max);",
    "  }",
    "  return this;",
    "};",
    "",
    "// 设置长度",
    "p5.Vector.prototype.setMag = function(len) {",
    "  return this.normalize().mult(len);",
    "};",
    "",
    "// 2D 向量角度（相对于正 x 轴）",
    "p5.Vector.prototype.heading = function() {",
    "  return Math.atan2(this.y, this.x);",
    "};",
    "",
    "// 设置 2D 向量角度",
    "p5.Vector.prototype.setHeading = function(angle) {",
    "  var m = this.mag();",
    "  this.x = m * Math.cos(angle);",
    "  this.y = m * Math.sin(angle);",
    "  return this;",
    "};",
    "",
    "// 旋转 2D 向量",
    "p5.Vector.prototype.rotate = function(angle) {",
    "  var newHeading = this.heading() + angle;",
    "  var m = this.mag();",
    "  this.x = m * Math.cos(newHeading);",
    "  this.y = m * Math.sin(newHeading);",
    "  return this;",
    "};",
    "",
    "// 两向量夹角",
    "p5.Vector.prototype.angleBetween = function(v) {",
    "  var dot = this.dot(v);",
    "  var m1 = this.mag();",
    "  var m2 = v.mag();",
    "  if (m1 === 0 || m2 === 0) return 0;",
    "  var cosAngle = dot / (m1 * m2);",
    "  cosAngle = Math.max(-1, Math.min(1, cosAngle));",
    "  return Math.acos(cosAngle);",
    "};",
    "",
    "// 线性插值",
    "p5.Vector.prototype.lerp = function(x, y, z, amt) {",
    "  if (x instanceof p5.Vector) {",
    "    amt = y;",
    "    this.x += (x.x - this.x) * amt;",
    "    this.y += (x.y - this.y) * amt;",
    "    this.z += (x.z - this.z) * amt;",
    "  } else {",
    "    this.x += (x - this.x) * amt;",
    "    this.y += (y - this.y) * amt;",
    "    this.z += (z - this.z) * amt;",
    "  }",
    "  return this;",
    "};",
    "",
    "// 球面线性插值",
    "p5.Vector.prototype.slerp = function(v, amt) {",
    "  var omega = this.angleBetween(v);",
    "  if (omega === 0 || isNaN(omega)) {",
    "    return this.copy();",
    "  }",
    "  var sinOmega = Math.sin(omega);",
    "  var a = Math.sin((1 - amt) * omega) / sinOmega;",
    "  var b = Math.sin(amt * omega) / sinOmega;",
    "  this.x = this.x * a + v.x * b;",
    "  this.y = this.y * a + v.y * b;",
    "  this.z = this.z * a + v.z * b;",
    "  return this;",
    "};",
    "",
    "// 反射",
    "p5.Vector.prototype.reflect = function(surfaceNormal) {",
    "  var n = surfaceNormal.copy().normalize();",
    "  var d = this.dot(n) * 2;",
    "  this.x -= n.x * d;",
    "  this.y -= n.y * d;",
    "  this.z -= n.z * d;",
    "  return this;",
    "};",
    "",
    "// 转数组",
    "p5.Vector.prototype.array = function() {",
    "  return [this.x, this.y, this.z];",
    "};",
    "",
    "// 判断相等",
    "p5.Vector.prototype.equals = function(x, y, z) {",
    "  if (x instanceof p5.Vector) {",
    "    return this.x === x.x && this.y === x.y && this.z === x.z;",
    "  } else if (x instanceof Array) {",
    "    return this.x === (x[0] || 0) && this.y === (x[1] || 0) && this.z === (x[2] || 0);",
    "  }",
    "  return this.x === (x || 0) && this.y === (y || 0) && this.z === (z || 0);",
    "};",
    "",
    "// 近零归零（消除浮点误差）",
    "p5.Vector.prototype.clampToZero = function(epsilon) {",
    "  epsilon = epsilon || 1e-10;",
    "  if (Math.abs(this.x) < epsilon) this.x = 0;",
    "  if (Math.abs(this.y) < epsilon) this.y = 0;",
    "  if (Math.abs(this.z) < epsilon) this.z = 0;",
    "  return this;",
    "};",
    "",
    "// 转字符串",
    "p5.Vector.prototype.toString = function() {",
    "  return 'p5.Vector(' + this.x + ', ' + this.y + ', ' + this.z + ')';",
    "};",
    "",
    "// === 静态方法 ===",
    "",
    "// 静态加法",
    "p5.Vector.add = function(v1, v2, target) {",
    "  if (!target) target = new p5.Vector();",
    "  target.x = v1.x + v2.x;",
    "  target.y = v1.y + v2.y;",
    "  target.z = v1.z + v2.z;",
    "  return target;",
    "};",
    "",
    "// 静态减法",
    "p5.Vector.sub = function(v1, v2, target) {",
    "  if (!target) target = new p5.Vector();",
    "  target.x = v1.x - v2.x;",
    "  target.y = v1.y - v2.y;",
    "  target.z = v1.z - v2.z;",
    "  return target;",
    "};",
    "",
    "// 静态乘法",
    "p5.Vector.mult = function(v, n, target) {",
    "  if (!target) target = new p5.Vector();",
    "  if (typeof n === 'number') {",
    "    target.x = v.x * n;",
    "    target.y = v.y * n;",
    "    target.z = v.z * n;",
    "  } else {",
    "    target.x = v.x * n.x;",
    "    target.y = v.y * n.y;",
    "    target.z = v.z * n.z;",
    "  }",
    "  return target;",
    "};",
    "",
    "// 静态除法",
    "p5.Vector.div = function(v, n, target) {",
    "  if (!target) target = new p5.Vector();",
    "  if (typeof n === 'number') {",
    "    if (n !== 0) {",
    "      target.x = v.x / n;",
    "      target.y = v.y / n;",
    "      target.z = v.z / n;",
    "    }",
    "  } else {",
    "    if (n.x !== 0) target.x = v.x / n.x;",
    "    if (n.y !== 0) target.y = v.y / n.y;",
    "    if (n.z !== 0) target.z = v.z / n.z;",
    "  }",
    "  return target;",
    "};",
    "",
    "// 静态点积",
    "p5.Vector.dot = function(v1, v2) {",
    "  return v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;",
    "};",
    "",
    "// 静态叉积",
    "p5.Vector.cross = function(v1, v2, target) {",
    "  var cx = v1.y * v2.z - v1.z * v2.y;",
    "  var cy = v1.z * v2.x - v1.x * v2.z;",
    "  var cz = v1.x * v2.y - v1.y * v2.x;",
    "  if (!target) target = new p5.Vector(cx, cy, cz);",
    "  else { target.x = cx; target.y = cy; target.z = cz; }",
    "  return target;",
    "};",
    "",
    "// 静态距离",
    "p5.Vector.dist = function(v1, v2) {",
    "  var dx = v2.x - v1.x;",
    "  var dy = v2.y - v1.y;",
    "  var dz = v2.z - v1.z;",
    "  return Math.sqrt(dx * dx + dy * dy + dz * dz);",
    "};",
    "",
    "// 静态线性插值",
    "p5.Vector.lerp = function(v1, v2, amt, target) {",
    "  if (!target) target = new p5.Vector();",
    "  target.x = v1.x + (v2.x - v1.x) * amt;",
    "  target.y = v1.y + (v2.y - v1.y) * amt;",
    "  target.z = v1.z + (v2.z - v1.z) * amt;",
    "  return target;",
    "};",
    "",
    "// 静态夹角",
    "p5.Vector.angleBetween = function(v1, v2) {",
    "  var dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;",
    "  var m1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);",
    "  var m2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);",
    "  if (m1 === 0 || m2 === 0) return 0;",
    "  var cosAngle = dot / (m1 * m2);",
    "  cosAngle = Math.max(-1, Math.min(1, cosAngle));",
    "  return Math.acos(cosAngle);",
    "};",
    "",
    "// 静态长度",
    "p5.Vector.mag = function(v) {",
    "  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);",
    "};",
    "",
    "// 静态归一化",
    "p5.Vector.normalize = function(v, target) {",
    "  if (!target) target = new p5.Vector();",
    "  var len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);",
    "  if (len > 0) {",
    "    target.x = v.x / len;",
    "    target.y = v.y / len;",
    "    target.z = v.z / len;",
    "  }",
    "  return target;",
    "};",
    "",
    "// 从角度创建 2D 向量",
    "p5.Vector.fromAngle = function(angle, length) {",
    "  if (length === undefined) length = 1;",
    "  return new p5.Vector(length * Math.cos(angle), length * Math.sin(angle), 0);",
    "};",
    "",
    "// 从 ISO 球面角创建 3D 向量",
    "p5.Vector.fromAngles = function(theta, phi, length) {",
    "  if (length === undefined) length = 1;",
    "  var sinPhi = Math.sin(phi);",
    "  return new p5.Vector(",
    "    length * sinPhi * Math.sin(theta),",
    "    length * Math.cos(phi),",
    "    length * sinPhi * Math.cos(theta)",
    "  );",
    "};",
    "",
    "// 随机 2D 单位向量",
    "p5.Vector.random2D = function() {",
    "  // 使用 random() 而不是 Math.random()，以便受 randomSeed() 控制",
    "  var angle = (typeof random === 'function' ? random : Math.random)() * Math.PI * 2;",
    "  return new p5.Vector(Math.cos(angle), Math.sin(angle), 0);",
    "};",
    "",
    "// 随机 3D 单位向量",
    "p5.Vector.random3D = function() {",
    "  // 使用 random() 而不是 Math.random()，以便受 randomSeed() 控制",
    "  var rng = typeof random === 'function' ? random : Math.random;",
    "  var theta = rng() * Math.PI * 2;",
    "  var phi = Math.acos(2 * rng() - 1);",
    "  var sinPhi = Math.sin(phi);",
    "  return new p5.Vector(sinPhi * Math.cos(theta), sinPhi * Math.sin(theta), Math.cos(phi));",
    "};",
    "",
    "// 静态反射",
    "p5.Vector.reflect = function(incidentVector, surfaceNormal, target) {",
    "  if (!target) target = incidentVector.copy();",
    "  else target.set(incidentVector);",
    "  return target.reflect(surfaceNormal);",
    "};",
    "",
    "// 静态球面插值",
    "p5.Vector.slerp = function(v1, v2, amt, target) {",
    "  if (!target) target = v1.copy();",
    "  else target.set(v1);",
    "  return target.slerp(v2, amt);",
    "};",
    "",
    "// 创建向量函数（p5.js 风格）",
    "var createVector = function(x, y, z) {",
    "  return new p5.Vector(x, y, z);",
    "};",
  ].join("\n");
}

// -----------------------------------------------------------------------------
// 主数学库（按依赖动态构建）
// -----------------------------------------------------------------------------

/**
 * 根据依赖动态构建数学库，仅注入被使用的函数
 * @param {Object} deps - 依赖对象，键为函数名，值为 true 表示需要
 * @returns {string} 可注入的数学库代码
 * @example { PI: true, sin: true, random: true, noise: true }
 */
function getMathLib(deps) {
  if (!deps) deps = {};
  var lines = [];
  var hasAny = false;

  for (var key in deps) {
    if (deps.hasOwnProperty(key) && deps[key]) {
      hasAny = true;
      break;
    }
  }
  if (!hasAny) return "";

  lines.push("// Math Functions");

  // --- 常量 ---
  if (deps.PI) lines.push("const PI = Math.PI;");
  if (deps.TWO_PI) lines.push("const TWO_PI = Math.PI * 2;");
  if (deps.HALF_PI) lines.push("const HALF_PI = Math.PI / 2;");
  if (deps.QUARTER_PI) lines.push("const QUARTER_PI = Math.PI / 4;");

  // 椭圆/矩形模式常量与状态（与 p5.ellipseMode / rectMode 对齐）
  // 只有在依赖中出现任意一个相关项时才注入
  if (
    deps.ellipseMode ||
    deps.rectMode ||
    deps.CENTER ||
    deps.RADIUS ||
    deps.CORNER ||
    deps.CORNERS
  ) {
    lines.push("const CENTER = 0;");
    lines.push("const RADIUS = 1;");
    lines.push("const CORNER = 2;");
    lines.push("const CORNERS = 3;");
    // 默认值与 p5 对齐：
    // - ellipseMode 默认为 CENTER
    // - rectMode 默认为 CORNER
    lines.push("var _ellipseMode = CENTER;");
    lines.push("var _rectMode = CORNER;");
    lines.push("var ellipseMode = function(m) { _ellipseMode = m; };");
    lines.push("var rectMode = function(m) { _rectMode = m; };");
  }

  // --- 三角函数与角度 ---
  if (deps.sin) lines.push("var sin = Math.sin;");
  if (deps.cos) lines.push("var cos = Math.cos;");
  if (deps.tan) lines.push("var tan = Math.tan;");
  if (deps.asin) lines.push("var asin = Math.asin;");
  if (deps.acos) lines.push("var acos = Math.acos;");
  if (deps.atan) lines.push("var atan = Math.atan;");
  if (deps.atan2) lines.push("var atan2 = Math.atan2;");
  if (deps.degrees) {
    lines.push("var degrees = function(rad) { return rad * 180 / Math.PI; };");
  }
  if (deps.radians) {
    lines.push("var radians = function(deg) { return deg * Math.PI / 180; };");
  }
  if (deps.angleMode) {
    lines.push(
      "var DEGREES = 'DEG', RADIANS = 'RAD';",
      "var _angleMode = 'RAD';",
      "var angleMode = function(m) { _angleMode = m; };",
    );
  }

  // --- 基础运算 ---
  if (deps.sqrt) lines.push("var sqrt = Math.sqrt;");
  if (deps.pow) lines.push("var pow = Math.pow;");
  if (deps.abs) lines.push("var abs = Math.abs;");
  if (deps.floor) lines.push("var floor = Math.floor;");
  if (deps.ceil) lines.push("var ceil = Math.ceil;");
  if (deps.round) lines.push("var round = Math.round;");
  if (deps.min) lines.push("var min = Math.min;");
  if (deps.max) lines.push("var max = Math.max;");
  if (deps.exp) lines.push("var exp = Math.exp;");
  if (deps.log) lines.push("var log = Math.log;");
  if (deps.sq) {
    lines.push("var sq = function(n) { return n * n; };");
  }
  if (deps.fract) {
    lines.push("var fract = function(n) { return n - Math.floor(n); };");
  }
  if (deps.norm) {
    lines.push("var norm = function(v, a, b) { return (v - a) / (b - a); };");
  }
  if (deps.mag) {
    lines.push(
      "var mag = function(x, y, z) {",
      "  if (z !== undefined) return Math.sqrt(x*x + y*y + z*z);",
      "  return Math.sqrt(x*x + y*y);",
      "};",
    );
  }

  // --- 随机与映射 ---
  if (deps.random || deps.randomGaussian || deps.randomSeed) {
    lines.push(getRandomLib());
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

  // --- 噪声（noise / noiseDetail / noiseSeed 共用）---
  if (deps.noise || deps.noiseDetail || deps.noiseSeed) {
    lines.push(getNoiseLib());
  }

  // --- 曲线计算函数 ---
  if (deps.bezierPoint) {
    lines.push(
      "var bezierPoint = function(a, b, c, d, t) {",
      "  var it = 1 - t;",
      "  return it*it*it*a + 3*it*it*t*b + 3*it*t*t*c + t*t*t*d;",
      "};",
    );
  }
  if (deps.bezierTangent) {
    lines.push(
      "var bezierTangent = function(a, b, c, d, t) {",
      "  var it = 1 - t;",
      "  return 3*it*it*(b-a) + 6*it*t*(c-b) + 3*t*t*(d-c);",
      "};",
    );
  }
  // curvePoint, curveTangent, curveTightness 共享 _curveTightness 变量
  // curve 函数也需要 _curveTightness 变量（通过 _curveTightnessVar 标记）
  if (deps.curvePoint || deps.curveTangent || deps.curveTightness || deps._curveTightnessVar) {
    lines.push("var _curveTightness = 0.5;");
  }
  if (deps.curvePoint) {
    lines.push(
      "var curvePoint = function(a, b, c, d, t) {",
      "  // 带张力的 Cardinal Spline 样条曲线公式（p5.js 兼容）",
      "  // 参数映射：a=P0(第一个控制点), b=P1(起点), c=P2(终点), d=P3(最后一个控制点)",
      "  // 张力参数 s = _curveTightness，范围 [-2, 3]，默认 0.5（产生平滑曲线）",
      "  var s = _curveTightness !== undefined ? _curveTightness : 0.5;",
      "  var t2 = t * t;",
      "  var t3 = t2 * t;",
      "  // Cardinal Spline 公式：P(t) = (2*t³-3*t²+1)*P1 + (t³-2*t²+t)*s*(P2-P0) + (-2*t³+3*t²)*P2 + (t³-t²)*s*(P3-P1)",
      "  var h1 = 2*t3 - 3*t2 + 1;",
      "  var h2 = t3 - 2*t2 + t;",
      "  var h3 = -2*t3 + 3*t2;",
      "  var h4 = t3 - t2;",
      "  return h1*b + h2*s*(c-a) + h3*c + h4*s*(d-b);",
      "};",
    );
  }
  if (deps.curveTangent) {
    lines.push(
      "var curveTangent = function(a, b, c, d, t) {",
      "  // 带张力的 Cardinal Spline 样条曲线切线（导数）",
      "  // 参数映射：a=P0(第一个控制点), b=P1(起点), c=P2(终点), d=P3(最后一个控制点)",
      "  // 张力参数 s = _curveTightness，范围 [-2, 3]，默认 0.5（产生平滑曲线）",
      "  var s = _curveTightness !== undefined ? _curveTightness : 0.5;",
      "  var t2 = t * t;",
      "  // P'(t) = (6*t²-6*t)*P1 + (3*t²-4*t+1)*s*(P2-P0) + (-6*t²+6*t)*P2 + (3*t²-2*t)*s*(P3-P1)",
      "  var dh1 = 6*t2 - 6*t;",
      "  var dh2 = 3*t2 - 4*t + 1;",
      "  var dh3 = -6*t2 + 6*t;",
      "  var dh4 = 3*t2 - 2*t;",
      "  return dh1*b + dh2*s*(c-a) + dh3*c + dh4*s*(d-b);",
      "};",
    );
  }
  if (deps.curveTightness) {
    lines.push(
      "var curveTightness = function(s) {",
      "  if (s !== undefined) {",
      "    // 限制张力参数范围到 [-2, 3]，避免变形过于夸张",
      "    _curveTightness = Math.max(-2, Math.min(3, s));",
      "  }",
      "  return _curveTightness;",
      "};",
    );
  }

  // --- 向量（p5 / createVector 共用）---
  if (deps.p5 || deps.createVector) {
    lines.push(getVectorLib());
  }

  return lines.join("\n");
}
