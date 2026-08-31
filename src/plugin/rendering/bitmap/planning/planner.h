#pragma once

#include "rendering/bitmap/planning/plan.h"

namespace momentum {
namespace bitmap {
namespace planning {

bool Build(
  PF_LayerDef* output,
  std::uint64_t cacheKey,
  long targetFrame,
  const ScenePayload& scene,
  BitmapDrawPlan* outPlan,
  std::string* errorMessage
);

// Convert logical-canvas geometry to a smaller physical raster target while
// preserving controller values and p5 coordinates in logical canvas space.
void Scale(
  BitmapFramePlan* plan,
  A_long physicalWidth,
  A_long physicalHeight
);

}  // namespace planning
}  // namespace bitmap
}  // namespace momentum
