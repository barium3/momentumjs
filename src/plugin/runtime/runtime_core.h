#pragma once

#include "../model/momentum_types.h"

namespace momentum {

enum class SketchExecutionMode {
  kGpuPrimary = 0,
  kCpuFallback = 1,
};

std::optional<ScenePayload> ExecuteSketchAtCurrentTime(
  PF_InData* in_data,
  A_long revision,
  A_long instanceId,
  PF_LayerDef* output,
  const std::vector<PF_Pixel>** rasterOut,
  long* targetFrameOut,
  bool requireRaster,
  SketchExecutionMode executionMode,
  std::string* errorMessage
);

long ResolveSketchTargetFrame(
  PF_InData* in_data,
  A_long instanceId
);
double ResolveSketchSimulationFrameRate(
  PF_InData* in_data,
  A_long instanceId
);

bool BuildBitmapFramePlanAtCurrentTime(
  PF_InData* in_data,
  A_long revision,
  A_long instanceId,
  PF_LayerDef* output,
  BitmapFramePlan* outPlan,
  std::string* errorMessage
);

void MarkControllerHistoryDirty(
  std::uintptr_t cacheKey,
  long earliestAffectedFrame,
  const char* reason = nullptr
);
void UpdateLiveControllerState(
  std::uintptr_t cacheKey,
  const ControllerPoolState& state
);
bool GetLiveControllerState(
  std::uintptr_t cacheKey,
  ControllerPoolState* outState
);
void ClearLiveControllerState(std::uintptr_t cacheKey);
void ClearAllLiveControllerStates();
void ClearCachedSketchByKey(std::uintptr_t cacheKey, const char* reason = nullptr);
void ClearAllCachedSketches(const char* reason = nullptr);

}  // namespace momentum
