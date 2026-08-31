#include "controllers/schema.h"

#include <algorithm>
#include <cmath>

namespace momentum {

double ClampColorComponent(double value, double fallbackValue) {
  const double safe = std::isfinite(value) ? value : fallbackValue;
  return std::clamp(safe, 0.0, 1.0);
}

namespace {

std::string SanitizeControllerLabel(
  std::string label,
  const std::string& fallback
) {
  for (char& ch : label) {
    if (ch == '\r' || ch == '\n' || ch == '\t') {
      ch = ' ';
    }
  }
  const std::size_t first = label.find_first_not_of(' ');
  if (first == std::string::npos) {
    return fallback;
  }
  const std::size_t last = label.find_last_not_of(' ');
  return label.substr(first, last - first + 1);
}

}  // namespace

const RuntimeControllerSlotSpec* FindControllerSlotSpec(
  const RuntimeSketchBundle& bundle,
  int logicalSlot
) {
  if (logicalSlot < 0 ||
      static_cast<std::size_t>(logicalSlot) >= bundle.controllerSlots.size()) {
    return nullptr;
  }
  return &bundle.controllerSlots[static_cast<std::size_t>(logicalSlot)];
}

RuntimeControllerSlotKind ResolveControllerSlotKind(
  const RuntimeSketchBundle& bundle,
  int logicalSlot
) {
  const RuntimeControllerSlotSpec* slotSpec =
    FindControllerSlotSpec(bundle, logicalSlot);
  return slotSpec ? slotSpec->kind : RuntimeControllerSlotKind::kNone;
}

std::string DefaultControllerLabel(
  RuntimeControllerSlotKind kind,
  int logicalSlot
) {
  const std::string ordinal = std::to_string(logicalSlot + 1);
  switch (kind) {
    case RuntimeControllerSlotKind::kSlider: return "Slider " + ordinal;
    case RuntimeControllerSlotKind::kAngle: return "Angle " + ordinal;
    case RuntimeControllerSlotKind::kColor: return "Color " + ordinal;
    case RuntimeControllerSlotKind::kCheckbox: return "Checkbox " + ordinal;
    case RuntimeControllerSlotKind::kSelect: return "Select " + ordinal;
    case RuntimeControllerSlotKind::kPoint: return "Point " + ordinal;
    case RuntimeControllerSlotKind::kNone: return "Controller " + ordinal;
  }
  return "Controller " + ordinal;
}

std::string DefaultSliderControllerLabel(int logicalSlot) {
  return DefaultControllerLabel(RuntimeControllerSlotKind::kSlider, logicalSlot);
}

std::string DefaultAngleControllerLabel(int logicalSlot) {
  return DefaultControllerLabel(RuntimeControllerSlotKind::kAngle, logicalSlot);
}

std::string DefaultColorControllerLabel(int logicalSlot) {
  return DefaultControllerLabel(RuntimeControllerSlotKind::kColor, logicalSlot);
}

std::string DefaultCheckboxControllerLabel(int logicalSlot) {
  return DefaultControllerLabel(RuntimeControllerSlotKind::kCheckbox, logicalSlot);
}

std::string DefaultSelectControllerLabel(int logicalSlot) {
  return DefaultControllerLabel(RuntimeControllerSlotKind::kSelect, logicalSlot);
}

std::string DefaultPointControllerLabel(int logicalSlot) {
  return DefaultControllerLabel(RuntimeControllerSlotKind::kPoint, logicalSlot);
}

std::string ResolveControllerSlotLabel(
  const RuntimeSketchBundle& bundle,
  int logicalSlot,
  RuntimeControllerSlotKind expectedKind
) {
  const std::string fallback = DefaultControllerLabel(expectedKind, logicalSlot);
  const RuntimeControllerSlotSpec* slotSpec =
    FindControllerSlotSpec(bundle, logicalSlot);
  if (!slotSpec || slotSpec->kind != expectedKind) {
    return fallback;
  }
  return SanitizeControllerLabel(slotSpec->label, fallback);
}

RuntimeSliderControllerSpec ResolveSliderControllerSpecWithDefaults(
  const RuntimeSketchBundle& bundle,
  int logicalSlot
) {
  RuntimeSliderControllerSpec config;
  const RuntimeControllerSlotSpec* slotSpec =
    FindControllerSlotSpec(bundle, logicalSlot);
  if (!slotSpec || slotSpec->kind != RuntimeControllerSlotKind::kSlider) {
    return config;
  }
  config = slotSpec->slider;
  config.label = ResolveControllerSlotLabel(
    bundle,
    logicalSlot,
    RuntimeControllerSlotKind::kSlider
  );
  if (!std::isfinite(config.minValue)) {
    config.minValue = 0.0;
  }
  if (!std::isfinite(config.maxValue)) {
    config.maxValue = 100.0;
  }
  if (!std::isfinite(config.step)) {
    config.step = 0.0;
  }
  if (!config.hasDefaultValue || !std::isfinite(config.defaultValue)) {
    config.defaultValue = config.minValue;
  }
  return config;
}

RuntimeAngleControllerSpec ResolveAngleControllerSpecWithDefaults(
  const RuntimeSketchBundle& bundle,
  int logicalSlot
) {
  RuntimeAngleControllerSpec config;
  const RuntimeControllerSlotSpec* slotSpec =
    FindControllerSlotSpec(bundle, logicalSlot);
  if (!slotSpec || slotSpec->kind != RuntimeControllerSlotKind::kAngle) {
    return config;
  }
  config = slotSpec->angle;
  config.label = ResolveControllerSlotLabel(
    bundle,
    logicalSlot,
    RuntimeControllerSlotKind::kAngle
  );
  if (!config.hasDefaultValue || !std::isfinite(config.defaultValue)) {
    config.defaultValue = 0.0;
  }
  return config;
}

RuntimeColorControllerSpec ResolveColorControllerSpecWithDefaults(
  const RuntimeSketchBundle& bundle,
  int logicalSlot
) {
  RuntimeColorControllerSpec config;
  const RuntimeControllerSlotSpec* slotSpec =
    FindControllerSlotSpec(bundle, logicalSlot);
  if (!slotSpec || slotSpec->kind != RuntimeControllerSlotKind::kColor) {
    return config;
  }
  config = slotSpec->color;
  config.label = ResolveControllerSlotLabel(
    bundle,
    logicalSlot,
    RuntimeControllerSlotKind::kColor
  );
  if (!config.hasDefaultValue) {
    config.defaultValue = ControllerColorValue();
  }
  config.defaultValue.r = ClampColorComponent(config.defaultValue.r, 1.0);
  config.defaultValue.g = ClampColorComponent(config.defaultValue.g, 1.0);
  config.defaultValue.b = ClampColorComponent(config.defaultValue.b, 1.0);
  config.defaultValue.a = ClampColorComponent(config.defaultValue.a, 1.0);
  return config;
}

ControllerColorValue ResolveColorControllerDefaultValue(
  const RuntimeSketchBundle& bundle,
  int logicalSlot
) {
  return ResolveColorControllerSpecWithDefaults(bundle, logicalSlot).defaultValue;
}

RuntimeCheckboxControllerSpec ResolveCheckboxControllerSpecWithDefaults(
  const RuntimeSketchBundle& bundle,
  int logicalSlot
) {
  RuntimeCheckboxControllerSpec config;
  const RuntimeControllerSlotSpec* slotSpec =
    FindControllerSlotSpec(bundle, logicalSlot);
  if (!slotSpec || slotSpec->kind != RuntimeControllerSlotKind::kCheckbox) {
    return config;
  }
  config = slotSpec->checkbox;
  config.label = ResolveControllerSlotLabel(
    bundle,
    logicalSlot,
    RuntimeControllerSlotKind::kCheckbox
  );
  if (!config.hasDefaultValue) {
    config.defaultValue = false;
  }
  return config;
}

int ClampSelectControllerIndex(
  int value,
  const RuntimeSelectControllerSpec& config
) {
  const int optionCount = std::max<int>(1, static_cast<int>(config.options.size()));
  return std::clamp(value, 0, optionCount - 1);
}

RuntimeSelectControllerSpec ResolveSelectControllerSpecWithDefaults(
  const RuntimeSketchBundle& bundle,
  int logicalSlot
) {
  RuntimeSelectControllerSpec config;
  const RuntimeControllerSlotSpec* slotSpec =
    FindControllerSlotSpec(bundle, logicalSlot);
  if (!slotSpec || slotSpec->kind != RuntimeControllerSlotKind::kSelect) {
    return config;
  }
  config = slotSpec->select;
  config.label = ResolveControllerSlotLabel(
    bundle,
    logicalSlot,
    RuntimeControllerSlotKind::kSelect
  );
  for (std::size_t index = 0; index < config.options.size(); ++index) {
    config.options[index].label = SanitizeControllerLabel(
      config.options[index].label,
      "Option " + std::to_string(index + 1)
    );
  }
  if (config.options.empty()) {
    config.options.push_back(RuntimeSelectControllerOptionSpec{"Option 1"});
  }
  if (!config.hasDefaultValue) {
    config.defaultValue = 0;
  }
  config.defaultValue = ClampSelectControllerIndex(config.defaultValue, config);
  return config;
}

ControllerPointValue ResolvePointControllerDefaultValue(
  const RuntimeSketchBundle& bundle,
  int logicalSlot
) {
  const RuntimeControllerSlotSpec* slotSpec =
    FindControllerSlotSpec(bundle, logicalSlot);
  if (!slotSpec || slotSpec->kind != RuntimeControllerSlotKind::kPoint ||
      !slotSpec->point.hasDefaultValue) {
    return ControllerPointValue();
  }
  return slotSpec->point.defaultValue;
}

double ClampAndSnapSliderValue(
  double value,
  const RuntimeSliderControllerSpec& config
) {
  double safeMin = std::isfinite(config.minValue) ? config.minValue : 0.0;
  double safeMax = std::isfinite(config.maxValue) ? config.maxValue : 100.0;
  if (safeMax < safeMin) {
    std::swap(safeMin, safeMax);
  }

  double mapped = std::clamp(
    std::isfinite(value) ? value : safeMin,
    safeMin,
    safeMax
  );
  const double step = std::isfinite(config.step) ? config.step : 0.0;
  if (step > 0.0) {
    mapped = std::floor((mapped - safeMin) / step) * step + safeMin;
    mapped = std::clamp(mapped, safeMin, safeMax);
  }
  return mapped;
}

bool IsValidRawSelectControllerValue(
  int rawValue,
  const RuntimeSelectControllerSpec& config
) {
  const int optionCount = std::max<int>(1, static_cast<int>(config.options.size()));
  return rawValue >= 1 && rawValue <= optionCount;
}

}  // namespace momentum
