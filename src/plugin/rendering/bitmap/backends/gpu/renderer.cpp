#include "rendering/bitmap/backends/gpu/renderer.h"

#include <new>

#if defined(_WIN32)
  #include "rendering/bitmap/backends/cuda/renderer.h"
  #include "rendering/bitmap/backends/opencl/renderer.h"
#endif

namespace momentum {
namespace bitmap {
namespace metal {

PF_Err Render(
  const gpu::Target& target,
  const BitmapFramePlan& plan,
  std::string* errorMessage
);

void ClearAllCaches();
void ClearCache(std::uint64_t cacheKey);

}  // namespace metal

namespace gpu {

namespace {

struct DeviceContext {
  A_u_long deviceIndex = 0;
  PF_GPU_Framework framework = PF_GPU_Framework_NONE;
  void* backendData = nullptr;
};

struct ContextHandle {
  DeviceContext* context = nullptr;
};

void DestroyBackend(PF_GPU_Framework framework, void* backendData) {
#if defined(_WIN32)
  if (framework == PF_GPU_Framework_CUDA) {
    cuda::DestroyContext(backendData);
  } else if (framework == PF_GPU_Framework_OPENCL) {
    opencl::DestroyContext(backendData);
  }
#else
  (void)framework;
  (void)backendData;
#endif
}

}  // namespace

bool Available(PF_GPU_Framework framework) {
#if defined(__APPLE__)
  return framework == PF_GPU_Framework_METAL;
#elif defined(_WIN32)
  return framework == PF_GPU_Framework_CUDA ||
    framework == PF_GPU_Framework_OPENCL;
#else
  (void)framework;
  return false;
#endif
}

PF_Err CreateContext(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_GPU_Framework framework,
  A_u_long deviceIndex,
  void** outGpuData,
  std::string* errorMessage,
  std::string* diagnosticDetail
) {
  if (!outGpuData) {
    if (errorMessage) {
      *errorMessage = "Bitmap GPU context output pointer is null.";
    }
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  *outGpuData = nullptr;
  if (diagnosticDetail) {
    diagnosticDetail->clear();
  }

  if (!in_data || !out_data) {
    if (errorMessage) {
      *errorMessage = "Bitmap GPU context setup requires valid AE in/out data.";
    }
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  if (!Available(framework)) {
    if (errorMessage) {
      *errorMessage = "Bitmap GPU renderer does not support the requested framework.";
    }
    return PF_Err_NONE;
  }

  AEFX_SuiteScoper<PF_GPUDeviceSuite1> gpuSuite =
    AEFX_SuiteScoper<PF_GPUDeviceSuite1>(
      in_data,
      kPFGPUDeviceSuite,
      kPFGPUDeviceSuiteVersion1,
      out_data
    );
  PF_GPUDeviceInfo deviceInfo{};
  PF_Err setupError = gpuSuite->GetDeviceInfo(
    in_data->effect_ref,
    deviceIndex,
    &deviceInfo
  );
  if (setupError != PF_Err_NONE) {
    if (errorMessage) {
      *errorMessage = "Failed to fetch AE GPU device info during setup.";
    }
    return setupError;
  }
  if (!deviceInfo.compatibleB) {
    if (errorMessage) {
      *errorMessage = "AE marked this GPU device as incompatible.";
    }
    return PF_Err_NONE;
  }

  void* backendData = nullptr;
#if defined(_WIN32)
  if (framework == PF_GPU_Framework_CUDA) {
    setupError = cuda::CreateContext(
      deviceInfo,
      &backendData,
      errorMessage,
      diagnosticDetail
    );
  } else if (framework == PF_GPU_Framework_OPENCL) {
    setupError = opencl::CreateContext(deviceInfo, &backendData, errorMessage);
  }
  if (setupError != PF_Err_NONE || !backendData) {
    return setupError;
  }
#endif

  AEFX_SuiteScoper<PF_HandleSuite1> handleSuite =
    AEFX_SuiteScoper<PF_HandleSuite1>(
      in_data,
      kPFHandleSuite,
      kPFHandleSuiteVersion1,
      out_data
    );

  PF_Handle handle = handleSuite->host_new_handle(sizeof(ContextHandle));
  if (!handle) {
    DestroyBackend(framework, backendData);
    if (errorMessage) {
      *errorMessage = "Failed to allocate AE host handle for bitmap GPU context.";
    }
    return PF_Err_OUT_OF_MEMORY;
  }

  auto* handleData = reinterpret_cast<ContextHandle*>(handleSuite->host_lock_handle(handle));
  if (!handleData) {
    DestroyBackend(framework, backendData);
    handleSuite->host_dispose_handle(handle);
    if (errorMessage) {
      *errorMessage = "Failed to lock AE host handle for bitmap GPU context.";
    }
    return PF_Err_OUT_OF_MEMORY;
  }

  auto* context = new (std::nothrow) DeviceContext();
  if (!context) {
    DestroyBackend(framework, backendData);
    handleSuite->host_unlock_handle(handle);
    handleSuite->host_dispose_handle(handle);
    if (errorMessage) {
      *errorMessage = "Failed to allocate bitmap GPU context.";
    }
    return PF_Err_OUT_OF_MEMORY;
  }
  context->deviceIndex = deviceIndex;
  context->framework = framework;
  context->backendData = backendData;
  handleData->context = context;
  handleSuite->host_unlock_handle(handle);

  *outGpuData = handle;
  return PF_Err_NONE;
}

void DestroyContext(
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
    reinterpret_cast<ContextHandle*>(handleSuite->host_lock_handle(handle));
  if (handleData) {
    if (handleData->context) {
      DestroyBackend(
        handleData->context->framework,
        handleData->context->backendData
      );
    }
    delete handleData->context;
    handleData->context = nullptr;
    handleSuite->host_unlock_handle(handle);
  }
  handleSuite->host_dispose_handle(handle);
}

void ClearAllCaches() {
#if defined(__APPLE__)
  metal::ClearAllCaches();
#endif
}

void ClearCache(std::uint64_t cacheKey) {
  if (cacheKey == 0) {
    return;
  }
#if defined(__APPLE__)
  metal::ClearCache(cacheKey);
#else
  (void)cacheKey;
#endif
}

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
      ? reinterpret_cast<ContextHandle*>(handleSuite->host_lock_handle(reinterpret_cast<PF_Handle>(gpuData)))
      : nullptr;
  DeviceContext* context = handleData ? handleData->context : nullptr;
  if (!context || !outputWorld) {
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

  Target target;
  target.inData = in_data;
  target.outData = out_data;
  target.deviceSuite = gpuSuite.operator->();
  target.deviceIndex = context->deviceIndex;
  target.outputWorld = outputWorld;
  target.pixelFormat = pixelFormat;
  target.outputWorldData = outputWorldData;
  target.sourceOriginX = sourceOriginX;
  target.sourceOriginY = sourceOriginY;
  target.sourceStepX = sourceStepX;
  target.sourceStepY = sourceStepY;
  target.logicalWidth = plan.logicalWidth > 0 ? plan.logicalWidth : outputWorld->width;
  target.logicalHeight = plan.logicalHeight > 0 ? plan.logicalHeight : outputWorld->height;
  target.deviceInfo = deviceInfo;
  PF_Err renderErr = PF_Err_INTERNAL_STRUCT_DAMAGED;
#if defined(__APPLE__)
  if (context->framework == PF_GPU_Framework_METAL) {
    renderErr = metal::Render(target, plan, errorMessage);
  } else
#elif defined(_WIN32)
  if (context->framework == PF_GPU_Framework_CUDA) {
    renderErr = cuda::Render(context->backendData, target, plan, errorMessage);
  } else if (context->framework == PF_GPU_Framework_OPENCL) {
    renderErr = opencl::Render(context->backendData, target, plan, errorMessage);
  } else
#endif
  {
    if (errorMessage) {
      *errorMessage = "Bitmap GPU renderer does not support the requested framework.";
    }
  }
  handleSuite->host_unlock_handle(reinterpret_cast<PF_Handle>(gpuData));
  return renderErr;
}

}  // namespace gpu

#if !defined(__APPLE__)
namespace metal {

PF_Err Render(
  const gpu::Target&,
  const BitmapFramePlan&,
  std::string* errorMessage
) {
  if (errorMessage) {
    *errorMessage = "Metal bitmap GPU backend is unavailable in this build.";
  }
  return PF_Err_INTERNAL_STRUCT_DAMAGED;
}

}  // namespace metal
#endif

}  // namespace bitmap
}  // namespace momentum
