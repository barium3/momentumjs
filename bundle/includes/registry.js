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
 */
functionRegistry.shapes = {
  // 椭圆/圆形
  ellipse: {
    internal: "_ellipse",
    baseType: "ellipse",
    // 椭圆/矩形模式常量（与 p5.ellipseMode / rectMode 对齐）
    // 0=CENTER, 1=RADIUS, 2=CORNER, 3=CORNERS
    modes: ["CENTER", "RADIUS", "CORNER", "CORNERS"],
  },
  circle: {
    internal: "_ellipse",
    baseType: "ellipse",
  },

  // 三角形
  triangle: {
    internal: "_triangle",
    baseType: "triangle",
  },

  // 四边形
  quad: {
    internal: "_quad",
    baseType: "quad",
  },

  // 圆弧
  arc: {
    internal: "_arc",
    baseType: "arc",
    // 圆弧模式常量（与 p5.arc 的 mode 对齐）
    // 0=OPEN, 1=CHORD, 2=PIE
    modes: ["OPEN", "CHORD", "PIE"],
  },

  // 矩形/正方形
  rect: {
    internal: "_rect",
    baseType: "rect",
    // 与 ellipse 共用的模式常量
    modes: ["CENTER", "RADIUS", "CORNER", "CORNERS"],
  },
  square: {
    internal: "_rect",
    baseType: "rect",
  },

  // 直线
  line: {
    internal: "_line",
    baseType: "line",
  },

  // 点
  point: {
    internal: "_point",
    baseType: "point",
  },

  // 背景: 纯色图层，颜色由效果-生成-填色控制
  // 数据格式（语义化 JSON）: { index, type:"background", color:[r,g,b,a] }
  background: {
    internal: "_background",
    baseType: "background",
  },

  // 多边形: 通过 beginShape()/vertex()/endShape() 构建的任意多边形
  // 数据结构（语义化 JSON）:
  //   {
  //     index,
  //     type: "polygon",
  //     points: [[x,y], ...],    // 已应用当前变换后的顶点
  //     closed: true/false,      // 是否闭合（endShape(CLOSE)）
  //     fillColor, strokeColor,  // [r,g,b,a] 或 null
  //     fillOpacity, strokeOpacity,
  //     strokeWeight
  //   }
  polygon: {
    internal: "_polygon",
    baseType: "polygon",
    // 多边形闭合模式常量：endShape(CLOSE)
    closeModes: ["CLOSE"],
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

  // 贝塞尔曲线
  bezier: {
    internal: "_bezier",
    baseType: "bezier",
  },

  // Catmull-Rom 样条曲线
  curve: {
    internal: "_curve",
    baseType: "curve",
  },
};

/**
 * 形状类型前缀编码表
 * 用于生成稳定的 id：id = typeCode * 10000 + 调用次数
 * key 为基础图形类型（baseType），value 为前缀编码
 *
 * 约定（默认值）：
 *   1xxxx = ellipse
 *   2xxxx = rect
 *   3xxxx = line
 *   4xxxx = point
 *   5xxxx = polygon
 *   6xxxx = arc
 *   7xxxx = quad
 *   8xxxx = triangle
 *   9xxxx = bezier
 *  10xxxx = curve
 *  11xxxx = background
 *
 * 如需新增渲染图层，只需在此处为新的 baseType 分配唯一前缀编码，
 * 其余逻辑（id 生成与表达式查找）都会自动对齐。
 */
functionRegistry.shapeTypeCode = {
  ellipse: 1,
  rect: 2,
  line: 3,
  point: 4,
  polygon: 5,
  arc: 6,
  quad: 7,
  triangle: 8,
  bezier: 9,
  curve: 10,
  background: 11,
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

  // 椭圆/矩形模式常量（与 p5.ellipseMode / rectMode 对齐）
  // 0=CENTER, 1=RADIUS, 2=CORNER, 3=CORNERS
  CENTER: { internal: "CENTER", type: "constant" },
  RADIUS: { internal: "RADIUS", type: "constant" },
  CORNER: { internal: "CORNER", type: "constant" },
  CORNERS: { internal: "CORNERS", type: "constant" },

  // 椭圆/矩形模式设置函数（非渲染函数）
  ellipseMode: { internal: "ellipseMode" },
  rectMode: { internal: "rectMode" },

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
 * 控制器/交互函数定义
 * 统一管理所有与 UI 控件、交互相关但本身不产生渲染输出的函数
 * 这些函数在浏览器侧通常转发到真实 UI 控件，在 AE 表达式侧由 core/controller 模块提供实现
 */
functionRegistry.controllers = {
  // Slider 控件：在浏览器侧通常对应 p5.js DOM Slider，
  // 在 AE 表达式侧由 core.js 注入同名辅助函数（返回 { value() } 接口）
  // 两端保持 API 一致：slider = createSlider(min, max, value, step); slider.value()
  createSlider: { internal: "createSlider" },
  // Angle 控件：角度控制，在 AE 表达式侧由 createAngle() 提供角度数值
  // API：var ang = createAngle(defaultDegrees); var v = ang.value(); // 以“度”为单位
  createAngle: { internal: "createAngle" },
  // Color 控件：在浏览器侧对应颜色选择器，在 AE 表达式侧由 createColorPicker() 提供
  // API：picker = createColorPicker([r, g, b, a]); picker.value()
  createColorPicker: { internal: "createColorPicker" },
  // Checkbox 控件：在浏览器侧通常对应 p5.js DOM createCheckbox，
  // 在 AE 表达式侧由 createCheckbox() 提供布尔控制器（勾选/取消）
  // 建议使用：var cb = createCheckbox(initialChecked); if (cb.checked()) { ... }
  createCheckbox: { internal: "createCheckbox" },
  // Select 控件：下拉选择器/枚举选择，在 AE 表达式侧由 createSelect() 提供离散选项控制
  // 建议使用：var sel = createSelect(optionsArray, defaultIndex); var v = sel.value();
  createSelect: { internal: "createSelect" },
  // Point 控件：二维点控制，在 AE 表达式侧由 createPoint() 提供 [x, y] 控制
  // API：var pt = createPoint(defaultX, defaultY); var v = pt.value(); var x = pt.x(); var y = pt.y();
  createPoint: { internal: "createPoint" },
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

// polygonBuilders 旧定义已废弃，相关信息已完全整合到 shapes.polygon.builders，
// 为避免混淆，这里不再暴露额外的 polygonBuilders 别名。

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
  // 控制器/交互函数（如 createSlider）
  if (this.controllers) {
    result.push.apply(result, Object.keys(this.controllers));
  }
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
