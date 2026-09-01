#define MOMENTUM_KERNEL(name) extern "C" __global__ void name
#define MOMENTUM_GLOBAL
#define MOMENTUM_INLINE __device__ __forceinline__
#define MOMENTUM_X ((unsigned int)(blockIdx.x * blockDim.x + threadIdx.x))
#define MOMENTUM_Y ((unsigned int)(blockIdx.y * blockDim.y + threadIdx.y))
#define MOMENTUM_SQRT sqrtf
#define MOMENTUM_ABS fabsf
#define MOMENTUM_ABS_INT(value) ((value) < 0 ? -(value) : (value))
#define MOMENTUM_ROUND roundf
#define MOMENTUM_FLOOR floorf

#include "../compute/kernels_common.inc"
