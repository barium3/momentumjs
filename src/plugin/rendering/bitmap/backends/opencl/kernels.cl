#define MOMENTUM_KERNEL(name) __kernel void name
#define MOMENTUM_GLOBAL __global
#define MOMENTUM_INLINE inline
#define MOMENTUM_X ((unsigned int)get_global_id(0))
#define MOMENTUM_Y ((unsigned int)get_global_id(1))
#define MOMENTUM_SQRT sqrt
#define MOMENTUM_ABS fabs
#define MOMENTUM_ABS_INT abs
#define MOMENTUM_ROUND round
#define MOMENTUM_FLOOR floor

// The build embeds this preamble followed by compute/kernels_common.inc.
