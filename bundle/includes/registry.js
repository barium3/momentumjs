/**
 * Momentum 函数注册中心
 *
 * 单一数据源：定义系统中所有可用的函数
 * 各层从前端、后端、表达式都可以引用此文件
 * 确保函数定义的一致性
 */

var functionRegistry = {};

/**
 * 形状函数定义
 * key: 用户调用的函数名 (p5.js API)
 * value: 内部实现配置
 *   - internal: 引擎表达式中使用的内部函数名
 *   - slots: 数据槽位数（从 path 读取的数据长度）
 *   - markerType: 标记类型（用于在 path 中标识）
 */
/**
 * 形状数据槽位说明：
 * 每个形状存储的数据格式为: [...geometry, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
 * - geometry: 形状特定的几何数据（位置、大小、旋转等）
 * - fill1: [r, g] 填充颜色的红绿分量
 * - fill2: [b, a] 填充颜色的蓝和透明度分量
 * - stroke1: [r, g] 描边颜色的红绿分量
 * - stroke2: [b, a] 描边颜色的蓝和透明度分量
 * - opacity: [fillOpacity, strokeOpacity] 填充和描边的不透明度 (0-100)
 * - strokeWeight: [weight, 0] 描边宽度
 * - marker: [index, type] 形状标记
 *
 * slots 计算: geometry slots + 6 (颜色数据)
 */
functionRegistry.shapes = {
  // 椭圆/圆形: geometry = [pos, size, rot] = 3 slots
  ellipse: {
    internal: "_ellipse",
    baseType: "ellipse",
    slots: 9, // 3 geometry + 6 color
    markerType: 1001,
  },
  circle: {
    internal: "_ellipse",
    baseType: "ellipse",
    slots: 9,
    markerType: 1001,
  },

  // 矩形/正方形: geometry = [pos, size, rot] = 3 slots
  rect: {
    internal: "_rect",
    baseType: "rect",
    slots: 9, // 3 geometry + 6 color
    markerType: 1002,
  },
  square: {
    internal: "_rect",
    baseType: "rect",
    slots: 9,
    markerType: 1002,
  },

  // 直线: geometry = [p1, p2] = 2 slots
  line: {
    internal: "_line",
    baseType: "line",
    slots: 8, // 2 geometry + 6 color
    markerType: 1003,
  },

  // 点: geometry = [pos] = 1 slot
  point: {
    internal: "_point",
    baseType: "point",
    slots: 7, // 1 geometry + 6 color
    markerType: 1004,
  },

  // 背景: 纯色图层，颜色由效果-生成-填色控制
  // 数据格式: [fill1, fill2, marker] = [r,g], [b,a], marker
  background: {
    internal: "_background",
    baseType: "background",
    slots: 3,
    markerType: 1005,
  },
};

/**
 * 变换函数定义
 */
functionRegistry.transforms = {
  translate: { internal: "translate" },
  rotate: { internal: "rotate" },
  scale: { internal: "scale" },
  push: { internal: "push" },
  pop: { internal: "pop" },
  resetMatrix: { internal: "resetMatrix" },
};

/**
 * 颜色函数定义
 * 颜色模式常量：RGB=0, HSB=1, HSL=2
 */
functionRegistry.colors = {
  // 设置/重置函数
  fill: { internal: "fill" },
  noFill: { internal: "noFill" },
  stroke: { internal: "stroke" },
  noStroke: { internal: "noStroke" },
  strokeWeight: { internal: "strokeWeight" },

  // 颜色创建
  color: { internal: "color" },
  lerpColor: { internal: "lerpColor" },

  // 颜色模式
  colorMode: { internal: "colorMode" },

  // 颜色提取函数
  red: { internal: "red" },
  green: { internal: "green" },
  blue: { internal: "blue" },
  alpha: { internal: "alpha" },
  hue: { internal: "hue" },
  saturation: { internal: "saturation" },
  brightness: { internal: "brightness" },
  lightness: { internal: "lightness" },

  // 颜色模式常量
  RGB: { internal: "RGB", type: "constant" },
  HSB: { internal: "HSB", type: "constant" },
  HSL: { internal: "HSL", type: "constant" },
};

/**
 * 数学函数定义
 * 每个函数按需加载：调用了就加载，不调用就不加载
 */
