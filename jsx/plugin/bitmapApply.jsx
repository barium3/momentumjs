function _momentumHasProjectItemNamed(name, itemClass) {
  if (!app.project || !name) {
    return false;
  }
  for (var i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    if (!item || item.name !== name) {
      continue;
    }
    if (!itemClass || item instanceof itemClass) {
      return true;
    }
  }
  return false;
}

function _momentumGetUniqueProjectItemName(baseName, fallbackName, itemClass) {
  var name = baseName && String(baseName).length ? String(baseName) : String(fallbackName || "");
  if (!_momentumHasProjectItemNamed(name, itemClass)) {
    return name;
  }

  for (var counter = 1; counter < 10000; counter++) {
    var nextName = name + " " + counter;
    if (!_momentumHasProjectItemNamed(nextName, itemClass)) {
      return nextName;
    }
  }
  return name + " " + String(new Date().getTime());
}

function _momentumGetUniqueCompName(baseName) {
  try {
    if (typeof getUniqueCompName === "function") {
      return String(getUniqueCompName(baseName));
    }
  } catch (_sharedUniqueNameError) {}
  return _momentumGetUniqueProjectItemName(baseName, "New Composition", CompItem);
}

function _momentumReadNumber(value, fallbackValue) {
  var parsed = Number(value);
  if (isNaN(parsed) || !isFinite(parsed)) {
    return fallbackValue;
  }
  return parsed;
}

function _momentumGetEffectParade(layer) {
  if (!layer) {
    return null;
  }
  return layer.property("ADBE Effect Parade");
}

function _momentumFindMomentumEffect(layer) {
  var parade = _momentumGetEffectParade(layer);
  if (!parade) {
    return null;
  }
  for (var i = 1; i <= parade.numProperties; i++) {
    var prop = parade.property(i);
    if (!prop) {
      continue;
    }
    if (prop.name === "Momentum" || prop.matchName === "Momentum") {
      return prop;
    }
  }
  return null;
}

function _momentumFindOrCreateBitmapLayer(comp) {
  if (!comp) {
    return null;
  }
  for (var i = 1; i <= comp.numLayers; i++) {
    var layer = comp.layer(i);
    if (!layer) {
      continue;
    }
    if (_momentumFindMomentumEffect(layer)) {
      return layer;
    }
  }

  var solid = comp.layers.addSolid(
    [0, 0, 0],
    comp.name,
    comp.width,
    comp.height,
    comp.pixelAspect,
    comp.duration
  );
  solid.guideLayer = true;
  return solid;
}

function _momentumFindOrAddMomentumEffect(layer) {
  var existing = _momentumFindMomentumEffect(layer);
  if (existing) {
    _momentumFindOrAddMomentumEffect.lastError = "";
    return existing;
  }

  var parade = _momentumGetEffectParade(layer);
  if (!parade) {
    _momentumFindOrAddMomentumEffect.lastError = "No ADBE Effect Parade on target layer.";
    return null;
  }

  var diagnostics = [];

  try {
    diagnostics.push("canAdd Momentum=" + String(parade.canAddProperty("Momentum")));
  } catch (canAddMomentumError) {
    diagnostics.push("canAdd Momentum threw " + canAddMomentumError.toString());
  }

  try {
    _momentumFindOrAddMomentumEffect.lastError = "";
    return parade.addProperty("Momentum");
  } catch (_nameError) {
    diagnostics.push("add Momentum threw " + _nameError.toString());
    _momentumFindOrAddMomentumEffect.lastError = diagnostics.join("; ");
    return null;
  }
}

function _momentumDeselectAllLayers(comp) {
  if (!comp) {
    return;
  }
  for (var i = 1; i <= comp.numLayers; i++) {
    var layer = comp.layer(i);
    if (!layer) {
      continue;
    }
    try {
      layer.selected = false;
    } catch (_deselectLayerError) {}
  }
}

function _momentumSelectLayerAndEffect(comp, layer, effect) {
  if (!comp || !layer) {
    return;
  }
  _momentumDeselectAllLayers(comp);
  try {
    layer.selected = true;
  } catch (_selectLayerError) {}
  try {
    if (effect && typeof effect.selected !== "undefined") {
      effect.selected = true;
    }
  } catch (_selectEffectError) {}
}

var _MOMENTUM_CONTROLLER_SLOT_COUNT = 16;
var _MOMENTUM_NATIVE_CONTROLLER_PARAMS_PER_SLOT = 7;

