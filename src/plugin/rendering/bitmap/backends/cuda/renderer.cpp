#include "rendering/bitmap/backends/cuda/renderer.h"

#include "rendering/bitmap/backends/compute/device.h"
#include "rendering/bitmap/backends/compute/executor.h"
#include "rendering/bitmap/backends/cuda/compatibility.h"
#include "rendering/bitmap/backends/cuda/context_scope.h"
#include "rendering/bitmap/backends/cuda/kernels.h"

#include <Windows.h>

#include <array>
#include <cstdint>
#include <new>
#include <sstream>
#include <string>

namespace momentum {
namespace bitmap {
namespace cuda {
namespace {

using CUresult = int;
using CUdevice = int;
using CUdeviceptr = unsigned long long;
using CUcontext = struct CUctx_st*;
using CUstream = struct CUstream_st*;
using CUmodule = struct CUmod_st*;
using CUfunction = struct CUfunc_st*;

constexpr CUresult CUDA_SUCCESS = 0;

struct DriverApi {
  HMODULE library = NULL;
  CUresult (WINAPI* ctxGetCurrent)(CUcontext*) = nullptr;
  CUresult (WINAPI* ctxPushCurrent)(CUcontext) = nullptr;
  CUresult (WINAPI* ctxPopCurrent)(CUcontext*) = nullptr;
  CUresult (WINAPI* driverGetVersion)(int*) = nullptr;
  CUresult (WINAPI* deviceComputeCapability)(int*, int*, CUdevice) = nullptr;
  CUresult (WINAPI* deviceGetName)(char*, int, CUdevice) = nullptr;
  CUresult (WINAPI* moduleLoadDataEx)(
    CUmodule*, const void*, unsigned int, int*, void**
  ) = nullptr;
  CUresult (WINAPI* moduleUnload)(CUmodule) = nullptr;
  CUresult (WINAPI* moduleGetFunction)(CUfunction*, CUmodule, const char*) = nullptr;
  CUresult (WINAPI* launchKernel)(
    CUfunction,
    unsigned int,
    unsigned int,
    unsigned int,
    unsigned int,
    unsigned int,
    unsigned int,
    unsigned int,
    CUstream,
    void**,
    void**
  ) = nullptr;
  CUresult (WINAPI* memcpyHtoDAsync)(CUdeviceptr, const void*, std::size_t, CUstream) = nullptr;
  CUresult (WINAPI* streamSynchronize)(CUstream) = nullptr;
  CUresult (WINAPI* getErrorName)(CUresult, const char**) = nullptr;
  CUresult (WINAPI* getErrorString)(CUresult, const char**) = nullptr;
};

struct Context {
  DriverApi api;
  CUdevice device = 0;
  CUcontext aeContext = nullptr;
  int driverVersion = 0;
  int computeMajor = 0;
  int computeMinor = 0;
  std::string deviceName;
  CUmodule module = nullptr;
  CUfunction clear = nullptr;
  CUfunction copy = nullptr;
  CUfunction fill = nullptr;
  CUfunction pathFill = nullptr;
  CUfunction image = nullptr;
  CUfunction composite = nullptr;
  CUfunction filter = nullptr;
  CUfunction mask = nullptr;
  CUfunction copyOutput = nullptr;
};

template <typename T>
bool LoadSymbol(HMODULE library, const char* name, T* output) {
  if (!library || !name || !output) {
    return false;
  }
  *output = reinterpret_cast<T>(GetProcAddress(library, name));
  return *output != nullptr;
}

template <typename T>
bool LoadEitherSymbol(
  HMODULE library,
  const char* preferredName,
  const char* fallbackName,
  T* output
) {
  return LoadSymbol(library, preferredName, output) ||
    LoadSymbol(library, fallbackName, output);
}

void UnloadDriverApi(DriverApi* api) {
  if (!api) {
    return;
  }
  if (api->library) {
    FreeLibrary(api->library);
  }
  *api = DriverApi{};
}

bool LoadDriverApi(DriverApi* api, std::string* errorMessage) {
  if (!api) {
    return false;
  }
  api->library = LoadLibraryW(L"nvcuda.dll");
  if (!api->library) {
    if (errorMessage) {
      *errorMessage = "CUDA driver library nvcuda.dll is unavailable.";
    }
    return false;
  }
  const bool loaded =
    LoadSymbol(api->library, "cuCtxGetCurrent", &api->ctxGetCurrent) &&
    LoadEitherSymbol(
      api->library,
      "cuCtxPushCurrent_v2",
      "cuCtxPushCurrent",
      &api->ctxPushCurrent
    ) &&
    LoadEitherSymbol(
      api->library,
      "cuCtxPopCurrent_v2",
      "cuCtxPopCurrent",
      &api->ctxPopCurrent
    ) &&
    LoadSymbol(api->library, "cuDriverGetVersion", &api->driverGetVersion) &&
    LoadSymbol(
      api->library,
      "cuDeviceComputeCapability",
      &api->deviceComputeCapability
    ) &&
    LoadSymbol(api->library, "cuDeviceGetName", &api->deviceGetName) &&
    LoadSymbol(api->library, "cuModuleLoadDataEx", &api->moduleLoadDataEx) &&
    LoadSymbol(api->library, "cuModuleUnload", &api->moduleUnload) &&
    LoadSymbol(api->library, "cuModuleGetFunction", &api->moduleGetFunction) &&
    LoadSymbol(api->library, "cuLaunchKernel", &api->launchKernel) &&
    LoadSymbol(api->library, "cuMemcpyHtoDAsync_v2", &api->memcpyHtoDAsync) &&
    LoadSymbol(api->library, "cuStreamSynchronize", &api->streamSynchronize) &&
    LoadSymbol(api->library, "cuGetErrorName", &api->getErrorName) &&
    LoadSymbol(api->library, "cuGetErrorString", &api->getErrorString);
  if (!loaded) {
    if (errorMessage) {
      *errorMessage = "CUDA driver is missing one or more required entry points.";
    }
    UnloadDriverApi(api);
    return false;
  }
  return true;
}

std::string DriverError(const DriverApi& api, CUresult error, const char* operation) {
  const char* name = nullptr;
  const char* detail = nullptr;
  if (api.getErrorName) {
    (void)api.getErrorName(error, &name);
  }
  if (api.getErrorString) {
    (void)api.getErrorString(error, &detail);
  }
  std::ostringstream stream;
  stream << (operation ? operation : "CUDA operation") << " failed (" << error;
  if (name) {
    stream << ", " << name;
  }
  stream << ')';
  if (detail) {
    stream << ": " << detail;
  }
  return stream.str();
}

using CurrentContextScope = detail::ContextScope<DriverApi, CUcontext>;

void SetContextScopeError(
  const DriverApi& api,
  const CurrentContextScope& scope,
  std::string* errorMessage
) {
  if (!errorMessage) {
    return;
  }
  if (scope.operation() == detail::ContextScopeOperation::kUnexpectedPoppedContext) {
    *errorMessage = "CUDA context restore returned an unexpected context.";
    return;
  }
  *errorMessage = DriverError(
    api,
    scope.result(),
    detail::ContextScopeOperationName(scope.operation())
  );
}

std::string BuildDeviceDiagnostic(const Context& context) {
  std::ostringstream detail;
  detail
    << "cudaDevice=" << context.device
    << " cudaContext=" << reinterpret_cast<std::uintptr_t>(context.aeContext)
    << " deviceName=\"" << context.deviceName << '"'
    << " computeCapability=" << context.computeMajor << '.' << context.computeMinor
    << " driverVersion=" << context.driverVersion
    << " ptxTarget=" << detail::kPtxArchitecture;
  return detail.str();
}

bool ReadDeviceMetadata(Context* context, std::string* errorMessage) {
  if (!context) {
    return false;
  }

  CUresult result = context->api.driverGetVersion(&context->driverVersion);
  if (result != CUDA_SUCCESS) {
    if (errorMessage) {
      *errorMessage = DriverError(context->api, result, "CUDA driver version query");
    }
    return false;
  }

  result = context->api.deviceComputeCapability(
    &context->computeMajor,
    &context->computeMinor,
    context->device
  );
  if (result != CUDA_SUCCESS) {
    if (errorMessage) {
      *errorMessage = DriverError(context->api, result, "CUDA compute capability query");
    }
    return false;
  }

  std::array<char, 256> name{};
  result = context->api.deviceGetName(
    name.data(),
    static_cast<int>(name.size()),
    context->device
  );
  if (result != CUDA_SUCCESS) {
    if (errorMessage) {
      *errorMessage = DriverError(context->api, result, "CUDA device name query");
    }
    return false;
  }
  context->deviceName = name.data();

  if (!detail::IsComputeCapabilitySupported(
        context->computeMajor,
        context->computeMinor
      )) {
    if (errorMessage) {
      std::ostringstream message;
      message
        << "CUDA device \"" << context->deviceName
        << "\" has compute capability "
        << context->computeMajor << '.' << context->computeMinor
        << "; Momentum requires 5.2 or newer.";
      *errorMessage = message.str();
    }
    return false;
  }
  return true;
}

bool LoadKernel(
  Context* context,
  const char* name,
  CUfunction* function,
  std::string* errorMessage
) {
  const CUresult result = context->api.moduleGetFunction(
    function, context->module, name
  );
  if (result == CUDA_SUCCESS && *function) {
    return true;
  }
  if (errorMessage) {
    *errorMessage = DriverError(context->api, result, name);
  }
  return false;
}

void ResetModule(Context* context) {
  if (!context) {
    return;
  }
  context->module = nullptr;
  context->clear = nullptr;
  context->copy = nullptr;
  context->fill = nullptr;
  context->pathFill = nullptr;
  context->image = nullptr;
  context->composite = nullptr;
  context->filter = nullptr;
  context->mask = nullptr;
  context->copyOutput = nullptr;
}

bool LoadModule(Context* context, std::string* errorMessage) {
  const CUresult moduleResult = context->api.moduleLoadDataEx(
    &context->module, KernelPtx(), 0, nullptr, nullptr
  );
  if (moduleResult != CUDA_SUCCESS || !context->module) {
    if (errorMessage) {
      *errorMessage = DriverError(
        context->api,
        moduleResult,
        "CUDA PTX module load"
      );
    }
    ResetModule(context);
    return false;
  }

  const bool kernelsLoaded =
    LoadKernel(context, "momentum_clear", &context->clear, errorMessage) &&
    LoadKernel(context, "momentum_copy", &context->copy, errorMessage) &&
    LoadKernel(context, "momentum_fill", &context->fill, errorMessage) &&
    LoadKernel(context, "momentum_path_fill", &context->pathFill, errorMessage) &&
    LoadKernel(context, "momentum_image", &context->image, errorMessage) &&
    LoadKernel(context, "momentum_composite", &context->composite, errorMessage) &&
    LoadKernel(context, "momentum_filter", &context->filter, errorMessage) &&
    LoadKernel(context, "momentum_mask", &context->mask, errorMessage) &&
    LoadKernel(context, "momentum_copy_output", &context->copyOutput, errorMessage);
  if (!kernelsLoaded) {
    (void)context->api.moduleUnload(context->module);
    ResetModule(context);
    return false;
  }
  return true;
}

bool InitializeContext(
  Context* context,
  std::string* errorMessage,
  std::string* diagnosticDetail
) {
  CurrentContextScope scope(context->api, context->aeContext);
  if (!scope.active()) {
    SetContextScopeError(context->api, scope, errorMessage);
    return false;
  }
  const bool metadataAvailable = ReadDeviceMetadata(context, errorMessage);
  if (diagnosticDetail &&
      (context->driverVersion != 0 ||
       context->computeMajor != 0 ||
       !context->deviceName.empty())) {
    *diagnosticDetail = BuildDeviceDiagnostic(*context);
  }
  if (!metadataAvailable || !LoadModule(context, errorMessage)) {
    return false;
  }
  if (!scope.Release()) {
    SetContextScopeError(context->api, scope, errorMessage);
    return false;
  }
  return true;
}

CUdeviceptr DevicePointer(const compute::Buffer& buffer) {
  return static_cast<CUdeviceptr>(
    reinterpret_cast<std::uintptr_t>(buffer.memory)
  );
}

class CudaDevice final : public compute::Device {
 public:
  CudaDevice(Context& context, CUstream stream)
    : context_(context), stream_(stream) {}

