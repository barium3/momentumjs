// ----------------------------------------
// Controller - UI 控制层与表达式控件
// 在主合成中创建置顶的调整图层，并为 createSlider() 创建对应的 Slider 控件
// ----------------------------------------

/**
 * 确保在给定合成中存在名为 "__controller__" 的置顶调整图层
 * @param {CompItem} comp - 目标合成
 * @returns {AVLayer|null} 控制图层
 */
function ensureControllerLayer(comp) {
  if (!comp) return null;

  // 查找已存在的控制图层
  for (var i = 1; i <= comp.numLayers; i++) {
    var layer = comp.layer(i);
    if (layer && layer.name === "__controller__") {
      // 确保为调整图层并移到最上方
      try {
        layer.adjustmentLayer = true;
      } catch (e) {
        // 某些图层类型不支持 adjustmentLayer，忽略错误
      }
      try {
        layer.moveToBeginning();
      } catch (e2) {}
      return layer;
    }
  }

  // 未找到则创建新的纯色调整图层
  var ctrlLayer = comp.layers.addSolid(
    [0, 0, 0], // 颜色无关紧要，作为控制图层通常不会直接渲染
    "__controller__",
    comp.width,
    comp.height,
    1,
    comp.duration
  );

  try {
    ctrlLayer.adjustmentLayer = true;
  } catch (e3) {}

  // 放到图层堆栈顶部（置顶）
  try {
    ctrlLayer.moveToBeginning();
  } catch (e4) {}

  return ctrlLayer;
}


/**
 * 使用 JSON 控制器配置在主合成中创建控制器
 *
 * JSON 结构示例（前端维护为“单一真相源”）：
 * {
 *   controllers: [
 *     {
 *       type: "slider",
 *       id: "noiseAmp",        // 稳定 ID（推荐）
 *       name: "Noise Amp",     // AE 中显示名称（可选）
 *       min: 0,
 *       max: 1,
 *       value: 0.3,            // 业务真实值（直接作为 Slider 数值）
 *       step: 0.01             // 步长（用于导出时对齐）
 *     },
 *     {
 *       type: "color",
 *       id: "mainColor",
 *       name: "Main Color",
 *       value: [1, 0, 0, 1]    // 颜色值，约定为 [r, g, b, a] 且分量在 0-1 范围
 *     }
 *   ]
 * }
 *
 * 在 AE 侧只负责两件事：
 *   1）根据配置长度创建对应数量的控制器（Slider / Color 等）；
 *   2）使用 JSON 中的 value 作为控制器的实际数值。
 *
 * @param {CompItem} comp
 * @returns {Array} 解析后的控制器配置数组
 */
function extractControllersFromContext(comp) {
  if (!comp) return [];

  var engineLayer = null;
  for (var i = 1; i <= comp.numLayers; i++) {
    var layer = comp.layer(i);
    if (layer && layer.name === "__engine__") {
      engineLayer = layer;
      break;
    }
  }

  if (!engineLayer) return [];

  var textProp = engineLayer.property("Source Text");
  if (!textProp) return [];

  var rawDoc;
  try {
    rawDoc = textProp.value;
  } catch (e) {
    return [];
  }

  var json;
  if (rawDoc && rawDoc.text !== undefined) {
    json = rawDoc.text;
  } else if (rawDoc && rawDoc.toString) {
    json = rawDoc.toString();
  } else {
    json = "" + rawDoc;
  }

  var data;
  try {
    data = JSON.parse(json);
  } catch (e2) {
    return [];
  }

  var ctrls = data && data.controllers;
  if (!ctrls || !ctrls.length) return [];

  var controllerConfigs = [];

  for (var i2 = 0; i2 < ctrls.length; i2++) {
    var c = ctrls[i2];
    if (!c) continue;

    var type = c.type || "slider";
    // index 字段目前在 AE 端不再使用，这里不再存储，避免冗余
    var cfg = {
      type: type
    };

    if (type === "slider") {
      var min = (c.min === undefined) ? 0 : Number(c.min);
      var max = (c.max === undefined) ? 100 : Number(c.max);
      var value = (c.value === undefined) ? min : Number(c.value);
      var step = (c.step === undefined) ? 0 : Number(c.step);

      cfg.id = c.id || ("slider" + (i2 + 1));
      // label 优先级：显式 name/label > 默认文案
      cfg.label = c.name || c.label || ("Slider " + (i2 + 1));
      cfg.min = min;
      cfg.max = max;
      cfg.value = value;
      cfg.step = step;
    } else if (type === "color") {
      var col = c.value;
      // value 允许为数组或缺省；缺省时使用白色
      if (!col || col.length < 3) {
        col = [1, 1, 1, 1];
      } else if (col.length === 3) {
        col = [col[0], col[1], col[2], 1];
      }

      cfg.id = c.id || ("color" + (i2 + 1));
      cfg.label = c.name || c.label || ("Color " + (i2 + 1));
      cfg.value = col;
    } else if (type === "checkbox") {
      cfg.id = c.id || ("checkbox" + (i2 + 1));
      cfg.label = c.name || c.label || ("Checkbox " + (i2 + 1));
      // JSON 中允许 value 为布尔或 0/1，这里统一转换为布尔
      var v = c.value;
      cfg.value = !!v;
    } else if (type === "select") {
      cfg.id = c.id || ("select" + (i2 + 1));
      cfg.label = c.name || c.label || ("Select " + (i2 + 1));
      // options 允许为任意数组（字符串、数字等）
      cfg.options = c.options || [];
      // value 视为索引（0 基），非法值时回退到 0
      var idx = (c.value === undefined) ? 0 : Number(c.value);
      if (isNaN(idx) || idx < 0) idx = 0;
      if (cfg.options.length > 0 && idx >= cfg.options.length) {
        idx = cfg.options.length - 1;
      }
      cfg.value = idx;
    } else if (type === "angle") {
      // Angle 控件：单一角度值（度）
      var deg = (c.value === undefined) ? 0 : Number(c.value);
      cfg.id = c.id || ("angle" + (i2 + 1));
      cfg.label = c.name || c.label || ("Angle " + (i2 + 1));
      cfg.value = deg;
    } else if (type === "point") {
      var pt = c.value;
      if (!pt || pt.length < 2) {
        pt = [0, 0];
      }
      cfg.id = c.id || ("point" + (i2 + 1));
      cfg.label = c.name || c.label || ("Point " + (i2 + 1));
      cfg.value = [Number(pt[0]), Number(pt[1])];
    } else {
      // 未识别的 controller 类型暂时忽略
      continue;
    }

    controllerConfigs.push(cfg);
  }

  return controllerConfigs;
}