functionRegistry.math = {
  // 常量
  PI: { internal: "PI", type: "constant" },
  TWO_PI: { internal: "TWO_PI", type: "constant" },
  HALF_PI: { internal: "HALF_PI", type: "constant" },
  QUARTER_PI: { internal: "QUARTER_PI", type: "constant" },

  // 基本数学函数（三角与反三角）
  sin: { internal: "sin" },
  cos: { internal: "cos" },
  tan: { internal: "tan" },
  asin: { internal: "asin" },
  acos: { internal: "acos" },
  atan: { internal: "atan" },
  atan2: { internal: "atan2" },
  degrees: { internal: "degrees" },
  radians: { internal: "radians" },
  angleMode: { internal: "angleMode" },
  sqrt: { internal: "sqrt" },
  pow: { internal: "pow" },
  abs: { internal: "abs" },
  floor: { internal: "floor" },
  ceil: { internal: "ceil" },
  round: { internal: "round" },
  min: { internal: "min" },
  max: { internal: "max" },
  exp: { internal: "exp" },
  log: { internal: "log" },
  sq: { internal: "sq" },
  fract: { internal: "fract" },
  norm: { internal: "norm" },
  mag: { internal: "mag" },

  // 扩展数学函数（randomSeed、randomGaussian 与 random 一同注入）
  random: { internal: "random" },
  randomGaussian: { internal: "randomGaussian" },
  randomSeed: { internal: "randomSeed" },
  map: { internal: "map" },
  constrain: { internal: "constrain" },
  lerp: { internal: "lerp" },
  dist: { internal: "dist" },

  // 噪声函数（noiseDetail、noiseSeed 与 noise 一同注入）
  noise: { internal: "noise" },
  noiseDetail: { internal: "noiseDetail" },
  noiseSeed: { internal: "noiseSeed" },

  // 向量函数（p5.Vector 命名空间）
  // 检测 p5.Vector 或 createVector 时注入整个 p5 命名空间
  p5: { internal: "p5", type: "namespace" },
  createVector: { internal: "createVector" },
};

/**
 * 环境配置函数和变量定义
 * 包含：配置函数（createCanvas, frameRate）和环境变量（frameCount, width, height）
 * 环境变量按需注入，内部使用 currentFrame/fps 等语义化命名
 */
functionRegistry.environment = {
  // 配置函数
  createCanvas: { internal: "createCanvas" },
  frameRate: { internal: "frameRate" },

  // 环境变量（按需注入）
  frameCount: { internal: "frameCount", type: "variable" },
  width: { internal: "width", type: "constant" },
  height: { internal: "height", type: "constant" },
};

/**
 * 获取所有形状函数名（供前端渲染统计使用）
 */
functionRegistry.getShapeNames = function () {
  return Object.keys(this.shapes);
};

/**
 * 获取形状函数信息
 * @param {string} name - 形状函数名
 * @returns {Object|null} 形状配置信息
 */
functionRegistry.getShapeInfo = function (name) {
  return this.shapes[name] || null;
};

/**
 * 获取形状函数的槽位数
 * @param {string} type - 形状类型
 * @returns {number} 槽位数
 */
functionRegistry.getShapeSlots = function (type) {
  var info = this.getShapeInfo(type);
  return info ? info.slots : 7;
};

/**
 * 获取所有渲染函数名（用于前端统计）
 * 渲染函数是指会产生可见图形的函数
 */
functionRegistry.getRenderFunctions = function () {
  return Object.keys(this.shapes);
};

/**
 * 获取所有支持的非渲染 p5 函数
 * 这些函数只转发，不做统计
 */
functionRegistry.getP5Functions = function () {
  var result = [];
  result.push.apply(result, Object.keys(this.transforms));
  result.push.apply(result, Object.keys(this.colors));
  result.push.apply(result, Object.keys(this.math));
  result.push.apply(result, Object.keys(this.environment));
  return result;
};

/**
 * 获取所有函数（包括渲染和非渲染）
 */
functionRegistry.getAllFunctions = function () {
  return this.getRenderFunctions().concat(this.getP5Functions());
};

/**
 * 从一个类别中提取特定类型的项（用于提取变量/常量）
 * @param {Object} category - 类别对象（如 this.environment, this.math）
 * @param {Array<string>} types - 需要提取的类型列表（如 ["variable", "constant"]）
 * @returns {Array<string>} 匹配的项名称列表
 */
functionRegistry.getItemsByType = function (category, types) {
  var result = [];
  if (!category) return result;

  for (var name in category) {
    if (category.hasOwnProperty(name)) {
      var item = category[name];
      // 检查是否匹配任一类型
      if (item.type && types.indexOf(item.type) !== -1) {
        result.push(name);
      }
    }
  }

  return result;
};

/**
 * 获取所有变量（从各个类别中提取标记为 variable 或 constant 的项）
 * 变量需要在代码执行时暴露到全局作用域
 */
functionRegistry.getAllVariables = function () {
  var result = [];
  var types = ["variable", "constant"]; // 支持的变量类型

  // 从各个类别中提取变量
  result.push.apply(result, this.getItemsByType(this.environment, types));
  result.push.apply(result, this.getItemsByType(this.math, types));
  result.push.apply(result, this.getItemsByType(this.transforms, types));
  result.push.apply(result, this.getItemsByType(this.colors, types));

  return result;
};

// 导出到全局（浏览器环境）
if (typeof window !== "undefined") {
  window.functionRegistry = functionRegistry;
}

// 导出到全局（ExtendScript/AE 环境）
if (typeof $ !== "undefined" && $.global) {
  $.global.functionRegistry = functionRegistry;
}

// CommonJS 导出（Node.js 环境）
if (typeof module !== "undefined" && module.exports) {
  module.exports = functionRegistry;
}
