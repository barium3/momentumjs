# Momentum native plugin architecture

The native plugin is organized by responsibility, not by file type. The layout
follows the same practical idea used by openFrameworks-style C++ modules:
public concepts have direct names, implementation and header files stay
together, and platform backends sit behind a common interface.

Reference points:

- [openFrameworks `ofMain.h`](https://github.com/openframeworks/openFrameworks/blob/master/libs/openFrameworks/ofMain.h)
  exposes concepts in functional groups such as types, graphics, app, audio,
  and video.
- [JUCE modules](https://github.com/juce-framework/JUCE/tree/master/modules)
  package cohesive subsystems rather than collecting all native code in one
  generic source directory.

Momentum follows those responsibility and platform-boundary ideas, but does
not copy the broad `ofMain.h` convenience-header pattern internally. Plugin
translation units use narrow headers so dependencies remain visible.

## Directory map

```text
plugin/
├── controllers/            Controller values, schemas, defaults, validation
├── host/                   Adobe After Effects integration boundary
│   ├── code/               Code snapshot and cue-timeline integration
│   ├── effect/             Effect command orchestration
│   │   ├── code_editor.*   Editor sessions, commits, and reconciliation
│   │   ├── events.*        Controller drawing, hit testing, and drag behavior
│   │   ├── parameters.*    Parameter definitions, mapping, and synchronization
│   │   ├── render.*        Render invocation, invalidation, CPU, and GPU flow
│   │   └── sequence.*      Sequence setup, reset, flatten, and setdown
│   ├── resources/          PiPL and bundle metadata
│   ├── ae_sdk.h            Canonical AE SDK include boundary
│   ├── entry.cpp           Exported entry points, selector routing, diagnostics
│   ├── parameter_layout.h  Stable AE parameter indices and disk ids
│   └── sequence_data.*     Live Effect identity and flattening
├── scene/                  Scene, path, style, image, and surface value types
├── scripting/
│   ├── api/                JavaScript callbacks and embedded bootstrap scripts
│   │   └── callbacks/      Callback declarations grouped by API domain
│   └── runtime/            JavaScript execution, documents, and frame history
└── rendering/
    ├── bitmap/
    │   ├── planning/       Backend-neutral draw and frame plans
    │   ├── resources/      Shared immutable bitmap/text resources
    │   └── backends/       CPU, GPU dispatch, and Metal implementation
    └── software/           Backend-neutral software rasterization primitives
```

## Dependency direction

```text
controllers ─┐
scene ───────┼──> scripting ───┐
scene ──────────> rendering ───┼──> host
controllers ───────────────────┘
```

- `scene` and `controllers` contain value types and domain rules.
- `rendering` consumes scenes; it must not know about AE selectors or editor
  transport.
- `scripting` builds scenes and owns JavaScript execution history.
- `host` is the composition root. It may call the other domains and translates
  AE callbacks into domain operations.
- Metal-specific Objective-C++ stays in `backends/metal`; callers use the GPU
  backend interface.

## Naming and include rules

- File names describe the concept: `sequence_data`, `render`,
  `frame_cache`, `planner`, `renderer`.
- Avoid historical prefixes such as `momentum_`, `runtime_`, `api_`, and
  `render_` when the directory already supplies that context.
- Public operations use short verb names inside a descriptive namespace:
  `bitmap::planning::Build`, `bitmap::cpu::Render`, `bitmap::gpu::Render`.
- Include paths start at `src/plugin`, for example
  `#include "rendering/software/rasterizer.h"`. Do not use parent-relative
  includes.
- Headers include the narrow domain header they need. There is no global
  all-types header.
- New AE selector handling belongs in `host/effect`; `entry.cpp` must remain a
  thin routing layer and must not implement controller, editor, or render work.
- Mutable process state belongs to the domain that consumes it. For example,
  render generations stay private to `render`, and editor queues stay private
  to `code_editor`; command handlers do not expose mutexes or containers.
- Each AE selector call chain belongs wholly to one of the five effect domains.
  Do not create new `*_state`, `*_math`, or `*_utils` translation units for
  helpers that have only one domain owner.
- Embedded JavaScript belongs in `bootstrap_scripts.cpp`; native callback
  registration belongs in `bootstrap.cpp`.

## Ownership notes

- `host/sequence_data` owns live Effect identity only. Code documents remain in
  AE parameter streams.
- `scripting/runtime/frame_cache` owns JavaScript frame snapshots.
- `rendering/bitmap/resources` owns renderer-facing immutable resources.
- CPU and Metal execute the same backend-neutral `BitmapFramePlan`.
