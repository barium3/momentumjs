#pragma once

#include "rendering/bitmap/backends/gpu/renderer.h"

namespace momentum {
namespace bitmap {
namespace cuda {

PF_Err CreateContext(
  const PF_GPUDeviceInfo& deviceInfo,
  void** context,
  std::string* errorMessage,
  std::string* diagnosticDetail
);

void DestroyContext(void* context);

PF_Err Render(
  void* context,
  const gpu::Target& target,
  const BitmapFramePlan& plan,
  std::string* errorMessage
);

}  // namespace cuda
}  // namespace bitmap
}  // namespace momentum
