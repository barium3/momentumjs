#include "../model/momentum_types.h"
#include "../model/controller_schema.h"
#include "../momentum_effect_contract.h"
#include "../api/api_internal.h"
#include "../gpu/bitmap_gpu_backend.h"
#include "../gpu/bitmap_draw_plan.h"
#include "../render/render_core.h"
#include "../runtime/runtime_core.h"
#include "../runtime/runtime_internal.h"
#include "AE_PluginData.h"
#include "AE_EffectUI.h"
#include "AE_EffectSuites.h"

#include <adobesdk/DrawbotSuite.h>

#include <atomic>
#include <array>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iomanip>
#include <limits>
#include <mutex>
#include <new>
#include <optional>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

namespace momentum {

namespace {

constexpr PF_OutFlags kMomentumBaseOutFlags =
  PF_OutFlag_WIDE_TIME_INPUT |
  PF_OutFlag_PIX_INDEPENDENT |
  PF_OutFlag_DEEP_COLOR_AWARE |
  PF_OutFlag_CUSTOM_UI |
  PF_OutFlag_NON_PARAM_VARY |
  PF_OutFlag_SEQUENCE_DATA_NEEDS_FLATTENING |
  PF_OutFlag_SEND_UPDATE_PARAMS_UI;

constexpr PF_OutFlags2 kMomentumBaseOutFlags2 =
  PF_OutFlag2_SUPPORTS_QUERY_DYNAMIC_FLAGS |
  PF_OutFlag2_FLOAT_COLOR_AWARE |
  PF_OutFlag2_SUPPORTS_SMART_RENDER |
  PF_OutFlag2_AUTOMATIC_WIDE_TIME_INPUT |
  PF_OutFlag2_I_MIX_GUID_DEPENDENCIES |
  PF_OutFlag2_SUPPORTS_GET_FLATTENED_SEQUENCE_DATA |
  PF_OutFlag2_SUPPORTS_THREADED_RENDERING |
  PF_OutFlag2_SUPPORTS_GPU_RENDER_F32;

static_assert(
  kMomentumBaseOutFlags == static_cast<PF_OutFlags>(MOMENTUM_EFFECT_OUT_FLAGS),
  "C++ and PiPL out_flags contract diverged"
);
static_assert(
  kMomentumBaseOutFlags2 == static_cast<PF_OutFlags2>(MOMENTUM_EFFECT_OUT_FLAGS2),
  "C++ and PiPL out_flags2 contract diverged"
);
static_assert(
  MOMENTUM_VERSION_PIPL == PF_VERSION(
    MOMENTUM_VERSION_MAJOR,
    MOMENTUM_VERSION_MINOR,
    MOMENTUM_VERSION_BUG,
    MOMENTUM_VERSION_STAGE,
    MOMENTUM_VERSION_BUILD
  ),
  "C++ and PiPL effect versions diverged"
);

// AE does not reliably hot-refresh float slider valid bounds per effect instance.
// Keep the hard valid range static and wide, then use slider_min/max plus plugin
// clamp/snap logic for per-controller semantics.
constexpr double kStaticSliderValidMin = -1000000.0;
constexpr double kStaticSliderValidMax = 1000000.0;
constexpr PF_Precision kControllerSliderPrecision = PF_Precision_HUNDREDTHS;
constexpr int kStaticSelectControllerChoiceCount = 32;

using runtime_internal::ResolveEffectRuntimeKey;

AEGP_PluginID gAegpPluginId = 0;

bool IsControllerParamIndex(PF_ParamIndex paramIndex);
A_long LookupSyncedRevision(PF_InData* in_data, PF_ParamDef* params[] = NULL);
void RegisterSyncedRevision(PF_InData* in_data, PF_ParamDef* params[], A_long revision);
std::string LookupSyncedControllerHash(PF_InData* in_data, PF_ParamDef* params[] = NULL);
void RegisterSyncedControllerHash(
  PF_InData* in_data,
  PF_ParamDef* params[],
  const std::string& controllerHash
);
A_long ReadSequenceSyncedRevision(PF_InData* in_data, PF_Handle handle);
bool WriteSequenceSyncedRevision(PF_InData* in_data, PF_Handle handle, A_long revision);
PF_Err SyncControllerParamValuesFromBundle(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  const RuntimeSketchBundle& bundle,
  const char* reason
);

std::uint64_t RegisterControllerInteractionChange(A_long instanceId);
std::uint64_t ReadControllerInteractionGeneration(A_long instanceId);

std::uint64_t LookupRegisteredInstanceId(PF_InData* in_data) {
  return GetEffectSessionInstanceId(ResolveEffectRuntimeKey(in_data));
}

void RegisterStableInstanceId(PF_InData* in_data, std::uint64_t instanceId) {
  const auto runtimeKey = ResolveEffectRuntimeKey(in_data);
  SetEffectSessionInstanceId(runtimeKey, instanceId);
}

A_long LookupSyncedRevision(PF_InData* in_data, PF_ParamDef* params[]) {
  (void)params;

  if (in_data && in_data->sequence_data) {
    const A_long sequenceRevision =
      ReadSequenceSyncedRevision(in_data, in_data->sequence_data);
    if (sequenceRevision >= 0) {
      return sequenceRevision;
    }
  }

  const auto runtimeKey = ResolveEffectRuntimeKey(in_data);
  return GetEffectSessionSyncedRevision(runtimeKey);
}

void RegisterSyncedRevision(PF_InData* in_data, PF_ParamDef* params[], A_long revision) {
  (void)params;

  if (in_data && in_data->sequence_data) {
    WriteSequenceSyncedRevision(in_data, in_data->sequence_data, revision);
  }

  const auto runtimeKey = ResolveEffectRuntimeKey(in_data);
  SetEffectSessionSyncedRevision(runtimeKey, revision);
}

std::string LookupSyncedControllerHash(PF_InData* in_data, PF_ParamDef* params[]) {
  (void)params;

  const auto runtimeKey = ResolveEffectRuntimeKey(in_data);
  return GetEffectSessionControllerHash(runtimeKey);
}

void RegisterSyncedControllerHash(
  PF_InData* in_data,
  PF_ParamDef* params[],
  const std::string& controllerHash
) {
  (void)params;

  const auto runtimeKey = ResolveEffectRuntimeKey(in_data);
  SetEffectSessionControllerHash(runtimeKey, controllerHash);
}

void DiscardEffectRuntimeState(
  runtime_internal::EffectRuntimeKey runtimeKey,
  const char* reason
) {
  if (!runtimeKey) {
    return;
  }
  ClearCachedSketchByKey(runtimeKey, reason);
}

std::uint64_t ResolveRenderLineageIdentity(PF_InData* in_data, A_long instanceId) {
  std::uint64_t hash = 1469598103934665603ULL;
  auto mix = [&](std::uint64_t value) {
    for (int byteIndex = 0; byteIndex < 8; ++byteIndex) {
      hash ^= static_cast<std::uint8_t>((value >> (byteIndex * 8)) & 0xffU);
      hash *= 1099511628211ULL;
    }
  };
  // AE's render-callback reference is not a stable Effect identity and may
  // change every frame, especially with threaded Smart Render. The live
  // Sequence token is process-local and is rebound on Setup/Resetup, which
  // keeps evaluator lanes reusable and duplicated Effects independent.
  mix(static_cast<std::uint64_t>(ResolveEffectRuntimeKey(in_data)));
  mix(static_cast<std::uint64_t>(static_cast<A_u_long>(instanceId)));
  return hash ? hash : 1ULL;
}

long TimeValueToSketchFrame(
  A_long timeValue,
  A_u_long timeScale,
  double frameRate
) {
  if (!(frameRate > 0.0) || timeScale == 0) {
    return 0;
  }

  const double timeSeconds =
    static_cast<double>(timeValue) / static_cast<double>(timeScale);
  return std::max<long>(
    0,
    static_cast<long>(std::floor(timeSeconds * frameRate)) + 1L
  );
}

long ResolveControllerHistoryStartFrame(
  PF_InData* in_data,
  PF_ParamIndex paramIndex
) {
  if (!in_data || paramIndex <= 0) {
    return 0;
  }

  const double frameRate = ResolveSketchSimulationFrameRate(
    in_data
  );
  if (!(frameRate > 0.0)) {
    return 0;
  }

  AEFX_SuiteScoper<PF_ParamUtilsSuite3> paramUtilsSuite(
    in_data,
    kPFParamUtilsSuite,
    kPFParamUtilsSuiteVersion3,
    NULL
  );
  if (!paramUtilsSuite.get()) {
    return 0;
  }

  PF_Boolean foundPreviousKey = FALSE;
  PF_KeyIndex previousKeyIndex = PF_KeyIndex_NONE;
  A_long previousKeyTime = 0;
  A_u_long previousKeyTimeScale = in_data->time_scale;
  const PF_Err findErr = paramUtilsSuite->PF_FindKeyframeTime(
    in_data->effect_ref,
    paramIndex,
    in_data->current_time,
    in_data->time_scale,
    PF_TimeDir_LESS_THAN,
    &foundPreviousKey,
    &previousKeyIndex,
    &previousKeyTime,
    &previousKeyTimeScale
  );
  if (findErr != PF_Err_NONE || !foundPreviousKey) {
    return 0;
  }

  if (previousKeyTime <= 0) {
    return 0;
  }
  return TimeValueToSketchFrame(previousKeyTime, previousKeyTimeScale, frameRate);
}

void MarkControllerParamHistoryDirty(
  PF_InData* in_data,
  PF_ParamIndex paramIndex,
  const char* reason,
  A_long explicitInstanceId = 0
) {
  if (!IsControllerParamIndex(paramIndex)) {
    return;
  }
  const long historyStartFrame =
    ResolveControllerHistoryStartFrame(in_data, paramIndex);
  const A_long instanceId = explicitInstanceId > 0
    ? explicitInstanceId
    : static_cast<A_long>(LookupRegisteredInstanceId(in_data));
  const std::uint64_t interactionGeneration =
    RegisterControllerInteractionChange(instanceId);
  InvalidateEffectPersistentRenderCaches(
    ResolveRenderLineageIdentity(in_data, instanceId),
    reason
  );
  // Rendering owns an immutable controller timeline captured by PreRender, so
  // UI changes never mutate or invalidate an unrelated render runtime. This
  // event is retained as a diagnostic and AE rerender request only.
  runtime_internal::AppendEffectRuntimeDiagnostic(
    in_data,
    "controller-history-dirty",
    instanceId,
    paramIndex,
    historyStartFrame,
    (reason ? std::string(reason) : std::string()) +
      " interactionGeneration=" + std::to_string(interactionGeneration)
  );
}

PF_LRect IntersectLongRect(const PF_LRect& a, const PF_LRect& b) {
  PF_LRect result{};
  result.left = std::max(a.left, b.left);
  result.top = std::max(a.top, b.top);
  result.right = std::min(a.right, b.right);
  result.bottom = std::min(a.bottom, b.bottom);
  if (result.right < result.left) {
    result.right = result.left;
  }
  if (result.bottom < result.top) {
    result.bottom = result.top;
  }
  return result;
}

double ResolveDownsampleScale(const PF_RationalScale& scale) {
  if (scale.num <= 0 || scale.den <= 0) {
    return 1.0;
  }
  return static_cast<double>(scale.num) / static_cast<double>(scale.den);
}

A_long ScaleRenderDimension(A_long logicalSize, double scale) {
  return std::max<A_long>(
    1,
    static_cast<A_long>(std::floor(static_cast<double>(std::max<A_long>(1, logicalSize)) * scale))
  );
}

struct RenderInvocationInfo;

void ApplyMomentumOutFlags(PF_OutData* out_data) {
  if (!out_data) {
    return;
  }
  out_data->out_flags = kMomentumBaseOutFlags;
  out_data->out_flags2 = kMomentumBaseOutFlags2;
}

struct RenderInvocationInfo {
  // The invocation owns immutable PreRender inputs. Mutable evaluator/canvas
  // state lives in one shared persistent frame lane derived from the stable
  // live Sequence session + transport id. CPU and GPU are only executors.
  std::uintptr_t runtimeKey = 0;
  std::uint64_t lineageIdentity = 0;
  std::uintptr_t preparationCacheKey = 0;
  std::uintptr_t renderCacheKey = 0;
  A_long revision = 0;
  A_long instanceId = 0;
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

struct ControllerRenderRequestState {
  std::string controllerHash;
  std::uint64_t generation = 0;
};

struct ControllerInteractionState {
  std::uint64_t generation = 0;
};

std::mutex gControllerRenderRequestMutex;
std::unordered_map<std::uint64_t, ControllerRenderRequestState> gControllerRenderRequests;
std::atomic<std::uint64_t> gNextControllerRenderGeneration{1};
std::mutex gControllerInteractionMutex;
std::unordered_map<A_long, ControllerInteractionState> gControllerInteractionStates;
std::atomic<std::uint64_t> gNextControllerInteractionGeneration{1};

std::uint64_t RegisterControllerInteractionChange(A_long instanceId) {
  if (instanceId <= 0) {
    return 0;
  }
  const std::uint64_t generation =
    gNextControllerInteractionGeneration.fetch_add(1, std::memory_order_relaxed);
  std::lock_guard<std::mutex> lock(gControllerInteractionMutex);
  gControllerInteractionStates[instanceId].generation = generation;
  if (gControllerInteractionStates.size() > 2048) {
    for (auto it = gControllerInteractionStates.begin();
         it != gControllerInteractionStates.end() &&
           gControllerInteractionStates.size() > 1024;) {
      if (it->first == instanceId) {
        ++it;
      } else {
        it = gControllerInteractionStates.erase(it);
      }
    }
  }
  return generation;
}

std::uint64_t ReadControllerInteractionGeneration(A_long instanceId) {
  if (instanceId <= 0) {
    return 0;
  }
  std::lock_guard<std::mutex> lock(gControllerInteractionMutex);
  const auto it = gControllerInteractionStates.find(instanceId);
  return it == gControllerInteractionStates.end() ? 0 : it->second.generation;
}

void DiscardControllerInteractionState(A_long instanceId) {
  if (instanceId <= 0) {
    return;
  }
  std::lock_guard<std::mutex> lock(gControllerInteractionMutex);
  gControllerInteractionStates.erase(instanceId);
}

std::uint64_t BuildControllerRenderRequestKey(
  std::uint64_t lineageIdentity,
  long targetFrame
) {
  std::uint64_t hash = lineageIdentity ? lineageIdentity : 1469598103934665603ULL;
  const std::uint64_t frameBits = static_cast<std::uint64_t>(targetFrame);
  for (int byteIndex = 0; byteIndex < 8; ++byteIndex) {
    hash ^= static_cast<std::uint8_t>((frameBits >> (byteIndex * 8)) & 0xffU);
    hash *= 1099511628211ULL;
  }
  return hash ? hash : 1ULL;
}

std::uint64_t RegisterControllerRenderRequest(
  std::uint64_t lineageIdentity,
  long targetFrame,
  const std::string& controllerHash
) {
  const std::uint64_t requestKey =
    BuildControllerRenderRequestKey(lineageIdentity, targetFrame);
  std::lock_guard<std::mutex> lock(gControllerRenderRequestMutex);
  ControllerRenderRequestState& state = gControllerRenderRequests[requestKey];
  if (state.generation != 0 && state.controllerHash == controllerHash) {
    return state.generation;
  }
  state.controllerHash = controllerHash;
  state.generation = gNextControllerRenderGeneration.fetch_add(1);
  const std::uint64_t generation = state.generation;
  if (gControllerRenderRequests.size() > 2048) {
    for (auto it = gControllerRenderRequests.begin();
         it != gControllerRenderRequests.end() && gControllerRenderRequests.size() > 1024;) {
      if (it->first == requestKey) {
        ++it;
      } else {
        it = gControllerRenderRequests.erase(it);
      }
    }
  }
  return generation;
}

bool IsCurrentControllerRenderRequest(const RenderInvocationInfo& invocation) {
  if (invocation.controllerRequestGeneration == 0) {
    return true;
  }
  const std::uint64_t requestKey = BuildControllerRenderRequestKey(
    invocation.lineageIdentity,
    invocation.controllerTimelineTargetFrame
  );
  std::lock_guard<std::mutex> lock(gControllerRenderRequestMutex);
  const auto it = gControllerRenderRequests.find(requestKey);
  return it == gControllerRenderRequests.end() ||
    (it->second.generation == invocation.controllerRequestGeneration &&
      it->second.controllerHash == invocation.controllerTimelineHash);
}

bool IsLatestControllerInteraction(const RenderInvocationInfo& invocation) {
  if (invocation.instanceId <= 0) {
    return true;
  }
  return ReadControllerInteractionGeneration(invocation.instanceId) ==
    invocation.controllerInteractionGeneration;
}

double ElapsedMilliseconds(std::chrono::steady_clock::time_point start) {
  return std::chrono::duration<double, std::milli>(
    std::chrono::steady_clock::now() - start
  ).count();
}

std::uintptr_t NextRenderInvocationRuntimeKey() {
  // Sequence session tokens are odd. Keep render invocation keys even so the
  // two namespaces cannot alias in the process-local runtime registry.
  static std::atomic<std::uintptr_t> nextKey{2};
  std::uintptr_t key = nextKey.fetch_add(2, std::memory_order_relaxed);
  if (key == 0) {
    key = nextKey.fetch_add(2, std::memory_order_relaxed);
  }
  return key;
}

class ScopedRenderRuntime final {
 public:
  ScopedRenderRuntime()
    : key_(NextRenderInvocationRuntimeKey()) {}

  ~ScopedRenderRuntime() {
    DiscardEffectRuntimeState(key_, "legacy-render-dispose");
  }

  std::uintptr_t key() const { return key_; }

