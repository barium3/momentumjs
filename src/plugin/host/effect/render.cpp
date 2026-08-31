#include "host/effect/render.h"

#include "host/code/snapshot.h"
#include "host/code/timeline.h"
#include "host/effect/code_editor.h"
#include "host/effect_contract.h"
#include "host/parameter_layout.h"
#include "rendering/bitmap/planning/planner.h"
#include "rendering/bitmap/backends/cpu/renderer.h"
#include "rendering/bitmap/backends/gpu/renderer.h"
#include "rendering/software/rasterizer.h"
#include "scripting/runtime/core.h"
#include "scripting/runtime/internal.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <functional>
#include <iomanip>
#include <mutex>
#include <new>
#include <sstream>
#include <unordered_map>

namespace momentum {

namespace {

struct RenderInvocationInfo {
  // PreRender owns immutable inputs. Mutable evaluator/canvas state lives in
  // the persistent frame lane selected by the live Sequence session.
  std::uintptr_t runtimeKey = 0;
  std::uint64_t lineageIdentity = 0;
  std::uint64_t documentCacheIdentity = 0;
  std::uintptr_t preparationCacheKey = 0;
  std::uintptr_t renderCacheKey = 0;
  RuntimeSketchBundle document;
  std::string codeSelectionMode;
  PF_KeyIndex codeKeyframeCount = 0;
  PF_KeyIndex restartKeyframeCount = 0;
  long controllerTimelineTargetFrame = -1;
  std::string controllerTimelineHash;
  std::uint64_t controllerRequestGeneration = 0;
  std::uint64_t controllerInteractionGeneration = 0;
  double documentPrepareMs = 0.0;
  double controllerTimelineMs = 0.0;
  double dependencyMixMs = 0.0;
  double preRenderTotalMs = 0.0;
  A_long canvasLeft = 0;
  A_long canvasTop = 0;
  A_long canvasWidth = 0;
  A_long canvasHeight = 0;
  double downsampleScaleX = 1.0;
  double downsampleScaleY = 1.0;
  A_long renderCanvasWidth = 0;
  A_long renderCanvasHeight = 0;
  A_long tileLeft = 0;
  A_long tileTop = 0;
  A_long tileRight = 0;
  A_long tileBottom = 0;
};

struct OutputCopyOriginInfo {
  double sourceOriginX = 0.0;
  double sourceOriginY = 0.0;
  double sourceStepX = 1.0;
  double sourceStepY = 1.0;
  bool outputLooksLikeTile = false;
  const char* mode = "zero";
};

double ElapsedMilliseconds(std::chrono::steady_clock::time_point start);
std::uintptr_t NextRenderInvocationRuntimeKey();

class ScopedRenderRuntime final {
 public:
  ScopedRenderRuntime();
  ~ScopedRenderRuntime();

  std::uintptr_t key() const;

 private:
  std::uintptr_t key_ = 0;
};

void DisposeRenderInvocationInfo(void* preRenderData);
PF_LRect IntersectRects(const PF_LRect& left, const PF_LRect& right);
double DownsampleScale(const PF_RationalScale& scale);
A_long ScaleDimension(A_long logicalSize, double scale);
PF_LayerDef MakeSceneSurface(
  const PF_LayerDef& outputWorld,
  const RenderInvocationInfo& invocation
);
OutputCopyOriginInfo ResolveOutputCopyOrigin(
  const PF_LayerDef& outputWorld,
  const RenderInvocationInfo& invocation
);
std::uint64_t ReadControllerInteractionGeneration(
  std::uint64_t liveEffectSessionId
);
std::uint64_t RegisterControllerRenderRequest(
  std::uint64_t lineageIdentity,
  long targetFrame,
  const std::string& controllerHash
);
bool IsCurrentControllerRenderRequest(
  const RenderInvocationInfo& invocation
);
bool IsLatestControllerInteraction(
  const RenderInvocationInfo& invocation
);

struct ControllerRenderRequest {
  std::string controllerHash;
  std::uint64_t generation = 0;
};

struct ControllerInteraction {
  std::uint64_t generation = 0;
};

struct RenderState {
  std::mutex requestMutex;
  std::unordered_map<std::uint64_t, ControllerRenderRequest> requests;
  std::atomic<std::uint64_t> nextRequestGeneration{1};

