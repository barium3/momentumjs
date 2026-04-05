// Math helpers.

// Noise runtime.
function getNoiseLib() {
  return [
    "// ===== Noise Runtime =====",
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
    "};"
  ].join("\n");
}

// Random runtime.
function getRandomLib() {
  return [
    "// ===== Random Runtime =====",
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
    "};"
  ].join("\n");
}

// Vector runtime.
function getVectorLib() {
  return [
    "// ===== Vector Runtime =====",
    "var p5 = p5 || {};",
    "",
    "p5.Vector = function(x, y, z) {",
    "  this.x = x || 0;",
    "  this.y = y || 0;",
    "  this.z = z || 0;",
    "};",
    "",
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
    "p5.Vector.prototype.copy = function() {",
    "  return new p5.Vector(this.x, this.y, this.z);",
    "};",
    "",
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
    "p5.Vector.prototype.mag = function() {",
    "  return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);",
    "};",
    "",
    "p5.Vector.prototype.magSq = function() {",
    "  return this.x * this.x + this.y * this.y + this.z * this.z;",
    "};",
    "",
    "p5.Vector.prototype.dot = function(x, y, z) {",
    "  if (x instanceof p5.Vector) {",
    "    return this.x * x.x + this.y * x.y + this.z * x.z;",
    "  }",
    "  return this.x * (x || 0) + this.y * (y || 0) + this.z * (z || 0);",
    "};",
    "",
    "p5.Vector.prototype.cross = function(v) {",
    "  var cx = this.y * v.z - this.z * v.y;",
    "  var cy = this.z * v.x - this.x * v.z;",
    "  var cz = this.x * v.y - this.y * v.x;",
    "  return new p5.Vector(cx, cy, cz);",
    "};",
    "",
    "p5.Vector.prototype.dist = function(v) {",
    "  var dx = v.x - this.x;",
    "  var dy = v.y - this.y;",
    "  var dz = v.z - this.z;",
    "  return Math.sqrt(dx * dx + dy * dy + dz * dz);",
    "};",
    "",
    "p5.Vector.prototype.normalize = function() {",
    "  var len = this.mag();",
    "  if (len > 0) this.mult(1 / len);",
    "  return this;",
    "};",
    "",
    "p5.Vector.prototype.limit = function(max) {",
    "  var mSq = this.magSq();",
    "  if (mSq > max * max) {",
    "    this.div(Math.sqrt(mSq)).mult(max);",
    "  }",
    "  return this;",
    "};",
    "",
    "p5.Vector.prototype.setMag = function(len) {",
    "  return this.normalize().mult(len);",
    "};",
    "",
    "p5.Vector.prototype.heading = function() {",
    "  return _fromAngleRadians(Math.atan2(this.y, this.x));",
    "};",
    "",
    "p5.Vector.prototype.setHeading = function(angle) {",
    "  var m = this.mag();",
    "  var rad = _toAngleRadians(angle);",
    "  this.x = m * Math.cos(rad);",
    "  this.y = m * Math.sin(rad);",
    "  return this;",
    "};",
    "",
    "p5.Vector.prototype.rotate = function(angle) {",
    "  var newHeading = _toAngleRadians(this.heading()) + _toAngleRadians(angle);",
    "  var m = this.mag();",
    "  this.x = m * Math.cos(newHeading);",
    "  this.y = m * Math.sin(newHeading);",
    "  return this;",
    "};",
    "",
    "p5.Vector.prototype.angleBetween = function(v) {",
    "  var dot = this.dot(v);",
    "  var m1 = this.mag();",
    "  var m2 = v.mag();",
    "  if (m1 === 0 || m2 === 0) return 0;",
    "  var cosAngle = dot / (m1 * m2);",
    "  cosAngle = Math.max(-1, Math.min(1, cosAngle));",
    "  return _fromAngleRadians(Math.acos(cosAngle));",
    "};",
    "",
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
    "p5.Vector.prototype.reflect = function(surfaceNormal) {",
    "  var n = surfaceNormal.copy().normalize();",
    "  var d = this.dot(n) * 2;",
    "  this.x -= n.x * d;",
    "  this.y -= n.y * d;",
    "  this.z -= n.z * d;",
    "  return this;",
    "};",
    "",
    "p5.Vector.prototype.array = function() {",
    "  return [this.x, this.y, this.z];",
    "};",
    "",
    "p5.Vector.prototype.equals = function(x, y, z) {",
    "  if (x instanceof p5.Vector) {",
    "    return this.x === x.x && this.y === x.y && this.z === x.z;",
    "  } else if (x instanceof Array) {",
    "    return this.x === (x[0] || 0) && this.y === (x[1] || 0) && this.z === (x[2] || 0);",
    "  }",
    "  return this.x === (x || 0) && this.y === (y || 0) && this.z === (z || 0);",
    "};",
    "",
    "p5.Vector.prototype.clampToZero = function(epsilon) {",
    "  epsilon = epsilon || 1e-10;",
    "  if (Math.abs(this.x) < epsilon) this.x = 0;",
    "  if (Math.abs(this.y) < epsilon) this.y = 0;",
    "  if (Math.abs(this.z) < epsilon) this.z = 0;",
    "  return this;",
    "};",
    "",
    "p5.Vector.prototype.toString = function() {",
    "  return 'p5.Vector(' + this.x + ', ' + this.y + ', ' + this.z + ')';",
    "};",
    "",
    "// ===== Static Methods =====",
    "",
    "p5.Vector.add = function(v1, v2, target) {",
    "  if (!target) target = new p5.Vector();",
    "  target.x = v1.x + v2.x;",
    "  target.y = v1.y + v2.y;",
    "  target.z = v1.z + v2.z;",
    "  return target;",
    "};",
    "",
    "p5.Vector.sub = function(v1, v2, target) {",
    "  if (!target) target = new p5.Vector();",
    "  target.x = v1.x - v2.x;",
    "  target.y = v1.y - v2.y;",
    "  target.z = v1.z - v2.z;",
    "  return target;",
    "};",
    "",
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
    "p5.Vector.dot = function(v1, v2) {",
    "  return v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;",
    "};",
    "",
    "p5.Vector.cross = function(v1, v2, target) {",
    "  var cx = v1.y * v2.z - v1.z * v2.y;",
    "  var cy = v1.z * v2.x - v1.x * v2.z;",
    "  var cz = v1.x * v2.y - v1.y * v2.x;",
    "  if (!target) target = new p5.Vector(cx, cy, cz);",
    "  else { target.x = cx; target.y = cy; target.z = cz; }",
    "  return target;",
    "};",
    "",
    "p5.Vector.dist = function(v1, v2) {",
    "  var dx = v2.x - v1.x;",
    "  var dy = v2.y - v1.y;",
    "  var dz = v2.z - v1.z;",
    "  return Math.sqrt(dx * dx + dy * dy + dz * dz);",
    "};",
    "",
    "p5.Vector.lerp = function(v1, v2, amt, target) {",
    "  if (!target) target = new p5.Vector();",
    "  target.x = v1.x + (v2.x - v1.x) * amt;",
    "  target.y = v1.y + (v2.y - v1.y) * amt;",
    "  target.z = v1.z + (v2.z - v1.z) * amt;",
    "  return target;",
    "};",
    "",
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
    "p5.Vector.mag = function(v) {",
    "  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);",
    "};",
    "",
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
    "p5.Vector.fromAngle = function(angle, length) {",
    "  if (length === undefined) length = 1;",
    "  var rad = _toAngleRadians(angle);",
    "  return new p5.Vector(length * Math.cos(rad), length * Math.sin(rad), 0);",
    "};",
    "",
    "p5.Vector.fromAngles = function(theta, phi, length) {",
    "  if (length === undefined) length = 1;",
    "  var thetaRad = _toAngleRadians(theta);",
    "  var phiRad = _toAngleRadians(phi);",
    "  var sinPhi = Math.sin(phiRad);",
    "  return new p5.Vector(",
    "    length * sinPhi * Math.sin(thetaRad),",
    "    length * Math.cos(phiRad),",
    "    length * sinPhi * Math.cos(thetaRad)",
    "  );",
    "};",
    "",
    "p5.Vector.random2D = function() {",
    "  var angle = (typeof random === 'function' ? random : Math.random)() * Math.PI * 2;",
    "  return new p5.Vector(Math.cos(angle), Math.sin(angle), 0);",
    "};",
    "",
    "p5.Vector.random3D = function() {",
    "  var rng = typeof random === 'function' ? random : Math.random;",
    "  var theta = rng() * Math.PI * 2;",
    "  var phi = Math.acos(2 * rng() - 1);",
    "  var sinPhi = Math.sin(phi);",
    "  return new p5.Vector(sinPhi * Math.cos(theta), sinPhi * Math.sin(theta), Math.cos(phi));",
    "};",
    "",
    "p5.Vector.reflect = function(incidentVector, surfaceNormal, target) {",
    "  if (!target) target = incidentVector.copy();",
    "  else target.set(incidentVector);",
    "  return target.reflect(surfaceNormal);",
    "};",
    "",
    "p5.Vector.slerp = function(v1, v2, amt, target) {",
    "  if (!target) target = v1.copy();",
    "  else target.set(v1);",
    "  return target.slerp(v2, amt);",
    "};",
    "",
    "var createVector = function(x, y, z) {",
    "  return new p5.Vector(x, y, z);",
    "};"
  ].join("\n");
}

