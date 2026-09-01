#include "rendering/bitmap/backends/opencl/kernels.h"

#include <Windows.h>

#include <array>
#include <cstring>
#include <cstdint>
#include <iostream>
#include <vector>

namespace {

using cl_int = int;
using cl_uint = unsigned int;
using cl_ulong = unsigned long long;
using cl_device_type = cl_ulong;
using cl_platform_id = struct _cl_platform_id*;
using cl_device_id = struct _cl_device_id*;
using cl_context = struct _cl_context*;
using cl_program = struct _cl_program*;
using cl_kernel = struct _cl_kernel*;
using cl_context_properties = std::intptr_t;

constexpr cl_int CL_SUCCESS = 0;
constexpr cl_device_type CL_DEVICE_TYPE_GPU = 1ULL << 2;
constexpr cl_uint CL_PROGRAM_BUILD_LOG = 0x1183;

template <typename T>
bool Load(HMODULE library, const char* name, T* output) {
  *output = reinterpret_cast<T>(GetProcAddress(library, name));
  return *output != nullptr;
}

}  // namespace

int main() {
  HMODULE library = LoadLibraryW(L"OpenCL.dll");
  if (!library) {
    std::cerr << "OpenCL.dll is unavailable\n";
    return 1;
  }

  cl_int (WINAPI* clGetPlatformIDs)(cl_uint, cl_platform_id*, cl_uint*) = nullptr;
  cl_int (WINAPI* clGetDeviceIDs)(cl_platform_id, cl_device_type, cl_uint, cl_device_id*, cl_uint*) = nullptr;
  cl_context (WINAPI* clCreateContext)(
    const cl_context_properties*, cl_uint, const cl_device_id*,
    void (WINAPI*)(const char*, const void*, std::size_t, void*), void*, cl_int*
  ) = nullptr;
  cl_int (WINAPI* clReleaseContext)(cl_context) = nullptr;
  cl_program (WINAPI* clCreateProgramWithSource)(
    cl_context, cl_uint, const char**, const std::size_t*, cl_int*
  ) = nullptr;
  cl_int (WINAPI* clBuildProgram)(
    cl_program, cl_uint, const cl_device_id*, const char*,
    void (WINAPI*)(cl_program, void*), void*
  ) = nullptr;
  cl_int (WINAPI* clGetProgramBuildInfo)(
    cl_program, cl_device_id, cl_uint, std::size_t, void*, std::size_t*
  ) = nullptr;
  cl_kernel (WINAPI* clCreateKernel)(cl_program, const char*, cl_int*) = nullptr;
  cl_int (WINAPI* clReleaseKernel)(cl_kernel) = nullptr;
  cl_int (WINAPI* clReleaseProgram)(cl_program) = nullptr;
  if (!Load(library, "clGetPlatformIDs", &clGetPlatformIDs) ||
      !Load(library, "clGetDeviceIDs", &clGetDeviceIDs) ||
      !Load(library, "clCreateContext", &clCreateContext) ||
      !Load(library, "clReleaseContext", &clReleaseContext) ||
      !Load(library, "clCreateProgramWithSource", &clCreateProgramWithSource) ||
      !Load(library, "clBuildProgram", &clBuildProgram) ||
      !Load(library, "clGetProgramBuildInfo", &clGetProgramBuildInfo) ||
      !Load(library, "clCreateKernel", &clCreateKernel) ||
      !Load(library, "clReleaseKernel", &clReleaseKernel) ||
      !Load(library, "clReleaseProgram", &clReleaseProgram)) {
    std::cerr << "OpenCL entry points are incomplete\n";
    FreeLibrary(library);
    return 1;
  }

  cl_platform_id platform = nullptr;
  cl_device_id device = nullptr;
  cl_uint count = 0;
  cl_int result = clGetPlatformIDs(1, &platform, &count);
  if (result != CL_SUCCESS || count == 0 || !platform ||
      clGetDeviceIDs(platform, CL_DEVICE_TYPE_GPU, 1, &device, &count) != CL_SUCCESS ||
      count == 0 || !device) {
    std::cerr << "No OpenCL GPU device is available\n";
    FreeLibrary(library);
    return 1;
  }

  cl_context context = clCreateContext(nullptr, 1, &device, nullptr, nullptr, &result);
  if (result != CL_SUCCESS || !context) {
    std::cerr << "OpenCL context creation failed: " << result << '\n';
    FreeLibrary(library);
    return 1;
  }
  const char* source = momentum::bitmap::opencl::KernelSource();
  const std::size_t sourceLength = std::strlen(source);
  cl_program program = clCreateProgramWithSource(
    context, 1, &source, &sourceLength, &result
  );
  if (result == CL_SUCCESS && program) {
    result = clBuildProgram(
      program, 1, &device,
      "-cl-std=CL1.2 -cl-single-precision-constant -cl-fast-relaxed-math",
      nullptr, nullptr
    );
  }
  if (result != CL_SUCCESS || !program) {
    std::size_t logLength = 0;
    if (program) {
      (void)clGetProgramBuildInfo(
        program, device, CL_PROGRAM_BUILD_LOG, 0, nullptr, &logLength
      );
    }
    std::vector<char> log(logLength + 1, '\0');
    if (program && logLength > 0) {
      (void)clGetProgramBuildInfo(
        program, device, CL_PROGRAM_BUILD_LOG, logLength, log.data(), nullptr
      );
    }
    std::cerr << "OpenCL kernel compilation failed: " << result << '\n'
              << log.data() << '\n';
    if (program) {
      (void)clReleaseProgram(program);
    }
    (void)clReleaseContext(context);
    FreeLibrary(library);
    return 1;
  }

  int status = 0;
  const std::array<const char*, 9> names = {
    "momentum_clear", "momentum_copy", "momentum_fill",
    "momentum_path_fill", "momentum_image", "momentum_composite",
    "momentum_filter", "momentum_mask", "momentum_copy_output"
  };
  for (const char* name : names) {
    cl_kernel kernel = clCreateKernel(program, name, &result);
    if (result != CL_SUCCESS || !kernel) {
      std::cerr << "Missing OpenCL kernel: " << name << " (" << result << ")\n";
      status = 1;
    }
    if (kernel) {
      (void)clReleaseKernel(kernel);
    }
  }
  (void)clReleaseProgram(program);
  (void)clReleaseContext(context);
  FreeLibrary(library);
  return status;
}
