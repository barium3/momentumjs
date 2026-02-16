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
    width: sizeParams ? sizeParams.width : defaultWidth || 100,
    height: sizeParams ? sizeParams.height : defaultHeight || 100,
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

// ----------------------------------------
// Echo Effect (拖尾效果)
// ----------------------------------------

/**
 * 添加Echo效果来模拟draw中的透明background拖尾效果
 * 如果没有background，Decay=1（完全保留之前画面）
 * 如果有透明background，Decay=1-alpha（根据透明度保留）
 * 表达式会动态从engine读取最新的background的alpha值
 * 衰减只会受draw中的background影响，不会受setup中的影响
 * @param {Object} drawLayer - draw图层对象
 * @param {Object} engineComp - 主合成对象
 * @param {string} uniqueMainCompName - 主合成名称（用于表达式引用）
 * @param {number} drawBackgroundCount - draw中background的数量
 */
function addEchoEffect(drawLayer, engineComp, uniqueMainCompName, drawBackgroundCount) {
  try {
    // 获取效果容器
    var effectParade = drawLayer.property("ADBE Effect Parade");
    
    if (effectParade) {
      // 添加 Echo 效果
      var echoEffect = effectParade.addProperty("ADBE Echo");
      
      if (echoEffect) {
        // 设置echo参数：残影数量 = 主合成总帧数，时间延迟 = -1/fps（负值表示显示过去的内容）
        var totalFrames = Math.ceil(engineComp.duration * engineComp.frameRate);
        
        // 根据属性索引直接访问（属性顺序已确认）：
        // 1: 残影时间（秒）
        // 2: 残影数量
        // 3: 起始强度
        // 4: 衰减
        // 5: 残影运算符
        // 6: 合成选项
        var propCount = echoEffect.numProperties;
        var echoTimeProp = null;
        var numEchoesProp = null;
        var startingIntensityProp = null;
        var decayProp = null;
        var compositeOperatorProp = null;
        
        // 通过索引直接访问属性
        if (propCount >= 1) {
          try {
            echoTimeProp = echoEffect.property(1); // 残影时间（秒）
          } catch (e) {}
        }
        
        if (propCount >= 2) {
          try {
            numEchoesProp = echoEffect.property(2); // 残影数量
          } catch (e) {}
        }
        
        if (propCount >= 3) {
          try {
            startingIntensityProp = echoEffect.property(3); // 起始强度
          } catch (e) {}
        }
        
        if (propCount >= 4) {
          try {
            decayProp = echoEffect.property(4); // 衰减
          } catch (e) {}
        }
        
        if (propCount >= 5) {
          try {
            compositeOperatorProp = echoEffect.property(5); // 残影运算符
          } catch (e) {}
        }
        
        // 设置 Number of Echoes 表达式：使用 timeToFrames(time) 动态计算残影数量
        var numEchoesExpr = "timeToFrames(time)";
        
        // 设置 Number of Echoes 表达式
        if (numEchoesProp) {
          numEchoesProp.expression = numEchoesExpr;
        }
        
        if (startingIntensityProp) {
          try {
            startingIntensityProp.setValue(1); // Starting Intensity 范围是 0-1，1 表示 100%
          } catch (e4) {
            // 静默处理：忽略错误
          }
        }
        
        if (decayProp) {
          // 使用表达式从engine读取最新的background的alpha值
          // Decay = 1 - alpha（alpha是归一化的0-1值）
          // 如果background的alpha=0.392，则Decay=0.608，模拟透明background的拖尾效果
          // 如果没有background或alpha=1，Decay=1（不衰减）
          // 衰减只会受draw中的background影响，不会受setup中的影响
          var escapedMainCompNameForDecay = uniqueMainCompName.replace(/"/g, '\\"');
          var drawBgCount = drawBackgroundCount || 0;
          var decayExpr = [
            'var raw = comp("' + escapedMainCompNameForDecay + '").layer("__engine__").text.sourceText;',
            'var json = raw && raw.toString ? raw.toString() : raw;',
            'var data = JSON.parse(json);',
            'var backgrounds = data.backgrounds || [];',
            'var alpha = 0; // 默认值：如果没有background，alpha=0，Decay=1（完全保留）',
            '// 只考虑draw中的background，忽略setup中的background',
            'var drawBgCount = ' + drawBgCount + '; // draw中background的数量',
            'if (drawBgCount > 0 && backgrounds.length > 0) {',
            '  // 只考虑最后drawBgCount个background（这些是draw中的background）',
            '  // 获取最后一个（最新的）draw中background的alpha值',
            '  var lastBg = backgrounds[backgrounds.length - 1];',
            '  if (lastBg && lastBg.color && lastBg.color.length >= 4) {',
            '    alpha = lastBg.color[3] !== undefined ? lastBg.color[3] : 1;',
            '  }',
            '}',
            '// Decay = 1 - alpha',
            '// 如果没有draw中的background（alpha=0），则Decay=1，完全保留之前画面',
            '// 如果alpha=0.392（透明），则Decay=0.608，产生拖尾效果',
            '// 如果alpha=1（不透明），则Decay=0，不衰减（但Echo仍会工作）',
            '1 - alpha'
          ].join('\n');
          
          decayProp.expression = decayExpr;
        }
        
        // 通过表达式绑定到主合成的一帧时间，主合成参数修改后会自动更新
        // 转义合成名称中的引号
        // 注意：Echo Time 使用负值，这样每个残影会显示更早一帧的内容
        // 这样残影就会"留在经过的地方"，而不是"被拖着走"
        var escapedMainCompName = uniqueMainCompName.replace(/"/g, '\\"');
        var echoTimeExpr = "-comp(\"" + escapedMainCompName + "\").frameDuration";
        
        // 设置 Echo Time 表达式
        if (echoTimeProp) {
          echoTimeProp.expression = echoTimeExpr;
        }
        
        // 设置 Composite Operator 为从后向前组合 (Back to Front)
        if (compositeOperatorProp) {
          compositeOperatorProp.setValue(6);
        }
      }
    }
  } catch (e) {
    // 静默处理：Echo效果添加失败时忽略
  }
}
