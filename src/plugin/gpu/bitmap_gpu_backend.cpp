#include "bitmap_gpu_backend.h"

#include <memory>
#include <utility>

namespace momentum {

PF_Err RenderBitmapPlanWithMetal(
  const BitmapGpuRenderTarget& target,
  const BitmapFramePlan& plan,
  std::string* errorMessage
);

void DisposeAllMetalBitmapGpuState(const char* reason);
void DisposeMetalBitmapGpuStateByCacheKey(std::uint64_t cacheKey, const char* reason);
bool QueryMetalBitmapCanvasCursor(
  std::uint64_t cacheKey,
  long* outLastFrame,
  bool* outInitialized
);
bool QueryMetalBitmapNearestCheckpoint(
  std::uint64_t cacheKey,
  long targetFrame,
  long* outCheckpointFrame
);

namespace {

class BitmapGpuBackend {
public:
  virtual ~BitmapGpuBackend() = default;
  virtual PF_GPU_Framework framework() const = 0;
  virtual PF_Err Render(
    const BitmapGpuRenderTarget& target,
    const BitmapFramePlan& plan,
    std::string* errorMessage
  ) = 0;
};

class UnsupportedBitmapGpuBackend : public BitmapGpuBackend {
public:
  explicit UnsupportedBitmapGpuBackend(PF_GPU_Framework frameworkValue)
    : frameworkValue_(frameworkValue) {}

  PF_GPU_Framework framework() const override {
    return frameworkValue_;
  }

  PF_Err Render(
    const BitmapGpuRenderTarget&,
    const BitmapFramePlan&,
    std::string* errorMessage
  ) override {
    if (errorMessage) {
      *errorMessage = "Bitmap GPU backend is not implemented for the requested framework.";
    }
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

private:
  PF_GPU_Framework frameworkValue_ = PF_GPU_Framework_NONE;
};

#if defined(__APPLE__)
class MetalBitmapBackend : public BitmapGpuBackend {
public:
  PF_GPU_Framework framework() const override {
    return PF_GPU_Framework_METAL;
  }

  PF_Err Render(
    const BitmapGpuRenderTarget& target,
    const BitmapFramePlan& plan,
    std::string* errorMessage
  ) override {
    return RenderBitmapPlanWithMetal(target, plan, errorMessage);
  }
};
#endif

#if defined(_WIN32)
class DirectXBitmapBackend : public BitmapGpuBackend {
public:
  PF_GPU_Framework framework() const override {
    return PF_GPU_Framework_DIRECTX;
  }

