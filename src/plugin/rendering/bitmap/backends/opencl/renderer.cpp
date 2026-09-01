#include "rendering/bitmap/backends/opencl/renderer.h"

#include "rendering/bitmap/backends/compute/device.h"
#include "rendering/bitmap/backends/compute/executor.h"
#include "rendering/bitmap/backends/opencl/kernels.h"

#include <Windows.h>

#include <algorithm>
#include <cstdint>
#include <new>
#include <sstream>
#include <string>
#include <vector>

namespace momentum {
namespace bitmap {
namespace opencl {
namespace {

using cl_char = signed char;
using cl_int = int;
using cl_uint = unsigned int;
using cl_bool = cl_uint;
using cl_device_id = struct _cl_device_id*;
using cl_context = struct _cl_context*;
using cl_command_queue = struct _cl_command_queue*;
using cl_mem = struct _cl_mem*;
using cl_program = struct _cl_program*;
using cl_kernel = struct _cl_kernel*;
using cl_event = struct _cl_event*;

constexpr cl_int CL_SUCCESS = 0;
constexpr cl_bool CL_TRUE = 1;
constexpr cl_uint CL_PROGRAM_BUILD_LOG = 0x1183;

struct OpenClApi {
  HMODULE library = NULL;
  cl_program (WINAPI* createProgramWithSource)(
    cl_context, cl_uint, const char**, const std::size_t*, cl_int*
  ) = nullptr;
  cl_int (WINAPI* buildProgram)(
    cl_program,
    cl_uint,
    const cl_device_id*,
    const char*,
    void (WINAPI*)(cl_program, void*),
    void*
  ) = nullptr;
  cl_int (WINAPI* getProgramBuildInfo)(
    cl_program, cl_device_id, cl_uint, std::size_t, void*, std::size_t*
  ) = nullptr;
  cl_kernel (WINAPI* createKernel)(cl_program, const char*, cl_int*) = nullptr;
  cl_int (WINAPI* releaseKernel)(cl_kernel) = nullptr;
  cl_int (WINAPI* releaseProgram)(cl_program) = nullptr;
  cl_int (WINAPI* setKernelArg)(cl_kernel, cl_uint, std::size_t, const void*) = nullptr;
  cl_int (WINAPI* enqueueNDRangeKernel)(
    cl_command_queue,
    cl_kernel,
    cl_uint,
    const std::size_t*,
    const std::size_t*,
    const std::size_t*,
    cl_uint,
    const cl_event*,
    cl_event*
  ) = nullptr;
  cl_int (WINAPI* enqueueWriteBuffer)(
    cl_command_queue,
    cl_mem,
    cl_bool,
    std::size_t,
    std::size_t,
    const void*,
    cl_uint,
    const cl_event*,
    cl_event*
  ) = nullptr;
  cl_int (WINAPI* finish)(cl_command_queue) = nullptr;
};

struct Context {
  OpenClApi api;
  cl_device_id device = nullptr;
  cl_context clContext = nullptr;
  cl_kernel clear = nullptr;
  cl_kernel copy = nullptr;
  cl_kernel fill = nullptr;
  cl_kernel pathFill = nullptr;
  cl_kernel image = nullptr;
  cl_kernel composite = nullptr;
  cl_kernel filter = nullptr;
  cl_kernel mask = nullptr;
  cl_kernel copyOutput = nullptr;
};

template <typename T>
bool LoadSymbol(HMODULE library, const char* name, T* output) {
  if (!library || !name || !output) {
    return false;
  }
  *output = reinterpret_cast<T>(GetProcAddress(library, name));
  return *output != nullptr;
}

bool LoadApi(OpenClApi* api, std::string* errorMessage) {
  if (!api) {
    return false;
  }
  api->library = LoadLibraryW(L"OpenCL.dll");
  if (!api->library) {
    if (errorMessage) {
      *errorMessage = "OpenCL.dll is unavailable; the display driver may not expose OpenCL.";
    }
    return false;
  }
  const bool loaded =
    LoadSymbol(api->library, "clCreateProgramWithSource", &api->createProgramWithSource) &&
    LoadSymbol(api->library, "clBuildProgram", &api->buildProgram) &&
    LoadSymbol(api->library, "clGetProgramBuildInfo", &api->getProgramBuildInfo) &&
    LoadSymbol(api->library, "clCreateKernel", &api->createKernel) &&
    LoadSymbol(api->library, "clReleaseKernel", &api->releaseKernel) &&
    LoadSymbol(api->library, "clReleaseProgram", &api->releaseProgram) &&
    LoadSymbol(api->library, "clSetKernelArg", &api->setKernelArg) &&
    LoadSymbol(api->library, "clEnqueueNDRangeKernel", &api->enqueueNDRangeKernel) &&
    LoadSymbol(api->library, "clEnqueueWriteBuffer", &api->enqueueWriteBuffer) &&
    LoadSymbol(api->library, "clFinish", &api->finish);
  if (!loaded) {
    if (errorMessage) {
      *errorMessage = "OpenCL loader is missing one or more required entry points.";
    }
    FreeLibrary(api->library);
    *api = OpenClApi{};
    return false;
  }
  return true;
}

std::string OpenClError(cl_int error, const char* operation) {
  std::ostringstream stream;
  stream << (operation ? operation : "OpenCL operation")
         << " failed with status " << error << '.';
  return stream.str();
}

void ReleaseContextResources(Context* context) {
  if (!context) {
    return;
  }
  cl_kernel kernels[] = {
    context->clear,
    context->copy,
    context->fill,
    context->pathFill,
    context->image,
    context->composite,
    context->filter,
    context->mask,
    context->copyOutput
  };
  if (context->api.releaseKernel) {
    for (cl_kernel kernel : kernels) {
      if (kernel) {
        (void)context->api.releaseKernel(kernel);
      }
    }
  }
  if (context->api.library) {
    FreeLibrary(context->api.library);
  }
}

bool CreateKernel(
  Context* context,
  cl_program program,
  const char* name,
  cl_kernel* output,
  std::string* errorMessage
) {
  cl_int result = CL_SUCCESS;
  *output = context->api.createKernel(program, name, &result);
  if (result == CL_SUCCESS && *output) {
    return true;
  }
  if (errorMessage) {
    *errorMessage = OpenClError(result, name);
  }
  return false;
}

cl_mem Memory(const compute::Buffer& buffer) {
  return reinterpret_cast<cl_mem>(buffer.memory);
}

class OpenClDevice final : public compute::Device {
 public:
  OpenClDevice(Context& context, cl_command_queue queue)
    : context_(context), queue_(queue) {}

