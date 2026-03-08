// ----------------------------------------
// Controller - UI 控制层与表达式控件
// 负责两件事：
// 1. 在 AE 侧创建并同步 __controller__ 图层上的效果控件
// 2. 在表达式侧提供 createSlider/createAngle/... 等控制器 API
// ----------------------------------------

function _findLayerByName(comp, name) {
  if (!comp || !name) return null;
  for (var i = 1; i <= comp.numLayers; i++) {
    var layer = comp.layer(i);
    if (layer && layer.name === name) return layer;
  }
  return null;
}

function _textDocumentValue(rawDoc) {
  if (rawDoc && rawDoc.text !== undefined) return rawDoc.text;
  if (rawDoc && rawDoc.toString) return rawDoc.toString();
  return "" + rawDoc;
}

function _readEngineContext(comp) {
  var engineLayer = _findLayerByName(comp, "__engine__");
  if (!engineLayer) return null;

  var textProp = engineLayer.property("Source Text");
  if (!textProp) return null;

  var rawDoc;
  try {
    rawDoc = textProp.value;
  } catch (e) {
    return null;
  }

  try {
    return JSON.parse(_textDocumentValue(rawDoc));
  } catch (e2) {
    return null;
  }
}

function _defaultControllerLabel(type, index) {
  var n = index + 1;
  if (type === "color") return "Color " + n;
  if (type === "checkbox") return "Checkbox " + n;
  if (type === "select") return "Select " + n;
  if (type === "angle") return "Angle " + n;
  if (type === "point") return "Point " + n;
  if (type === "path") return "Path " + n;
  return "Slider " + n;
}

function _sanitizePathMaskName(name, index) {
  var key = String(name || "path" + (index + 1))
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^(\d)/, "_$1");
  return "__path__" + key;
}

function _normalizeControllerConfig(c, index) {
  if (!c) return null;

  var type = c.type || "slider";
  var cfg = { type: type };
  cfg.id = c.id || type + (index + 1);
  cfg.label = c.name || c.label || _defaultControllerLabel(type, index);

  if (type === "slider") {
    var min = c.min === undefined ? 0 : Number(c.min);
    var max = c.max === undefined ? 100 : Number(c.max);
    cfg.min = min;
    cfg.max = max;
    cfg.value = c.value === undefined ? min : Number(c.value);
    cfg.step = c.step === undefined ? 0 : Number(c.step);
    return cfg;
  }

  if (type === "color") {
    var col = c.value;
    if (!col || col.length < 3) col = [1, 1, 1, 1];
    else if (col.length === 3) col = [col[0], col[1], col[2], 1];
    cfg.value = col;
    return cfg;
  }

  if (type === "checkbox") {
    cfg.value = !!c.value;
    return cfg;
  }

  if (type === "select") {
    cfg.options = c.options || [];
    var idx = c.value === undefined ? 0 : Number(c.value);
    if (isNaN(idx) || idx < 0) idx = 0;
    if (cfg.options.length > 0 && idx >= cfg.options.length) {
      idx = cfg.options.length - 1;
    }
    cfg.value = idx;
    return cfg;
  }

  if (type === "angle") {
    cfg.value = c.value === undefined ? 0 : Number(c.value);
    return cfg;
  }

  if (type === "point") {
    var pt = c.value;
    if (!pt || pt.length < 2) pt = [0, 0];
    cfg.value = [Number(pt[0]), Number(pt[1])];
    return cfg;
  }

  if (type === "path") {
    var points = c.points;
    if (!points || !points.length || points.length < 2) points = null;
    cfg.maskName = c.maskName || _sanitizePathMaskName(c.id, index);
    cfg.points = points;
    cfg.closed = c.closed !== undefined ? !!c.closed : false;
    return cfg;
  }

  return null;
}

function _clearEffects(effectsGroup) {
  if (!effectsGroup) return;
  for (var i = effectsGroup.numProperties; i >= 1; i--) {
    var eff = effectsGroup.property(i);
    try {
      eff.remove();
    } catch (e) {}
  }
}