 private:
  std::uintptr_t key_ = 0;
};

bool TryMapSliderParamIndexToSlot(PF_ParamIndex paramIndex, int* outSlot);
bool TryMapAngleParamIndexToSlot(PF_ParamIndex paramIndex, int* outSlot);
bool TryMapAngleValueParamIndexToSlot(PF_ParamIndex paramIndex, int* outSlot);
bool TryMapAngleUiParamIndexToSlot(PF_ParamIndex paramIndex, int* outSlot);
bool TryMapColorParamIndexToSlot(PF_ParamIndex paramIndex, int* outSlot);
DRAWBOT_ColorRGBA MakeCustomUiColor(float red, float green, float blue, float alpha);

RuntimeSketchBundle ReadEffectRuntimeSketchBundle(
  PF_InData* in_data,
  PF_ParamDef* params[],
  std::string* errorMessage
) {
  A_long instanceId = 0;
  if (params && params[PARAM_INSTANCE_ID]) {
    instanceId = params[PARAM_INSTANCE_ID]->u.sd.value;
  }
  return runtime_internal::ReadRuntimeSketchBundleForEffect(in_data, instanceId, errorMessage);
}

PF_Err SyncSequenceRuntimeSnapshotFromLocalFiles(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[]
);

constexpr A_short kAngleControlUiWidth = 112;
constexpr A_short kAngleControlUiHeight = 60;
constexpr float kAngleControlRingStrokeWidth = 1.75f;
constexpr float kAngleControlIndicatorStrokeWidth = kAngleControlRingStrokeWidth;
constexpr float kAngleControlPadding = 6.0f;
constexpr float kAngleControlValueHeight = 18.0f;
constexpr float kAngleControlValueGap = 6.0f;
constexpr float kAngleControlFieldGap = 6.0f;
constexpr double kAngleControlScrubActivationDistance = 4.0;
constexpr double kAngleControlTurnsPixelsPerTurn = 28.0;
constexpr double kAngleControlDegreesPerPixel = 0.5;
constexpr PF_ParamUIFlags kAngleControlUiFlags = PF_PUI_CONTROL;
constexpr bool kDebugExposeAllControllerParams = false;
constexpr A_short kColorControlUiWidth = 96;
constexpr A_short kColorControlUiHeight = 18;
constexpr float kColorControlSwatchHeight = 14.0f;
constexpr float kColorControlSwatchWidth = 90.0f;
constexpr float kColorControlSwatchMargin = 6.0f;
constexpr PF_ParamUIFlags kColorControlUiFlags = PF_PUI_TOPIC;
char gColorArbRefconTag = 0;
constexpr A_u_long kColorArbPrintBufferSize = 128;

double WrapAngleUiDegrees(double degrees) {
  double wrapped = std::fmod(degrees, 360.0);
  if (wrapped < 0.0) {
    wrapped += 360.0;
  }
  return wrapped;
}

double NormalizeAngleUiDelta(double deltaDegrees) {
  while (deltaDegrees > 180.0) {
    deltaDegrees -= 360.0;
  }
  while (deltaDegrees < -180.0) {
    deltaDegrees += 360.0;
  }
  return deltaDegrees;
}

enum class AngleUiDragTarget {
  kNone = 0,
  kKnob = 1,
  kTurnsText = 2,
  kDegreesText = 3,
};

struct AngleUiLayout {
  DRAWBOT_RectF32 bounds = {0.0f, 0.0f, 0.0f, 0.0f};
  DRAWBOT_RectF32 valueRect = {0.0f, 0.0f, 0.0f, 0.0f};
  DRAWBOT_RectF32 turnsRect = {0.0f, 0.0f, 0.0f, 0.0f};
  DRAWBOT_RectF32 degreesRect = {0.0f, 0.0f, 0.0f, 0.0f};
  DRAWBOT_PointF32 knobCenter = {0.0f, 0.0f};
  float knobRadius = 0.0f;
};

double SanitizeAngleUiDegrees(double degrees) {
  return (std::isfinite(degrees) && !std::isnan(degrees)) ? degrees : 0.0;
}

void SplitAngleUiDegrees(double totalDegrees, int* outTurns, double* outCycleDegrees) {
  const double safeDegrees = SanitizeAngleUiDegrees(totalDegrees);
  int turns = static_cast<int>(std::trunc(safeDegrees / 360.0));
  double cycleDegrees = safeDegrees - (static_cast<double>(turns) * 360.0);
  if (cycleDegrees >= 360.0) {
    cycleDegrees -= 360.0;
    turns += 1;
  } else if (cycleDegrees <= -360.0) {
    cycleDegrees += 360.0;
    turns -= 1;
  }
  if (std::fabs(cycleDegrees) < 1e-6) {
    cycleDegrees = 0.0;
  }
  if (outTurns) {
    *outTurns = turns;
  }
  if (outCycleDegrees) {
    *outCycleDegrees = cycleDegrees;
  }
}

double ComposeAngleUiDegrees(int turns, double cycleDegrees) {
  double safeCycleDegrees = SanitizeAngleUiDegrees(cycleDegrees);
  while (safeCycleDegrees >= 360.0) {
    safeCycleDegrees -= 360.0;
    turns += 1;
  }
  while (safeCycleDegrees <= -360.0) {
    safeCycleDegrees += 360.0;
    turns -= 1;
  }
  if (std::fabs(safeCycleDegrees) < 1e-6) {
    safeCycleDegrees = 0.0;
  }
  return (static_cast<double>(turns) * 360.0) + safeCycleDegrees;
}

std::string FormatAngleUiTurnsOnlyText(int turns) {
  return std::to_string(turns);
}

std::string FormatAngleUiDegreesOnlyText(double degrees) {
  std::ostringstream stream;
  stream << std::fixed << std::setprecision(1) << SanitizeAngleUiDegrees(degrees) << "\xC2\xB0";
  return stream.str();
}

std::string FormatAngleUiSignedDegreesText(double degrees) {
  const double safeDegrees = SanitizeAngleUiDegrees(degrees);
  if (safeDegrees < 0.0) {
    return FormatAngleUiDegreesOnlyText(safeDegrees);
  }
  return std::string("+") + FormatAngleUiDegreesOnlyText(safeDegrees);
}

bool PointInAngleUiRect(const DRAWBOT_RectF32& rect, const PF_Point& point) {
  const float x = static_cast<float>(point.h);
  const float y = static_cast<float>(point.v);
  return rect.width > 0.0f &&
         rect.height > 0.0f &&
         x >= rect.left &&
         x <= (rect.left + rect.width) &&
         y >= rect.top &&
         y <= (rect.top + rect.height);
}

bool TryResolveAngleUiSlot(
  const RuntimeSketchBundle& bundle,
  PF_ParamIndex paramIndex,
  int* outSlot
) {
  int logicalSlot = -1;
  if (!TryMapAngleParamIndexToSlot(paramIndex, &logicalSlot)) {
    return false;
  }
  if (ResolveControllerSlotKind(bundle, logicalSlot) != RuntimeControllerSlotKind::kAngle) {
    return false;
  }
  if (outSlot) {
    *outSlot = logicalSlot;
  }
  return true;
}

bool TryResolveColorUiSlot(
  const RuntimeSketchBundle& bundle,
  PF_ParamIndex paramIndex,
  int* outSlot
) {
  int logicalSlot = -1;
  if (!TryMapColorParamIndexToSlot(paramIndex, &logicalSlot)) {
    return false;
  }
  if (ResolveControllerSlotKind(bundle, logicalSlot) != RuntimeControllerSlotKind::kColor) {
    return false;
  }
  if (outSlot) {
    *outSlot = logicalSlot;
  }
  return true;
}

bool IsColorControllerEffectArea(PF_EventExtra* extra) {
  if (!extra || !extra->contextH || (*extra->contextH)->w_type != PF_Window_EFFECT) {
    return false;
  }
  return extra->effect_win.area == PF_EA_PARAM_TITLE || extra->effect_win.area == PF_EA_CONTROL;
}

PF_UnionableRect ResolveColorControllerFrame(PF_EventExtra* extra) {
  PF_UnionableRect frame{};
  if (!extra) {
    return frame;
  }

  const PF_UnionableRect currentFrame = extra->effect_win.current_frame;
  const PF_UnionableRect titleFrame = extra->effect_win.param_title_frame;
  const A_long currentWidth = currentFrame.right - currentFrame.left;
  const A_long currentHeight = currentFrame.bottom - currentFrame.top;
  const A_long titleWidth = titleFrame.right - titleFrame.left;
  const A_long titleHeight = titleFrame.bottom - titleFrame.top;

  if (extra->effect_win.area == PF_EA_PARAM_TITLE && titleWidth > 0 && titleHeight > 0) {
    return titleFrame;
  }
  if (currentWidth > 0 && currentHeight > 0) {
    return currentFrame;
  }
  if (titleWidth > 0 && titleHeight > 0) {
    return titleFrame;
  }
  return currentFrame;
}

DRAWBOT_RectF32 ComputeColorControllerSwatchRect(PF_EventExtra* extra) {
  DRAWBOT_RectF32 swatchRect = {0.0f, 0.0f, 0.0f, 0.0f};
  if (!extra) {
    return swatchRect;
  }

  const PF_UnionableRect frame = ResolveColorControllerFrame(extra);
  const float left = static_cast<float>(frame.left);
  const float top = static_cast<float>(frame.top);
  const float width = std::max(0.0f, static_cast<float>(frame.right - frame.left));
  const float height = std::max(0.0f, static_cast<float>(frame.bottom - frame.top));
  if (width <= 0.0f || height <= 0.0f) {
    return swatchRect;
  }

  const float swatchHeight = std::max(10.0f, std::min(kColorControlSwatchHeight, height - 4.0f));
  const float swatchWidth = std::max(
    swatchHeight + 8.0f,
    std::min(kColorControlSwatchWidth, std::max(10.0f, width - (kColorControlSwatchMargin * 2.0f)))
  );
  const float right = left + width - kColorControlSwatchMargin;
  const float swatchLeft = std::max(left + 1.0f, right - swatchWidth);
  const float swatchTop = top + std::max(1.0f, (height - swatchHeight) * 0.5f);
  swatchRect.left = swatchLeft;
  swatchRect.top = swatchTop;
  swatchRect.width = std::max(0.0f, std::min(swatchWidth, (left + width) - swatchLeft - 1.0f));
  swatchRect.height = std::max(0.0f, std::min(swatchHeight, (top + height) - swatchTop - 1.0f));
  return swatchRect;
}

bool HitTestColorControllerSwatch(PF_EventExtra* extra, const PF_Point& mousePoint) {
  const DRAWBOT_RectF32 swatchRect = ComputeColorControllerSwatchRect(extra);
  if (swatchRect.width <= 0.0f || swatchRect.height <= 0.0f) {
    return false;
  }

  const float mouseX = static_cast<float>(mousePoint.h);
  const float mouseY = static_cast<float>(mousePoint.v);
  return mouseX >= swatchRect.left &&
         mouseX <= (swatchRect.left + swatchRect.width) &&
         mouseY >= swatchRect.top &&
         mouseY <= (swatchRect.top + swatchRect.height);
}

AngleUiLayout ComputeAngleUiLayout(const PF_UnionableRect& frame) {
  AngleUiLayout layout;
  const float left = static_cast<float>(frame.left) + 0.5f;
  const float top = static_cast<float>(frame.top) + 0.5f;
  const float width = std::max(0.0f, static_cast<float>(frame.right - frame.left));
  const float height = std::max(0.0f, static_cast<float>(frame.bottom - frame.top));
  layout.bounds = {left, top, width, height};
  if (width <= 0.0f || height <= 0.0f) {
    return layout;
  }

  const float valueHeight = std::max(16.0f, std::min(kAngleControlValueHeight, height - (kAngleControlPadding * 2.0f)));
  const float knobDiameter = std::max(
    20.0f,
    std::min(width - (kAngleControlPadding * 2.0f), height - (kAngleControlPadding * 2.0f) - valueHeight - kAngleControlValueGap)
  );
  layout.valueRect = {
    left + kAngleControlPadding,
    top + kAngleControlPadding,
    std::max(24.0f, width - (kAngleControlPadding * 2.0f)),
    valueHeight
  };
  const float turnsWidth = std::max(
    20.0f,
    std::min(32.0f, layout.valueRect.width * 0.24f)
  );
  const float degreesWidth = std::max(
    40.0f,
    std::min(60.0f, layout.valueRect.width * 0.46f)
  );
  const float totalTextWidth =
    std::min(layout.valueRect.width, turnsWidth + kAngleControlFieldGap + degreesWidth);
  const float textLeft =
    layout.valueRect.left + std::max(0.0f, (layout.valueRect.width - totalTextWidth) * 0.5f);
  layout.turnsRect = {
    textLeft,
    layout.valueRect.top,
    turnsWidth,
    layout.valueRect.height
  };
  layout.degreesRect = {
    layout.turnsRect.left + layout.turnsRect.width + kAngleControlFieldGap,
    layout.valueRect.top,
    std::max(24.0f, std::min(degreesWidth, (layout.valueRect.left + layout.valueRect.width) -
      (layout.turnsRect.left + layout.turnsRect.width + kAngleControlFieldGap))),
    layout.valueRect.height
  };

  const float knobTop = layout.valueRect.top + layout.valueRect.height + kAngleControlValueGap;
  layout.knobRadius = std::max(9.0f, (knobDiameter * 0.5f) - 1.0f);
  layout.knobCenter.x = left + (width * 0.5f);
  layout.knobCenter.y = knobTop + (knobDiameter * 0.5f);
  return layout;
}

bool TryComputeAngleUiPointerDegrees(
  const AngleUiLayout& layout,
  const PF_Point& mousePoint,
  double* outDegrees
) {
  if (!outDegrees || layout.knobRadius <= 0.0f) {
    return false;
  }
  const double centerX = static_cast<double>(layout.knobCenter.x);
  const double centerY = static_cast<double>(layout.knobCenter.y);
  const double dx = static_cast<double>(mousePoint.h) - centerX;
  const double dy = static_cast<double>(mousePoint.v) - centerY;
  if (std::fabs(dx) < 1e-6 && std::fabs(dy) < 1e-6) {
    return false;
  }
  *outDegrees = WrapAngleUiDegrees((std::atan2(dy, dx) * (180.0 / M_PI)) + 90.0);
  return true;
}

AngleUiDragTarget ResolveAngleUiHitTarget(
  const AngleUiLayout& layout,
  const PF_Point& mousePoint
) {
  if (PointInAngleUiRect(layout.turnsRect, mousePoint)) {
    return AngleUiDragTarget::kTurnsText;
  }
  if (PointInAngleUiRect(layout.degreesRect, mousePoint)) {
    return AngleUiDragTarget::kDegreesText;
  }

  const double dx = static_cast<double>(mousePoint.h) - static_cast<double>(layout.knobCenter.x);
  const double dy = static_cast<double>(mousePoint.v) - static_cast<double>(layout.knobCenter.y);
  const double distanceSquared = (dx * dx) + (dy * dy);
  const double hitRadius = static_cast<double>(layout.knobRadius) + 8.0;
  if (distanceSquared <= (hitRadius * hitRadius)) {
    return AngleUiDragTarget::kKnob;
  }
  return AngleUiDragTarget::kNone;
}

std::vector<DRAWBOT_UTF16Char> MakeDrawbotUtf16String(const std::string& text) {
  std::vector<DRAWBOT_UTF16Char> utf16;
  utf16.reserve(text.size() + 1);
  for (std::size_t index = 0; index < text.size(); ++index) {
    const unsigned char byte = static_cast<unsigned char>(text[index]);
    if (byte == 0xC2 && (index + 1) < text.size() &&
        static_cast<unsigned char>(text[index + 1]) == 0xB0) {
      utf16.push_back(static_cast<DRAWBOT_UTF16Char>(0x00B0));
      index += 1;
      continue;
    }
    utf16.push_back(static_cast<DRAWBOT_UTF16Char>(
      byte
    ));
  }
  utf16.push_back(0);
  return utf16;
}

A_intptr_t EncodeAngleUiDoubleValue(double value, bool valid) {
  if (!valid) {
    return 0;
  }
  return static_cast<A_intptr_t>(std::llround(value * 1000.0)) + 1;
}

bool DecodeAngleUiDoubleValue(A_intptr_t encoded, double* outValue) {
  if (encoded == 0 || !outValue) {
    return false;
  }
  *outValue = static_cast<double>(encoded - 1) / 1000.0;
  return true;
}

AngleUiDragTarget DecodeAngleUiDragTarget(A_intptr_t encoded) {
  switch (static_cast<int>(encoded)) {
    case 1: return AngleUiDragTarget::kKnob;
    case 2: return AngleUiDragTarget::kTurnsText;
    case 3: return AngleUiDragTarget::kDegreesText;
    default: return AngleUiDragTarget::kNone;
  }
}

void ClearAngleUiDragState(PF_EventExtra* extra) {
  if (!extra) {
    return;
  }
  extra->u.do_click.send_drag = FALSE;
  extra->u.do_click.continue_refcon[0] = 0;
  extra->u.do_click.continue_refcon[1] = 0;
  extra->u.do_click.continue_refcon[2] = 0;
  extra->u.do_click.continue_refcon[3] = 0;
}

void UpdateAngleUiDragState(
  PF_EventExtra* extra,
  int slot,
  AngleUiDragTarget dragTarget,
  double trackedValue,
  bool hasTrackedValue,
  double anchorDegrees,
  bool hasAnchorDegrees,
  bool isDragCallback
) {
  if (!extra) {
    return;
  }
  // AE defines last_time only for PF_Event_DRAG. Reading it during the
  // initiating PF_Event_DO_CLICK observes unspecified data and can cancel the
  // drag before AE has a chance to send the first drag callback.
  if (isDragCallback && extra->u.do_click.last_time) {
    ClearAngleUiDragState(extra);
    return;
  }
  extra->u.do_click.send_drag = TRUE;
  extra->u.do_click.continue_refcon[0] = slot + 1;
  extra->u.do_click.continue_refcon[1] = static_cast<A_intptr_t>(dragTarget);
  extra->u.do_click.continue_refcon[2] =
    EncodeAngleUiDoubleValue(trackedValue, hasTrackedValue);
  extra->u.do_click.continue_refcon[3] =
    EncodeAngleUiDoubleValue(anchorDegrees, hasAnchorDegrees);
}

std::uint64_t ResolveStableInstanceId(PF_InData* in_data, A_long paramInstanceId = 0);

PF_Fixed DoubleToFixed(double value) {
  return static_cast<PF_Fixed>(value * 65536.0);
}

A_Err EnsureRegisteredWithAEGP(PF_InData* in_data) {
  if (gAegpPluginId != 0) {
    return A_Err_NONE;
  }

  AEFX_SuiteScoper<AEGP_UtilitySuite6> utilitySuite(
    in_data,
    kAEGPUtilitySuite,
    kAEGPUtilitySuiteVersion6,
    NULL
  );
  if (!utilitySuite.get()) {
    return A_Err_GENERIC;
  }

  return utilitySuite->AEGP_RegisterWithAEGP(NULL, "Momentum", &gAegpPluginId);
}

std::string BuildStaticSelectControllerPopupItems() {
  std::ostringstream stream;
  for (int index = 0; index < kStaticSelectControllerChoiceCount; ++index) {
    if (index > 0) {
      stream << '|';
    }
    stream << "Option " << (index + 1);
  }
  return stream.str();
}

int ResolveAngleParamSlotForLogicalSlot(
  const RuntimeSketchBundle& bundle,
  int logicalSlot
) {
  if (logicalSlot < 0 || logicalSlot >= kControllerSlotCount) {
    return -1;
  }
  return ResolveControllerSlotKind(bundle, logicalSlot) == RuntimeControllerSlotKind::kAngle
    ? logicalSlot
    : -1;
}

int ResolveControllerParamSlotForLogicalSlot(
  const RuntimeSketchBundle& bundle,
  RuntimeControllerSlotKind kind,
  int logicalSlot
) {
  if (logicalSlot < 0 || logicalSlot >= kControllerSlotCount) {
    return -1;
  }
  return ResolveControllerSlotKind(bundle, logicalSlot) == kind ? logicalSlot : -1;
}

int ResolveLogicalSlotForControllerParamSlot(
  const RuntimeSketchBundle& bundle,
  RuntimeControllerSlotKind kind,
  int paramSlot
) {
  if (paramSlot < 0 || paramSlot >= kControllerSlotCount) {
    return -1;
  }
  return ResolveControllerSlotKind(bundle, paramSlot) == kind ? paramSlot : -1;
}

void CopyParamName(PF_ParamDef* def, const std::string& name) {
  if (!def) {
    return;
  }
  std::strncpy(def->PF_DEF_NAME, name.c_str(), PF_MAX_EFFECT_PARAM_NAME_LEN);
  def->PF_DEF_NAME[PF_MAX_EFFECT_PARAM_NAME_LEN] = '\0';
}

void ResolveSafeSliderUiRange(
  double minValue,
  double maxValue,
  PF_FpShort* outValidMin,
  PF_FpShort* outValidMax,
  PF_FpShort* outSliderMin,
  PF_FpShort* outSliderMax
) {
  double safeMin = std::isfinite(minValue) && !std::isnan(minValue) ? minValue : 0.0;
  double safeMax = std::isfinite(maxValue) && !std::isnan(maxValue) ? maxValue : 100.0;
  if (!(safeMax > safeMin)) {
    const double center = safeMin;
    safeMin = center - 1.0;
    safeMax = center + 1.0;
  }

  safeMin = std::max(kStaticSliderValidMin, std::min(kStaticSliderValidMax, safeMin));
  safeMax = std::max(kStaticSliderValidMin, std::min(kStaticSliderValidMax, safeMax));
  if (!(safeMax > safeMin)) {
    if (safeMin <= kStaticSliderValidMin) {
      safeMin = kStaticSliderValidMin;
      safeMax = std::min(kStaticSliderValidMax, kStaticSliderValidMin + 1.0);
    } else if (safeMax >= kStaticSliderValidMax) {
      safeMax = kStaticSliderValidMax;
      safeMin = std::max(kStaticSliderValidMin, kStaticSliderValidMax - 1.0);
    } else {
      safeMin = std::max(kStaticSliderValidMin, safeMin - 0.5);
      safeMax = std::min(kStaticSliderValidMax, safeMax + 0.5);
    }
  }

  if (outValidMin) *outValidMin = static_cast<PF_FpShort>(kStaticSliderValidMin);
  if (outValidMax) *outValidMax = static_cast<PF_FpShort>(kStaticSliderValidMax);
  if (outSliderMin) *outSliderMin = static_cast<PF_FpShort>(safeMin);
  if (outSliderMax) *outSliderMax = static_cast<PF_FpShort>(safeMax);
}

void ResolveAngleUiRange(
  PF_FpShort* outValidMin,
  PF_FpShort* outValidMax,
  PF_FpShort* outSliderMin,
  PF_FpShort* outSliderMax
) {
  if (outValidMin) *outValidMin = static_cast<PF_FpShort>(-100000.0);
  if (outValidMax) *outValidMax = static_cast<PF_FpShort>(100000.0);
  if (outSliderMin) *outSliderMin = static_cast<PF_FpShort>(-360.0);
  if (outSliderMax) *outSliderMax = static_cast<PF_FpShort>(360.0);
}

bool IsColorArbRefcon(void* refconPV) {
  return refconPV == &gColorArbRefconTag;
}

ControllerColorValue MakeUnsetColorValue() {
  ControllerColorValue color;
  color.a = -1.0;
  return color;
}

bool IsUnsetColorValue(const ControllerColorValue& color) {
  return std::isfinite(color.a) && !std::isnan(color.a) && color.a < 0.0;
}

ControllerColorValue SanitizeColorValue(const ControllerColorValue& color) {
  if (IsUnsetColorValue(color)) {
    return MakeUnsetColorValue();
  }
  ControllerColorValue safe = color;
  if (!std::isfinite(safe.r) || std::isnan(safe.r)) safe.r = 1.0;
  if (!std::isfinite(safe.g) || std::isnan(safe.g)) safe.g = 1.0;
  if (!std::isfinite(safe.b) || std::isnan(safe.b)) safe.b = 1.0;
  if (!std::isfinite(safe.a) || std::isnan(safe.a)) safe.a = 1.0;
  return safe;
}

PF_Err AllocateColorArbHandle(
  PF_InData* in_data,
  const ControllerColorValue& color,
  PF_ArbitraryH* outHandle
) {
  if (!in_data || !outHandle) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  PF_Handle handle = PF_NEW_HANDLE(sizeof(ControllerColorValue));
  if (!handle) {
    return PF_Err_OUT_OF_MEMORY;
  }
  ControllerColorValue* data =
    reinterpret_cast<ControllerColorValue*>(PF_LOCK_HANDLE(handle));
  if (!data) {
    PF_DISPOSE_HANDLE(handle);
    return PF_Err_OUT_OF_MEMORY;
  }
  *data = SanitizeColorValue(color);
  PF_UNLOCK_HANDLE(handle);
  *outHandle = handle;
  return PF_Err_NONE;
}

ControllerColorValue ReadColorArbHandle(PF_InData* in_data, PF_ArbitraryH arbH) {
  ControllerColorValue color = MakeUnsetColorValue();
  if (!in_data || !arbH) {
    return color;
  }
  ControllerColorValue* data =
    reinterpret_cast<ControllerColorValue*>(PF_LOCK_HANDLE(arbH));
  if (!data) {
    return color;
  }
  color = SanitizeColorValue(*data);
  PF_UNLOCK_HANDLE(arbH);
  return color;
}

ControllerColorValue ResolveColorControllerValueFromParams(
  PF_InData* in_data,
  PF_ParamDef* params[],
  int slot
) {
  if (!params || slot < 0 || slot >= kControllerSlotCount) {
    return ControllerColorValue();
  }
  std::string bundleError;
  const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, params, &bundleError);
  const int colorParamSlot = ResolveControllerParamSlotForLogicalSlot(
    bundle,
    RuntimeControllerSlotKind::kColor,
    slot
  );
  if (colorParamSlot < 0 || colorParamSlot >= kControllerSlotCount) {
    return ControllerColorValue();
  }
  PF_ParamDef* colorParam = params[ControllerColorValueParamIndex(colorParamSlot)];
  if (!colorParam) {
    return ControllerColorValue();
  }
  const ControllerColorValue storedColor =
    ReadColorArbHandle(in_data, colorParam->u.arb_d.value);
  if (IsUnsetColorValue(storedColor)) {
    return ResolveColorControllerSpecWithDefaults(bundle, slot).defaultValue;
  }
  return storedColor;
}

void WriteAngleControllerValueToParams(
  PF_ParamDef* params[],
  int angleParamSlot,
  double degrees
) {
  if (!params || angleParamSlot < 0 || angleParamSlot >= kControllerSlotCount) {
    return;
  }
  PF_ParamDef* angleParam = params[ControllerAngleValueParamIndex(angleParamSlot)];
  if (!angleParam) {
    return;
  }
  angleParam->u.fs_d.value = static_cast<PF_FpLong>(degrees);
  angleParam->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
}

void WriteColorControllerValueToParams(
  PF_InData* in_data,
  PF_ParamDef* params[],
  int slot,
  const ControllerColorValue& color
) {
  if (!in_data || !params || slot < 0 || slot >= kControllerSlotCount) {
    return;
  }
  std::string bundleError;
  const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, params, &bundleError);
  const int colorParamSlot = ResolveControllerParamSlotForLogicalSlot(
    bundle,
    RuntimeControllerSlotKind::kColor,
    slot
  );
  if (colorParamSlot < 0 || colorParamSlot >= kControllerSlotCount) {
    return;
  }
  PF_ParamDef* colorParam = params[ControllerColorValueParamIndex(colorParamSlot)];
  if (!colorParam) {
    return;
  }
  const ControllerColorValue safeColor = SanitizeColorValue(color);
  PF_ArbitraryH existingHandle = colorParam->u.arb_d.value;
  bool wroteInPlace = false;
  if (existingHandle) {
    ControllerColorValue* data =
      reinterpret_cast<ControllerColorValue*>(PF_LOCK_HANDLE(existingHandle));
    if (data) {
      *data = safeColor;
      PF_UNLOCK_HANDLE(existingHandle);
      wroteInPlace = true;
    }
  }

  if (!wroteInPlace) {
    PF_ArbitraryH nextHandle = NULL;
    if (AllocateColorArbHandle(in_data, safeColor, &nextHandle) != PF_Err_NONE || !nextHandle) {
      return;
    }
    colorParam->u.arb_d.value = nextHandle;
  }
  colorParam->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
}

PF_Err PersistColorControllerValue(
  PF_InData* in_data,
  PF_ParamDef* params[],
  int slot,
  const ControllerColorValue& color,
  const char* reason
) {
  if (!in_data || !params || slot < 0 || slot >= kControllerSlotCount) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  const ControllerColorValue safeColor = SanitizeColorValue(color);
  WriteColorControllerValueToParams(in_data, params, slot, safeColor);
  (void)reason;
  return PF_Err_NONE;
}

PF_Err PersistAngleControllerValue(
  PF_InData* in_data,
  PF_ParamDef* params[],
  int slot,
  double degrees,
  const char* reason
) {
  if (!in_data || !params || slot < 0 || slot >= kControllerSlotCount) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  const double safeDegrees =
    (std::isfinite(degrees) && !std::isnan(degrees)) ? degrees : 0.0;
  std::string bundleError;
  const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, params, &bundleError);
  const int angleParamSlot = ResolveAngleParamSlotForLogicalSlot(bundle, slot);
  if (angleParamSlot < 0 || angleParamSlot >= kControllerSlotCount) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  WriteAngleControllerValueToParams(params, angleParamSlot, safeDegrees);
  (void)reason;
  return PF_Err_NONE;
}

void MarkControllerColorHistoryDirty(
  PF_InData* in_data,
  PF_ParamDef* params[],
  int slot,
  const char* reason
) {
  if (!in_data || slot < 0 || slot >= kControllerSlotCount) {
    return;
  }
  std::string bundleError;
  const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, NULL, &bundleError);
  const int colorParamSlot = ResolveControllerParamSlotForLogicalSlot(
    bundle,
    RuntimeControllerSlotKind::kColor,
    slot
  );
  if (colorParamSlot < 0 || colorParamSlot >= kControllerSlotCount) {
    return;
  }
  MarkControllerParamHistoryDirty(
    in_data,
    ControllerColorValueParamIndex(colorParamSlot),
    reason,
    params && params[PARAM_INSTANCE_ID]
      ? params[PARAM_INSTANCE_ID]->u.sd.value
      : 0
  );
}

PF_Err AllocateDefaultColorArbHandleForSlot(
  PF_InData* in_data,
  PF_ParamIndex paramId,
  PF_ArbitraryH* outHandle
) {
  if (!outHandle) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  ControllerColorValue color = MakeUnsetColorValue();
  ResolveInvocationColorControllerDefault(in_data, paramId, &color);
  return AllocateColorArbHandle(in_data, color, outHandle);
}

ControllerColorValue ResolveColorArbValueForInterpolation(
  PF_InData* in_data,
  PF_ParamIndex paramId,
  const ControllerColorValue& storedColor
) {
  if (!IsUnsetColorValue(storedColor)) {
    return storedColor;
  }

  ControllerColorValue resolvedColor;
  if (ResolveInvocationColorControllerDefault(in_data, paramId, &resolvedColor)) {
    return resolvedColor;
  }
  return storedColor;
}

