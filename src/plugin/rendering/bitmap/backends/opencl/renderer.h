#pragma once

#include "rendering/bitmap/backends/gpu/renderer.h"

namespace momentum {
namespace bitmap {
namespace opencl {

PF_Err CreateContext(
  const PF_GPUDeviceInfo& deviceInfo,
  void** context,
  std::string* errorMessage
);

void DestroyContext(void* context);

PF_Err Render(
  void* context,
  const gpu::Target& target,
  const BitmapFramePlan& plan,
  std::string* errorMessage
);

}  // namespace opencl
}  // namespace bitmap
}  // namespace momentum