function _addNamedEffect(effectsGroup, matchName, label) {
  var effect = effectsGroup.addProperty(matchName);
  if (!effect) return null;
  try {
    effect.name = label;
  } catch (e) {}
  return effect;
}

function _setEffectValue(effect, propName, value) {
  try {
    var prop = effect && effect.property ? effect.property(propName) : null;
    if (prop) {
      prop.setValue(value);
      return prop;
    }
  } catch (e) {}
  return null;
}

function _buildSliderClampExpr(min, max, step) {
  return [
    "var min = " + min + ";",
    "var max = " + max + ";",
    "var step = " + step + ";",
    "var v = value;",
    "if (v < min) v = min;",
    "if (v > max) v = max;",
    "if (step > 0) {",
    "  v = Math.floor((v - min) / step) * step + min;",
    "  if (v < min) v = min;",
    "  if (v > max) v = max;",
    "}",
    "v;",
  ].join("\n");
}

function _defaultPathPoints(comp) {
  var w = comp && comp.width ? Number(comp.width) : 1920;
  var h = comp && comp.height ? Number(comp.height) : 1080;
  return [
    [w / 3, h / 2],
    [(w * 2) / 3, h / 2],
  ];
}

function _shapeFromPoints(points, closed) {
  var shape = new Shape();
  shape.vertices = points;
  shape.inTangents = [];
  shape.outTangents = [];
  for (var i = 0; i < points.length; i++) {
    shape.inTangents.push([0, 0]);
    shape.outTangents.push([0, 0]);
  }
  shape.closed = !!closed;
  return shape;
}

function _ensurePathMask(ctrlLayer, cfg, comp, index) {
  if (!ctrlLayer || !cfg) return null;
  var maskGroup = ctrlLayer.property("ADBE Mask Parade");
  if (!maskGroup) return null;

  var maskName = cfg.maskName || _sanitizePathMaskName(cfg.id, index);
  for (var i = 1; i <= maskGroup.numProperties; i++) {
    var existing = maskGroup.property(i);
    if (existing && existing.name === maskName) {
      return existing;
    }
  }

  var mask = maskGroup.addProperty("ADBE Mask Atom");
  if (!mask) return null;
  try {
    mask.name = maskName;
  } catch (e) {}

  var pts =
    cfg.points && cfg.points.length >= 2
      ? cfg.points
      : _defaultPathPoints(comp);
  var normalized = [];
  for (var j = 0; j < pts.length; j++) {
    var p = pts[j] || [0, 0];
    normalized.push([Number(p[0]) || 0, Number(p[1]) || 0]);
  }

  try {
    var pathProp = mask.property("ADBE Mask Shape");
    if (pathProp) {
      pathProp.setValue(_shapeFromPoints(normalized, cfg.closed !== false));
    }
  } catch (e2) {}

  return mask;
}

function ensureControllerLayer(comp) {
  if (!comp) return null;

  var existing = _findLayerByName(comp, "__controller__");
  if (existing) {
    try {
      existing.adjustmentLayer = true;
    } catch (e) {}
    try {
      existing.moveToBeginning();
    } catch (e2) {}
    return existing;
  }

  var ctrlLayer = comp.layers.addShape();
  ctrlLayer.name = "__controller__";

  try {
    ctrlLayer.adjustmentLayer = true;
  } catch (e3) {}

  try {
    var anchorPoint = ctrlLayer.property("Anchor Point");
    if (anchorPoint) {
      anchorPoint.expression =
        "[" + comp.width / 2 + ", " + comp.height / 2 + "]";
      anchorPoint.expressionEnabled = true;
    }

    var position = ctrlLayer.property("Position");
    if (position) {
      position.expression = "[" + comp.width / 2 + ", " + comp.height / 2 + "]";
      position.expressionEnabled = true;
    }

    var scale = ctrlLayer.property("Scale");
    if (scale) {
      scale.expression = "[100, 100]";
      scale.expressionEnabled = true;
    }

    var rotation = ctrlLayer.property("Rotation");
    if (rotation) {
      rotation.expression = "0";
      rotation.expressionEnabled = true;
    }

    var opacity = ctrlLayer.property("Opacity");
    if (opacity) {
      opacity.expression = "0";
      opacity.expressionEnabled = true;
    }
  } catch (eTransform) {}

  try {
    ctrlLayer.moveToBeginning();
  } catch (e4) {}

  return ctrlLayer;
}

