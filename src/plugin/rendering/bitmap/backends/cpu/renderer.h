#pragma once

#include "rendering/bitmap/planning/plan.h"

#include <functional>

namespace momentum {
namespace bitmap {
namespace cpu {

bool Render(
  const BitmapFramePlan& plan,
  std::vector<PF_Pixel>* raster,
  const std::function<bool()>& shouldCancel,
  std::string* errorMessage
);

}  // namespace cpu
}  // namespace bitmap
}  // namespace momentum