function _momentumControllerSlotParamBaseIndex(slotIndex) {
  return 3 + (slotIndex * _MOMENTUM_NATIVE_CONTROLLER_PARAMS_PER_SLOT);
}

function _momentumPointControllerParamIndex(slotIndex) {
  return _momentumControllerSlotParamBaseIndex(slotIndex);
}

function _momentumSliderControllerParamIndex(slotIndex) {
  return _momentumControllerSlotParamBaseIndex(slotIndex) + 1;
}

function _momentumColorControllerParamIndex(slotIndex) {
  return _momentumControllerSlotParamBaseIndex(slotIndex) + 2;
}

function _momentumCheckboxControllerParamIndex(slotIndex) {
  return _momentumControllerSlotParamBaseIndex(slotIndex) + 3;
}

function _momentumSelectControllerParamIndex(slotIndex) {
  return _momentumControllerSlotParamBaseIndex(slotIndex) + 4;
}

function _momentumAngleControllerParamIndex(slotIndex) {
  return _momentumControllerSlotParamBaseIndex(slotIndex) + 5;
}

function _momentumAngleControllerUiParamIndex(slotIndex) {
  return _momentumControllerSlotParamBaseIndex(slotIndex) + 6;
}

function _momentumResolveControllerProp(effect, cfg, slotIndex, controllerConfigs) {
  if (!effect) {
    return null;
  }

  var type = String(cfg && cfg.type || "");
  var numericProp = null;
  if (type === "slider") {
    numericProp = _momentumResolveSliderControllerProp(effect, slotIndex);
  } else if (type === "angle") {
    numericProp = _momentumResolveAngleControllerProp(effect, cfg, slotIndex);
  } else if (type === "color") {
    numericProp = _momentumResolveColorControllerProp(effect, slotIndex);
  } else if (type === "checkbox") {
    numericProp = _momentumResolveCheckboxControllerProp(effect, slotIndex);
  } else if (type === "select") {
    numericProp = _momentumResolveSelectControllerProp(effect, slotIndex);
  } else if (type === "point") {
    numericProp = _momentumResolvePointControllerProp(effect, slotIndex);
  }

  return numericProp || null;
}

function _momentumDescribePropValue(prop) {
  if (!prop) {
    return "null";
  }

  var value = null;
  try {
    value = prop.value;
  } catch (_valueError) {
    return "unreadable";
  }

  if (value instanceof Array) {
    return "[" + value.join(",") + "]";
  }
  return String(value);
}

function _momentumTraceSafeText(value) {
  var text = "";
  try {
    text = String(value);
  } catch (_traceTextError) {
    text = "";
  }
  return text.replace(/[\r\n]+/g, " ");
}

function _momentumLogControllerSnapshot(effect, controllerConfigs, stage) {
  if (!effect || !(controllerConfigs instanceof Array) || controllerConfigs.length <= 0) {
    return;
  }

  for (var idx = 0; idx < controllerConfigs.length; idx++) {
    var cfg = controllerConfigs[idx] || {};
    var controllerType = String(cfg.type || "");
    var controllerId = cfg && cfg.id ? String(cfg.id) : "";
    var targetProp = _momentumResolveControllerProp(effect, cfg, idx, controllerConfigs);
    _momentumAppendApplyTrace(
      "phase=controller_snapshot" +
      " stage=" + _momentumTraceSafeText(stage || "") +
      " slot=" + idx +
      " id=" + controllerId +
      " type=" + controllerType +
      " name=" + (targetProp ? _momentumTraceSafeText(targetProp.name || "") : "") +
      " property_index=" + (targetProp ? String(targetProp.propertyIndex || 0) : "0") +
      " actual=" + (targetProp ? _momentumDescribePropValue(targetProp) : "null")
    );
  }
}

function _momentumResolvePointControllerProp(effect, slotIndex) {
  if (!effect) {
    return null;
  }
  return effect.property(_momentumPointControllerParamIndex(slotIndex));
}

function _momentumResolveSliderControllerProp(effect, slotIndex) {
  if (!effect) {
    return null;
  }
  return effect.property(_momentumSliderControllerParamIndex(slotIndex));
}

function _momentumResolveAngleControllerProp(effect, cfg, slotIndex) {
  if (!effect) {
    return null;
  }
  try {
    return effect.property(_momentumAngleControllerParamIndex(slotIndex));
  } catch (_angleExpectedPropError) {
    return null;
  }
}