PF_Err HandleColorArbitraryCallbacks(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ArbParamsExtra* extra
) {
  (void)out_data;
  if (!in_data || !extra) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  switch (extra->which_function) {
    case PF_Arbitrary_NEW_FUNC:
      if (!IsColorArbRefcon(extra->u.new_func_params.refconPV)) {
        return PF_Err_NONE;
      }
      return AllocateDefaultColorArbHandleForSlot(
        in_data,
        extra->id,
        extra->u.new_func_params.arbPH
      );

    case PF_Arbitrary_DISPOSE_FUNC:
      if (!IsColorArbRefcon(extra->u.dispose_func_params.refconPV)) {
        return PF_Err_NONE;
      }
      if (extra->u.dispose_func_params.arbH) {
        PF_DISPOSE_HANDLE(extra->u.dispose_func_params.arbH);
      }
      return PF_Err_NONE;

    case PF_Arbitrary_COPY_FUNC: {
      if (!IsColorArbRefcon(extra->u.copy_func_params.refconPV)) {
        return PF_Err_NONE;
      }
      const ControllerColorValue color = ResolveColorArbValueForInterpolation(
        in_data,
        extra->id,
        ReadColorArbHandle(in_data, extra->u.copy_func_params.src_arbH)
      );
      return AllocateColorArbHandle(in_data, color, extra->u.copy_func_params.dst_arbPH);
    }

    case PF_Arbitrary_FLAT_SIZE_FUNC:
      *extra->u.flat_size_func_params.flat_data_sizePLu = sizeof(ControllerColorValue);
      return PF_Err_NONE;

    case PF_Arbitrary_FLATTEN_FUNC: {
      if (extra->u.flatten_func_params.buf_sizeLu < sizeof(ControllerColorValue) ||
          !extra->u.flatten_func_params.flat_dataPV) {
        return PF_Err_BAD_CALLBACK_PARAM;
      }
      const ControllerColorValue color =
        ReadColorArbHandle(in_data, extra->u.flatten_func_params.arbH);
      std::memcpy(
        extra->u.flatten_func_params.flat_dataPV,
        &color,
        sizeof(ControllerColorValue)
      );
      return PF_Err_NONE;
    }

    case PF_Arbitrary_UNFLATTEN_FUNC: {
      if (extra->u.unflatten_func_params.buf_sizeLu != sizeof(ControllerColorValue) ||
          !extra->u.unflatten_func_params.flat_dataPV) {
        return PF_Err_BAD_CALLBACK_PARAM;
      }
      ControllerColorValue color;
      std::memcpy(
        &color,
        extra->u.unflatten_func_params.flat_dataPV,
        sizeof(ControllerColorValue)
      );
      return AllocateColorArbHandle(
        in_data,
        color,
        extra->u.unflatten_func_params.arbPH
      );
    }

    case PF_Arbitrary_INTERP_FUNC: {
      const ControllerColorValue storedLeft =
        ReadColorArbHandle(in_data, extra->u.interp_func_params.left_arbH);
      const ControllerColorValue storedRight =
        ReadColorArbHandle(in_data, extra->u.interp_func_params.right_arbH);
      const ControllerColorValue left = ResolveColorArbValueForInterpolation(
        in_data,
        extra->id,
        storedLeft
      );
      const ControllerColorValue right = ResolveColorArbValueForInterpolation(
        in_data,
        extra->id,
        storedRight
      );
      const double t = std::max(0.0, std::min(1.0, static_cast<double>(extra->u.interp_func_params.tF)));
      const bool neededDefault =
        IsUnsetColorValue(storedLeft) || IsUnsetColorValue(storedRight);
      const bool resolvedDefault =
        !IsUnsetColorValue(left) && !IsUnsetColorValue(right);
      if (neededDefault) {
        static std::atomic<int> successLogBudget{12};
        static std::atomic<int> failureLogBudget{12};
        std::atomic<int>& budget = resolvedDefault ? successLogBudget : failureLogBudget;
        if (budget.fetch_sub(1, std::memory_order_relaxed) > 0) {
          runtime_internal::AppendEffectRuntimeDiagnostic(
            in_data,
            resolvedDefault
              ? "color-interp-default-resolved"
              : "color-interp-context-missing",
            0,
            extra->id,
            -1,
            "t=" + std::to_string(t)
          );
        }
      }
      if (!resolvedDefault) {
        // Never manufacture white when the owning document is unavailable.
        // Preserve the unresolved endpoint so the effect/UI resolver can still
        // recover its instance default instead of caching a wrong color.
        ControllerColorValue unresolved = MakeUnsetColorValue();
        if (!IsUnsetColorValue(left) && t <= 0.0) {
          unresolved = left;
        } else if (!IsUnsetColorValue(right) && t >= 1.0) {
          unresolved = right;
        }
        return AllocateColorArbHandle(
          in_data,
          unresolved,
          extra->u.interp_func_params.interpPH
        );
      }
      ControllerColorValue mixed;
      mixed.r = left.r + ((right.r - left.r) * t);
      mixed.g = left.g + ((right.g - left.g) * t);
      mixed.b = left.b + ((right.b - left.b) * t);
      mixed.a = left.a + ((right.a - left.a) * t);
      return AllocateColorArbHandle(
        in_data,
        mixed,
        extra->u.interp_func_params.interpPH
      );
    }

    case PF_Arbitrary_COMPARE_FUNC: {
      const ControllerColorValue left = ResolveColorArbValueForInterpolation(
        in_data,
        extra->id,
        ReadColorArbHandle(in_data, extra->u.compare_func_params.a_arbH)
      );
      const ControllerColorValue right = ResolveColorArbValueForInterpolation(
        in_data,
        extra->id,
        ReadColorArbHandle(in_data, extra->u.compare_func_params.b_arbH)
      );
      const bool equal =
        std::fabs(left.r - right.r) <= 1e-9 &&
        std::fabs(left.g - right.g) <= 1e-9 &&
        std::fabs(left.b - right.b) <= 1e-9 &&
        std::fabs(left.a - right.a) <= 1e-9;
      if (equal) {
        *extra->u.compare_func_params.compareP = PF_ArbCompare_EQUAL;
        return PF_Err_NONE;
      }
      const double leftMagnitude = left.r + left.g + left.b + left.a;
      const double rightMagnitude = right.r + right.g + right.b + right.a;
      *extra->u.compare_func_params.compareP =
        leftMagnitude < rightMagnitude ? PF_ArbCompare_LESS : PF_ArbCompare_MORE;
      return PF_Err_NONE;
    }

    case PF_Arbitrary_PRINT_SIZE_FUNC:
      *extra->u.print_size_func_params.print_sizePLu = kColorArbPrintBufferSize;
      return PF_Err_NONE;

    case PF_Arbitrary_PRINT_FUNC: {
      const ControllerColorValue color =
        ReadColorArbHandle(in_data, extra->u.print_func_params.arbH);
      if (!extra->u.print_func_params.print_bufferPC ||
          extra->u.print_func_params.print_sizeLu == 0) {
        return PF_Err_BAD_CALLBACK_PARAM;
      }
      std::snprintf(
        extra->u.print_func_params.print_bufferPC,
        extra->u.print_func_params.print_sizeLu,
        "%.6f,%.6f,%.6f,%.6f",
        color.r,
        color.g,
        color.b,
        color.a
      );
      return PF_Err_NONE;
    }

    case PF_Arbitrary_SCAN_FUNC: {
      if (!extra->u.scan_func_params.bufPC || !extra->u.scan_func_params.arbPH) {
        return PF_Err_BAD_CALLBACK_PARAM;
      }
      ControllerColorValue color;
      const char* buffer = extra->u.scan_func_params.bufPC;
      const int parsed =
        std::sscanf(buffer, "rgba(%lf,%lf,%lf,%lf)", &color.r, &color.g, &color.b, &color.a) == 4 ||
        std::sscanf(buffer, "%lf,%lf,%lf,%lf", &color.r, &color.g, &color.b, &color.a) == 4 ||
        std::sscanf(buffer, "%lf %lf %lf %lf", &color.r, &color.g, &color.b, &color.a) == 4;
      if (!parsed) {
        return PF_Err_CANNOT_PARSE_KEYFRAME_TEXT;
      }
      return AllocateColorArbHandle(in_data, color, extra->u.scan_func_params.arbPH);
    }

    default:
      return PF_Err_NONE;
  }
}

PF_Err PromptForColorControllerValue(
  PF_InData* in_data,
  PF_OutData* out_data,
  const ControllerColorValue& current,
  ControllerColorValue* outColor
) {
  if (!in_data || !outColor) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  AEFX_SuiteScoper<PFAppSuite6, true> appSuite(
    in_data,
    kPFAppSuite,
    kPFAppSuiteVersion6,
    out_data
  );
  if (!appSuite.get()) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  PF_PixelFloat sampleColor;
  sampleColor.red = static_cast<PF_FpShort>(current.r);
  sampleColor.green = static_cast<PF_FpShort>(current.g);
  sampleColor.blue = static_cast<PF_FpShort>(current.b);
  sampleColor.alpha = static_cast<PF_FpShort>(current.a);
  PF_PixelFloat nextColor = sampleColor;
  const PF_Err err = appSuite->PF_AppColorPickerDialog(
    "Momentum Color",
    &sampleColor,
    TRUE,
    &nextColor
  );
  if (err != PF_Err_NONE) {
    return err;
  }

  outColor->r = static_cast<double>(nextColor.red);
  outColor->g = static_cast<double>(nextColor.green);
  outColor->b = static_cast<double>(nextColor.blue);
  outColor->a = static_cast<double>(nextColor.alpha);
  return PF_Err_NONE;
}

PF_Err SyncSliderControllerParamUI(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[]
) {
  (void)out_data;
  (void)params;
  if (!in_data) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  if (EnsureRegisteredWithAEGP(in_data) != A_Err_NONE || gAegpPluginId == 0) {
    return PF_Err_NONE;
  }

  AEFX_SuiteScoper<AEGP_PFInterfaceSuite1> interfaceSuite(
    in_data,
    kAEGPPFInterfaceSuite,
    kAEGPPFInterfaceSuiteVersion1,
    NULL
  );
  AEFX_SuiteScoper<AEGP_EffectSuite5> effectSuite(
    in_data,
    kAEGPEffectSuite,
    kAEGPEffectSuiteVersion5,
    NULL
  );
  AEFX_SuiteScoper<AEGP_StreamSuite6> streamSuite(
    in_data,
    kAEGPStreamSuite,
    kAEGPStreamSuiteVersion6,
    NULL
  );
  AEFX_SuiteScoper<AEGP_DynamicStreamSuite4> dynamicStreamSuite(
    in_data,
    kAEGPDynamicStreamSuite,
    kAEGPDynamicStreamSuiteVersion4,
    NULL
  );
  if (!interfaceSuite.get() || !effectSuite.get() || !streamSuite.get() || !dynamicStreamSuite.get()) {
    return PF_Err_NONE;
  }

  std::string bundleError;
  const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, params, &bundleError);
  (void)bundleError;

  AEGP_EffectRefH effectH = NULL;
  const A_Err effectErr = interfaceSuite->AEGP_GetNewEffectForEffect(
    gAegpPluginId,
    in_data->effect_ref,
    &effectH
  );
  if (effectErr != A_Err_NONE || !effectH) {
    return static_cast<PF_Err>(effectErr);
  }

  PF_Err err = PF_Err_NONE;
  for (int slot = 0; slot < kControllerSlotCount; ++slot) {
    const bool pointVisible =
      ResolveLogicalSlotForControllerParamSlot(bundle, RuntimeControllerSlotKind::kPoint, slot) >= 0;
    const bool sliderVisible =
      ResolveLogicalSlotForControllerParamSlot(bundle, RuntimeControllerSlotKind::kSlider, slot) >= 0;
    const bool colorVisible =
      ResolveLogicalSlotForControllerParamSlot(bundle, RuntimeControllerSlotKind::kColor, slot) >= 0;
    const bool checkboxVisible =
      ResolveLogicalSlotForControllerParamSlot(bundle, RuntimeControllerSlotKind::kCheckbox, slot) >= 0;
    const bool selectVisible =
      ResolveLogicalSlotForControllerParamSlot(bundle, RuntimeControllerSlotKind::kSelect, slot) >= 0;

    auto setStreamHidden = [&](PF_ParamIndex paramIndex, bool hidden) {
      AEGP_StreamRefH streamH = NULL;
      A_Err suiteErr = streamSuite->AEGP_GetNewEffectStreamByIndex(
        gAegpPluginId,
        effectH,
        paramIndex,
        &streamH
      );
      if (suiteErr == A_Err_NONE && streamH) {
        suiteErr = dynamicStreamSuite->AEGP_SetDynamicStreamFlag(
          streamH,
          AEGP_DynStreamFlag_HIDDEN,
          FALSE,
          hidden ? TRUE : FALSE
        );
        A_Err disposeErr = streamSuite->AEGP_DisposeStream(streamH);
        (void)disposeErr;
      }
      if (suiteErr != A_Err_NONE && err == PF_Err_NONE) {
        err = static_cast<PF_Err>(suiteErr);
      }
    };

    setStreamHidden(ControllerPointParamIndex(slot), kDebugExposeAllControllerParams ? false : !pointVisible);
    setStreamHidden(ControllerSliderParamIndex(slot), kDebugExposeAllControllerParams ? false : !sliderVisible);
    const bool angleVisible =
      ResolveLogicalSlotForControllerParamSlot(bundle, RuntimeControllerSlotKind::kAngle, slot) >= 0;
    setStreamHidden(ControllerAngleValueParamIndex(slot), kDebugExposeAllControllerParams ? false : !angleVisible);
    setStreamHidden(ControllerAngleUiParamIndex(slot), kDebugExposeAllControllerParams ? false : true);
    setStreamHidden(ControllerColorValueParamIndex(slot), kDebugExposeAllControllerParams ? false : !colorVisible);
    setStreamHidden(ControllerCheckboxParamIndex(slot), kDebugExposeAllControllerParams ? false : !checkboxVisible);
    setStreamHidden(ControllerSelectParamIndex(slot), kDebugExposeAllControllerParams ? false : !selectVisible);
  }

  A_Err disposeEffectErr = effectSuite->AEGP_DisposeEffect(effectH);
  (void)disposeEffectErr;

  return err;
}

PF_Err SyncControllerParamUI(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[]
) {
  if (!in_data || !params) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  std::string bundleError;
  const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, params, &bundleError);
  (void)bundleError;

  AEFX_SuiteScoper<PF_ParamUtilsSuite3> paramUtilsSuite(
    in_data,
    kPFParamUtilsSuite,
    kPFParamUtilsSuiteVersion3,
    NULL
  );
  if (!paramUtilsSuite.get()) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  for (int slot = 0; slot < kControllerSlotCount; ++slot) {
    const int pointLogicalSlot =
      ResolveLogicalSlotForControllerParamSlot(bundle, RuntimeControllerSlotKind::kPoint, slot);
    const int sliderLogicalSlot =
      ResolveLogicalSlotForControllerParamSlot(bundle, RuntimeControllerSlotKind::kSlider, slot);
    const int colorLogicalSlot =
      ResolveLogicalSlotForControllerParamSlot(bundle, RuntimeControllerSlotKind::kColor, slot);
    const int checkboxLogicalSlot =
      ResolveLogicalSlotForControllerParamSlot(bundle, RuntimeControllerSlotKind::kCheckbox, slot);
    const int selectLogicalSlot =
      ResolveLogicalSlotForControllerParamSlot(bundle, RuntimeControllerSlotKind::kSelect, slot);
    const bool pointVisible = pointLogicalSlot >= 0;
    const bool sliderVisible = sliderLogicalSlot >= 0;
    const bool colorVisible = colorLogicalSlot >= 0;
    const bool checkboxVisible = checkboxLogicalSlot >= 0;
    const bool selectVisible = selectLogicalSlot >= 0;
    const int angleLogicalSlot =
      ResolveLogicalSlotForControllerParamSlot(bundle, RuntimeControllerSlotKind::kAngle, slot);
    const bool angleVisible = angleLogicalSlot >= 0;

    PF_ParamDef* pointSource = params[ControllerPointParamIndex(slot)];
    if (pointSource) {
      PF_ParamDef pointDef = *pointSource;
      CopyParamName(
        &pointDef,
        pointVisible
          ? ResolveControllerSlotLabel(bundle, pointLogicalSlot, RuntimeControllerSlotKind::kPoint)
          : DefaultPointControllerLabel(slot)
      );
      PF_Err updateErr = paramUtilsSuite->PF_UpdateParamUI(
        in_data->effect_ref,
        ControllerPointParamIndex(slot),
        &pointDef
      );
      if (updateErr != PF_Err_NONE) {
        return updateErr;
      }
    }

    PF_ParamDef* sliderSource = params[ControllerSliderParamIndex(slot)];
    if (sliderSource) {
      PF_ParamDef sliderDef = *sliderSource;
      const RuntimeSliderControllerSpec config =
        sliderVisible
          ? ResolveSliderControllerSpecWithDefaults(bundle, sliderLogicalSlot)
          : RuntimeSliderControllerSpec();
      sliderDef.ui_width = 0;
      sliderDef.ui_height = 0;
      CopyParamName(
        &sliderDef,
        config.label.empty() ? DefaultSliderControllerLabel(slot) : config.label
      );
      PF_FpShort ignoredValidMin = 0;
      PF_FpShort ignoredValidMax = 0;
      ResolveSafeSliderUiRange(
        config.minValue,
        config.maxValue,
        &ignoredValidMin,
        &ignoredValidMax,
        &sliderDef.u.fs_d.slider_min,
        &sliderDef.u.fs_d.slider_max
      );
      sliderDef.u.fs_d.precision = kControllerSliderPrecision;
      PF_Err updateErr = paramUtilsSuite->PF_UpdateParamUI(
        in_data->effect_ref,
        ControllerSliderParamIndex(slot),
        &sliderDef
      );
      if (updateErr != PF_Err_NONE) {
        return updateErr;
      }
    }

    PF_ParamDef* angleValueSource = params[ControllerAngleValueParamIndex(slot)];
    if (angleValueSource) {
      PF_ParamDef angleValueDef = *angleValueSource;
      const RuntimeAngleControllerSpec config =
        angleVisible
          ? ResolveAngleControllerSpecWithDefaults(bundle, angleLogicalSlot)
          : RuntimeAngleControllerSpec();
      ResolveAngleUiRange(
        &angleValueDef.u.fs_d.valid_min,
        &angleValueDef.u.fs_d.valid_max,
        &angleValueDef.u.fs_d.slider_min,
        &angleValueDef.u.fs_d.slider_max
      );
      angleValueDef.u.fs_d.precision = 2;
      angleValueDef.ui_width = kAngleControlUiWidth;
      angleValueDef.ui_height = kAngleControlUiHeight;
      {
        std::string label =
          config.label.empty() ? DefaultAngleControllerLabel(slot) : config.label;
        if (kDebugExposeAllControllerParams) {
          label += " [angle-value " + std::to_string(slot) + "]";
        }
        CopyParamName(&angleValueDef, label);
      }
      PF_Err updateErr = paramUtilsSuite->PF_UpdateParamUI(
        in_data->effect_ref,
        ControllerAngleValueParamIndex(slot),
        &angleValueDef
      );
      if (updateErr != PF_Err_NONE) {
        return updateErr;
      }
    }

    PF_ParamDef* angleUiSource = params[ControllerAngleUiParamIndex(slot)];
    if (angleUiSource) {
      PF_ParamDef angleUiDef = *angleUiSource;
      const RuntimeAngleControllerSpec config =
        angleVisible
          ? ResolveAngleControllerSpecWithDefaults(bundle, angleLogicalSlot)
          : RuntimeAngleControllerSpec();
      angleUiDef.ui_width = 0;
      angleUiDef.ui_height = 0;
      {
        std::string label =
          config.label.empty() ? DefaultAngleControllerLabel(slot) : config.label;
        if (kDebugExposeAllControllerParams) {
          label += " [angle-ui " + std::to_string(slot) + "]";
        }
        CopyParamName(&angleUiDef, label);
      }
      PF_Err updateErr = paramUtilsSuite->PF_UpdateParamUI(
        in_data->effect_ref,
        ControllerAngleUiParamIndex(slot),
        &angleUiDef
      );
      if (updateErr != PF_Err_NONE) {
        return updateErr;
      }
    }

    PF_ParamDef* colorSource = params[ControllerColorParamIndex(slot)];
    if (colorSource) {
      PF_ParamDef colorDef = *colorSource;
      const RuntimeColorControllerSpec colorConfig =
        colorVisible
          ? ResolveColorControllerSpecWithDefaults(bundle, colorLogicalSlot)
          : RuntimeColorControllerSpec();
      colorDef.ui_width = kColorControlUiWidth;
      colorDef.ui_height = kColorControlUiHeight;
      CopyParamName(
        &colorDef,
        colorConfig.label.empty() ? DefaultColorControllerLabel(slot) : colorConfig.label
      );
      PF_Err updateErr = paramUtilsSuite->PF_UpdateParamUI(
        in_data->effect_ref,
        ControllerColorParamIndex(slot),
        &colorDef
      );
      if (updateErr != PF_Err_NONE) {
        return updateErr;
      }
    }

    PF_ParamDef* checkboxSource = params[ControllerCheckboxParamIndex(slot)];
    if (checkboxSource) {
      PF_ParamDef checkboxDef = *checkboxSource;
      const RuntimeCheckboxControllerSpec config =
        checkboxVisible
          ? ResolveCheckboxControllerSpecWithDefaults(bundle, checkboxLogicalSlot)
          : RuntimeCheckboxControllerSpec();
      CopyParamName(
        &checkboxDef,
        config.label.empty() ? DefaultCheckboxControllerLabel(slot) : config.label
      );
      PF_Err updateErr = paramUtilsSuite->PF_UpdateParamUI(
        in_data->effect_ref,
        ControllerCheckboxParamIndex(slot),
        &checkboxDef
      );
      if (updateErr != PF_Err_NONE) {
        return updateErr;
      }
    }

    PF_ParamDef* selectSource = params[ControllerSelectParamIndex(slot)];
    if (selectSource) {
      PF_ParamDef selectDef = *selectSource;
      const RuntimeSelectControllerSpec config =
        selectVisible
          ? ResolveSelectControllerSpecWithDefaults(bundle, selectLogicalSlot)
          : RuntimeSelectControllerSpec();
      CopyParamName(
        &selectDef,
        config.label.empty() ? DefaultSelectControllerLabel(slot) : config.label
      );
      PF_Err updateErr = paramUtilsSuite->PF_UpdateParamUI(
        in_data->effect_ref,
        ControllerSelectParamIndex(slot),
        &selectDef
      );
      if (updateErr != PF_Err_NONE) {
        return updateErr;
      }
    }
  }

  PF_Err visibilityErr = SyncSliderControllerParamUI(in_data, out_data, params);
  if (visibilityErr != PF_Err_NONE) {
    return visibilityErr;
  }

  (void)out_data;
  return PF_Err_NONE;
}

void DisposeRenderInvocationInfo(void* preRenderData) {
  if (preRenderData) {
    auto* info = reinterpret_cast<RenderInvocationInfo*>(preRenderData);
    DiscardEffectRuntimeState(info->runtimeKey, "render-invocation-dispose");
    delete info;
  }
}

PF_Err RegisterCustomUI(PF_InData* in_data) {
  if (!in_data || !in_data->inter.register_ui) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  PF_CustomUIInfo ci;
  AEFX_CLR_STRUCT(ci);
  // Point controllers use AE's native PF_POINT UI in the Composition and
  // Layer panels. Custom events are needed only for the angle and high-depth
  // color controls hosted in Effect Controls.
  ci.events = PF_CustomEFlag_EFFECT;
  return (*(in_data->inter.register_ui))(in_data->effect_ref, &ci);
}

void RequestCustomUIRefresh(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_EventExtra* extra,
  bool forceRender
) {
  (void)out_data;
  (void)forceRender;
  if (!extra) {
    return;
  }

  extra->evt_out_flags |= PF_EO_HANDLED_EVENT;

  if (!in_data || !extra->contextH) {
    return;
  }

  AEFX_SuiteScoper<PFAppSuite6, true> appSuite(
    in_data,
    kPFAppSuite,
    kPFAppSuiteVersion6,
    out_data
  );
  if (appSuite.get()) {
    appSuite->PF_InvalidateRect(extra->contextH, NULL);
    extra->evt_out_flags |= PF_EO_UPDATE_NOW;
  }
}

