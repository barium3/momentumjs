// Controller helpers.

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
    "v;"
  ].join("\n");
}

function _defaultPathPoints(comp) {
  var w = comp && comp.width ? Number(comp.width) : 1920;
  var h = comp && comp.height ? Number(comp.height) : 1080;
  return [
    [w / 3, h / 2],
    [(w * 2) / 3, h / 2]
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
        cfg.label || cfg.id || "Slider " + (idx + 1)
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
          val
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
        cfg.label || cfg.id || "Color " + (idx + 1)
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
        cfg.label || cfg.id || "Checkbox " + (idx + 1)
      );
      if (!checkboxEffect) continue;

      var cbVal = !!cfg.value;
      try {
        _setEffectValue(
          checkboxEffect,
          "ADBE Checkbox Control-0001",
          cbVal ? 1 : 0
        );
      } catch (eCb) {}
    } else if (type === "select") {
      var selectEffect = _addNamedEffect(
        effectsGroup,
        "ADBE Dropdown Control",
        cfg.label || cfg.id || "Select " + (idx + 1)
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
        cfg.label || cfg.id || "Angle " + (idx + 1)
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
        cfg.label || cfg.id || "Point " + (idx + 1)
      );
      if (!pointEffect) continue;

      var ptVal = cfg.value;
      if (!ptVal || ptVal.length < 2) {
        ptVal = [0, 0];
      }

      try {
        _setEffectValue(pointEffect, "ADBE Point Control-0001", [
          Number(ptVal[0]),
          Number(ptVal[1])
        ]);
      } catch (ePt) {}
    } else if (type === "path") {
      _ensurePathMask(ctrlLayer, cfg, comp, idx);
    }
  }

  return controllerConfigs.length;
}

// Expression controller library.

/**
 * Build controller helper expressions.
 * @returns {string}
 */
function getControllerHelpersLib() {
  return [
    "// ===== Controller Helpers =====",
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
    "function _getControllerSampleTime() {",
    "  if (typeof currentTime === 'number' && currentTime === currentTime) return currentTime;",
    "  if (typeof time === 'number' && time === time) return time;",
    "  return 0;",
    "}",
    "function _readControllerPropValue(prop, fallback) {",
    "  if (!prop) return fallback;",
    "  try {",
    "    if (typeof prop.valueAtTime === 'function') {",
    "      var sampled = prop.valueAtTime(_getControllerSampleTime());",
    "      if (sampled !== undefined) return sampled;",
    "    }",
    "  } catch (eValueAtTime) {}",
    "  try {",
    "    if (prop.value !== undefined) return prop.value;",
    "  } catch (eValue) {}",
    "  return fallback;",
    "}",
    "function _readPathSnapshot(prop, fallbackPoints, fallbackClosed) {",
    "  var source = prop || null;",
    "  if (prop) {",
    "    try {",
    "      if (typeof prop.valueAtTime === 'function') {",
    "        var sampled = prop.valueAtTime(_getControllerSampleTime());",
    "        if (sampled) source = sampled;",
    "      }",
    "    } catch (ePathTime) {}",
    "  }",
    "  var points = fallbackPoints;",
    "  var closed = !!fallbackClosed;",
    "  if (source) {",
    "    try {",
    "      if (typeof source.points === 'function') points = source.points();",
    "      else if (source.vertices && source.vertices.length) points = source.vertices;",
    "    } catch (ePathPoints) {}",
    "    try {",
    "      if (typeof source.isClosed === 'function') closed = !!source.isClosed();",
    "      else if (source.closed !== undefined) closed = !!source.closed;",
    "    } catch (ePathClosed) {}",
    "  }",
    "  return { source: source, points: points || fallbackPoints, closed: closed };",
    "}"
  ].join("\n");
}

