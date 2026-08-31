#pragma once

#include <functional>
#include <optional>

#include "rendering/bitmap/planning/plan.h"
#include "scripting/runtime/types.h"

namespace momentum {

std::optional<ScenePayload> ExecuteSketchAtCurrentTime(
  PF_InData* in_data,
  std::uintptr_t invocationKey,
  std::uintptr_t renderCacheKey,
  PF_LayerDef* output,
  long* targetFrameOut,
  const std::function<bool()>& shouldCancel,
  std::string* errorMessage
);

bool PrepareEffectRuntimeDocument(
  PF_InData* in_data,
  std::uintptr_t invocationKey,
  std::uintptr_t preparationCacheKey,
  const RuntimeSketchBundle* documentOverride,
  std::string* errorMessage
);

bool CaptureEffectControllerTimeline(
  PF_InData* in_data,
  std::uintptr_t invocationKey,
  std::uintptr_t preparationCacheKey,
  long* targetFrameOut,
  std::string* timelineHashOut,
  std::string* errorMessage
);

// Arbitrary color callbacks run while AE checks out controller keyframes.
// Resolve schema defaults only from the invocation-scoped document prepared by
// PreRender (or the same effect's embedded Sequence Document as a UI fallback).
bool ResolveInvocationColorControllerDefault(
  PF_InData* in_data,
  PF_ParamIndex colorParamIndex,
  ControllerColorValue* outColor
);

long ResolveSketchTargetFrame(
  PF_InData* in_data,
  std::uintptr_t runtimeKey = 0
);
double ResolveSketchSimulationFrameRate(
  PF_InData* in_data,
  std::uintptr_t runtimeKey = 0
);

bool BuildBitmapFramePlanAtCurrentTime(
  PF_InData* in_data,
  std::uintptr_t invocationKey,
  std::uintptr_t renderCacheKey,
  PF_LayerDef* output,
  bitmap::BitmapFramePlan* outPlan,
  std::string* errorMessage
);

// Builds the same self-contained frame/draw plan used by Metal. Both backends
// can execute it from the declared fallback surface without consulting mutable
// playback state.
bool BuildBitmapCpuFramePlanAtCurrentTime(
  PF_InData* in_data,
  std::uintptr_t invocationKey,
  std::uintptr_t renderCacheKey,
  PF_LayerDef* output,
  const std::function<bool()>& shouldCancel,
  bitmap::BitmapFramePlan* outPlan,
  std::string* errorMessage
);

std::string GetEffectSessionControllerUiHash(std::uintptr_t sessionKey);
void SetEffectSessionControllerUiHash(std::uintptr_t sessionKey, const std::string& hash);
std::uint64_t ResolveEffectDocumentCacheIdentity(
  std::uint64_t lineageIdentity,
  const std::string& sourceHash,
  const A_Time& codeStartTime
);
std::uintptr_t ResolveEffectPreparationCacheKey(std::uint64_t lineageIdentity);
std::uintptr_t ResolveEffectRenderCacheKey(std::uint64_t lineageIdentity);
std::uintptr_t ResolveEffectRenderCacheKeyForScale(
  std::uint64_t lineageIdentity,
  double scaleX,
  double scaleY
);
void InvalidateEffectPersistentRenderCaches(
  std::uint64_t lineageIdentity,
  const char* reason = nullptr
);
void ClearCachedSketchByKey(std::uintptr_t cacheKey, const char* reason = nullptr);
void ClearAllCachedSketches();

}  // namespace momentum