bool TryMapSliderParamIndexToSlot(PF_ParamIndex paramIndex, int* outSlot) {
  if (paramIndex < ControllerSliderParamIndex(0) ||
      paramIndex > ControllerSliderParamIndex(kControllerSlotCount - 1)) {
    return false;
  }
  const int relativeIndex = static_cast<int>(paramIndex - ControllerSliderParamIndex(0));
  if ((relativeIndex % kControllerParamKindsPerSlot) != 0) {
    return false;
  }
  const int slot = relativeIndex / kControllerParamKindsPerSlot;
  if (slot < 0 || slot >= kControllerSlotCount) {
    return false;
  }
  if (outSlot) {
    *outSlot = slot;
  }
  return true;
}

bool TryMapAngleParamIndexToSlot(PF_ParamIndex paramIndex, int* outSlot) {
  if (TryMapAngleValueParamIndexToSlot(paramIndex, outSlot)) {
    return true;
  }
  return TryMapAngleUiParamIndexToSlot(paramIndex, outSlot);
}

bool TryMapAngleValueParamIndexToSlot(PF_ParamIndex paramIndex, int* outSlot) {
  if (paramIndex < ControllerAngleValueParamIndex(0) ||
      paramIndex > ControllerAngleValueParamIndex(kControllerSlotCount - 1)) {
    return false;
  }
  const int relativeIndex = static_cast<int>(paramIndex - ControllerAngleValueParamIndex(0));
  if ((relativeIndex % kControllerParamKindsPerSlot) != 0) {
    return false;
  }
  const int slot = relativeIndex / kControllerParamKindsPerSlot;
  if (slot < 0 || slot >= kControllerSlotCount) {
    return false;
  }
  if (outSlot) {
    *outSlot = slot;
  }
  return true;
}

bool TryMapAngleUiParamIndexToSlot(PF_ParamIndex paramIndex, int* outSlot) {
  if (paramIndex < ControllerAngleValueParamIndex(0) ||
      paramIndex > ControllerAngleUiParamIndex(kControllerSlotCount - 1)) {
    return false;
  }
  const int relativeIndex = static_cast<int>(paramIndex - ControllerAngleValueParamIndex(0));
  if ((relativeIndex % kControllerParamKindsPerSlot) != 1) {
    return false;
  }
  const int slot = relativeIndex / kControllerParamKindsPerSlot;
  if (slot < 0 || slot >= kControllerSlotCount) {
    return false;
  }
  if (outSlot) {
    *outSlot = slot;
  }
  return true;
}

bool TryMapColorParamIndexToSlot(PF_ParamIndex paramIndex, int* outSlot) {
  if (paramIndex < ControllerColorParamIndex(0) ||
      paramIndex > ControllerColorParamIndex(kControllerSlotCount - 1)) {
    return false;
  }
  const int relativeIndex = static_cast<int>(paramIndex - ControllerColorParamIndex(0));
  if ((relativeIndex % kControllerParamKindsPerSlot) != 0) {
    return false;
  }
  const int slot = relativeIndex / kControllerParamKindsPerSlot;
  if (slot < 0 || slot >= kControllerSlotCount) {
    return false;
  }
  if (outSlot) {
    *outSlot = slot;
  }
  return true;
}

bool IsControllerParamIndex(PF_ParamIndex paramIndex) {
  return
    (paramIndex >= PARAM_CONTROLLER_SLOT_BASE && paramIndex < PARAM_COUNT);
}

DRAWBOT_ColorRGBA MakeCustomUiColor(float red, float green, float blue, float alpha) {
  DRAWBOT_ColorRGBA color{};
  color.red = red;
  color.green = green;
  color.blue = blue;
  color.alpha = alpha;
  return color;
}

PF_Err DrawAngleControllerUi(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  PF_EventExtra* extra
) {
  (void)out_data;
  if (!in_data || !params || !extra || !extra->contextH) {
    return PF_Err_NONE;
  }
  if ((*extra->contextH)->w_type != PF_Window_EFFECT || extra->effect_win.area != PF_EA_CONTROL) {
    return PF_Err_NONE;
  }

  std::string bundleError;
  const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, params, &bundleError);
  int slot = -1;
  if (!TryResolveAngleUiSlot(bundle, extra->effect_win.index, &slot)) {
    return PF_Err_NONE;
  }

  const int angleParamSlot = ResolveAngleParamSlotForLogicalSlot(bundle, slot);
  if (angleParamSlot < 0) {
    return PF_Err_NONE;
  }
  PF_ParamDef* angleParam = params[ControllerAngleValueParamIndex(angleParamSlot)];
  if (!angleParam) {
    return PF_Err_NONE;
  }

  AEFX_SuiteScoper<PF_EffectCustomUISuite2> customUiSuite(
    in_data,
    kPFEffectCustomUISuite,
    kPFEffectCustomUISuiteVersion2,
    NULL
  );
  AEFX_SuiteScoper<DRAWBOT_DrawbotSuite1> drawbotSuite(
    in_data,
    kDRAWBOT_DrawSuite,
    kDRAWBOT_DrawSuite_VersionCurrent,
    NULL
  );
  AEFX_SuiteScoper<DRAWBOT_SurfaceSuite2> surfaceSuite(
    in_data,
    kDRAWBOT_SurfaceSuite,
    kDRAWBOT_SurfaceSuite_VersionCurrent,
    NULL
  );
  AEFX_SuiteScoper<DRAWBOT_SupplierSuite1> supplierSuite(
    in_data,
    kDRAWBOT_SupplierSuite,
    kDRAWBOT_SupplierSuite_VersionCurrent,
    NULL
  );
  AEFX_SuiteScoper<DRAWBOT_PathSuite1> pathSuite(
    in_data,
    kDRAWBOT_PathSuite,
    kDRAWBOT_PathSuite_VersionCurrent,
    NULL
  );
  if (!customUiSuite.get() || !drawbotSuite.get() || !surfaceSuite.get() ||
      !supplierSuite.get() || !pathSuite.get()) {
    return PF_Err_NONE;
  }

  DRAWBOT_DrawRef drawRef = NULL;
  PF_Err err = customUiSuite->PF_GetDrawingReference(extra->contextH, &drawRef);
  if (err != PF_Err_NONE || !drawRef) {
    return PF_Err_NONE;
  }

  DRAWBOT_SurfaceRef surfaceRef = NULL;
  DRAWBOT_SupplierRef supplierRef = NULL;
  err = drawbotSuite->GetSurface(drawRef, &surfaceRef);
  if (err != PF_Err_NONE || !surfaceRef) {
    return PF_Err_NONE;
  }
  err = drawbotSuite->GetSupplier(drawRef, &supplierRef);
  if (err != PF_Err_NONE || !supplierRef) {
    return PF_Err_NONE;
  }

  const AngleUiLayout layout = ComputeAngleUiLayout(extra->effect_win.current_frame);
  const double degrees = static_cast<double>(angleParam->u.fs_d.value);
  int turns = 0;
  double cycleDegrees = 0.0;
  SplitAngleUiDegrees(degrees, &turns, &cycleDegrees);
  const std::string turnsDisplayText = FormatAngleUiTurnsOnlyText(turns);
  const std::string degreesDisplayText = FormatAngleUiSignedDegreesText(cycleDegrees);
  const double wrappedDegrees = WrapAngleUiDegrees(degrees);
  const double radians = (wrappedDegrees - 90.0) * (M_PI / 180.0);
  const float indicatorRadius =
    std::max(0.0f, layout.knobRadius - (kAngleControlRingStrokeWidth * 0.5f));
  const DRAWBOT_PointF32 indicatorEnd = {
    layout.knobCenter.x + static_cast<float>(std::cos(radians) * indicatorRadius),
    layout.knobCenter.y + static_cast<float>(std::sin(radians) * indicatorRadius)
  };

  const DRAWBOT_ColorRGBA ringColor = MakeCustomUiColor(0.72f, 0.72f, 0.72f, 1.0f);
  const DRAWBOT_ColorRGBA indicatorColor = MakeCustomUiColor(0.90f, 0.90f, 0.90f, 1.0f);
  const DRAWBOT_ColorRGBA valueColor = MakeCustomUiColor(0.31f, 0.60f, 0.98f, 1.0f);
  const DRAWBOT_ColorRGBA xColor = MakeCustomUiColor(0.92f, 0.92f, 0.92f, 1.0f);

  DRAWBOT_PenRef ringPen = NULL;
  DRAWBOT_PenRef indicatorPen = NULL;
  DRAWBOT_PathRef ringPath = NULL;
  DRAWBOT_PathRef indicatorPath = NULL;
  DRAWBOT_BrushRef valueBrush = NULL;
  DRAWBOT_BrushRef xBrush = NULL;
  DRAWBOT_FontRef valueFont = NULL;

  err = supplierSuite->NewPen(supplierRef, &ringColor, kAngleControlRingStrokeWidth, &ringPen);
  if (err != PF_Err_NONE || !ringPen) {
    return PF_Err_NONE;
  }
  err = supplierSuite->NewPen(
    supplierRef,
    &indicatorColor,
    kAngleControlIndicatorStrokeWidth,
    &indicatorPen
  );
  if (err != PF_Err_NONE || !indicatorPen) {
    supplierSuite->ReleaseObject(reinterpret_cast<DRAWBOT_ObjectRef>(ringPen));
    return PF_Err_NONE;
  }
  err = supplierSuite->NewPath(supplierRef, &ringPath);
  if (err != PF_Err_NONE || !ringPath) {
    supplierSuite->ReleaseObject(reinterpret_cast<DRAWBOT_ObjectRef>(indicatorPen));
    supplierSuite->ReleaseObject(reinterpret_cast<DRAWBOT_ObjectRef>(ringPen));
    return PF_Err_NONE;
  }
  err = supplierSuite->NewPath(supplierRef, &indicatorPath);
  if (err != PF_Err_NONE || !indicatorPath) {
    supplierSuite->ReleaseObject(reinterpret_cast<DRAWBOT_ObjectRef>(ringPath));
    supplierSuite->ReleaseObject(reinterpret_cast<DRAWBOT_ObjectRef>(indicatorPen));
    supplierSuite->ReleaseObject(reinterpret_cast<DRAWBOT_ObjectRef>(ringPen));
    return PF_Err_NONE;
  }

  pathSuite->AddArc(ringPath, &layout.knobCenter, layout.knobRadius, 0.0f, 360.0f);
  pathSuite->MoveTo(indicatorPath, layout.knobCenter.x, layout.knobCenter.y);
  pathSuite->LineTo(indicatorPath, indicatorEnd.x, indicatorEnd.y);
  surfaceSuite->StrokePath(surfaceRef, ringPen, ringPath);
  surfaceSuite->StrokePath(surfaceRef, indicatorPen, indicatorPath);

  const float centerDotSize = kAngleControlIndicatorStrokeWidth;
  DRAWBOT_RectF32 centerRect = {
    layout.knobCenter.x - (centerDotSize * 0.5f),
    layout.knobCenter.y - (centerDotSize * 0.5f),
    centerDotSize,
    centerDotSize
  };
  surfaceSuite->PaintRect(surfaceRef, &indicatorColor, &centerRect);

  DRAWBOT_Boolean supportsText = FALSE;
  if (supplierSuite->SupportsText(supplierRef, &supportsText) == PF_Err_NONE && supportsText) {
    float defaultFontSize = 11.0f;
    if (supplierSuite->GetDefaultFontSize(supplierRef, &defaultFontSize) == PF_Err_NONE &&
        supplierSuite->NewDefaultFont(supplierRef, defaultFontSize * 0.95f, &valueFont) == PF_Err_NONE &&
        valueFont &&
        supplierSuite->NewBrush(supplierRef, &valueColor, &valueBrush) == PF_Err_NONE &&
        valueBrush &&
        supplierSuite->NewBrush(supplierRef, &xColor, &xBrush) == PF_Err_NONE &&
        xBrush) {
      const std::vector<DRAWBOT_UTF16Char> turnsText =
        MakeDrawbotUtf16String(turnsDisplayText);
      const std::vector<DRAWBOT_UTF16Char> xText =
        MakeDrawbotUtf16String("x");
      const std::vector<DRAWBOT_UTF16Char> degreesText =
        MakeDrawbotUtf16String(degreesDisplayText);
      const DRAWBOT_PointF32 turnsOrigin = {
        layout.turnsRect.left + layout.turnsRect.width,
        layout.valueRect.top + (layout.valueRect.height * 0.68f)
      };
      const DRAWBOT_PointF32 xOrigin = {
        layout.turnsRect.left + layout.turnsRect.width + 1.0f,
        layout.valueRect.top + (layout.valueRect.height * 0.68f)
      };
      const DRAWBOT_PointF32 degreesOrigin = {
        layout.degreesRect.left,
        layout.valueRect.top + (layout.valueRect.height * 0.68f)
      };
      surfaceSuite->DrawString(
        surfaceRef,
        valueBrush,
        valueFont,
        turnsText.data(),
        &turnsOrigin,
        kDRAWBOT_TextAlignment_Right,
        kDRAWBOT_TextTruncation_None,
        0.0f
      );
      surfaceSuite->DrawString(
        surfaceRef,
        xBrush,
        valueFont,
        xText.data(),
        &xOrigin,
        kDRAWBOT_TextAlignment_Left,
        kDRAWBOT_TextTruncation_None,
        0.0f
      );
      surfaceSuite->DrawString(
        surfaceRef,
        valueBrush,
        valueFont,
        degreesText.data(),
        &degreesOrigin,
        kDRAWBOT_TextAlignment_Left,
        kDRAWBOT_TextTruncation_None,
        0.0f
      );
    }
  }

  if (valueBrush) {
    supplierSuite->ReleaseObject(reinterpret_cast<DRAWBOT_ObjectRef>(valueBrush));
  }
  if (xBrush) {
    supplierSuite->ReleaseObject(reinterpret_cast<DRAWBOT_ObjectRef>(xBrush));
  }
  if (valueFont) {
    supplierSuite->ReleaseObject(reinterpret_cast<DRAWBOT_ObjectRef>(valueFont));
  }
  supplierSuite->ReleaseObject(reinterpret_cast<DRAWBOT_ObjectRef>(indicatorPath));
  supplierSuite->ReleaseObject(reinterpret_cast<DRAWBOT_ObjectRef>(ringPath));
  supplierSuite->ReleaseObject(reinterpret_cast<DRAWBOT_ObjectRef>(indicatorPen));
  supplierSuite->ReleaseObject(reinterpret_cast<DRAWBOT_ObjectRef>(ringPen));

  extra->evt_out_flags |= PF_EO_HANDLED_EVENT;
  return PF_Err_NONE;
}

PF_Err DrawColorControllerUi(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  PF_EventExtra* extra
) {
  (void)out_data;
  if (!in_data || !params || !extra || !extra->contextH) {
    return PF_Err_NONE;
  }
  if (!IsColorControllerEffectArea(extra)) {
    return PF_Err_NONE;
  }

  std::string bundleError;
  const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, params, &bundleError);
  int slot = -1;
  if (!TryResolveColorUiSlot(bundle, extra->effect_win.index, &slot)) {
    return PF_Err_NONE;
  }

  const int colorParamSlot = ResolveControllerParamSlotForLogicalSlot(
    bundle,
    RuntimeControllerSlotKind::kColor,
    slot
  );
  if (colorParamSlot < 0) {
    return PF_Err_NONE;
  }
  PF_ParamDef* colorParam = params[ControllerColorParamIndex(colorParamSlot)];
  if (!colorParam) {
    return PF_Err_NONE;
  }
  const ControllerColorValue color =
    ResolveColorControllerValueFromParams(in_data, params, slot);

  AEFX_SuiteScoper<PF_EffectCustomUISuite2> customUiSuite(
    in_data,
    kPFEffectCustomUISuite,
    kPFEffectCustomUISuiteVersion2,
    NULL
  );
  AEFX_SuiteScoper<DRAWBOT_DrawbotSuite1> drawbotSuite(
    in_data,
    kDRAWBOT_DrawSuite,
    kDRAWBOT_DrawSuite_VersionCurrent,
    NULL
  );
  AEFX_SuiteScoper<DRAWBOT_SurfaceSuite2> surfaceSuite(
    in_data,
    kDRAWBOT_SurfaceSuite,
    kDRAWBOT_SurfaceSuite_VersionCurrent,
    NULL
  );
  AEFX_SuiteScoper<DRAWBOT_SupplierSuite1> supplierSuite(
    in_data,
    kDRAWBOT_SupplierSuite,
    kDRAWBOT_SupplierSuite_VersionCurrent,
    NULL
  );
  if (!customUiSuite.get() || !drawbotSuite.get() || !surfaceSuite.get() || !supplierSuite.get()) {
    return PF_Err_NONE;
  }

  DRAWBOT_DrawRef drawRef = NULL;
  PF_Err err = customUiSuite->PF_GetDrawingReference(extra->contextH, &drawRef);
  if (err != PF_Err_NONE || !drawRef) {
    return PF_Err_NONE;
  }

  DRAWBOT_SurfaceRef surfaceRef = NULL;
  DRAWBOT_SupplierRef supplierRef = NULL;
  err = drawbotSuite->GetSurface(drawRef, &surfaceRef);
  if (err != PF_Err_NONE || !surfaceRef) {
    return PF_Err_NONE;
  }
  err = drawbotSuite->GetSupplier(drawRef, &supplierRef);
  if (err != PF_Err_NONE || !supplierRef) {
    return PF_Err_NONE;
  }

  DRAWBOT_RectF32 swatchRect = ComputeColorControllerSwatchRect(extra);
  if (swatchRect.width <= 0.0f || swatchRect.height <= 0.0f) {
    return PF_Err_NONE;
  }
  DRAWBOT_RectF32 innerRect = {
    swatchRect.left + 1.0f,
    swatchRect.top + 1.0f,
    std::max(0.0f, swatchRect.width - 2.0f),
    std::max(0.0f, swatchRect.height - 2.0f)
  };

  const DRAWBOT_ColorRGBA borderColor = MakeCustomUiColor(0.36f, 0.36f, 0.36f, 1.0f);
  const DRAWBOT_ColorRGBA fillColor = MakeCustomUiColor(
    static_cast<float>(ClampColorComponent(color.r, 1.0)),
    static_cast<float>(ClampColorComponent(color.g, 1.0)),
    static_cast<float>(ClampColorComponent(color.b, 1.0)),
    1.0f
  );
  const DRAWBOT_ColorRGBA alphaHintColor = MakeCustomUiColor(0.20f, 0.20f, 0.20f, 1.0f);

  surfaceSuite->PaintRect(surfaceRef, &borderColor, &swatchRect);
  surfaceSuite->PaintRect(surfaceRef, &alphaHintColor, &innerRect);
  surfaceSuite->PaintRect(surfaceRef, &fillColor, &innerRect);

  extra->evt_out_flags |= PF_EO_HANDLED_EVENT;
  return PF_Err_NONE;
}

PF_Err ClickColorControllerUi(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  PF_EventExtra* extra
) {
  if (!in_data || !out_data || !params || !extra || !extra->contextH) {
    return PF_Err_NONE;
  }
  if (!IsColorControllerEffectArea(extra)) {
    return PF_Err_NONE;
  }

  const PF_Point mousePoint = *reinterpret_cast<PF_Point*>(&extra->u.do_click.screen_point);
  if (!HitTestColorControllerSwatch(extra, mousePoint)) {
    return PF_Err_NONE;
  }

  std::string bundleError;
  const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, params, &bundleError);
  int slot = -1;
  if (!TryResolveColorUiSlot(bundle, extra->effect_win.index, &slot)) {
    return PF_Err_NONE;
  }

  const ControllerColorValue currentColor =
    ResolveColorControllerValueFromParams(in_data, params, slot);
  ControllerColorValue nextColor = currentColor;
  const PF_Err colorPickErr = PromptForColorControllerValue(in_data, out_data, currentColor, &nextColor);
  if (colorPickErr == PF_Interrupt_CANCEL) {
    return PF_Err_NONE;
  }
  if (colorPickErr != PF_Err_NONE) {
    return colorPickErr;
  }

  PF_Err persistErr = PersistColorControllerValue(
    in_data,
    params,
    slot,
    nextColor,
    "color-ui-picked"
  );
  if (persistErr != PF_Err_NONE) {
    return persistErr;
  }
  MarkControllerColorHistoryDirty(in_data, params, slot, "color-ui-picked");
  RequestCustomUIRefresh(in_data, out_data, extra, true);
  extra->evt_out_flags |= PF_EO_HANDLED_EVENT | PF_EO_UPDATE_NOW;
  return PF_Err_NONE;
}

PF_Err BeginAngleControllerDrag(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  PF_EventExtra* extra
) {
  if (!in_data || !out_data || !extra || !extra->contextH) {
    return PF_Err_NONE;
  }
  if ((*extra->contextH)->w_type != PF_Window_EFFECT || extra->effect_win.area != PF_EA_CONTROL) {
    return PF_Err_NONE;
  }

  std::string bundleError;
  const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, params, &bundleError);
  int slot = -1;
  if (!TryResolveAngleUiSlot(bundle, extra->effect_win.index, &slot)) {
    return PF_Err_NONE;
  }
  const int angleParamSlot = ResolveAngleParamSlotForLogicalSlot(bundle, slot);
  if (angleParamSlot < 0) {
    return PF_Err_NONE;
  }

  const PF_Point mousePoint = *reinterpret_cast<PF_Point*>(&extra->u.do_click.screen_point);
  const AngleUiLayout layout = ComputeAngleUiLayout(extra->effect_win.current_frame);
  const AngleUiDragTarget dragTarget = ResolveAngleUiHitTarget(layout, mousePoint);
  if (dragTarget == AngleUiDragTarget::kNone) {
    return PF_Err_NONE;
  }

  if (dragTarget == AngleUiDragTarget::kTurnsText || dragTarget == AngleUiDragTarget::kDegreesText) {
    PF_ParamDef* angleParam = params ? params[ControllerAngleValueParamIndex(angleParamSlot)] : NULL;
    const double angleDegrees =
      angleParam ? static_cast<double>(angleParam->u.fs_d.value) : 0.0;
    UpdateAngleUiDragState(
      extra,
      slot,
      dragTarget,
      static_cast<double>(mousePoint.h),
      true,
      angleDegrees,
      angleParam != NULL,
      false
    );
    RequestCustomUIRefresh(in_data, out_data, extra, true);
    extra->evt_out_flags |= PF_EO_HANDLED_EVENT | PF_EO_UPDATE_NOW;
    return PF_Err_NONE;
  }

  double trackedValue = 0.0;
  const bool hasTrackedValue = TryComputeAngleUiPointerDegrees(layout, mousePoint, &trackedValue);

  UpdateAngleUiDragState(
    extra,
    slot,
    dragTarget,
    trackedValue,
    hasTrackedValue,
    0.0,
    false,
    false
  );
  RequestCustomUIRefresh(in_data, out_data, extra, false);
  extra->evt_out_flags |= PF_EO_HANDLED_EVENT;
  return PF_Err_NONE;
}