function extractControllersFromContext(comp) {
  if (!comp) return [];

  var data = _readEngineContext(comp);
  var ctrls = data && data.controllers;
  if (!ctrls || !ctrls.length) return [];

  var controllerConfigs = [];
  for (var i2 = 0; i2 < ctrls.length; i2++) {
    var cfg = _normalizeControllerConfig(ctrls[i2], i2);
    if (cfg) controllerConfigs.push(cfg);
  }

  return controllerConfigs;
}

function setupControllersFromConfigs(comp, controllerConfigs) {
  if (!comp) return 0;

  if (!controllerConfigs || controllerConfigs.length === 0) {
    controllerConfigs = extractControllersFromContext(comp);
  }

  if (!controllerConfigs || controllerConfigs.length === 0) return 0;

  var ctrlLayer = ensureControllerLayer(comp);
  if (!ctrlLayer) return 0;

  var effectsGroup = ctrlLayer.property("ADBE Effect Parade");
  if (!effectsGroup) return 0;

  _clearEffects(effectsGroup);

  for (var idx = 0; idx < controllerConfigs.length; idx++) {
    var cfg = controllerConfigs[idx] || {};
    var type = cfg.type || "slider";

    if (type === "slider") {
      var sliderEffect = _addNamedEffect(
        effectsGroup,
        "ADBE Slider Control",
        cfg.label || cfg.id || "Slider " + (idx + 1),
      );
      if (!sliderEffect) continue;

      var min = cfg.min === undefined ? 0 : Number(cfg.min);
      var max = cfg.max === undefined ? 100 : Number(cfg.max);
      var val = cfg.value === undefined ? min : Number(cfg.value);
      var step = cfg.step === undefined ? 0 : Number(cfg.step);

      try {
        var valueProp = _setEffectValue(
          sliderEffect,
          "ADBE Slider Control-0001",
          val,
        );
        if (valueProp) {
          try {
            _setEffectValue(sliderEffect, "ADBE Slider Control-0002", min);
            _setEffectValue(sliderEffect, "ADBE Slider Control-0003", max);
          } catch (eRange) {}
          try {
            valueProp.expression = _buildSliderClampExpr(min, max, step);
            try {
              valueProp.expressionEnabled = true;
            } catch (ee) {}
          } catch (eExpr) {}
        }
      } catch (e3) {}
    } else if (type === "color") {
      var colorEffect = _addNamedEffect(
        effectsGroup,
        "ADBE Color Control",
        cfg.label || cfg.id || "Color " + (idx + 1),
      );
      if (!colorEffect) continue;

      var colVal = cfg.value;
      if (!colVal || colVal.length < 3) {
        colVal = [1, 1, 1, 1];
      } else if (colVal.length === 3) {
        colVal = [colVal[0], colVal[1], colVal[2], 1];
      }

      try {
        _setEffectValue(colorEffect, "ADBE Color Control-0001", colVal);
      } catch (eColor) {}
    } else if (type === "checkbox") {
      var checkboxEffect = _addNamedEffect(
        effectsGroup,
        "ADBE Checkbox Control",
        cfg.label || cfg.id || "Checkbox " + (idx + 1),
      );
      if (!checkboxEffect) continue;

      var cbVal = !!cfg.value;
      try {
        _setEffectValue(
          checkboxEffect,
          "ADBE Checkbox Control-0001",
          cbVal ? 1 : 0,
        );
      } catch (eCb) {}
    } else if (type === "select") {
      var selectEffect = _addNamedEffect(
        effectsGroup,
        "ADBE Dropdown Control",
        cfg.label || cfg.id || "Select " + (idx + 1),
      );
      if (!selectEffect) continue;

      var selOptions = cfg.options || [];
      var maxIndex = selOptions.length > 0 ? selOptions.length - 1 : 0;
      if (maxIndex < 0) maxIndex = 0;

      var selVal = cfg.value === undefined ? 0 : Number(cfg.value);
      if (isNaN(selVal) || selVal < 0) selVal = 0;
      if (selVal > maxIndex) selVal = maxIndex;

      try {
        _setEffectValue(selectEffect, "ADBE Dropdown Control-0001", selVal + 1);

        if (selOptions && selOptions.length > 0) {
          try {
            var menuProp = selectEffect.property(1);
            if (menuProp && menuProp.setPropertyParameters) {
              menuProp.setPropertyParameters(selOptions);
            }
          } catch (eMenu) {}
        }
      } catch (eSel2) {}
    } else if (type === "angle") {
      var angleEffect = _addNamedEffect(
        effectsGroup,
        "ADBE Angle Control",
        cfg.label || cfg.id || "Angle " + (idx + 1),
      );
      if (!angleEffect) continue;

      var angVal = cfg.value === undefined ? 0 : Number(cfg.value);
      try {
        _setEffectValue(angleEffect, "ADBE Angle Control-0001", angVal);
      } catch (eAng) {}
    } else if (type === "point") {
      var pointEffect = _addNamedEffect(
        effectsGroup,
        "ADBE Point Control",
        cfg.label || cfg.id || "Point " + (idx + 1),
      );
      if (!pointEffect) continue;

      var ptVal = cfg.value;
      if (!ptVal || ptVal.length < 2) {
        ptVal = [0, 0];
      }

      try {
        _setEffectValue(pointEffect, "ADBE Point Control-0001", [
          Number(ptVal[0]),
          Number(ptVal[1]),
        ]);
      } catch (ePt) {}
    } else if (type === "path") {
      _ensurePathMask(ctrlLayer, cfg, comp, idx);
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
  function pushBlock(lines) {
    lib.push(lines.join("\n"));
  }

  var needControllerLib =
    deps.createSlider ||
    deps.createAngle ||
    deps.createColorPicker ||
    deps.createCheckbox ||
    deps.createSelect ||
    deps.createPoint ||
    deps.createPathController;

  if (needControllerLib) {
    pushBlock([
      "// Controller helpers",
      "var _ctrlLayer = null;",
      "function _getControllerLayer() {",
      "  if (_ctrlLayer) return _ctrlLayer;",
      "  try {",
      '    _ctrlLayer = thisComp.layer("__controller__");',
      "  } catch (e) {",
      "    _ctrlLayer = null;",
      "  }",
      "  return _ctrlLayer;",
      "}",
      "var __controllerIndex = 0;",
      "function _nextControllerIndex() {",
      "  __controllerIndex++;",
      "  return __controllerIndex;",
      "}",
      "function _exportController(index, type, payload) {",
      "  try {",
      '    if (typeof _ctx !== "undefined") {',
      "      if (!_ctx.controllers) _ctx.controllers = [];",
      "      var ctrl = _getControllerLayer();",
      "      var name = null;",
      "      try {",
      "        if (ctrl && ctrl.effect && ctrl.effect(index)) name = ctrl.effect(index).name;",
      "      } catch (eName) { name = null; }",
      "      var base = { type: type, index: index, name: name };",
      "      if (payload) {",
      "        for (var k in payload) {",
      "          if (payload.hasOwnProperty(k)) base[k] = payload[k];",
      "        }",
      "      }",
      "      _ctx.controllers[index - 1] = base;",
      "    }",
      "  } catch (eCtx) {}",
      "}",
      "function _pushController(type, payload) {",
      "  try {",
      '    if (typeof _ctx !== "undefined") {',
      "      if (!_ctx.controllers) _ctx.controllers = [];",
      "      var base = { type: type };",
      "      if (payload) {",
      "        for (var k in payload) {",
      "          if (payload.hasOwnProperty(k)) base[k] = payload[k];",
      "        }",
      "      }",
      "      _ctx.controllers.push(base);",
      "      return _ctx.controllers.length - 1;",
      "    }",
      "  } catch (ePush) {}",
      "  return -1;",
      "}",
    ]);
  }

  // Slider 控件：createSlider()
  // 在表达式中提供与浏览器侧一致的 API：
  //   var slider = createSlider(min, max, value, step);
  //   var v = slider.value();
  if (deps.createSlider) {
    lib.push("// ========================================");
    lib.push("// 控制器 Slider - createSlider() 辅助函数");
    lib.push(
      "// 每次调用 createSlider() 使用主合成中 __controller__ 图层上的 Slider N",
    );
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
    lib.push(
      "      // 以 min 为基准向下取整到最近的步长（不强行取到 max），例如 max=255, step=20 时最大为 240",
    );
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
    lib.push(
      '          var prop = ctrl.effect(index)(\"ADBE Slider Control-0001\");',
    );
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
    lib.push(
      "        // 没有 __controller__ 图层时，将传入的 value 视为业务值",
    );
    lib.push("        mapped = _clampAndSnap(value);");
    lib.push("        raw = mapped;");
    lib.push("      }");
    lib.push('      _exportController(index, "slider", {');
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
    lib.push(
      "  var def = (defaultDegrees === undefined) ? 0 : defaultDegrees;",
    );
    lib.push("  var index = _nextControllerIndex();");
    lib.push("  var ctrl = _getControllerLayer();");
    lib.push("  function _getRaw() {");
    lib.push("    var raw = def;");
    lib.push("    if (ctrl) {");
    lib.push("      try {");
    lib.push(
      '        var prop = ctrl.effect(index)(\"ADBE Angle Control-0001\");',
    );
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
    lib.push('      _exportController(index, "angle", {');
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
    lib.push('    } else if (typeof initialColor === "string") {');
    lib.push('      // 简单解析 "#rrggbb" 或 "#rrggbbaa" 到 [r,g,b,a]');
    lib.push("      var s = initialColor;");
    lib.push('      if (s.charAt(0) === "#") s = s.substring(1);');
    lib.push("      if (s.length === 3 || s.length === 4) {");
    lib.push("        // #rgb / #rgba 缩写形式");
    lib.push("        var rHex = s.charAt(0) + s.charAt(0);");
    lib.push("        var gHex = s.charAt(1) + s.charAt(1);");
    lib.push("        var bHex = s.charAt(2) + s.charAt(2);");
    lib.push(
      '        var aHex = s.length === 4 ? (s.charAt(3) + s.charAt(3)) : "ff";',
    );
    lib.push("        var rv = parseInt(rHex, 16) / 255;");
    lib.push("        var gv = parseInt(gHex, 16) / 255;");
    lib.push("        var bv = parseInt(bHex, 16) / 255;");
    lib.push("        var av = parseInt(aHex, 16) / 255;");
    lib.push("        def = [rv, gv, bv, av];");
    lib.push("      } else if (s.length === 6 || s.length === 8) {");
    lib.push("        var rHex2 = s.substring(0, 2);");
    lib.push("        var gHex2 = s.substring(2, 4);");
    lib.push("        var bHex2 = s.substring(4, 6);");
    lib.push('        var aHex2 = s.length === 8 ? s.substring(6, 8) : "ff";');
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
    lib.push(
      "    // 2）支持直接传入 r, g, b, a 四个参数，约定统一为 0-255 取值范围",
    );
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
    lib.push('    if (!arr || !arr.length) return "#000000";');
    lib.push("    var r = Math.round(Math.max(0, Math.min(1, arr[0])) * 255);");
    lib.push("    var g = Math.round(Math.max(0, Math.min(1, arr[1])) * 255);");
    lib.push("    var b = Math.round(Math.max(0, Math.min(1, arr[2])) * 255);");
    lib.push(
      "    var a = arr[3] !== undefined ? Math.round(Math.max(0, Math.min(1, arr[3])) * 255) : 255;",
    );
    lib.push('    var hex = "#" + (r < 16 ? "0" : "") + r.toString(16) +');
    lib.push('                (g < 16 ? "0" : "") + g.toString(16) +');
    lib.push('                (b < 16 ? "0" : "") + b.toString(16);');
    lib.push("    if (a < 255) {");
    lib.push('      hex += (a < 16 ? "0" : "") + a.toString(16);');
    lib.push("    }");
    lib.push("    return hex;");
    lib.push("  }");
    lib.push("  return {");
    lib.push("    // 返回颜色数组 [r, g, b, a]，可直接用于 fill()/stroke()");
    lib.push("    color: function() {");
    lib.push("      var raw = def;");
    lib.push("      if (ctrl) {");
    lib.push("        try {");
    lib.push(
      '          var prop = ctrl.effect(index)(\"ADBE Color Control-0001\");',
    );
    lib.push("          if (prop && prop.value && prop.value.length) {");
    lib.push("            raw = prop.value;");
    lib.push("          }");
    lib.push("        } catch (e) {}");
    lib.push("      }");
    lib.push("      var mapped = raw;");
    lib.push('      _exportController(index, "color", {');
    lib.push("        value: mapped,");
    lib.push("        raw: raw");
    lib.push("      });");
    lib.push("      return mapped;");
    lib.push("    },");
    lib.push('    // 返回十六进制字符串，如 "#ff0000" 或 "#ff0000ff"');
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
    lib.push(
      '          var prop = ctrl.effect(index)(\"ADBE Checkbox Control-0001\");',
    );
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
    lib.push('      _exportController(index, "checkbox", {');
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
    lib.push(
      "// 使用主合成中 __controller__ 图层上的 Dropdown Menu Control N 作为枚举索引",
    );
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
    lib.push(
      '          var prop = ctrl.effect(index)(\"ADBE Dropdown Control-0001\");',
    );
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
    lib.push('      _exportController(index, "select", {');
    lib.push("        options: options,");
    lib.push("        value: idx,");
    lib.push("        raw: rawAE");
    lib.push("      });");
    lib.push("      return idx;");
    lib.push("    },");
    lib.push(
      "    // getter：返回当前选中项对应的“值”（与 p5 的 value() 类似）",
    );
    lib.push("    value: function() {");
    lib.push("      var len = _len();");
    lib.push("      if (len <= 0) return null;");
    lib.push("      var idx = this.index();");
    lib.push("      if (idx < 0 || idx >= options.length) {");
    lib.push(
      "        // 如果 AE 侧长度更大，以 AE 长度为准做 clamp，但没有对应值时返回 null",
    );
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
    lib.push('      if (typeof v === "number") {');
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
    lib.push(
      '        var prop = ctrl.effect(index)(\"ADBE Point Control-0001\");',
    );
    lib.push(
      "        if (prop !== undefined && prop.value !== undefined && prop.value.length >= 2) {",
    );
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
    lib.push('      _exportController(index, "point", {');
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

  if (deps.createPathController) {
    pushBlock([
      "// Path controller",
      "var __pathControllerIndex = 0;",
      "function _nextPathControllerName(name) {",
      "  __pathControllerIndex++;",
      "  var key = String(name || ('path' + __pathControllerIndex));",
      "  key = key.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\\d)/, '_$1');",
      "  return { id: key, maskName: '__path__' + key };",
      "}",
      "function _pathClamp01(t) {",
      "  if (!(t === t)) return 0;",
      "  if (t < 0) return 0;",
      "  if (t > 1) return 1;",
      "  return t;",
      "}",
      "function _pathPoint(points, t, closed) {",
      "  if (!points || points.length === 0) return [0, 0];",
      "  if (points.length === 1) return points[0];",
      "  var pts = [];",
      "  var i;",
      "  for (i = 0; i < points.length; i++) pts.push(points[i]);",
      "  if (closed && points.length > 1) pts.push(points[0]);",
      "  var segLens = [];",
      "  var total = 0;",
      "  for (i = 0; i < pts.length - 1; i++) {",
      "    var dx = pts[i + 1][0] - pts[i][0];",
      "    var dy = pts[i + 1][1] - pts[i][1];",
      "    var len = Math.sqrt(dx * dx + dy * dy);",
      "    segLens.push(len);",
      "    total += len;",
      "  }",
      "  if (!(total > 0)) return pts[0];",
      "  var target = _pathClamp01(t) * total;",
      "  var acc = 0;",
      "  for (i = 0; i < segLens.length; i++) {",
      "    var seg = segLens[i];",
      "    if (target <= acc + seg || i === segLens.length - 1) {",
      "      var local = seg > 0 ? (target - acc) / seg : 0;",
      "      return [",
      "        pts[i][0] + (pts[i + 1][0] - pts[i][0]) * local,",
      "        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * local",
      "      ];",
      "    }",
      "    acc += seg;",
      "  }",
      "  return pts[pts.length - 1];",
      "}",
      "function _pathTangent(points, t, closed) {",
      "  var eps = 0.001;",
      "  var t0 = _pathClamp01(t - eps);",
      "  var t1 = _pathClamp01(t + eps);",
      "  var p0 = _pathPoint(points, t0, closed);",
      "  var p1 = _pathPoint(points, t1, closed);",
      "  var dx = p1[0] - p0[0];",
      "  var dy = p1[1] - p0[1];",
      "  var len = Math.sqrt(dx * dx + dy * dy);",
      "  if (!(len > 0)) return [1, 0];",
      "  return [dx / len, dy / len];",
      "}",
      "function createPathController(name, points, closed) {",
      "  var meta = _nextPathControllerName(name);",
      "  var ctrl = _getControllerLayer();",
      "  var defPoints = (points && points.length >= 2) ? points : [[thisComp.width/3,thisComp.height/2],[(thisComp.width*2)/3,thisComp.height/2]];",
      "  var defClosed = (closed === undefined) ? false : !!closed;",
      "  _pushController('path', { id: meta.id, label: String(name || meta.id), maskName: meta.maskName, points: defPoints, closed: defClosed });",
      "  function _pathProp() {",
      "    try { return ctrl ? ctrl.mask(meta.maskName).maskPath : null; } catch (e) { return null; }",
      "  }",
      "  return {",
      "    exists: function() { return !!_pathProp(); },",
      "    closed: function() { var p = _pathProp(); return p ? !!p.isClosed() : defClosed; },",
      "    points: function() { var p = _pathProp(); return p ? p.points() : defPoints; },",
      "    point: function(t) { var p = _pathProp(); return p ? p.pointOnPath(_pathClamp01(t)) : _pathPoint(defPoints, t, defClosed); },",
      "    tangent: function(t) { var p = _pathProp(); return p ? p.tangentOnPath(_pathClamp01(t)) : _pathTangent(defPoints, t, defClosed); },",
      "    normal: function(t) { var p = _pathProp(); if (p) return p.normalOnPath(_pathClamp01(t)); var tan = _pathTangent(defPoints, t, defClosed); return [-tan[1], tan[0]]; },",
      "    angle: function(t) { var tan = this.tangent(t); return Math.atan2(tan[1], tan[0]) * 180 / Math.PI; },",
      "    sample: function(count) {",
      "      var n = Math.max(0, Math.floor(Number(count) || 0));",
      "      var out = [];",
      "      if (n <= 0) return out;",
      "      if (n === 1) { out.push(this.point(0)); return out; }",
      "      for (var i = 0; i < n; i++) out.push(this.point(i / (n - 1)));",
      "      return out;",
      "    }",
      "  };",
      "}",
    ]);
  }

  return lib.join("\n");
}