  std::mutex interactionMutex;
  std::unordered_map<std::uint64_t, ControllerInteraction> interactions;
  std::atomic<std::uint64_t> nextInteractionGeneration{1};
};

RenderState& State() {
  static RenderState state;
  return state;
}

std::uint64_t BuildRenderRequestKey(
  std::uint64_t lineageIdentity,
  long targetFrame
) {
  std::uint64_t hash =
    lineageIdentity ? lineageIdentity : 1469598103934665603ULL;
  const std::uint64_t frameBits = static_cast<std::uint64_t>(targetFrame);
  for (int byteIndex = 0; byteIndex < 8; ++byteIndex) {
    hash ^= static_cast<std::uint8_t>(
      (frameBits >> (byteIndex * 8)) & 0xffU
    );
    hash *= 1099511628211ULL;
  }
  return hash ? hash : 1ULL;
}

PF_Err BuildRenderInvocationInfo(
  PF_InData* input,
  RenderInvocationInfo** outputInfo
);

}  // namespace

PF_Err PreRender(
  PF_InData* input,
  PF_OutData* output,
  PF_PreRenderExtra* extra
) {
  const auto started = std::chrono::steady_clock::now();
  {
    std::ostringstream detail;
    detail
      << "extra=" << reinterpret_cast<std::uintptr_t>(extra)
      << " input="
      << reinterpret_cast<std::uintptr_t>(
        extra ? extra->input : NULL
      )
      << " output="
      << reinterpret_cast<std::uintptr_t>(
        extra ? extra->output : NULL
      )
      << " time=" << (input ? input->current_time : 0)
      << '/' << (input ? input->time_scale : 0);
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "prerender-enter",
      -1,
      static_cast<PF_ParamIndex>(-1),
      -1,
      detail.str()
    );
  }
  if (!extra || !extra->input || !extra->output) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "prerender-failed",
      -1,
      static_cast<PF_ParamIndex>(-1),
      -1,
      "invalid pre-render callback data"
    );
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  RenderInvocationInfo* info = NULL;
  PF_Err error = BuildRenderInvocationInfo(input, &info);
  if (error != PF_Err_NONE) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "prerender-failed",
      -1,
      static_cast<PF_ParamIndex>(-1),
      -1,
      "invocation err=" +
        std::to_string(static_cast<long>(error))
    );
    return error;
  }
  info->controllerInteractionGeneration =
    ReadControllerInteractionGeneration(info->lineageIdentity);

  std::string documentError;
  const auto documentStarted =
    std::chrono::steady_clock::now();
  if (!PrepareEffectRuntimeDocument(
        input,
        info->runtimeKey,
        info->preparationCacheKey,
        &info->document,
        &documentError
      )) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "prerender-document-failed",
      0,
      static_cast<PF_ParamIndex>(-1),
      -1,
      documentError
    );
    DisposeRenderInvocationInfo(info);
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  info->documentPrepareMs =
    ElapsedMilliseconds(documentStarted);

  const auto controllerStarted =
    std::chrono::steady_clock::now();
  if (!CaptureEffectControllerTimeline(
        input,
        info->runtimeKey,
        info->preparationCacheKey,
        &info->controllerTimelineTargetFrame,
        &info->controllerTimelineHash,
        &documentError
      )) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "prerender-controller-timeline-failed",
      0,
      static_cast<PF_ParamIndex>(-1),
      -1,
      documentError
    );
    DisposeRenderInvocationInfo(info);
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  info->controllerTimelineMs =
    ElapsedMilliseconds(controllerStarted);
  info->controllerRequestGeneration =
    RegisterControllerRenderRequest(
      info->documentCacheIdentity,
      info->controllerTimelineTargetFrame,
      info->controllerTimelineHash
    );

  const auto dependencyStarted =
    std::chrono::steady_clock::now();
  if (extra->cb && extra->cb->GuidMixInPtr) {
    const std::array<std::uint64_t, 2> dependencyHeader = {
      0x4d4f4d454e54554dULL,
      info->lineageIdentity,
    };
    std::ostringstream documentIdentityStream;
    documentIdentityStream
      << info->document.sourceHash << '@'
      << CodeCueTimeIdentity(info->document.codeStartTime);
    const std::string documentIdentity =
      documentIdentityStream.str();
    PF_Err guidError = extra->cb->GuidMixInPtr(
      input->effect_ref,
      static_cast<A_u_long>(sizeof(dependencyHeader)),
      dependencyHeader.data()
    );
    if (guidError == PF_Err_NONE &&
        !documentIdentity.empty()) {
      guidError = extra->cb->GuidMixInPtr(
        input->effect_ref,
        static_cast<A_u_long>(documentIdentity.size()),
        documentIdentity.data()
      );
    }
    if (guidError == PF_Err_NONE &&
        !info->controllerTimelineHash.empty()) {
      guidError = extra->cb->GuidMixInPtr(
        input->effect_ref,
        static_cast<A_u_long>(
          info->controllerTimelineHash.size()
        ),
        info->controllerTimelineHash.data()
      );
    }
    if (guidError != PF_Err_NONE) {
      runtime_internal::AppendEffectRuntimeDiagnostic(
        input,
        "prerender-guid-failed",
        0,
        static_cast<PF_ParamIndex>(-1),
        -1,
        "GuidMixInPtr err=" +
          std::to_string(static_cast<long>(guidError))
      );
      DisposeRenderInvocationInfo(info);
      return guidError;
    }
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "prerender-guid-mixed",
      0,
      static_cast<PF_ParamIndex>(-1),
      -1,
      "document=" + documentIdentity +
        " controllerFrames=" +
          std::to_string(
            info->controllerTimelineTargetFrame + 1
          ) +
        " controllerHash=" +
          info->controllerTimelineHash
    );
  } else {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "prerender-guid-unavailable",
      0,
      static_cast<PF_ParamIndex>(-1),
      -1,
      "host did not provide GuidMixInPtr"
    );
  }
  info->dependencyMixMs =
    ElapsedMilliseconds(dependencyStarted);

  PF_LRect canvasRect{};
  canvasRect.left = info->canvasLeft;
  canvasRect.top = info->canvasTop;
  canvasRect.right =
    canvasRect.left + std::max<A_long>(1, info->canvasWidth);
  canvasRect.bottom =
    canvasRect.top + std::max<A_long>(1, info->canvasHeight);
  extra->output->result_rect = IntersectRects(
    canvasRect,
    extra->input->output_request.rect
  );
  extra->output->max_result_rect = canvasRect;
  extra->output->solid = FALSE;

  info->tileLeft = extra->output->result_rect.left;
  info->tileTop = extra->output->result_rect.top;
  info->tileRight = extra->output->result_rect.right;
  info->tileBottom = extra->output->result_rect.bottom;

  extra->output->pre_render_data = info;
  extra->output->delete_pre_render_data_func =
    DisposeRenderInvocationInfo;

  if (bitmap::gpu::Available()) {
    extra->output->flags |=
      PF_RenderOutputFlag_GPU_RENDER_POSSIBLE;
  }

  std::ostringstream completeDetail;
  completeDetail
    << "runtime=" << info->runtimeKey
    << " codeMode=" << info->codeSelectionMode
    << " codeKeys=" << info->codeKeyframeCount
    << " codeHash=" << info->document.sourceHash
    << " codeStart="
    << CodeCueTimeIdentity(info->document.codeStartTime)
    << " controllerFrames="
    << (info->controllerTimelineTargetFrame + 1)
    << " controllerHash=" << info->controllerTimelineHash
    << " codeCache=" << info->documentCacheIdentity
    << " requestGeneration="
    << info->controllerRequestGeneration
    << " interactionGeneration="
    << info->controllerInteractionGeneration
    << " canvas=" << info->canvasWidth << 'x'
    << info->canvasHeight
    << " renderCanvas=" << info->renderCanvasWidth << 'x'
    << info->renderCanvasHeight
    << " downsample=" << info->downsampleScaleX << 'x'
    << info->downsampleScaleY
    << " tile=" << info->tileLeft << ',' << info->tileTop
    << '-' << info->tileRight << ',' << info->tileBottom
    << " gpuPossible=" << (bitmap::gpu::Available() ? 1 : 0);
  runtime_internal::AppendEffectRuntimeDiagnostic(
    input,
    "prerender-complete",
    0,
    static_cast<PF_ParamIndex>(-1),
    -1,
    completeDetail.str()
  );

  info->preRenderTotalMs = ElapsedMilliseconds(started);
  std::ostringstream timingDetail;
  timingDetail
    << std::fixed << std::setprecision(3)
    << "stage=prerender"
    << " totalMs=" << info->preRenderTotalMs
    << " documentMs=" << info->documentPrepareMs
    << " controllerMs=" << info->controllerTimelineMs
    << " dependencyMs=" << info->dependencyMixMs
    << " codeMode=" << info->codeSelectionMode
    << " codeKeys=" << info->codeKeyframeCount
    << " codeHash=" << info->document.sourceHash
    << " codeCache=" << info->documentCacheIdentity
    << " codeStart="
    << CodeCueTimeIdentity(info->document.codeStartTime)
    << " controllerFrames="
    << (info->controllerTimelineTargetFrame + 1)
    << " requestGeneration="
    << info->controllerRequestGeneration
    << " interactionGeneration="
    << info->controllerInteractionGeneration
    << " invocation=" << info->runtimeKey
    << " preparationCache=" << info->preparationCacheKey;
  runtime_internal::AppendEffectRuntimeDiagnostic(
    input,
    "render-timing",
    0,
    static_cast<PF_ParamIndex>(-1),
    info->controllerTimelineTargetFrame,
    timingDetail.str()
  );

  (void)output;
  return PF_Err_NONE;
}