function setupControllersFromConfigs(comp, controllerConfigs) {
  if (!comp) return 0;

  // 如果未显式传入配置，则尝试从 __engine__ JSON 上下文中提取
  if (!controllerConfigs || controllerConfigs.length === 0) {
    controllerConfigs = extractControllersFromContext(comp);
  }

  if (!controllerConfigs || controllerConfigs.length === 0) return 0;

  var ctrlLayer = ensureControllerLayer(comp);
  if (!ctrlLayer) return 0;

  var effectsGroup = ctrlLayer.property("ADBE Effect Parade");
  if (!effectsGroup) return 0;

  // 清空现有效果，完全由 JSON 决定结构
  for (var i = effectsGroup.numProperties; i >= 1; i--) {
    var eff = effectsGroup.property(i);
    try {
      eff.remove();
    } catch (e) {}
  }

  // 按 controllers 顺序创建效果，使索引与表达式侧保持一致
  for (var idx = 0; idx < controllerConfigs.length; idx++) {
    var cfg = controllerConfigs[idx] || {};
    var type = cfg.type || "slider";

    if (type === "slider") {
      var sliderEffect = effectsGroup.addProperty("ADBE Slider Control");
      if (!sliderEffect) continue;

      // 1）命名优先级：label > id > Slider N
      var label = cfg.label || cfg.id || ("Slider " + (idx + 1));
      try {
        sliderEffect.name = label;
      } catch (e2) {}

      // 2）根据业务 value/min/max 直接设置 Slider 的实际数值和范围
      var min = (cfg.min === undefined) ? 0 : Number(cfg.min);
      var max = (cfg.max === undefined) ? 100 : Number(cfg.max);
      var val = (cfg.value === undefined) ? min : Number(cfg.value);
      var step = (cfg.step === undefined) ? 0 : Number(cfg.step);

      try {
        var valueProp = sliderEffect.property("ADBE Slider Control-0001");
        if (valueProp) {
          // 设置初始值为“真实业务值”，保证 AE 面板显示的就是实际含义
          valueProp.setValue(val);
          // 同步设置 AE 面板中的 Slider 最小/最大值，使拖动范围与业务一致
          try {
            var minProp = sliderEffect.property("ADBE Slider Control-0002");
            var maxProp = sliderEffect.property("ADBE Slider Control-0003");
            if (minProp) minProp.setValue(min);
            if (maxProp) maxProp.setValue(max);
          } catch (eRange) {}
          // 为 Slider 本身添加表达式：对用户拖动的值按 min/max/step 做限制与步进
          try {
            var expr = "";
            // 直接内联 JSON 中的 min/max/step 数值，避免在表达式中访问效果子属性引起索引错误
            expr += "var min = " + min + ";\n";
            expr += "var max = " + max + ";\n";
            expr += "var step = " + step + ";\n";
            expr += "var v = value;\n";
            expr += "if (v < min) v = min;\n";
            expr += "if (v > max) v = max;\n";
            expr += "if (step > 0) {\n";
            expr += "  // 以 min 为基准向下取整到最近的步长（不强行取到 max）\n";
            expr += "  v = Math.floor((v - min) / step) * step + min;\n";
            expr += "  // 再做一次安全 clamp，防止数值精度导致越界\n";
            expr += "  if (v < min) v = min;\n";
            expr += "  if (v > max) v = max;\n";
            expr += "}\n";
            expr += "v;";
            valueProp.expression = expr;
            try { valueProp.expressionEnabled = true; } catch (ee) {}
          } catch (eExpr) {}
        }
      } catch (e3) {}
    } else if (type === "color") {
      // Color 控件：使用 ADBE Color Control 效果
      var colorEffect = effectsGroup.addProperty("ADBE Color Control");
      if (!colorEffect) continue;

      var colorLabel = cfg.label || cfg.id || ("Color " + (idx + 1));
      try {
        colorEffect.name = colorLabel;
      } catch (eName) {}

      var colVal = cfg.value;
      if (!colVal || colVal.length < 3) {
        colVal = [1, 1, 1, 1];
      } else if (colVal.length === 3) {
        colVal = [colVal[0], colVal[1], colVal[2], 1];
      }

      try {
        var colorProp = colorEffect.property("ADBE Color Control-0001");
        if (colorProp) {
          colorProp.setValue(colVal);
        }
      } catch (eColor) {}
    } else if (type === "checkbox") {
      // Checkbox 控件：使用 ADBE Checkbox Control 效果
      var checkboxEffect = effectsGroup.addProperty("ADBE Checkbox Control");
      if (!checkboxEffect) continue;

      var cbLabel = cfg.label || cfg.id || ("Checkbox " + (idx + 1));
      try {
        checkboxEffect.name = cbLabel;
      } catch (eCbName) {}

      var cbVal = !!cfg.value;
      try {
        var cbProp = checkboxEffect.property("ADBE Checkbox Control-0001");
        if (cbProp) {
          cbProp.setValue(cbVal ? 1 : 0);
        }
      } catch (eCb) {}
    } else if (type === "select") {
      // Select 控件：使用 AE 原生 Dropdown Menu Control
      // 注意：AE 的下拉菜单索引是 1 基，而库内部/JSON 约定为 0 基，这里做一次映射。
      var selectEffect = effectsGroup.addProperty("ADBE Dropdown Control");
      if (!selectEffect) continue;

      var selLabel = cfg.label || cfg.id || ("Select " + (idx + 1));
      try {
        selectEffect.name = selLabel;
      } catch (eSelName) {}

      var selOptions = cfg.options || [];
      var maxIndex = selOptions.length > 0 ? selOptions.length - 1 : 0; // 0 基最大索引
      if (maxIndex < 0) maxIndex = 0;

      var selVal = (cfg.value === undefined) ? 0 : Number(cfg.value); // 0 基索引
      if (isNaN(selVal) || selVal < 0) selVal = 0;
      if (selVal > maxIndex) selVal = maxIndex;

      try {
        // Dropdown Menu Control 的第一个属性是选中项索引（1 基）
        var selValueProp = selectEffect.property("ADBE Dropdown Control-0001");
        if (selValueProp) {
          // 将 0 基索引转换为 AE 的 1 基索引
          selValueProp.setValue(selVal + 1);
        }

        // 通过脚本把 options 文本真正写进 Dropdown 控件的菜单里
        // 注意：setPropertyParameters 只能在脚本环境里调用，表达式里不能用
        if (selOptions && selOptions.length > 0) {
          try {
            // 对 Dropdown 控件来说，property(1) 即菜单属性本身
            var menuProp = selectEffect.property(1);
            if (menuProp && menuProp.setPropertyParameters) {
              menuProp.setPropertyParameters(selOptions);
            }
          } catch (eMenu) {}
        }
      } catch (eSel2) {}
    } else if (type === "angle") {
      // Angle 控件：使用 ADBE Angle Control 效果
      var angleEffect = effectsGroup.addProperty("ADBE Angle Control");
      if (!angleEffect) continue;

      var angLabel = cfg.label || cfg.id || ("Angle " + (idx + 1));
      try {
        angleEffect.name = angLabel;
      } catch (eAngName) {}

      var angVal = (cfg.value === undefined) ? 0 : Number(cfg.value);
      try {
        var angProp = angleEffect.property("ADBE Angle Control-0001");
        if (angProp) {
          angProp.setValue(angVal);
        }
      } catch (eAng) {}
    } else if (type === "point") {
      // Point 控件：使用 ADBE Point Control 效果
      var pointEffect = effectsGroup.addProperty("ADBE Point Control");
      if (!pointEffect) continue;

      var ptLabel = cfg.label || cfg.id || ("Point " + (idx + 1));
      try {
        pointEffect.name = ptLabel;
      } catch (ePtName) {}

      var ptVal = cfg.value;
      if (!ptVal || ptVal.length < 2) {
        ptVal = [0, 0];
      }

      try {
        var ptProp = pointEffect.property("ADBE Point Control-0001");
        if (ptProp) {
          ptProp.setValue([Number(ptVal[0]), Number(ptVal[1])]);
        }
      } catch (ePt) {}
    }
  }

  return controllerConfigs.length;
}