function getSliderControllerLib() {
  return [
    "// ===== Slider Controller =====",
    "function createSlider(min, max, value, step) {",
    "  min = (min === undefined) ? 0 : min;",
    "  max = (max === undefined) ? 100 : max;",
    "  value = (value === undefined) ? min : value;",
    "  step = (step === undefined) ? 0 : step;",
    "  var index = _nextControllerIndex();",
    "  var ctrl = _getControllerLayer();",
    "  function _clampAndSnap(v) {",
    "    if (v < min) v = min;",
    "    if (v > max) v = max;",
    "    if (step && step > 0) {",
    "      v = Math.floor((v - min) / step) * step + min;",
    "      if (v < min) v = min;",
    "      if (v > max) v = max;",
    "    }",
    "    return v;",
    "  }",
    "  return {",
    "    value: function() {",
    "      var raw, mapped;",
    "      if (ctrl) {",
    "        try {",
    '          var prop = ctrl.effect(index)("ADBE Slider Control-0001");',
    "          raw = _readControllerPropValue(prop, value);",
    "        } catch (e) {",
    "          raw = value;",
    "        }",
    "        mapped = _clampAndSnap(raw);",
    "      } else {",
    "        mapped = _clampAndSnap(value);",
    "        raw = mapped;",
    "      }",
    '      _exportController(index, "slider", {',
    "        min: min,",
    "        max: max,",
    "        step: step,",
    "        value: mapped,",
    "        raw: raw",
    "      });",
    "      return mapped;",
    "    }",
    "  };",
    "}"
  ].join("\n");
}

function getAngleControllerLib() {
  return [
    "// ===== Angle Controller =====",
    "function createAngle(defaultDegrees) {",
    "  var def = (defaultDegrees === undefined) ? 0 : defaultDegrees;",
    "  var index = _nextControllerIndex();",
    "  var ctrl = _getControllerLayer();",
    "  function _getRaw() {",
    "    var raw = def;",
    "    if (ctrl) {",
    "      try {",
    '        var prop = ctrl.effect(index)("ADBE Angle Control-0001");',
    "        raw = _readControllerPropValue(prop, def);",
    "      } catch (e) {}",
    "    }",
    "    return raw;",
    "  }",
    "  return {",
    "    value: function() {",
    "      var raw = _getRaw();",
    "      var mapped = raw;",
    '      _exportController(index, "angle", {',
    "        value: mapped,",
    "        raw: raw,",
    "        degrees: raw,",
    "        radians: raw * Math.PI / 180",
    "      });",
    "      return mapped;",
    "    },",
    "    degrees: function() {",
    "      return this.value();",
    "    },",
    "    radians: function() {",
    "      return this.value() * Math.PI / 180;",
    "    }",
    "  };",
    "}"
  ].join("\n");
}