namespace {

double ElapsedMilliseconds(
  std::chrono::steady_clock::time_point start
) {
  return std::chrono::duration<double, std::milli>(
    std::chrono::steady_clock::now() - start
  ).count();
}

std::uintptr_t NextRenderInvocationRuntimeKey() {
  // Sequence session tokens are odd. Render invocation keys remain even so
  // the two namespaces cannot alias in the process-local runtime registry.
  static std::atomic<std::uintptr_t> nextKey{2};
  std::uintptr_t key = nextKey.fetch_add(2, std::memory_order_relaxed);
  if (key == 0) {
    key = nextKey.fetch_add(2, std::memory_order_relaxed);
  }
  return key;
}

ScopedRenderRuntime::ScopedRenderRuntime()
  : key_(NextRenderInvocationRuntimeKey()) {}

ScopedRenderRuntime::~ScopedRenderRuntime() {
  if (key_) {
    ClearCachedSketchByKey(key_, "legacy-render-dispose");
  }
}

std::uintptr_t ScopedRenderRuntime::key() const {
  return key_;
}

void DisposeRenderInvocationInfo(void* preRenderData) {
  if (!preRenderData) {
    return;
  }
  auto* info = reinterpret_cast<RenderInvocationInfo*>(preRenderData);
  if (info->runtimeKey) {
    ClearCachedSketchByKey(
      info->runtimeKey,
      "render-invocation-dispose"
    );
  }
  delete info;
}

PF_LRect IntersectRects(const PF_LRect& left, const PF_LRect& right) {
  PF_LRect result{};
  result.left = std::max(left.left, right.left);
  result.top = std::max(left.top, right.top);
  result.right = std::min(left.right, right.right);
  result.bottom = std::min(left.bottom, right.bottom);
  if (result.right < result.left) {
    result.right = result.left;
  }
  if (result.bottom < result.top) {
    result.bottom = result.top;
  }
  return result;
}

double DownsampleScale(const PF_RationalScale& scale) {
  if (scale.num <= 0 || scale.den <= 0) {
    return 1.0;
  }
  return static_cast<double>(scale.num) / static_cast<double>(scale.den);
}

A_long ScaleDimension(A_long logicalSize, double scale) {
  return std::max<A_long>(
    1,
    static_cast<A_long>(
      std::floor(static_cast<double>(std::max<A_long>(1, logicalSize)) * scale)
    )
  );
}

PF_LayerDef MakeSceneSurface(
  const PF_LayerDef& outputWorld,
  const RenderInvocationInfo& invocation
) {
  PF_LayerDef sceneSurface = outputWorld;
  sceneSurface.width = std::max<A_long>(1, invocation.canvasWidth);
  sceneSurface.height = std::max<A_long>(1, invocation.canvasHeight);
  return sceneSurface;
}

OutputCopyOriginInfo ResolveOutputCopyOrigin(
  const PF_LayerDef& outputWorld,
  const RenderInvocationInfo& invocation
) {
  OutputCopyOriginInfo result;
  const A_long canvasWidth = std::max<A_long>(1, invocation.canvasWidth);
  const A_long canvasHeight = std::max<A_long>(1, invocation.canvasHeight);
  const A_long renderCanvasWidth = std::max<A_long>(1, invocation.renderCanvasWidth);
  const A_long renderCanvasHeight = std::max<A_long>(1, invocation.renderCanvasHeight);
  // Derive the copy step from the integer render canvas. This preserves the
  // far edges when an odd logical dimension is rounded by the host.
  result.sourceStepX = static_cast<double>(canvasWidth) /
    static_cast<double>(renderCanvasWidth);
  result.sourceStepY = static_cast<double>(canvasHeight) /
    static_cast<double>(renderCanvasHeight);
  const A_long requestedTileWidth =
    std::max<A_long>(0, invocation.tileRight - invocation.tileLeft);
  const A_long requestedTileHeight =
    std::max<A_long>(0, invocation.tileBottom - invocation.tileTop);
  const A_long requestedPhysicalWidth = requestedTileWidth > 0
    ? std::max<A_long>(
        1,
        static_cast<A_long>(std::ceil(
          static_cast<double>(requestedTileWidth) / result.sourceStepX
        ))
      )
    : 0;
  const A_long requestedPhysicalHeight = requestedTileHeight > 0
    ? std::max<A_long>(
        1,
        static_cast<A_long>(std::ceil(
          static_cast<double>(requestedTileHeight) / result.sourceStepY
        ))
      )
    : 0;
  result.outputLooksLikeTile =
    requestedPhysicalWidth > 0 &&
    requestedPhysicalHeight > 0 &&
    std::abs(outputWorld.width - requestedPhysicalWidth) <= 1 &&
    std::abs(outputWorld.height - requestedPhysicalHeight) <= 1;

  // AE world origins stay in logical layer coordinates during downsampling.
  // sourceStep applies between output pixels, not to the origin itself.
  const A_long originSourceX = outputWorld.origin_x - invocation.canvasLeft;
  const A_long originSourceY = outputWorld.origin_y - invocation.canvasTop;
  const double outputLogicalWidth =
    static_cast<double>(std::max<A_long>(0, outputWorld.width)) * result.sourceStepX;
  const double outputLogicalHeight =
    static_cast<double>(std::max<A_long>(0, outputWorld.height)) * result.sourceStepY;
  const double edgeToleranceX = std::max(1.0, result.sourceStepX);
  const double edgeToleranceY = std::max(1.0, result.sourceStepY);
  const bool outputOriginFitsCanvas =
    originSourceX >= 0 &&
    originSourceY >= 0 &&
    outputWorld.width >= 0 &&
    outputWorld.height >= 0 &&
    static_cast<double>(originSourceX) + outputLogicalWidth <=
      static_cast<double>(canvasWidth) + edgeToleranceX &&
    static_cast<double>(originSourceY) + outputLogicalHeight <=
      static_cast<double>(canvasHeight) + edgeToleranceY;
  if (outputOriginFitsCanvas) {
    result.sourceOriginX = static_cast<double>(originSourceX);
    result.sourceOriginY = static_cast<double>(originSourceY);
    result.mode = "output-origin";
    return result;
  }

  if (result.outputLooksLikeTile) {
    result.sourceOriginX = static_cast<double>(
      std::max<A_long>(0, invocation.tileLeft - invocation.canvasLeft)
    );
    result.sourceOriginY = static_cast<double>(
      std::max<A_long>(0, invocation.tileTop - invocation.canvasTop)
    );
    result.mode = "requested-tile";
  }
  result.sourceOriginX = std::min<double>(result.sourceOriginX, canvasWidth);
  result.sourceOriginY = std::min<double>(result.sourceOriginY, canvasHeight);
  return result;
}

}  // namespace