function _momentumResolveColorControllerProp(effect, slotIndex) {
  if (!effect) {
    return null;
  }
  return effect.property(_momentumColorControllerParamIndex(slotIndex));
}

function _momentumResolveCheckboxControllerProp(effect, slotIndex) {
  if (!effect) {
    return null;
  }
  return effect.property(_momentumCheckboxControllerParamIndex(slotIndex));
}

function _momentumResolveSelectControllerProp(effect, slotIndex) {
  if (!effect) {
    return null;
  }
  return effect.property(_momentumSelectControllerParamIndex(slotIndex));
}

function _momentumShouldDeferControllerBinding(controllerType) {
  return controllerType === "select";
}

function _momentumBindControllerParams(effect, controllerConfigs, options) {
  if (!effect) {
    return;
  }

  if (!(controllerConfigs instanceof Array) || controllerConfigs.length <= 0) {
    return;
  }

  var bindDeferredOnly = !!(options && options.deferredOnly);
  var skipDeferred = !!(options && options.skipDeferred);
  var passLabel = options && options.passLabel ? String(options.passLabel) : "";

  for (var idx = 0; idx < controllerConfigs.length; idx++) {
    var cfg = controllerConfigs[idx] || {};
    if (idx >= _MOMENTUM_CONTROLLER_SLOT_COUNT) {
      break;
    }

    var controllerType = String(cfg.type || "");
    var controllerId = cfg && cfg.id ? String(cfg.id) : "";
    var isDeferredController = _momentumShouldDeferControllerBinding(controllerType);
    if (bindDeferredOnly && !isDeferredController) {
      continue;
    }
    if (skipDeferred && isDeferredController) {
      continue;
    }
    if (controllerType === "color") {
      _momentumAppendApplyTrace(
        "phase=bind_controller_value" +
        (passLabel ? " pass=" + passLabel : "") +
        " slot=" + idx +
        " id=" + controllerId +
        " type=color" +
        " skipped=arbitrary_data_default"
      );
      continue;
    }

    if (controllerType === "angle") {
      _momentumAppendApplyTrace(
        "phase=bind_controller_value" +
        (passLabel ? " pass=" + passLabel : "") +
        " slot=" + idx +
        " id=" + controllerId +
        " type=angle" +
        " skipped=native_angle_default_sync"
      );
      continue;
    }

    var targetProp = _momentumResolveControllerProp(effect, cfg, idx, controllerConfigs);
    if (!targetProp) {
      _momentumAppendApplyTrace(
        "phase=bind_controller_missing" +
        (passLabel ? " pass=" + passLabel : "") +
        " slot=" + idx +
        " id=" + controllerId +
        " type=" + controllerType
      );
      continue;
    }

    if (controllerType === "slider") {
      var sliderMin = _momentumReadNumber(cfg.min, 0);
      var sliderMax = _momentumReadNumber(cfg.max, 100);
      if (sliderMax < sliderMin) {
        var sliderSwap = sliderMin;
        sliderMin = sliderMax;
        sliderMax = sliderSwap;
      }

      var sliderSetError = "";
      try {
        targetProp.setValue(_momentumReadNumber(cfg.value, sliderMin));
      } catch (_sliderDefaultError) {
        sliderSetError = _momentumTraceSafeText(_sliderDefaultError);
      }
      _momentumAppendApplyTrace(
        "phase=bind_controller_value" +
        (passLabel ? " pass=" + passLabel : "") +
        " slot=" + idx +
        " id=" + controllerId +
        " type=slider" +
        " name=" + String(targetProp.name || "") +
        " property_index=" + String(targetProp.propertyIndex || 0) +
        " expected=" + String(_momentumReadNumber(cfg.value, sliderMin)) +
        (sliderSetError ? " set_error=" + sliderSetError : "") +
        " actual=" + _momentumDescribePropValue(targetProp)
      );
      continue;
    }

    if (controllerType === "angle") {
      var angleSetError = "";
      try {
        targetProp.setValue(_momentumReadNumber(cfg.value, 0));
      } catch (_angleDefaultError) {
        angleSetError = _momentumTraceSafeText(_angleDefaultError);
      }
      _momentumAppendApplyTrace(
        "phase=bind_controller_value" +
        (passLabel ? " pass=" + passLabel : "") +
        " slot=" + idx +
        " id=" + controllerId +
        " type=angle" +
        " name=" + String(targetProp.name || "") +
        " property_index=" + String(targetProp.propertyIndex || 0) +
        " expected=" + String(_momentumReadNumber(cfg.value, 0)) +
        (angleSetError ? " set_error=" + angleSetError : "") +
        " actual=" + _momentumDescribePropValue(targetProp)
      );
      continue;
    }

    if (controllerType === "checkbox") {
      var checkboxSetError = "";
      try {
        targetProp.setValue(cfg.value ? 1 : 0);
      } catch (_checkboxDefaultError) {
        checkboxSetError = _momentumTraceSafeText(_checkboxDefaultError);
      }
      _momentumAppendApplyTrace(
        "phase=bind_controller_value" +
        (passLabel ? " pass=" + passLabel : "") +
        " slot=" + idx +
        " id=" + controllerId +
        " type=checkbox" +
        " name=" + String(targetProp.name || "") +
        " property_index=" + String(targetProp.propertyIndex || 0) +
        " expected=" + String(cfg.value ? 1 : 0) +
        (checkboxSetError ? " set_error=" + checkboxSetError : "") +
        " actual=" + _momentumDescribePropValue(targetProp)
      );
      continue;
    }

    if (controllerType === "select") {
      var selectIndex = Math.floor(_momentumReadNumber(cfg.value, 0));
      var optionCount =
        cfg.options instanceof Array && cfg.options.length > 0 ? cfg.options.length : 1;
      if (selectIndex < 0) {
        selectIndex = 0;
      }
      if (selectIndex >= optionCount) {
        selectIndex = optionCount - 1;
      }

      var selectSetError = "";
      try {
        targetProp.setValue(selectIndex + 1);
      } catch (_selectDefaultError) {
        selectSetError = _momentumTraceSafeText(_selectDefaultError);
      }
      _momentumAppendApplyTrace(
        "phase=bind_controller_value" +
        (passLabel ? " pass=" + passLabel : "") +
        " slot=" + idx +
        " id=" + controllerId +
        " type=select" +
        " name=" + String(targetProp.name || "") +
        " property_index=" + String(targetProp.propertyIndex || 0) +
        " expected=" + String(selectIndex + 1) +
        (selectSetError ? " set_error=" + selectSetError : "") +
        " actual=" + _momentumDescribePropValue(targetProp)
      );
      continue;
    }

    if (controllerType !== "point") {
      continue;
    }

    var point = cfg.value instanceof Array ? cfg.value : [0, 0];
    var pointValue = [
      _momentumReadNumber(point[0], 0),
      _momentumReadNumber(point[1], 0)
    ];
    var pointSetError = "";
    try {
      targetProp.setValue(pointValue);
    } catch (_pointDefaultError) {
      pointSetError = _momentumTraceSafeText(_pointDefaultError);
    }
    _momentumAppendApplyTrace(
      "phase=bind_controller_value" +
      (passLabel ? " pass=" + passLabel : "") +
      " slot=" + idx +
      " id=" + controllerId +
      " type=point" +
      " name=" + String(targetProp.name || "") +
      " property_index=" + String(targetProp.propertyIndex || 0) +
      (pointSetError ? " set_error=" + pointSetError : "") +
      " actual=" + _momentumDescribePropValue(targetProp)
    );
  }
}

