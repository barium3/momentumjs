#include "rendering/bitmap/backends/cuda/compatibility.h"
#include "rendering/bitmap/backends/cuda/context_scope.h"
#include "rendering/bitmap/backends/cuda/kernels.h"

#include <Windows.h>

#include <array>
#include <iostream>

namespace {

using CUresult = int;
using CUdevice = int;
using CUcontext = struct CUctx_st*;
using CUmodule = struct CUmod_st*;
using CUfunction = struct CUfunc_st*;

constexpr CUresult CUDA_SUCCESS = 0;

template <typename T>
bool Load(HMODULE library, const char* name, T* output) {
  *output = reinterpret_cast<T>(GetProcAddress(library, name));
  return *output != nullptr;
}

template <typename T>
bool LoadEither(
  HMODULE library,
  const char* preferredName,
  const char* fallbackName,
  T* output
) {
  return Load(library, preferredName, output) ||
    Load(library, fallbackName, output);
}

struct ContextApi {
  CUresult (WINAPI* ctxGetCurrent)(CUcontext*) = nullptr;
  CUresult (WINAPI* ctxPushCurrent)(CUcontext) = nullptr;
  CUresult (WINAPI* ctxPopCurrent)(CUcontext*) = nullptr;
};

}  // namespace

int main() {
  HMODULE library = LoadLibraryW(L"nvcuda.dll");
  if (!library) {
    std::cerr << "nvcuda.dll is unavailable\n";
    return 1;
  }

  CUresult (WINAPI* cuInit)(unsigned int) = nullptr;
  CUresult (WINAPI* cuDeviceGet)(CUdevice*, int) = nullptr;
  CUresult (WINAPI* cuCtxCreate)(CUcontext*, unsigned int, CUdevice) = nullptr;
  CUresult (WINAPI* cuCtxDestroy)(CUcontext) = nullptr;
  ContextApi contextApi;
  CUresult (WINAPI* cuDriverGetVersion)(int*) = nullptr;
  CUresult (WINAPI* cuDeviceComputeCapability)(int*, int*, CUdevice) = nullptr;
  CUresult (WINAPI* cuDeviceGetName)(char*, int, CUdevice) = nullptr;
  CUresult (WINAPI* cuModuleLoadDataEx)(CUmodule*, const void*, unsigned int, int*, void**) = nullptr;
  CUresult (WINAPI* cuModuleUnload)(CUmodule) = nullptr;
  CUresult (WINAPI* cuModuleGetFunction)(CUfunction*, CUmodule, const char*) = nullptr;
  if (!Load(library, "cuInit", &cuInit) ||
      !Load(library, "cuDeviceGet", &cuDeviceGet) ||
      !Load(library, "cuCtxCreate_v2", &cuCtxCreate) ||
      !Load(library, "cuCtxDestroy_v2", &cuCtxDestroy) ||
      !Load(library, "cuCtxGetCurrent", &contextApi.ctxGetCurrent) ||
      !LoadEither(
        library,
        "cuCtxPushCurrent_v2",
        "cuCtxPushCurrent",
        &contextApi.ctxPushCurrent
      ) ||
      !LoadEither(
        library,
        "cuCtxPopCurrent_v2",
        "cuCtxPopCurrent",
        &contextApi.ctxPopCurrent
      ) ||
      !Load(library, "cuDriverGetVersion", &cuDriverGetVersion) ||
      !Load(
        library,
        "cuDeviceComputeCapability",
        &cuDeviceComputeCapability
      ) ||
      !Load(library, "cuDeviceGetName", &cuDeviceGetName) ||
      !Load(library, "cuModuleLoadDataEx", &cuModuleLoadDataEx) ||
      !Load(library, "cuModuleUnload", &cuModuleUnload) ||
      !Load(library, "cuModuleGetFunction", &cuModuleGetFunction)) {
    std::cerr << "CUDA driver entry points are incomplete\n";
    FreeLibrary(library);
    return 1;
  }

  CUdevice device = 0;
  CUcontext context = nullptr;
  CUmodule module = nullptr;
  int status = 0;
  if (cuInit(0) != CUDA_SUCCESS ||
      cuDeviceGet(&device, 0) != CUDA_SUCCESS ||
      cuCtxCreate(&context, 0, device) != CUDA_SUCCESS) {
    std::cerr << "CUDA could not create the test context\n";
    status = 1;
  }

  int driverVersion = 0;
  int computeMajor = 0;
  int computeMinor = 0;
  std::array<char, 256> deviceName{};
  if (context &&
      (cuDriverGetVersion(&driverVersion) != CUDA_SUCCESS ||
       cuDeviceComputeCapability(
         &computeMajor,
         &computeMinor,
         device
       ) != CUDA_SUCCESS ||
       cuDeviceGetName(
         deviceName.data(),
         static_cast<int>(deviceName.size()),
         device
       ) != CUDA_SUCCESS)) {
    std::cerr << "CUDA device compatibility queries failed\n";
    status = 1;
  }
  if (context &&
      !momentum::bitmap::cuda::detail::IsComputeCapabilitySupported(
        computeMajor,
        computeMinor
      )) {
    std::cerr
      << "CUDA device is below the Momentum PTX baseline: "
      << computeMajor << '.' << computeMinor << '\n';
    status = 1;
  }

  if (context) {
    CUcontext poppedContext = nullptr;
    if (contextApi.ctxPopCurrent(&poppedContext) != CUDA_SUCCESS ||
        poppedContext != context) {
      std::cerr << "CUDA test could not clear its initially current context\n";
      status = 1;
    }
  }

  if (context) {
    momentum::bitmap::cuda::detail::ContextScope<ContextApi, CUcontext> scope(
      contextApi,
      context
    );
    if (!scope.active() ||
        cuModuleLoadDataEx(
          &module,
          momentum::bitmap::cuda::KernelPtx(),
          0,
          nullptr,
          nullptr
        ) != CUDA_SUCCESS) {
      std::cerr << "CUDA could not bind the AE-style context and JIT Momentum PTX\n";
      status = 1;
    }

    const std::array<const char*, 9> names = {
      "momentum_clear", "momentum_copy", "momentum_fill",
      "momentum_path_fill", "momentum_image", "momentum_composite",
      "momentum_filter", "momentum_mask", "momentum_copy_output"
    };
    if (module) {
      for (const char* name : names) {
        CUfunction function = nullptr;
        if (cuModuleGetFunction(&function, module, name) != CUDA_SUCCESS || !function) {
          std::cerr << "Missing CUDA kernel: " << name << '\n';
          status = 1;
        }
      }
      (void)cuModuleUnload(module);
      module = nullptr;
    }
  }

  CUcontext finalCurrent = nullptr;
  if (context &&
      (contextApi.ctxGetCurrent(&finalCurrent) != CUDA_SUCCESS || finalCurrent)) {
    std::cerr << "CUDA context scope did not restore the previous thread state\n";
    status = 1;
  }
  if (context) {
    (void)cuCtxDestroy(context);
  }
  if (status == 0) {
    std::cout
      << deviceName.data()
      << " compute=" << computeMajor << '.' << computeMinor
      << " driver=" << driverVersion
      << " ptx=" << momentum::bitmap::cuda::detail::kPtxArchitecture
      << '\n';
  }
  FreeLibrary(library);
  return status;
}