std::uint64_t RegisterControllerInteractionChange(
  std::uint64_t liveEffectSessionId
) {
  if (liveEffectSessionId == 0) {
    return 0;
  }

  RenderState& state = State();
  const std::uint64_t generation =
    state.nextInteractionGeneration.fetch_add(1, std::memory_order_relaxed);
  std::lock_guard<std::mutex> lock(state.interactionMutex);
  state.interactions[liveEffectSessionId].generation = generation;
  if (state.interactions.size() > 2048) {
    for (auto it = state.interactions.begin();
         it != state.interactions.end() && state.interactions.size() > 1024;) {
      if (it->first == liveEffectSessionId) {
        ++it;
      } else {
        it = state.interactions.erase(it);
      }
    }
  }
  return generation;
}

namespace {

std::uint64_t ReadControllerInteractionGeneration(
  std::uint64_t liveEffectSessionId
) {
  if (liveEffectSessionId == 0) {
    return 0;
  }

  RenderState& state = State();
  std::lock_guard<std::mutex> lock(state.interactionMutex);
  const auto it = state.interactions.find(liveEffectSessionId);
  return it == state.interactions.end() ? 0 : it->second.generation;
}

}  // namespace

void DiscardControllerInteractionState(
  std::uint64_t liveEffectSessionId
) {
  if (liveEffectSessionId == 0) {
    return;
  }

  RenderState& state = State();
  std::lock_guard<std::mutex> lock(state.interactionMutex);
  state.interactions.erase(liveEffectSessionId);
}

namespace {

std::uint64_t RegisterControllerRenderRequest(
  std::uint64_t lineageIdentity,
  long targetFrame,
  const std::string& controllerHash
) {
  const std::uint64_t requestKey =
    BuildRenderRequestKey(lineageIdentity, targetFrame);
  RenderState& state = State();
  std::lock_guard<std::mutex> lock(state.requestMutex);
  ControllerRenderRequest& request = state.requests[requestKey];
  if (request.generation != 0 && request.controllerHash == controllerHash) {
    return request.generation;
  }

  request.controllerHash = controllerHash;
  request.generation = state.nextRequestGeneration.fetch_add(
    1,
    std::memory_order_relaxed
  );
  const std::uint64_t generation = request.generation;
  if (state.requests.size() > 2048) {
    for (auto it = state.requests.begin();
         it != state.requests.end() && state.requests.size() > 1024;) {
      if (it->first == requestKey) {
        ++it;
      } else {
        it = state.requests.erase(it);
      }
    }
  }
  return generation;
}

bool IsCurrentControllerRenderRequest(
  const RenderInvocationInfo& invocation
) {
  if (invocation.controllerRequestGeneration == 0) {
    return true;
  }

  const std::uint64_t requestKey = BuildRenderRequestKey(
    invocation.documentCacheIdentity,
    invocation.controllerTimelineTargetFrame
  );
  RenderState& state = State();
  std::lock_guard<std::mutex> lock(state.requestMutex);
  const auto it = state.requests.find(requestKey);
  return it == state.requests.end() ||
    (it->second.generation == invocation.controllerRequestGeneration &&
      it->second.controllerHash == invocation.controllerTimelineHash);
}

bool IsLatestControllerInteraction(
  const RenderInvocationInfo& invocation
) {
  return ReadControllerInteractionGeneration(invocation.lineageIdentity) ==
    invocation.controllerInteractionGeneration;
}

}  // namespace

PF_Err QueryDynamicFlags(
  PF_InData* input,
  PF_OutData* output,
  PF_ParamDef* parameters[],
  void* extra
) {
  (void)input;
  (void)parameters;
  (void)extra;
  if (output) {
    output->out_flags |= PF_OutFlag_NON_PARAM_VARY;
    output->out_flags |= PF_OutFlag_WIDE_TIME_INPUT;
    output->out_flags |= PF_OutFlag_PIX_INDEPENDENT;
  }
  return PF_Err_NONE;
}

PF_Err GPUDeviceSetup(
  PF_InData* input,
  PF_OutData* output,
  PF_GPUDeviceSetupExtra* extra
) {
  if (!extra || !extra->input || !extra->output) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  std::string errorMessage;
  const PF_Err error = bitmap::gpu::CreateContext(
    input,
    output,
    extra->input->what_gpu,
    extra->input->device_index,
    &extra->output->gpu_data,
    &errorMessage
  );
  if (error != PF_Err_NONE) {
    return error;
  }

  if (output) {
    output->out_flags =
      static_cast<PF_OutFlags>(MOMENTUM_EFFECT_OUT_FLAGS);
    output->out_flags2 =
      static_cast<PF_OutFlags2>(MOMENTUM_EFFECT_OUT_FLAGS2);
  }
  return PF_Err_NONE;
}

PF_Err GPUDeviceSetdown(
  PF_InData* input,
  PF_OutData* output,
  PF_GPUDeviceSetdownExtra* extra
) {
  if (!extra || !extra->input) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  bitmap::gpu::DestroyContext(input, output, extra->input->gpu_data);
  return PF_Err_NONE;
}