function _momentumReadGpuState() {
  var result = {
    known: false,
    enabled: null,
    mode: "Unknown",
  };

  try {
    if (!app || !app.project || typeof app.project.gpuAccelType === "undefined") {
      return result;
    }

    var accelType = app.project.gpuAccelType;
    result.known = true;

    if (typeof GpuAccelType !== "undefined" && GpuAccelType) {
      if (accelType === GpuAccelType.SOFTWARE) {
        result.enabled = false;
        result.mode = "Mercury Software Only";
        return result;
      }
      if (accelType === GpuAccelType.METAL) {
        result.enabled = true;
        result.mode = "Mercury GPU Acceleration (Metal)";
        return result;
      }
      if (accelType === GpuAccelType.OPENCL) {
        result.enabled = true;
        result.mode = "Mercury GPU Acceleration (OpenCL)";
        return result;
      }
      if (accelType === GpuAccelType.CUDA) {
        result.enabled = true;
        result.mode = "Mercury GPU Acceleration (CUDA)";
        return result;
      }
    }

    var token = "";
    try {
      token = String(accelType || "");
    } catch (_tokenError) {
      token = "";
    }
    var upper = token.toUpperCase();
    if (upper.indexOf("SOFTWARE") !== -1 || upper.indexOf("CPU") !== -1) {
      result.enabled = false;
      result.mode = token || "Mercury Software Only";
    } else if (
      upper.indexOf("METAL") !== -1 ||
      upper.indexOf("OPENCL") !== -1 ||
      upper.indexOf("CUDA") !== -1 ||
      upper.indexOf("GPU") !== -1
    ) {
      result.enabled = true;
      result.mode = token;
    } else if (token) {
      result.mode = token;
    }
  } catch (_gpuDetectError) {}

  return result;
}