function getColorControllerLib() {
  return [
    "// ===== Color Controller =====",
    "function createColorPicker(r, g, b, a) {",
    "  var def;",
    "  if (arguments.length === 1) {",
    "    var initialColor = r;",
    "    if (!initialColor) {",
    "      def = [1, 1, 1, 1];",
    '    } else if (typeof initialColor === "string") {',
    "      var s = initialColor;",
    '      if (s.charAt(0) === "#") s = s.substring(1);',
    "      if (s.length === 3 || s.length === 4) {",
    "        var rHex = s.charAt(0) + s.charAt(0);",
    "        var gHex = s.charAt(1) + s.charAt(1);",
    "        var bHex = s.charAt(2) + s.charAt(2);",
    '        var aHex = s.length === 4 ? (s.charAt(3) + s.charAt(3)) : "ff";',
    "        var rv = parseInt(rHex, 16) / 255;",
    "        var gv = parseInt(gHex, 16) / 255;",
    "        var bv = parseInt(bHex, 16) / 255;",
    "        var av = parseInt(aHex, 16) / 255;",
    "        def = [rv, gv, bv, av];",
    "      } else if (s.length === 6 || s.length === 8) {",
    "        var rHex2 = s.substring(0, 2);",
    "        var gHex2 = s.substring(2, 4);",
    "        var bHex2 = s.substring(4, 6);",
    '        var aHex2 = s.length === 8 ? s.substring(6, 8) : "ff";',
    "        var rv2 = parseInt(rHex2, 16) / 255;",
    "        var gv2 = parseInt(gHex2, 16) / 255;",
    "        var bv2 = parseInt(bHex2, 16) / 255;",
    "        var av2 = parseInt(aHex2, 16) / 255;",
    "        def = [rv2, gv2, bv2, av2];",
    "      } else {",
    "        def = [1, 1, 1, 1];",
    "      }",
    "    } else {",
    "      def = [1, 1, 1, 1];",
    "    }",
    "  } else if (arguments.length >= 3) {",
    "    var rr = (r === undefined) ? 255 : r;",
    "    var gg = (g === undefined) ? 255 : g;",
    "    var bb = (b === undefined) ? 255 : b;",
    "    var aa = (a === undefined) ? 255 : a;",
    "    rr = rr / 255;",
    "    gg = gg / 255;",
    "    bb = bb / 255;",
    "    aa = aa / 255;",
    "    def = [rr, gg, bb, aa];",
    "  } else {",
    "    def = [1, 1, 1, 1];",
    "  }",
    "  var index = _nextControllerIndex();",
    "  var ctrl = _getControllerLayer();",
    "  function _colorArrayToHex(arr) {",
    '    if (!arr || !arr.length) return "#000000";',
    "    var r = Math.round(Math.max(0, Math.min(1, arr[0])) * 255);",
    "    var g = Math.round(Math.max(0, Math.min(1, arr[1])) * 255);",
    "    var b = Math.round(Math.max(0, Math.min(1, arr[2])) * 255);",
    "    var a = arr[3] !== undefined ? Math.round(Math.max(0, Math.min(1, arr[3])) * 255) : 255;",
    '    var hex = "#" + (r < 16 ? "0" : "") + r.toString(16) +',
    '                (g < 16 ? "0" : "") + g.toString(16) +',
    '                (b < 16 ? "0" : "") + b.toString(16);',
    "    if (a < 255) {",
    '      hex += (a < 16 ? "0" : "") + a.toString(16);',
    "    }",
    "    return hex;",
    "  }",
    "  return {",
    "    color: function() {",
    "      var raw = def;",
    "      if (ctrl) {",
    "        try {",
    '          var prop = ctrl.effect(index)("ADBE Color Control-0001");',
    "          var sampled = _readControllerPropValue(prop, def);",
    "          if (sampled && sampled.length) raw = sampled;",
    "        } catch (e) {}",
    "      }",
    "      var mapped = raw;",
    '      _exportController(index, "color", {',
    "        value: mapped,",
    "        raw: raw",
    "      });",
    "      return mapped;",
    "    },",
    "    value: function() {",
    "      var colorArr = this.color();",
    "      return _colorArrayToHex(colorArr);",
    "    }",
    "  };",
    "}"
  ].join("\n");
}

function getCheckboxControllerLib() {
  return [
    "// ===== Checkbox Controller =====",
    "function createCheckbox(label, checked) {",
    "  var def = !!checked;",
    "  var index = _nextControllerIndex();",
    "  var ctrl = _getControllerLayer();",
    "  return {",
    "    value: function() {",
    "      var raw;",
    "      if (ctrl) {",
    "        try {",
    '          var prop = ctrl.effect(index)("ADBE Checkbox Control-0001");',
    "          raw = !!_readControllerPropValue(prop, def ? 1 : 0);",
    "        } catch (e) {",
    "          raw = def;",
    "        }",
    "      } else {",
    "        raw = def;",
    "      }",
    "      var checked = !!raw;",
    '      _exportController(index, "checkbox", {',
    "        label: label,",
    "        value: checked,",
    "        checked: checked",
    "      });",
    "      return checked;",
    "    },",
    "    checked: function() {",
    "      return this.value();",
    "    }",
    "  };",
    "}"
  ].join("\n");
}