  bool Upload(
    const compute::Buffer& destination,
    const void* source,
    std::size_t byteSize,
    std::string* errorMessage
  ) override {
    if (!destination.memory || !source || byteSize > destination.byteSize) {
      if (errorMessage) {
        *errorMessage = "CUDA upload request is invalid.";
      }
      return false;
    }
    const CUresult result = context_.api.memcpyHtoDAsync(
      DevicePointer(destination), source, byteSize, stream_
    );
    return Check(result, "CUDA host-to-device upload", errorMessage);
  }

  bool Clear(
    const compute::Buffer& destination,
    std::uint32_t width,
    std::uint32_t height,
    const compute::Float4& color,
    std::string* errorMessage
  ) override {
    CUdeviceptr destinationPointer = DevicePointer(destination);
    void* arguments[] = {&destinationPointer, &width, &height, const_cast<compute::Float4*>(&color)};
    return Launch(context_.clear, width, height, arguments, "CUDA clear kernel", errorMessage);
  }

  bool Copy(
    const compute::Buffer& source,
    const compute::Buffer& destination,
    std::uint32_t width,
    std::uint32_t height,
    std::string* errorMessage
  ) override {
    CUdeviceptr sourcePointer = DevicePointer(source);
    CUdeviceptr destinationPointer = DevicePointer(destination);
    void* arguments[] = {&sourcePointer, &destinationPointer, &width, &height};
    return Launch(context_.copy, width, height, arguments, "CUDA copy kernel", errorMessage);
  }