// Expression runtime.
function getMathLib(deps) {
  if (!deps) deps = {};

  var hasAny = false;
  for (var key in deps) {
    if (deps.hasOwnProperty(key) && deps[key]) {
      hasAny = true;
      break;
    }
  }
  if (!hasAny) return "";

  var lib = [
    "// ===== Math Functions =====",
    getMathConstantsLib(deps),
    getMathAngleLib(deps),
    getMathBasicLib(deps),
    getMathMappingLib(deps),
    getMathNoiseLib(deps),
    getMathCurveLib(deps),
    getMathVectorLib(deps)
  ];

  var compact = [];
  for (var i = 0; i < lib.length; i++) {
    if (lib[i]) compact.push(lib[i]);
  }
  return compact.join("\n");
}

function getMathConstantsLib(deps) {
  var lib = [];

  if (deps.PI) lib.push("const PI = Math.PI;");
  if (deps.TWO_PI) lib.push("const TWO_PI = Math.PI * 2;");
  if (deps.HALF_PI) lib.push("const HALF_PI = Math.PI / 2;");
  if (deps.QUARTER_PI) lib.push("const QUARTER_PI = Math.PI / 4;");

  lib.push(
    "const CENTER = 0;",
    "const RADIUS = 1;",
    "const CORNER = 2;",
    "const CORNERS = 3;",
    "var _ellipseMode = CENTER;",
    "var _rectMode = CORNER;",
    "var ellipseMode = function(m) { _ellipseMode = m; };",
    "var rectMode = function(m) { _rectMode = m; };",
    "const LEFT = 1;",
    "const RIGHT = 2;",
    "const TOP = 1;",
    "const BOTTOM = 2;",
    "const BASELINE = 3;"
  );

  return lib.join("\n");
}

