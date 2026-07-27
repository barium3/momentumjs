#pragma once

#include "../model/momentum_types.h"

namespace momentum {

bool BuildBitmapDrawPlan(
  PF_LayerDef* output,
  std::uint64_t cacheKey,
  long targetFrame,
  const ScenePayload& scene,
  BitmapDrawPlan* outPlan,
  std::string* errorMessage
);

// Convert a logical-canvas frame plan to a smaller physical raster target while
// keeping controller values and p5 coordinates in logical canvas space.
void ScaleBitmapFramePlanToPhysicalCanvas(
  BitmapFramePlan* plan,
  A_long physicalWidth,
  A_long physicalHeight
);

void ClearBitmapGpuTextAtlasCacheByKey(std::uint64_t cacheKey);
void ClearAllBitmapGpuTextAtlasCaches();

}  // namespace momentum
