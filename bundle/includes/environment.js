// ----------------------------------------
// Environment Configuration
// 处理 Processing 风格的环境配置 (size, frameRate)
// ----------------------------------------

/**
 * 从代码中提取画布大小参数
 * 格式: createCanvas(width, height)
 * @param {string} code - 代码
 * @returns {object|null} - {width, height} 或 null
 */
function extractSizeParams(code) {
  var sizePattern = /createCanvas\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/;
  var match = code.match(sizePattern);
  if (match) {
    return { width: parseInt(match[1]), height: parseInt(match[2]) };
  }
  return null;
}

/**
 * 从代码中提取 frameRate() 函数参数
 * 格式: frameRate(fps)
 * @param {string} code - 代码
 * @returns {number|null} - 帧率或 null
 */
function extractFrameRateParam(code) {
  var frameRatePattern = /frameRate\s*\(\s*(\d+)\s*\)/;
  var match = code.match(frameRatePattern);
  if (match) {
    return parseInt(match[1]);
  }
  return null;
}

/**
 * 从代码中提取文件名（用于合成名称）
 * @param {string} code - 代码
 * @param {string} defaultName - 默认名称
 * @returns {string} - 文件名
 */
function extractFileNameFromCode(code, defaultName) {
  var fileNamePattern = /\/\/\s*@filename[:\s]*([^\n]+)/;
  var match = code.match(fileNamePattern);
  if (match && match[1]) {
    return match[1].trim();
  }
  return defaultName || "Untitled";
}

/**
 * 从代码中提取环境配置
 * @param {string} setupCode - setup 函数代码
 * @param {string} compName - 默认合成名
 * @param {number} defaultWidth - 默认宽度
 * @param {number} defaultHeight - 默认高度
 * @param {number} defaultFrameRate - 默认帧率
 * @returns {object} - 环境配置对象
 */
function extractEnvironmentConfig(
  setupCode,
  compName,
  defaultWidth,
  defaultHeight,
  defaultFrameRate,
) {
  var sizeParams = extractSizeParams(setupCode || "");
  var frameRateValue = extractFrameRateParam(setupCode || "");

  return {
    name: compName || "New Composition",
    width: sizeParams ? sizeParams.width : defaultWidth || 1920,
    height: sizeParams ? sizeParams.height : defaultHeight || 1080,
    frameRate: frameRateValue || defaultFrameRate || 30,
    // 原始参数（用于调试或传递）
    sizeParams: sizeParams,
    frameRateValue: frameRateValue,
  };
}

/**
 * 移除配置性函数调用（createCanvas, frameRate 等）
 * 这些函数只在 setup 阶段执行，不需要在表达式中出现
 * @param {string} code - 代码
 * @returns {string} - 移除配置函数后的代码
 */
function removeConfigFunctions(code) {
  code = code.replace(/createCanvas\s*\([^)]*\)\s*;?/g, "");
  code = code.replace(/frameRate\s*\([^)]*\)\s*;?/g, "");
  return code;
}

// ----------------------------------------
// 环境变量定义（供前端识别）
// ----------------------------------------

/**
 * 环境变量定义
 * 这些变量会被前端代码分析器识别为全局可用变量
 * 内部实现使用不同的命名（currentFrame, fps 等）
 */
var frameCount; // 当前帧号，内部映射到 currentFrame
var width; // 合成宽度，内部映射到 thisComp.width
var height; // 合成高度，内部映射到 thisComp.height

/**
 * 获取环境变量到内部变量的映射关系
 * @returns {Object} 映射对象
 */
function getEnvironmentVariableMapping() {
  return {
    frameCount: "currentFrame", // frameCount 对应内部的 currentFrame
    width: "width", // width 直接对应
    height: "height", // height 直接对应
  };
}

/**
 * 生成环境变量库代码（按需注入）
 * 与 getMathLib 风格统一，每个常量/变量单独判断
 * @param {Object} deps - 依赖对象 {frameCount: true, width: true, height: true}
 * @returns {string} - 环境变量定义代码
 */
function getEnvironmentLib(deps) {
  if (!deps) return "";

  var lines = [];
  var hasAny = false;

  // 检查是否有任何环境变量被使用
  for (var key in deps) {
    if (deps.hasOwnProperty(key) && deps[key]) {
      hasAny = true;
      break;
    }
  }

  if (!hasAny) return "";

  lines.push("// Environment Variables");

  // 常量（width, height）
  if (deps.width) {
    lines.push("const width = thisComp.width;");
  }
  if (deps.height) {
    lines.push("const height = thisComp.height;");
  }

  // 变量（frameCount）
  if (deps.frameCount) {
    lines.push("var frameCount = currentFrame;");
  }

  return lines.join("\n");
}