PF_Err UpdateAngleControllerDrag(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  PF_EventExtra* extra
) {
  if (!in_data || !out_data || !params || !extra) {
    return PF_Err_NONE;
  }

  const int slot = static_cast<int>(extra->u.do_click.continue_refcon[0]) - 1;
  if (slot < 0 || slot >= kControllerSlotCount) {
    return PF_Err_NONE;
  }
  std::string bundleError;
  const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, params, &bundleError);
  const int angleParamSlot = ResolveAngleParamSlotForLogicalSlot(bundle, slot);
  if (angleParamSlot < 0) {
    return PF_Err_NONE;
  }

  PF_ParamDef* angleParam = params[ControllerAngleValueParamIndex(angleParamSlot)];
  if (!angleParam) {
    return PF_Err_NONE;
  }

  const AngleUiDragTarget dragTarget =
    DecodeAngleUiDragTarget(extra->u.do_click.continue_refcon[1]);
  if (dragTarget == AngleUiDragTarget::kNone) {
    return PF_Err_NONE;
  }

  const PF_Point mousePoint = *reinterpret_cast<PF_Point*>(&extra->u.do_click.screen_point);
  const double currentDegrees = static_cast<double>(angleParam->u.fs_d.value);
  double nextDegrees = currentDegrees;
  bool didChangeValue = false;

  if (dragTarget == AngleUiDragTarget::kTurnsText || dragTarget == AngleUiDragTarget::kDegreesText) {
    double anchorMouseX = 0.0;
    double anchorDegrees = currentDegrees;
    const bool hasAnchorMouseX =
      DecodeAngleUiDoubleValue(extra->u.do_click.continue_refcon[2], &anchorMouseX);
    const bool hasAnchorDegrees =
      DecodeAngleUiDoubleValue(extra->u.do_click.continue_refcon[3], &anchorDegrees);
    if (!hasAnchorMouseX || !hasAnchorDegrees) {
      return PF_Err_NONE;
    }

    const double deltaPixels = static_cast<double>(mousePoint.h) - anchorMouseX;
    const bool isScrubbing =
      std::fabs(deltaPixels) >= kAngleControlScrubActivationDistance;
    if (isScrubbing) {
      int anchorTurns = 0;
      double anchorCycleDegrees = 0.0;
      SplitAngleUiDegrees(anchorDegrees, &anchorTurns, &anchorCycleDegrees);
      if (dragTarget == AngleUiDragTarget::kTurnsText) {
        const double turnDelta = deltaPixels / kAngleControlTurnsPixelsPerTurn;
        const int roundedTurns =
          static_cast<int>(std::round(static_cast<double>(anchorTurns) + turnDelta));
        nextDegrees = ComposeAngleUiDegrees(roundedTurns, anchorCycleDegrees);
      } else {
        nextDegrees = ComposeAngleUiDegrees(
          anchorTurns,
          anchorCycleDegrees + (deltaPixels * kAngleControlDegreesPerPixel)
        );
      }
      if (std::fabs(nextDegrees - currentDegrees) > 1e-6) {
        didChangeValue = true;
      }
    }

    UpdateAngleUiDragState(
      extra,
      slot,
      dragTarget,
      anchorMouseX,
      true,
      anchorDegrees,
      true,
      true
    );

    if (didChangeValue) {
      PF_Err persistErr = PersistAngleControllerValue(
        in_data,
        params,
        slot,
        nextDegrees,
        dragTarget == AngleUiDragTarget::kTurnsText ? "angle-ui-turns-scrub" : "angle-ui-degrees-scrub"
      );
      if (persistErr != PF_Err_NONE) {
        return persistErr;
      }
      MarkControllerParamHistoryDirty(
        in_data,
        ControllerAngleValueParamIndex(angleParamSlot),
        dragTarget == AngleUiDragTarget::kTurnsText ? "angle-ui-turns-scrub" : "angle-ui-degrees-scrub",
        params[PARAM_INSTANCE_ID] ? params[PARAM_INSTANCE_ID]->u.sd.value : 0
      );
    }

    RequestCustomUIRefresh(in_data, out_data, extra, true);
    extra->evt_out_flags |= PF_EO_HANDLED_EVENT;
    return PF_Err_NONE;
  }

  if (dragTarget != AngleUiDragTarget::kKnob) {
    return PF_Err_NONE;
  }

  const AngleUiLayout layout = ComputeAngleUiLayout(extra->effect_win.current_frame);
  double pointerDegrees = 0.0;
  const bool hasPointerDegrees =
    TryComputeAngleUiPointerDegrees(layout, mousePoint, &pointerDegrees);
  double previousPointerDegrees = 0.0;
  const bool hasPreviousPointerDegrees =
    DecodeAngleUiDoubleValue(extra->u.do_click.continue_refcon[2], &previousPointerDegrees);
  if (hasPointerDegrees && hasPreviousPointerDegrees) {
    const double deltaDegrees =
      NormalizeAngleUiDelta(pointerDegrees - previousPointerDegrees);
    if (std::fabs(deltaDegrees) > 1e-6) {
      nextDegrees = currentDegrees + deltaDegrees;
      didChangeValue = true;
    }
  }
  UpdateAngleUiDragState(
    extra,
    slot,
    dragTarget,
    pointerDegrees,
    hasPointerDegrees,
    0.0,
    false,
    true
  );

  if (didChangeValue) {
    PF_Err persistErr = PersistAngleControllerValue(
      in_data,
      params,
      slot,
      nextDegrees,
      "angle-ui-drag"
    );
    if (persistErr != PF_Err_NONE) {
      return persistErr;
    }
    MarkControllerParamHistoryDirty(
      in_data,
      ControllerAngleValueParamIndex(angleParamSlot),
      "angle-ui-drag",
      params[PARAM_INSTANCE_ID] ? params[PARAM_INSTANCE_ID]->u.sd.value : 0
    );
  }

  RequestCustomUIRefresh(in_data, out_data, extra, true);
  return PF_Err_NONE;
}

PF_Err AdjustAngleControllerCursor(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  PF_EventExtra* extra
) {
  (void)out_data;
  if (!extra || !extra->contextH) {
    return PF_Err_NONE;
  }
  if ((*extra->contextH)->w_type != PF_Window_EFFECT || extra->effect_win.area != PF_EA_CONTROL) {
    return PF_Err_NONE;
  }

  std::string bundleError;
  const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, params, &bundleError);
  int slot = -1;
  if (!TryResolveAngleUiSlot(bundle, extra->effect_win.index, &slot)) {
    return PF_Err_NONE;
  }

  const PF_Point mousePoint = *reinterpret_cast<PF_Point*>(&extra->u.adjust_cursor.screen_point);
  const AngleUiLayout layout = ComputeAngleUiLayout(extra->effect_win.current_frame);
  switch (ResolveAngleUiHitTarget(layout, mousePoint)) {
    case AngleUiDragTarget::kKnob:
      extra->u.adjust_cursor.set_cursor = PF_Cursor_ROTATE_Z;
      extra->evt_out_flags |= PF_EO_HANDLED_EVENT;
      break;
    case AngleUiDragTarget::kTurnsText:
    case AngleUiDragTarget::kDegreesText:
      extra->u.adjust_cursor.set_cursor = PF_Cursor_FINGER_POINTER_SCRUB;
      extra->evt_out_flags |= PF_EO_HANDLED_EVENT;
      break;
    default:
      break;
  }
  return PF_Err_NONE;
}

PF_Err HandleCustomEffectUIEvent(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  PF_LayerDef* output,
  PF_EventExtra* extra
) {
  (void)output;
  if (!extra || !extra->contextH) {
    return PF_Err_NONE;
  }
  if ((*extra->contextH)->w_type != PF_Window_EFFECT) {
    return PF_Err_NONE;
  }

  switch (extra->e_type) {
    case PF_Event_DO_CLICK: {
      const PF_Err colorErr = ClickColorControllerUi(in_data, out_data, params, extra);
      if (colorErr != PF_Err_NONE) {
        return colorErr;
      }
      if (extra->evt_out_flags & PF_EO_HANDLED_EVENT) {
        return PF_Err_NONE;
      }
      return BeginAngleControllerDrag(in_data, out_data, params, extra);
    }
    case PF_Event_DRAG:
      return UpdateAngleControllerDrag(in_data, out_data, params, extra);
    case PF_Event_DRAW: {
      const PF_Err colorErr = DrawColorControllerUi(in_data, out_data, params, extra);
      if (colorErr != PF_Err_NONE) {
        return colorErr;
      }
      if (extra->evt_out_flags & PF_EO_HANDLED_EVENT) {
        return PF_Err_NONE;
      }
      return DrawAngleControllerUi(in_data, out_data, params, extra);
    }
    case PF_Event_ADJUST_CURSOR:
      return AdjustAngleControllerCursor(in_data, out_data, params, extra);
    default:
      return PF_Err_NONE;
  }
}

PF_Err HandleUserChangedParam(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  const PF_UserChangedParamExtra* extra
) {
  if (!in_data || !extra) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  if (extra->param_index == PARAM_INSTANCE_ID) {
    const A_long instanceId =
      params && params[PARAM_INSTANCE_ID] ? params[PARAM_INSTANCE_ID]->u.sd.value : 0;
    ResolveStableInstanceId(in_data, instanceId);
    PF_Err snapshotErr = SyncSequenceRuntimeSnapshotFromLocalFiles(in_data, out_data, params);
    if (snapshotErr != PF_Err_NONE) {
      return snapshotErr;
    }

    // Setting the transport id is the one guaranteed creation-time change,
    // even when Revision happens to be zero. Initialize every controller kind
    // here exactly once; native and custom controls must share this lifecycle.
    const A_long revision =
      params && params[PARAM_REVISION] ? params[PARAM_REVISION]->u.sd.value : -1;
    std::string bundleError;
    const RuntimeSketchBundle bundle =
      ReadEffectRuntimeSketchBundle(in_data, params, &bundleError);
    if (LookupSyncedRevision(in_data, params) < 0 &&
        !bundle.controllerHash.empty()) {
      PF_Err syncErr = SyncControllerParamValuesFromBundle(
        in_data,
        out_data,
        params,
        bundle,
        "instance-created"
      );
      if (syncErr != PF_Err_NONE) {
        return syncErr;
      }
      RegisterSyncedRevision(in_data, params, revision);
      RegisterSyncedControllerHash(in_data, params, bundle.controllerHash);
    }
    return PF_Err_NONE;
  }

  if (extra->param_index == PARAM_REVISION) {
    PF_Err snapshotErr = SyncSequenceRuntimeSnapshotFromLocalFiles(in_data, out_data, params);
    if (snapshotErr != PF_Err_NONE) {
      return snapshotErr;
    }
    const A_long revision = params && params[PARAM_REVISION] ? params[PARAM_REVISION]->u.sd.value : -1;
    std::string bundleError;
    const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, params, &bundleError);
    if (bundle.controllerHash.empty()) {
      // The creation transport has not become visible yet. Do not stamp an
      // empty schema as initialized; a later instance/revision callback can
      // still apply the real defaults.
      return PF_Err_NONE;
    }
    const bool revisionChanged = LookupSyncedRevision(in_data, params) != revision;
    const std::string syncedControllerHash = LookupSyncedControllerHash(in_data, params);
    const bool controllerHashChanged =
      !syncedControllerHash.empty() && syncedControllerHash != bundle.controllerHash;
    if (revisionChanged || controllerHashChanged) {
      PF_Err syncErr = SyncControllerParamValuesFromBundle(
        in_data,
        out_data,
        params,
        bundle,
        "revision-changed"
      );
      if (syncErr != PF_Err_NONE) {
        return syncErr;
      }
      RegisterSyncedRevision(in_data, params, revision);
      RegisterSyncedControllerHash(in_data, params, bundle.controllerHash);
    } else if (syncedControllerHash.empty()) {
      // A duplicated/reloaded effect has its own sequence runtime but already owns
      // initialized AE parameters and an embedded sequence snapshot. Seed the
      // process-local schema marker without resetting the copied controller values.
      RegisterSyncedControllerHash(in_data, params, bundle.controllerHash);
    }
    return PF_Err_NONE;
  }

  if (!IsControllerParamIndex(extra->param_index)) {
    return PF_Err_NONE;
  }

  int sliderSlot = -1;
  int angleParamSlot = -1;
  int colorSlot = -1;
  (void)TryMapSliderParamIndexToSlot(extra->param_index, &sliderSlot);
  const bool angleValueChanged =
    TryMapAngleValueParamIndexToSlot(extra->param_index, &angleParamSlot);
  const bool angleUiChanged =
    TryMapAngleUiParamIndexToSlot(extra->param_index, &angleParamSlot);
  const bool colorValueChanged = TryMapColorParamIndexToSlot(extra->param_index, &colorSlot);
  MarkControllerParamHistoryDirty(
    in_data,
    (angleValueChanged || angleUiChanged)
      ? ControllerAngleValueParamIndex(angleParamSlot)
      : colorValueChanged
        ? ControllerColorValueParamIndex(colorSlot)
      : extra->param_index,
    "controller-param-changed",
    params && params[PARAM_INSTANCE_ID]
      ? params[PARAM_INSTANCE_ID]->u.sd.value
      : 0
  );
  if (sliderSlot >= 0) {
    PF_ParamDef* sliderParam = params[ControllerSliderParamIndex(sliderSlot)];
    if (sliderParam) {
      std::string bundleError;
      const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, params, &bundleError);
      const int sliderLogicalSlot = ResolveLogicalSlotForControllerParamSlot(
        bundle,
        RuntimeControllerSlotKind::kSlider,
        sliderSlot
      );
      const RuntimeSliderControllerSpec config =
        sliderLogicalSlot >= 0
          ? ResolveSliderControllerSpecWithDefaults(bundle, sliderLogicalSlot)
          : RuntimeSliderControllerSpec();
      const double rawValue = static_cast<double>(sliderParam->u.fs_d.value);
      const double snappedValue = ClampAndSnapSliderValue(rawValue, config);
      if (std::fabs(snappedValue - rawValue) > 1e-6) {
        sliderParam->u.fs_d.value = static_cast<PF_FpLong>(snappedValue);
        sliderParam->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
      }
    }
  }
  // Standard parameter edits already invalidate rendering. Any value adjusted
  // above uses PF_ChangeFlag_CHANGED_VALUE, which also requests a rerender.
  // REFRESH_UI is not a valid USER_CHANGED_PARAM return flag and forcing a
  // rerender here causes unnecessary full cache invalidation on every drag tick.
  (void)out_data;
  return PF_Err_NONE;
}

PF_Err UpdateParamsUI(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[]
) {
  PF_Err snapshotErr = SyncSequenceRuntimeSnapshotFromLocalFiles(in_data, out_data, params);
  if (snapshotErr != PF_Err_NONE) {
    return snapshotErr;
  }
  std::string bundleError;
  const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, params, &bundleError);
  // UPDATE_PARAMS_UI is metadata-only. AE owns controller values and keyframes;
  // writing defaults here races the user's edit and makes controls snap back.
  // Crucially, this selector must not stamp value-initialization markers. It
  // often runs before the creation-time Instance/Revision callbacks; doing so
  // would make those callbacks incorrectly skip the actual default values.

  const auto runtimeKey = ResolveEffectRuntimeKey(in_data);
  const std::string appliedUiHash = GetEffectSessionControllerUiHash(runtimeKey);
  if (runtimeKey != 0 && !bundle.controllerHash.empty() &&
      appliedUiHash == bundle.controllerHash) {
    return PF_Err_NONE;
  }

  const PF_Err uiErr = SyncControllerParamUI(in_data, out_data, params);
  if (uiErr == PF_Err_NONE && runtimeKey != 0 && !bundle.controllerHash.empty()) {
    SetEffectSessionControllerUiHash(runtimeKey, bundle.controllerHash);
  }
  return uiErr;
}

PF_LayerDef MakeSceneSurface(const PF_LayerDef& outputWorld, const RenderInvocationInfo& invocation) {
  PF_LayerDef sceneSurface = outputWorld;
  sceneSurface.width = std::max<A_long>(1, invocation.canvasWidth);
  sceneSurface.height = std::max<A_long>(1, invocation.canvasHeight);
  return sceneSurface;
}

struct OutputCopyOriginInfo {
  double sourceOriginX = 0.0;
  double sourceOriginY = 0.0;
  double sourceStepX = 1.0;
  double sourceStepY = 1.0;
  bool outputLooksLikeTile = false;
  const char* mode = "zero";
};