function getMathAngleLib(deps) {
  var lib = [];

  if (deps.angleMode) {
    lib.push(
      "var DEGREES = 'DEG', RADIANS = 'RAD';",
      "var _angleMode = RADIANS;",
      "var angleMode = function(m) { _angleMode = m; };"
    );
  }
  if (deps.degrees) lib.push("var degrees = function(rad) { return rad * 180 / Math.PI; };");
  if (deps.radians) lib.push("var radians = function(deg) { return deg * Math.PI / 180; };");

  if (
    deps.degrees ||
    deps.radians ||
    deps.sin ||
    deps.cos ||
    deps.tan ||
    deps.asin ||
    deps.acos ||
    deps.atan ||
    deps.atan2 ||
    deps.angleMode ||
    deps.p5 ||
    deps.createVector
  ) {
    lib.push(
      "var _toAngleRadians = function(v) {",
      "  return (typeof _angleMode !== 'undefined' && _angleMode === 'DEG') ? v * Math.PI / 180 : v;",
      "};",
      "var _fromAngleRadians = function(v) {",
      "  return (typeof _angleMode !== 'undefined' && _angleMode === 'DEG') ? v * 180 / Math.PI : v;",
      "};"
    );
  }

  if (deps.sin) lib.push("var sin = function(v) { return Math.sin(_toAngleRadians(v)); };");
  if (deps.cos) lib.push("var cos = function(v) { return Math.cos(_toAngleRadians(v)); };");
  if (deps.tan) lib.push("var tan = function(v) { return Math.tan(_toAngleRadians(v)); };");
  if (deps.asin) lib.push("var asin = function(v) { return _fromAngleRadians(Math.asin(v)); };");
  if (deps.acos) lib.push("var acos = function(v) { return _fromAngleRadians(Math.acos(v)); };");
  if (deps.atan) lib.push("var atan = function(v) { return _fromAngleRadians(Math.atan(v)); };");
  if (deps.atan2) lib.push("var atan2 = function(y, x) { return _fromAngleRadians(Math.atan2(y, x)); };");

  return lib.join("\n");
}

