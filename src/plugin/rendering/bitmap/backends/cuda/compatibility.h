#pragma once

#ifndef MOMENTUM_CUDA_MIN_COMPUTE_CAPABILITY
#define MOMENTUM_CUDA_MIN_COMPUTE_CAPABILITY 52
#endif

#ifndef MOMENTUM_CUDA_PTX_ARCHITECTURE
#define MOMENTUM_CUDA_PTX_ARCHITECTURE "compute_52"
#endif

namespace momentum {
namespace bitmap {
namespace cuda {
namespace detail {

constexpr int kMinimumComputeCapability =
  MOMENTUM_CUDA_MIN_COMPUTE_CAPABILITY;
constexpr const char* kPtxArchitecture = MOMENTUM_CUDA_PTX_ARCHITECTURE;

constexpr int ComputeCapabilityCode(int major, int minor) {
  return (major * 10) + minor;
}

constexpr bool IsComputeCapabilitySupported(int major, int minor) {
  return ComputeCapabilityCode(major, minor) >= kMinimumComputeCapability;
}

}  // namespace detail
}  // namespace cuda
}  // namespace bitmap
}  // namespace momentum
