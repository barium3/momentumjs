#include "api_internal.h"

#include <sstream>

namespace momentum {

namespace {

constexpr char kBootstrapControllerScript[] = R"MOMENTUM_BOOT(
var __momentumControllerKind = {
  slider: 0,
  angle: 1,
  color: 2,
  checkbox: 3,
  select: 4,
  point: 5,
};

var __momentumControllerSlotCounters = {
  slider: 0,
  angle: 0,
  color: 0,
  checkbox: 0,
  select: 0,
  point: 0,
};

var __momentumControllerRuntimeValues = {
  slider: [],
  angle: [],
  color: [],
  checkbox: [],
  select: [],
  point: [],
};

function __momentumControllerRuntimeKey(kind) {
  switch (kind) {
    case __momentumControllerKind.slider: return "slider";
    case __momentumControllerKind.angle: return "angle";
    case __momentumControllerKind.color: return "color";
    case __momentumControllerKind.checkbox: return "checkbox";
    case __momentumControllerKind.select: return "select";
    case __momentumControllerKind.point: return "point";
    default: return "";
  }
}

function __momentumCloneControllerData(value) {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map(__momentumCloneControllerData);
  }
  var copy = {};
  Object.keys(value).forEach(function(key) {
    copy[key] = __momentumCloneControllerData(value[key]);
  });
  return copy;
}

function __momentumClaimControllerSlot(kind, existingSlot) {
  var slot = Math.floor(Number(existingSlot));
  if (isFinite(slot) && slot >= 0) return slot;
  slot = __momentumControllerSlotCounters[kind] || 0;
  __momentumControllerSlotCounters[kind] = slot + 1;
  return slot;
}

function __momentumNormalizePointValue(input) {
  if (Array.isArray(input) && input.length >= 2) {
    return [Number(input[0]) || 0, Number(input[1]) || 0];
  }
  return [0, 0];
}

function __momentumNormalizeSliderValue(input, fallback) {
  var value = Number(input);
  if (!(value === value) || !isFinite(value)) {
    value = Number(fallback);
  }
  if (!(value === value) || !isFinite(value)) {
    value = 0;
  }
  return value;
}

function __momentumNormalizeAngleValue(input, fallback) {
  return __momentumNormalizeSliderValue(input, fallback);
}

function __momentumNormalizeColorValue(input, fallback) {
  function clamp01(value, fallbackValue) {
    var mapped = Number(value);
    if (!(mapped === mapped) || !isFinite(mapped)) {
      mapped = Number(fallbackValue);
    }
    if (!(mapped === mapped) || !isFinite(mapped)) {
      mapped = 1;
    }
    if (mapped < 0) mapped = 0;
    if (mapped > 1) mapped = 1;
    return mapped;
  }

  function normalizedRgbaFromColorObject(colorObject) {
    if (!colorObject || !colorObject._colorData || !Array.isArray(colorObject._colorData.rgba)) {
      return null;
    }
    var rgba = colorObject._colorData.rgba;
    return [
      clamp01(rgba[0], fallback && fallback[0]),
      clamp01(rgba[1], fallback && fallback[1]),
      clamp01(rgba[2], fallback && fallback[2]),
      clamp01(rgba.length >= 4 ? rgba[3] : 1, fallback && fallback[3]),
    ];
  }

  if (typeof __momentumIsColorObject === "function" && __momentumIsColorObject(input)) {
    var directColor = normalizedRgbaFromColorObject(input);
    if (directColor) {
      return directColor;
    }
  }

  if (Array.isArray(input) && input.length >= 3) {
    var channels = [
      Number(input[0]),
      Number(input[1]),
      Number(input[2]),
      Number(input.length >= 4 ? input[3] : 1),
    ];
    var appearsNormalized = true;
    for (var channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
      var channelValue = channels[channelIndex];
      if (!(channelValue === channelValue) || !isFinite(channelValue) || channelValue < 0 || channelValue > 1) {
        appearsNormalized = false;
        break;
      }
    }
    if (!appearsNormalized && typeof __momentumColorFromArgs === "function") {
      var parsedColor = __momentumColorFromArgs(input);
      var parsedRgba = normalizedRgbaFromColorObject(parsedColor);
      if (parsedRgba) {
        return parsedRgba;
      }
    }
    return [
      clamp01(input[0], fallback && fallback[0]),
      clamp01(input[1], fallback && fallback[1]),
      clamp01(input[2], fallback && fallback[2]),
      clamp01(input.length >= 4 ? input[3] : 1, fallback && fallback[3]),
    ];
  }

  if (typeof input === "string") {
    var text = input.replace(/^#/, "");
    if (text.length === 3 || text.length === 4) {
      var expanded = "";
      for (var index = 0; index < text.length; index += 1) {
        expanded += text.charAt(index) + text.charAt(index);
      }
      text = expanded;
    }
    if (text.length === 6 || text.length === 8) {
      var red = parseInt(text.substring(0, 2), 16);
      var green = parseInt(text.substring(2, 4), 16);
      var blue = parseInt(text.substring(4, 6), 16);
      var alpha = text.length === 8 ? parseInt(text.substring(6, 8), 16) : 255;
      return [
        clamp01(red / 255, fallback && fallback[0]),
        clamp01(green / 255, fallback && fallback[1]),
        clamp01(blue / 255, fallback && fallback[2]),
        clamp01(alpha / 255, fallback && fallback[3]),
      ];
    }
  }

  return Array.isArray(fallback) ? __momentumCloneControllerData(fallback) : [1, 1, 1, 1];
}

function __momentumNormalizeCheckboxValue(input, fallback) {
  if (typeof input === "boolean") return input;
  if (input === 0 || input === 1) return !!input;
  if (fallback !== undefined) return !!fallback;
  return false;
}

function __momentumNormalizeSelectIndex(input, fallback) {
  var value = Math.round(Number(input));
  if (!(value === value) || !isFinite(value)) {
    value = Math.round(Number(fallback));
  }
  if (!(value === value) || !isFinite(value)) {
    value = 0;
  }
  if (value < 0) value = 0;
  return value;
}

function __momentumColorArrayToHex(input) {
  var value = __momentumNormalizeColorValue(input, [1, 1, 1, 1]);
  function channelToHex(channel) {
    var mapped = Math.round(Math.max(0, Math.min(1, channel)) * 255);
    return (mapped < 16 ? "0" : "") + mapped.toString(16);
  }
  var hex =
    "#" +
    channelToHex(value[0]) +
    channelToHex(value[1]) +
    channelToHex(value[2]);
  var alpha = Math.round(Math.max(0, Math.min(1, value[3])) * 255);
  if (alpha < 255) {
    hex += (alpha < 16 ? "0" : "") + alpha.toString(16);
  }
  return hex;
}

function __momentumApplyControllerState(nextState) {
  if (!nextState || typeof nextState !== "object") return;

  __momentumControllerRuntimeValues.slider = Array.isArray(nextState.sliders)
    ? nextState.sliders.map(function(value) {
        return __momentumNormalizeSliderValue(value, 0);
      })
    : [];
  __momentumControllerRuntimeValues.angle = Array.isArray(nextState.angles)
    ? nextState.angles.map(function(value) {
        return __momentumNormalizeAngleValue(value, 0);
      })
    : [];
  __momentumControllerRuntimeValues.color = Array.isArray(nextState.colors)
    ? nextState.colors.map(function(value) {
        return __momentumNormalizeColorValue(value, [1, 1, 1, 1]);
      })
    : [];
  __momentumControllerRuntimeValues.checkbox = Array.isArray(nextState.checkboxes)
    ? nextState.checkboxes.map(function(value) {
        return __momentumNormalizeCheckboxValue(value, false);
      })
    : [];
  __momentumControllerRuntimeValues.select = Array.isArray(nextState.selects)
    ? nextState.selects.map(function(value) {
        return __momentumNormalizeSelectIndex(value, 0);
      })
    : [];
  __momentumControllerRuntimeValues.point = Array.isArray(nextState.points)
    ? nextState.points.map(function(value) {
        return __momentumNormalizePointValue(value);
      })
    : [];
}

function __momentumReadControllerValue(kind, slot) {
  if (!(slot >= 0)) return undefined;
  var key = __momentumControllerRuntimeKey(kind);
  if (!key) return undefined;
  var values = __momentumControllerRuntimeValues[key];
  if (!Array.isArray(values) || slot >= values.length) return undefined;
  return __momentumCloneControllerData(values[slot]);
}

function __momentumEnsureControllerRuntimeValue(kind, slot, fallback) {
  var key = __momentumControllerRuntimeKey(kind);
  if (!key) return __momentumCloneControllerData(fallback);
  var values = __momentumControllerRuntimeValues[key];
  if (!Array.isArray(values)) {
    values = [];
    __momentumControllerRuntimeValues[key] = values;
  }
  if (values[slot] === undefined) {
    values[slot] = __momentumCloneControllerData(fallback);
  }
  return __momentumCloneControllerData(values[slot]);
}

function __momentumUnsupportedController(name) {
  throw new Error(
    name +
      "() is not currently supported in the plugin runtime."
  );
}

function __momentumCreateSliderController(data) {
  data = __momentumCloneControllerData(data || {});
  var min = Number(data.min);
  var max = Number(data.max);
  var value = Number(data.value);
  var step = Number(data.step);
  if (!(min === min) || !isFinite(min)) min = 0;
  if (!(max === max) || !isFinite(max)) max = 100;
  if (!(value === value) || !isFinite(value)) value = min;
  if (!(step === step) || !isFinite(step)) step = 0;
  data.min = min;
  data.max = max;
  data.value = value;
  data.step = step;

  function clampAndSnap(input) {
    var mapped = __momentumNormalizeSliderValue(input, value);
    if (mapped < min) mapped = min;
    if (mapped > max) mapped = max;
    if (step > 0) {
      mapped = Math.floor((mapped - min) / step) * step + min;
      if (mapped < min) mapped = min;
      if (mapped > max) mapped = max;
    }
    return mapped;
  }

  var slot = __momentumClaimControllerSlot("slider", data._controllerSlot);
  data._controllerSlot = slot;
  data.value = clampAndSnap(data.value);
  __momentumEnsureControllerRuntimeValue(__momentumControllerKind.slider, slot, data.value);
  return {
    __momentumController: true,
    __momentumType: "SliderController",
    _controllerSlot: slot,
    _controllerData: data,
    value: function() {
      var hostValue = __momentumReadControllerValue(__momentumControllerKind.slider, this._controllerSlot);
      if (hostValue !== undefined) {
        this._controllerData.value = clampAndSnap(hostValue);
      } else {
        this._controllerData.value = clampAndSnap(this._controllerData.value);
      }
      return this._controllerData.value;
    },
  };
}

function __momentumCreateAngleController(data) {
  data = __momentumCloneControllerData(data || {});
  data.value = __momentumNormalizeAngleValue(data.value, 0);
  var slot = __momentumClaimControllerSlot("angle", data._controllerSlot);
  data._controllerSlot = slot;
  __momentumEnsureControllerRuntimeValue(__momentumControllerKind.angle, slot, data.value);
  return {
    __momentumController: true,
    __momentumType: "AngleController",
    _controllerSlot: slot,
    _controllerData: data,
    value: function() {
      var hostValue = __momentumReadControllerValue(__momentumControllerKind.angle, this._controllerSlot);
      if (hostValue !== undefined) {
        this._controllerData.value = __momentumNormalizeAngleValue(hostValue, this._controllerData.value);
      }
      return this._controllerData.value;
    },
    degrees: function() {
      return this.value();
    },
    radians: function() {
      return this.value() * Math.PI / 180;
    },
  };
}

function __momentumCreateColorController(data) {
  data = __momentumCloneControllerData(data || {});
  data.value = __momentumNormalizeColorValue(data.value, [1, 1, 1, 1]);
  var slot = __momentumClaimControllerSlot("color", data._controllerSlot);
  data._controllerSlot = slot;
  __momentumEnsureControllerRuntimeValue(__momentumControllerKind.color, slot, data.value);
  return {
    __momentumController: true,
    __momentumType: "ColorController",
    _controllerSlot: slot,
    _controllerData: data,
    color: function() {
      var hostValue = __momentumReadControllerValue(__momentumControllerKind.color, this._controllerSlot);
      if (hostValue !== undefined) {
        this._controllerData.value = __momentumNormalizeColorValue(hostValue, this._controllerData.value);
      }
      if (typeof color === "function") {
        return color(__momentumColorArrayToHex(this._controllerData.value));
      }
      return __momentumCloneControllerData(this._controllerData.value);
    },
    value: function() {
      var hostValue = __momentumReadControllerValue(__momentumControllerKind.color, this._controllerSlot);
      if (hostValue !== undefined) {
        this._controllerData.value = __momentumNormalizeColorValue(hostValue, this._controllerData.value);
      }
      return __momentumColorArrayToHex(this._controllerData.value);
    },
  };
}

function __momentumCreateCheckboxController(data) {
  data = __momentumCloneControllerData(data || {});
  data.label = data.label === undefined ? "" : String(data.label);
  data.value = __momentumNormalizeCheckboxValue(data.value, false);
  var slot = __momentumClaimControllerSlot("checkbox", data._controllerSlot);
  data._controllerSlot = slot;
  __momentumEnsureControllerRuntimeValue(__momentumControllerKind.checkbox, slot, data.value);
  return {
    __momentumController: true,
    __momentumType: "CheckboxController",
    _controllerSlot: slot,
    _controllerData: data,
    value: function() {
      var hostValue = __momentumReadControllerValue(__momentumControllerKind.checkbox, this._controllerSlot);
      if (hostValue !== undefined) {
        this._controllerData.value = __momentumNormalizeCheckboxValue(hostValue, this._controllerData.value);
      }
      return this._controllerData.value;
    },
    checked: function() {
      return this.value();
    },
  };
}

function __momentumCreateSelectController(data) {
  data = __momentumCloneControllerData(data || {});
  data.options = Array.isArray(data.options) ? data.options.map(function(option, index) {
    if (option && typeof option === "object") {
      return {
        label: option.label === undefined ? ("Option " + (index + 1)) : String(option.label),
        value: option.hasOwnProperty("value") ? option.value : option.label,
      };
    }
    return {
      label: option === undefined ? ("Option " + (index + 1)) : String(option),
      value: option,
    };
  }) : [];

  function clampIndex(value) {
    var length = data.options.length > 0 ? data.options.length : 1;
    var index = __momentumNormalizeSelectIndex(value, data.value);
    if (index >= length) index = length - 1;
    return index;
  }

  data.value = clampIndex(data.value);
  var slot = __momentumClaimControllerSlot("select", data._controllerSlot);
  data._controllerSlot = slot;
  __momentumEnsureControllerRuntimeValue(__momentumControllerKind.select, slot, data.value);
  return {
    __momentumController: true,
    __momentumType: "SelectController",
    _controllerSlot: slot,
    _controllerData: data,
    option: function(label, value) {
      this._controllerData.options.push({
        label: label === undefined ? "" : String(label),
        value: arguments.length >= 2 ? value : label,
      });
      this._controllerData.value = clampIndex(this._controllerData.value);
      return this;
    },
    index: function() {
      var hostValue = __momentumReadControllerValue(__momentumControllerKind.select, this._controllerSlot);
      if (hostValue !== undefined) {
        this._controllerData.value = clampIndex(hostValue);
      } else {
        this._controllerData.value = clampIndex(this._controllerData.value);
      }
      return this._controllerData.value;
    },
    value: function() {
      var index = this.index();
      if (index < 0 || index >= this._controllerData.options.length) {
        return null;
      }
      return this._controllerData.options[index].value;
    },
    selected: function(value) {
      if (arguments.length === 0) {
        return this.value();
      }
      var nextIndex = -1;
      if (typeof value === "number" && isFinite(value)) {
        nextIndex = Math.floor(value);
      } else {
        for (var optionIndex = 0; optionIndex < this._controllerData.options.length; optionIndex += 1) {
          var option = this._controllerData.options[optionIndex];
          if (option.value === value || option.label === String(value)) {
            nextIndex = optionIndex;
            break;
          }
        }
      }
      if (nextIndex < 0) {
        nextIndex = 0;
      }
      this._controllerData.value = clampIndex(nextIndex);
      return this;
    },
  };
}

function __momentumCreatePointController(data) {
  data = __momentumCloneControllerData(data || {});
  var point = __momentumNormalizePointValue([data.x, data.y]);
  data.x = point[0];
  data.y = point[1];
  var slot = __momentumClaimControllerSlot("point", data._controllerSlot);
  data._controllerSlot = slot;
  __momentumEnsureControllerRuntimeValue(__momentumControllerKind.point, slot, [data.x, data.y]);
  return {
    __momentumController: true,
    __momentumType: "PointController",
    _controllerSlot: slot,
    _controllerData: data,
    value: function() {
      var hostValue = __momentumReadControllerValue(__momentumControllerKind.point, this._controllerSlot);
      if (Array.isArray(hostValue) && hostValue.length >= 2) {
        this._controllerData.x = Number(hostValue[0]) || 0;
        this._controllerData.y = Number(hostValue[1]) || 0;
      }
      return [this._controllerData.x, this._controllerData.y];
    },
    x: function() {
      return this.value()[0];
    },
    y: function() {
      return this.value()[1];
    },
  };
}

function createSlider(min, max, value, step) {
  return __momentumCreateSliderController({
    min: min === undefined ? 0 : min,
    max: max === undefined ? 100 : max,
    value: value === undefined ? min : value,
    step: step === undefined ? 0 : step,
  });
}

function createAngle(defaultDegrees) {
  return __momentumCreateAngleController({
    value: defaultDegrees === undefined ? 0 : defaultDegrees,
  });
}

function createColorPicker(r, g, b, a) {
  var value = [1, 1, 1, 1];
  if (arguments.length === 1) {
    value = __momentumNormalizeColorValue(r, value);
  } else if (arguments.length >= 3) {
    value = __momentumNormalizeColorValue(
      [
        r === undefined ? 255 : r,
        g === undefined ? 255 : g,
        b === undefined ? 255 : b,
        a === undefined ? 255 : a,
      ],
      value
    );
  }
  return __momentumCreateColorController({ value: value });
}

function createCheckbox(label, checked) {
  return __momentumCreateCheckboxController({
    label: label === undefined ? "" : label,
    value: checked === undefined ? false : checked,
  });
}

function createSelect() {
  return __momentumCreateSelectController({
    options: [],
    value: 0,
  });
}

function createPoint(defaultX, defaultY) {
  return __momentumCreatePointController({
    x: defaultX === undefined ? 0 : defaultX,
    y: defaultY === undefined ? 0 : defaultY,
  });
}

function __momentumReviveControllerValue(value) {
  if (!value || typeof value !== "object") return value;
  if (value.__momentumType === "SliderController") {
    return __momentumCreateSliderController(value._controllerData || value);
  }
  if (value.__momentumType === "AngleController") {
    return __momentumCreateAngleController(value._controllerData || value);
  }
  if (value.__momentumType === "ColorController") {
    return __momentumCreateColorController(value._controllerData || value);
  }
  if (value.__momentumType === "CheckboxController") {
    return __momentumCreateCheckboxController(value._controllerData || value);
  }
  if (value.__momentumType === "SelectController") {
    return __momentumCreateSelectController(value._controllerData || value);
  }
  if (value.__momentumType === "PointController") {
    return __momentumCreatePointController(value._controllerData || value);
  }
  return value;
}

var __momentumControllerBaseSanitize = __momentumSanitize;
__momentumSanitize = function(value) {
  if (value && value.__momentumController === true) {
    return {
      __momentumType: value.__momentumType,
      _controllerSlot: value._controllerSlot,
      _controllerData: __momentumCloneControllerData(value._controllerData || {}),
    };
  }
  return __momentumControllerBaseSanitize(value);
};

var __momentumControllerBaseReviveValue = __momentumReviveValue;
__momentumReviveValue = function(value) {
  var revived = __momentumReviveControllerValue(value);
  if (revived !== value) {
    return revived;
  }
  return __momentumControllerBaseReviveValue(value);
};
)MOMENTUM_BOOT";

std::string BuildControllerStateApplyScript(const ControllerPoolState& state) {
  std::ostringstream stream;
  stream << "__momentumApplyControllerState({sliders:[";
  for (std::size_t index = 0; index < state.sliders.size(); index += 1) {
    if (index > 0) {
      stream << ',';
    }
    stream << state.sliders[index].value;
  }
  stream << "],angles:[";
  for (std::size_t index = 0; index < state.angles.size(); index += 1) {
    if (index > 0) {
      stream << ',';
    }
    stream << state.angles[index].degrees;
  }
  stream << "],colors:[";
  for (std::size_t index = 0; index < state.colors.size(); index += 1) {
    if (index > 0) {
      stream << ',';
    }
    const ControllerColorValue& color = state.colors[index];
    stream << '[' << color.r << ',' << color.g << ',' << color.b << ',' << color.a << ']';
  }
  stream << "],checkboxes:[";
  for (std::size_t index = 0; index < state.checkboxes.size(); index += 1) {
    if (index > 0) {
      stream << ',';
    }
    stream << (state.checkboxes[index].checked ? "true" : "false");
  }
  stream << "],selects:[";
  for (std::size_t index = 0; index < state.selects.size(); index += 1) {
    if (index > 0) {
      stream << ',';
    }
    stream << state.selects[index].index;
  }
  stream << "],points:[";
  for (std::size_t index = 0; index < state.points.size(); index += 1) {
    if (index > 0) {
      stream << ',';
    }
    const ControllerPointValue& point = state.points[index];
    stream << '[' << point.x << ',' << point.y << ']';
  }
  stream << "]})";
  return stream.str();
}

}  // namespace

bool ApplyControllerStateToRuntime(
  JSContextRef ctx,
  const ControllerPoolState& state,
  std::string* errorMessage
) {
  return runtime_internal::EvaluateScript(
    ctx,
    BuildControllerStateApplyScript(state),
    "__momentumApplyControllerState",
    NULL,
    errorMessage
  );
}

const char* GetControllerBootstrapScript() {
  return kBootstrapControllerScript;
}

}  // namespace momentum