function getMathBasicLib(deps) {
  var lib = [];

  if (deps.sqrt) lib.push("var sqrt = Math.sqrt;");
  if (deps.pow) lib.push("var pow = Math.pow;");
  if (deps.abs) lib.push("var abs = Math.abs;");
  if (deps.floor) lib.push("var floor = Math.floor;");
  if (deps.ceil) lib.push("var ceil = Math.ceil;");
  if (deps.round) lib.push("var round = Math.round;");
  if (deps.min) lib.push("var min = Math.min;");
  if (deps.max) lib.push("var max = Math.max;");
  if (deps.exp) lib.push("var exp = Math.exp;");
  if (deps.log) lib.push("var log = Math.log;");
  if (deps.sq) lib.push("var sq = function(n) { return n * n; };");
  if (deps.fract) lib.push("var fract = function(n) { return n - Math.floor(n); };");
  if (deps.norm) lib.push("var norm = function(v, a, b) { return (v - a) / (b - a); };");
  if (deps.mag) {
    lib.push([
      "var mag = function(x, y, z) {",
      "  if (z !== undefined) return Math.sqrt(x*x + y*y + z*z);",
      "  return Math.sqrt(x*x + y*y);",
      "};"
    ].join("\n"));
  }

  return lib.join("\n");
}

function getMathMappingLib(deps) {
  var lib = [];

  if (deps.random || deps.randomGaussian || deps.randomSeed) lib.push(getRandomLib());
  if (deps.map) lib.push("var map = function(v, a, b, c, d) { return c + (v - a) / (b - a) * (d - c); };");
  if (deps.constrain) lib.push("var constrain = function(v, lo, hi) { return Math.min(Math.max(v, lo), hi); };");
  if (deps.lerp) lib.push("var lerp = function(a, b, t) { return a + (b - a) * t; };");
  if (deps.dist) lib.push("var dist = function(x1, y1, x2, y2) { return Math.sqrt((x2-x1)*(x2-x1) + (y2-y1)*(y2-y1)); };");

  return lib.join("\n");
}

function getMathNoiseLib(deps) {
  if (deps.noise || deps.noiseDetail || deps.noiseSeed) {
    return getNoiseLib();
  }
  return "";
}

function getMathCurveLib(deps) {
  var lib = [];

  if (deps.bezierPoint) {
    lib.push([
      "var bezierPoint = function(a, b, c, d, t) {",
      "  var it = 1 - t;",
      "  return it*it*it*a + 3*it*it*t*b + 3*it*t*t*c + t*t*t*d;",
      "};"
    ].join("\n"));
  }

  if (deps.bezierTangent) {
    lib.push([
      "var bezierTangent = function(a, b, c, d, t) {",
      "  var it = 1 - t;",
      "  return 3*it*it*(b-a) + 6*it*t*(c-b) + 3*t*t*(d-c);",
      "};"
    ].join("\n"));
  }

  if (
    deps.curvePoint ||
    deps.curveTangent ||
    deps.curveTightness ||
    deps._curveTightnessVar
  ) {
    lib.push("var _curveTightness = 0.5;");
  }

  if (deps.curvePoint) {
    lib.push([
      "var curvePoint = function(a, b, c, d, t) {",
      "  var s = _curveTightness !== undefined ? _curveTightness : 0.5;",
      "  var t2 = t * t;",
      "  var t3 = t2 * t;",
      "  var h1 = 2*t3 - 3*t2 + 1;",
      "  var h2 = t3 - 2*t2 + t;",
      "  var h3 = -2*t3 + 3*t2;",
      "  var h4 = t3 - t2;",
      "  return h1*b + h2*s*(c-a) + h3*c + h4*s*(d-b);",
      "};"
    ].join("\n"));
  }

  if (deps.curveTangent) {
    lib.push([
      "var curveTangent = function(a, b, c, d, t) {",
      "  var s = _curveTightness !== undefined ? _curveTightness : 0.5;",
      "  var t2 = t * t;",
      "  var dh1 = 6*t2 - 6*t;",
      "  var dh2 = 3*t2 - 4*t + 1;",
      "  var dh3 = -6*t2 + 6*t;",
      "  var dh4 = 3*t2 - 2*t;",
      "  return dh1*b + dh2*s*(c-a) + dh3*c + dh4*s*(d-b);",
      "};"
    ].join("\n"));
  }

  if (deps.curveTightness) {
    lib.push([
      "var curveTightness = function(s) {",
      "  if (s !== undefined) {",
      "    _curveTightness = Math.max(-2, Math.min(3, s));",
      "  }",
      "  return _curveTightness;",
      "};"
    ].join("\n"));
  }

  return lib.join("\n");
}

function getMathVectorLib(deps) {
  if (deps.p5 || deps.createVector) {
    return getVectorLib();
  }
  return "";
}