OutputCopyOriginInfo ResolveOutputCopyOrigin(
  const PF_LayerDef& outputWorld,
  const RenderInvocationInfo& invocation
) {
  OutputCopyOriginInfo result;
  const A_long canvasWidth = std::max<A_long>(1, invocation.canvasWidth);
  const A_long canvasHeight = std::max<A_long>(1, invocation.canvasHeight);
  const A_long renderCanvasWidth = std::max<A_long>(1, invocation.renderCanvasWidth);
  const A_long renderCanvasHeight = std::max<A_long>(1, invocation.renderCanvasHeight);
  // Derive the copy step from the actual integer render canvas, rather than
  // only inverting AE's rational scale. This keeps the far/right edges in the
  // image when an odd logical dimension is rounded down by the host.
  result.sourceStepX = static_cast<double>(canvasWidth) /
    static_cast<double>(renderCanvasWidth);
  result.sourceStepY = static_cast<double>(canvasHeight) /
    static_cast<double>(renderCanvasHeight);
  const A_long requestedTileWidth = std::max<A_long>(0, invocation.tileRight - invocation.tileLeft);
  const A_long requestedTileHeight = std::max<A_long>(0, invocation.tileBottom - invocation.tileTop);
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

  // Smart Render world origins and PreRender rectangles are expressed in AE
  // layer coordinates, even when the backing buffer has been downsampled.
  // Keep the origin logical and use sourceStep only for successive physical
  // output pixels. Multiplying origin_x/y by sourceStep here a second time
  // makes a moving ROI sample farther to the right/bottom and presents the
  // rendered content in the opposite direction during controller drags.
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

struct LegacySequenceCacheDataHeader {
  A_u_long magic = 0;
  A_u_long version = 0;
  std::uint64_t instanceId = 0;
  A_long syncedRevision = -1;
};

struct SnapshotSequenceCacheDataHeader {
  A_u_long magic = 0;
  A_u_long version = 0;
  std::uint64_t instanceId = 0;
  A_long syncedRevision = -1;
  A_u_long bundleTextSize = 0;
  A_u_long sourceTextSize = 0;
};

struct SharedRuntimeSequenceCacheDataHeader {
  A_u_long magic = 0;
  A_u_long version = 0;
  std::uint64_t instanceId = 0;
  A_long syncedRevision = -1;
  A_u_long bundleTextSize = 0;
  A_u_long sourceTextSize = 0;
  std::uint64_t runtimeIdentity = 0;
};

bool IsCompatibleSequenceDataVersion(A_u_long version) {
  return
    version == kSequenceCacheDataLegacyVersion ||
    version == kSequenceCacheDataSnapshotVersion ||
    version == kSequenceCacheDataSharedRuntimeVersion ||
    version == kSequenceCacheDataVersion;
}

std::uint64_t NextSequenceUiSessionToken() {
  static std::atomic<std::uint64_t> nextIdentity{
    static_cast<std::uint64_t>(
      std::chrono::high_resolution_clock::now().time_since_epoch().count()
    ) | 1ULL
  };
  std::uint64_t identity = nextIdentity.fetch_add(2, std::memory_order_relaxed);
  if (identity == 0) {
    identity = nextIdentity.fetch_add(2, std::memory_order_relaxed);
  }
  return identity;
}

enum class SequenceUiSessionMode {
  kReuseExisting,
  kCreateFresh
};

bool ReadCompatibleSequenceDataHeader(
  PF_InData* in_data,
  PF_ConstHandle handle,
  SequenceCacheData* outHeader
) {
  if (!in_data || !handle || !outHeader) {
    return false;
  }

  const auto handleSize = PF_GET_HANDLE_SIZE(handle);
  if (handleSize < sizeof(LegacySequenceCacheDataHeader)) {
    return false;
  }

  const auto* legacyHeader =
    reinterpret_cast<const LegacySequenceCacheDataHeader*>(DH(handle));
  if (!legacyHeader ||
      legacyHeader->magic != kSequenceCacheDataMagic ||
      !IsCompatibleSequenceDataVersion(legacyHeader->version)) {
    return false;
  }

  AEFX_CLR_STRUCT(*outHeader);
  outHeader->magic = legacyHeader->magic;
  outHeader->version = legacyHeader->version;
  outHeader->instanceId = legacyHeader->instanceId;
  outHeader->syncedRevision = legacyHeader->syncedRevision;

  if ((legacyHeader->version == kSequenceCacheDataSnapshotVersion ||
       legacyHeader->version == kSequenceCacheDataSharedRuntimeVersion ||
       legacyHeader->version == kSequenceCacheDataVersion) &&
      handleSize >= sizeof(SnapshotSequenceCacheDataHeader)) {
    const auto* snapshotHeader =
      reinterpret_cast<const SnapshotSequenceCacheDataHeader*>(legacyHeader);
    outHeader->bundleTextSize = snapshotHeader->bundleTextSize;
    outHeader->sourceTextSize = snapshotHeader->sourceTextSize;
  }
  if (legacyHeader->version == kSequenceCacheDataVersion &&
      handleSize >= sizeof(SequenceCacheData)) {
    const auto* sequenceData =
      reinterpret_cast<const SequenceCacheData*>(legacyHeader);
    outHeader->uiSessionToken = sequenceData->uiSessionToken;
  }
  return true;
}

PF_Err EnsureSequenceDataHandleInitialized(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_Handle* outHandle,
  SequenceUiSessionMode uiSessionMode
) {
  if (!in_data || !outHandle) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  const auto previousRuntimeKey = ResolveEffectRuntimeKey(in_data);
  PF_Handle handle = in_data->sequence_data;
  const PF_ConstHandle sourceHandle = handle
    ? reinterpret_cast<PF_ConstHandle>(handle)
    : runtime_internal::ResolveEffectSequenceDataHandle(in_data);
  SequenceCacheData header;
  const bool hadCompatibleHeader =
    ReadCompatibleSequenceDataHeader(in_data, sourceHandle, &header);

  if (uiSessionMode == SequenceUiSessionMode::kReuseExisting &&
      handle &&
      hadCompatibleHeader &&
      header.version == kSequenceCacheDataVersion &&
      header.uiSessionToken != 0 &&
      PF_GET_HANDLE_SIZE(handle) >= sizeof(SequenceCacheData)) {
    if (out_data) {
      out_data->sequence_data = handle;
    }
    *outHandle = handle;
    return PF_Err_NONE;
  }

  std::vector<char> preservedPayload;
  if (sourceHandle && hadCompatibleHeader &&
      (header.version == kSequenceCacheDataSnapshotVersion ||
       header.version == kSequenceCacheDataSharedRuntimeVersion ||
       header.version == kSequenceCacheDataVersion)) {
    const std::size_t oldHeaderSize =
      header.version == kSequenceCacheDataVersion
        ? sizeof(SequenceCacheData)
        : (header.version == kSequenceCacheDataSharedRuntimeVersion
            ? sizeof(SharedRuntimeSequenceCacheDataHeader)
            : sizeof(SnapshotSequenceCacheDataHeader));
    const std::size_t payloadBytes =
      static_cast<std::size_t>(header.bundleTextSize) +
      static_cast<std::size_t>(header.sourceTextSize);
    if (PF_GET_HANDLE_SIZE(sourceHandle) >= oldHeaderSize + payloadBytes && payloadBytes > 0) {
      const char* oldPayload =
        reinterpret_cast<const char*>(DH(sourceHandle)) + oldHeaderSize;
      preservedPayload.assign(oldPayload, oldPayload + payloadBytes);
    }
  }

  const std::size_t requiredSize = sizeof(SequenceCacheData) + preservedPayload.size();

  PF_Err err = PF_Err_NONE;
  if (!handle) {
    handle = PF_NEW_HANDLE(static_cast<A_u_long>(requiredSize));
    if (!handle) {
      return PF_Err_OUT_OF_MEMORY;
    }
  } else {
    err = PF_RESIZE_HANDLE(static_cast<A_u_long>(requiredSize), &handle);
    if (err != PF_Err_NONE) {
      return err;
    }
  }

  auto* sequenceData = reinterpret_cast<SequenceCacheData*>(DH(handle));
  if (!sequenceData) {
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  AEFX_CLR_STRUCT(*sequenceData);
  sequenceData->magic = kSequenceCacheDataMagic;
  sequenceData->version = kSequenceCacheDataVersion;
  sequenceData->uiSessionToken = NextSequenceUiSessionToken();
  if (hadCompatibleHeader) {
    sequenceData->instanceId = header.instanceId;
    sequenceData->syncedRevision = header.syncedRevision;
    sequenceData->bundleTextSize = header.bundleTextSize;
    sequenceData->sourceTextSize = header.sourceTextSize;
  }
  if (!preservedPayload.empty()) {
    std::memcpy(sequenceData + 1, preservedPayload.data(), preservedPayload.size());
  }

  in_data->sequence_data = handle;
  if (out_data) {
    out_data->sequence_data = handle;
  }
  const auto currentRuntimeKey = ResolveEffectRuntimeKey(in_data);
  // A fresh session is requested by AE lifecycle selectors such as Resetup.
  // The prior token can belong to the source effect when AE has duplicated the
  // sequence handle in memory, so deleting it here would invalidate the source
  // effect's UI state. Reuse-mode replacements own their prior session and may
  // safely retire it.
  if (uiSessionMode == SequenceUiSessionMode::kReuseExisting &&
      previousRuntimeKey &&
      previousRuntimeKey != currentRuntimeKey) {
    DiscardEffectRuntimeState(previousRuntimeKey, "sequence-handle-replaced");
  }
  *outHandle = handle;
  return PF_Err_NONE;
}

bool SequenceRuntimeSnapshotMatches(
  PF_InData* in_data,
  PF_Handle handle,
  const std::string& bundleText,
  const std::string& sourceText
) {
  SequenceCacheData header;
  if (!ReadCompatibleSequenceDataHeader(
        in_data,
        reinterpret_cast<PF_ConstHandle>(handle),
        &header
      ) ||
      header.version != kSequenceCacheDataVersion) {
    return false;
  }

  const std::size_t payloadBytes =
    static_cast<std::size_t>(header.bundleTextSize) +
    static_cast<std::size_t>(header.sourceTextSize);
  const std::size_t expectedSize = sizeof(SequenceCacheData) + payloadBytes;
  if (PF_GET_HANDLE_SIZE(handle) < expectedSize) {
    return false;
  }

  if (header.bundleTextSize != bundleText.size() ||
      header.sourceTextSize != sourceText.size()) {
    return false;
  }

  const auto* sequenceData = reinterpret_cast<const SequenceCacheData*>(DH(handle));
  if (!sequenceData) {
    return false;
  }

  const char* payload = reinterpret_cast<const char*>(sequenceData + 1);
  const bool bundleMatches =
    bundleText.empty() ||
    std::memcmp(payload, bundleText.data(), bundleText.size()) == 0;
  const bool sourceMatches =
    sourceText.empty() ||
    std::memcmp(payload + header.bundleTextSize, sourceText.data(), sourceText.size()) == 0;
  return bundleMatches && sourceMatches;
}

std::optional<std::string> ReadEmbeddedSequenceBundleText(PF_InData* in_data) {
  if (!in_data || !in_data->sequence_data) {
    return std::nullopt;
  }

  SequenceCacheData header;
  if (!ReadCompatibleSequenceDataHeader(
        in_data,
        reinterpret_cast<PF_ConstHandle>(in_data->sequence_data),
        &header
      ) ||
      header.version != kSequenceCacheDataVersion ||
      header.bundleTextSize == 0 ||
      header.sourceTextSize == 0) {
    return std::nullopt;
  }

  const std::size_t payloadBytes =
    static_cast<std::size_t>(header.bundleTextSize) +
    static_cast<std::size_t>(header.sourceTextSize);
  const std::size_t expectedSize = sizeof(SequenceCacheData) + payloadBytes;
  if (PF_GET_HANDLE_SIZE(in_data->sequence_data) < expectedSize) {
    return std::nullopt;
  }

  const auto* sequenceData =
    reinterpret_cast<const SequenceCacheData*>(DH(in_data->sequence_data));
  if (!sequenceData) {
    return std::nullopt;
  }
  const char* payload = reinterpret_cast<const char*>(sequenceData + 1);
  return std::string(payload, header.bundleTextSize);
}

PF_Err WriteSequenceRuntimeSnapshot(
  PF_InData* in_data,
  PF_OutData* out_data,
  const std::string& bundleText,
  const std::string& sourceText
) {
  if (!in_data) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  PF_Handle handle = NULL;
  PF_Err err = EnsureSequenceDataHandleInitialized(
    in_data,
    out_data,
    &handle,
    SequenceUiSessionMode::kReuseExisting
  );
  if (err != PF_Err_NONE) {
    return err;
  }

  if (SequenceRuntimeSnapshotMatches(in_data, handle, bundleText, sourceText)) {
    return PF_Err_NONE;
  }

  const auto previousRuntimeKey = ResolveEffectRuntimeKey(in_data);
  const std::size_t requiredSize =
    sizeof(SequenceCacheData) + bundleText.size() + sourceText.size();
  err = PF_RESIZE_HANDLE(static_cast<A_u_long>(requiredSize), &handle);
  if (err != PF_Err_NONE) {
    return err;
  }

  auto* sequenceData = reinterpret_cast<SequenceCacheData*>(DH(handle));
  if (!sequenceData) {
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  const std::uint64_t preservedInstanceId = sequenceData->instanceId;
  const std::uint64_t preservedUiSessionToken = sequenceData->uiSessionToken;
  const A_long preservedSyncedRevision = sequenceData->syncedRevision;
  AEFX_CLR_STRUCT(*sequenceData);
  sequenceData->magic = kSequenceCacheDataMagic;
  sequenceData->version = kSequenceCacheDataVersion;
  sequenceData->instanceId = preservedInstanceId;
  sequenceData->syncedRevision = preservedSyncedRevision;
  sequenceData->bundleTextSize = static_cast<A_u_long>(bundleText.size());
  sequenceData->sourceTextSize = static_cast<A_u_long>(sourceText.size());
  sequenceData->uiSessionToken = preservedUiSessionToken;

  char* payload = reinterpret_cast<char*>(sequenceData + 1);
  if (!bundleText.empty()) {
    std::memcpy(payload, bundleText.data(), bundleText.size());
  }
  if (!sourceText.empty()) {
    std::memcpy(payload + bundleText.size(), sourceText.data(), sourceText.size());
  }

  in_data->sequence_data = handle;
  if (out_data) {
    out_data->sequence_data = handle;
  }
  const auto currentRuntimeKey = ResolveEffectRuntimeKey(in_data);
  if (previousRuntimeKey && previousRuntimeKey != currentRuntimeKey) {
    DiscardEffectRuntimeState(previousRuntimeKey, "sequence-snapshot-resized");
  }
  return PF_Err_NONE;
}

PF_Err CopyFlattenedDocumentSnapshot(PF_InData* in_data, PF_OutData* out_data) {
  if (!out_data) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  const PF_ConstHandle sourceHandle =
    runtime_internal::ResolveEffectSequenceDataHandle(in_data);
  if (!in_data || !sourceHandle) {
    out_data->sequence_data = NULL;
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  const auto handleSize = PF_GET_HANDLE_SIZE(sourceHandle);
  PF_Handle copyHandle = PF_NEW_HANDLE(handleSize);
  if (!copyHandle) {
    return PF_Err_OUT_OF_MEMORY;
  }

  void* destination = DH(copyHandle);
  const void* source = DH(sourceHandle);
  if (!destination || !source) {
    PF_DISPOSE_HANDLE(copyHandle);
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  std::memcpy(destination, source, handleSize);
  auto* flattenedData = reinterpret_cast<SequenceCacheData*>(destination);
  if (flattenedData &&
      flattenedData->magic == kSequenceCacheDataMagic &&
      flattenedData->version == kSequenceCacheDataVersion) {
    // Flattened data is an immutable Document snapshot. It must never carry
    // process-local UI identity into a duplicate, render worker, or reopened
    // project. Render correctness is owned by RenderInvocationInfo.
    flattenedData->uiSessionToken = 0;
  }
  out_data->sequence_data = copyHandle;
  return PF_Err_NONE;
}

std::uint64_t NextSequenceInstanceId() {
  static std::atomic<std::uint64_t> nextId{1};
  return nextId.fetch_add(1, std::memory_order_relaxed);
}

std::uint64_t ReadSequenceInstanceId(PF_InData* in_data, PF_Handle handle) {
  if (!in_data || !handle) {
    return 0;
  }

  auto* sequenceData = reinterpret_cast<SequenceCacheData*>(DH(handle));
  if (!sequenceData) {
    return 0;
  }

  const bool valid =
    sequenceData->magic == kSequenceCacheDataMagic &&
    IsCompatibleSequenceDataVersion(sequenceData->version) &&
    sequenceData->instanceId != 0;
  return valid ? sequenceData->instanceId : 0;
}

bool WriteSequenceInstanceId(PF_InData* in_data, PF_Handle handle, std::uint64_t instanceId) {
  if (!in_data || !handle || instanceId == 0) {
    return false;
  }

  auto* sequenceData = reinterpret_cast<SequenceCacheData*>(DH(handle));
  if (!sequenceData) {
    return false;
  }

  const bool valid =
    sequenceData->magic == kSequenceCacheDataMagic &&
    IsCompatibleSequenceDataVersion(sequenceData->version);
  if (valid) {
    sequenceData->instanceId = instanceId;
  }
  return valid;
}

A_long ReadSequenceSyncedRevision(PF_InData* in_data, PF_Handle handle) {
  if (!in_data || !handle) {
    return -1;
  }

  auto* sequenceData = reinterpret_cast<SequenceCacheData*>(DH(handle));
  if (!sequenceData) {
    return -1;
  }

  const bool valid =
    sequenceData->magic == kSequenceCacheDataMagic &&
    IsCompatibleSequenceDataVersion(sequenceData->version);
  return valid ? sequenceData->syncedRevision : -1;
}

bool WriteSequenceSyncedRevision(PF_InData* in_data, PF_Handle handle, A_long revision) {
  if (!in_data || !handle) {
    return false;
  }

  auto* sequenceData = reinterpret_cast<SequenceCacheData*>(DH(handle));
  if (!sequenceData) {
    return false;
  }

  const bool valid =
    sequenceData->magic == kSequenceCacheDataMagic &&
    IsCompatibleSequenceDataVersion(sequenceData->version);
  if (valid) {
    sequenceData->syncedRevision = revision;
  }
  return valid;
}

PF_Err SyncControllerParamValuesFromBundle(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  const RuntimeSketchBundle& bundle,
  const char* reason
) {
  if (!in_data || !params) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  for (int logicalSlot = 0; logicalSlot < kControllerSlotCount; ++logicalSlot) {
    const RuntimeControllerSlotKind kind = ResolveControllerSlotKind(bundle, logicalSlot);

    PF_ParamDef* pointParam = params[ControllerPointParamIndex(logicalSlot)];
    if (pointParam) {
      pointParam->u.td.x_value = DoubleToFixed(0.0);
      pointParam->u.td.y_value = DoubleToFixed(0.0);
      pointParam->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
    }

    PF_ParamDef* sliderParam = params[ControllerSliderParamIndex(logicalSlot)];
    if (sliderParam) {
      sliderParam->u.fs_d.value = 0.0;
      sliderParam->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
    }

    WriteColorControllerValueToParams(
      in_data,
      params,
      logicalSlot,
      MakeUnsetColorValue()
    );

    PF_ParamDef* checkboxParam = params[ControllerCheckboxParamIndex(logicalSlot)];
    if (checkboxParam) {
      checkboxParam->u.bd.value = FALSE;
      checkboxParam->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
    }

    PF_ParamDef* selectParam = params[ControllerSelectParamIndex(logicalSlot)];
    if (selectParam) {
      selectParam->u.pd.value = 1;
      selectParam->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
    }

    WriteAngleControllerValueToParams(params, logicalSlot, 0.0);

    switch (kind) {
      case RuntimeControllerSlotKind::kSlider: {
        PF_ParamDef* param = params[ControllerSliderParamIndex(logicalSlot)];
        if (param) {
          const RuntimeSliderControllerSpec config =
            ResolveSliderControllerSpecWithDefaults(bundle, logicalSlot);
          param->u.fs_d.value = ClampAndSnapSliderValue(config.defaultValue, config);
          param->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
        }
        break;
      }

      case RuntimeControllerSlotKind::kAngle: {
        const RuntimeAngleControllerSpec config =
          ResolveAngleControllerSpecWithDefaults(bundle, logicalSlot);
        PF_Err persistErr = PersistAngleControllerValue(
          in_data,
          params,
          logicalSlot,
          config.defaultValue,
          reason
        );
        if (persistErr != PF_Err_NONE) {
          return persistErr;
        }
        break;
      }

      case RuntimeControllerSlotKind::kColor: {
        PF_Err persistErr = PersistColorControllerValue(
          in_data,
          params,
          logicalSlot,
          ResolveColorControllerSpecWithDefaults(bundle, logicalSlot).defaultValue,
          reason
        );
        if (persistErr != PF_Err_NONE) {
          return persistErr;
        }
        break;
      }

      case RuntimeControllerSlotKind::kCheckbox: {
        PF_ParamDef* param = params[ControllerCheckboxParamIndex(logicalSlot)];
        if (param) {
          const RuntimeCheckboxControllerSpec config =
            ResolveCheckboxControllerSpecWithDefaults(bundle, logicalSlot);
          param->u.bd.value = config.defaultValue ? TRUE : FALSE;
          param->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
        }
        break;
      }

      case RuntimeControllerSlotKind::kSelect: {
        PF_ParamDef* param = params[ControllerSelectParamIndex(logicalSlot)];
        if (param) {
          const RuntimeSelectControllerSpec config =
            ResolveSelectControllerSpecWithDefaults(bundle, logicalSlot);
          param->u.pd.value =
            static_cast<A_short>(ClampSelectControllerIndex(config.defaultValue, config) + 1);
          param->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
        }
        break;
      }

      case RuntimeControllerSlotKind::kPoint: {
        PF_ParamDef* param = params[ControllerPointParamIndex(logicalSlot)];
        if (param) {
          const ControllerPointValue point = ResolvePointControllerDefaultValue(bundle, logicalSlot);
          param->u.td.x_value = DoubleToFixed(point.x);
          param->u.td.y_value = DoubleToFixed(point.y);
          param->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
        }
        break;
      }

      case RuntimeControllerSlotKind::kNone:
      default:
        break;
    }
  }


  // Every migrated value is marked CHANGED_VALUE above, so AE owns the
  // undo/keyframe/rerender transaction. Do not add global UI or cache flushes.
  std::ostringstream detail;
  detail
    << "reason=" << (reason ? reason : "unknown")
    << " revision=" << bundle.revision
    << " controllerHash=" << bundle.controllerHash
    << " slots=" << bundle.controllerSlots.size();
  runtime_internal::AppendEffectRuntimeDiagnostic(
    in_data,
    "controller-defaults-applied",
    static_cast<A_long>(LookupRegisteredInstanceId(in_data)),
    static_cast<PF_ParamIndex>(-1),
    0,
    detail.str()
  );
  (void)out_data;
  return PF_Err_NONE;
}

void ClearSequenceDataOutput(PF_OutData* out_data) {
  if (out_data) {
    out_data->sequence_data = NULL;
  }
}

std::uint64_t ResolveStableInstanceId(PF_InData* in_data, A_long paramInstanceId) {
  if (paramInstanceId > 0) {
    const std::uint64_t parameterInstanceId =
      static_cast<std::uint64_t>(static_cast<A_u_long>(paramInstanceId));
    if (in_data && in_data->sequence_data) {
      WriteSequenceInstanceId(in_data, in_data->sequence_data, parameterInstanceId);
    }
    RegisterStableInstanceId(in_data, parameterInstanceId);
    return parameterInstanceId;
  }

  if (in_data && in_data->sequence_data) {
    const std::uint64_t sequenceInstanceId =
      ReadSequenceInstanceId(in_data, in_data->sequence_data);
    if (sequenceInstanceId != 0) {
      RegisterStableInstanceId(in_data, sequenceInstanceId);
      return sequenceInstanceId;
    }
  }

  const std::uint64_t registeredInstanceId = LookupRegisteredInstanceId(in_data);
  if (registeredInstanceId != 0) {
    return registeredInstanceId;
  }

  const std::uint64_t synthesizedInstanceId = NextSequenceInstanceId();
  RegisterStableInstanceId(in_data, synthesizedInstanceId);
  return synthesizedInstanceId;
}

PF_Err SyncSequenceRuntimeSnapshotFromLocalFiles(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[]
) {
  if (!in_data || !params || !params[PARAM_INSTANCE_ID]) {
    return PF_Err_NONE;
  }

  const A_long paramInstanceId = params[PARAM_INSTANCE_ID]->u.sd.value;
  const std::uint64_t instanceId = ResolveStableInstanceId(in_data, paramInstanceId);
  if (instanceId == 0) {
    return PF_Err_NONE;
  }

  const std::string bundlePath =
    runtime_internal::GetRuntimeInstanceBundlePath(static_cast<A_long>(instanceId));
  const std::string sourcePath =
    runtime_internal::GetRuntimeInstanceSketchPath(static_cast<A_long>(instanceId));
  const std::optional<std::string> bundleText = runtime_internal::ReadTextFile(bundlePath);
  const std::optional<std::string> sourceText = runtime_internal::ReadTextFile(sourcePath);
  if (!bundleText.has_value() || !sourceText.has_value()) {
    return PF_Err_NONE;
  }

  const A_long expectedRevision =
    params[PARAM_REVISION] ? params[PARAM_REVISION]->u.sd.value : -1;
  if (expectedRevision < 0) {
    return PF_Err_NONE;
  }

  // Once an effect owns a snapshot for its current revision, that embedded
  // definition is authoritative. This protects duplicated and reopened effects
  // from an unrelated AE session reusing and overwriting the same transport id.
  const std::optional<std::string> embeddedBundleText =
    ReadEmbeddedSequenceBundleText(in_data);
  if (embeddedBundleText.has_value()) {
    std::string embeddedError;
    const RuntimeSketchBundle embeddedBundle =
      runtime_internal::ReadRuntimeSketchBundleFromText(
        *embeddedBundleText,
        sourcePath,
        &embeddedError
      );
    if (embeddedBundle.revision == expectedRevision) {
      return PF_Err_NONE;
    }
  }

  // The external instance directory is a creation/update transport only. Do
  // not import a payload intended for another effect or another revision.
  std::string localError;
  const RuntimeSketchBundle localBundle =
    runtime_internal::ReadRuntimeSketchBundleFromText(
      *bundleText,
      sourcePath,
      &localError
    );
  if (localBundle.revision != expectedRevision) {
    return PF_Err_NONE;
  }

  return WriteSequenceRuntimeSnapshot(in_data, out_data, *bundleText, *sourceText);
}

PF_Err SequenceSetup(PF_InData* in_data, PF_OutData* out_data) {
  if (in_data) {
    const auto previousUiSessionToken = ResolveEffectRuntimeKey(in_data);
    PF_Handle sequenceHandle = NULL;
    PF_Err err = EnsureSequenceDataHandleInitialized(
      in_data,
      out_data,
      &sequenceHandle,
      SequenceUiSessionMode::kCreateFresh
    );
    if (err != PF_Err_NONE) {
      return err;
    }
    const auto currentUiSessionToken = ResolveEffectRuntimeKey(in_data);
    if (out_data) {
      out_data->out_flags |= PF_OutFlag_REFRESH_UI;
    }
    const std::uint64_t instanceId = ResolveStableInstanceId(in_data);
    RegisterStableInstanceId(in_data, instanceId);
    std::ostringstream detail;
    detail << "sequence-setup previousUiSession=" << previousUiSessionToken
           << " currentUiSession=" << currentUiSessionToken;
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "ui-session-created",
      static_cast<A_long>(instanceId),
      static_cast<PF_ParamIndex>(-1),
      0,
      detail.str()
    );
  }
  return PF_Err_NONE;
}

PF_Err SequenceResetup(PF_InData* in_data, PF_OutData* out_data) {
  if (in_data) {
    const auto previousUiSessionToken = ResolveEffectRuntimeKey(in_data);
    PF_Handle sequenceHandle = NULL;
    PF_Err err = EnsureSequenceDataHandleInitialized(
      in_data,
      out_data,
      &sequenceHandle,
      SequenceUiSessionMode::kCreateFresh
    );
    if (err != PF_Err_NONE) {
      return err;
    }
    const auto currentUiSessionToken = ResolveEffectRuntimeKey(in_data);
    if (out_data) {
      out_data->out_flags |= PF_OutFlag_REFRESH_UI;
    }
    const std::uint64_t instanceId = ResolveStableInstanceId(in_data);
    RegisterStableInstanceId(in_data, instanceId);
    std::ostringstream detail;
    detail << "sequence-resetup previousUiSession=" << previousUiSessionToken
           << " currentUiSession=" << currentUiSessionToken;
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "ui-session-created",
      static_cast<A_long>(instanceId),
      static_cast<PF_ParamIndex>(-1),
      0,
      detail.str()
    );
  }
  return PF_Err_NONE;
}

PF_Err SequenceFlatten(PF_InData* in_data, PF_OutData* out_data) {
  return CopyFlattenedDocumentSnapshot(in_data, out_data);
}

PF_Err GetFlattenedSequenceData(PF_InData* in_data, PF_OutData* out_data) {
  return CopyFlattenedDocumentSnapshot(in_data, out_data);
}

PF_Err SequenceSetdown(PF_InData* in_data, PF_OutData* out_data) {
  const auto runtimeKey = ResolveEffectRuntimeKey(in_data);
  const A_long instanceId = static_cast<A_long>(GetEffectSessionInstanceId(runtimeKey));
  if (runtimeKey && instanceId > 0) {
    InvalidateEffectPersistentRenderCaches(
      ResolveRenderLineageIdentity(in_data, instanceId),
      "sequence-setdown"
    );
  }
  DiscardControllerInteractionState(instanceId);
  DiscardEffectRuntimeState(runtimeKey, "sequence-setdown");
  if (in_data && in_data->sequence_data) {
    PF_DISPOSE_HANDLE(in_data->sequence_data);
    in_data->sequence_data = NULL;
  }
  ClearSequenceDataOutput(out_data);
  return PF_Err_NONE;
}

PF_Err BuildRenderInvocationInfo(
  PF_InData* in_data,
  RenderInvocationInfo** outInfo
) {
  if (!outInfo) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  auto* info = new (std::nothrow) RenderInvocationInfo();
  if (!info) {
    return PF_Err_OUT_OF_MEMORY;
  }

  info->runtimeKey = NextRenderInvocationRuntimeKey();
  info->revision = 0;
  info->instanceId = 0;
  info->canvasLeft = 0;
  info->canvasTop = 0;
  info->canvasWidth = in_data ? std::max<A_long>(1, in_data->width) : 1;
  info->canvasHeight = in_data ? std::max<A_long>(1, in_data->height) : 1;
  info->downsampleScaleX = in_data ? ResolveDownsampleScale(in_data->downsample_x) : 1.0;
  info->downsampleScaleY = in_data ? ResolveDownsampleScale(in_data->downsample_y) : 1.0;
  info->renderCanvasWidth = ScaleRenderDimension(info->canvasWidth, info->downsampleScaleX);
  info->renderCanvasHeight = ScaleRenderDimension(info->canvasHeight, info->downsampleScaleY);
  info->tileLeft = 0;
  info->tileTop = 0;
  info->tileRight = info->canvasLeft + info->canvasWidth;
  info->tileBottom = info->canvasTop + info->canvasHeight;

  PF_ParamDef param;
  AEFX_CLR_STRUCT(param);
  PF_Err err = PF_CHECKOUT_PARAM(
    in_data,
    PARAM_REVISION,
    in_data->current_time,
    in_data->time_step,
    in_data->time_scale,
    &param
  );
  if (err != PF_Err_NONE) {
    delete info;
    return err;
  }
  info->revision = param.u.sd.value;
  PF_CHECKIN_PARAM(in_data, &param);

  AEFX_CLR_STRUCT(param);
  err = PF_CHECKOUT_PARAM(
    in_data,
    PARAM_INSTANCE_ID,
    in_data->current_time,
    in_data->time_step,
    in_data->time_scale,
    &param
  );
  if (err != PF_Err_NONE) {
    delete info;
    return err;
  }
  info->instanceId = static_cast<A_long>(ResolveStableInstanceId(in_data, param.u.sd.value));
  PF_CHECKIN_PARAM(in_data, &param);

  info->lineageIdentity = ResolveRenderLineageIdentity(in_data, info->instanceId);
  info->preparationCacheKey = ResolveEffectPreparationCacheKey(info->lineageIdentity);
  info->renderCacheKey = ResolveEffectRenderCacheKeyForScale(
    info->lineageIdentity,
    info->downsampleScaleX,
    info->downsampleScaleY
  );

  if (!info->runtimeKey) {
    delete info;
    return PF_Err_OUT_OF_MEMORY;
  }

  *outInfo = info;
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

  const A_long canvasWidth = std::max<A_long>(1, invocation.canvasWidth);
  const A_long canvasHeight = std::max<A_long>(1, invocation.canvasHeight);
  const A_long sourceWidth = std::max<A_long>(1, rasterWidth);
  const A_long sourceHeight = std::max<A_long>(1, rasterHeight);
  const OutputCopyOriginInfo copyOrigin = ResolveOutputCopyOrigin(*output, invocation);
  const double sourceOriginX = copyOrigin.sourceOriginX;
  const double sourceOriginY = copyOrigin.sourceOriginY;
  const double sourceStepX = copyOrigin.sourceStepX;
  const double sourceStepY = copyOrigin.sourceStepY;
  const std::size_t rasterSize = raster->size();

  auto sampleSourcePixel = [&](double logicalX, double logicalY) -> PF_Pixel {
    if (logicalX < 0 || logicalY < 0 || logicalX >= canvasWidth || logicalY >= canvasHeight) {
      return PF_Pixel{0, 0, 0, 0};
    }
    const A_long sampleX = std::min<A_long>(
      sourceWidth - 1,
      std::max<A_long>(
        0,
        static_cast<A_long>(std::floor(
          logicalX * static_cast<double>(sourceWidth) / static_cast<double>(canvasWidth)
        ))
      )
    );
    const A_long sampleY = std::min<A_long>(
      sourceHeight - 1,
      std::max<A_long>(
        0,
        static_cast<A_long>(std::floor(
          logicalY * static_cast<double>(sourceHeight) / static_cast<double>(canvasHeight)
        ))
      )
    );
    const std::size_t sampleIndex = static_cast<std::size_t>(sampleY * sourceWidth + sampleX);
    if (sampleIndex >= rasterSize) {
      return PF_Pixel{0, 0, 0, 0};
    }
    return (*raster)[sampleIndex];
  };

  if (pixelFormat == PF_PixelFormat_ARGB32 &&
      sourceWidth == canvasWidth && sourceHeight == canvasHeight &&
      std::abs(sourceStepX - 1.0) < 1e-9 &&
      std::abs(sourceStepY - 1.0) < 1e-9 &&
      sourceOriginX >= 0.0 && sourceOriginY >= 0.0 &&
      std::floor(sourceOriginX) == sourceOriginX &&
      std::floor(sourceOriginY) == sourceOriginY &&
      sourceOriginX + output->width <= sourceWidth &&
      sourceOriginY + output->height <= sourceHeight) {
    const A_long integerOriginX = static_cast<A_long>(sourceOriginX);
    const A_long integerOriginY = static_cast<A_long>(sourceOriginY);
    const std::size_t copyBytes = static_cast<std::size_t>(output->width) * sizeof(PF_Pixel);
    for (A_long y = 0; y < output->height; ++y) {
      const PF_Pixel* sourceRow = raster->data() +
        static_cast<std::size_t>((integerOriginY + y) * sourceWidth + integerOriginX);
      void* outputRow = reinterpret_cast<A_u_char*>(output->data) + y * output->rowbytes;
      std::memcpy(outputRow, sourceRow, copyBytes);
    }
    return PF_Err_NONE;
  }

  switch (pixelFormat) {
    case PF_PixelFormat_ARGB128:
      for (A_long y = 0; y < output->height; ++y) {
        auto* row = reinterpret_cast<PF_PixelFloat*>(
          reinterpret_cast<A_u_char*>(output->data) + y * output->rowbytes
        );
        const double sourceY = sourceOriginY + (static_cast<double>(y) + 0.5) * sourceStepY;
        for (A_long x = 0; x < output->width; ++x) {
          const double sourceX = sourceOriginX + (static_cast<double>(x) + 0.5) * sourceStepX;
          const PF_Pixel source = sampleSourcePixel(sourceX, sourceY);
          row[x].alpha = static_cast<PF_FpShort>(static_cast<double>(source.alpha) / 255.0);
          row[x].red = static_cast<PF_FpShort>(static_cast<double>(source.red) / 255.0);
          row[x].green = static_cast<PF_FpShort>(static_cast<double>(source.green) / 255.0);
          row[x].blue = static_cast<PF_FpShort>(static_cast<double>(source.blue) / 255.0);
        }
      }
      return PF_Err_NONE;
    case PF_PixelFormat_ARGB64:
      for (A_long y = 0; y < output->height; ++y) {
        auto* row = reinterpret_cast<PF_Pixel16*>(
          reinterpret_cast<A_u_char*>(output->data) + y * output->rowbytes
        );
        const double sourceY = sourceOriginY + (static_cast<double>(y) + 0.5) * sourceStepY;
        for (A_long x = 0; x < output->width; ++x) {
          const double sourceX = sourceOriginX + (static_cast<double>(x) + 0.5) * sourceStepX;
          const PF_Pixel source = sampleSourcePixel(sourceX, sourceY);
          row[x] = ToPixel16(source);
        }
      }
      return PF_Err_NONE;
    case PF_PixelFormat_ARGB32:
    default:
      for (A_long y = 0; y < output->height; ++y) {
        auto* row = reinterpret_cast<PF_Pixel*>(
          reinterpret_cast<A_u_char*>(output->data) + y * output->rowbytes
        );
        const double sourceY = sourceOriginY + (static_cast<double>(y) + 0.5) * sourceStepY;
        for (A_long x = 0; x < output->width; ++x) {
          const double sourceX = sourceOriginX + (static_cast<double>(x) + 0.5) * sourceStepX;
          row[x] = sampleSourcePixel(sourceX, sourceY);
        }
      }
      return PF_Err_NONE;
  }
}

PF_Err RenderCurrentSketchToCpuWorld(
  PF_InData* in_data,
  PF_LayerDef* output,
  const RenderInvocationInfo& invocation,
  PF_PixelFormat pixelFormat
) {
  std::string errorMessage;
  PF_LayerDef sceneSurface = MakeSceneSurface(*output, invocation);
  const auto shouldCancel = [&invocation]() {
    return !IsCurrentControllerRenderRequest(invocation) ||
      !IsLatestControllerInteraction(invocation);
  };
  BitmapFramePlan framePlan;
  if (!BuildBitmapCpuFramePlanAtCurrentTime(
    in_data,
    invocation.runtimeKey,
    invocation.renderCacheKey,
    invocation.revision,
    invocation.instanceId,
    &sceneSurface,
    shouldCancel,
    &framePlan,
    &errorMessage
  )) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      errorMessage == "render-cancelled" ? "cpu-render-cancelled" : "cpu-frame-plan-failed",
      invocation.instanceId,
      static_cast<PF_ParamIndex>(-1),
      invocation.controllerTimelineTargetFrame,
      errorMessage
    );
    return errorMessage == "render-cancelled"
      ? PF_Interrupt_CANCEL
      : PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  std::vector<PF_Pixel> raster;
  if (!RenderBitmapFramePlanToCpuRaster(
        framePlan,
        &raster,
        shouldCancel,
        &errorMessage
      )) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      errorMessage == "render-cancelled" ? "cpu-render-cancelled" : "cpu-render-failed",
      invocation.instanceId,
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

PF_Err PreRender(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_PreRenderExtra* extra
) {
  const auto preRenderStarted = std::chrono::steady_clock::now();
  {
    std::ostringstream detail;
    detail
      << "extra=" << reinterpret_cast<std::uintptr_t>(extra)
      << " input=" << reinterpret_cast<std::uintptr_t>(extra ? extra->input : NULL)
      << " output=" << reinterpret_cast<std::uintptr_t>(extra ? extra->output : NULL)
      << " time=" << (in_data ? in_data->current_time : 0)
      << '/' << (in_data ? in_data->time_scale : 0);
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "prerender-enter",
      -1,
      static_cast<PF_ParamIndex>(-1),
      -1,
      detail.str()
    );
  }
  if (!extra || !extra->input || !extra->output) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "prerender-failed",
      -1,
      static_cast<PF_ParamIndex>(-1),
      -1,
      "invalid pre-render callback data"
    );
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  RenderInvocationInfo* info = NULL;
  PF_Err err = BuildRenderInvocationInfo(in_data, &info);
  if (err != PF_Err_NONE) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "prerender-failed",
      -1,
      static_cast<PF_ParamIndex>(-1),
      -1,
      std::string("invocation err=") + std::to_string(static_cast<long>(err))
    );
    return err;
  }
  // Capture the user's latest controller generation before reading the
  // immutable timeline. If another drag tick arrives while PreRender is
  // preparing this invocation, Smart Render will recognize it as obsolete and
  // drop it at entry instead of replaying an already stale controller value.
  info->controllerInteractionGeneration =
    ReadControllerInteractionGeneration(info->instanceId);

  std::string documentError;
  const auto documentStarted = std::chrono::steady_clock::now();
  if (!PrepareEffectRuntimeDocument(
        in_data,
        info->runtimeKey,
        info->preparationCacheKey,
        info->revision,
        info->instanceId,
        &documentError
      )) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "prerender-document-failed",
      info->instanceId,
      static_cast<PF_ParamIndex>(-1),
      -1,
      documentError
    );
    DisposeRenderInvocationInfo(info);
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  info->documentPrepareMs = ElapsedMilliseconds(documentStarted);

  const auto controllerTimelineStarted = std::chrono::steady_clock::now();
  if (!CaptureEffectControllerTimeline(
        in_data,
        info->runtimeKey,
        info->preparationCacheKey,
        &info->controllerTimelineTargetFrame,
        &info->controllerTimelineHash,
        &documentError
      )) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "prerender-controller-timeline-failed",
      info->instanceId,
      static_cast<PF_ParamIndex>(-1),
      -1,
      documentError
    );
    DisposeRenderInvocationInfo(info);
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  info->controllerTimelineMs = ElapsedMilliseconds(controllerTimelineStarted);
  info->controllerRequestGeneration = RegisterControllerRenderRequest(
    info->lineageIdentity,
    info->controllerTimelineTargetFrame,
    info->controllerTimelineHash
  );

  const auto dependencyMixStarted = std::chrono::steady_clock::now();
  if (extra->cb && extra->cb->GuidMixInPtr) {
    std::string dependencyError;
    const auto dependencyBytes = runtime_internal::ReadRuntimeSketchDependencyBytes(
      in_data,
      info->instanceId,
      &dependencyError
    );
    if (!dependencyBytes.has_value()) {
      runtime_internal::AppendEffectRuntimeDiagnostic(
        in_data,
        "prerender-guid-failed",
        info->instanceId,
        static_cast<PF_ParamIndex>(-1),
        -1,
        dependencyError
      );
      DisposeRenderInvocationInfo(info);
      return PF_Err_INTERNAL_STRUCT_DAMAGED;
    }

    const std::array<std::uint64_t, 3> dependencyHeader = {
      0x4d4f4d454e54554dULL,
      static_cast<std::uint64_t>(static_cast<A_u_long>(info->instanceId)),
      static_cast<std::uint64_t>(static_cast<A_u_long>(info->revision)),
    };
    PF_Err guidErr = extra->cb->GuidMixInPtr(
      in_data->effect_ref,
      static_cast<A_u_long>(sizeof(dependencyHeader)),
      dependencyHeader.data()
    );
    if (guidErr == PF_Err_NONE && !dependencyBytes->empty()) {
      guidErr = extra->cb->GuidMixInPtr(
        in_data->effect_ref,
        static_cast<A_u_long>(dependencyBytes->size()),
        dependencyBytes->data()
      );
    }
    if (guidErr == PF_Err_NONE && !info->controllerTimelineHash.empty()) {
      guidErr = extra->cb->GuidMixInPtr(
        in_data->effect_ref,
        static_cast<A_u_long>(info->controllerTimelineHash.size()),
        info->controllerTimelineHash.data()
      );
    }
    if (guidErr != PF_Err_NONE) {
      runtime_internal::AppendEffectRuntimeDiagnostic(
        in_data,
        "prerender-guid-failed",
        info->instanceId,
        static_cast<PF_ParamIndex>(-1),
        -1,
        std::string("GuidMixInPtr err=") +
          std::to_string(static_cast<long>(guidErr))
      );
      DisposeRenderInvocationInfo(info);
      return guidErr;
    }
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "prerender-guid-mixed",
      info->instanceId,
      static_cast<PF_ParamIndex>(-1),
      -1,
      std::string("documentBytes=") + std::to_string(dependencyBytes->size()) +
        " controllerFrames=" + std::to_string(info->controllerTimelineTargetFrame + 1) +
        " controllerHash=" + info->controllerTimelineHash
    );
  } else {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "prerender-guid-unavailable",
      info->instanceId,
      static_cast<PF_ParamIndex>(-1),
      -1,
      "host did not provide GuidMixInPtr"
    );
  }
  info->dependencyMixMs = ElapsedMilliseconds(dependencyMixStarted);

  // Smart PreRender rectangles stay in full-resolution layer coordinates.
  // AE applies downsample_x/y when allocating the output world's physical
  // buffer; returning a reduced result rect here crops the layer and makes
  // output-world origins incompatible with native Point coordinates.
  PF_LRect canvasRect{};
  canvasRect.left = info->canvasLeft;
  canvasRect.top = info->canvasTop;
  canvasRect.right = canvasRect.left + std::max<A_long>(1, info->canvasWidth);
  canvasRect.bottom = canvasRect.top + std::max<A_long>(1, info->canvasHeight);
  const PF_LRect requestedRect = extra->input->output_request.rect;
  extra->output->result_rect = IntersectLongRect(canvasRect, requestedRect);
  extra->output->max_result_rect = canvasRect;
  extra->output->solid = FALSE;

  info->tileLeft = extra->output->result_rect.left;
  info->tileTop = extra->output->result_rect.top;
  info->tileRight = extra->output->result_rect.right;
  info->tileBottom = extra->output->result_rect.bottom;

  extra->output->pre_render_data = info;
  extra->output->delete_pre_render_data_func = DisposeRenderInvocationInfo;

  if (BitmapGpuBackendAvailable()) {
    extra->output->flags |= PF_RenderOutputFlag_GPU_RENDER_POSSIBLE;
  }

  std::ostringstream completeDetail;
  completeDetail
    << "runtime=" << info->runtimeKey
    << " revision=" << info->revision
    << " controllerFrames=" << (info->controllerTimelineTargetFrame + 1)
    << " controllerHash=" << info->controllerTimelineHash
    << " requestGeneration=" << info->controllerRequestGeneration
    << " interactionGeneration=" << info->controllerInteractionGeneration
    << " canvas=" << info->canvasWidth << 'x' << info->canvasHeight
    << " renderCanvas=" << info->renderCanvasWidth << 'x' << info->renderCanvasHeight
    << " downsample=" << info->downsampleScaleX << 'x' << info->downsampleScaleY
    << " tile=" << info->tileLeft << ',' << info->tileTop << '-'
    << info->tileRight << ',' << info->tileBottom
    << " gpuPossible=" << (BitmapGpuBackendAvailable() ? 1 : 0);
  runtime_internal::AppendEffectRuntimeDiagnostic(
    in_data,
    "prerender-complete",
    info->instanceId,
    static_cast<PF_ParamIndex>(-1),
    -1,
    completeDetail.str()
  );

  info->preRenderTotalMs = ElapsedMilliseconds(preRenderStarted);
  std::ostringstream timingDetail;
  timingDetail
    << std::fixed << std::setprecision(3)
    << "stage=prerender"
    << " totalMs=" << info->preRenderTotalMs
    << " documentMs=" << info->documentPrepareMs
    << " controllerMs=" << info->controllerTimelineMs
    << " dependencyMs=" << info->dependencyMixMs
    << " controllerFrames=" << (info->controllerTimelineTargetFrame + 1)
    << " requestGeneration=" << info->controllerRequestGeneration
    << " interactionGeneration=" << info->controllerInteractionGeneration
    << " invocation=" << info->runtimeKey
    << " preparationCache=" << info->preparationCacheKey;
  runtime_internal::AppendEffectRuntimeDiagnostic(
    in_data,
    "render-timing",
    info->instanceId,
    static_cast<PF_ParamIndex>(-1),
    info->controllerTimelineTargetFrame,
    timingDetail.str()
  );

  (void)out_data;
  return PF_Err_NONE;
}

