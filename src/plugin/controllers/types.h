#pragma once

#include <array>
#include <string>
#include <vector>

namespace momentum {

constexpr int kControllerSlotCount = 16;
constexpr int kControllerParamKindsPerSlot = 7;
constexpr int kControllerSliderSlotCount = kControllerSlotCount;
constexpr int kControllerAngleSlotCount = kControllerSlotCount;
constexpr int kControllerColorSlotCount = kControllerSlotCount;
constexpr int kControllerCheckboxSlotCount = kControllerSlotCount;
constexpr int kControllerSelectSlotCount = kControllerSlotCount;
constexpr int kControllerPointSlotCount = kControllerSlotCount;

struct ControllerSliderValue {
  double value = 0.0;
};

struct ControllerAngleValue {
  double degrees = 0.0;
};

struct ControllerColorValue {
  double r = 1.0;
  double g = 1.0;
  double b = 1.0;
  double a = 1.0;
};

struct ControllerCheckboxValue {
  bool checked = false;
};

struct ControllerSelectValue {
  int index = 0;
};

struct ControllerPointValue {
  double x = 0.0;
  double y = 0.0;
};

struct ControllerPoolState {
  std::array<ControllerSliderValue, kControllerSliderSlotCount> sliders{};
  std::array<ControllerAngleValue, kControllerAngleSlotCount> angles{};
  std::array<ControllerColorValue, kControllerColorSlotCount> colors{};
  std::array<ControllerCheckboxValue, kControllerCheckboxSlotCount> checkboxes{};
  std::array<ControllerSelectValue, kControllerSelectSlotCount> selects{};
  std::array<ControllerPointValue, kControllerPointSlotCount> points{};
  std::string stateHash;
};

struct RuntimePointControllerSpec {
  std::string label;
  ControllerPointValue defaultValue;
  bool hasDefaultValue = false;
};

struct RuntimeSliderControllerSpec {
  std::string label;
  double minValue = 0.0;
  double maxValue = 100.0;
  double defaultValue = 0.0;
  double step = 0.0;
  bool hasDefaultValue = false;
};

struct RuntimeAngleControllerSpec {
  std::string label;
  double defaultValue = 0.0;
  bool hasDefaultValue = false;
};

struct RuntimeColorControllerSpec {
  std::string label;
  ControllerColorValue defaultValue;
  bool hasDefaultValue = false;
};

struct RuntimeCheckboxControllerSpec {
  std::string label;
  bool defaultValue = false;
  bool hasDefaultValue = false;
};

struct RuntimeSelectControllerOptionSpec {
  std::string label;
};

struct RuntimeSelectControllerSpec {
  std::string label;
  std::vector<RuntimeSelectControllerOptionSpec> options;
  int defaultValue = 0;
  bool hasDefaultValue = false;
};

enum class RuntimeControllerSlotKind {
  kNone = 0,
  kSlider = 1,
  kAngle = 2,
  kColor = 3,
  kCheckbox = 4,
  kSelect = 5,
  kPoint = 6,
};

struct RuntimeControllerSlotSpec {
  RuntimeControllerSlotKind kind = RuntimeControllerSlotKind::kNone;
  std::string id;
  std::string label;
  RuntimeSliderControllerSpec slider;
  RuntimeAngleControllerSpec angle;
  RuntimeColorControllerSpec color;
  RuntimeCheckboxControllerSpec checkbox;
  RuntimeSelectControllerSpec select;
  RuntimePointControllerSpec point;
};

}  // namespace momentum