namespace {

PF_Err BuildRenderInvocationInfo(
  PF_InData* input,
  RenderInvocationInfo** outputInfo
) {
  if (!outputInfo) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  auto* info = new (std::nothrow) RenderInvocationInfo();
  if (!info) {
    return PF_Err_OUT_OF_MEMORY;
  }

  info->runtimeKey = NextRenderInvocationRuntimeKey();
  info->canvasLeft = 0;
  info->canvasTop = 0;
  info->canvasWidth =
    input ? std::max<A_long>(1, input->width) : 1;
  info->canvasHeight =
    input ? std::max<A_long>(1, input->height) : 1;
  info->downsampleScaleX =
    input ? DownsampleScale(input->downsample_x) : 1.0;
  info->downsampleScaleY =
    input ? DownsampleScale(input->downsample_y) : 1.0;
  info->renderCanvasWidth = ScaleDimension(
    info->canvasWidth,
    info->downsampleScaleX
  );
  info->renderCanvasHeight = ScaleDimension(
    info->canvasHeight,
    info->downsampleScaleY
  );
  info->tileLeft = 0;
  info->tileTop = 0;
  info->tileRight = info->canvasLeft + info->canvasWidth;
  info->tileBottom = info->canvasTop + info->canvasHeight;

  PF_ParamDef codeParam;
  AEFX_CLR_STRUCT(codeParam);
  PF_Err error = PF_CHECKOUT_PARAM(
    input,
    PARAM_CODE_SNAPSHOT,
    input->current_time,
    input->time_step,
    input->time_scale,
    &codeParam
  );
  if (error != PF_Err_NONE) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "render-invocation-failed",
      0,
      PARAM_CODE_SNAPSHOT,
      -1,
      "stage=checkout-code err=" +
        std::to_string(static_cast<long>(error))
    );
    delete info;
    return error;
  }

  PF_ParamDef defaultCodeParam;
  AEFX_CLR_STRUCT(defaultCodeParam);
  error = PF_CHECKOUT_PARAM(
    input,
    PARAM_DEFAULT_CODE,
    input->current_time,
    input->time_step,
    input->time_scale,
    &defaultCodeParam
  );
  if (error != PF_Err_NONE) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "render-invocation-failed",
      0,
      PARAM_DEFAULT_CODE,
      -1,
      "stage=checkout-default-code err=" +
        std::to_string(static_cast<long>(error)) +
        " code={" +
        DescribeCodeSnapshotHandle(
          input,
          codeParam.u.arb_d.value
        ) +
        "}"
    );
    PF_CHECKIN_PARAM(input, &codeParam);
    delete info;
    return error;
  }

  const std::string codeDescription =
    DescribeCodeSnapshotHandle(
      input,
      codeParam.u.arb_d.value
    );
  const std::string defaultCodeDescription =
    DescribeCodeSnapshotHandle(
      input,
      defaultCodeParam.u.arb_d.value
    );
  std::string documentError;
  info->document = ReadEffectRuntimeSketchBundleAtTime(
    input,
    codeParam.u.arb_d.value,
    defaultCodeParam.u.arb_d.value,
    &documentError,
    &info->codeSelectionMode,
    &info->codeKeyframeCount,
    &info->restartKeyframeCount
  );
  {
    std::ostringstream detail;
    detail
      << "time=" << (input ? input->current_time : 0)
      << '/' << (input ? input->time_scale : 0)
      << " mode=" << info->codeSelectionMode
      << " keyframes=" << info->codeKeyframeCount
      << " restartKeys=" << info->restartKeyframeCount
      << " selectedHash=" << info->document.sourceHash
      << " selectedSourceBytes="
      << info->document.sourceText.size()
      << " softCues=" << info->document.softCodeCues.size()
      << " code={" << codeDescription << '}'
      << " default={" << defaultCodeDescription << '}';
    if (!documentError.empty()) {
      detail << " error=" << documentError;
    }
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "code-parameter-state",
      0,
      PARAM_CODE_SNAPSHOT,
      -1,
      detail.str()
    );
  }
  PF_CHECKIN_PARAM(input, &defaultCodeParam);
  PF_CHECKIN_PARAM(input, &codeParam);
  if (!documentError.empty() ||
      !info->document.hasEmbeddedSource) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "render-invocation-failed",
      0,
      PARAM_CODE_SNAPSHOT,
      -1,
      "stage=select-code-document mode=" +
        info->codeSelectionMode +
        " keyframes=" +
        std::to_string(
          static_cast<long>(info->codeKeyframeCount)
        ) +
        " restartKeys=" +
        std::to_string(
          static_cast<long>(info->restartKeyframeCount)
        ) +
        " code={" + codeDescription +
        "} default={" + defaultCodeDescription +
        "} error=" + documentError
    );
    delete info;
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  info->lineageIdentity =
    runtime_internal::ResolveLiveEffectSessionId(input);
  info->documentCacheIdentity =
    ResolveEffectDocumentCacheIdentity(
      info->lineageIdentity,
      info->document.sourceHash,
      info->document.codeStartTime
    );
  info->preparationCacheKey =
    ResolveEffectPreparationCacheKey(
      info->documentCacheIdentity
    );
  info->renderCacheKey =
    ResolveEffectRenderCacheKeyForScale(
      info->documentCacheIdentity,
      info->downsampleScaleX,
      info->downsampleScaleY
    );

  if (!info->runtimeKey) {
    delete info;
    return PF_Err_OUT_OF_MEMORY;
  }

  *outputInfo = info;
  return PF_Err_NONE;
}