PF_Err SmartRender(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_SmartRenderExtra* extra,
  bool useGpu
) {
  const auto smartRenderStarted = std::chrono::steady_clock::now();
  {
    std::ostringstream detail;
    detail
      << "gpu=" << (useGpu ? 1 : 0)
      << " extra=" << reinterpret_cast<std::uintptr_t>(extra)
      << " input=" << reinterpret_cast<std::uintptr_t>(extra ? extra->input : NULL)
      << " cb=" << reinterpret_cast<std::uintptr_t>(extra ? extra->cb : NULL)
      << " preRenderData=" << reinterpret_cast<std::uintptr_t>(
           extra && extra->input ? extra->input->pre_render_data : NULL
         );
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "smart-render-enter",
      -1,
      static_cast<PF_ParamIndex>(-1),
      -1,
      detail.str()
    );
  }
  if (!extra || !extra->input || !extra->cb) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "smart-render-failed",
      -1,
      static_cast<PF_ParamIndex>(-1),
      -1,
      "invalid smart-render callback data"
    );
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  auto* info = reinterpret_cast<RenderInvocationInfo*>(extra->input->pre_render_data);
  if (!info) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
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
      in_data,
      "controller-render-superseded",
      info->instanceId,
      static_cast<PF_ParamIndex>(-1),
      info->controllerTimelineTargetFrame,
      "phase=smart-render-enter policy=latest-wins requestGeneration=" +
        std::to_string(info->controllerRequestGeneration) +
        " capturedInteractionGeneration=" +
        std::to_string(info->controllerInteractionGeneration) +
        " latestInteractionGeneration=" +
        std::to_string(ReadControllerInteractionGeneration(info->instanceId))
    );
    return PF_Interrupt_CANCEL;
  }

  PF_EffectWorld* outputWorld = NULL;
  PF_Err err = extra->cb->checkout_output(in_data->effect_ref, &outputWorld);
  if (err != PF_Err_NONE || !outputWorld) {
    const PF_Err outputErr = err != PF_Err_NONE ? err : PF_Err_INTERNAL_STRUCT_DAMAGED;
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "smart-render-failed",
      info->instanceId,
      static_cast<PF_ParamIndex>(-1),
      -1,
      std::string("checkout-output err=") +
        std::to_string(static_cast<long>(outputErr))
    );
    return outputErr;
  }

  AEFX_SuiteScoper<PF_WorldSuite2> worldSuite =
    AEFX_SuiteScoper<PF_WorldSuite2>(
      in_data,
      kPFWorldSuite,
      kPFWorldSuiteVersion2,
      out_data
    );

  PF_PixelFormat pixelFormat = PF_PixelFormat_INVALID;
  err = worldSuite->PF_GetPixelFormat(outputWorld, &pixelFormat);
  if (err != PF_Err_NONE) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "smart-render-failed",
      info->instanceId,
      static_cast<PF_ParamIndex>(-1),
      -1,
      std::string("pixel-format err=") + std::to_string(static_cast<long>(err))
    );
    return err;
  }
  if (!useGpu) {
    const auto cpuStarted = std::chrono::steady_clock::now();
    err = RenderCurrentSketchToCpuWorld(in_data, outputWorld, *info, pixelFormat);
    const double cpuMs = ElapsedMilliseconds(cpuStarted);
    if (err == PF_Err_NONE &&
        (!IsCurrentControllerRenderRequest(*info) || !IsLatestControllerInteraction(*info))) {
      runtime_internal::AppendEffectRuntimeDiagnostic(
        in_data,
        "controller-render-superseded",
        info->instanceId,
        static_cast<PF_ParamIndex>(-1),
        info->controllerTimelineTargetFrame,
        "phase=cpu-complete generation=" +
          std::to_string(info->controllerRequestGeneration)
      );
      return PF_Interrupt_CANCEL;
    }
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      err == PF_Err_NONE ? "cpu-render-complete" : "smart-render-failed",
      info->instanceId,
      static_cast<PF_ParamIndex>(-1),
      -1,
      std::string("pixelFormat=") + std::to_string(static_cast<long>(pixelFormat)) +
        " output=" + std::to_string(static_cast<long>(outputWorld->width)) + "x" +
        std::to_string(static_cast<long>(outputWorld->height)) +
        " err=" + std::to_string(static_cast<long>(err))
    );
    std::ostringstream timingDetail;
    timingDetail << std::fixed << std::setprecision(3)
      << "stage=smart-render backend=cpu"
      << " totalMs=" << ElapsedMilliseconds(smartRenderStarted)
      << " planAndExecuteMs=" << cpuMs
      << " renderCache=" << info->renderCacheKey;
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "render-timing",
      info->instanceId,
      static_cast<PF_ParamIndex>(-1),
      info->controllerTimelineTargetFrame,
      timingDetail.str()
    );
    return err;
  }

  PF_LayerDef sceneSurface = MakeSceneSurface(*outputWorld, *info);
  std::string errorMessage;
  BitmapFramePlan framePlan;
  const auto planStarted = std::chrono::steady_clock::now();
  const bool planOk = BuildBitmapFramePlanAtCurrentTime(
    in_data,
    info->runtimeKey,
    info->renderCacheKey,
    info->revision,
    info->instanceId,
    &sceneSurface,
    &framePlan,
    &errorMessage
  );
  const double planMs = ElapsedMilliseconds(planStarted);
  if (!planOk) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "bitmap-frame-plan-failed",
      info->instanceId,
      static_cast<PF_ParamIndex>(-1),
      -1,
      errorMessage
    );
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  ScaleBitmapFramePlanToPhysicalCanvas(
    &framePlan,
    info->renderCanvasWidth,
    info->renderCanvasHeight
  );
  if (!IsCurrentControllerRenderRequest(*info)) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "controller-render-superseded",
      info->instanceId,
      static_cast<PF_ParamIndex>(-1),
      framePlan.targetFrame,
      "phase=plan-ready generation=" +
        std::to_string(info->controllerRequestGeneration)
    );
    return PF_Interrupt_CANCEL;
  }

  std::size_t sceneCommands = 0;
  std::size_t fillTriangles = 0;
  std::size_t strokeTriangles = 0;
  std::size_t pathFills = 0;
  std::size_t imageDraws = 0;
  std::size_t drawBatches = 0;
  for (const BitmapFramePlanOp& op : framePlan.operations) {
    sceneCommands += op.drawPlan.scene.commands.size();
    fillTriangles += op.drawPlan.fillTriangles.size();
    strokeTriangles += op.drawPlan.strokeTriangles.size();
    pathFills += op.drawPlan.pathFills.size();
    imageDraws += op.drawPlan.imageDraws.size();
    drawBatches += op.drawPlan.drawBatches.size();
  }
  const OutputCopyOriginInfo copyOrigin = ResolveOutputCopyOrigin(*outputWorld, *info);
  std::ostringstream planDetail;
  planDetail
    << "runtime=" << info->runtimeKey
    << " pixelFormat=" << static_cast<long>(pixelFormat)
    << " output=" << outputWorld->width << 'x' << outputWorld->height
    << " rowbytes=" << outputWorld->rowbytes
    << " plan=" << framePlan.width << 'x' << framePlan.height
    << " downsample=" << info->downsampleScaleX << 'x' << info->downsampleScaleY
    << " copyMode=" << copyOrigin.mode
    << " copyOrigin=" << copyOrigin.sourceOriginX << ',' << copyOrigin.sourceOriginY
    << " copyStep=" << copyOrigin.sourceStepX << ',' << copyOrigin.sourceStepY
    << " ops=" << framePlan.operations.size()
    << " commands=" << sceneCommands
    << " fillTriangles=" << fillTriangles
    << " strokeTriangles=" << strokeTriangles
    << " pathFills=" << pathFills
    << " images=" << imageDraws
    << " batches=" << drawBatches;
  runtime_internal::AppendEffectRuntimeDiagnostic(
    in_data,
    "bitmap-frame-plan-ready",
    info->instanceId,
    static_cast<PF_ParamIndex>(-1),
    framePlan.targetFrame,
    planDetail.str()
  );

  const auto gpuStarted = std::chrono::steady_clock::now();
  err = RenderBitmapFramePlan(
    in_data,
    out_data,
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
  if (err == PF_Err_NONE && !IsCurrentControllerRenderRequest(*info)) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "controller-render-superseded",
      info->instanceId,
      static_cast<PF_ParamIndex>(-1),
      framePlan.targetFrame,
      "phase=gpu-complete generation=" +
        std::to_string(info->controllerRequestGeneration)
    );
    return PF_Interrupt_CANCEL;
  }
  if (err != PF_Err_NONE) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "gpu-render-failed",
      info->instanceId,
      static_cast<PF_ParamIndex>(-1),
      framePlan.targetFrame,
      errorMessage
    );
  } else {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "gpu-render-complete",
      info->instanceId,
      static_cast<PF_ParamIndex>(-1),
      framePlan.targetFrame,
      planDetail.str()
    );
  }
  std::ostringstream timingDetail;
  timingDetail << std::fixed << std::setprecision(3)
    << "stage=smart-render backend=gpu"
    << " totalMs=" << ElapsedMilliseconds(smartRenderStarted)
    << " planMs=" << planMs
    << " metalAndCopyMs=" << gpuMs
    << " operations=" << framePlan.operations.size()
    << " renderCache=" << info->renderCacheKey;
  runtime_internal::AppendEffectRuntimeDiagnostic(
    in_data,
    "render-timing",
    info->instanceId,
    static_cast<PF_ParamIndex>(-1),
    framePlan.targetFrame,
    timingDetail.str()
  );
  return err;
}