  bool Upload(
    const compute::Buffer& destination,
    const void* source,
    std::size_t byteSize,
    std::string* errorMessage
  ) override {
    if (!destination.memory || !source || byteSize > destination.byteSize) {
      if (errorMessage) {
        *errorMessage = "OpenCL upload request is invalid.";
      }
      return false;
    }
    return Check(
      context_.api.enqueueWriteBuffer(
        queue_, Memory(destination), CL_TRUE, 0, byteSize, source, 0, nullptr, nullptr
      ),
      "OpenCL host-to-device upload",
      errorMessage
    );
  }

  bool Clear(
    const compute::Buffer& destination,
    std::uint32_t width,
    std::uint32_t height,
    const compute::Float4& color,
    std::string* errorMessage
  ) override {
    cl_mem destinationMemory = Memory(destination);
    return Set(context_.clear, 0, destinationMemory, errorMessage) &&
      Set(context_.clear, 1, width, errorMessage) &&
      Set(context_.clear, 2, height, errorMessage) &&
      Set(context_.clear, 3, color, errorMessage) &&
      Launch(context_.clear, width, height, "OpenCL clear kernel", errorMessage);
  }

  bool Copy(
    const compute::Buffer& source,
    const compute::Buffer& destination,
    std::uint32_t width,
    std::uint32_t height,
    std::string* errorMessage
  ) override {
    cl_mem sourceMemory = Memory(source);
    cl_mem destinationMemory = Memory(destination);
    return Set(context_.copy, 0, sourceMemory, errorMessage) &&
      Set(context_.copy, 1, destinationMemory, errorMessage) &&
      Set(context_.copy, 2, width, errorMessage) &&
      Set(context_.copy, 3, height, errorMessage) &&
      Launch(context_.copy, width, height, "OpenCL copy kernel", errorMessage);
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
    cl_mem memory[] = {
      Memory(destination), Memory(triangles), Memory(edges),
      Memory(clipVertices), Memory(clipContours), Memory(clipImage)
    };
    return Set(context_.fill, 0, memory[0], errorMessage) &&
      Set(context_.fill, 1, memory[1], errorMessage) &&
      Set(context_.fill, 2, memory[2], errorMessage) &&
      Set(context_.fill, 3, memory[3], errorMessage) &&
      Set(context_.fill, 4, memory[4], errorMessage) &&
      Set(context_.fill, 5, memory[5], errorMessage) &&
      Set(context_.fill, 6, params, errorMessage) &&
      Launch(
        context_.fill,
        params.regionWidth,
        params.regionHeight,
        "OpenCL fill kernel",
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
    cl_mem memory[] = {
      Memory(destination), Memory(vertices), Memory(contours), Memory(clipImage)
    };
    return Set(context_.pathFill, 0, memory[0], errorMessage) &&
      Set(context_.pathFill, 1, memory[1], errorMessage) &&
      Set(context_.pathFill, 2, memory[2], errorMessage) &&
      Set(context_.pathFill, 3, memory[3], errorMessage) &&
      Set(context_.pathFill, 4, params, errorMessage) &&
      Launch(
        context_.pathFill,
        params.regionWidth,
        params.regionHeight,
        "OpenCL path-fill kernel",
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
    cl_mem memory[] = {Memory(destination), Memory(image), Memory(clipImage)};
    return Set(context_.image, 0, memory[0], errorMessage) &&
      Set(context_.image, 1, memory[1], errorMessage) &&
      Set(context_.image, 2, memory[2], errorMessage) &&
      Set(context_.image, 3, params, errorMessage) &&
      Launch(
        context_.image,
        params.regionWidth,
        params.regionHeight,
        "OpenCL image kernel",
        errorMessage
      );
  }

  bool Composite(
    const compute::Buffer& source,
    const compute::Buffer& destination,
    const compute::BlendParams& params,
    std::string* errorMessage
  ) override {
    cl_mem sourceMemory = Memory(source);
    cl_mem destinationMemory = Memory(destination);
    return Set(context_.composite, 0, sourceMemory, errorMessage) &&
      Set(context_.composite, 1, destinationMemory, errorMessage) &&
      Set(context_.composite, 2, params, errorMessage) &&
      Launch(
        context_.composite,
        params.width,
        params.height,
        "OpenCL composite kernel",
        errorMessage
      );
  }

  bool Filter(
    const compute::Buffer& source,
    const compute::Buffer& destination,
    const compute::FilterParams& params,
    std::string* errorMessage
  ) override {
    cl_mem sourceMemory = Memory(source);
    cl_mem destinationMemory = Memory(destination);
    return Set(context_.filter, 0, sourceMemory, errorMessage) &&
      Set(context_.filter, 1, destinationMemory, errorMessage) &&
      Set(context_.filter, 2, params, errorMessage) &&
      Launch(
        context_.filter,
        params.width,
        params.height,
        "OpenCL filter kernel",
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
    cl_mem memory[] = {Memory(source), Memory(mask), Memory(destination)};
    return Set(context_.mask, 0, memory[0], errorMessage) &&
      Set(context_.mask, 1, memory[1], errorMessage) &&
      Set(context_.mask, 2, memory[2], errorMessage) &&
      Set(context_.mask, 3, width, errorMessage) &&
      Set(context_.mask, 4, height, errorMessage) &&
      Set(context_.mask, 5, maskWidth, errorMessage) &&
      Set(context_.mask, 6, maskHeight, errorMessage) &&
      Launch(context_.mask, width, height, "OpenCL mask kernel", errorMessage);
  }

  bool CopyToOutput(
    const compute::Buffer& source,
    void* outputMemory,
    const compute::CopyOutputParams& params,
    std::string* errorMessage
  ) override {
    cl_mem sourceMemory = Memory(source);
    cl_mem destinationMemory = reinterpret_cast<cl_mem>(outputMemory);
    return Set(context_.copyOutput, 0, sourceMemory, errorMessage) &&
      Set(context_.copyOutput, 1, destinationMemory, errorMessage) &&
      Set(context_.copyOutput, 2, params, errorMessage) &&
      Launch(
        context_.copyOutput,
        params.width,
        params.height,
        "OpenCL output kernel",
        errorMessage
      );
  }

  bool Finish(std::string* errorMessage) override {
    return Check(context_.api.finish(queue_), "OpenCL queue synchronization", errorMessage);
  }

 private:
  bool Check(cl_int result, const char* operation, std::string* errorMessage) const {
    if (result == CL_SUCCESS) {
      return true;
    }
    if (errorMessage) {
      *errorMessage = OpenClError(result, operation);
    }
    return false;
  }

  template <typename T>
  bool Set(
    cl_kernel kernel,
    cl_uint index,
    const T& value,
    std::string* errorMessage
  ) const {
    return Check(
      context_.api.setKernelArg(kernel, index, sizeof(T), &value),
      "OpenCL kernel argument",
      errorMessage
    );
  }

  bool Launch(
    cl_kernel kernel,
    std::uint32_t width,
    std::uint32_t height,
    const char* operation,
    std::string* errorMessage
  ) const {
    if (!kernel || width == 0 || height == 0) {
      if (width == 0 || height == 0) {
        return true;
      }
      if (errorMessage) {
        *errorMessage = std::string(operation) + " is unavailable.";
      }
      return false;
    }
    constexpr std::size_t localWidth = 8;
    constexpr std::size_t localHeight = 8;
    const std::size_t local[] = {localWidth, localHeight};
    const std::size_t global[] = {
      ((static_cast<std::size_t>(width) + localWidth - 1) / localWidth) * localWidth,
      ((static_cast<std::size_t>(height) + localHeight - 1) / localHeight) * localHeight
    };
    return Check(
      context_.api.enqueueNDRangeKernel(
        queue_, kernel, 2, nullptr, global, local, 0, nullptr, nullptr
      ),
      operation,
      errorMessage
    );
  }

  Context& context_;
  cl_command_queue queue_ = nullptr;
};

}  // namespace

PF_Err CreateContext(
  const PF_GPUDeviceInfo& deviceInfo,
  void** output,
  std::string* errorMessage
) {
  if (!output || !deviceInfo.devicePV || !deviceInfo.contextPV) {
    if (errorMessage) {
      *errorMessage = "AE did not provide a valid OpenCL device/context.";
    }
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  *output = nullptr;
  auto* context = new (std::nothrow) Context();
  if (!context) {
    if (errorMessage) {
      *errorMessage = "Failed to allocate the OpenCL Bitmap context.";
    }
    return PF_Err_OUT_OF_MEMORY;
  }
  context->device = reinterpret_cast<cl_device_id>(deviceInfo.devicePV);
  context->clContext = reinterpret_cast<cl_context>(deviceInfo.contextPV);
  if (!LoadApi(&context->api, errorMessage)) {
    delete context;
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  const char* source = KernelSource();
  const std::size_t sourceLength = source ? std::char_traits<char>::length(source) : 0;
  cl_int result = CL_SUCCESS;
  cl_program program = context->api.createProgramWithSource(
    context->clContext, 1, &source, &sourceLength, &result
  );
  if (result != CL_SUCCESS || !program) {
    if (errorMessage) {
      *errorMessage = OpenClError(result, "OpenCL program creation");
    }
    ReleaseContextResources(context);
    delete context;
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  result = context->api.buildProgram(
    program,
    1,
    &context->device,
    "-cl-std=CL1.2 -cl-single-precision-constant -cl-fast-relaxed-math",
    nullptr,
    nullptr
  );
  if (result != CL_SUCCESS) {
    std::size_t logLength = 0;
    (void)context->api.getProgramBuildInfo(
      program, context->device, CL_PROGRAM_BUILD_LOG, 0, nullptr, &logLength
    );
    std::vector<char> log(logLength + 1, '\0');
    if (logLength > 0) {
      (void)context->api.getProgramBuildInfo(
        program, context->device, CL_PROGRAM_BUILD_LOG, logLength, log.data(), nullptr
      );
    }
    if (errorMessage) {
      *errorMessage = OpenClError(result, "OpenCL kernel build");
      if (!log.empty() && log[0] != '\0') {
        *errorMessage += "\n";
        *errorMessage += log.data();
      }
    }
    (void)context->api.releaseProgram(program);
    ReleaseContextResources(context);
    delete context;
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  const bool kernelsLoaded =
    CreateKernel(context, program, "momentum_clear", &context->clear, errorMessage) &&
    CreateKernel(context, program, "momentum_copy", &context->copy, errorMessage) &&
    CreateKernel(context, program, "momentum_fill", &context->fill, errorMessage) &&
    CreateKernel(context, program, "momentum_path_fill", &context->pathFill, errorMessage) &&
    CreateKernel(context, program, "momentum_image", &context->image, errorMessage) &&
    CreateKernel(context, program, "momentum_composite", &context->composite, errorMessage) &&
    CreateKernel(context, program, "momentum_filter", &context->filter, errorMessage) &&
    CreateKernel(context, program, "momentum_mask", &context->mask, errorMessage) &&
    CreateKernel(context, program, "momentum_copy_output", &context->copyOutput, errorMessage);
  (void)context->api.releaseProgram(program);
  if (!kernelsLoaded) {
    ReleaseContextResources(context);
    delete context;
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  *output = context;
  return PF_Err_NONE;
}

void DestroyContext(void* opaque) {
  auto* context = static_cast<Context*>(opaque);
  if (!context) {
    return;
  }
  ReleaseContextResources(context);
  delete context;
}

PF_Err Render(
  void* opaque,
  const gpu::Target& target,
  const BitmapFramePlan& plan,
  std::string* errorMessage
) {
  auto* context = static_cast<Context*>(opaque);
  auto* queue = reinterpret_cast<cl_command_queue>(
    target.deviceInfo.command_queuePV
  );
  if (!context || !queue) {
    if (errorMessage) {
      *errorMessage = "OpenCL Bitmap context/queue is unavailable.";
    }
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  OpenClDevice device(*context, queue);
  return compute::Execute(device, target, plan, errorMessage);
}

}  // namespace opencl
}  // namespace bitmap
}  // namespace momentum