  PF_Err Render(
    const BitmapGpuRenderTarget&,
    const BitmapFramePlan&,
    std::string* errorMessage
  ) override {
    if (errorMessage) {
      *errorMessage = "DirectX bitmap GPU backend is not implemented yet.";
    }
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
};
#endif

struct BitmapGpuDeviceContext {
  PF_GPU_Framework framework = PF_GPU_Framework_NONE;
  A_u_long deviceIndex = 0;
  std::unique_ptr<BitmapGpuBackend> backend;
};

struct BitmapGpuDeviceContextHandleData {
  BitmapGpuDeviceContext* context = nullptr;
};

std::unique_ptr<BitmapGpuBackend> CreateBackend(PF_GPU_Framework framework) {
#if defined(__APPLE__)
  if (framework == PF_GPU_Framework_METAL) {
    return std::make_unique<MetalBitmapBackend>();
  }
#endif
#if defined(_WIN32)
  if (framework == PF_GPU_Framework_DIRECTX) {
    return std::make_unique<DirectXBitmapBackend>();
  }
#endif
  return std::make_unique<UnsupportedBitmapGpuBackend>(framework);
}

}  // namespace

bool BitmapGpuBackendAvailable() {
#if defined(__APPLE__) || defined(_WIN32)
  return true;
#else
  return false;
#endif
}

bool BitmapGpuFrameworkSupported(PF_GPU_Framework framework) {
#if defined(__APPLE__)
  if (framework == PF_GPU_Framework_METAL) {
    return true;
  }
#endif
#if defined(_WIN32)
  if (framework == PF_GPU_Framework_DIRECTX) {
    return true;
  }
#endif
  return false;
}

bool QueryBitmapGpuCanvasCursor(
  std::uint64_t cacheKey,
  long* outLastFrame,
  bool* outInitialized
) {
#if defined(__APPLE__)
  return QueryMetalBitmapCanvasCursor(cacheKey, outLastFrame, outInitialized);
#endif
  if (outLastFrame) {
    *outLastFrame = 0;
  }
  if (outInitialized) {
    *outInitialized = false;
  }
  return false;
}

bool QueryBitmapGpuNearestCheckpoint(
  std::uint64_t cacheKey,
  long targetFrame,
  long* outCheckpointFrame
) {
#if defined(__APPLE__)
  return QueryMetalBitmapNearestCheckpoint(cacheKey, targetFrame, outCheckpointFrame);
#endif
  if (outCheckpointFrame) {
    *outCheckpointFrame = 0;
  }
  return false;
}

PF_Err CreateBitmapGpuDeviceContext(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_GPU_Framework framework,
  A_u_long deviceIndex,
  void** outGpuData,
  std::string* errorMessage
) {
  if (!outGpuData) {
    if (errorMessage) {
      *errorMessage = "Bitmap GPU context output pointer is null.";
    }
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  if (!in_data || !out_data) {
    if (errorMessage) {
      *errorMessage = "Bitmap GPU context setup requires valid AE in/out data.";
    }
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  AEFX_SuiteScoper<PF_HandleSuite1> handleSuite =
    AEFX_SuiteScoper<PF_HandleSuite1>(
      in_data,
      kPFHandleSuite,
      kPFHandleSuiteVersion1,
      out_data
    );

  PF_Handle handle = handleSuite->host_new_handle(sizeof(BitmapGpuDeviceContextHandleData));
  if (!handle) {
    if (errorMessage) {
      *errorMessage = "Failed to allocate AE host handle for bitmap GPU context.";
    }
    return PF_Err_OUT_OF_MEMORY;
  }

  auto* handleData = reinterpret_cast<BitmapGpuDeviceContextHandleData*>(handleSuite->host_lock_handle(handle));
  if (!handleData) {
    handleSuite->host_dispose_handle(handle);
    if (errorMessage) {
      *errorMessage = "Failed to lock AE host handle for bitmap GPU context.";
    }
    return PF_Err_OUT_OF_MEMORY;
  }

  auto context = std::make_unique<BitmapGpuDeviceContext>();
  context->framework = framework;
  context->deviceIndex = deviceIndex;
  context->backend = CreateBackend(framework);
  if (!context->backend) {
    handleSuite->host_unlock_handle(handle);
    handleSuite->host_dispose_handle(handle);
    if (errorMessage) {
      *errorMessage = "Failed to create bitmap GPU backend.";
    }
    return PF_Err_OUT_OF_MEMORY;
  }

  handleData->context = context.release();
  handleSuite->host_unlock_handle(handle);

  *outGpuData = handle;
  return PF_Err_NONE;
}

void DisposeBitmapGpuDeviceContext(
  PF_InData* in_data,
  PF_OutData* out_data,
  void* gpuData
) {
  if (!in_data || !out_data || !gpuData) {
    return;
  }

  AEFX_SuiteScoper<PF_HandleSuite1> handleSuite =
    AEFX_SuiteScoper<PF_HandleSuite1>(
      in_data,
      kPFHandleSuite,
      kPFHandleSuiteVersion1,
      out_data
    );

  PF_Handle handle = reinterpret_cast<PF_Handle>(gpuData);
  auto* handleData =
    reinterpret_cast<BitmapGpuDeviceContextHandleData*>(handleSuite->host_lock_handle(handle));
  if (handleData) {
    delete handleData->context;
    handleData->context = nullptr;
    handleSuite->host_unlock_handle(handle);
  }
  handleSuite->host_dispose_handle(handle);
}

void DisposeAllBitmapGpuGlobalState(const char* reason) {
#if defined(__APPLE__)
  DisposeAllMetalBitmapGpuState(reason);
#endif
}

void DisposeBitmapGpuStateByCacheKey(std::uint64_t cacheKey, const char* reason) {
  if (cacheKey == 0) {
    return;
  }
#if defined(__APPLE__)
  DisposeMetalBitmapGpuStateByCacheKey(cacheKey, reason);
#else
  (void)cacheKey;
  (void)reason;
#endif
}

PF_Err RenderBitmapFramePlan(
  PF_InData* in_data,
  PF_OutData* out_data,
  void* gpuData,
  PF_EffectWorld* outputWorld,
  PF_PixelFormat pixelFormat,
  A_long sourceOriginX,
  A_long sourceOriginY,
  const BitmapFramePlan& plan,
  std::string* errorMessage
) {
  if (!in_data || !out_data) {
    if (errorMessage) {
      *errorMessage = "Bitmap GPU render is missing AE in/out data.";
    }
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  AEFX_SuiteScoper<PF_HandleSuite1> handleSuite =
    AEFX_SuiteScoper<PF_HandleSuite1>(
      in_data,
      kPFHandleSuite,
      kPFHandleSuiteVersion1,
      out_data
    );

  auto* handleData =
    gpuData
      ? reinterpret_cast<BitmapGpuDeviceContextHandleData*>(handleSuite->host_lock_handle(reinterpret_cast<PF_Handle>(gpuData)))
      : nullptr;
  BitmapGpuDeviceContext* context = handleData ? handleData->context : nullptr;
  if (!context || !context->backend || !outputWorld) {
    if (gpuData && handleData) {
      handleSuite->host_unlock_handle(reinterpret_cast<PF_Handle>(gpuData));
    }
    if (errorMessage) {
      *errorMessage = "Bitmap GPU render context is not initialized.";
    }
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  AEFX_SuiteScoper<PF_GPUDeviceSuite1> gpuSuite =
    AEFX_SuiteScoper<PF_GPUDeviceSuite1>(
      in_data,
      kPFGPUDeviceSuite,
      kPFGPUDeviceSuiteVersion1,
      out_data
    );

  PF_GPUDeviceInfo deviceInfo{};
  PF_Err err = gpuSuite->GetDeviceInfo(
    in_data->effect_ref,
    context->deviceIndex,
    &deviceInfo
  );
  if (err != PF_Err_NONE) {
    handleSuite->host_unlock_handle(reinterpret_cast<PF_Handle>(gpuData));
    if (errorMessage) {
      *errorMessage = "Failed to fetch AE GPU device info.";
    }
    return err;
  }

  void* outputWorldData = NULL;
  err = gpuSuite->GetGPUWorldData(in_data->effect_ref, outputWorld, &outputWorldData);
  if (err != PF_Err_NONE) {
    handleSuite->host_unlock_handle(reinterpret_cast<PF_Handle>(gpuData));
    if (errorMessage) {
      *errorMessage = "Failed to access AE GPU output world data.";
    }
    return err;
  }

  BitmapGpuRenderTarget target;
  target.outputWorld = outputWorld;
  target.pixelFormat = pixelFormat;
  target.outputWorldData = outputWorldData;
  target.sourceOriginX = sourceOriginX;
  target.sourceOriginY = sourceOriginY;
  target.logicalWidth = plan.logicalWidth > 0 ? plan.logicalWidth : outputWorld->width;
  target.logicalHeight = plan.logicalHeight > 0 ? plan.logicalHeight : outputWorld->height;
  target.deviceInfo = deviceInfo;
  const PF_Err renderErr = context->backend->Render(target, plan, errorMessage);
  handleSuite->host_unlock_handle(reinterpret_cast<PF_Handle>(gpuData));
  return renderErr;
}

#if !defined(__APPLE__)
PF_Err RenderBitmapPlanWithMetal(
  const BitmapGpuRenderTarget&,
  const BitmapFramePlan&,
  std::string* errorMessage
) {
  if (errorMessage) {
    *errorMessage = "Metal bitmap GPU backend is unavailable in this build.";
  }
  return PF_Err_INTERNAL_STRUCT_DAMAGED;
}

bool QueryMetalBitmapCanvasCursor(
  std::uint64_t,
  long* outLastFrame,
  bool* outInitialized
) {
  if (outLastFrame) {
    *outLastFrame = 0;
  }
  if (outInitialized) {
    *outInitialized = false;
  }
  return false;
}
#endif

}  // namespace momentum