PF_Err GPUDeviceSetup(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_GPUDeviceSetupExtra* extra
) {
  if (!extra || !extra->input || !extra->output) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  std::string errorMessage;
  PF_Err err = CreateBitmapGpuDeviceContext(
    in_data,
    out_data,
    extra->input->what_gpu,
    extra->input->device_index,
    &extra->output->gpu_data,
    &errorMessage
  );
  if (err != PF_Err_NONE) {
    return err;
  }

  ApplyMomentumOutFlags(out_data);
  return PF_Err_NONE;
}

PF_Err GPUDeviceSetdown(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_GPUDeviceSetdownExtra* extra
) {
  if (!extra || !extra->input) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  DisposeBitmapGpuDeviceContext(in_data, out_data, extra->input->gpu_data);
  return PF_Err_NONE;
}

PF_Err QueryDynamicFlags(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  void* extra
) {
  (void)in_data;
  (void)params;
  (void)extra;
  if (out_data) {
    // Bitmap sketches depend on time and retained JS state even when no AE
    // parameter changes. Adobe defines NON_PARAM_VARY for exactly this case:
    // output varies from information outside the parameter streams.
    out_data->out_flags |= PF_OutFlag_NON_PARAM_VARY;
    out_data->out_flags |= PF_OutFlag_WIDE_TIME_INPUT;
    out_data->out_flags |= PF_OutFlag_PIX_INDEPENDENT;
  }
  return PF_Err_NONE;
}

PF_Err GlobalSetdown(PF_InData* in_data, PF_OutData* out_data) {
  (void)in_data;
  (void)out_data;
  ClearAllCachedSketches();
  DisposeAllBitmapGpuGlobalState("global-setdown");
  return PF_Err_NONE;
}

}  // namespace

PF_Err About(PF_OutData* out_data) {
  std::snprintf(
    out_data->return_msg,
    sizeof(out_data->return_msg),
    "Momentum v%d.%d\rPlugin-side JavaScript runtime renderer for Momentum sketches.",
    MOMENTUM_VERSION_MAJOR,
    MOMENTUM_VERSION_MINOR
  );
  return PF_Err_NONE;
}

PF_Err GlobalSetup(PF_InData* in_data, PF_OutData* out_data) {
  out_data->my_version = PF_VERSION(
    MOMENTUM_VERSION_MAJOR,
    MOMENTUM_VERSION_MINOR,
    MOMENTUM_VERSION_BUG,
    MOMENTUM_VERSION_STAGE,
    MOMENTUM_VERSION_BUILD
  );
  ApplyMomentumOutFlags(out_data);
  (void)EnsureRegisteredWithAEGP(in_data);
  return PF_Err_NONE;
}

PF_Err ParamsSetup(PF_InData* in_data, PF_OutData* out_data) {
  PF_Err err = PF_Err_NONE;
  PF_ParamDef def;
  AEFX_CLR_STRUCT(def);
  def.ui_flags = PF_PUI_INVISIBLE;

  PF_ADD_SLIDER(
    "Revision",
    0,
    32768,
    0,
    32768,
    0,
    PARAM_REVISION
  );

  AEFX_CLR_STRUCT(def);
  def.ui_flags = PF_PUI_INVISIBLE;
  PF_ADD_SLIDER(
    "Instance ID",
    0,
    2000000000,
    0,
    2000000000,
    0,
    PARAM_INSTANCE_ID
  );

  for (int slot = 0; slot < kControllerSlotCount; ++slot) {
    const std::string pointLabel = DefaultPointControllerLabel(slot);
    const std::string sliderLabel = DefaultSliderControllerLabel(slot);
    const std::string colorLabel = DefaultColorControllerLabel(slot);
    const std::string checkboxLabel = DefaultCheckboxControllerLabel(slot);
    const std::string selectLabel = DefaultSelectControllerLabel(slot);
    std::string angleLabel = DefaultAngleControllerLabel(slot);
    std::string angleUiLabel = DefaultAngleControllerLabel(slot);
    if (kDebugExposeAllControllerParams) {
      angleLabel += " [angle-value " + std::to_string(slot) + "]";
      angleUiLabel += " [angle-ui " + std::to_string(slot) + "]";
    }

    AEFX_CLR_STRUCT(def);
    def.flags = PF_ParamFlag_SUPERVISE;
    def.ui_flags = PF_PUI_NONE;
    PF_ADD_POINT(
      pointLabel.c_str(),
      0,
      0,
      FALSE,
      ControllerPointParamIndex(slot)
    );

    PF_FpShort sliderMin = 0;
    PF_FpShort sliderMax = 100;
    AEFX_CLR_STRUCT(def);
    def.flags = PF_ParamFlag_SUPERVISE;
    def.ui_flags = PF_PUI_NONE;
    def.ui_width = 0;
    def.ui_height = 0;
    PF_ADD_FLOAT_SLIDER(
      sliderLabel.c_str(),
      static_cast<PF_FpShort>(kStaticSliderValidMin),
      static_cast<PF_FpShort>(kStaticSliderValidMax),
      sliderMin,
      sliderMax,
      AEFX_DEFAULT_CURVE_TOLERANCE,
      0,
      kControllerSliderPrecision,
      0,
      false,
      ControllerSliderParamIndex(slot)
    );

    AEFX_CLR_STRUCT(def);
    def.flags = PF_ParamFlag_SUPERVISE;
    {
      PF_ArbitraryH defaultColorHandle = NULL;
      PF_Err defaultErr =
        AllocateColorArbHandle(in_data, MakeUnsetColorValue(), &defaultColorHandle);
      if (defaultErr != PF_Err_NONE) {
        return defaultErr;
      }
      PF_ADD_ARBITRARY2(
        colorLabel.c_str(),
        kColorControlUiWidth,
        kColorControlUiHeight,
        0,
        kColorControlUiFlags,
        defaultColorHandle,
        ControllerColorParamIndex(slot),
        &gColorArbRefconTag
      );
    }

    AEFX_CLR_STRUCT(def);
    def.flags = PF_ParamFlag_SUPERVISE;
    def.ui_flags = PF_PUI_NONE;
    PF_ADD_CHECKBOX(
      checkboxLabel.c_str(),
      "",
      FALSE,
      0,
      ControllerCheckboxParamIndex(slot)
    );

    const std::string selectItems = BuildStaticSelectControllerPopupItems();
    AEFX_CLR_STRUCT(def);
    def.flags = PF_ParamFlag_SUPERVISE;
    def.ui_flags = PF_PUI_NONE;
    PF_ADD_POPUP(
      selectLabel.c_str(),
      static_cast<A_short>(kStaticSelectControllerChoiceCount),
      1,
      selectItems.c_str(),
      ControllerSelectParamIndex(slot)
    );

    PF_FpShort angleValidMin = 0;
    PF_FpShort angleValidMax = 0;
    PF_FpShort angleSliderMin = 0;
    PF_FpShort angleSliderMax = 0;
    ResolveAngleUiRange(&angleValidMin, &angleValidMax, &angleSliderMin, &angleSliderMax);

    AEFX_CLR_STRUCT(def);
    def.flags = PF_ParamFlag_SUPERVISE;
    def.ui_flags = kAngleControlUiFlags;
    def.ui_width = kAngleControlUiWidth;
    def.ui_height = kAngleControlUiHeight;
    PF_ADD_FLOAT_SLIDER(
      angleLabel.c_str(),
      angleValidMin,
      angleValidMax,
      angleSliderMin,
      angleSliderMax,
      AEFX_DEFAULT_CURVE_TOLERANCE,
      0,
      2,
      0,
      false,
      ControllerAngleValueParamIndex(slot)
    );

    AEFX_CLR_STRUCT(def);
    def.flags = PF_ParamFlag_SUPERVISE;
    def.ui_flags = kDebugExposeAllControllerParams ? PF_PUI_NONE : (PF_PUI_INVISIBLE | PF_PUI_NO_ECW_UI);
    def.ui_width = 0;
    def.ui_height = 0;
    PF_ADD_SLIDER(
      angleUiLabel.c_str(),
      0,
      1,
      0,
      1,
      0,
      ControllerAngleUiParamIndex(slot)
    );
  }

  ApplyMomentumOutFlags(out_data);
  if (err == PF_Err_NONE) {
    err = RegisterCustomUI(in_data);
  }
  out_data->num_params = PARAM_COUNT;
  return err;
}

PF_Err Render(PF_InData* in_data, PF_ParamDef* params[], PF_LayerDef* output) {
  const A_long revision = params[PARAM_REVISION]->u.sd.value;
  const A_long instanceId = static_cast<A_long>(
    ResolveStableInstanceId(in_data, params[PARAM_INSTANCE_ID]->u.sd.value)
  );
  const ScopedRenderRuntime renderRuntime;
  const auto runtimeKey = renderRuntime.key();
  const std::uint64_t lineageIdentity = ResolveRenderLineageIdentity(in_data, instanceId);
  const auto preparationCacheKey = ResolveEffectPreparationCacheKey(lineageIdentity);
  const auto renderCacheKey = ResolveEffectRenderCacheKey(lineageIdentity);
  std::ostringstream entryDetail;
  entryDetail
    << "runtime=" << runtimeKey
    << " revision=" << revision
    << " output=" << (output ? output->width : 0) << 'x'
    << (output ? output->height : 0)
    << " rowbytes=" << (output ? output->rowbytes : 0)
    << " time=" << (in_data ? in_data->current_time : 0)
    << '/' << (in_data ? in_data->time_scale : 0);
  runtime_internal::AppendEffectRuntimeDiagnostic(
    in_data,
    "legacy-render-enter",
    instanceId,
    static_cast<PF_ParamIndex>(-1),
    -1,
    entryDetail.str()
  );
  if (!runtimeKey) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "legacy-render-failed",
      instanceId,
      static_cast<PF_ParamIndex>(-1),
      -1,
      "could not allocate isolated render runtime"
    );
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  std::string errorMessage;
  if (!PrepareEffectRuntimeDocument(
        in_data,
        runtimeKey,
        preparationCacheKey,
        revision,
        instanceId,
        &errorMessage
      )) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "legacy-render-failed",
      instanceId,
      static_cast<PF_ParamIndex>(-1),
      -1,
      std::string("document: ") + errorMessage
    );
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  long controllerTimelineTargetFrame = -1;
  std::string controllerTimelineHash;
  if (!CaptureEffectControllerTimeline(
        in_data,
        runtimeKey,
        preparationCacheKey,
        &controllerTimelineTargetFrame,
        &controllerTimelineHash,
        &errorMessage
      )) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "legacy-render-failed",
      instanceId,
      static_cast<PF_ParamIndex>(-1),
      -1,
      std::string("controller-timeline: ") + errorMessage
    );
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  BitmapFramePlan framePlan;
  if (!BuildBitmapCpuFramePlanAtCurrentTime(
        in_data,
        runtimeKey,
        renderCacheKey,
        revision,
        instanceId,
        output,
        std::function<bool()>(),
        &framePlan,
        &errorMessage
      )) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "legacy-render-failed",
      instanceId,
      static_cast<PF_ParamIndex>(-1),
      -1,
      std::string("plan: ") + errorMessage
    );
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  std::vector<PF_Pixel> raster;
  if (!RenderBitmapFramePlanToCpuRaster(
        framePlan,
        &raster,
        std::function<bool()>(),
        &errorMessage
      )) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "legacy-render-failed",
      instanceId,
      static_cast<PF_ParamIndex>(-1),
      framePlan.targetFrame,
      std::string("execute: ") + errorMessage
    );
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  std::size_t visiblePixels = 0;
  std::size_t coloredPixels = 0;
  for (const PF_Pixel& pixel : raster) {
    if (pixel.alpha != 0) {
      ++visiblePixels;
    }
    if (pixel.red != 0 || pixel.green != 0 || pixel.blue != 0) {
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
      in_data,
      "legacy-render-complete",
      instanceId,
      static_cast<PF_ParamIndex>(-1),
      -1,
      completeDetail.str() + " depth=16"
    );
    return PF_Err_NONE;
  }

  CopySurface8To8(output, raster);
  runtime_internal::AppendEffectRuntimeDiagnostic(
    in_data,
    "legacy-render-complete",
    instanceId,
    static_cast<PF_ParamIndex>(-1),
    -1,
    completeDetail.str() + " depth=8"
  );
  return PF_Err_NONE;
}

}  // namespace momentum

extern "C" DllExport
PF_Err PluginDataEntryFunction2(
  PF_PluginDataPtr inPtr,
  PF_PluginDataCB2 inPluginDataCallBackPtr,
  SPBasicSuite* inSPBasicSuitePtr,
  const char* inHostName,
  const char* inHostVersion
) {
  (void)inSPBasicSuitePtr;
  (void)inHostName;
  (void)inHostVersion;

  PF_Err result = PF_Err_INVALID_CALLBACK;
  result = PF_REGISTER_EFFECT_EXT2(
    inPtr,
    inPluginDataCallBackPtr,
    "Momentum",
    "Momentum",
    "Momentum",
    AE_RESERVED_INFO,
    "EffectMain",
    "https://github.com/barium3/momentum"
  );
  return result;
}

extern "C" DllExport
PF_Err
EffectMain(
  PF_Cmd cmd,
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  PF_LayerDef* output,
  void* extra
) {
  if (out_data && cmd != PF_Cmd_QUERY_DYNAMIC_FLAGS) {
    AEFX_CLR_STRUCT(*out_data);
  }

  const char* commandName = "other";
  switch (cmd) {
    case PF_Cmd_GLOBAL_SETUP: commandName = "global-setup"; break;
    case PF_Cmd_GLOBAL_SETDOWN: commandName = "global-setdown"; break;
    case PF_Cmd_PARAMS_SETUP: commandName = "params-setup"; break;
    case PF_Cmd_SEQUENCE_SETUP: commandName = "sequence-setup"; break;
    case PF_Cmd_SEQUENCE_RESETUP: commandName = "sequence-resetup"; break;
    case PF_Cmd_SEQUENCE_FLATTEN: commandName = "sequence-flatten"; break;
    case PF_Cmd_SEQUENCE_SETDOWN: commandName = "sequence-setdown"; break;
    case PF_Cmd_RENDER: commandName = "render"; break;
    case PF_Cmd_EVENT: commandName = "event"; break;
    case PF_Cmd_USER_CHANGED_PARAM: commandName = "user-changed-param"; break;
    case PF_Cmd_UPDATE_PARAMS_UI: commandName = "update-params-ui"; break;
    case PF_Cmd_QUERY_DYNAMIC_FLAGS: commandName = "query-dynamic-flags"; break;
    case PF_Cmd_SMART_PRE_RENDER: commandName = "smart-prerender"; break;
    case PF_Cmd_SMART_RENDER: commandName = "smart-render-cpu"; break;
    case PF_Cmd_SMART_RENDER_GPU: commandName = "smart-render-gpu"; break;
    case PF_Cmd_GPU_DEVICE_SETUP: commandName = "gpu-device-setup"; break;
    case PF_Cmd_GPU_DEVICE_SETDOWN: commandName = "gpu-device-setdown"; break;
    case PF_Cmd_GET_FLATTENED_SEQUENCE_DATA:
      commandName = "get-flattened-sequence-data";
      break;
    default: break;
  }
  // AppendEffectRuntimeDiagnostic resolves Effect Sequence Data. AE does not
  // provide a valid sequence context during GLOBAL_SETUP/PARAMS_SETUP (and
  // some device/UI selectors), so selector-boundary logging is restricted to
  // the render selectors where the sequence suite is valid.
  const bool traceCommand =
    cmd == PF_Cmd_RENDER ||
    cmd == PF_Cmd_SMART_PRE_RENDER ||
    cmd == PF_Cmd_SMART_RENDER ||
    cmd == PF_Cmd_SMART_RENDER_GPU;
  PF_EventExtra* tracedEventExtra =
    cmd == PF_Cmd_EVENT ? reinterpret_cast<PF_EventExtra*>(extra) : NULL;
  const bool traceInteractionEvent =
    tracedEventExtra &&
    (tracedEventExtra->e_type == PF_Event_DO_CLICK ||
     tracedEventExtra->e_type == PF_Event_DRAG);
  const bool traceUiCommand =
    traceInteractionEvent ||
    cmd == PF_Cmd_USER_CHANGED_PARAM ||
    cmd == PF_Cmd_UPDATE_PARAMS_UI;
  if (traceUiCommand) {
    std::ostringstream detail;
    detail << "cmd=" << static_cast<long>(cmd) << " name=" << commandName;
    if (cmd == PF_Cmd_EVENT) {
      PF_EventExtra* eventExtra = tracedEventExtra;
      const PF_WindowType windowType =
        (eventExtra && eventExtra->contextH && *eventExtra->contextH)
          ? (*eventExtra->contextH)->w_type
          : PF_Window_NONE;
      detail
        << " eventType=" << (eventExtra ? static_cast<long>(eventExtra->e_type) : -1)
        << " windowType=" << static_cast<long>(windowType)
        << " area=" << (eventExtra ? static_cast<long>(eventExtra->effect_win.area) : -1)
        << " index=" << (eventExtra ? static_cast<long>(eventExtra->effect_win.index) : -1)
        << " inFlags=" << (eventExtra ? static_cast<unsigned long>(eventExtra->evt_in_flags) : 0)
        << " sendDrag=" << (eventExtra ? static_cast<long>(eventExtra->u.do_click.send_drag) : -1)
        << " lastTime=" << (eventExtra ? static_cast<long>(eventExtra->u.do_click.last_time) : -1)
        << " refcon="
        << (eventExtra ? eventExtra->u.do_click.continue_refcon[0] : 0) << ','
        << (eventExtra ? eventExtra->u.do_click.continue_refcon[1] : 0) << ','
        << (eventExtra ? eventExtra->u.do_click.continue_refcon[2] : 0) << ','
        << (eventExtra ? eventExtra->u.do_click.continue_refcon[3] : 0);
    } else if (cmd == PF_Cmd_USER_CHANGED_PARAM) {
      const PF_UserChangedParamExtra* changedExtra =
        reinterpret_cast<const PF_UserChangedParamExtra*>(extra);
      detail << " paramIndex=" << (changedExtra ? static_cast<long>(changedExtra->param_index) : -1);
    }
    momentum::runtime_internal::AppendEffectUiDiagnostic(
      in_data,
      "ui-command-enter",
      detail.str()
    );
  }
  if (traceCommand) {
    std::ostringstream detail;
    detail
      << "cmd=" << static_cast<long>(cmd)
      << " name=" << commandName
      << " time=" << (in_data ? in_data->current_time : 0)
      << '/' << (in_data ? in_data->time_scale : 0)
      << " output=" << reinterpret_cast<std::uintptr_t>(output)
      << " extra=" << reinterpret_cast<std::uintptr_t>(extra);
    momentum::runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "command-enter",
      -1,
      static_cast<PF_ParamIndex>(-1),
      -1,
      detail.str()
    );
  }

  PF_Err err = PF_Err_NONE;

  switch (cmd) {
    case PF_Cmd_ABOUT:
      err = momentum::About(out_data);
      break;

    case PF_Cmd_GLOBAL_SETUP:
      err = momentum::GlobalSetup(in_data, out_data);
      break;

    case PF_Cmd_GLOBAL_SETDOWN:
      err = momentum::GlobalSetdown(in_data, out_data);
      break;

    case PF_Cmd_PARAMS_SETUP:
      err = momentum::ParamsSetup(in_data, out_data);
      break;

    case PF_Cmd_SEQUENCE_SETUP:
      err = momentum::SequenceSetup(in_data, out_data);
      break;

    case PF_Cmd_SEQUENCE_RESETUP:
      err = momentum::SequenceResetup(in_data, out_data);
      break;

    case PF_Cmd_SEQUENCE_FLATTEN:
      err = momentum::SequenceFlatten(in_data, out_data);
      break;

    case PF_Cmd_SEQUENCE_SETDOWN:
      err = momentum::SequenceSetdown(in_data, out_data);
      break;

    case PF_Cmd_RENDER:
      err = momentum::Render(in_data, params, output);
      break;

    case PF_Cmd_EVENT:
      err = momentum::HandleCustomEffectUIEvent(
        in_data,
        out_data,
        params,
        output,
        reinterpret_cast<PF_EventExtra*>(extra)
      );
      break;

    case PF_Cmd_USER_CHANGED_PARAM:
      err = momentum::HandleUserChangedParam(
        in_data,
        out_data,
        params,
        reinterpret_cast<const PF_UserChangedParamExtra*>(extra)
      );
      break;

    case PF_Cmd_ARBITRARY_CALLBACK:
      err = momentum::HandleColorArbitraryCallbacks(
        in_data,
        out_data,
        reinterpret_cast<PF_ArbParamsExtra*>(extra)
      );
      break;

    case PF_Cmd_QUERY_DYNAMIC_FLAGS:
      err = momentum::QueryDynamicFlags(in_data, out_data, params, extra);
      break;

    case PF_Cmd_UPDATE_PARAMS_UI:
      err = momentum::UpdateParamsUI(in_data, out_data, params);
      break;

    case PF_Cmd_SMART_PRE_RENDER:
      err = momentum::PreRender(in_data, out_data, reinterpret_cast<PF_PreRenderExtra*>(extra));
      break;

    case PF_Cmd_SMART_RENDER:
      err = momentum::SmartRender(
        in_data,
        out_data,
        reinterpret_cast<PF_SmartRenderExtra*>(extra),
        false
      );
      break;

    case PF_Cmd_SMART_RENDER_GPU:
      err = momentum::SmartRender(
        in_data,
        out_data,
        reinterpret_cast<PF_SmartRenderExtra*>(extra),
        true
      );
      break;

    case PF_Cmd_GPU_DEVICE_SETUP:
      err = momentum::GPUDeviceSetup(
        in_data,
        out_data,
        reinterpret_cast<PF_GPUDeviceSetupExtra*>(extra)
      );
      break;

    case PF_Cmd_GPU_DEVICE_SETDOWN:
      err = momentum::GPUDeviceSetdown(
        in_data,
        out_data,
        reinterpret_cast<PF_GPUDeviceSetdownExtra*>(extra)
      );
      break;

    case PF_Cmd_GET_FLATTENED_SEQUENCE_DATA:
      err = momentum::GetFlattenedSequenceData(in_data, out_data);
      break;

    default:
      break;
  }

  if (traceCommand) {
    std::ostringstream detail;
    detail
      << "cmd=" << static_cast<long>(cmd)
      << " name=" << commandName
      << " err=" << static_cast<long>(err)
      << " outFlags=" << (out_data ? static_cast<unsigned long>(out_data->out_flags) : 0)
      << " outFlags2=" << (out_data ? static_cast<unsigned long>(out_data->out_flags2) : 0);
    momentum::runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "command-exit",
      -1,
      static_cast<PF_ParamIndex>(-1),
      -1,
      detail.str()
    );
  }
  if (traceUiCommand) {
    std::ostringstream detail;
    detail
      << "cmd=" << static_cast<long>(cmd)
      << " name=" << commandName
      << " err=" << static_cast<long>(err)
      << " outFlags=" << (out_data ? static_cast<unsigned long>(out_data->out_flags) : 0);
    if (cmd == PF_Cmd_EVENT) {
      PF_EventExtra* eventExtra = reinterpret_cast<PF_EventExtra*>(extra);
      const PF_ParamIndex eventParamIndex =
        eventExtra ? eventExtra->effect_win.index : static_cast<PF_ParamIndex>(-1);
      const PF_ChangeFlags changeFlags =
        params && eventParamIndex >= 0 && eventParamIndex < momentum::PARAM_COUNT &&
        params[eventParamIndex]
          ? params[eventParamIndex]->uu.change_flags
          : PF_ChangeFlag_NONE;
      detail
        << " eventType=" << (eventExtra ? static_cast<long>(eventExtra->e_type) : -1)
        << " outEventFlags=" << (eventExtra ? static_cast<unsigned long>(eventExtra->evt_out_flags) : 0)
        << " sendDrag=" << (eventExtra ? static_cast<long>(eventExtra->u.do_click.send_drag) : -1)
        << " lastTime=" << (eventExtra ? static_cast<long>(eventExtra->u.do_click.last_time) : -1)
        << " refcon="
        << (eventExtra ? eventExtra->u.do_click.continue_refcon[0] : 0) << ','
        << (eventExtra ? eventExtra->u.do_click.continue_refcon[1] : 0) << ','
        << (eventExtra ? eventExtra->u.do_click.continue_refcon[2] : 0) << ','
        << (eventExtra ? eventExtra->u.do_click.continue_refcon[3] : 0)
        << " changeFlags=" << static_cast<unsigned long>(changeFlags);
    }
    momentum::runtime_internal::AppendEffectUiDiagnostic(
      in_data,
      "ui-command-exit",
      detail.str()
    );
  }

  return err;
}
