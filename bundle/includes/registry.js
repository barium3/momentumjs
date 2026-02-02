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
functionRegistry.shapes = {
  // 椭圆/圆形
  ellipse: {
    internal: "_ellipse",
    baseType: "ellipse", // 基础类型，用于统计和分类
    slots: 7,
    markerType: 1001,
  },
  circle: {
    internal: "_ellipse", // circle 和 ellipse 共享同一个内部函数
    baseType: "ellipse", // circle 映射到 ellipse 进行统计
    slots: 7,
    markerType: 1001,
  },

  // 矩形/正方形
  rect: {
    internal: "_rect",
    baseType: "rect", // 基础类型，用于统计和分类
    slots: 7,
    markerType: 1002,
  },
  square: {
    internal: "_rect", // square 和 rect 共享同一个内部函数
    baseType: "rect", // square 映射到 rect 进行统计
    slots: 7,
    markerType: 1002,
  },

  // 直线
  line: {
    internal: "_line",
    baseType: "line", // 基础类型，用于统计和分类
    slots: 6,
    markerType: 1003,
  },

  // 点
  point: {
    internal: "_point",
    baseType: "point", // 基础类型，用于统计和分类
    slots: 5,
    markerType: 1004,
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
 */
functionRegistry.colors = {
  fill: { internal: "fill" },
  noFill: { internal: "noFill" },
  stroke: { internal: "stroke" },
  noStroke: { internal: "noStroke" },
  strokeWeight: { internal: "strokeWeight" },
  color: { internal: "color" },
  lerpColor: { internal: "lerpColor" },
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

  // 基本数学函数
  sin: { internal: "sin" },
  cos: { internal: "cos" },
  tan: { internal: "tan" },
  sqrt: { internal: "sqrt" },
  pow: { internal: "pow" },
  abs: { internal: "abs" },
  floor: { internal: "floor" },
  ceil: { internal: "ceil" },
  round: { internal: "round" },
  min: { internal: "min" },
  max: { internal: "max" },

  // 扩展数学函数
  random: { internal: "random" },
  map: { internal: "map" },
  constrain: { internal: "constrain" },
  lerp: { internal: "lerp" },
  dist: { internal: "dist" },

  // 噪声函数
  noise: { internal: "noise" },
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
