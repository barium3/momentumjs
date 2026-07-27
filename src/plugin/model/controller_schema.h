#pragma once

#include "momentum_types.h"

namespace momentum {

const RuntimeControllerSlotSpec* FindControllerSlotSpec(
  const RuntimeSketchBundle& bundle,
  int logicalSlot
);

RuntimeControllerSlotKind ResolveControllerSlotKind(
  const RuntimeSketchBundle& bundle,
  int logicalSlot
);

std::string DefaultControllerLabel(
  RuntimeControllerSlotKind kind,
  int logicalSlot
);
std::string DefaultSliderControllerLabel(int logicalSlot);
std::string DefaultAngleControllerLabel(int logicalSlot);
std::string DefaultColorControllerLabel(int logicalSlot);
std::string DefaultCheckboxControllerLabel(int logicalSlot);
std::string DefaultSelectControllerLabel(int logicalSlot);
std::string DefaultPointControllerLabel(int logicalSlot);

std::string ResolveControllerSlotLabel(
  const RuntimeSketchBundle& bundle,
  int logicalSlot,
  RuntimeControllerSlotKind expectedKind
);

RuntimeSliderControllerSpec ResolveSliderControllerSpecWithDefaults(
  const RuntimeSketchBundle& bundle,
  int logicalSlot
);

RuntimeAngleControllerSpec ResolveAngleControllerSpecWithDefaults(
  const RuntimeSketchBundle& bundle,
  int logicalSlot
);

RuntimeColorControllerSpec ResolveColorControllerSpecWithDefaults(
  const RuntimeSketchBundle& bundle,
  int logicalSlot
);
ControllerColorValue ResolveColorControllerDefaultValue(
  const RuntimeSketchBundle& bundle,
  int logicalSlot
);
double ClampColorComponent(double value, double fallbackValue);

RuntimeCheckboxControllerSpec ResolveCheckboxControllerSpecWithDefaults(
  const RuntimeSketchBundle& bundle,
  int logicalSlot
);

RuntimeSelectControllerSpec ResolveSelectControllerSpecWithDefaults(
  const RuntimeSketchBundle& bundle,
  int logicalSlot
);

ControllerPointValue ResolvePointControllerDefaultValue(
  const RuntimeSketchBundle& bundle,
  int logicalSlot
);

double ClampAndSnapSliderValue(
  double value,
  const RuntimeSliderControllerSpec& config
);

int ClampSelectControllerIndex(
  int value,
  const RuntimeSelectControllerSpec& config
);

bool IsValidRawSelectControllerValue(
  int rawValue,
  const RuntimeSelectControllerSpec& config
);

}  // namespace momentum
