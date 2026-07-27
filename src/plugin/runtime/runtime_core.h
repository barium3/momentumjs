#pragma once

#include "../model/momentum_types.h"

#include <functional>

namespace momentum {

std::optional<ScenePayload> ExecuteSketchAtCurrentTime(
  PF_InData* in_data,
  std::uintptr_t invocationKey,
  std::uintptr_t renderCacheKey,
  A_long revision,
  A_long instanceId,
  PF_LayerDef* output,
  long* targetFrameOut,
  const std::function<bool()>& shouldCancel,
  std::string* errorMessage
);

bool PrepareEffectRuntimeDocument(
  PF_InData* in_data,
  std::uintptr_t invocationKey,
  std::uintptr_t preparationCacheKey,
  A_long revision,
  A_long instanceId,
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
  A_long revision,
  A_long instanceId,
  PF_LayerDef* output,
  BitmapFramePlan* outPlan,
  std::string* errorMessage
);

// Builds the same immutable frame/draw plan used by Metal, but without relying
// on a backend-owned canvas cursor or checkpoint. A safe full-surface reset in
// the target frame makes that frame independently executable on CPU.
bool BuildBitmapCpuFramePlanAtCurrentTime(
  PF_InData* in_data,
  std::uintptr_t invocationKey,
  std::uintptr_t renderCacheKey,
  A_long revision,
  A_long instanceId,
  PF_LayerDef* output,
  const std::function<bool()>& shouldCancel,
  BitmapFramePlan* outPlan,
  std::string* errorMessage
);

std::uint64_t GetEffectSessionInstanceId(std::uintptr_t sessionKey);
void SetEffectSessionInstanceId(std::uintptr_t sessionKey, std::uint64_t instanceId);
A_long GetEffectSessionSyncedRevision(std::uintptr_t sessionKey);
void SetEffectSessionSyncedRevision(std::uintptr_t sessionKey, A_long revision);
std::string GetEffectSessionControllerHash(std::uintptr_t sessionKey);
void SetEffectSessionControllerHash(std::uintptr_t sessionKey, const std::string& hash);
std::string GetEffectSessionControllerUiHash(std::uintptr_t sessionKey);
void SetEffectSessionControllerUiHash(std::uintptr_t sessionKey, const std::string& hash);
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
