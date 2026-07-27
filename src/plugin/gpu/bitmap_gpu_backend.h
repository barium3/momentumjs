#pragma once

#include "../model/momentum_types.h"

namespace momentum {

bool BitmapGpuBackendAvailable();

PF_Err CreateBitmapGpuDeviceContext(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_GPU_Framework framework,
  A_u_long deviceIndex,
  void** outGpuData,
  std::string* errorMessage
);

void DisposeBitmapGpuDeviceContext(
  PF_InData* in_data,
  PF_OutData* out_data,
  void* gpuData
);

void DisposeAllBitmapGpuGlobalState(const char* reason = nullptr);

bool QueryBitmapGpuCanvasCursor(
  std::uint64_t cacheKey,
  long* outLastFrame,
  bool* outInitialized
);

bool QueryBitmapGpuRecoveryCanvasCursor(
  std::uint64_t cacheKey,
  long* outLastFrame,
  bool* outInitialized
);

bool QueryBitmapGpuNearestCheckpoint(
  std::uint64_t cacheKey,
  long targetFrame,
  long* outCheckpointFrame
);

void DisposeBitmapGpuStateByCacheKey(std::uint64_t cacheKey, const char* reason = nullptr);

PF_Err RenderBitmapFramePlan(
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

}  // namespace momentum
