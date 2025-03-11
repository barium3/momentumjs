// 添加环境检测
const isBrowser =
  typeof window !== "undefined" && typeof document !== "undefined";

// AE表达式常量定义
const aeConstants = {
  // 时间相关
  time: "time",

  // 合成属性
  thisComp: {
    width: "thisComp.width",
    height: "thisComp.height",
  },

  // 图层属性
  thisLayer: "thisLayer",
  thisProperty: "thisProperty",
  value: "value",
  index: "index",

  // 形状属性
  CENTER: "center",
  RADIUS: "radius",
  CORNER: "corner",
  CORNERS: "corners",

  // 数学常量
  PI: "Math.PI",
  E: "Math.E",
};

// 浏览器环境处理
if (isBrowser) {
  // 将常量挂载到window对象
  window.aeConstants = Object.keys(aeConstants);
  Object.entries(aeConstants).forEach(([key, value]) => {
    window[key] = value;
  });

  // 特殊处理嵌套对象
  window.thisComp = aeConstants.thisComp;
} else {
  // ExtendScript环境导出
  var pub = pub || {};
  Object.assign(pub, aeConstants);
  // 保持原有导出逻辑
  pub.width = aeConstants.thisComp.width;
  pub.height = aeConstants.thisComp.height;
}

var ERROR_PREFIX = "\nmomentum.js Error -> ",
  WARNING_PREFIX = "### momentum Warning -> ";

pub.CENTER = "center";
pub.RADIUS = "radius";
pub.CORNER = "corner";
pub.CORNERS = "corners";