function getSelectControllerLib() {
  return [
    "// ===== Select Controller =====",
    "function createSelect() {",
    "  var options = [];",
    "  var defIndex = 0;",
    "  function _len() {",
    "    var len = options.length;",
    "    if (len <= 0) len = 1;",
    "    return len;",
    "  }",
    "  function _clampIndex(v) {",
    "    var len = _len();",
    "    if (v < 0) v = 0;",
    "    if (v > len - 1) v = len - 1;",
    "    v = Math.round(v);",
    "    if (v < 0) v = 0;",
    "    if (v > len - 1) v = len - 1;",
    "    return v;",
    "  }",
    "  var index = _nextControllerIndex();",
    "  var ctrl = _getControllerLayer();",
    "  return {",
    "    option: function(label, value) {",
    "      var v = (arguments.length >= 2) ? value : label;",
    "      options.push(v);",
    "      return this;",
    "    },",
    "    index: function() {",
    "      var rawAE, raw;",
    "      if (ctrl) {",
    "        try {",
    '          var prop = ctrl.effect(index)("ADBE Dropdown Control-0001");',
    "          rawAE = _readControllerPropValue(prop, defIndex + 1);",
    "          raw = rawAE - 1;",
    "        } catch (e) {",
    "          rawAE = defIndex + 1;",
    "          raw = defIndex;",
    "        }",
    "      } else {",
    "        rawAE = defIndex + 1;",
    "        raw = defIndex;",
    "      }",
    "      var idx = _clampIndex(raw);",
    '      _exportController(index, "select", {',
    "        options: options,",
    "        value: idx,",
    "        raw: rawAE",
    "      });",
    "      return idx;",
    "    },",
    "    value: function() {",
    "      var len = _len();",
    "      if (len <= 0) return null;",
    "      var idx = this.index();",
    "      if (idx < 0 || idx >= options.length) {",
    "        return null;",
    "      }",
    "      return options[idx];",
    "    },",
    "    selected: function(v) {",
    "      if (arguments.length === 0) {",
    "        return this.value();",
    "      }",
    "      var len = _len();",
    "      if (len <= 0) {",
    "        defIndex = 0;",
    "        return this;",
    "      }",
    "      var idx = -1;",
    '      if (typeof v === "number") {',
    "        idx = v;",
    "      } else {",
    "        for (var i = 0; i < options.length; i++) {",
    "          if (options[i] === v) {",
    "            idx = i;",
    "            break;",
    "          }",
    "        }",
    "      }",
    "      if (idx < 0) idx = 0;",
    "      defIndex = _clampIndex(idx);",
    "      return this;",
    "    }",
    "  };",
    "}"
  ].join("\n");
}

function getPointControllerLib() {
  return [
    "// ===== Point Controller =====",
    "function createPoint(defaultX, defaultY) {",
    "  var defX = (defaultX === undefined) ? 0 : defaultX;",
    "  var defY = (defaultY === undefined) ? 0 : defaultY;",
    "  var index = _nextControllerIndex();",
    "  var ctrl = _getControllerLayer();",
    "  function _getRaw() {",
    "    var raw = [defX, defY];",
    "    if (ctrl) {",
    "      try {",
    '        var prop = ctrl.effect(index)("ADBE Point Control-0001");',
    "        var sampled = _readControllerPropValue(prop, raw);",
    "        if (sampled && sampled.length >= 2) raw = [sampled[0], sampled[1]];",
    "      } catch (e) {}",
    "    }",
    "    return raw;",
    "  }",
    "  return {",
    "    value: function() {",
    "      var raw = _getRaw();",
    "      var x = raw[0];",
    "      var y = raw[1];",
    "      var mapped = [x, y];",
    '      _exportController(index, "point", {',
    "        value: mapped,",
    "        raw: raw,",
    "        x: x,",
    "        y: y",
    "      });",
    "      return mapped;",
    "    },",
    "    x: function() {",
    "      return this.value()[0];",
    "    },",
    "    y: function() {",
    "      return this.value()[1];",
    "    }",
    "  };",
    "}"
  ].join("\n");
}

/**
 * Build the controller expression library.
 * @param {Object} deps
 * @returns {string}
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
    lib.push(getControllerHelpersLib());
  }
  if (deps.createSlider) {
    lib.push(getSliderControllerLib());
  }
  if (deps.createAngle) {
    lib.push(getAngleControllerLib());
  }
  if (deps.createColorPicker) {
    lib.push(getColorControllerLib());
  }
  if (deps.createCheckbox) {
    lib.push(getCheckboxControllerLib());
  }
  if (deps.createSelect) {
    lib.push(getSelectControllerLib());
  }
  if (deps.createPoint) {
    lib.push(getPointControllerLib());
  }

  return lib.join("\n");
}