  bool Fill(
    const compute::Buffer& destination,
    const compute::Buffer& triangles,
    const compute::Buffer& edges,
    const compute::Buffer& clipVertices,
    const compute::Buffer& clipContours,
    const compute::Buffer& clipImage,
    const compute::FillParams& params,
    std::string* errorMessage
  ) override {
    CUdeviceptr pointers[] = {
      DevicePointer(destination), DevicePointer(triangles), DevicePointer(edges),
      DevicePointer(clipVertices), DevicePointer(clipContours), DevicePointer(clipImage)
    };
    void* arguments[] = {
      &pointers[0], &pointers[1], &pointers[2], &pointers[3], &pointers[4], &pointers[5],
      const_cast<compute::FillParams*>(&params)
    };
    return Launch(
      context_.fill,
      params.regionWidth,
      params.regionHeight,
      arguments,
      "CUDA fill kernel",
      errorMessage
    );
  }

  bool PathFill(
    const compute::Buffer& destination,
    const compute::Buffer& vertices,
    const compute::Buffer& contours,
    const compute::Buffer& clipImage,
    const compute::PathFillParams& params,
    std::string* errorMessage
  ) override {
    CUdeviceptr pointers[] = {
      DevicePointer(destination), DevicePointer(vertices), DevicePointer(contours),
      DevicePointer(clipImage)
    };
    void* arguments[] = {
      &pointers[0], &pointers[1], &pointers[2], &pointers[3],
      const_cast<compute::PathFillParams*>(&params)
    };
    return Launch(
      context_.pathFill,
      params.regionWidth,
      params.regionHeight,
      arguments,
      "CUDA path-fill kernel",
      errorMessage
    );
  }