PF_Err CopyCpuRasterToOutput(
  PF_LayerDef* output,
  PF_PixelFormat pixelFormat,
  const std::vector<PF_Pixel>* raster,
  const RenderInvocationInfo& invocation,
  A_long rasterWidth,
  A_long rasterHeight
) {
  if (!output || !raster) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  const A_long canvasWidth =
    std::max<A_long>(1, invocation.canvasWidth);
  const A_long canvasHeight =
    std::max<A_long>(1, invocation.canvasHeight);
  const A_long sourceWidth = std::max<A_long>(1, rasterWidth);
  const A_long sourceHeight =
    std::max<A_long>(1, rasterHeight);
  const OutputCopyOriginInfo copyOrigin =
    ResolveOutputCopyOrigin(*output, invocation);
  const std::size_t rasterSize = raster->size();

  auto sampleSourcePixel = [&](double logicalX, double logicalY) {
    if (logicalX < 0 || logicalY < 0 ||
        logicalX >= canvasWidth ||
        logicalY >= canvasHeight) {
      return PF_Pixel{0, 0, 0, 0};
    }
    const A_long sampleX = std::min<A_long>(
      sourceWidth - 1,
      std::max<A_long>(
        0,
        static_cast<A_long>(std::floor(
          logicalX * static_cast<double>(sourceWidth) /
            static_cast<double>(canvasWidth)
        ))
      )
    );
    const A_long sampleY = std::min<A_long>(
      sourceHeight - 1,
      std::max<A_long>(
        0,
        static_cast<A_long>(std::floor(
          logicalY * static_cast<double>(sourceHeight) /
            static_cast<double>(canvasHeight)
        ))
      )
    );
    const std::size_t sampleIndex =
      static_cast<std::size_t>(
        sampleY * sourceWidth + sampleX
      );
    return sampleIndex < rasterSize
      ? (*raster)[sampleIndex]
      : PF_Pixel{0, 0, 0, 0};
  };

  if (pixelFormat == PF_PixelFormat_ARGB32 &&
      sourceWidth == canvasWidth &&
      sourceHeight == canvasHeight &&
      std::abs(copyOrigin.sourceStepX - 1.0) < 1e-9 &&
      std::abs(copyOrigin.sourceStepY - 1.0) < 1e-9 &&
      copyOrigin.sourceOriginX >= 0.0 &&
      copyOrigin.sourceOriginY >= 0.0 &&
      std::floor(copyOrigin.sourceOriginX) ==
        copyOrigin.sourceOriginX &&
      std::floor(copyOrigin.sourceOriginY) ==
        copyOrigin.sourceOriginY &&
      copyOrigin.sourceOriginX + output->width <= sourceWidth &&
      copyOrigin.sourceOriginY + output->height <= sourceHeight) {
    const A_long originX =
      static_cast<A_long>(copyOrigin.sourceOriginX);
    const A_long originY =
      static_cast<A_long>(copyOrigin.sourceOriginY);
    const std::size_t copyBytes =
      static_cast<std::size_t>(output->width) *
      sizeof(PF_Pixel);
    for (A_long y = 0; y < output->height; ++y) {
      const PF_Pixel* sourceRow = raster->data() +
        static_cast<std::size_t>(
          (originY + y) * sourceWidth + originX
        );
      void* outputRow =
        reinterpret_cast<A_u_char*>(output->data) +
        y * output->rowbytes;
      std::memcpy(outputRow, sourceRow, copyBytes);
    }
    return PF_Err_NONE;
  }

  switch (pixelFormat) {
    case PF_PixelFormat_ARGB128:
      for (A_long y = 0; y < output->height; ++y) {
        auto* row = reinterpret_cast<PF_PixelFloat*>(
          reinterpret_cast<A_u_char*>(output->data) +
          y * output->rowbytes
        );
        const double sourceY =
          copyOrigin.sourceOriginY +
          (static_cast<double>(y) + 0.5) *
            copyOrigin.sourceStepY;
        for (A_long x = 0; x < output->width; ++x) {
          const double sourceX =
            copyOrigin.sourceOriginX +
            (static_cast<double>(x) + 0.5) *
              copyOrigin.sourceStepX;
          const PF_Pixel source =
            sampleSourcePixel(sourceX, sourceY);
          row[x].alpha = static_cast<PF_FpShort>(
            static_cast<double>(source.alpha) / 255.0
          );
          row[x].red = static_cast<PF_FpShort>(
            static_cast<double>(source.red) / 255.0
          );
          row[x].green = static_cast<PF_FpShort>(
            static_cast<double>(source.green) / 255.0
          );
          row[x].blue = static_cast<PF_FpShort>(
            static_cast<double>(source.blue) / 255.0
          );
        }
      }
      return PF_Err_NONE;
    case PF_PixelFormat_ARGB64:
      for (A_long y = 0; y < output->height; ++y) {
        auto* row = reinterpret_cast<PF_Pixel16*>(
          reinterpret_cast<A_u_char*>(output->data) +
          y * output->rowbytes
        );
        const double sourceY =
          copyOrigin.sourceOriginY +
          (static_cast<double>(y) + 0.5) *
            copyOrigin.sourceStepY;
        for (A_long x = 0; x < output->width; ++x) {
          const double sourceX =
            copyOrigin.sourceOriginX +
            (static_cast<double>(x) + 0.5) *
              copyOrigin.sourceStepX;
          row[x] = ToPixel16(
            sampleSourcePixel(sourceX, sourceY)
          );
        }
      }
      return PF_Err_NONE;
    case PF_PixelFormat_ARGB32:
    default:
      for (A_long y = 0; y < output->height; ++y) {
        auto* row = reinterpret_cast<PF_Pixel*>(
          reinterpret_cast<A_u_char*>(output->data) +
          y * output->rowbytes
        );
        const double sourceY =
          copyOrigin.sourceOriginY +
          (static_cast<double>(y) + 0.5) *
            copyOrigin.sourceStepY;
        for (A_long x = 0; x < output->width; ++x) {
          const double sourceX =
            copyOrigin.sourceOriginX +
            (static_cast<double>(x) + 0.5) *
              copyOrigin.sourceStepX;
          row[x] = sampleSourcePixel(sourceX, sourceY);
        }
      }
      return PF_Err_NONE;
  }
}

PF_Err RenderCurrentSketchToCpuWorld(
  PF_InData* input,
  PF_LayerDef* output,
  const RenderInvocationInfo& invocation,
  PF_PixelFormat pixelFormat
) {
  std::string errorMessage;
  PF_LayerDef sceneSurface =
    MakeSceneSurface(*output, invocation);
  const auto shouldCancel = [&invocation]() {
    return !IsCurrentControllerRenderRequest(invocation) ||
      !IsLatestControllerInteraction(invocation);
  };
  bitmap::BitmapFramePlan framePlan;
  if (!BuildBitmapCpuFramePlanAtCurrentTime(
        input,
        invocation.runtimeKey,
        invocation.renderCacheKey,
        &sceneSurface,
        shouldCancel,
        &framePlan,
        &errorMessage
      )) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      errorMessage == "render-cancelled"
        ? "cpu-render-cancelled"
        : "cpu-frame-plan-failed",
      0,
      static_cast<PF_ParamIndex>(-1),
      invocation.controllerTimelineTargetFrame,
      errorMessage
    );
    return errorMessage == "render-cancelled"
      ? PF_Interrupt_CANCEL
      : PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  std::vector<PF_Pixel> raster;
  if (!bitmap::cpu::Render(
        framePlan,
        &raster,
        shouldCancel,
        &errorMessage
      )) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      errorMessage == "render-cancelled"
        ? "cpu-render-cancelled"
        : "cpu-render-failed",
      0,
      static_cast<PF_ParamIndex>(-1),
      framePlan.targetFrame,
      errorMessage
    );
    return errorMessage == "render-cancelled"
      ? PF_Interrupt_CANCEL
      : PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  return CopyCpuRasterToOutput(
    output,
    pixelFormat,
    &raster,
    invocation,
    framePlan.width,
    framePlan.height
  );
}

}  // namespace

