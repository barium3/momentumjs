#pragma once

#include "../model/momentum_types.h"

namespace momentum {

bool BuildBitmapGpuPlan(
  PF_LayerDef* output,
  std::uint64_t cacheKey,
  long targetFrame,
  const ScenePayload& scene,
  GpuRenderPlan* outPlan,
  std::string* errorMessage
);

bool BuildBitmapFramePlan(
  PF_LayerDef* output,
  BitmapGpuExecutionProfile profile,
  std::uint64_t cacheKey,
  long targetFrame,
  const std::vector<std::pair<long, ScenePayload>>& scenes,
  BitmapFramePlan* outPlan,
  std::string* errorMessage
);

void ClearBitmapGpuTextAtlasCacheByKey(std::uint64_t cacheKey);
void ClearAllBitmapGpuTextAtlasCaches();

}  // namespace momentum