function _momentumBuildCpuFallbackWarning(gpuState) {
  var modeLabel =
    gpuState && gpuState.mode ? String(gpuState.mode) : "Mercury Software Only";
  return (
    "AE GPU acceleration appears to be disabled (current mode: " +
    modeLabel +
    "). Momentum Bitmap has automatically fallen back to CPU mode, which may be less smooth.\n" +
    "Enable it in After Effects at:\n" +
    "[u][i]File[/i][/u] > [u][i]Project Settings[/i][/u] > [u][i]Video Rendering and Effects[/i][/u] > [u][i]Use[/i][/u] > [u][i]Mercury GPU Acceleration[/i][/u]"
  );
}

function applyMomentum(encodedPayload) {
  var payloadText = _momentumDecodeURIComponent(encodedPayload);
  var payload = null;
  try {
    payload = payloadText ? JSON.parse(payloadText) : {};
  } catch (parseError) {
    return "Error: Invalid bitmap payload JSON: " + parseError.toString();
  }

  var compInfo = payload && payload.comp ? payload.comp : {};
  var compName = (compInfo && compInfo.name) ? String(compInfo.name) : "Momentum";
  var width = Math.max(1, Math.floor(_momentumReadNumber(compInfo.width, 100)));
  var height = Math.max(1, Math.floor(_momentumReadNumber(compInfo.height, 100)));
  var frameRate = Math.max(1, _momentumReadNumber(compInfo.frameRate, 30));
  var duration = Math.max(0.1, _momentumReadNumber(compInfo.duration, 10));
  var revision = Math.max(0, Math.floor(_momentumReadNumber(payload && payload.revision, 0)));
  var controllerConfig =
    payload && payload.controller && payload.controller.configs instanceof Array
      ? payload.controller.configs
      : [];
  var runtimeSource = payload && payload.runtimeSource ? String(payload.runtimeSource) : "";
  var controllerTypes = [];
  for (var controllerIndex = 0; controllerIndex < controllerConfig.length; controllerIndex++) {
    var controllerEntry = controllerConfig[controllerIndex] || {};
    controllerTypes.push(String(controllerEntry.type || "unknown"));
  }

  _momentumAppendApplyTrace(
    "phase=apply_momentum_enter" +
    " comp=" + compName +
    " width=" + width +
    " height=" + height +
    " revision=" + revision +
    " controllers=" + controllerConfig.length +
    " controller_types=" + controllerTypes.join(",")
  );

  if (!app.project) {
    app.newProject();
  }

  app.beginUndoGroup("Apply Momentum Bitmap");
  try {
    var warnings = [];
    var gpuState = _momentumReadGpuState();
    if (gpuState.known && gpuState.enabled === false) {
      warnings.push(_momentumBuildCpuFallbackWarning(gpuState));
    }

    var uniqueCompName = _momentumGetUniqueCompName(compName);
    var comp = app.project.items.addComp(uniqueCompName, width, height, 1, duration, frameRate);

    var layer = _momentumFindOrCreateBitmapLayer(comp);
    if (!layer) {
      return "Error: Failed to find or create Momentum bitmap layer.";
    }

    if (typeof _momentumClearPendingRuntimeBundle === "function") {
      _momentumClearPendingRuntimeBundle();
    }

    if (typeof _momentumWritePendingRuntimeBundleRaw === "function") {
      var pendingBundle = JSON.parse(JSON.stringify(payload || {}));
      try {
        delete pendingBundle.runtimeSource;
      } catch (_deletePendingRuntimeSourceError) {}
      var pendingWriteError = _momentumWritePendingRuntimeBundleRaw(
        JSON.stringify(pendingBundle, null, 2)
      );
      if (pendingWriteError) {
        return String(pendingWriteError);
      }
    }

    try {
      layer.startTime = 0;
      layer.inPoint = 0;
      layer.outPoint = comp.duration;
      layer.name = comp.name;
    } catch (_layerBoundsError) {}

    var effect = _momentumFindOrAddMomentumEffect(layer);
    if (!effect) {
      _momentumAppendApplyTrace(
        "phase=apply_momentum_error" +
        " step=add_effect" +
        " message=" + String(_momentumFindOrAddMomentumEffect.lastError || "Unknown error.")
      );
      try {
        $.writeln(
          "Momentum addProperty failed: " +
          String(_momentumFindOrAddMomentumEffect.lastError || "Unknown error.")
        );
      } catch (_logAddEffectError) {}
      return (
        "Error: Failed to add effect \"Momentum\". " +
        "After Effects recognized the effect, but the installed plugin failed to initialize."
      );
    }

    var revisionProp = effect.property("Revision") || effect.property(1);
    var instanceProp = effect.property("Instance ID") || effect.property(2);
    if (!revisionProp || !instanceProp) {
      return "Error: Momentum effect parameters are unavailable.";
    }

    var instanceId = 0;
    try {
      instanceId = Math.floor(_momentumReadNumber(instanceProp.value, 0));
    } catch (_instanceReadError) {
      instanceId = 0;
    }
    if (instanceId <= 0) {
      instanceId = _momentumNextBitmapInstanceId();
    }

    if (runtimeSource && typeof _momentumWriteRuntimeInstanceFilesRaw === "function") {
      var instanceBundle = JSON.parse(JSON.stringify(payload || {}));
      try {
        delete instanceBundle.runtimeSource;
      } catch (_deleteRuntimeSourceError) {}
      instanceBundle.sourcePath = "instances/" + String(instanceId) + "/sketch.js";
      var instanceWriteError = _momentumWriteRuntimeInstanceFilesRaw(
        instanceId,
        runtimeSource,
        JSON.stringify(instanceBundle, null, 2)
      );
      if (instanceWriteError) {
        _momentumAppendApplyTrace(
          "phase=write_instance_runtime_error" +
          " instance_id=" + instanceId +
          " message=" + String(instanceWriteError)
        );
        return String(instanceWriteError);
      }
    }

    instanceProp.setValue(instanceId);
    revisionProp.setValue(revision);
    _momentumAppendApplyTrace(
      "phase=bind_revision_state" +
      " revision_expected=" + revision +
      " revision_actual=" + _momentumDescribePropValue(revisionProp) +
      " instance_expected=" + instanceId +
      " instance_actual=" + _momentumDescribePropValue(instanceProp)
    );
    _momentumLogControllerSnapshot(effect, controllerConfig, "after_revision");

    _momentumBindControllerParams(effect, controllerConfig, {
      skipDeferred: true,
      passLabel: "immediate"
    });
    _momentumLogControllerSnapshot(effect, controllerConfig, "after_immediate_bind");

    comp.openInViewer();
    _momentumSelectLayerAndEffect(comp, layer, effect);
    _momentumLogControllerSnapshot(effect, controllerConfig, "after_viewer");

    _momentumBindControllerParams(effect, controllerConfig, {
      deferredOnly: true,
      passLabel: "deferred"
    });
    _momentumLogControllerSnapshot(effect, controllerConfig, "after_deferred_bind");

    _momentumAppendApplyTrace(
      "phase=apply_momentum_bound" +
      " comp=" + comp.name +
      " layer=" + layer.name +
      " revision=" + revision +
      " instance_id=" + instanceId +
      " controllers=" + controllerConfig.length
    );

    _momentumAppendApplyTrace(
      "phase=apply_momentum_exit" +
      " ok=1" +
      " comp=" + comp.name +
      " layer=" + layer.name +
      " revision=" + revision +
      " instance_id=" + instanceId
    );

    return JSON.stringify({
      ok: true,
      warnings: warnings,
      comp: comp.name,
      layer: layer.name,
      controllers: controllerConfig.length,
      revision: revision,
      instanceId: instanceId
    });
  } catch (applyError) {
    _momentumAppendApplyTrace(
      "phase=apply_momentum_error" +
      " step=exception" +
      " message=" + String(applyError)
    );
    return "Error: Failed to apply Momentum bitmap effect: " + applyError.toString();
  } finally {
    try {
      if (typeof _momentumClearPendingRuntimeBundle === "function") {
        _momentumClearPendingRuntimeBundle();
      }
    } catch (_clearPendingBundleFinallyError) {}
    app.endUndoGroup();
  }
}
