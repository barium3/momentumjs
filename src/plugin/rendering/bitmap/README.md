# Bitmap native pipeline

The bitmap implementation is organized by responsibility:

- `planning/` owns frame and draw-plan types, scene planning, path flattening,
  triangulation, and stroke geometry.
- `resources/` owns per-effect bitmap resources such as text atlases, transient
  image identifiers, and their cache lifetime.
- `backends/cpu/` executes a frame plan with the shared software rasterizer.
- `backends/gpu/` adapts After Effects GPU contexts to a platform backend.
- `backends/metal/` owns Metal-only state, command encoding, texture caches,
  and shader source.

Dependencies flow from renderers toward plans and shared render primitives.
Planning never depends on a GPU backend, and platform code is not exposed to
scripting runtime or host entry headers.
