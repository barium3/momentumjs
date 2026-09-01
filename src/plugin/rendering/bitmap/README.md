# Bitmap native pipeline

The bitmap implementation is organized by responsibility:

- `planning/` owns frame and draw-plan types, scene planning, path flattening,
  triangulation, and stroke geometry.
- `resources/` owns per-effect bitmap resources such as text atlases, transient
  image identifiers, and their cache lifetime.
- `backends/cpu/` executes a frame plan with the shared software rasterizer.
- `backends/gpu/` owns After Effects framework selection and context lifetime.
- `backends/compute/` owns the vendor-neutral Windows command executor,
  geometry ABI, and the CUDA/OpenCL kernel algorithm source.
- `backends/cuda/` owns dynamic CUDA Driver API loading, embedded PTX, and
  kernel dispatch. The CUDA toolkit is a build-time dependency only.
- `backends/opencl/` owns dynamic OpenCL loading, program compilation inside
  AE's supplied context, and kernel dispatch.
- `backends/metal/` owns Metal-only state, command encoding, texture caches,
  and shader source.

Dependencies flow from renderers toward plans and shared render primitives.
Planning never depends on a GPU backend, and platform code is not exposed to
scripting runtime or host entry headers.

Windows ships one `.aex`. AE selects the active framework: CUDA is accepted on
NVIDIA devices and OpenCL is accepted when AE exposes an OpenCL device (for
example AMD or Intel). Both use AE's GPU memory suite and fall back to the CPU
renderer when device setup is unavailable. The first Windows implementation
replays each correctness-complete frame plan instead of retaining cross-frame
vendor memory; backend caches can be added later without changing the plan or
kernel contracts.

## CUDA compatibility contract

- Momentum borrows AE's `CUcontext` and `CUstream`; it never creates, destroys,
  or globally selects a CUDA context owned by the host.
- Setup, render, and setdown use a balanced per-thread context scope. A module
  is loaded once for one AE context and is never reused with a different
  context or device.
- The embedded PTX targets `compute_52`, and setup rejects older devices before
  loading it. Driver version, device name, compute capability, and PTX target
  are included in the one-time GPU setup diagnostic.
- The CUDA toolkit is required only on the build machine. End-user systems load
  the CUDA Driver API from the installed NVIDIA display driver.
- A CUDA setup failure stays inside AE's normal GPU-to-CPU fallback. Momentum
  does not run OpenCL against CUDA-owned worlds; OpenCL is used only when AE
  selects the OpenCL framework.