PF_Err SmartRender(
  PF_InData* input,
  PF_OutData* output,
  PF_SmartRenderExtra* extra,
  bool useGpu
) {
  const auto started = std::chrono::steady_clock::now();
  {
    std::ostringstream detail;
    detail
      << "gpu=" << (useGpu ? 1 : 0)
      << " extra=" << reinterpret_cast<std::uintptr_t>(extra)
      << " input=" << reinterpret_cast<std::uintptr_t>(
           extra ? extra->input : NULL
         )
      << " cb=" << reinterpret_cast<std::uintptr_t>(
           extra ? extra->cb : NULL
         )
      << " preRenderData=" << reinterpret_cast<std::uintptr_t>(
           extra && extra->input
             ? extra->input->pre_render_data
             : NULL
         );
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "smart-render-enter",
      -1,
      static_cast<PF_ParamIndex>(-1),
      -1,
      detail.str()
    );
  }
  if (!extra || !extra->input || !extra->cb) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  auto* info = reinterpret_cast<RenderInvocationInfo*>(
    extra->input->pre_render_data
  );
  if (!info) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "smart-render-failed",
      -1,
      static_cast<PF_ParamIndex>(-1),
      -1,
      "missing pre-render invocation"
    );
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  if (!IsCurrentControllerRenderRequest(*info) ||
      !IsLatestControllerInteraction(*info)) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "controller-render-superseded",
      0,
      static_cast<PF_ParamIndex>(-1),
      info->controllerTimelineTargetFrame,
      "phase=smart-render-enter policy=latest-wins "
      "requestGeneration=" +
        std::to_string(info->controllerRequestGeneration) +
        " capturedInteractionGeneration=" +
        std::to_string(info->controllerInteractionGeneration) +
        " latestInteractionGeneration=" +
        std::to_string(ReadControllerInteractionGeneration(
          info->lineageIdentity
        ))
    );
    return PF_Interrupt_CANCEL;
  }

  PF_EffectWorld* outputWorld = NULL;
  PF_Err error = extra->cb->checkout_output(
    input->effect_ref,
    &outputWorld
  );
  if (error != PF_Err_NONE || !outputWorld) {
    return error != PF_Err_NONE
      ? error
      : PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  AEFX_SuiteScoper<PF_WorldSuite2> worldSuite(
    input,
    kPFWorldSuite,
    kPFWorldSuiteVersion2,
    output
  );
  PF_PixelFormat pixelFormat = PF_PixelFormat_INVALID;
  error = worldSuite->PF_GetPixelFormat(
    outputWorld,
    &pixelFormat
  );
  if (error != PF_Err_NONE) {
    return error;
  }

  if (!useGpu) {
    const auto cpuStarted = std::chrono::steady_clock::now();
    error = RenderCurrentSketchToCpuWorld(
      input,
      outputWorld,
      *info,
      pixelFormat
    );
    const double cpuMs = ElapsedMilliseconds(cpuStarted);
    if (error == PF_Err_NONE &&
        (!IsCurrentControllerRenderRequest(*info) ||
         !IsLatestControllerInteraction(*info))) {
      return PF_Interrupt_CANCEL;
    }
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      error == PF_Err_NONE
        ? "cpu-render-complete"
        : "smart-render-failed",
      0,
      static_cast<PF_ParamIndex>(-1),
      -1,
      "pixelFormat=" +
        std::to_string(static_cast<long>(pixelFormat)) +
        " output=" +
        std::to_string(static_cast<long>(outputWorld->width)) +
        "x" +
        std::to_string(static_cast<long>(outputWorld->height)) +
        " err=" + std::to_string(static_cast<long>(error))
    );
    std::ostringstream timingDetail;
    timingDetail
      << std::fixed << std::setprecision(3)
      << "stage=smart-render backend=cpu"
      << " totalMs=" << ElapsedMilliseconds(started)
      << " planAndExecuteMs=" << cpuMs
      << " renderCache=" << info->renderCacheKey;
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "render-timing",
      0,
      static_cast<PF_ParamIndex>(-1),
      info->controllerTimelineTargetFrame,
      timingDetail.str()
    );
    return error;
  }

  PF_LayerDef sceneSurface =
    MakeSceneSurface(*outputWorld, *info);
  std::string errorMessage;
  bitmap::BitmapFramePlan framePlan;
  const auto planStarted = std::chrono::steady_clock::now();
  const bool planReady = BuildBitmapFramePlanAtCurrentTime(
    input,
    info->runtimeKey,
    info->renderCacheKey,
    &sceneSurface,
    &framePlan,
    &errorMessage
  );
  const double planMs = ElapsedMilliseconds(planStarted);
  if (!planReady) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "bitmap-frame-plan-failed",
      0,
      static_cast<PF_ParamIndex>(-1),
      -1,
      errorMessage
    );
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  bitmap::planning::Scale(
    &framePlan,
    info->renderCanvasWidth,
    info->renderCanvasHeight
  );
  if (!IsCurrentControllerRenderRequest(*info)) {
    return PF_Interrupt_CANCEL;
  }

  std::size_t sceneCommands = 0;
  std::size_t fillTriangles = 0;
  std::size_t strokeTriangles = 0;
  std::size_t pathFills = 0;
  std::size_t imageDraws = 0;
  std::size_t drawBatches = 0;
  for (const bitmap::BitmapFramePlanOp& operation :
       framePlan.operations) {
    sceneCommands += operation.drawPlan.scene.commands.size();
    fillTriangles += operation.drawPlan.fillTriangles.size();
    strokeTriangles +=
      operation.drawPlan.strokeTriangles.size();
    pathFills += operation.drawPlan.pathFills.size();
    imageDraws += operation.drawPlan.imageDraws.size();
    drawBatches += operation.drawPlan.drawBatches.size();
  }
  const OutputCopyOriginInfo copyOrigin =
    ResolveOutputCopyOrigin(*outputWorld, *info);
  std::ostringstream planDetail;
  planDetail
    << "runtime=" << info->runtimeKey
    << " pixelFormat=" << static_cast<long>(pixelFormat)
    << " output=" << outputWorld->width << 'x'
    << outputWorld->height
    << " rowbytes=" << outputWorld->rowbytes
    << " plan=" << framePlan.width << 'x' << framePlan.height
    << " downsample=" << info->downsampleScaleX << 'x'
    << info->downsampleScaleY
    << " copyMode=" << copyOrigin.mode
    << " copyOrigin=" << copyOrigin.sourceOriginX << ','
    << copyOrigin.sourceOriginY
    << " copyStep=" << copyOrigin.sourceStepX << ','
    << copyOrigin.sourceStepY
    << " ops=" << framePlan.operations.size()
    << " commands=" << sceneCommands
    << " fillTriangles=" << fillTriangles
    << " strokeTriangles=" << strokeTriangles
    << " pathFills=" << pathFills
    << " images=" << imageDraws
    << " batches=" << drawBatches;
  runtime_internal::AppendEffectRuntimeDiagnostic(
    input,
    "bitmap-frame-plan-ready",
    0,
    static_cast<PF_ParamIndex>(-1),
    framePlan.targetFrame,
    planDetail.str()
  );

  const auto gpuStarted = std::chrono::steady_clock::now();
  error = bitmap::gpu::Render(
    input,
    output,
    const_cast<void*>(extra->input->gpu_data),
    outputWorld,
    pixelFormat,
    copyOrigin.sourceOriginX,
    copyOrigin.sourceOriginY,
    copyOrigin.sourceStepX,
    copyOrigin.sourceStepY,
    framePlan,
    &errorMessage
  );
  const double gpuMs = ElapsedMilliseconds(gpuStarted);
  if (error == PF_Err_NONE &&
      !IsCurrentControllerRenderRequest(*info)) {
    return PF_Interrupt_CANCEL;
  }
  runtime_internal::AppendEffectRuntimeDiagnostic(
    input,
    error == PF_Err_NONE
      ? "gpu-render-complete"
      : "gpu-render-failed",
    0,
    static_cast<PF_ParamIndex>(-1),
    framePlan.targetFrame,
    error == PF_Err_NONE ? planDetail.str() : errorMessage
  );
  std::ostringstream timingDetail;
  timingDetail
    << std::fixed << std::setprecision(3)
    << "stage=smart-render backend=gpu"
    << " totalMs=" << ElapsedMilliseconds(started)
    << " planMs=" << planMs
    << " metalAndCopyMs=" << gpuMs
    << " operations=" << framePlan.operations.size()
    << " renderCache=" << info->renderCacheKey;
  runtime_internal::AppendEffectRuntimeDiagnostic(
    input,
    "render-timing",
    0,
    static_cast<PF_ParamIndex>(-1),
    framePlan.targetFrame,
    timingDetail.str()
  );
  return error;
}

