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
    slots: 9, // 3 geometry + 6 color（不含 marker）
    markerType: 1001,
  },
  circle: {
    internal: "_ellipse",
    baseType: "ellipse",
    slots: 9,
    markerType: 1001,
  },

  // 三角形: geometry = [p1, p2, p3] = 3 slots
  // 数据结构: [p1, p2, p3, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
  triangle: {
    internal: "_triangle",
    baseType: "triangle",
    slots: 9, // 3 geometry + 6 color（不含 marker）
    markerType: 1008,
  },

  // 四边形: geometry = [p1, p2, p3, p4] = 4 slots
  // 数据结构: [p1, p2, p3, p4, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
  // 其中:
  // - p1~p4: 顶点位置（已应用当前变换） [x, y]
  quad: {
    internal: "_quad",
    baseType: "quad",
    slots: 10, // 4 geometry + 6 color（不含 marker）
    markerType: 1007,
  },

  // 圆弧: geometry = [pos, size, angles, mode] = 4 slots
  // 数据结构: [pos, size, angles, mode, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
  // 其中:
  // - pos:    圆心位置（已应用当前变换）      [x, y]
  // - size:   椭圆宽高（已应用 scale）       [w, h]
  // - angles: 起止角度（弧度）             [start, stop]
  // - mode:   模式码：0=OPEN, 1=CHORD, 2=PIE [mode, 0]
  arc: {
    internal: "_arc",
    baseType: "arc",
    slots: 10, // 4 geometry + 6 color（不含 marker）
    markerType: 1006,
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

  // 多边形: 通过 beginShape()/vertex()/endShape() 构建的任意多边形
  // 数据结构（语义化 JSON）:
  //   {
  //     id, marker, markerType,
  //     type: "polygon",
  //     points: [[x,y], ...],    // 已应用当前变换后的顶点
  //     closed: true/false,      // 是否闭合（endShape(CLOSE)）
  //     fillColor, strokeColor,  // [r,g,b,a] 或 null
  //     fillOpacity, strokeOpacity,
  //     strokeWeight
  //   }
  // 注意：slots 仅用于旧版 path 索引，占位即可（几何数据不再依赖 slots）
  polygon: {
    internal: "_polygon",
    baseType: "polygon",
    slots: 9, // 占位值：与 triangle/ellipse 一致，实际几何数据由 points 承载
    markerType: 1009,
    // 构建器函数配置：定义用于构建此 shape 的函数及其角色
    builders: {
      beginShape: { role: "begin" },  // 开始构建
      vertex: { role: "add" },        // 添加顶点
      beginContour: { role: "add" },  // 开始轮廓（用于创建洞）
      endContour: { role: "add" },    // 结束轮廓
      bezierVertex: { role: "add" },  // 添加三次贝塞尔曲线顶点
      quadraticVertex: { role: "add" }, // 添加二次贝塞尔曲线顶点
      curveVertex: { role: "add" },   // 添加曲线顶点（Catmull-Rom 样条）
      endShape: { role: "end" },      // 结束构建（触发统计）
    },
  },

  // 贝塞尔曲线: geometry = [p1, p2, p3, p4] = 4 slots
  // 数据结构: [p1, p2, p3, p4, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
  // 其中:
  // - p1: 起点 [x1, y1]
  // - p2: 第一个控制点 [x2, y2]
  // - p3: 第二个控制点 [x3, y3]
  // - p4: 终点 [x4, y4]
  bezier: {
    internal: "_bezier",
    baseType: "bezier",
    slots: 10, // 4 geometry + 6 color（不含 marker）
    markerType: 1010,
  },

  // Catmull-Rom 样条曲线: geometry = [p1, p2, p3, p4] = 4 slots
  // 数据结构: [p1, p2, p3, p4, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
  // 其中:
  // - p1: 第一个控制点 [x1, y1]
  // - p2: 起点 [x2, y2]
  // - p3: 终点 [x3, y3]
  // - p4: 第二个控制点 [x4, y4]
  curve: {
    internal: "_curve",
    baseType: "curve",
    slots: 10, // 4 geometry + 6 color（不含 marker）
    markerType: 1011,
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

  // 形状模式常量（与 p5.arc 的 mode 对齐）
  // 0=OPEN, 1=CHORD, 2=PIE
  OPEN: { internal: "OPEN", type: "constant" },
  CHORD: { internal: "CHORD", type: "constant" },
  PIE: { internal: "PIE", type: "constant" },
  // beginShape/endShape 模式常量
  CLOSE: { internal: "CLOSE", type: "constant" },

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

  // 曲线计算函数（bezierPoint、bezierTangent、curvePoint、curveTangent）
  bezierPoint: { internal: "bezierPoint" },
  bezierTangent: { internal: "bezierTangent" },
  curvePoint: { internal: "curvePoint" },
  curveTangent: { internal: "curveTangent" },
  curveTightness: { internal: "curveTightness" },

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
 * 多边形构建函数定义（已废弃，信息已整合到 shapes.polygon.builders）
 * 保留此定义以保持向后兼容，但建议使用 shapes.polygon.builders
 * @deprecated 使用 shapes.polygon.builders 代替
 */
functionRegistry.polygonBuilders = {
  beginShape: { internal: "beginShape", type: "polygonBuilder" },
  vertex: { internal: "vertex", type: "polygonBuilder" },
  beginContour: { internal: "beginContour", type: "polygonBuilder" },
  endContour: { internal: "endContour", type: "polygonBuilder" },
  bezierVertex: { internal: "bezierVertex", type: "polygonBuilder" },
  quadraticVertex: { internal: "quadraticVertex", type: "polygonBuilder" },
  curveVertex: { internal: "curveVertex", type: "polygonBuilder" },
  endShape: { internal: "endShape", type: "polygonBuilder" },
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
  // 收集所有 shape 的构建器函数
  if (this.shapes) {
    for (var shapeName in this.shapes) {
      if (this.shapes.hasOwnProperty(shapeName)) {
        var shapeInfo = this.shapes[shapeName];
        if (shapeInfo.builders) {
          result.push.apply(result, Object.keys(shapeInfo.builders));
        }
      }
    }
  }
  // 向后兼容：如果存在旧的 polygonBuilders，也包含进来
  if (this.polygonBuilders) {
    result.push.apply(result, Object.keys(this.polygonBuilders));
  }
  return result;
};

/**
 * 获取指定 shape 的构建器函数配置
 * @param {string} shapeName - shape 名称（如 "polygon"）
 * @returns {Object|null} 构建器函数配置对象，key 为函数名，value 为角色配置
 */
functionRegistry.getShapeBuilders = function (shapeName) {
  if (!this.shapes || !this.shapes[shapeName]) {
    return null;
  }
  return this.shapes[shapeName].builders || null;
};

/**
 * 检查函数是否为某个 shape 的构建器函数
 * @param {string} funcName - 函数名
 * @returns {Object|null} 如果是指定 shape 的构建器，返回 { shapeName, role }，否则返回 null
 */
functionRegistry.getBuilderInfo = function (funcName) {
  if (!this.shapes) {
    return null;
  }
  for (var shapeName in this.shapes) {
    if (this.shapes.hasOwnProperty(shapeName)) {
      var shapeInfo = this.shapes[shapeName];
      if (shapeInfo.builders && shapeInfo.builders[funcName]) {
        return {
          shapeName: shapeName,
          role: shapeInfo.builders[funcName].role,
          baseType: shapeInfo.baseType || shapeName,
        };
      }
    }
  }
  return null;
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
