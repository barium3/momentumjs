#pragma once

#include "rendering/bitmap/planning/plan.h"

namespace momentum {
namespace bitmap {
namespace gpu {

struct Target {
  PF_EffectWorld* outputWorld = NULL;
  PF_PixelFormat pixelFormat = PF_PixelFormat_INVALID;
  void* outputWorldData = NULL;
  double sourceOriginX = 0.0;
  double sourceOriginY = 0.0;
  double sourceStepX = 1.0;
  double sourceStepY = 1.0;
  A_long logicalWidth = 0;
  A_long logicalHeight = 0;
  PF_GPUDeviceInfo deviceInfo;
};

bool Available();

PF_Err CreateContext(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_GPU_Framework framework,
  A_u_long deviceIndex,
  void** outGpuData,
  std::string* errorMessage
);

void DestroyContext(
  PF_InData* in_data,
  PF_OutData* out_data,
  void* gpuData
);

void ClearAllCaches();
void ClearCache(std::uint64_t cacheKey);

PF_Err Render(
  PF_InData* in_data,
  PF_OutData* out_data,
  void* gpuData,
  PF_EffectWorld* outputWorld,
  PF_PixelFormat pixelFormat,
  double sourceOriginX,
  double sourceOriginY,
  double sourceStepX,
  double sourceStepY,
  const BitmapFramePlan& plan,
  std::string* errorMessage
);

}  // namespace gpu
}  // namespace bitmap
}  // namespace momentum