// ----------------------------------------
// Expression Controller Lib - 表达式侧控制器库
// 负责为 AE 表达式注入与 controller 相关的辅助函数
// 目前支持：
//   - createSlider(min, max, value, step)
//   - createAngle(defaultDegrees)
//   - createColorPicker(...)
//   - createCheckbox(label, checked)
//   - createSelect()
//   - createPoint(defaultX, defaultY)
// ----------------------------------------

/**
 * 获取控制器表达式库
 * @param {Object} deps - 控制器依赖对象（来自 buildDepsFromRegistry('controllers')）
 *                        形如 { createSlider: true, otherController: false, ... }
 * @returns {string} 拼接好的表达式代码
 */
function getControllerLib(deps) {
  if (!deps) deps = {};

  var lib = [];

  var needControllerLib =
    deps.createSlider ||
    deps.createAngle ||
    deps.createColorPicker ||
    deps.createCheckbox ||
    deps.createSelect ||
    deps.createPoint;

  if (needControllerLib) {
    lib.push("// ========================================");
    lib.push("// 控制器公共工具：索引与导出");
    lib.push("// ========================================");
    lib.push("var _ctrlLayer = null;");
    lib.push("function _getControllerLayer() {");
    lib.push("  if (_ctrlLayer) return _ctrlLayer;");
    lib.push("  try {");
    lib.push('    _ctrlLayer = thisComp.layer(\"__controller__\");');
    lib.push("  } catch (e) {");
    lib.push("    _ctrlLayer = null;");
    lib.push("  }");
    lib.push("  return _ctrlLayer;");
    lib.push("}");
    lib.push("var __controllerIndex = 0;");
    lib.push("function _nextControllerIndex() {");
    lib.push("  __controllerIndex++;");
    lib.push("  return __controllerIndex;");
    lib.push("}");
    lib.push("function _exportController(index, type, payload) {");
    lib.push("  try {");
    lib.push("    if (typeof _ctx !== \"undefined\") {");
    lib.push("      if (!_ctx.controllers) _ctx.controllers = [];");
    lib.push("      var ctrl = _getControllerLayer();");
    lib.push("      var name = null;");
    lib.push("      try {");
    lib.push("        if (ctrl && ctrl.effect && ctrl.effect(index)) name = ctrl.effect(index).name;");
    lib.push("      } catch (eName) { name = null; }");
    lib.push("      var base = { type: type, index: index, name: name };");
    lib.push("      if (payload) {");
    lib.push("        for (var k in payload) {");
    lib.push("          if (payload.hasOwnProperty(k)) base[k] = payload[k];");
    lib.push("        }");
    lib.push("      }");
    lib.push("      _ctx.controllers[index - 1] = base;");
    lib.push("    }");
    lib.push("  } catch (eCtx) {}");
    lib.push("}");
  }

  // Slider 控件：createSlider()
  // 在表达式中提供与浏览器侧一致的 API：
  //   var slider = createSlider(min, max, value, step);
  //   var v = slider.value();
  if (deps.createSlider) {
    lib.push("// ========================================");
    lib.push("// 控制器 Slider - createSlider() 辅助函数");
    lib.push("// 每次调用 createSlider() 使用主合成中 __controller__ 图层上的 Slider N");
    lib.push("// ========================================");
    lib.push("function createSlider(min, max, value, step) {");
    lib.push("  min = (min === undefined) ? 0 : min;");
    lib.push("  max = (max === undefined) ? 100 : max;");
    lib.push("  value = (value === undefined) ? min : value;");
    lib.push("  step = (step === undefined) ? 0 : step;");
    lib.push("  var index = _nextControllerIndex();");
    lib.push("  var ctrl = _getControllerLayer();");
    lib.push("  function _clampAndSnap(v) {");
    lib.push("    // 将 Slider 的原始值限制在 [min, max]，并按 step 对齐");
    lib.push("    if (v < min) v = min;");
    lib.push("    if (v > max) v = max;");
    lib.push("    if (step && step > 0) {");
    lib.push("      // 以 min 为基准向下取整到最近的步长（不强行取到 max），例如 max=255, step=20 时最大为 240");
    lib.push("      v = Math.floor((v - min) / step) * step + min;");
    lib.push("      // 再做一次安全 clamp，防止数值精度导致越界");
    lib.push("      if (v < min) v = min;");
    lib.push("      if (v > max) v = max;");
    lib.push("    }");
    lib.push("    return v;");
    lib.push("  }");
    lib.push("  return {");
    lib.push("    value: function() {");
    lib.push("      var raw, mapped;");
    lib.push("      if (ctrl) {");
    lib.push("        try {");
    lib.push('          var prop = ctrl.effect(index)(\"ADBE Slider Control-0001\");');
    lib.push("          if (prop !== undefined && prop.value !== undefined) {");
    lib.push("            raw = prop.value;");
    lib.push("          } else {");
    lib.push("            raw = value;");
    lib.push("          }");
    lib.push("        } catch (e) {");
    lib.push("          raw = value;");
    lib.push("        }");
    lib.push("        mapped = _clampAndSnap(raw);");
    lib.push("      } else {");
    lib.push("        // 没有 __controller__ 图层时，将传入的 value 视为业务值");
    lib.push("        mapped = _clampAndSnap(value);");
    lib.push("        raw = mapped;");
    lib.push("      }");
    lib.push("      _exportController(index, \"slider\", {");
    lib.push("        min: min,");
    lib.push("        max: max,");
    lib.push("        step: step,");
    lib.push("        value: mapped,");
    lib.push("        raw: raw");
    lib.push("      });");
    lib.push("      return mapped;");
    lib.push("    }");
    lib.push("  };");
    lib.push("}");
  }

  // Angle 控件：createAngle()
  // 在表达式中提供与浏览器侧一致的 API：
  //   var ang = createAngle(defaultDegrees);
  //   var v = ang.value();    // 以“度”为单位
  //   var d = ang.degrees();  // 同 value()
  //   var r = ang.radians();  // 转换为弧度
  if (deps.createAngle) {
    lib.push("// ========================================");
    lib.push("// 控制器 Angle - createAngle() 辅助函数");
    lib.push("// 使用主合成中 __controller__ 图层上的 Angle Control N");
    lib.push("// 约定：内部统一使用“度”作为存储单位，按需在表达式中转换为弧度");
    lib.push("// ========================================");
    lib.push("function createAngle(defaultDegrees) {");
    lib.push("  var def = (defaultDegrees === undefined) ? 0 : defaultDegrees;");
    lib.push("  var index = _nextControllerIndex();");
    lib.push("  var ctrl = _getControllerLayer();");
    lib.push("  function _getRaw() {");
    lib.push("    var raw = def;");
    lib.push("    if (ctrl) {");
    lib.push("      try {");
    lib.push('        var prop = ctrl.effect(index)(\"ADBE Angle Control-0001\");');
    lib.push("        if (prop !== undefined && prop.value !== undefined) {");
    lib.push("          raw = prop.value;");
    lib.push("        }");
    lib.push("      } catch (e) {}");
    lib.push("    }");
    lib.push("    return raw;");
    lib.push("  }");
    lib.push("  return {");
    lib.push("    value: function() {");
    lib.push("      var raw = _getRaw();");
    lib.push("      var mapped = raw;");
    lib.push("      _exportController(index, \"angle\", {");
    lib.push("        value: mapped,");
    lib.push("        raw: raw,");
    lib.push("        degrees: raw,");
    lib.push("        radians: raw * Math.PI / 180");
    lib.push("      });");
    lib.push("      return mapped;");
    lib.push("    },");
    lib.push("    degrees: function() {");
    lib.push("      // 复用 value()，确保也会导出 controller 元数据");
    lib.push("      return this.value();");
    lib.push("    },");
    lib.push("    radians: function() {");
    lib.push("      // 同样通过 value() 触发导出，再转为弧度");
    lib.push("      return this.value() * Math.PI / 180;");
    lib.push("    }");
    lib.push("  };");
    lib.push("}");
  }

  // Color 控件：createColorPicker()
  // API（仅支持标量和十六进制，不再支持数组旧写法）：
  //   - var picker = createColorPicker(r, g, b, a);
  //   - var picker = createColorPicker("#ff0000");
  //      var c = picker.color();  // 返回 [r, g, b, a] 数组，可直接用于 fill()/stroke()
  //      var hex = picker.value(); // 返回十六进制字符串，如 "#ff0000"
  // 约定：颜色数组分量在 0-1 范围内，缺省为 [1,1,1,1]
  if (deps.createColorPicker) {
    lib.push("// ========================================");
    lib.push("// 控制器 Color - createColorPicker() 辅助函数");
    lib.push("// 使用主合成中 __controller__ 图层上的 Color Control N");
    lib.push("// ========================================");
    lib.push("function createColorPicker(r, g, b, a) {");
    lib.push("  var def;");
    lib.push("  // 1）如果只传入一个参数，只接受十六进制字符串");
    lib.push("  if (arguments.length === 1) {");
    lib.push("    var initialColor = r;");
    lib.push("    if (!initialColor) {");
    lib.push("      def = [1, 1, 1, 1];");
    lib.push("    } else if (typeof initialColor === \"string\") {");
    lib.push("      // 简单解析 \"#rrggbb\" 或 \"#rrggbbaa\" 到 [r,g,b,a]");
    lib.push("      var s = initialColor;");
    lib.push("      if (s.charAt(0) === \"#\") s = s.substring(1);");
    lib.push("      if (s.length === 3 || s.length === 4) {");
    lib.push("        // #rgb / #rgba 缩写形式");
    lib.push("        var rHex = s.charAt(0) + s.charAt(0);");
    lib.push("        var gHex = s.charAt(1) + s.charAt(1);");
    lib.push("        var bHex = s.charAt(2) + s.charAt(2);");
    lib.push("        var aHex = s.length === 4 ? (s.charAt(3) + s.charAt(3)) : \"ff\";");
    lib.push("        var rv = parseInt(rHex, 16) / 255;");
    lib.push("        var gv = parseInt(gHex, 16) / 255;");
    lib.push("        var bv = parseInt(bHex, 16) / 255;");
    lib.push("        var av = parseInt(aHex, 16) / 255;");
    lib.push("        def = [rv, gv, bv, av];");
    lib.push("      } else if (s.length === 6 || s.length === 8) {");
    lib.push("        var rHex2 = s.substring(0, 2);");
    lib.push("        var gHex2 = s.substring(2, 4);");
    lib.push("        var bHex2 = s.substring(4, 6);");
    lib.push("        var aHex2 = s.length === 8 ? s.substring(6, 8) : \"ff\";");
    lib.push("        var rv2 = parseInt(rHex2, 16) / 255;");
    lib.push("        var gv2 = parseInt(gHex2, 16) / 255;");
    lib.push("        var bv2 = parseInt(bHex2, 16) / 255;");
    lib.push("        var av2 = parseInt(aHex2, 16) / 255;");
    lib.push("        def = [rv2, gv2, bv2, av2];");
    lib.push("      } else {");
    lib.push("        def = [1, 1, 1, 1];");
    lib.push("      }");
    lib.push("    } else {");
    lib.push("      // 非字符串（包括旧数组写法）一律视为无效，回退为白色");
    lib.push("      def = [1, 1, 1, 1];");
    lib.push("    }");
    lib.push("  } else if (arguments.length >= 3) {");
    lib.push("    // 2）支持直接传入 r, g, b, a 四个参数，约定统一为 0-255 取值范围");
    lib.push("    //    例如：createColorPicker(0, 0, 255);");
    lib.push("    var rr = (r === undefined) ? 255 : r;");
    lib.push("    var gg = (g === undefined) ? 255 : g;");
    lib.push("    var bb = (b === undefined) ? 255 : b;");
    lib.push("    var aa = (a === undefined) ? 255 : a;");
    lib.push("    // 统一从 0-255 归一化到 0-1");
    lib.push("    rr = rr / 255;");
    lib.push("    gg = gg / 255;");
    lib.push("    bb = bb / 255;");
    lib.push("    aa = aa / 255;");
    lib.push("    def = [rr, gg, bb, aa];");
    lib.push("  } else {");
    lib.push("    // 3）兜底：使用白色");
    lib.push("    def = [1, 1, 1, 1];");
    lib.push("  }");
    lib.push("  var index = _nextControllerIndex();");
    lib.push("  var ctrl = _getControllerLayer();");
    lib.push("  // 颜色数组转十六进制字符串");
    lib.push("  function _colorArrayToHex(arr) {");
    lib.push("    if (!arr || !arr.length) return \"#000000\";");
    lib.push("    var r = Math.round(Math.max(0, Math.min(1, arr[0])) * 255);");
    lib.push("    var g = Math.round(Math.max(0, Math.min(1, arr[1])) * 255);");
    lib.push("    var b = Math.round(Math.max(0, Math.min(1, arr[2])) * 255);");
    lib.push("    var a = arr[3] !== undefined ? Math.round(Math.max(0, Math.min(1, arr[3])) * 255) : 255;");
    lib.push("    var hex = \"#\" + (r < 16 ? \"0\" : \"\") + r.toString(16) +");
    lib.push("                (g < 16 ? \"0\" : \"\") + g.toString(16) +");
    lib.push("                (b < 16 ? \"0\" : \"\") + b.toString(16);");
    lib.push("    if (a < 255) {");
    lib.push("      hex += (a < 16 ? \"0\" : \"\") + a.toString(16);");
    lib.push("    }");
    lib.push("    return hex;");
    lib.push("  }");
    lib.push("  return {");
    lib.push("    // 返回颜色数组 [r, g, b, a]，可直接用于 fill()/stroke()");
    lib.push("    color: function() {");
    lib.push("      var raw = def;");
    lib.push("      if (ctrl) {");
    lib.push("        try {");
    lib.push('          var prop = ctrl.effect(index)(\"ADBE Color Control-0001\");');
    lib.push("          if (prop && prop.value && prop.value.length) {");
    lib.push("            raw = prop.value;");
    lib.push("          }");
    lib.push("        } catch (e) {}");
    lib.push("      }");
    lib.push("      var mapped = raw;");
    lib.push("      _exportController(index, \"color\", {");
    lib.push("        value: mapped,");
    lib.push("        raw: raw");
    lib.push("      });");
    lib.push("      return mapped;");
    lib.push("    },");
    lib.push("    // 返回十六进制字符串，如 \"#ff0000\" 或 \"#ff0000ff\"");
    lib.push("    value: function() {");
    lib.push("      var colorArr = this.color();");
    lib.push("      return _colorArrayToHex(colorArr);");
    lib.push("    }");
    lib.push("  };");
    lib.push("}");
  }

  // Checkbox 控件：createCheckbox()
  // p5 风格 API（做了简化）：
  //   var cb = createCheckbox(label, checked);  // 推荐（接近 p5）
  //   if (cb.checked()) { ... }                 // getter：返回布尔
  //   cb.value();                               // value() 为 checked() 的别名
  if (deps.createCheckbox) {
    lib.push("// ========================================");
    lib.push("// 控制器 Checkbox - createCheckbox() 辅助函数");
    lib.push("// 使用主合成中 __controller__ 图层上的 Checkbox Control N");
    lib.push("// ========================================");
    lib.push("function createCheckbox(label, checked) {");
    lib.push("  var def = !!checked;");
    lib.push("  var index = _nextControllerIndex();");
    lib.push("  var ctrl = _getControllerLayer();");
    lib.push("  return {");
    lib.push("    value: function() {");
    lib.push("      var raw;");
    lib.push("      if (ctrl) {");
    lib.push("        try {");
    lib.push('          var prop = ctrl.effect(index)(\"ADBE Checkbox Control-0001\");');
    lib.push("          if (prop !== undefined && prop.value !== undefined) {");
    lib.push("            raw = !!prop.value;");
    lib.push("          } else {");
    lib.push("            raw = def;");
    lib.push("          }");
    lib.push("        } catch (e) {");
    lib.push("          raw = def;");
    lib.push("        }");
    lib.push("      } else {");
    lib.push("        raw = def;");
    lib.push("      }");
    lib.push("      var checked = !!raw;");
    lib.push("      _exportController(index, \"checkbox\", {");
    lib.push("        label: label,");
    lib.push("        value: checked,");
    lib.push("        checked: checked");
    lib.push("      });");
    lib.push("      return checked;");
    lib.push("    },");
    lib.push("    checked: function() {");
    lib.push("      return this.value();");
    lib.push("    }");
    lib.push("  };");
    lib.push("}");
  }

  // Select 控件：createSelect()
  // 更接近 p5.dom 的 API（做了简化）：
  //   // 推荐用法（p5 风格）
  //   var sel = createSelect();
  //   sel.option("A");
  //   sel.option("B");
  //   sel.option("C");
  //   sel.selected("B");         // 可选：设置默认选中项（按值或索引）
  //   var v = sel.value();       // 返回当前选中项的“值”（字符串/数字等）
  //   var i = sel.index();       // 返回当前索引（0 基）
  //
  if (deps.createSelect) {
    lib.push("// ========================================");
    lib.push("// 控制器 Select - createSelect() 辅助函数");
    lib.push("// 使用主合成中 __controller__ 图层上的 Dropdown Menu Control N 作为枚举索引");
    lib.push("// ========================================");
    lib.push("function createSelect() {");
    lib.push("  var options = [];");
    lib.push("  var defIndex = 0;");
    lib.push("  function _len() {");
    lib.push("    var len = options.length;");
    lib.push("    if (len <= 0) len = 1;");
    lib.push("    return len;");
    lib.push("  }");
    lib.push("  function _clampIndex(v) {");
    lib.push("    var len = _len();");
    lib.push("    if (v < 0) v = 0;");
    lib.push("    if (v > len - 1) v = len - 1;");
    lib.push("    // 只允许整数索引");
    lib.push("    v = Math.round(v);");
    lib.push("    if (v < 0) v = 0;");
    lib.push("    if (v > len - 1) v = len - 1;");
    lib.push("    return v;");
    lib.push("  }");
    lib.push("  var index = _nextControllerIndex();");
    lib.push("  var ctrl = _getControllerLayer();");
    lib.push("  return {");
    lib.push("    // p5 风格：sel.option(label, [value])");
    lib.push("    option: function(label, value) {");
    lib.push("      var v = (arguments.length >= 2) ? value : label;");
    lib.push("      options.push(v);");
    lib.push("      return this;");
    lib.push("    },");
    lib.push("    // getter：返回当前索引（0 基）");
    lib.push("    index: function() {");
    lib.push("      var rawAE, raw;");
    lib.push("      if (ctrl) {");
    lib.push("        try {");
    lib.push('          var prop = ctrl.effect(index)(\"ADBE Dropdown Control-0001\");');
    lib.push("          if (prop !== undefined && prop.value !== undefined) {");
    lib.push("            // AE Dropdown 的值是 1 基索引，这里转换为 0 基");
    lib.push("            rawAE = prop.value;");
    lib.push("            raw = rawAE - 1;");
    lib.push("          } else {");
    lib.push("            rawAE = defIndex + 1;");
    lib.push("            raw = defIndex;");
    lib.push("          }");
    lib.push("        } catch (e) {");
    lib.push("          rawAE = defIndex + 1;");
    lib.push("          raw = defIndex;");
    lib.push("        }");
    lib.push("      } else {");
    lib.push("        rawAE = defIndex + 1;");
    lib.push("        raw = defIndex;");
    lib.push("      }");
    lib.push("      var idx = _clampIndex(raw);");
    lib.push("      _exportController(index, \"select\", {");
    lib.push("        options: options,");
    lib.push("        value: idx,");
    lib.push("        raw: rawAE");
    lib.push("      });");
    lib.push("      return idx;");
    lib.push("    },");
    lib.push("    // getter：返回当前选中项对应的“值”（与 p5 的 value() 类似）");
    lib.push("    value: function() {");
    lib.push("      var len = _len();");
    lib.push("      if (len <= 0) return null;");
    lib.push("      var idx = this.index();");
    lib.push("      if (idx < 0 || idx >= options.length) {");
    lib.push("        // 如果 AE 侧长度更大，以 AE 长度为准做 clamp，但没有对应值时返回 null");
    lib.push("        return null;");
    lib.push("      }");
    lib.push("      return options[idx];");
    lib.push("    },");
    lib.push("    // p5 风格：selected(v) 作为 setter（这里只用于设置默认值）");
    lib.push("    // - 传入数字时按索引");
    lib.push("    // - 传入字符串/其他时，在 options 中查找第一个等于该值的项");
    lib.push("    // - 不传参数时，作为别名：返回 this.value()");
    lib.push("    selected: function(v) {");
    lib.push("      if (arguments.length === 0) {");
    lib.push("        return this.value();");
    lib.push("      }");
    lib.push("      var len = _len();");
    lib.push("      if (len <= 0) {");
    lib.push("        defIndex = 0;");
    lib.push("        return this;");
    lib.push("      }");
    lib.push("      var idx = -1;");
    lib.push("      if (typeof v === \"number\") {");
    lib.push("        idx = v;");
    lib.push("      } else {");
    lib.push("        for (var i = 0; i < options.length; i++) {");
    lib.push("          if (options[i] === v) {");
    lib.push("            idx = i;");
    lib.push("            break;");
    lib.push("          }");
    lib.push("        }");
    lib.push("      }");
    lib.push("      if (idx < 0) idx = 0;");
    lib.push("      defIndex = _clampIndex(idx);");
    lib.push("      return this;");
    lib.push("    }");
    lib.push("  };");
    lib.push("}");
  }

  // Point 控件：createPoint()
  // API：
  //   var pt = createPoint(defaultX, defaultY);
  //   var v = pt.value(); // [x, y]
  //   var x = pt.x();
  //   var y = pt.y();
  if (deps.createPoint) {
    lib.push("// ========================================");
    lib.push("// 控制器 Point - createPoint() 辅助函数");
    lib.push("// 使用主合成中 __controller__ 图层上的 Point Control N");
    lib.push("// ========================================");
    lib.push("function createPoint(defaultX, defaultY) {");
    lib.push("  var defX = (defaultX === undefined) ? 0 : defaultX;");
    lib.push("  var defY = (defaultY === undefined) ? 0 : defaultY;");
    lib.push("  var index = _nextControllerIndex();");
    lib.push("  var ctrl = _getControllerLayer();");
    lib.push("  function _getRaw() {");
    lib.push("    var raw = [defX, defY];");
    lib.push("    if (ctrl) {");
    lib.push("      try {");
    lib.push('        var prop = ctrl.effect(index)(\"ADBE Point Control-0001\");');
    lib.push("        if (prop !== undefined && prop.value !== undefined && prop.value.length >= 2) {");
    lib.push("          raw = [prop.value[0], prop.value[1]];");
    lib.push("        }");
    lib.push("      } catch (e) {}");
    lib.push("    }");
    lib.push("    return raw;");
    lib.push("  }");
    lib.push("  return {");
    lib.push("    value: function() {");
    lib.push("      var raw = _getRaw();");
    lib.push("      var x = raw[0];");
    lib.push("      var y = raw[1];");
    lib.push("      var mapped = [x, y];");
    lib.push("      _exportController(index, \"point\", {");
    lib.push("        value: mapped,");
    lib.push("        raw: raw,");
    lib.push("        x: x,");
    lib.push("        y: y");
    lib.push("      });");
    lib.push("      return mapped;");
    lib.push("    },");
    lib.push("    x: function() {");
    lib.push("      return this.value()[0];");
    lib.push("    },");
    lib.push("    y: function() {");
    lib.push("      return this.value()[1];");
    lib.push("    }");
    lib.push("  };");
    lib.push("}");
  }

  return lib.join("\n");
}

