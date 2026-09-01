#pragma once

#include "rendering/bitmap/backends/compute/device.h"
#include "rendering/bitmap/backends/gpu/renderer.h"

namespace momentum {
namespace bitmap {
namespace compute {

// Executes a correctness-complete Bitmap frame plan from its fallback
// surface. Device-specific code is limited to the Device implementation.
PF_Err Execute(
  Device& device,
  const gpu::Target& target,
  const BitmapFramePlan& plan,
  std::string* errorMessage
);

}  // namespace compute
}  // namespace bitmap
}  // namespace momentum