  bool Image(
    const compute::Buffer& destination,
    const compute::Buffer& image,
    const compute::Buffer& clipImage,
    const compute::ImageParams& params,
    std::string* errorMessage
  ) override {
    CUdeviceptr pointers[] = {
      DevicePointer(destination), DevicePointer(image), DevicePointer(clipImage)
    };
    void* arguments[] = {
      &pointers[0], &pointers[1], &pointers[2],
      const_cast<compute::ImageParams*>(&params)
    };
    return Launch(
      context_.image,
      params.regionWidth,
      params.regionHeight,
      arguments,
      "CUDA image kernel",
      errorMessage
    );
  }

  bool Composite(
    const compute::Buffer& source,
    const compute::Buffer& destination,
    const compute::BlendParams& params,
    std::string* errorMessage
  ) override {
    CUdeviceptr pointers[] = {DevicePointer(source), DevicePointer(destination)};
    void* arguments[] = {
      &pointers[0], &pointers[1], const_cast<compute::BlendParams*>(&params)
    };
    return Launch(
      context_.composite,
      params.width,
      params.height,
      arguments,
      "CUDA composite kernel",
      errorMessage
    );
  }

  bool Filter(
    const compute::Buffer& source,
    const compute::Buffer& destination,
    const compute::FilterParams& params,
    std::string* errorMessage
  ) override {
    CUdeviceptr pointers[] = {DevicePointer(source), DevicePointer(destination)};
    void* arguments[] = {
      &pointers[0], &pointers[1], const_cast<compute::FilterParams*>(&params)
    };
    return Launch(
      context_.filter,
      params.width,
      params.height,
      arguments,
      "CUDA filter kernel",
      errorMessage
    );
  }