PF_Err Render(
  PF_InData* input,
  PF_ParamDef* parameters[],
  PF_LayerDef* output
) {
  const ScopedRenderRuntime renderRuntime;
  const auto runtimeKey = renderRuntime.key();
  const std::uint64_t lineageIdentity =
    runtime_internal::ResolveLiveEffectSessionId(input);
  std::ostringstream entryDetail;
  entryDetail
    << "runtime=" << runtimeKey
    << " output=" << (output ? output->width : 0) << 'x'
    << (output ? output->height : 0)
    << " rowbytes=" << (output ? output->rowbytes : 0)
    << " time=" << (input ? input->current_time : 0)
    << '/' << (input ? input->time_scale : 0);
  runtime_internal::AppendEffectRuntimeDiagnostic(
    input,
    "legacy-render-enter",
    0,
    static_cast<PF_ParamIndex>(-1),
    -1,
    entryDetail.str()
  );
  if (!runtimeKey) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "legacy-render-failed",
      0,
      static_cast<PF_ParamIndex>(-1),
      -1,
      "could not allocate isolated render runtime"
    );
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  std::string errorMessage;
  const RuntimeSketchBundle document =
    ReadEffectRuntimeSketchBundle(
      input,
      parameters,
      &errorMessage
    );
  if (!errorMessage.empty() || !document.hasEmbeddedSource) {
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  const std::uint64_t documentCacheIdentity =
    ResolveEffectDocumentCacheIdentity(
      lineageIdentity,
      document.sourceHash,
      document.codeStartTime
    );
  const auto preparationCacheKey =
    ResolveEffectPreparationCacheKey(documentCacheIdentity);
  const auto renderCacheKey =
    ResolveEffectRenderCacheKey(documentCacheIdentity);
  if (!PrepareEffectRuntimeDocument(
        input,
        runtimeKey,
        preparationCacheKey,
        &document,
        &errorMessage
      )) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "legacy-render-failed",
      0,
      static_cast<PF_ParamIndex>(-1),
      -1,
      "document: " + errorMessage
    );
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  long controllerTimelineTargetFrame = -1;
  std::string controllerTimelineHash;
  if (!CaptureEffectControllerTimeline(
        input,
        runtimeKey,
        preparationCacheKey,
        &controllerTimelineTargetFrame,
        &controllerTimelineHash,
        &errorMessage
      )) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "legacy-render-failed",
      0,
      static_cast<PF_ParamIndex>(-1),
      -1,
      "controller-timeline: " + errorMessage
    );
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  bitmap::BitmapFramePlan framePlan;
  if (!BuildBitmapCpuFramePlanAtCurrentTime(
        input,
        runtimeKey,
        renderCacheKey,
        output,
        std::function<bool()>(),
        &framePlan,
        &errorMessage
      )) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "legacy-render-failed",
      0,
      static_cast<PF_ParamIndex>(-1),
      -1,
      "plan: " + errorMessage
    );
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  std::vector<PF_Pixel> raster;
  if (!bitmap::cpu::Render(
        framePlan,
        &raster,
        std::function<bool()>(),
        &errorMessage
      )) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "legacy-render-failed",
      0,
      static_cast<PF_ParamIndex>(-1),
      framePlan.targetFrame,
      "execute: " + errorMessage
    );
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  std::size_t visiblePixels = 0;
  std::size_t coloredPixels = 0;
  for (const PF_Pixel& pixel : raster) {
    if (pixel.alpha != 0) {
      ++visiblePixels;
    }
    if (pixel.red != 0 || pixel.green != 0 ||
        pixel.blue != 0) {
      ++coloredPixels;
    }
  }
  std::ostringstream completeDetail;
  completeDetail
    << entryDetail.str()
    << " planOps=" << framePlan.operations.size()
    << " rasterPixels=" << raster.size()
    << " visiblePixels=" << visiblePixels
    << " coloredPixels=" << coloredPixels;

  if (PF_WORLD_IS_DEEP(output)) {
    CopySurface8To16(output, raster);
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "legacy-render-complete",
      0,
      static_cast<PF_ParamIndex>(-1),
      -1,
      completeDetail.str() + " depth=16"
    );
    return PF_Err_NONE;
  }

  CopySurface8To8(output, raster);
  runtime_internal::AppendEffectRuntimeDiagnostic(
    input,
    "legacy-render-complete",
    0,
    static_cast<PF_ParamIndex>(-1),
    -1,
    completeDetail.str() + " depth=8"
  );
  return PF_Err_NONE;
}

}  // namespace momentum