  bool Mask(
    const compute::Buffer& source,
    const compute::Buffer& mask,
    const compute::Buffer& destination,
    std::uint32_t width,
    std::uint32_t height,
    std::uint32_t maskWidth,
    std::uint32_t maskHeight,
    std::string* errorMessage
  ) override {
    CUdeviceptr pointers[] = {
      DevicePointer(source), DevicePointer(mask), DevicePointer(destination)
    };
    void* arguments[] = {
      &pointers[0], &pointers[1], &pointers[2],
      &width, &height, &maskWidth, &maskHeight
    };
    return Launch(context_.mask, width, height, arguments, "CUDA mask kernel", errorMessage);
  }

  bool CopyToOutput(
    const compute::Buffer& source,
    void* outputMemory,
    const compute::CopyOutputParams& params,
    std::string* errorMessage
  ) override {
    CUdeviceptr sourcePointer = DevicePointer(source);
    CUdeviceptr outputPointer = static_cast<CUdeviceptr>(
      reinterpret_cast<std::uintptr_t>(outputMemory)
    );
    void* arguments[] = {
      &sourcePointer, &outputPointer,
      const_cast<compute::CopyOutputParams*>(&params)
    };
    return Launch(
      context_.copyOutput,
      params.width,
      params.height,
      arguments,
      "CUDA output kernel",
      errorMessage
    );
  }

  bool Finish(std::string* errorMessage) override {
    return Check(
      context_.api.streamSynchronize(stream_),
      "CUDA stream synchronization",
      errorMessage
    );
  }

 private:
  bool Check(CUresult result, const char* operation, std::string* errorMessage) const {
    if (result == CUDA_SUCCESS) {
      return true;
    }
    if (errorMessage) {
      *errorMessage = DriverError(context_.api, result, operation);
    }
    return false;
  }

  bool Launch(
    CUfunction function,
    std::uint32_t width,
    std::uint32_t height,
    void** arguments,
    const char* operation,
    std::string* errorMessage
  ) const {
    if (!function || width == 0 || height == 0) {
      if (width == 0 || height == 0) {
        return true;
      }
      if (errorMessage) {
        *errorMessage = std::string(operation) + " is unavailable.";
      }
      return false;
    }
    constexpr unsigned int blockWidth = 16;
    constexpr unsigned int blockHeight = 16;
    const CUresult result = context_.api.launchKernel(
      function,
      (width + blockWidth - 1U) / blockWidth,
      (height + blockHeight - 1U) / blockHeight,
      1,
      blockWidth,
      blockHeight,
      1,
      0,
      stream_,
      arguments,
      nullptr
    );
    return Check(result, operation, errorMessage);
  }

  Context& context_;
  CUstream stream_ = nullptr;
};

}  // namespace

PF_Err CreateContext(
  const PF_GPUDeviceInfo& deviceInfo,
  void** output,
  std::string* errorMessage,
  std::string* diagnosticDetail
) {
  // PF_GPUDeviceInfo::devicePV stores a CUdevice value for CUDA, not a
  // pointer. CUDA device zero is valid and is represented by nullptr after
  // AE places that integer value in the generic void* field.
  if (!output ||
      deviceInfo.device_framework != PF_GPU_Framework_CUDA ||
      !deviceInfo.contextPV) {
    if (errorMessage) {
      *errorMessage = "AE did not provide a valid CUDA context.";
    }
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  *output = nullptr;
  if (errorMessage) {
    errorMessage->clear();
  }
  if (diagnosticDetail) {
    diagnosticDetail->clear();
  }
  auto* context = new (std::nothrow) Context();
  if (!context) {
    if (errorMessage) {
      *errorMessage = "Failed to allocate the CUDA Bitmap context.";
    }
    return PF_Err_OUT_OF_MEMORY;
  }
  if (!LoadDriverApi(&context->api, errorMessage)) {
    delete context;
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  context->device = static_cast<CUdevice>(
    reinterpret_cast<std::intptr_t>(deviceInfo.devicePV)
  );
  context->aeContext = reinterpret_cast<CUcontext>(deviceInfo.contextPV);
  if (!InitializeContext(context, errorMessage, diagnosticDetail)) {
    DestroyContext(context);
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  if (diagnosticDetail && diagnosticDetail->empty()) {
    *diagnosticDetail = BuildDeviceDiagnostic(*context);
  }
  *output = context;
  return PF_Err_NONE;
}

void DestroyContext(void* opaque) {
  auto* context = static_cast<Context*>(opaque);
  if (!context) {
    return;
  }
  if (context->module && context->api.moduleUnload) {
    CurrentContextScope scope(context->api, context->aeContext);
    if (scope.active()) {
      (void)context->api.moduleUnload(context->module);
      ResetModule(context);
    }
  }
  UnloadDriverApi(&context->api);
  delete context;
}

PF_Err Render(
  void* opaque,
  const gpu::Target& target,
  const BitmapFramePlan& plan,
  std::string* errorMessage
) {
  auto* context = static_cast<Context*>(opaque);
  const CUcontext renderContext = reinterpret_cast<CUcontext>(
    target.deviceInfo.contextPV
  );
  if (!context || !renderContext || !target.deviceInfo.command_queuePV) {
    if (errorMessage) {
      *errorMessage = "CUDA Bitmap context/stream is unavailable.";
    }
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  if (renderContext != context->aeContext) {
    if (errorMessage) {
      *errorMessage =
        "AE changed the CUDA context after GPU setup; refusing to reuse a module from another context.";
    }
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  CurrentContextScope scope(context->api, renderContext);
  if (!scope.active()) {
    SetContextScopeError(context->api, scope, errorMessage);
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  CudaDevice device(
    *context,
    reinterpret_cast<CUstream>(target.deviceInfo.command_queuePV)
  );
  const PF_Err renderError = compute::Execute(
    device,
    target,
    plan,
    errorMessage
  );
  if (!scope.Release()) {
    SetContextScopeError(context->api, scope, errorMessage);
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  return renderError;
}

}  // namespace cuda
}  // namespace bitmap
}  // namespace momentum
