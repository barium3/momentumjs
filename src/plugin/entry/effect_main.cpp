#include "../model/momentum_types.h"
#include "../api/api_internal.h"
#include "../gpu/bitmap_gpu_backend.h"
#include "../gpu/bitmap_gpu_plan.h"
#include "../render/render_core.h"
#include "../runtime/runtime_core.h"
#include "../runtime/runtime_internal.h"
#include "AE_PluginData.h"
#include "AE_EffectUI.h"
#include "AE_EffectSuites.h"

#include <adobesdk/DrawbotSuite.h>

#include <atomic>
#include <array>
#include <chrono>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <limits>
#include <mutex>
#include <new>
#include <optional>
#include <sstream>
#include <string>
#include <unordered_map>

namespace momentum {

namespace {

constexpr PF_OutFlags kMomentumBaseOutFlags =
  PF_OutFlag_PIX_INDEPENDENT |
  PF_OutFlag_DEEP_COLOR_AWARE |
  PF_OutFlag_CUSTOM_UI |
  PF_OutFlag_NON_PARAM_VARY |
  PF_OutFlag_SEND_UPDATE_PARAMS_UI;

constexpr PF_OutFlags2 kMomentumBaseOutFlags2 =
  PF_OutFlag2_SUPPORTS_QUERY_DYNAMIC_FLAGS |
  PF_OutFlag2_FLOAT_COLOR_AWARE |
  PF_OutFlag2_SUPPORTS_SMART_RENDER |
  PF_OutFlag2_SUPPORTS_GPU_RENDER_F32;

// AE does not reliably hot-refresh float slider valid bounds per effect instance.
// Keep the hard valid range static and wide, then use slider_min/max plus plugin
// clamp/snap logic for per-controller semantics.
constexpr double kStaticSliderValidMin = -1000000.0;
constexpr double kStaticSliderValidMax = 1000000.0;
constexpr PF_Precision kControllerSliderPrecision = PF_Precision_HUNDREDTHS;

std::uintptr_t GetEffectRefKey(PF_InData* in_data) {
  return (in_data && in_data->effect_ref)
    ? reinterpret_cast<std::uintptr_t>(in_data->effect_ref)
    : 0;
}

const char* CommandName(PF_Cmd cmd) {
  switch (cmd) {
    case PF_Cmd_ABOUT: return "about";
    case PF_Cmd_GLOBAL_SETUP: return "global_setup";
    case PF_Cmd_GLOBAL_SETDOWN: return "global_setdown";
    case PF_Cmd_PARAMS_SETUP: return "params_setup";
    case PF_Cmd_SEQUENCE_SETUP: return "sequence_setup";
    case PF_Cmd_SEQUENCE_RESETUP: return "sequence_resetup";
    case PF_Cmd_SEQUENCE_FLATTEN: return "sequence_flatten";
    case PF_Cmd_SEQUENCE_SETDOWN: return "sequence_setdown";
    case PF_Cmd_RENDER: return "render";
    case PF_Cmd_EVENT: return "event";
    case PF_Cmd_USER_CHANGED_PARAM: return "user_changed_param";
    case PF_Cmd_ARBITRARY_CALLBACK: return "arbitrary_callback";
    case PF_Cmd_QUERY_DYNAMIC_FLAGS: return "query_dynamic_flags";
    case PF_Cmd_UPDATE_PARAMS_UI: return "update_params_ui";
    case PF_Cmd_SMART_PRE_RENDER: return "smart_pre_render";
    case PF_Cmd_SMART_RENDER: return "smart_render";
    case PF_Cmd_SMART_RENDER_GPU: return "smart_render_gpu";
    case PF_Cmd_GPU_DEVICE_SETUP: return "gpu_device_setup";
    case PF_Cmd_GPU_DEVICE_SETDOWN: return "gpu_device_setdown";
    case PF_Cmd_GET_FLATTENED_SEQUENCE_DATA: return "get_flattened_sequence_data";
    default: return "unknown";
  }
}

const char* WindowTypeName(PF_WindowType type) {
  switch (type) {
    case PF_Window_COMP: return "comp";
    case PF_Window_LAYER: return "layer";
    case PF_Window_EFFECT: return "effect";
    default: return "other";
  }
}

const char* EventTypeName(PF_EventType type) {
  switch (type) {
    case PF_Event_NEW_CONTEXT: return "new_context";
    case PF_Event_ACTIVATE: return "activate";
    case PF_Event_DO_CLICK: return "do_click";
    case PF_Event_DRAG: return "drag";
    case PF_Event_DRAW: return "draw";
    case PF_Event_ADJUST_CURSOR: return "adjust_cursor";
    default: return "other";
  }
}

std::string GetEntryTraceFlagPath() {
  return runtime_internal::GetRuntimeDirectoryPath() + "/render_trace.on";
}

std::string GetEntryTraceLogPath() {
  return runtime_internal::GetRuntimeDirectoryPath() + "/entry_trace.log";
}

std::string GetColorTraceLogPath() {
  return runtime_internal::GetRuntimeDirectoryPath() + "/color_trace.log";
}

void WriteEntryTraceLine(const std::string& line) {
  const std::string flagPath = GetEntryTraceFlagPath();
  if (flagPath.empty() || !runtime_internal::FileExists(flagPath)) {
    return;
  }
  const std::string logPath = GetEntryTraceLogPath();
  if (logPath.empty()) {
    return;
  }
  std::ofstream stream(logPath.c_str(), std::ios::out | std::ios::app);
  if (!stream.is_open()) {
    return;
  }
  stream << line << '\n';
}

void AppendColorTraceLine(const std::string& line) {
  const std::string logPath = GetColorTraceLogPath();
  if (logPath.empty()) {
    return;
  }
  std::ofstream stream(logPath.c_str(), std::ios::out | std::ios::app);
  if (!stream.is_open()) {
    return;
  }
  const auto now = std::chrono::system_clock::now();
  const auto timestampMs = std::chrono::duration_cast<std::chrono::milliseconds>(
    now.time_since_epoch()
  ).count();
  stream << "ts_ms=" << timestampMs << ' ' << line << '\n';
}

void TracePluginEntry(
  const char* phase,
  PF_InData* in_data,
  const std::string& details = std::string()
) {
  std::ostringstream stream;
  const auto now = std::chrono::system_clock::now();
  const auto timestampMs = std::chrono::duration_cast<std::chrono::milliseconds>(
    now.time_since_epoch()
  ).count();
  stream << "ts_ms=" << timestampMs;
  stream << " phase=" << (phase ? phase : "unknown");
  stream << " effect_ref=" << GetEffectRefKey(in_data);
  if (in_data) {
    stream << " width=" << in_data->width;
    stream << " height=" << in_data->height;
    stream << " current_time=" << runtime_internal::GetCompTimeSeconds(in_data);
  }
  if (!details.empty()) {
    stream << ' ' << details;
  }
  WriteEntryTraceLine(stream.str());
}

std::mutex gEffectInstanceRegistryMutex;
std::unordered_map<std::uintptr_t, std::uint64_t> gEffectInstanceRegistry;
std::mutex gEffectSyncedRevisionMutex;
std::unordered_map<std::uintptr_t, A_long> gEffectSyncedRevisions;
std::mutex gInstanceSyncedRevisionMutex;
std::unordered_map<std::uint64_t, A_long> gInstanceSyncedRevisions;
std::mutex gEffectSyncedControllerHashMutex;
std::unordered_map<std::uintptr_t, std::string> gEffectSyncedControllerHashes;
std::mutex gInstanceSyncedControllerHashMutex;
std::unordered_map<std::uint64_t, std::string> gInstanceSyncedControllerHashes;
std::mutex gPointOverlayStateMutex;
std::unordered_map<std::uint64_t, int> gPointOverlayActiveSlots;
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
void UnregisterSyncedControllerHash(PF_InData* in_data);
std::uint64_t ResolveKnownInstanceId(PF_InData* in_data, A_long paramInstanceId = 0);
A_long ReadSequenceSyncedRevision(PF_InData* in_data, PF_Handle handle);
bool WriteSequenceSyncedRevision(PF_InData* in_data, PF_Handle handle, A_long revision);
PF_Err SyncControllerParamValuesFromBundle(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  const RuntimeSketchBundle& bundle,
  const char* reason
);

std::uint64_t LookupRegisteredInstanceId(PF_InData* in_data) {
  const std::uintptr_t effectKey = GetEffectRefKey(in_data);
  if (!effectKey) {
    return 0;
  }

  const std::lock_guard<std::mutex> lock(gEffectInstanceRegistryMutex);
  const auto it = gEffectInstanceRegistry.find(effectKey);
  return it != gEffectInstanceRegistry.end() ? it->second : 0;
}

void RegisterStableInstanceId(PF_InData* in_data, std::uint64_t instanceId) {
  const std::uintptr_t effectKey = GetEffectRefKey(in_data);
  if (!effectKey || instanceId == 0) {
    return;
  }

  const std::lock_guard<std::mutex> lock(gEffectInstanceRegistryMutex);
  gEffectInstanceRegistry[effectKey] = instanceId;
}

void UnregisterStableInstanceId(PF_InData* in_data) {
  const std::uintptr_t effectKey = GetEffectRefKey(in_data);
  if (!effectKey) {
    return;
  }

  const std::lock_guard<std::mutex> lock(gEffectInstanceRegistryMutex);
  gEffectInstanceRegistry.erase(effectKey);
}

A_long LookupSyncedRevision(PF_InData* in_data, PF_ParamDef* params[]) {
  A_long paramInstanceId = 0;
  if (params && params[PARAM_INSTANCE_ID]) {
    paramInstanceId = params[PARAM_INSTANCE_ID]->u.sd.value;
  }
  const std::uint64_t instanceId = ResolveKnownInstanceId(in_data, paramInstanceId);
  if (instanceId != 0) {
    const std::lock_guard<std::mutex> lock(gInstanceSyncedRevisionMutex);
    const auto it = gInstanceSyncedRevisions.find(instanceId);
    if (it != gInstanceSyncedRevisions.end()) {
      return it->second;
    }
  }

  if (in_data && in_data->sequence_data) {
    const A_long sequenceRevision =
      ReadSequenceSyncedRevision(in_data, in_data->sequence_data);
    if (sequenceRevision >= 0) {
      return sequenceRevision;
    }
  }

  const std::uintptr_t effectKey = GetEffectRefKey(in_data);
  if (!effectKey) {
    return -1;
  }

  const std::lock_guard<std::mutex> lock(gEffectSyncedRevisionMutex);
  const auto it = gEffectSyncedRevisions.find(effectKey);
  return it != gEffectSyncedRevisions.end() ? it->second : -1;
}

void RegisterSyncedRevision(PF_InData* in_data, PF_ParamDef* params[], A_long revision) {
  A_long paramInstanceId = 0;
  if (params && params[PARAM_INSTANCE_ID]) {
    paramInstanceId = params[PARAM_INSTANCE_ID]->u.sd.value;
  }
  const std::uint64_t instanceId = ResolveKnownInstanceId(in_data, paramInstanceId);
  if (instanceId != 0) {
    const std::lock_guard<std::mutex> lock(gInstanceSyncedRevisionMutex);
    gInstanceSyncedRevisions[instanceId] = revision;
  }

  if (in_data && in_data->sequence_data) {
    WriteSequenceSyncedRevision(in_data, in_data->sequence_data, revision);
  }

  const std::uintptr_t effectKey = GetEffectRefKey(in_data);
  if (!effectKey) {
    return;
  }

  const std::lock_guard<std::mutex> lock(gEffectSyncedRevisionMutex);
  gEffectSyncedRevisions[effectKey] = revision;
}

void UnregisterSyncedRevision(PF_InData* in_data) {
  const std::uint64_t instanceId = ResolveKnownInstanceId(in_data);
  if (instanceId != 0) {
    const std::lock_guard<std::mutex> lock(gInstanceSyncedRevisionMutex);
    gInstanceSyncedRevisions.erase(instanceId);
  }

  const std::uintptr_t effectKey = GetEffectRefKey(in_data);
  if (!effectKey) {
    return;
  }

  const std::lock_guard<std::mutex> lock(gEffectSyncedRevisionMutex);
  gEffectSyncedRevisions.erase(effectKey);
}

std::string LookupSyncedControllerHash(PF_InData* in_data, PF_ParamDef* params[]) {
  std::uint64_t instanceId = 0;
  A_long paramInstanceId = 0;
  if (params && params[PARAM_INSTANCE_ID]) {
    paramInstanceId = params[PARAM_INSTANCE_ID]->u.sd.value;
  }
  instanceId = ResolveKnownInstanceId(in_data, paramInstanceId);
  if (instanceId != 0) {
    const std::lock_guard<std::mutex> lock(gInstanceSyncedControllerHashMutex);
    const auto it = gInstanceSyncedControllerHashes.find(instanceId);
    if (it != gInstanceSyncedControllerHashes.end()) {
      return it->second;
    }
  }

  const std::uintptr_t effectKey = GetEffectRefKey(in_data);
  if (!effectKey) {
    return std::string();
  }

  const std::lock_guard<std::mutex> lock(gEffectSyncedControllerHashMutex);
  const auto it = gEffectSyncedControllerHashes.find(effectKey);
  return it != gEffectSyncedControllerHashes.end() ? it->second : std::string();
}

void RegisterSyncedControllerHash(
  PF_InData* in_data,
  PF_ParamDef* params[],
  const std::string& controllerHash
) {
  A_long paramInstanceId = 0;
  if (params && params[PARAM_INSTANCE_ID]) {
    paramInstanceId = params[PARAM_INSTANCE_ID]->u.sd.value;
  }
  const std::uint64_t instanceId = ResolveKnownInstanceId(in_data, paramInstanceId);
  if (instanceId != 0) {
    const std::lock_guard<std::mutex> lock(gInstanceSyncedControllerHashMutex);
    gInstanceSyncedControllerHashes[instanceId] = controllerHash;
  }

  const std::uintptr_t effectKey = GetEffectRefKey(in_data);
  if (!effectKey) {
    return;
  }

  const std::lock_guard<std::mutex> lock(gEffectSyncedControllerHashMutex);
  gEffectSyncedControllerHashes[effectKey] = controllerHash;
}

void UnregisterSyncedControllerHash(PF_InData* in_data) {
  const std::uint64_t instanceId = ResolveKnownInstanceId(in_data);
  if (instanceId != 0) {
    const std::lock_guard<std::mutex> lock(gInstanceSyncedControllerHashMutex);
    gInstanceSyncedControllerHashes.erase(instanceId);
  }

  const std::uintptr_t effectKey = GetEffectRefKey(in_data);
  if (!effectKey) {
    return;
  }

  const std::lock_guard<std::mutex> lock(gEffectSyncedControllerHashMutex);
  gEffectSyncedControllerHashes.erase(effectKey);
}

int ClampPointOverlaySlot(int slot) {
  if (slot < 0) {
    return 0;
  }
  if (slot >= kControllerPointSlotCount) {
    return kControllerPointSlotCount - 1;
  }
  return slot;
}

void EnsureActivePointOverlaySlot(std::uint64_t instanceId) {
  if (instanceId == 0) {
    return;
  }
  const std::lock_guard<std::mutex> lock(gPointOverlayStateMutex);
  gPointOverlayActiveSlots.emplace(instanceId, 0);
}

int GetActivePointOverlaySlot(std::uint64_t instanceId) {
  if (instanceId == 0) {
    return 0;
  }
  const std::lock_guard<std::mutex> lock(gPointOverlayStateMutex);
  const auto it = gPointOverlayActiveSlots.find(instanceId);
  return it != gPointOverlayActiveSlots.end() ? ClampPointOverlaySlot(it->second) : 0;
}

void SetActivePointOverlaySlot(std::uint64_t instanceId, int slot) {
  if (instanceId == 0) {
    return;
  }
  const std::lock_guard<std::mutex> lock(gPointOverlayStateMutex);
  gPointOverlayActiveSlots[instanceId] = ClampPointOverlaySlot(slot);
}

void ClearActivePointOverlaySlot(std::uint64_t instanceId) {
  if (instanceId == 0) {
    return;
  }
  const std::lock_guard<std::mutex> lock(gPointOverlayStateMutex);
  gPointOverlayActiveSlots.erase(instanceId);
}

void ClearAllActivePointOverlaySlots() {
  const std::lock_guard<std::mutex> lock(gPointOverlayStateMutex);
  gPointOverlayActiveSlots.clear();
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
  std::uint64_t instanceId,
  PF_ParamIndex paramIndex
) {
  if (!in_data || paramIndex <= 0) {
    return 0;
  }

  const double frameRate = ResolveSketchSimulationFrameRate(
    in_data,
    static_cast<A_long>(instanceId)
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
  std::uint64_t instanceId,
  PF_ParamIndex paramIndex,
  const char* reason
) {
  if (instanceId == 0 || !IsControllerParamIndex(paramIndex)) {
    return;
  }
  const long historyStartFrame =
    ResolveControllerHistoryStartFrame(in_data, instanceId, paramIndex);
  MarkControllerHistoryDirty(
    static_cast<std::uintptr_t>(instanceId),
    historyStartFrame,
    reason
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

struct RenderInvocationInfo;

void ApplyMomentumOutFlags(PF_OutData* out_data) {
  if (!out_data) {
    return;
  }
  out_data->out_flags = kMomentumBaseOutFlags;
  out_data->out_flags2 = kMomentumBaseOutFlags2;
}

struct RenderInvocationInfo {
  A_long revision = 0;
  A_long instanceId = 0;
  ControllerPoolState controllers;
  A_long canvasLeft = 0;
  A_long canvasTop = 0;
  A_long canvasWidth = 0;
  A_long canvasHeight = 0;
  A_long tileLeft = 0;
  A_long tileTop = 0;
  A_long tileRight = 0;
  A_long tileBottom = 0;
};

struct PointHandleDrawInfo {
  int slot = -1;
  PF_Point framePoint = {0, 0};
  PF_FixedPoint layerPoint = {0, 0};
  bool visible = false;
  bool activeSelection = false;
  bool activePreview = false;
};

bool TryMapSliderParamIndexToSlot(PF_ParamIndex paramIndex, int* outSlot);
bool TryMapAngleParamIndexToSlot(PF_ParamIndex paramIndex, int* outSlot);
bool TryMapAngleValueParamIndexToSlot(PF_ParamIndex paramIndex, int* outSlot);
bool TryMapAngleUiParamIndexToSlot(PF_ParamIndex paramIndex, int* outSlot);
bool TryMapColorParamIndexToSlot(PF_ParamIndex paramIndex, int* outSlot);
bool TryMapColorValueParamIndexToSlot(PF_ParamIndex paramIndex, int* outSlot);
RuntimeControllerSlotKind ResolveControllerSlotKind(const RuntimeSketchBundle& bundle, int slot);
bool SlotUsesAngleController(const RuntimeSketchBundle& bundle, int slot);
int ResolveLogicalSlotForDenseControllerOrdinal(
  const RuntimeSketchBundle& bundle,
  RuntimeControllerSlotKind expectedKind,
  int denseOrdinal
);
DRAWBOT_ColorRGBA MakePointHandleColor(float red, float green, float blue, float alpha);

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

RuntimeSketchBundle ReadCurrentRunRuntimeSketchBundle(std::string* errorMessage) {
  return runtime_internal::ReadRuntimeSketchBundle(errorMessage);
}

PF_Err SyncSequenceRuntimeSnapshotFromLocalFiles(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[]
);

constexpr A_long kPointHandleHitSlop = 24;
constexpr A_long kPointHandleMinVisibleArm = 8;
constexpr A_long kPointHandleCenterOuterHalfSize = 5;
constexpr A_long kPointHandleCenterInnerHalfSize = 2;
constexpr A_long kPointHandleArmOuterHalfSize = 3;
constexpr A_long kPointHandleArmInnerHalfSize = 1;
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

std::string FormatAngleUiValueText(double degrees) {
  const double safeDegrees = SanitizeAngleUiDegrees(degrees);
  std::ostringstream stream;
  stream << std::fixed << std::setprecision(1) << safeDegrees << "\xC2\xB0";
  return stream.str();
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

void ContinueAngleUiDrag(
  PF_EventExtra* extra,
  int slot,
  AngleUiDragTarget dragTarget,
  double trackedValue,
  bool hasTrackedValue,
  double anchorDegrees,
  bool hasAnchorDegrees
) {
  if (!extra) {
    return;
  }
  if (extra->u.do_click.last_time) {
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

void FinalizeControllerState(ControllerPoolState* state);
void PopulateControllerStateFromParamArray(
  PF_InData* in_data,
  PF_ParamDef* params[],
  ControllerPoolState* state
);
double ClampAndSnapSliderValue(double value, const RuntimeSliderControllerSpec& config);
RuntimeSliderControllerSpec ResolveSliderControllerSpecWithDefaults(
  const RuntimeSketchBundle& bundle,
  int slot
);
RuntimeAngleControllerSpec ResolveAngleControllerSpecWithDefaults(
  const RuntimeSketchBundle& bundle,
  int slot
);
RuntimeColorControllerSpec ResolveColorControllerSpecWithDefaults(
  const RuntimeSketchBundle& bundle,
  int slot
);
RuntimeCheckboxControllerSpec ResolveCheckboxControllerSpecWithDefaults(
  const RuntimeSketchBundle& bundle,
  int slot
);
int ClampSelectControllerIndex(int value, const RuntimeSelectControllerSpec& config);
RuntimeSelectControllerSpec ResolveSelectControllerSpecWithDefaults(
  const RuntimeSketchBundle& bundle,
  int slot
);
ControllerPointValue ResolvePointControllerDefaultValue(
  const RuntimeSketchBundle& bundle,
  int slot
);
void PopulateControllerStateFromBundleDefaults(
  const RuntimeSketchBundle& bundle,
  ControllerPoolState* state
);
PF_Err CheckoutControllerState(PF_InData* in_data, ControllerPoolState* state);
std::uint64_t ResolveStableInstanceId(PF_InData* in_data, A_long paramInstanceId = 0);
std::uint64_t ResolveKnownInstanceId(PF_InData* in_data, A_long paramInstanceId);

PF_Err ResolveControllerState(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  ControllerPoolState* state
) {
  (void)out_data;
  if (!state) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  if (params) {
    PopulateControllerStateFromParamArray(in_data, params, state);
  } else {
    PF_Err err = CheckoutControllerState(in_data, state);
    if (err != PF_Err_NONE) {
      return err;
    }
  }
  return PF_Err_NONE;
}

void SyncLiveControllerStateFromParams(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  bool trustAngles = false,
  bool trustColors = false,
  bool trustSelects = false
) {
  if (!in_data || !params) {
    return;
  }

  const A_long paramInstanceId =
    params[PARAM_INSTANCE_ID] ? params[PARAM_INSTANCE_ID]->u.sd.value : 0;
  const std::uint64_t instanceId = ResolveKnownInstanceId(in_data, paramInstanceId);
  if (instanceId == 0) {
    return;
  }

  std::string bundleError;
  const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, params, &bundleError);
  ControllerPoolState mergedState;
  if (!GetLiveControllerState(static_cast<std::uintptr_t>(instanceId), &mergedState)) {
    PopulateControllerStateFromBundleDefaults(bundle, &mergedState);
  }

  ControllerPoolState paramState;
  if (ResolveControllerState(in_data, out_data, params, &paramState) == PF_Err_NONE) {
    mergedState.sliders = paramState.sliders;
    mergedState.checkboxes = paramState.checkboxes;
    mergedState.points = paramState.points;
    if (trustAngles) {
      mergedState.angles = paramState.angles;
    }
    if (trustColors) {
      mergedState.colors = paramState.colors;
    }
    if (trustSelects) {
      mergedState.selects = paramState.selects;
    }
    FinalizeControllerState(&mergedState);
    UpdateLiveControllerState(static_cast<std::uintptr_t>(instanceId), mergedState);
  }
}

void PopulateControllerStateFromBundleDefaults(
  const RuntimeSketchBundle& bundle,
  ControllerPoolState* state
) {
  if (!state) {
    return;
  }

  *state = ControllerPoolState();

  int sliderSlot = 0;
  int angleSlot = 0;
  int colorSlot = 0;
  int checkboxSlot = 0;
  int selectSlot = 0;
  int pointSlot = 0;
  for (int logicalSlot = 0; logicalSlot < kControllerSlotCount; ++logicalSlot) {
    const RuntimeControllerSlotKind kind = ResolveControllerSlotKind(bundle, logicalSlot);
    if (kind == RuntimeControllerSlotKind::kSlider) {
      if (sliderSlot < kControllerSliderSlotCount) {
        const RuntimeSliderControllerSpec config =
          ResolveSliderControllerSpecWithDefaults(bundle, logicalSlot);
        state->sliders[static_cast<std::size_t>(sliderSlot)].value =
          ClampAndSnapSliderValue(config.defaultValue, config);
      }
      sliderSlot += 1;
      continue;
    }

    if (kind == RuntimeControllerSlotKind::kAngle) {
      if (angleSlot < kControllerAngleSlotCount) {
        const RuntimeAngleControllerSpec config =
          ResolveAngleControllerSpecWithDefaults(bundle, logicalSlot);
        state->angles[static_cast<std::size_t>(angleSlot)].degrees = config.defaultValue;
      }
      angleSlot += 1;
      continue;
    }

    if (kind == RuntimeControllerSlotKind::kColor) {
      if (colorSlot < kControllerColorSlotCount) {
        state->colors[static_cast<std::size_t>(colorSlot)] =
          ResolveColorControllerSpecWithDefaults(bundle, logicalSlot).defaultValue;
      }
      colorSlot += 1;
      continue;
    }

    if (kind == RuntimeControllerSlotKind::kCheckbox) {
      if (checkboxSlot < kControllerCheckboxSlotCount) {
        const RuntimeCheckboxControllerSpec config =
          ResolveCheckboxControllerSpecWithDefaults(bundle, logicalSlot);
        state->checkboxes[static_cast<std::size_t>(checkboxSlot)].checked = config.defaultValue;
      }
      checkboxSlot += 1;
      continue;
    }

    if (kind == RuntimeControllerSlotKind::kSelect) {
      if (selectSlot < kControllerSelectSlotCount) {
        const RuntimeSelectControllerSpec config =
          ResolveSelectControllerSpecWithDefaults(bundle, logicalSlot);
        state->selects[static_cast<std::size_t>(selectSlot)].index =
          ClampSelectControllerIndex(config.defaultValue, config);
      }
      selectSlot += 1;
      continue;
    }

    if (kind == RuntimeControllerSlotKind::kPoint) {
      if (pointSlot < kControllerPointSlotCount) {
        state->points[static_cast<std::size_t>(pointSlot)] =
          ResolvePointControllerDefaultValue(bundle, logicalSlot);
      }
      pointSlot += 1;
    }
  }

  FinalizeControllerState(state);
}

void SyncLiveControllerStateFromBundle(
  PF_InData* in_data,
  PF_ParamDef* params[],
  const RuntimeSketchBundle& bundle
) {
  if (!in_data || !params) {
    return;
  }

  const A_long paramInstanceId =
    params[PARAM_INSTANCE_ID] ? params[PARAM_INSTANCE_ID]->u.sd.value : 0;
  const std::uint64_t instanceId = ResolveKnownInstanceId(in_data, paramInstanceId);
  if (instanceId == 0) {
    return;
  }

  ControllerPoolState state;
  PopulateControllerStateFromBundleDefaults(bundle, &state);
  UpdateLiveControllerState(static_cast<std::uintptr_t>(instanceId), state);
}

double FixedToDouble(PF_Fixed value) {
  return static_cast<double>(value) / 65536.0;
}

PF_Fixed DoubleToFixed(double value) {
  return static_cast<PF_Fixed>(value * 65536.0);
}

void TracePointOverlayEvent(
  const char* phase,
  PF_InData* in_data,
  PF_EventExtra* extra,
  int slot,
  std::uint64_t instanceId,
  const PF_Point* framePoint = NULL,
  const PF_FixedPoint* layerPoint = NULL
) {
  std::ostringstream details;
  details << "event_type=" << EventTypeName(extra ? extra->e_type : PF_Event_NONE);
  details << " instance_id=" << instanceId;
  details << " slot=" << slot;
  if (extra && extra->contextH && *extra->contextH) {
    details << " window=" << WindowTypeName((*extra->contextH)->w_type);
  }
  if (framePoint) {
    details << " frame_x=" << framePoint->h;
    details << " frame_y=" << framePoint->v;
  }
  if (layerPoint) {
    details << " layer_x=" << FixedToDouble(layerPoint->x);
    details << " layer_y=" << FixedToDouble(layerPoint->y);
  }
  TracePluginEntry(phase, in_data, details.str());
}

std::string BuildControllerStateHash(const ControllerPoolState& state) {
  std::ostringstream stream;
  stream << std::fixed << std::setprecision(4);
  for (const ControllerSliderValue& slider : state.sliders) {
    stream << "s:" << slider.value << ';';
  }
  for (const ControllerAngleValue& angle : state.angles) {
    stream << "a:" << angle.degrees << ';';
  }
  for (const ControllerColorValue& color : state.colors) {
    stream << "c:" << color.r << ',' << color.g << ',' << color.b << ',' << color.a << ';';
  }
  for (const ControllerCheckboxValue& checkbox : state.checkboxes) {
    stream << "b:" << (checkbox.checked ? 1 : 0) << ';';
  }
  for (const ControllerSelectValue& select : state.selects) {
    stream << "o:" << select.index << ';';
  }
  for (const ControllerPointValue& point : state.points) {
    stream << "t:" << point.x << ',' << point.y << ';';
  }
  return stream.str();
}

std::string DefaultSliderControllerLabel(int slot) {
  return "Slider " + std::to_string(slot + 1);
}

std::string DefaultAngleControllerLabel(int slot) {
  return "Angle " + std::to_string(slot + 1);
}

std::string DefaultColorControllerLabel(int slot) {
  return "Color " + std::to_string(slot + 1);
}

std::string DefaultCheckboxControllerLabel(int slot) {
  return "Checkbox " + std::to_string(slot + 1);
}

std::string DefaultSelectControllerLabel(int slot) {
  return "Select " + std::to_string(slot + 1);
}

std::string DefaultPointControllerLabel(int slot) {
  return "Point " + std::to_string(slot + 1);
}

std::string DefaultControllerLabelForKind(RuntimeControllerSlotKind kind, int slot) {
  switch (kind) {
    case RuntimeControllerSlotKind::kSlider: return DefaultSliderControllerLabel(slot);
    case RuntimeControllerSlotKind::kAngle: return DefaultAngleControllerLabel(slot);
    case RuntimeControllerSlotKind::kColor: return DefaultColorControllerLabel(slot);
    case RuntimeControllerSlotKind::kCheckbox: return DefaultCheckboxControllerLabel(slot);
    case RuntimeControllerSlotKind::kSelect: return DefaultSelectControllerLabel(slot);
    case RuntimeControllerSlotKind::kPoint: return DefaultPointControllerLabel(slot);
    default: return "Controller " + std::to_string(slot + 1);
  }
}

const char* ControllerSlotKindTraceName(RuntimeControllerSlotKind kind) {
  switch (kind) {
    case RuntimeControllerSlotKind::kSlider: return "slider";
    case RuntimeControllerSlotKind::kAngle: return "angle";
    case RuntimeControllerSlotKind::kColor: return "color";
    case RuntimeControllerSlotKind::kCheckbox: return "checkbox";
    case RuntimeControllerSlotKind::kSelect: return "select";
    case RuntimeControllerSlotKind::kPoint: return "point";
    default: return "none";
  }
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

const RuntimeControllerSlotSpec* FindControllerSlotSpec(
  const RuntimeSketchBundle& bundle,
  int slot
) {
  if (slot < 0 || static_cast<std::size_t>(slot) >= bundle.controllerSlots.size()) {
    return NULL;
  }
  return &bundle.controllerSlots[static_cast<std::size_t>(slot)];
}

RuntimeControllerSlotKind ResolveControllerSlotKind(
  const RuntimeSketchBundle& bundle,
  int slot
) {
  const RuntimeControllerSlotSpec* slotSpec = FindControllerSlotSpec(bundle, slot);
  return slotSpec ? slotSpec->kind : RuntimeControllerSlotKind::kNone;
}

std::string SanitizeControllerLabel(
  std::string label,
  const std::string& fallback
) {
  for (char& ch : label) {
    if (ch == '\r' || ch == '\n' || ch == '\t') {
      ch = ' ';
    }
  }
  const std::size_t first = label.find_first_not_of(' ');
  if (first == std::string::npos) {
    return fallback;
  }
  const std::size_t last = label.find_last_not_of(' ');
  label = label.substr(first, last - first + 1);
  return label.empty() ? fallback : label;
}

std::string ResolveControllerSlotLabel(
  const RuntimeSketchBundle& bundle,
  int slot,
  RuntimeControllerSlotKind expectedKind
) {
  const RuntimeControllerSlotSpec* slotSpec = FindControllerSlotSpec(bundle, slot);
  const std::string fallback = DefaultControllerLabelForKind(expectedKind, slot);
  if (!slotSpec || slotSpec->kind != expectedKind) {
    return fallback;
  }
  return SanitizeControllerLabel(slotSpec->label, fallback);
}

std::string BuildBundleControllerSummary(
  const RuntimeSketchBundle& bundle
) {
  std::ostringstream stream;
  stream << std::fixed << std::setprecision(3);
  std::size_t sliderCount = 0;
  std::size_t angleCount = 0;
  std::size_t colorCount = 0;
  std::size_t checkboxCount = 0;
  std::size_t selectCount = 0;
  std::size_t pointCount = 0;
  for (const RuntimeControllerSlotSpec& slot : bundle.controllerSlots) {
    if (slot.kind == RuntimeControllerSlotKind::kSlider) {
      sliderCount += 1;
    } else if (slot.kind == RuntimeControllerSlotKind::kAngle) {
      angleCount += 1;
    } else if (slot.kind == RuntimeControllerSlotKind::kColor) {
      colorCount += 1;
    } else if (slot.kind == RuntimeControllerSlotKind::kCheckbox) {
      checkboxCount += 1;
    } else if (slot.kind == RuntimeControllerSlotKind::kSelect) {
      selectCount += 1;
    } else if (slot.kind == RuntimeControllerSlotKind::kPoint) {
      pointCount += 1;
    }
  }
  stream
    << "slot_count=" << bundle.controllerSlots.size()
    << " slider_count=" << sliderCount
    << " angle_count=" << angleCount
    << " color_count=" << colorCount
    << " checkbox_count=" << checkboxCount
    << " select_count=" << selectCount
    << " point_count=" << pointCount;

  if (!bundle.controllerSlots.empty()) {
    stream << " slots=";
    for (std::size_t index = 0; index < bundle.controllerSlots.size(); ++index) {
      if (index > 0) {
        stream << '|';
      }
      const RuntimeControllerSlotSpec& slot = bundle.controllerSlots[index];
      stream << index << ':' << ControllerSlotKindTraceName(slot.kind);
      if (!slot.id.empty()) {
        stream << '#' << slot.id;
      }
      stream << ':';
      if (slot.kind == RuntimeControllerSlotKind::kSlider) {
        stream
          << ResolveControllerSlotLabel(bundle, static_cast<int>(index), RuntimeControllerSlotKind::kSlider)
          << '@'
          << slot.slider.defaultValue
          << '['
          << slot.slider.minValue
          << ','
          << slot.slider.maxValue
          << ']';
      } else if (slot.kind == RuntimeControllerSlotKind::kAngle) {
        stream
          << ResolveControllerSlotLabel(bundle, static_cast<int>(index), RuntimeControllerSlotKind::kAngle)
          << '@'
          << slot.angle.defaultValue;
      } else if (slot.kind == RuntimeControllerSlotKind::kColor) {
        stream
          << ResolveControllerSlotLabel(bundle, static_cast<int>(index), RuntimeControllerSlotKind::kColor)
          << '@'
          << slot.color.defaultValue.r << ','
          << slot.color.defaultValue.g << ','
          << slot.color.defaultValue.b << ','
          << slot.color.defaultValue.a;
      } else if (slot.kind == RuntimeControllerSlotKind::kCheckbox) {
        stream
          << ResolveControllerSlotLabel(bundle, static_cast<int>(index), RuntimeControllerSlotKind::kCheckbox)
          << '@'
          << (slot.checkbox.defaultValue ? "true" : "false");
      } else if (slot.kind == RuntimeControllerSlotKind::kSelect) {
        stream
          << ResolveControllerSlotLabel(bundle, static_cast<int>(index), RuntimeControllerSlotKind::kSelect)
          << '@'
          << slot.select.defaultValue
          << '['
          << slot.select.options.size()
          << ']';
      } else if (slot.kind == RuntimeControllerSlotKind::kPoint) {
        stream
          << ResolveControllerSlotLabel(bundle, static_cast<int>(index), RuntimeControllerSlotKind::kPoint)
          << '@'
          << slot.point.defaultValue.x
          << ','
          << slot.point.defaultValue.y;
      }
    }
  }

  return stream.str();
}

RuntimeSliderControllerSpec ResolveSliderControllerSpecWithDefaults(
  const RuntimeSketchBundle& bundle,
  int slot
) {
  RuntimeSliderControllerSpec config;
  const RuntimeControllerSlotSpec* slotSpec = FindControllerSlotSpec(bundle, slot);
  if (!slotSpec || slotSpec->kind != RuntimeControllerSlotKind::kSlider) {
    return config;
  }
  config = slotSpec->slider;
  config.label = ResolveControllerSlotLabel(bundle, slot, RuntimeControllerSlotKind::kSlider);
  if (!std::isfinite(config.minValue) || std::isnan(config.minValue)) {
    config.minValue = 0.0;
  }
  if (!std::isfinite(config.maxValue) || std::isnan(config.maxValue)) {
    config.maxValue = 100.0;
  }
  if (!std::isfinite(config.step) || std::isnan(config.step)) {
    config.step = 0.0;
  }
  if (!config.hasDefaultValue || !std::isfinite(config.defaultValue) || std::isnan(config.defaultValue)) {
    config.defaultValue = config.minValue;
  }
  return config;
}

RuntimeAngleControllerSpec ResolveAngleControllerSpecWithDefaults(
  const RuntimeSketchBundle& bundle,
  int slot
) {
  RuntimeAngleControllerSpec config;
  const RuntimeControllerSlotSpec* slotSpec = FindControllerSlotSpec(bundle, slot);
  if (!slotSpec || slotSpec->kind != RuntimeControllerSlotKind::kAngle) {
    return config;
  }
  config = slotSpec->angle;
  config.label = ResolveControllerSlotLabel(bundle, slot, RuntimeControllerSlotKind::kAngle);
  if (!config.hasDefaultValue || !std::isfinite(config.defaultValue) || std::isnan(config.defaultValue)) {
    config.defaultValue = 0.0;
  }
  return config;
}

double ClampColorComponent(double value, double fallbackValue) {
  const double safe = std::isfinite(value) && !std::isnan(value) ? value : fallbackValue;
  return std::max(0.0, std::min(1.0, safe));
}

unsigned char ColorComponentToByte(double value, double fallbackValue) {
  return static_cast<unsigned char>(std::lround(ClampColorComponent(value, fallbackValue) * 255.0));
}

RuntimeColorControllerSpec ResolveColorControllerSpecWithDefaults(
  const RuntimeSketchBundle& bundle,
  int slot
) {
  RuntimeColorControllerSpec config;
  const RuntimeControllerSlotSpec* slotSpec = FindControllerSlotSpec(bundle, slot);
  if (!slotSpec || slotSpec->kind != RuntimeControllerSlotKind::kColor) {
    return config;
  }
  config = slotSpec->color;
  config.label = ResolveControllerSlotLabel(bundle, slot, RuntimeControllerSlotKind::kColor);
  if (!config.hasDefaultValue) {
    config.defaultValue = ControllerColorValue();
  }
  config.defaultValue.r = ClampColorComponent(config.defaultValue.r, 1.0);
  config.defaultValue.g = ClampColorComponent(config.defaultValue.g, 1.0);
  config.defaultValue.b = ClampColorComponent(config.defaultValue.b, 1.0);
  config.defaultValue.a = ClampColorComponent(config.defaultValue.a, 1.0);
  return config;
}

RuntimeCheckboxControllerSpec ResolveCheckboxControllerSpecWithDefaults(
  const RuntimeSketchBundle& bundle,
  int slot
) {
  RuntimeCheckboxControllerSpec config;
  const RuntimeControllerSlotSpec* slotSpec = FindControllerSlotSpec(bundle, slot);
  if (!slotSpec || slotSpec->kind != RuntimeControllerSlotKind::kCheckbox) {
    return config;
  }
  config = slotSpec->checkbox;
  config.label = ResolveControllerSlotLabel(bundle, slot, RuntimeControllerSlotKind::kCheckbox);
  if (!config.hasDefaultValue) {
    config.defaultValue = false;
  }
  return config;
}

int ClampSelectControllerIndex(int value, const RuntimeSelectControllerSpec& config) {
  const int optionCount = std::max<int>(1, static_cast<int>(config.options.size()));
  if (value < 0) {
    return 0;
  }
  if (value >= optionCount) {
    return optionCount - 1;
  }
  return value;
}

RuntimeSelectControllerSpec ResolveSelectControllerSpecWithDefaults(
  const RuntimeSketchBundle& bundle,
  int slot
) {
  RuntimeSelectControllerSpec config;
  const RuntimeControllerSlotSpec* slotSpec = FindControllerSlotSpec(bundle, slot);
  if (!slotSpec || slotSpec->kind != RuntimeControllerSlotKind::kSelect) {
    return config;
  }
  config = slotSpec->select;
  config.label = ResolveControllerSlotLabel(bundle, slot, RuntimeControllerSlotKind::kSelect);
  for (std::size_t index = 0; index < config.options.size(); index += 1) {
    config.options[index].label =
      SanitizeControllerLabel(config.options[index].label, "Option " + std::to_string(index + 1));
  }
  if (config.options.empty()) {
    RuntimeSelectControllerOptionSpec option;
    option.label = "Option 1";
    config.options.push_back(option);
  }
  if (!config.hasDefaultValue) {
    config.defaultValue = 0;
  }
  config.defaultValue = ClampSelectControllerIndex(config.defaultValue, config);
  return config;
}

std::string BuildSelectControllerPopupItems(const RuntimeSelectControllerSpec& config) {
  std::ostringstream stream;
  for (std::size_t index = 0; index < config.options.size(); index += 1) {
    if (index > 0) {
      stream << '|';
    }
    std::string label = config.options[index].label.empty()
      ? "Option " + std::to_string(index + 1)
      : config.options[index].label;
    for (char& ch : label) {
      if (ch == '|') {
        ch = '/';
      } else if (ch == '\r' || ch == '\n' || ch == '\t') {
        ch = ' ';
      }
    }
    stream << label;
  }
  return stream.str();
}

double ClampAndSnapSliderValue(
  double value,
  const RuntimeSliderControllerSpec& config
) {
  double safeMin = std::isfinite(config.minValue) && !std::isnan(config.minValue)
    ? config.minValue
    : 0.0;
  double safeMax = std::isfinite(config.maxValue) && !std::isnan(config.maxValue)
    ? config.maxValue
    : 100.0;
  if (safeMax < safeMin) {
    const double swap = safeMin;
    safeMin = safeMax;
    safeMax = swap;
  }

  double mapped = std::isfinite(value) && !std::isnan(value) ? value : safeMin;
  if (mapped < safeMin) mapped = safeMin;
  if (mapped > safeMax) mapped = safeMax;

  const double step = std::isfinite(config.step) && !std::isnan(config.step) ? config.step : 0.0;
  if (step > 0.0) {
    mapped = std::floor((mapped - safeMin) / step) * step + safeMin;
    if (mapped < safeMin) mapped = safeMin;
    if (mapped > safeMax) mapped = safeMax;
  }

  return mapped;
}

ControllerPointValue ResolvePointControllerDefaultValue(
  const RuntimeSketchBundle& bundle,
  int slot
) {
  const RuntimeControllerSlotSpec* slotSpec = FindControllerSlotSpec(bundle, slot);
  if (!slotSpec ||
      slotSpec->kind != RuntimeControllerSlotKind::kPoint ||
      !slotSpec->point.hasDefaultValue) {
    return ControllerPointValue();
  }
  return slotSpec->point.defaultValue;
}

bool SlotUsesSliderController(
  const RuntimeSketchBundle& bundle,
  int slot
) {
  return ResolveControllerSlotKind(bundle, slot) == RuntimeControllerSlotKind::kSlider;
}

bool SlotUsesAngleController(
  const RuntimeSketchBundle& bundle,
  int slot
) {
  return ResolveControllerSlotKind(bundle, slot) == RuntimeControllerSlotKind::kAngle;
}

int ResolveDenseControllerOrdinal(
  const RuntimeSketchBundle& bundle,
  RuntimeControllerSlotKind expectedKind,
  int logicalSlot
) {
  if (logicalSlot < 0 || logicalSlot >= kControllerSlotCount) {
    return -1;
  }
  int denseOrdinal = 0;
  for (int slot = 0; slot < kControllerSlotCount; ++slot) {
    if (ResolveControllerSlotKind(bundle, slot) != expectedKind) {
      continue;
    }
    if (slot == logicalSlot) {
      return denseOrdinal;
    }
    denseOrdinal += 1;
  }
  return -1;
}

int ResolveLogicalSlotForDenseControllerOrdinal(
  const RuntimeSketchBundle& bundle,
  RuntimeControllerSlotKind expectedKind,
  int denseOrdinal
) {
  if (denseOrdinal < 0) {
    return -1;
  }
  int currentOrdinal = 0;
  for (int logicalSlot = 0; logicalSlot < kControllerSlotCount; ++logicalSlot) {
    if (ResolveControllerSlotKind(bundle, logicalSlot) != expectedKind) {
      continue;
    }
    if (currentOrdinal == denseOrdinal) {
      return logicalSlot;
    }
    currentOrdinal += 1;
  }
  return -1;
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

bool SlotUsesColorController(
  const RuntimeSketchBundle& bundle,
  int slot
) {
  return ResolveControllerSlotKind(bundle, slot) == RuntimeControllerSlotKind::kColor;
}

bool SlotUsesCheckboxController(
  const RuntimeSketchBundle& bundle,
  int slot
) {
  return ResolveControllerSlotKind(bundle, slot) == RuntimeControllerSlotKind::kCheckbox;
}

bool SlotUsesSelectController(
  const RuntimeSketchBundle& bundle,
  int slot
) {
  return ResolveControllerSlotKind(bundle, slot) == RuntimeControllerSlotKind::kSelect;
}

bool SlotUsesPointController(
  const RuntimeSketchBundle& bundle,
  int slot
) {
  return ResolveControllerSlotKind(bundle, slot) == RuntimeControllerSlotKind::kPoint;
}

void CopyParamName(PF_ParamDef* def, const std::string& name) {
  if (!def) {
    return;
  }
  std::strncpy(def->PF_DEF_NAME, name.c_str(), PF_MAX_EFFECT_PARAM_NAME_LEN);
  def->PF_DEF_NAME[PF_MAX_EFFECT_PARAM_NAME_LEN] = '\0';
}

void FinalizeControllerState(ControllerPoolState* state) {
  if (!state) {
    return;
  }
  state->stateHash = BuildControllerStateHash(*state);
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

const char* DescribeColorArbitrarySelector(int which) {
  switch (which) {
    case PF_Arbitrary_NEW_FUNC: return "new";
    case PF_Arbitrary_DISPOSE_FUNC: return "dispose";
    case PF_Arbitrary_COPY_FUNC: return "copy";
    case PF_Arbitrary_FLAT_SIZE_FUNC: return "flat_size";
    case PF_Arbitrary_FLATTEN_FUNC: return "flatten";
    case PF_Arbitrary_UNFLATTEN_FUNC: return "unflatten";
    case PF_Arbitrary_INTERP_FUNC: return "interp";
    case PF_Arbitrary_COMPARE_FUNC: return "compare";
    case PF_Arbitrary_PRINT_SIZE_FUNC: return "print_size";
    case PF_Arbitrary_PRINT_FUNC: return "print";
    case PF_Arbitrary_SCAN_FUNC: return "scan";
    default: return "unknown";
  }
}

ControllerColorValue SanitizeColorValue(const ControllerColorValue& color) {
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
  AppendColorTraceLine(
    "phase=allocate_color_arb"
    " r=" + std::to_string(data->r) +
    " g=" + std::to_string(data->g) +
    " b=" + std::to_string(data->b) +
    " a=" + std::to_string(data->a)
  );
  PF_UNLOCK_HANDLE(handle);
  *outHandle = handle;
  return PF_Err_NONE;
}

ControllerColorValue ReadColorArbHandle(PF_InData* in_data, PF_ArbitraryH arbH) {
  ControllerColorValue color;
  if (!in_data || !arbH) {
    return color;
  }
  ControllerColorValue* data =
    reinterpret_cast<ControllerColorValue*>(PF_LOCK_HANDLE(arbH));
  if (!data) {
    return color;
  }
  color = SanitizeColorValue(*data);
  AppendColorTraceLine(
    "phase=read_color_arb"
    " r=" + std::to_string(color.r) +
    " g=" + std::to_string(color.g) +
    " b=" + std::to_string(color.b) +
    " a=" + std::to_string(color.a)
  );
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
  return ReadColorArbHandle(in_data, colorParam->u.arb_d.value);
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
  AppendColorTraceLine(
    "phase=write_color_param"
    " slot=" + std::to_string(slot) +
    " param_slot=" + std::to_string(colorParamSlot) +
    " r=" + std::to_string(safeColor.r) +
    " g=" + std::to_string(safeColor.g) +
    " b=" + std::to_string(safeColor.b) +
    " a=" + std::to_string(safeColor.a) +
    " changed=1" +
    " wrote_in_place=" + std::string(wroteInPlace ? "1" : "0") +
    " had_previous_handle=" + std::string(existingHandle ? "1" : "0")
  );
}

PF_Err PersistColorControllerValue(
  PF_InData* in_data,
  PF_ParamDef* params[],
  int slot,
  const ControllerColorValue& color,
  const char* reason
) {
  if (!in_data || slot < 0 || slot >= kControllerSlotCount) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  const ControllerColorValue safeColor = SanitizeColorValue(color);
  WriteColorControllerValueToParams(in_data, params, slot, safeColor);

  AEFX_SuiteScoper<AEGP_PFInterfaceSuite1> interfaceSuite(
    in_data,
    kAEGPPFInterfaceSuite,
    kAEGPPFInterfaceSuiteVersion1,
    NULL
  );
  AEFX_SuiteScoper<AEGP_StreamSuite6> streamSuite(
    in_data,
    kAEGPStreamSuite,
    kAEGPStreamSuiteVersion6,
    NULL
  );
  AEFX_SuiteScoper<AEGP_EffectSuite5> effectSuite(
    in_data,
    kAEGPEffectSuite,
    kAEGPEffectSuiteVersion5,
    NULL
  );
  AEFX_SuiteScoper<AEGP_KeyframeSuite5> keyframeSuite(
    in_data,
    kAEGPKeyframeSuite,
    kAEGPKeyframeSuiteVersion5,
    NULL
  );
  if (!interfaceSuite.get() || !streamSuite.get() || !effectSuite.get() || !keyframeSuite.get()) {
    TracePluginEntry(
      "persist_color_stream_unavailable",
      in_data,
      "slot=" + std::to_string(slot) +
        " reason=" + std::string(reason ? reason : "unknown")
    );
    return PF_Err_NONE;
  }

  PF_Err err = PF_Err_NONE;
  AEGP_EffectRefH effectH = NULL;
  AEGP_StreamRefH streamH = NULL;
  AEGP_StreamValue2 streamValue;
  AEFX_CLR_STRUCT(streamValue);
  bool haveStreamValue = false;
  AEGP_StreamType streamType = AEGP_StreamType_NO_DATA;
  A_long numKfs = 0;
  A_Time compTime = {0, 1};
  bool wroteInPlace = false;

  const A_Err effectErr = interfaceSuite->AEGP_GetNewEffectForEffect(
    gAegpPluginId,
    in_data->effect_ref,
    &effectH
  );
  if (effectErr != A_Err_NONE || !effectH) {
    TracePluginEntry(
      "persist_color_stream_effect_error",
      in_data,
      "slot=" + std::to_string(slot) +
        " reason=" + std::string(reason ? reason : "unknown") +
        " err=" + std::to_string(static_cast<int>(effectErr))
    );
    return static_cast<PF_Err>(effectErr);
  }

  std::string bundleError;
  const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, params, &bundleError);
  const int colorParamSlot = ResolveControllerParamSlotForLogicalSlot(
    bundle,
    RuntimeControllerSlotKind::kColor,
    slot
  );
  if (colorParamSlot < 0 || colorParamSlot >= kControllerSlotCount) {
    TracePluginEntry(
      "persist_color_stream_missing_slot",
      in_data,
      "slot=" + std::to_string(slot) +
        " reason=" + std::string(reason ? reason : "unknown")
    );
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  const PF_ParamIndex paramIndex = ControllerColorValueParamIndex(colorParamSlot);
  A_Err suiteErr = streamSuite->AEGP_GetNewEffectStreamByIndex(
    gAegpPluginId,
    effectH,
    paramIndex,
    &streamH
  );
  if (suiteErr != A_Err_NONE || !streamH) {
    err = static_cast<PF_Err>(suiteErr);
    TracePluginEntry(
      "persist_color_stream_open_error",
      in_data,
      "slot=" + std::to_string(slot) +
        " param_index=" + std::to_string(static_cast<int>(paramIndex)) +
        " reason=" + std::string(reason ? reason : "unknown") +
        " err=" + std::to_string(static_cast<int>(suiteErr))
    );
    goto cleanup;
  }

  suiteErr = streamSuite->AEGP_GetStreamType(streamH, &streamType);
  if (suiteErr != A_Err_NONE) {
    err = static_cast<PF_Err>(suiteErr);
    TracePluginEntry(
      "persist_color_stream_type_error",
      in_data,
      "slot=" + std::to_string(slot) +
        " reason=" + std::string(reason ? reason : "unknown") +
        " err=" + std::to_string(static_cast<int>(suiteErr))
    );
    goto cleanup;
  }
  if (streamType != AEGP_StreamType_ARB) {
    TracePluginEntry(
      "persist_color_stream_type_mismatch",
      in_data,
      "slot=" + std::to_string(slot) +
        " stream_type=" + std::to_string(static_cast<int>(streamType)) +
        " reason=" + std::string(reason ? reason : "unknown")
    );
    goto cleanup;
  }

  suiteErr = keyframeSuite->AEGP_GetStreamNumKFs(streamH, &numKfs);
  if (suiteErr != A_Err_NONE) {
    err = static_cast<PF_Err>(suiteErr);
    TracePluginEntry(
      "persist_color_stream_kf_error",
      in_data,
      "slot=" + std::to_string(slot) +
        " reason=" + std::string(reason ? reason : "unknown") +
        " err=" + std::to_string(static_cast<int>(suiteErr))
    );
    goto cleanup;
  }
  if (numKfs == AEGP_NumKF_NO_DATA || numKfs > 0) {
    TracePluginEntry(
      "persist_color_stream_skipped",
      in_data,
      "slot=" + std::to_string(slot) +
        " reason=" + std::string(reason ? reason : "unknown") +
        " num_kfs=" + std::to_string(numKfs)
    );
    goto cleanup;
  }

  if (!runtime_internal::GetCompTime(in_data, &compTime)) {
    compTime.value = in_data->current_time;
    compTime.scale = in_data->time_scale > 0 ? in_data->time_scale : 1;
  }
  suiteErr = streamSuite->AEGP_GetNewStreamValue(
    gAegpPluginId,
    streamH,
    AEGP_LTimeMode_CompTime,
    &compTime,
    TRUE,
    &streamValue
  );
  if (suiteErr != A_Err_NONE) {
    err = static_cast<PF_Err>(suiteErr);
    TracePluginEntry(
      "persist_color_stream_read_error",
      in_data,
      "slot=" + std::to_string(slot) +
        " reason=" + std::string(reason ? reason : "unknown") +
        " err=" + std::to_string(static_cast<int>(suiteErr))
    );
    goto cleanup;
  }
  haveStreamValue = true;
  streamValue.streamH = streamH;

  if (streamValue.val.arbH) {
    ControllerColorValue* data =
      reinterpret_cast<ControllerColorValue*>(PF_LOCK_HANDLE(streamValue.val.arbH));
    if (data) {
      *data = safeColor;
      PF_UNLOCK_HANDLE(streamValue.val.arbH);
      wroteInPlace = true;
    }
  }

  if (!wroteInPlace) {
    PF_ArbitraryH nextHandle = NULL;
    err = AllocateColorArbHandle(in_data, safeColor, &nextHandle);
    if (err != PF_Err_NONE || !nextHandle) {
      TracePluginEntry(
        "persist_color_stream_allocate_error",
        in_data,
        "slot=" + std::to_string(slot) +
          " reason=" + std::string(reason ? reason : "unknown") +
          " err=" + std::to_string(static_cast<int>(err))
      );
      goto cleanup;
    }
    streamValue.val.arbH = nextHandle;
  }

  suiteErr = streamSuite->AEGP_SetStreamValue(
    gAegpPluginId,
    streamH,
    &streamValue
  );
  if (suiteErr != A_Err_NONE) {
    err = static_cast<PF_Err>(suiteErr);
    TracePluginEntry(
      "persist_color_stream_write_error",
      in_data,
      "slot=" + std::to_string(slot) +
        " reason=" + std::string(reason ? reason : "unknown") +
        " err=" + std::to_string(static_cast<int>(suiteErr))
    );
    goto cleanup;
  }

  TracePluginEntry(
    "persist_color_stream",
    in_data,
    "slot=" + std::to_string(slot) +
      " reason=" + std::string(reason ? reason : "unknown") +
      " wrote_in_place=" + std::string(wroteInPlace ? "1" : "0") +
      " color=" + std::to_string(safeColor.r) + "," +
      std::to_string(safeColor.g) + "," +
      std::to_string(safeColor.b) + "," +
      std::to_string(safeColor.a)
  );

cleanup:
  if (haveStreamValue) {
    A_Err disposeValueErr = streamSuite->AEGP_DisposeStreamValue(&streamValue);
    (void)disposeValueErr;
  }
  if (streamH) {
    A_Err disposeStreamErr = streamSuite->AEGP_DisposeStream(streamH);
    (void)disposeStreamErr;
  }
  if (effectH) {
    A_Err disposeEffectErr = effectSuite->AEGP_DisposeEffect(effectH);
    (void)disposeEffectErr;
  }
  return err;
}

PF_Err PersistAngleControllerValue(
  PF_InData* in_data,
  PF_ParamDef* params[],
  int slot,
  double degrees,
  const char* reason
) {
  if (!in_data || slot < 0 || slot >= kControllerSlotCount) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  const double safeDegrees =
    (std::isfinite(degrees) && !std::isnan(degrees)) ? degrees : 0.0;
  std::string bundleError;
  const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, params, &bundleError);
  const int angleParamSlot = ResolveAngleParamSlotForLogicalSlot(bundle, slot);
  if (angleParamSlot < 0 || angleParamSlot >= kControllerSlotCount) {
    TracePluginEntry(
      "persist_angle_stream_missing_slot",
      in_data,
      "slot=" + std::to_string(slot) +
        " reason=" + std::string(reason ? reason : "unknown")
    );
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  WriteAngleControllerValueToParams(params, angleParamSlot, safeDegrees);

  AEFX_SuiteScoper<AEGP_PFInterfaceSuite1> interfaceSuite(
    in_data,
    kAEGPPFInterfaceSuite,
    kAEGPPFInterfaceSuiteVersion1,
    NULL
  );
  AEFX_SuiteScoper<AEGP_StreamSuite6> streamSuite(
    in_data,
    kAEGPStreamSuite,
    kAEGPStreamSuiteVersion6,
    NULL
  );
  AEFX_SuiteScoper<AEGP_EffectSuite5> effectSuite(
    in_data,
    kAEGPEffectSuite,
    kAEGPEffectSuiteVersion5,
    NULL
  );
  AEFX_SuiteScoper<AEGP_KeyframeSuite5> keyframeSuite(
    in_data,
    kAEGPKeyframeSuite,
    kAEGPKeyframeSuiteVersion5,
    NULL
  );
  if (!interfaceSuite.get() || !streamSuite.get() || !effectSuite.get() || !keyframeSuite.get()) {
    TracePluginEntry(
      "persist_angle_stream_unavailable",
      in_data,
      "slot=" + std::to_string(slot) +
        " reason=" + std::string(reason ? reason : "unknown")
    );
    return PF_Err_NONE;
  }

  PF_Err err = PF_Err_NONE;
  AEGP_EffectRefH effectH = NULL;
  AEGP_StreamRefH streamH = NULL;
  AEGP_StreamValue2 streamValue;
  AEFX_CLR_STRUCT(streamValue);
  bool haveStreamValue = false;
  AEGP_StreamType streamType = AEGP_StreamType_NO_DATA;
  A_long numKfs = 0;
  A_Time compTime = {0, 1};

  const A_Err effectErr = interfaceSuite->AEGP_GetNewEffectForEffect(
    gAegpPluginId,
    in_data->effect_ref,
    &effectH
  );
  if (effectErr != A_Err_NONE || !effectH) {
    TracePluginEntry(
      "persist_angle_stream_effect_error",
      in_data,
      "slot=" + std::to_string(slot) +
        " reason=" + std::string(reason ? reason : "unknown") +
        " err=" + std::to_string(static_cast<int>(effectErr))
    );
    return static_cast<PF_Err>(effectErr);
  }

  const PF_ParamIndex paramIndex = ControllerAngleValueParamIndex(angleParamSlot);
  A_Err suiteErr = streamSuite->AEGP_GetNewEffectStreamByIndex(
    gAegpPluginId,
    effectH,
    paramIndex,
    &streamH
  );
  if (suiteErr != A_Err_NONE || !streamH) {
    err = static_cast<PF_Err>(suiteErr);
    TracePluginEntry(
      "persist_angle_stream_open_error",
      in_data,
      "slot=" + std::to_string(slot) +
        " param_index=" + std::to_string(static_cast<int>(paramIndex)) +
        " reason=" + std::string(reason ? reason : "unknown") +
        " err=" + std::to_string(static_cast<int>(suiteErr))
    );
    goto cleanup;
  }

  suiteErr = streamSuite->AEGP_GetStreamType(streamH, &streamType);
  if (suiteErr != A_Err_NONE) {
    err = static_cast<PF_Err>(suiteErr);
    TracePluginEntry(
      "persist_angle_stream_type_error",
      in_data,
      "slot=" + std::to_string(slot) +
        " reason=" + std::string(reason ? reason : "unknown") +
        " err=" + std::to_string(static_cast<int>(suiteErr))
    );
    goto cleanup;
  }
  if (streamType != AEGP_StreamType_OneD) {
    TracePluginEntry(
      "persist_angle_stream_type_mismatch",
      in_data,
      "slot=" + std::to_string(slot) +
        " stream_type=" + std::to_string(static_cast<int>(streamType)) +
        " reason=" + std::string(reason ? reason : "unknown")
    );
    goto cleanup;
  }

  suiteErr = keyframeSuite->AEGP_GetStreamNumKFs(streamH, &numKfs);
  if (suiteErr != A_Err_NONE) {
    err = static_cast<PF_Err>(suiteErr);
    TracePluginEntry(
      "persist_angle_stream_kf_error",
      in_data,
      "slot=" + std::to_string(slot) +
        " reason=" + std::string(reason ? reason : "unknown") +
        " err=" + std::to_string(static_cast<int>(suiteErr))
    );
    goto cleanup;
  }
  if (numKfs == AEGP_NumKF_NO_DATA || numKfs > 0) {
    TracePluginEntry(
      "persist_angle_stream_skipped",
      in_data,
      "slot=" + std::to_string(slot) +
        " reason=" + std::string(reason ? reason : "unknown") +
        " num_kfs=" + std::to_string(numKfs)
    );
    goto cleanup;
  }

  if (!runtime_internal::GetCompTime(in_data, &compTime)) {
    compTime.value = in_data->current_time;
    compTime.scale = in_data->time_scale > 0 ? in_data->time_scale : 1;
  }
  suiteErr = streamSuite->AEGP_GetNewStreamValue(
    gAegpPluginId,
    streamH,
    AEGP_LTimeMode_CompTime,
    &compTime,
    TRUE,
    &streamValue
  );
  if (suiteErr != A_Err_NONE) {
    err = static_cast<PF_Err>(suiteErr);
    TracePluginEntry(
      "persist_angle_stream_read_error",
      in_data,
      "slot=" + std::to_string(slot) +
        " reason=" + std::string(reason ? reason : "unknown") +
        " err=" + std::to_string(static_cast<int>(suiteErr))
    );
    goto cleanup;
  }
  haveStreamValue = true;
  streamValue.streamH = streamH;
  streamValue.val.one_d = static_cast<AEGP_OneDVal>(safeDegrees);

  suiteErr = streamSuite->AEGP_SetStreamValue(
    gAegpPluginId,
    streamH,
    &streamValue
  );
  if (suiteErr != A_Err_NONE) {
    err = static_cast<PF_Err>(suiteErr);
    TracePluginEntry(
      "persist_angle_stream_write_error",
      in_data,
      "slot=" + std::to_string(slot) +
        " reason=" + std::string(reason ? reason : "unknown") +
        " err=" + std::to_string(static_cast<int>(suiteErr))
    );
    goto cleanup;
  }

  TracePluginEntry(
    "persist_angle_stream",
    in_data,
    "slot=" + std::to_string(slot) +
      " reason=" + std::string(reason ? reason : "unknown") +
      " degrees=" + std::to_string(safeDegrees)
  );

cleanup:
  if (haveStreamValue) {
    A_Err disposeValueErr = streamSuite->AEGP_DisposeStreamValue(&streamValue);
    (void)disposeValueErr;
  }
  if (streamH) {
    A_Err disposeStreamErr = streamSuite->AEGP_DisposeStream(streamH);
    (void)disposeStreamErr;
  }
  if (effectH) {
    A_Err disposeEffectErr = effectSuite->AEGP_DisposeEffect(effectH);
    (void)disposeEffectErr;
  }
  return err;
}

void MarkControllerColorHistoryDirty(
  PF_InData* in_data,
  std::uint64_t instanceId,
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
    instanceId,
    ControllerColorValueParamIndex(colorParamSlot),
    reason
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
  int slot = -1;
  std::string bundleError;
  const RuntimeSketchBundle bundle = ReadCurrentRunRuntimeSketchBundle(&bundleError);
  ControllerColorValue color;
  if (TryMapColorValueParamIndexToSlot(paramId, &slot) && slot >= 0) {
    const int logicalSlot = ResolveLogicalSlotForControllerParamSlot(
      bundle,
      RuntimeControllerSlotKind::kColor,
      slot
    );
    if (logicalSlot >= 0) {
      color = ResolveColorControllerSpecWithDefaults(bundle, logicalSlot).defaultValue;
    }
  }
  return AllocateColorArbHandle(in_data, color, outHandle);
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

  AppendColorTraceLine(
    "phase=arb_callback"
    " which=" + std::to_string(static_cast<int>(extra->which_function)) +
    " name=" + DescribeColorArbitrarySelector(extra->which_function)
  );

  switch (extra->which_function) {
    case PF_Arbitrary_NEW_FUNC:
      if (!IsColorArbRefcon(extra->u.new_func_params.refconPV)) {
        AppendColorTraceLine("phase=arb_callback_refcon_mismatch name=new");
        return PF_Err_NONE;
      }
      return AllocateDefaultColorArbHandleForSlot(
        in_data,
        extra->id,
        extra->u.new_func_params.arbPH
      );

    case PF_Arbitrary_DISPOSE_FUNC:
      if (!IsColorArbRefcon(extra->u.dispose_func_params.refconPV)) {
        AppendColorTraceLine("phase=arb_callback_refcon_mismatch name=dispose");
        return PF_Err_NONE;
      }
      if (extra->u.dispose_func_params.arbH) {
        PF_DISPOSE_HANDLE(extra->u.dispose_func_params.arbH);
      }
      return PF_Err_NONE;

    case PF_Arbitrary_COPY_FUNC: {
      if (!IsColorArbRefcon(extra->u.copy_func_params.refconPV)) {
        AppendColorTraceLine("phase=arb_callback_refcon_mismatch name=copy");
        return PF_Err_NONE;
      }
      const ControllerColorValue color =
        ReadColorArbHandle(in_data, extra->u.copy_func_params.src_arbH);
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
      const ControllerColorValue left =
        ReadColorArbHandle(in_data, extra->u.interp_func_params.left_arbH);
      const ControllerColorValue right =
        ReadColorArbHandle(in_data, extra->u.interp_func_params.right_arbH);
      const double t = std::max(0.0, std::min(1.0, static_cast<double>(extra->u.interp_func_params.tF)));
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
      const ControllerColorValue left =
        ReadColorArbHandle(in_data, extra->u.compare_func_params.a_arbH);
      const ControllerColorValue right =
        ReadColorArbHandle(in_data, extra->u.compare_func_params.b_arbH);
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
      AppendColorTraceLine(
        "phase=arb_callback_unhandled"
        " which=" + std::to_string(static_cast<int>(extra->which_function))
      );
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
  AppendColorTraceLine(
    "phase=picker_result"
    " err=" + std::to_string(err) +
    " in_r=" + std::to_string(sampleColor.red) +
    " in_g=" + std::to_string(sampleColor.green) +
    " in_b=" + std::to_string(sampleColor.blue) +
    " in_a=" + std::to_string(sampleColor.alpha) +
    " out_r=" + std::to_string(nextColor.red) +
    " out_g=" + std::to_string(nextColor.green) +
    " out_b=" + std::to_string(nextColor.blue) +
    " out_a=" + std::to_string(nextColor.alpha)
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
      if (pointVisible || kDebugExposeAllControllerParams) {
        pointDef.ui_flags &= ~PF_PUI_INVISIBLE;
      } else {
        pointDef.ui_flags |= PF_PUI_INVISIBLE;
      }
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
      if (sliderVisible || kDebugExposeAllControllerParams) {
        sliderDef.ui_flags &= ~PF_PUI_INVISIBLE;
        sliderDef.ui_width = 0;
        sliderDef.ui_height = 0;
      } else {
        sliderDef.ui_flags |= PF_PUI_INVISIBLE;
        sliderDef.ui_width = 0;
        sliderDef.ui_height = 0;
      }
      CopyParamName(
        &sliderDef,
        config.label.empty() ? DefaultSliderControllerLabel(slot) : config.label
      );
      ResolveSafeSliderUiRange(
        config.minValue,
        config.maxValue,
        &sliderDef.u.fs_d.valid_min,
        &sliderDef.u.fs_d.valid_max,
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
      angleValueDef.ui_flags = kAngleControlUiFlags;
      angleValueDef.ui_width = kAngleControlUiWidth;
      angleValueDef.ui_height = kAngleControlUiHeight;
      if (!angleVisible && !kDebugExposeAllControllerParams) {
        angleValueDef.ui_flags |= PF_PUI_INVISIBLE;
      }
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
      angleUiDef.ui_flags = kDebugExposeAllControllerParams ? PF_PUI_NONE : (PF_PUI_INVISIBLE | PF_PUI_NO_ECW_UI);
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
      colorDef.ui_flags = kColorControlUiFlags;
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
      if (checkboxVisible || kDebugExposeAllControllerParams) {
        checkboxDef.ui_flags &= ~PF_PUI_INVISIBLE;
      } else {
        checkboxDef.ui_flags |= PF_PUI_INVISIBLE;
      }
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
      const std::string selectItems = BuildSelectControllerPopupItems(config);
      if (selectVisible || kDebugExposeAllControllerParams) {
        selectDef.ui_flags &= ~PF_PUI_INVISIBLE;
      } else {
        selectDef.ui_flags |= PF_PUI_INVISIBLE;
      }
      selectDef.u.pd.num_choices = static_cast<A_short>(std::max<std::size_t>(1, config.options.size()));
      selectDef.u.pd.u.PF_DEF_NAMESPTR = selectItems.c_str();
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

  if (out_data) {
    out_data->out_flags |= PF_OutFlag_REFRESH_UI;
  }
  return PF_Err_NONE;
}

void PopulateControllerStateFromParamArray(
  PF_InData* in_data,
  PF_ParamDef* params[],
  ControllerPoolState* state
) {
  if (!params || !state) {
    return;
  }

  *state = ControllerPoolState();

  std::string bundleError;
  const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, NULL, &bundleError);
  (void)bundleError;

  int sliderSlot = 0;
  int angleSlot = 0;
  int colorSlot = 0;
  int checkboxSlot = 0;
  int selectSlot = 0;
  int pointSlot = 0;
  for (int logicalSlot = 0; logicalSlot < kControllerSlotCount; ++logicalSlot) {
    const RuntimeControllerSlotKind kind = ResolveControllerSlotKind(bundle, logicalSlot);
    if (kind == RuntimeControllerSlotKind::kSlider) {
      PF_ParamDef* param = params[ControllerSliderParamIndex(logicalSlot)];
      if (param && sliderSlot < kControllerSliderSlotCount) {
        const RuntimeSliderControllerSpec config =
          ResolveSliderControllerSpecWithDefaults(bundle, logicalSlot);
        state->sliders[static_cast<std::size_t>(sliderSlot)].value =
          ClampAndSnapSliderValue(param->u.fs_d.value, config);
      }
      sliderSlot += 1;
      continue;
    }

    if (kind == RuntimeControllerSlotKind::kAngle) {
      PF_ParamDef* param = params[ControllerAngleValueParamIndex(logicalSlot)];
      if (param && angleSlot < kControllerAngleSlotCount) {
        state->angles[static_cast<std::size_t>(angleSlot)].degrees =
          static_cast<double>(param->u.fs_d.value);
      }
      angleSlot += 1;
      continue;
    }

    if (kind == RuntimeControllerSlotKind::kColor) {
      if (colorSlot < kControllerColorSlotCount) {
        PF_ParamDef* param = params[ControllerColorValueParamIndex(logicalSlot)];
        if (param) {
          state->colors[static_cast<std::size_t>(colorSlot)] =
            ReadColorArbHandle(in_data, param->u.arb_d.value);
        }
      }
      colorSlot += 1;
      continue;
    }

    if (kind == RuntimeControllerSlotKind::kCheckbox) {
      PF_ParamDef* param = params[ControllerCheckboxParamIndex(logicalSlot)];
      if (param && checkboxSlot < kControllerCheckboxSlotCount) {
        state->checkboxes[static_cast<std::size_t>(checkboxSlot)].checked =
          param->u.bd.value != FALSE;
      }
      checkboxSlot += 1;
      continue;
    }

    if (kind == RuntimeControllerSlotKind::kSelect) {
      PF_ParamDef* param = params[ControllerSelectParamIndex(logicalSlot)];
      if (param && selectSlot < kControllerSelectSlotCount) {
        const RuntimeSelectControllerSpec config =
          ResolveSelectControllerSpecWithDefaults(bundle, logicalSlot);
        state->selects[static_cast<std::size_t>(selectSlot)].index =
          ClampSelectControllerIndex(static_cast<int>(param->u.pd.value) - 1, config);
      }
      selectSlot += 1;
      continue;
    }

    if (kind == RuntimeControllerSlotKind::kPoint) {
      PF_ParamDef* param = params[ControllerPointParamIndex(logicalSlot)];
      if (param && pointSlot < kControllerPointSlotCount) {
        ControllerPointValue& point = state->points[static_cast<std::size_t>(pointSlot)];
        point.x = FixedToDouble(param->u.td.x_value);
        point.y = FixedToDouble(param->u.td.y_value);
      }
      pointSlot += 1;
    }
  }

  FinalizeControllerState(state);
}

PF_Err CheckoutControllerState(PF_InData* in_data, ControllerPoolState* state) {
  if (!in_data || !state) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  *state = ControllerPoolState();

  std::string bundleError;
  const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, NULL, &bundleError);
  (void)bundleError;

  PF_ParamDef param;

  int sliderSlot = 0;
  int angleSlot = 0;
  int colorSlot = 0;
  int checkboxSlot = 0;
  int selectSlot = 0;
  int pointSlot = 0;
  for (int logicalSlot = 0; logicalSlot < kControllerSlotCount; ++logicalSlot) {
    const RuntimeControllerSlotKind kind = ResolveControllerSlotKind(bundle, logicalSlot);
    PF_ParamIndex paramIndex = ControllerPointParamIndex(logicalSlot);
    if (kind == RuntimeControllerSlotKind::kSlider) {
      paramIndex = ControllerSliderParamIndex(logicalSlot);
    } else if (kind == RuntimeControllerSlotKind::kAngle) {
      paramIndex = ControllerAngleValueParamIndex(logicalSlot);
    } else if (kind == RuntimeControllerSlotKind::kCheckbox) {
      paramIndex = ControllerCheckboxParamIndex(logicalSlot);
    } else if (kind == RuntimeControllerSlotKind::kSelect) {
      paramIndex = ControllerSelectParamIndex(logicalSlot);
    }
    if (kind == RuntimeControllerSlotKind::kNone) {
      continue;
    }

    if (kind == RuntimeControllerSlotKind::kColor) {
      PF_ParamDef colorParam;
      AEFX_CLR_STRUCT(colorParam);
      PF_Err err = PF_CHECKOUT_PARAM(
        in_data,
        ControllerColorValueParamIndex(logicalSlot),
        in_data->current_time,
        in_data->time_step,
        in_data->time_scale,
        &colorParam
      );
      if (err != PF_Err_NONE) {
        return err;
      }
      if (colorSlot < kControllerColorSlotCount) {
        state->colors[static_cast<std::size_t>(colorSlot)] =
          ReadColorArbHandle(in_data, colorParam.u.arb_d.value);
      }
      PF_CHECKIN_PARAM(in_data, &colorParam);
      colorSlot += 1;
      continue;
    }

    AEFX_CLR_STRUCT(param);
    PF_Err err = PF_CHECKOUT_PARAM(
      in_data,
      paramIndex,
      in_data->current_time,
      in_data->time_step,
      in_data->time_scale,
      &param
    );
    if (err != PF_Err_NONE) {
      return err;
    }

    if (kind == RuntimeControllerSlotKind::kSlider) {
      if (sliderSlot < kControllerSliderSlotCount) {
        const RuntimeSliderControllerSpec config =
          ResolveSliderControllerSpecWithDefaults(bundle, logicalSlot);
        state->sliders[static_cast<std::size_t>(sliderSlot)].value =
          ClampAndSnapSliderValue(param.u.fs_d.value, config);
      }
      sliderSlot += 1;
    } else if (kind == RuntimeControllerSlotKind::kAngle) {
      if (angleSlot < kControllerAngleSlotCount) {
        state->angles[static_cast<std::size_t>(angleSlot)].degrees =
          static_cast<double>(param.u.fs_d.value);
      }
      angleSlot += 1;
    } else if (kind == RuntimeControllerSlotKind::kCheckbox) {
      if (checkboxSlot < kControllerCheckboxSlotCount) {
        state->checkboxes[static_cast<std::size_t>(checkboxSlot)].checked =
          param.u.bd.value != FALSE;
      }
      checkboxSlot += 1;
    } else if (kind == RuntimeControllerSlotKind::kSelect) {
      if (selectSlot < kControllerSelectSlotCount) {
        const RuntimeSelectControllerSpec config =
          ResolveSelectControllerSpecWithDefaults(bundle, logicalSlot);
        state->selects[static_cast<std::size_t>(selectSlot)].index =
          ClampSelectControllerIndex(static_cast<int>(param.u.pd.value) - 1, config);
      }
      selectSlot += 1;
    } else if (kind == RuntimeControllerSlotKind::kPoint) {
      if (pointSlot < kControllerPointSlotCount) {
        ControllerPointValue& point = state->points[static_cast<std::size_t>(pointSlot)];
        point.x = FixedToDouble(param.u.td.x_value);
        point.y = FixedToDouble(param.u.td.y_value);
      }
      pointSlot += 1;
    }

    PF_CHECKIN_PARAM(in_data, &param);
  }

  FinalizeControllerState(state);
  return PF_Err_NONE;
}

void DisposeRenderInvocationInfo(void* preRenderData) {
  if (preRenderData) {
    delete reinterpret_cast<RenderInvocationInfo*>(preRenderData);
  }
}

PF_Err RegisterCustomUI(PF_InData* in_data) {
  if (!in_data || !in_data->inter.register_ui) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  PF_CustomUIInfo ci;
  AEFX_CLR_STRUCT(ci);
  ci.events = PF_CustomEFlag_EFFECT | PF_CustomEFlag_LAYER | PF_CustomEFlag_COMP;
  ci.comp_ui_width = 0;
  ci.comp_ui_height = 0;
  ci.comp_ui_alignment = PF_UIAlignment_NONE;
  ci.layer_ui_width = 0;
  ci.layer_ui_height = 0;
  ci.layer_ui_alignment = PF_UIAlignment_NONE;
  ci.preview_ui_width = 0;
  ci.preview_ui_height = 0;
  ci.preview_ui_alignment = PF_UIAlignment_NONE;
  return (*(in_data->inter.register_ui))(in_data->effect_ref, &ci);
}

void ContinuePointControllerDrag(PF_EventExtra* extra, int slot) {
  if (!extra) {
    return;
  }

  const bool lastTime = extra->u.do_click.last_time != FALSE;
  extra->u.do_click.send_drag = lastTime ? FALSE : TRUE;
  if (lastTime) {
    extra->u.do_click.continue_refcon[0] = 0;
    extra->u.do_click.continue_refcon[1] = 0;
    extra->u.do_click.continue_refcon[2] = 0;
    extra->u.do_click.continue_refcon[3] = 0;
    return;
  }

  extra->u.do_click.continue_refcon[0] = slot + 1;
}

void RequestCustomUIRefresh(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_EventExtra* extra,
  bool forceRender
) {
  if (!extra) {
    return;
  }

  extra->evt_out_flags |= PF_EO_HANDLED_EVENT;

  if (out_data) {
    out_data->out_flags |= PF_OutFlag_REFRESH_UI;
    if (forceRender) {
      out_data->out_flags |= PF_OutFlag_FORCE_RERENDER;
    }
  }

  if (!in_data || !out_data || !extra->contextH) {
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

std::uint64_t ResolvePointControllerInstanceId(PF_InData* in_data, PF_ParamDef* params[]) {
  A_long paramInstanceId = 0;
  if (params && params[PARAM_INSTANCE_ID]) {
    paramInstanceId = params[PARAM_INSTANCE_ID]->u.sd.value;
  }
  return ResolveStableInstanceId(in_data, paramInstanceId);
}

void FramePointToLayerPoint(
  PF_InData* in_data,
  PF_EventExtra* extra,
  const PF_Point& framePoint,
  PF_FixedPoint* outLayerPoint
) {
  if (!in_data || !extra || !extra->contextH || !outLayerPoint) {
    return;
  }
  outLayerPoint->x = INT2FIX(framePoint.h);
  outLayerPoint->y = INT2FIX(framePoint.v);
  extra->cbs.frame_to_source(extra->cbs.refcon, extra->contextH, outLayerPoint);
  if ((*extra->contextH)->w_type == PF_Window_COMP) {
    extra->cbs.comp_to_layer(
      extra->cbs.refcon,
      extra->contextH,
      in_data->current_time,
      in_data->time_scale,
      outLayerPoint
    );
  }
}

void LayerPointToFramePoint(
  PF_InData* in_data,
  PF_EventExtra* extra,
  const PF_FixedPoint& layerPoint,
  PF_Point* outFramePoint
) {
  if (!in_data || !extra || !extra->contextH || !outFramePoint) {
    return;
  }
  PF_FixedPoint framePoint = layerPoint;
  if ((*extra->contextH)->w_type == PF_Window_COMP) {
    extra->cbs.layer_to_comp(
      extra->cbs.refcon,
      extra->contextH,
      in_data->current_time,
      in_data->time_scale,
      &framePoint
    );
  }
  extra->cbs.source_to_frame(extra->cbs.refcon, extra->contextH, &framePoint);
  outFramePoint->h = FIX2INT(framePoint.x);
  outFramePoint->v = FIX2INT(framePoint.y);
}

bool TryMapPointParamIndexToSlot(PF_ParamIndex paramIndex, int* outSlot) {
  if (paramIndex < ControllerPointParamIndex(0) ||
      paramIndex > ControllerPointParamIndex(kControllerSlotCount - 1)) {
    return false;
  }
  const int relativeIndex = static_cast<int>(paramIndex - ControllerPointParamIndex(0));
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

bool TryMapColorValueParamIndexToSlot(PF_ParamIndex paramIndex, int* outSlot) {
  return TryMapColorParamIndexToSlot(paramIndex, outSlot);
}

bool TryMapCheckboxParamIndexToSlot(PF_ParamIndex paramIndex, int* outSlot) {
  if (paramIndex < ControllerCheckboxParamIndex(0) ||
      paramIndex > ControllerCheckboxParamIndex(kControllerSlotCount - 1)) {
    return false;
  }
  const int relativeIndex = static_cast<int>(paramIndex - ControllerCheckboxParamIndex(0));
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

bool TryMapSelectParamIndexToSlot(PF_ParamIndex paramIndex, int* outSlot) {
  if (paramIndex < ControllerSelectParamIndex(0) ||
      paramIndex > ControllerSelectParamIndex(kControllerSlotCount - 1)) {
    return false;
  }
  const int relativeIndex = static_cast<int>(paramIndex - ControllerSelectParamIndex(0));
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

bool PopulatePointHandleDrawInfos(
  PF_InData* in_data,
  PF_EventExtra* extra,
  PF_ParamDef* params[],
  std::array<PointHandleDrawInfo, kControllerPointSlotCount>* outInfos
) {
  if (!in_data || !extra || !params || !outInfos) {
    return false;
  }

  const std::uint64_t instanceId = ResolvePointControllerInstanceId(in_data, params);
  EnsureActivePointOverlaySlot(instanceId);
  const int activeSlot = GetActivePointOverlaySlot(instanceId);
  std::string bundleError;
  const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, params, &bundleError);
  (void)bundleError;

  bool any = false;
  for (int slot = 0; slot < kControllerPointSlotCount; ++slot) {
    PointHandleDrawInfo& info = (*outInfos)[static_cast<std::size_t>(slot)];
    info.slot = slot;
    const int logicalSlot = ResolveLogicalSlotForControllerParamSlot(
      bundle,
      RuntimeControllerSlotKind::kPoint,
      slot
    );

    PF_ParamDef* param = params[ControllerPointParamIndex(slot)];
    if (!param) {
      continue;
    }

    info.activeSelection = (slot == activeSlot) && logicalSlot >= 0;
    info.activePreview = false;
    info.visible = info.activeSelection;
    if (!info.visible) {
      continue;
    }

    info.layerPoint.x = param->u.td.x_value;
    info.layerPoint.y = param->u.td.y_value;
    LayerPointToFramePoint(in_data, extra, info.layerPoint, &info.framePoint);
    any = true;
  }
  return any;
}

int HitTestPointHandle(
  const std::array<PointHandleDrawInfo, kControllerPointSlotCount>& infos,
  const PF_Point& mousePoint
) {
  int bestSlot = -1;
  A_long bestDistance = std::numeric_limits<A_long>::max();
  for (const PointHandleDrawInfo& info : infos) {
    if (info.slot < 0 || !info.visible) {
      continue;
    }
    const A_long dx = static_cast<A_long>(info.framePoint.h) - mousePoint.h;
    const A_long dy = static_cast<A_long>(info.framePoint.v) - mousePoint.v;
    const A_long distance = std::abs(dx) + std::abs(dy);
    if (distance <= kPointHandleHitSlop && distance < bestDistance) {
      bestDistance = distance;
      bestSlot = info.slot;
    }
  }
  return bestSlot;
}

PF_Err PaintPointHandleBox(
  const DRAWBOT_SurfaceSuite2* surfaceSuite,
  DRAWBOT_SurfaceRef surfaceRef,
  const DRAWBOT_ColorRGBA& color,
  const PF_Point& framePoint,
  A_long halfSize
) {
  if (!surfaceSuite || !surfaceRef) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  DRAWBOT_RectF32 rect = {
    static_cast<float>(framePoint.h - halfSize),
    static_cast<float>(framePoint.v - halfSize),
    static_cast<float>(halfSize * 2 + 1),
    static_cast<float>(halfSize * 2 + 1)
  };
  return surfaceSuite->PaintRect(surfaceRef, &color, &rect);
}

DRAWBOT_ColorRGBA MakePointHandleColor(float red, float green, float blue, float alpha) {
  DRAWBOT_ColorRGBA color{};
  color.red = red;
  color.green = green;
  color.blue = blue;
  color.alpha = alpha;
  return color;
}

PF_Err PaintPointHandleGlyph(
  const DRAWBOT_SurfaceSuite2* surfaceSuite,
  DRAWBOT_SurfaceRef surfaceRef,
  const DRAWBOT_ColorRGBA& fillColor,
  const PF_Point& framePoint,
  A_long outerHalfSize,
  A_long innerHalfSize
) {
  static const DRAWBOT_ColorRGBA kOutlineColor = MakePointHandleColor(0.0f, 0.0f, 0.0f, 0.95f);
  PF_Err err = PaintPointHandleBox(
    surfaceSuite,
    surfaceRef,
    kOutlineColor,
    framePoint,
    outerHalfSize
  );
  if (err != PF_Err_NONE) {
    return err;
  }
  if (innerHalfSize > 0) {
    err = PaintPointHandleBox(
      surfaceSuite,
      surfaceRef,
      fillColor,
      framePoint,
      innerHalfSize
    );
    if (err != PF_Err_NONE) {
      return err;
    }
  }
  return PF_Err_NONE;
}

PF_Err DrawPointHandleMarker(
  PF_InData* in_data,
  PF_EventExtra* extra,
  const PointHandleDrawInfo& info
) {
  if (!in_data || !extra) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  if (!extra->contextH) {
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
  AEFX_SuiteScoper<PF_EffectCustomUIOverlayThemeSuite1> themeSuite(
    in_data,
    kPFEffectCustomUIOverlayThemeSuite,
    kPFEffectCustomUIOverlayThemeSuiteVersion1,
    NULL
  );
  if (!customUiSuite.get() || !drawbotSuite.get() || !surfaceSuite.get() || !themeSuite.get()) {
    return PF_Err_NONE;
  }

  DRAWBOT_DrawRef drawRef = NULL;
  PF_Err err = customUiSuite->PF_GetDrawingReference(extra->contextH, &drawRef);
  if (err != PF_Err_NONE || !drawRef) {
    return err;
  }

  DRAWBOT_SurfaceRef surfaceRef = NULL;
  err = drawbotSuite->GetSurface(drawRef, &surfaceRef);
  if (err != PF_Err_NONE || !surfaceRef) {
    return err;
  }

  float vertexSize = 0.0f;
  themeSuite->PF_GetPreferredVertexSize(&vertexSize);
  const A_long arm = std::max<A_long>(
    kPointHandleMinVisibleArm,
    static_cast<A_long>(vertexSize + 2.0f)
  );
  const DRAWBOT_ColorRGBA activeColor = MakePointHandleColor(1.0f, 0.35f, 0.10f, 1.0f);
  const DRAWBOT_ColorRGBA previewColor = MakePointHandleColor(0.05f, 0.82f, 1.0f, 1.0f);
  const DRAWBOT_ColorRGBA centerColor = info.activePreview ? previewColor : activeColor;

  std::array<PF_Point, 5> markerPoints{};
  std::size_t markerCount = 0;
  markerPoints[markerCount++] = info.framePoint;
  if (info.activeSelection || info.activePreview) {
    markerPoints[markerCount++] = {info.framePoint.h - arm, info.framePoint.v};
    markerPoints[markerCount++] = {info.framePoint.h + arm, info.framePoint.v};
    markerPoints[markerCount++] = {info.framePoint.h, info.framePoint.v - arm};
    markerPoints[markerCount++] = {info.framePoint.h, info.framePoint.v + arm};
  }

  for (std::size_t index = 0; index < markerCount; ++index) {
    const bool centerMarker = (index == 0);
    err = PaintPointHandleGlyph(
      surfaceSuite.get(),
      surfaceRef,
      centerMarker ? centerColor : activeColor,
      markerPoints[index],
      centerMarker ? kPointHandleCenterOuterHalfSize : kPointHandleArmOuterHalfSize,
      centerMarker ? kPointHandleCenterInnerHalfSize : kPointHandleArmInnerHalfSize
    );
    if (err != PF_Err_NONE) {
      return err;
    }
  }
  return PF_Err_NONE;
}

PF_Err DrawPointControllerHandles(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  PF_EventExtra* extra
) {
  (void)out_data;
  std::array<PointHandleDrawInfo, kControllerPointSlotCount> infos{};
  if (!PopulatePointHandleDrawInfos(in_data, extra, params, &infos)) {
    return PF_Err_NONE;
  }

  const std::uint64_t instanceId = ResolvePointControllerInstanceId(in_data, params);
  const int activeSlot = GetActivePointOverlaySlot(instanceId);
  int visibleCount = 0;
  const PointHandleDrawInfo* firstVisibleInfo = NULL;
  for (const PointHandleDrawInfo& info : infos) {
    if (info.visible) {
      ++visibleCount;
      if (!firstVisibleInfo) {
        firstVisibleInfo = &info;
      }
    }
  }
  TracePluginEntry(
    "point_overlay_draw",
    in_data,
    "event_type=" + std::string(EventTypeName(extra ? extra->e_type : PF_Event_NONE)) +
      " instance_id=" + std::to_string(instanceId) +
      " active_slot=" + std::to_string(activeSlot) +
      " visible_count=" + std::to_string(visibleCount) +
      (firstVisibleInfo
         ? " frame_x=" + std::to_string(firstVisibleInfo->framePoint.h) +
             " frame_y=" + std::to_string(firstVisibleInfo->framePoint.v) +
             " layer_x=" + std::to_string(FixedToDouble(firstVisibleInfo->layerPoint.x)) +
             " layer_y=" + std::to_string(FixedToDouble(firstVisibleInfo->layerPoint.y))
         : std::string()) +
      (extra && extra->contextH && *extra->contextH
         ? " window=" + std::string(WindowTypeName((*extra->contextH)->w_type))
         : std::string())
  );

  PF_Err err = PF_Err_NONE;
  for (const PointHandleDrawInfo& info : infos) {
    if (info.slot < 0 || !info.visible) {
      continue;
    }
    err = DrawPointHandleMarker(in_data, extra, info);
    if (err != PF_Err_NONE) {
      return err;
    }
  }

  extra->evt_out_flags |= PF_EO_HANDLED_EVENT;
  return PF_Err_NONE;
}

PF_Err BeginPointControllerDrag(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  PF_EventExtra* extra
) {
  (void)out_data;
  std::array<PointHandleDrawInfo, kControllerPointSlotCount> infos{};
  if (!PopulatePointHandleDrawInfos(in_data, extra, params, &infos)) {
    return PF_Err_NONE;
  }

  PF_Point mousePoint = *reinterpret_cast<PF_Point*>(&extra->u.do_click.screen_point);
  const int slot = HitTestPointHandle(infos, mousePoint);
  if (slot < 0) {
    TracePluginEntry(
      "point_overlay_miss",
      in_data,
      "event_type=" + std::string(EventTypeName(extra->e_type)) +
        " mouse_x=" + std::to_string(mousePoint.h) +
        " mouse_y=" + std::to_string(mousePoint.v)
    );
    return PF_Err_NONE;
  }

  const std::uint64_t instanceId = ResolvePointControllerInstanceId(in_data, params);
  SetActivePointOverlaySlot(instanceId, slot);
  TracePointOverlayEvent(
    "point_overlay_begin",
    in_data,
    extra,
    slot,
    instanceId,
    &mousePoint,
    &infos[static_cast<std::size_t>(slot)].layerPoint
  );

  extra->u.do_click.send_drag = TRUE;
  extra->u.do_click.continue_refcon[0] = slot + 1;
  RequestCustomUIRefresh(in_data, out_data, extra, true);
  return PF_Err_NONE;
}

PF_Err UpdateDraggedPointController(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  PF_EventExtra* extra
) {
  if (!in_data || !out_data || !params || !extra) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  const int slot = static_cast<int>(extra->u.do_click.continue_refcon[0]) - 1;
  if (slot < 0 || slot >= kControllerPointSlotCount) {
    return PF_Err_NONE;
  }

  PF_ParamDef* param = params[ControllerPointParamIndex(slot)];
  if (!param) {
    return PF_Err_NONE;
  }

  PF_Point mousePoint = *reinterpret_cast<PF_Point*>(&extra->u.do_click.screen_point);
  PF_FixedPoint layerPoint = {0, 0};
  FramePointToLayerPoint(in_data, extra, mousePoint, &layerPoint);

  const std::uint64_t instanceId = ResolvePointControllerInstanceId(in_data, params);
  param->u.td.x_value = layerPoint.x;
  param->u.td.y_value = layerPoint.y;
  param->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
  MarkControllerParamHistoryDirty(
    in_data,
    instanceId,
    ControllerPointParamIndex(slot),
    "point-overlay-drag"
  );

  if (extra->u.do_click.last_time) {
    TracePointOverlayEvent(
      "point_overlay_commit",
      in_data,
      extra,
      slot,
      instanceId,
      &mousePoint,
      &layerPoint
    );
  } else {
    TracePointOverlayEvent(
      "point_overlay_preview",
      in_data,
      extra,
      slot,
      instanceId,
      &mousePoint,
      &layerPoint
    );
  }

  ContinuePointControllerDrag(extra, slot);
  RequestCustomUIRefresh(in_data, out_data, extra, true);
  if (out_data) {
    out_data->out_flags |= PF_OutFlag_FORCE_RERENDER;
  }
  return PF_Err_NONE;
}

PF_Err AdjustPointControllerCursor(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  PF_EventExtra* extra
) {
  (void)in_data;
  (void)out_data;
  std::array<PointHandleDrawInfo, kControllerPointSlotCount> infos{};
  if (!PopulatePointHandleDrawInfos(in_data, extra, params, &infos)) {
    return PF_Err_NONE;
  }

  PF_Point mousePoint = *reinterpret_cast<PF_Point*>(&extra->u.adjust_cursor.screen_point);
  if (HitTestPointHandle(infos, mousePoint) >= 0) {
    extra->u.adjust_cursor.set_cursor = PF_Cursor_DRAG_DOT;
    extra->evt_out_flags |= PF_EO_HANDLED_EVENT;
  }
  return PF_Err_NONE;
}

PF_Err HandleCustomCompUIEvent(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[],
  PF_LayerDef* output,
  PF_EventExtra* extra
) {
  (void)output;
  if (!extra) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  const std::uint64_t instanceId = ResolvePointControllerInstanceId(in_data, params);
  EnsureActivePointOverlaySlot(instanceId);
  const PF_WindowType windowType =
    (extra->contextH && *extra->contextH) ? (*extra->contextH)->w_type : PF_Window_NONE;

  if (extra->e_type == PF_Event_DO_CLICK && extra->u.do_click.send_drag) {
    extra->e_type = PF_Event_DRAG;
  }

  switch (extra->e_type) {
    case PF_Event_NEW_CONTEXT:
    case PF_Event_ACTIVATE:
      TracePluginEntry(
        "point_overlay_context",
        in_data,
        "event_type=" + std::string(EventTypeName(extra->e_type)) +
          " instance_id=" + std::to_string(instanceId) +
          " active_slot=" + std::to_string(GetActivePointOverlaySlot(instanceId)) +
          (extra->contextH && *extra->contextH
             ? " window=" + std::string(WindowTypeName((*extra->contextH)->w_type))
             : std::string())
      );
      extra->evt_out_flags |= PF_EO_HANDLED_EVENT;
      if (out_data) {
        out_data->out_flags |= PF_OutFlag_REFRESH_UI;
      }
      return PF_Err_NONE;
    case PF_Event_DO_CLICK:
      if (windowType != PF_Window_COMP && windowType != PF_Window_LAYER) {
        return PF_Err_NONE;
      }
      return BeginPointControllerDrag(in_data, out_data, params, extra);
    case PF_Event_DRAG:
      if (windowType != PF_Window_COMP && windowType != PF_Window_LAYER) {
        return PF_Err_NONE;
      }
      return UpdateDraggedPointController(in_data, out_data, params, extra);
    case PF_Event_DRAW:
      if (windowType != PF_Window_COMP && windowType != PF_Window_LAYER) {
        return PF_Err_NONE;
      }
      return DrawPointControllerHandles(in_data, out_data, params, extra);
    case PF_Event_ADJUST_CURSOR:
      if (windowType != PF_Window_COMP && windowType != PF_Window_LAYER) {
        return PF_Err_NONE;
      }
      return AdjustPointControllerCursor(in_data, out_data, params, extra);
    default:
      return PF_Err_NONE;
  }
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

  const DRAWBOT_ColorRGBA ringColor = MakePointHandleColor(0.72f, 0.72f, 0.72f, 1.0f);
  const DRAWBOT_ColorRGBA indicatorColor = MakePointHandleColor(0.90f, 0.90f, 0.90f, 1.0f);
  const DRAWBOT_ColorRGBA valueColor = MakePointHandleColor(0.31f, 0.60f, 0.98f, 1.0f);
  const DRAWBOT_ColorRGBA xColor = MakePointHandleColor(0.92f, 0.92f, 0.92f, 1.0f);

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
  const ControllerColorValue color = ReadColorArbHandle(in_data, colorParam->u.arb_d.value);

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

  const DRAWBOT_ColorRGBA borderColor = MakePointHandleColor(0.36f, 0.36f, 0.36f, 1.0f);
  const DRAWBOT_ColorRGBA fillColor = MakePointHandleColor(
    static_cast<float>(ClampColorComponent(color.r, 1.0)),
    static_cast<float>(ClampColorComponent(color.g, 1.0)),
    static_cast<float>(ClampColorComponent(color.b, 1.0)),
    1.0f
  );
  const DRAWBOT_ColorRGBA alphaHintColor = MakePointHandleColor(0.20f, 0.20f, 0.20f, 1.0f);

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
  const std::uint64_t instanceId = ResolvePointControllerInstanceId(in_data, params);
  MarkControllerColorHistoryDirty(in_data, instanceId, slot, "color-ui-picked");
  SyncLiveControllerStateFromParams(
    in_data,
    out_data,
    params,
    false,
    true,
    false
  );
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
    ContinueAngleUiDrag(
      extra,
      slot,
      dragTarget,
      static_cast<double>(mousePoint.h),
      true,
      angleDegrees,
      angleParam != NULL
    );
    RequestCustomUIRefresh(in_data, out_data, extra, true);
    extra->evt_out_flags |= PF_EO_HANDLED_EVENT | PF_EO_UPDATE_NOW;
    return PF_Err_NONE;
  }

  double trackedValue = 0.0;
  const bool hasTrackedValue = TryComputeAngleUiPointerDegrees(layout, mousePoint, &trackedValue);

  ContinueAngleUiDrag(
    extra,
    slot,
    dragTarget,
    trackedValue,
    hasTrackedValue,
    0.0,
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

    ContinueAngleUiDrag(
      extra,
      slot,
      dragTarget,
      anchorMouseX,
      true,
      anchorDegrees,
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
        ResolvePointControllerInstanceId(in_data, params),
        ControllerAngleValueParamIndex(angleParamSlot),
        dragTarget == AngleUiDragTarget::kTurnsText ? "angle-ui-turns-scrub" : "angle-ui-degrees-scrub"
      );
      SyncLiveControllerStateFromParams(
        in_data,
        out_data,
        params,
        true,
        false,
        false
      );
    }

    RequestCustomUIRefresh(in_data, out_data, extra, true);
    if (didChangeValue && out_data) {
      out_data->out_flags |= PF_OutFlag_FORCE_RERENDER;
    }
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
  ContinueAngleUiDrag(
    extra,
    slot,
    dragTarget,
    pointerDegrees,
    hasPointerDegrees,
    0.0,
    false
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
      ResolvePointControllerInstanceId(in_data, params),
      ControllerAngleValueParamIndex(angleParamSlot),
      "angle-ui-drag"
    );
    SyncLiveControllerStateFromParams(
      in_data,
      out_data,
      params,
      true,
      false,
      false
    );
  }

  RequestCustomUIRefresh(in_data, out_data, extra, true);
  if (out_data) {
    out_data->out_flags |= PF_OutFlag_FORCE_RERENDER;
  }
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

  if (extra->param_index == PARAM_REVISION) {
    const A_long revision = params && params[PARAM_REVISION] ? params[PARAM_REVISION]->u.sd.value : -1;
    std::string bundleError;
    const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, params, &bundleError);
    const bool revisionChanged = LookupSyncedRevision(in_data, params) != revision;
    const bool controllerHashChanged =
      LookupSyncedControllerHash(in_data, params) != bundle.controllerHash;
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
      SyncLiveControllerStateFromBundle(in_data, params, bundle);
      RegisterSyncedRevision(in_data, params, revision);
      RegisterSyncedControllerHash(in_data, params, bundle.controllerHash);
    }
    return PF_Err_NONE;
  }

  if (!IsControllerParamIndex(extra->param_index)) {
    return PF_Err_NONE;
  }

  const std::uint64_t instanceId = ResolvePointControllerInstanceId(in_data, params);
  int pointSlot = -1;
  int sliderSlot = -1;
  int angleParamSlot = -1;
  int angleLogicalSlot = -1;
  int colorSlot = -1;
  int checkboxSlot = -1;
  int selectSlot = -1;
  if (TryMapPointParamIndexToSlot(extra->param_index, &pointSlot)) {
    SetActivePointOverlaySlot(instanceId, pointSlot);
  }
  (void)TryMapSliderParamIndexToSlot(extra->param_index, &sliderSlot);
  const bool angleValueChanged =
    TryMapAngleValueParamIndexToSlot(extra->param_index, &angleParamSlot);
  const bool angleUiChanged =
    TryMapAngleUiParamIndexToSlot(extra->param_index, &angleParamSlot);
  if (angleValueChanged || angleUiChanged) {
    std::string bundleError;
    const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, params, &bundleError);
    angleLogicalSlot = ResolveLogicalSlotForControllerParamSlot(
      bundle,
      RuntimeControllerSlotKind::kAngle,
      angleParamSlot
    );
  }
  (void)TryMapSelectParamIndexToSlot(extra->param_index, &selectSlot);
  const bool colorValueChanged = TryMapColorValueParamIndexToSlot(extra->param_index, &colorSlot);
  (void)TryMapCheckboxParamIndexToSlot(extra->param_index, &checkboxSlot);
  MarkControllerParamHistoryDirty(
    in_data,
    instanceId,
    (angleValueChanged || angleUiChanged)
      ? ControllerAngleValueParamIndex(angleParamSlot)
      : colorValueChanged
        ? ControllerColorValueParamIndex(colorSlot)
      : extra->param_index,
    "controller-param-changed"
  );
  SyncLiveControllerStateFromParams(
    in_data,
    out_data,
    params,
    angleValueChanged || angleUiChanged,
    colorValueChanged,
    selectSlot >= 0
  );
  if (selectSlot >= 0) {
    ClearCachedSketchByKey(
      static_cast<std::uintptr_t>(instanceId),
      "select-controller-changed"
    );
  }
  TracePluginEntry(
    "controller_param_changed",
    in_data,
    "instance_id=" + std::to_string(instanceId) +
      " param_index=" + std::to_string(static_cast<int>(extra->param_index)) +
      " point_slot=" + std::to_string(pointSlot) +
      " slider_slot=" + std::to_string(sliderSlot) +
      " angle_slot=" + std::to_string(angleLogicalSlot) +
      " angle_param_slot=" + std::to_string(angleParamSlot) +
      " color_slot=" + std::to_string(colorSlot) +
      " checkbox_slot=" + std::to_string(checkboxSlot) +
      " select_slot=" + std::to_string(selectSlot)
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
      TracePluginEntry(
        "slider_param_state",
        in_data,
        "slot=" + std::to_string(sliderSlot) +
          " value=" + std::to_string(static_cast<double>(sliderParam->u.fs_d.value)) +
          " raw_value=" + std::to_string(rawValue) +
          " snapped_value=" + std::to_string(snappedValue) +
          " valid_min=" + std::to_string(static_cast<double>(sliderParam->u.fs_d.valid_min)) +
          " valid_max=" + std::to_string(static_cast<double>(sliderParam->u.fs_d.valid_max)) +
          " slider_min=" + std::to_string(static_cast<double>(sliderParam->u.fs_d.slider_min)) +
          " slider_max=" + std::to_string(static_cast<double>(sliderParam->u.fs_d.slider_max))
      );
    }
  }
  if (out_data) {
    out_data->out_flags |= PF_OutFlag_REFRESH_UI;
    out_data->out_flags |= PF_OutFlag_FORCE_RERENDER;
  }
  return PF_Err_NONE;
}

PF_Err UpdateParamsUI(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ParamDef* params[]
) {
  std::string bundleError;
  const RuntimeSketchBundle bundle = ReadEffectRuntimeSketchBundle(in_data, params, &bundleError);
  PF_Err snapshotErr = SyncSequenceRuntimeSnapshotFromLocalFiles(in_data, out_data, params);
  if (snapshotErr != PF_Err_NONE) {
    return snapshotErr;
  }
  const A_long revision = (params && params[PARAM_REVISION]) ? params[PARAM_REVISION]->u.sd.value : -1;
  const A_long syncedRevision = LookupSyncedRevision(in_data, params);
  const std::string syncedControllerHash = LookupSyncedControllerHash(in_data, params);
  const bool controllerHashChanged = syncedControllerHash != bundle.controllerHash;
  bool refreshedLiveStateFromBundle = false;
  TracePluginEntry(
    "update_params_ui_bundle",
    in_data,
    BuildBundleControllerSummary(bundle) +
      " revision=" + std::to_string(revision) +
      " synced_revision=" + std::to_string(syncedRevision) +
      " controller_hash=" + bundle.controllerHash +
      " synced_controller_hash=" + syncedControllerHash +
      (bundleError.empty() ? std::string() : " bundle_error=" + bundleError)
  );
  if (revision >= 0 && (syncedRevision != revision || controllerHashChanged)) {
    PF_Err syncErr = SyncControllerParamValuesFromBundle(
      in_data,
      out_data,
      params,
      bundle,
      "update-params-ui"
    );
    if (syncErr != PF_Err_NONE) {
      return syncErr;
    }
    RegisterSyncedRevision(in_data, params, revision);
    RegisterSyncedControllerHash(in_data, params, bundle.controllerHash);
    if (in_data && in_data->sequence_data) {
      WriteSequenceSyncedRevision(in_data, in_data->sequence_data, revision);
    }
    SyncLiveControllerStateFromBundle(in_data, params, bundle);
    refreshedLiveStateFromBundle = true;
    TracePluginEntry(
      "update_params_ui_synced_defaults",
      in_data,
      "revision=" + std::to_string(revision) +
        " controller_hash=" + bundle.controllerHash
    );
  }
  if (!refreshedLiveStateFromBundle) {
    SyncLiveControllerStateFromParams(in_data, out_data, params);
  }
  return SyncControllerParamUI(in_data, out_data, params);
}

PF_LayerDef MakeSceneSurface(const PF_LayerDef& outputWorld, const RenderInvocationInfo& invocation) {
  PF_LayerDef sceneSurface = outputWorld;
  sceneSurface.width = std::max<A_long>(1, invocation.canvasWidth);
  sceneSurface.height = std::max<A_long>(1, invocation.canvasHeight);
  return sceneSurface;
}

struct OutputCopyOriginInfo {
  A_long sourceOriginX = 0;
  A_long sourceOriginY = 0;
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
  const A_long requestedTileWidth = std::max<A_long>(0, invocation.tileRight - invocation.tileLeft);
  const A_long requestedTileHeight = std::max<A_long>(0, invocation.tileBottom - invocation.tileTop);
  result.outputLooksLikeTile =
    requestedTileWidth > 0 &&
    requestedTileHeight > 0 &&
    outputWorld.width == requestedTileWidth &&
    outputWorld.height == requestedTileHeight;

  const A_long originSourceX = outputWorld.origin_x - invocation.canvasLeft;
  const A_long originSourceY = outputWorld.origin_y - invocation.canvasTop;
  const bool outputOriginFitsCanvas =
    originSourceX >= 0 &&
    originSourceY >= 0 &&
    outputWorld.width >= 0 &&
    outputWorld.height >= 0 &&
    originSourceX + outputWorld.width <= canvasWidth &&
    originSourceY + outputWorld.height <= canvasHeight;
  if (outputOriginFitsCanvas) {
    result.sourceOriginX = originSourceX;
    result.sourceOriginY = originSourceY;
    result.mode = "output-origin";
    return result;
  }

  if (result.outputLooksLikeTile) {
    result.sourceOriginX = std::max<A_long>(0, invocation.tileLeft - invocation.canvasLeft);
    result.sourceOriginY = std::max<A_long>(0, invocation.tileTop - invocation.canvasTop);
    result.mode = "requested-tile";
  }
  return result;
}

struct LegacySequenceCacheDataHeader {
  A_u_long magic = 0;
  A_u_long version = 0;
  std::uint64_t instanceId = 0;
  A_long syncedRevision = -1;
};

bool IsCompatibleSequenceDataVersion(A_u_long version) {
  return version == kSequenceCacheDataLegacyVersion || version == kSequenceCacheDataVersion;
}

bool ReadCompatibleSequenceDataHeader(
  PF_InData* in_data,
  PF_Handle handle,
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

  if (legacyHeader->version == kSequenceCacheDataVersion &&
      handleSize >= sizeof(SequenceCacheData)) {
    const auto* sequenceData =
      reinterpret_cast<const SequenceCacheData*>(legacyHeader);
    outHeader->bundleTextSize = sequenceData->bundleTextSize;
    outHeader->sourceTextSize = sequenceData->sourceTextSize;
  }
  return true;
}

PF_Err EnsureSequenceDataHandleInitialized(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_Handle* outHandle
) {
  if (!in_data || !outHandle) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  PF_Handle handle = in_data->sequence_data;
  SequenceCacheData header;
  const bool hadCompatibleHeader =
    ReadCompatibleSequenceDataHeader(in_data, handle, &header);

  if (handle &&
      hadCompatibleHeader &&
      header.version == kSequenceCacheDataVersion &&
      PF_GET_HANDLE_SIZE(handle) >= sizeof(SequenceCacheData)) {
    if (out_data) {
      out_data->sequence_data = handle;
    }
    *outHandle = handle;
    return PF_Err_NONE;
  }

  PF_Err err = PF_Err_NONE;
  if (!handle) {
    handle = PF_NEW_HANDLE(sizeof(SequenceCacheData));
    if (!handle) {
      return PF_Err_OUT_OF_MEMORY;
    }
  } else {
    err = PF_RESIZE_HANDLE(sizeof(SequenceCacheData), &handle);
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
  if (hadCompatibleHeader) {
    sequenceData->instanceId = header.instanceId;
    sequenceData->syncedRevision = header.syncedRevision;
  }

  in_data->sequence_data = handle;
  if (out_data) {
    out_data->sequence_data = handle;
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
  if (!ReadCompatibleSequenceDataHeader(in_data, handle, &header) ||
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
  PF_Err err = EnsureSequenceDataHandleInitialized(in_data, out_data, &handle);
  if (err != PF_Err_NONE) {
    return err;
  }

  if (SequenceRuntimeSnapshotMatches(in_data, handle, bundleText, sourceText)) {
    return PF_Err_NONE;
  }

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
  const A_long preservedSyncedRevision = sequenceData->syncedRevision;
  AEFX_CLR_STRUCT(*sequenceData);
  sequenceData->magic = kSequenceCacheDataMagic;
  sequenceData->version = kSequenceCacheDataVersion;
  sequenceData->instanceId = preservedInstanceId;
  sequenceData->syncedRevision = preservedSyncedRevision;
  sequenceData->bundleTextSize = static_cast<A_u_long>(bundleText.size());
  sequenceData->sourceTextSize = static_cast<A_u_long>(sourceText.size());

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
  return PF_Err_NONE;
}

PF_Err CopySequenceDataHandle(PF_InData* in_data, PF_OutData* out_data) {
  if (!out_data) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  if (!in_data || !in_data->sequence_data) {
    out_data->sequence_data = NULL;
    return PF_Err_NONE;
  }

  const auto handleSize = PF_GET_HANDLE_SIZE(in_data->sequence_data);
  PF_Handle copyHandle = PF_NEW_HANDLE(handleSize);
  if (!copyHandle) {
    return PF_Err_OUT_OF_MEMORY;
  }

  void* destination = DH(copyHandle);
  const void* source = DH(in_data->sequence_data);
  if (!destination || !source) {
    PF_DISPOSE_HANDLE(copyHandle);
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  std::memcpy(destination, source, handleSize);
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
      ControllerColorValue()
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

  TracePluginEntry(
    "sync_controller_defaults",
    in_data,
    std::string("reason=") + (reason ? reason : "unknown") +
      " " + BuildBundleControllerSummary(bundle)
  );

  if (out_data) {
    out_data->out_flags |= PF_OutFlag_REFRESH_UI;
    out_data->out_flags |= PF_OutFlag_FORCE_RERENDER;
  }
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

std::uint64_t ResolveKnownInstanceId(PF_InData* in_data, A_long paramInstanceId) {
  if (in_data && in_data->sequence_data) {
    const std::uint64_t sequenceInstanceId =
      ReadSequenceInstanceId(in_data, in_data->sequence_data);
    if (sequenceInstanceId != 0) {
      RegisterStableInstanceId(in_data, sequenceInstanceId);
      return sequenceInstanceId;
    }
  }

  if (paramInstanceId > 0) {
    const std::uint64_t parameterInstanceId =
      static_cast<std::uint64_t>(static_cast<A_u_long>(paramInstanceId));
    RegisterStableInstanceId(in_data, parameterInstanceId);
    return parameterInstanceId;
  }

  return LookupRegisteredInstanceId(in_data);
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
  const std::uint64_t instanceId = ResolveKnownInstanceId(in_data, paramInstanceId);
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

  return WriteSequenceRuntimeSnapshot(in_data, out_data, *bundleText, *sourceText);
}

PF_Err SequenceSetup(PF_InData* in_data, PF_OutData* out_data) {
  TracePluginEntry("sequence_setup", in_data);
  if (in_data) {
    PF_Handle sequenceHandle = NULL;
    PF_Err err = EnsureSequenceDataHandleInitialized(in_data, out_data, &sequenceHandle);
    if (err != PF_Err_NONE) {
      return err;
    }
    const std::uint64_t instanceId = ResolveStableInstanceId(in_data);
    RegisterStableInstanceId(in_data, instanceId);
  }
  return PF_Err_NONE;
}

PF_Err SequenceResetup(PF_InData* in_data, PF_OutData* out_data) {
  TracePluginEntry("sequence_resetup", in_data);
  if (in_data) {
    PF_Handle sequenceHandle = NULL;
    PF_Err err = EnsureSequenceDataHandleInitialized(in_data, out_data, &sequenceHandle);
    if (err != PF_Err_NONE) {
      return err;
    }
    const std::uint64_t instanceId = ResolveStableInstanceId(in_data);
    RegisterStableInstanceId(in_data, instanceId);
  }
  return PF_Err_NONE;
}

PF_Err SequenceFlatten(PF_InData* in_data, PF_OutData* out_data) {
  return CopySequenceDataHandle(in_data, out_data);
}

PF_Err GetFlattenedSequenceData(PF_InData* in_data, PF_OutData* out_data) {
  return CopySequenceDataHandle(in_data, out_data);
}

PF_Err SequenceSetdown(PF_InData* in_data, PF_OutData* out_data) {
  TracePluginEntry("sequence_setdown", in_data);
  std::uint64_t rememberedInstanceId = ResolveKnownInstanceId(in_data);

  if (rememberedInstanceId != 0) {
    ClearActivePointOverlaySlot(rememberedInstanceId);
    ClearLiveControllerState(static_cast<std::uintptr_t>(rememberedInstanceId));
    ClearCachedSketchByKey(static_cast<std::uintptr_t>(rememberedInstanceId), "sequence-setdown");
  }
  UnregisterStableInstanceId(in_data);
  UnregisterSyncedRevision(in_data);
  UnregisterSyncedControllerHash(in_data);
  if (in_data && in_data->sequence_data) {
    PF_DISPOSE_HANDLE(in_data->sequence_data);
    in_data->sequence_data = NULL;
  }
  ClearSequenceDataOutput(out_data);
  return PF_Err_NONE;
}

PF_Err BuildRenderInvocationInfo(
  PF_InData* in_data,
  PF_OutData* out_data,
  RenderInvocationInfo** outInfo
) {
  if (!outInfo) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  auto* info = new (std::nothrow) RenderInvocationInfo();
  if (!info) {
    return PF_Err_OUT_OF_MEMORY;
  }

  info->revision = 0;
  info->instanceId = 0;
  info->canvasLeft = 0;
  info->canvasTop = 0;
  info->canvasWidth = in_data ? std::max<A_long>(1, in_data->width) : 1;
  info->canvasHeight = in_data ? std::max<A_long>(1, in_data->height) : 1;
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

  err = ResolveControllerState(in_data, out_data, NULL, &info->controllers);
  if (err != PF_Err_NONE) {
    delete info;
    return err;
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
  const A_long sourceOriginX = copyOrigin.sourceOriginX;
  const A_long sourceOriginY = copyOrigin.sourceOriginY;
  AppendPerformanceTraceField("ae.source_origin_x", std::to_string(sourceOriginX));
  AppendPerformanceTraceField("ae.source_origin_y", std::to_string(sourceOriginY));
  AppendPerformanceTraceField("ae.output_is_tile", copyOrigin.outputLooksLikeTile ? "1" : "0");
  AppendPerformanceTraceField("ae.copy_origin_mode", copyOrigin.mode);

  auto sampleSourcePixel = [&](A_long logicalX, A_long logicalY) -> PF_Pixel {
    if (logicalX < 0 || logicalY < 0 || logicalX >= canvasWidth || logicalY >= canvasHeight) {
      return PF_Pixel{0, 0, 0, 0};
    }
    const A_long sampleX = sourceWidth == canvasWidth
      ? logicalX
      : std::min<A_long>(
          sourceWidth - 1,
          std::max<A_long>(
            0,
            static_cast<A_long>(std::floor(
              (static_cast<double>(logicalX) + 0.5) *
              static_cast<double>(sourceWidth) /
              static_cast<double>(canvasWidth)
            ))
          )
        );
    const A_long sampleY = sourceHeight == canvasHeight
      ? logicalY
      : std::min<A_long>(
          sourceHeight - 1,
          std::max<A_long>(
            0,
            static_cast<A_long>(std::floor(
              (static_cast<double>(logicalY) + 0.5) *
              static_cast<double>(sourceHeight) /
              static_cast<double>(canvasHeight)
            ))
          )
        );
    return (*raster)[static_cast<std::size_t>(sampleY * sourceWidth + sampleX)];
  };

  switch (pixelFormat) {
    case PF_PixelFormat_ARGB128:
      for (A_long y = 0; y < output->height; ++y) {
        auto* row = reinterpret_cast<PF_PixelFloat*>(
          reinterpret_cast<A_u_char*>(output->data) + y * output->rowbytes
        );
        const A_long sourceY = sourceOriginY + y;
        for (A_long x = 0; x < output->width; ++x) {
          const A_long sourceX = sourceOriginX + x;
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
        const A_long sourceY = sourceOriginY + y;
        for (A_long x = 0; x < output->width; ++x) {
          const A_long sourceX = sourceOriginX + x;
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
        const A_long sourceY = sourceOriginY + y;
        for (A_long x = 0; x < output->width; ++x) {
          const A_long sourceX = sourceOriginX + x;
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
  const std::vector<PF_Pixel>* raster = NULL;
  PF_LayerDef sceneSurface = MakeSceneSurface(*output, invocation);
  const auto scene = ExecuteSketchAtCurrentTime(
    in_data,
    invocation.revision,
    invocation.instanceId,
    &sceneSurface,
    &raster,
    NULL,
    true,
    SketchExecutionMode::kCpuFallback,
    &errorMessage
  );

  if (!scene.has_value()) {
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  if (!raster) {
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  return CopyCpuRasterToOutput(
    output,
    pixelFormat,
    raster,
    invocation,
    invocation.canvasWidth,
    invocation.canvasHeight
  );
}

PF_Err PreRender(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_PreRenderExtra* extra
) {
  TracePluginEntry(
    "pre_render_enter",
    in_data,
    std::string("has_extra=") + (extra ? "1" : "0")
  );
  if (!extra || !extra->input || !extra->output) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  RenderInvocationInfo* info = NULL;
  PF_Err err = BuildRenderInvocationInfo(in_data, out_data, &info);
  if (err != PF_Err_NONE) {
    return err;
  }

  PF_LRect canvasRect{};
  canvasRect.left = info->canvasLeft;
  canvasRect.top = info->canvasTop;
  canvasRect.right = info->canvasLeft + std::max<A_long>(1, info->canvasWidth);
  canvasRect.bottom = info->canvasTop + std::max<A_long>(1, info->canvasHeight);
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

  (void)out_data;
  TracePluginEntry(
    "pre_render_exit",
    in_data,
    "gpu_possible=" + std::string(BitmapGpuBackendAvailable() ? "1" : "0")
  );
  return PF_Err_NONE;
}

PF_Err SmartRender(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_SmartRenderExtra* extra,
  bool useGpu
) {
  TracePluginEntry(
    "smart_render_enter",
    in_data,
    std::string("mode=") + (useGpu ? "gpu" : "cpu") +
      " has_extra=" + (extra ? "1" : "0")
  );
  if (!extra || !extra->input || !extra->cb) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  auto* info = reinterpret_cast<RenderInvocationInfo*>(extra->input->pre_render_data);
  if (!info) {
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  const auto smartRenderStartTime = std::chrono::steady_clock::now();
  ResetPerformanceTrace();
  AppendPerformanceTraceField("ae.mode", useGpu ? "gpu" : "cpu");
  AppendPerformanceTraceField("ae.revision", std::to_string(info->revision));
  AppendPerformanceTraceField("ae.instance_id", std::to_string(info->instanceId));
  AppendPerformanceTraceField("ae.canvas_width", std::to_string(info->canvasWidth));
  AppendPerformanceTraceField("ae.canvas_height", std::to_string(info->canvasHeight));
  AppendPerformanceTraceField("ae.tile_left", std::to_string(info->tileLeft));
  AppendPerformanceTraceField("ae.tile_top", std::to_string(info->tileTop));
  AppendPerformanceTraceField("ae.tile_right", std::to_string(info->tileRight));
  AppendPerformanceTraceField("ae.tile_bottom", std::to_string(info->tileBottom));

  PF_EffectWorld* outputWorld = NULL;
  PF_Err err = extra->cb->checkout_output(in_data->effect_ref, &outputWorld);
  if (err != PF_Err_NONE || !outputWorld) {
    const PF_Err outputErr = err != PF_Err_NONE ? err : PF_Err_INTERNAL_STRUCT_DAMAGED;
    AppendPerformanceTraceField("ae.checkout_output_ok", "0");
    AppendPerformanceTraceField("ae.err", std::to_string(outputErr));
    AppendPerformanceTraceMetric(
      "ae.total",
      std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - smartRenderStartTime).count()
    );
    FlushPerformanceTrace(std::string("event=smart_render path=") + (useGpu ? "gpu" : "cpu"));
    TracePluginEntry(
      "smart_render_exit",
      in_data,
      std::string("mode=") + (useGpu ? "gpu" : "cpu") +
        " err=" + std::to_string(outputErr)
    );
    return outputErr;
  }
  AppendPerformanceTraceField("ae.checkout_output_ok", "1");
  AppendPerformanceTraceField("ae.output_width", std::to_string(outputWorld->width));
  AppendPerformanceTraceField("ae.output_height", std::to_string(outputWorld->height));
  AppendPerformanceTraceField("ae.output_origin_x", std::to_string(outputWorld->origin_x));
  AppendPerformanceTraceField("ae.output_origin_y", std::to_string(outputWorld->origin_y));

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
    AppendPerformanceTraceField("ae.pixel_format_ok", "0");
    AppendPerformanceTraceField("ae.err", std::to_string(err));
    AppendPerformanceTraceMetric(
      "ae.total",
      std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - smartRenderStartTime).count()
    );
    FlushPerformanceTrace(std::string("event=smart_render path=") + (useGpu ? "gpu" : "cpu"));
    TracePluginEntry(
      "smart_render_exit",
      in_data,
      std::string("mode=") + (useGpu ? "gpu" : "cpu") +
        " err=" + std::to_string(err)
    );
    return err;
  }
  AppendPerformanceTraceField("ae.pixel_format_ok", "1");
  AppendPerformanceTraceField("ae.pixel_format", std::to_string(static_cast<int>(pixelFormat)));
  if (!useGpu) {
    const auto cpuRenderStartTime = std::chrono::steady_clock::now();
    err = RenderCurrentSketchToCpuWorld(in_data, outputWorld, *info, pixelFormat);
    AppendPerformanceTraceMetric(
      "ae.cpu_render",
      std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - cpuRenderStartTime).count()
    );
    AppendPerformanceTraceField("ae.err", std::to_string(err));
    AppendPerformanceTraceMetric(
      "ae.total",
      std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - smartRenderStartTime).count()
    );
    FlushPerformanceTrace("event=smart_render path=cpu");
    TracePluginEntry(
      "smart_render_exit",
      in_data,
      std::string("mode=cpu err=") + std::to_string(err)
    );
    return err;
  }

  PF_LayerDef sceneSurface = MakeSceneSurface(*outputWorld, *info);
  std::string errorMessage;
  BitmapFramePlan framePlan;
  const auto planStartTime = std::chrono::steady_clock::now();
  const bool planOk = BuildBitmapFramePlanAtCurrentTime(
    in_data,
    info->revision,
    info->instanceId,
    &sceneSurface,
    &framePlan,
    &errorMessage
  );
  AppendPerformanceTraceMetric(
    "ae.plan",
    std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - planStartTime).count()
  );
  AppendPerformanceTraceField("ae.plan_ok", planOk ? "1" : "0");
  if (!planOk) {
    AppendPerformanceTraceField("ae.err", std::to_string(PF_Err_INTERNAL_STRUCT_DAMAGED));
    if (!errorMessage.empty()) {
      AppendPerformanceTraceField("ae.error_message", errorMessage);
    }
    AppendPerformanceTraceMetric(
      "ae.total",
      std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - smartRenderStartTime).count()
    );
    FlushPerformanceTrace("event=smart_render path=gpu");
    TracePluginEntry(
      "smart_render_exit",
      in_data,
      std::string("mode=gpu err=") + std::to_string(PF_Err_INTERNAL_STRUCT_DAMAGED)
    );
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  const OutputCopyOriginInfo copyOrigin = ResolveOutputCopyOrigin(*outputWorld, *info);
  const A_long sourceOriginX = copyOrigin.sourceOriginX;
  const A_long sourceOriginY = copyOrigin.sourceOriginY;
  AppendPerformanceTraceField("ae.source_origin_x", std::to_string(sourceOriginX));
  AppendPerformanceTraceField("ae.source_origin_y", std::to_string(sourceOriginY));
  AppendPerformanceTraceField("ae.output_is_tile", copyOrigin.outputLooksLikeTile ? "1" : "0");
  AppendPerformanceTraceField("ae.copy_origin_mode", copyOrigin.mode);
  const auto gpuRenderStartTime = std::chrono::steady_clock::now();
  err = RenderBitmapFramePlan(
    in_data,
    out_data,
    const_cast<void*>(extra->input->gpu_data),
    outputWorld,
    pixelFormat,
    sourceOriginX,
    sourceOriginY,
    framePlan,
    &errorMessage
  );
  AppendPerformanceTraceMetric(
    "ae.gpu_render",
    std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - gpuRenderStartTime).count()
  );
  AppendPerformanceTraceField("ae.err", std::to_string(err));
  if (err != PF_Err_NONE) {
    AppendPerformanceTraceField(
      "ae.error_message",
      !errorMessage.empty() ? errorMessage : "gpu-render-failed-with-empty-error-message"
    );
  }
  AppendPerformanceTraceMetric(
    "ae.total",
    std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - smartRenderStartTime).count()
  );
  FlushPerformanceTrace("event=smart_render path=gpu");
  TracePluginEntry(
    "smart_render_exit",
    in_data,
    std::string("mode=gpu err=") + std::to_string(err)
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
  PF_GPUDeviceInfo deviceInfo{};
  PF_Err deviceInfoErr = PF_Err_NONE;
  if (in_data && out_data) {
    AEFX_SuiteScoper<PF_GPUDeviceSuite1> gpuSuite =
      AEFX_SuiteScoper<PF_GPUDeviceSuite1>(
        in_data,
        kPFGPUDeviceSuite,
        kPFGPUDeviceSuiteVersion1,
        out_data
      );
    deviceInfoErr = gpuSuite->GetDeviceInfo(
      in_data->effect_ref,
      extra->input->device_index,
      &deviceInfo
    );
  }
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
    out_data->out_flags |= (
      PF_OutFlag_NON_PARAM_VARY |
      PF_OutFlag_PIX_INDEPENDENT
    );
  }
  return PF_Err_NONE;
}

PF_Err GlobalSetdown(PF_InData* in_data, PF_OutData* out_data) {
  (void)in_data;
  (void)out_data;
  {
    const std::lock_guard<std::mutex> lock(gEffectInstanceRegistryMutex);
    gEffectInstanceRegistry.clear();
  }
  {
    const std::lock_guard<std::mutex> lock(gEffectSyncedRevisionMutex);
    gEffectSyncedRevisions.clear();
  }
  {
    const std::lock_guard<std::mutex> lock(gInstanceSyncedRevisionMutex);
    gInstanceSyncedRevisions.clear();
  }
  {
    const std::lock_guard<std::mutex> lock(gEffectSyncedControllerHashMutex);
    gEffectSyncedControllerHashes.clear();
  }
  {
    const std::lock_guard<std::mutex> lock(gInstanceSyncedControllerHashMutex);
    gInstanceSyncedControllerHashes.clear();
  }
  ClearAllLiveControllerStates();
  ClearAllActivePointOverlaySlots();
  ClearAllCachedSketches("global-setdown");
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
  std::string bundleError;
  const RuntimeSketchBundle bundle = ReadCurrentRunRuntimeSketchBundle(&bundleError);
  TracePluginEntry(
    "params_setup_bundle",
    in_data,
    BuildBundleControllerSummary(bundle) +
      (bundleError.empty() ? std::string() : " bundle_error=" + bundleError)
  );
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
    const RuntimeControllerSlotKind kind = ResolveControllerSlotKind(bundle, slot);
    const bool pointActive = kind == RuntimeControllerSlotKind::kPoint;
    const bool sliderActive = kind == RuntimeControllerSlotKind::kSlider;
    const bool colorActive = kind == RuntimeControllerSlotKind::kColor;
    const bool checkboxActive = kind == RuntimeControllerSlotKind::kCheckbox;
    const bool selectActive = kind == RuntimeControllerSlotKind::kSelect;
    const bool angleActive = kind == RuntimeControllerSlotKind::kAngle;

    const ControllerPointValue defaultPoint =
      pointActive ? ResolvePointControllerDefaultValue(bundle, slot) : ControllerPointValue();
    const RuntimeSliderControllerSpec sliderConfig =
      sliderActive ? ResolveSliderControllerSpecWithDefaults(bundle, slot) : RuntimeSliderControllerSpec();
    const RuntimeColorControllerSpec colorConfig =
      colorActive ? ResolveColorControllerSpecWithDefaults(bundle, slot) : RuntimeColorControllerSpec();
    const RuntimeCheckboxControllerSpec checkboxConfig =
      checkboxActive ? ResolveCheckboxControllerSpecWithDefaults(bundle, slot) : RuntimeCheckboxControllerSpec();
    const RuntimeSelectControllerSpec selectConfig =
      selectActive ? ResolveSelectControllerSpecWithDefaults(bundle, slot) : RuntimeSelectControllerSpec();
    const RuntimeAngleControllerSpec angleConfig =
      angleActive ? ResolveAngleControllerSpecWithDefaults(bundle, slot) : RuntimeAngleControllerSpec();

    const std::string pointLabel =
      pointActive
        ? ResolveControllerSlotLabel(bundle, slot, RuntimeControllerSlotKind::kPoint)
        : DefaultPointControllerLabel(slot);
    const std::string sliderLabel =
      sliderConfig.label.empty() ? DefaultSliderControllerLabel(slot) : sliderConfig.label;
    const std::string colorLabel =
      colorConfig.label.empty() ? DefaultColorControllerLabel(slot) : colorConfig.label;
    const std::string checkboxLabel =
      checkboxConfig.label.empty() ? DefaultCheckboxControllerLabel(slot) : checkboxConfig.label;
    const std::string selectLabel =
      selectConfig.label.empty() ? DefaultSelectControllerLabel(slot) : selectConfig.label;
    std::string angleLabel =
      angleConfig.label.empty() ? DefaultAngleControllerLabel(slot) : angleConfig.label;
    std::string angleUiLabel =
      angleConfig.label.empty() ? DefaultAngleControllerLabel(slot) : angleConfig.label;
    if (kDebugExposeAllControllerParams) {
      angleLabel += " [angle-value " + std::to_string(slot) + "]";
      angleUiLabel += " [angle-ui " + std::to_string(slot) + "]";
    }

    AEFX_CLR_STRUCT(def);
    def.flags = PF_ParamFlag_SUPERVISE;
    def.ui_flags = (pointActive || kDebugExposeAllControllerParams) ? PF_PUI_NONE : PF_PUI_INVISIBLE;
    PF_ADD_POINT(
      pointLabel.c_str(),
      static_cast<A_long>(std::lround(defaultPoint.x)),
      static_cast<A_long>(std::lround(defaultPoint.y)),
      FALSE,
      ControllerPointParamIndex(slot)
    );

    PF_FpShort sliderValidMin = 0;
    PF_FpShort sliderValidMax = 100;
    PF_FpShort sliderMin = 0;
    PF_FpShort sliderMax = 100;
    AEFX_CLR_STRUCT(def);
    def.flags = PF_ParamFlag_SUPERVISE;
    def.ui_flags = (sliderActive || kDebugExposeAllControllerParams) ? PF_PUI_NONE : PF_PUI_INVISIBLE;
    def.ui_width = 0;
    def.ui_height = 0;
    ResolveSafeSliderUiRange(
      sliderConfig.minValue,
      sliderConfig.maxValue,
      &sliderValidMin,
      &sliderValidMax,
      &sliderMin,
      &sliderMax
    );
    const double safeSliderDefault = std::max<double>(
      static_cast<double>(sliderValidMin),
      std::min<double>(
        static_cast<double>(sliderValidMax),
        ClampAndSnapSliderValue(sliderConfig.defaultValue, sliderConfig)
      )
    );
    PF_ADD_FLOAT_SLIDER(
      sliderLabel.c_str(),
      sliderValidMin,
      sliderValidMax,
      sliderMin,
      sliderMax,
      AEFX_DEFAULT_CURVE_TOLERANCE,
      static_cast<PF_FpShort>(safeSliderDefault),
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
        AllocateColorArbHandle(in_data, colorConfig.defaultValue, &defaultColorHandle);
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
    def.ui_flags = (checkboxActive || kDebugExposeAllControllerParams) ? PF_PUI_NONE : PF_PUI_INVISIBLE;
    PF_ADD_CHECKBOX(
      checkboxLabel.c_str(),
      "",
      checkboxConfig.defaultValue ? TRUE : FALSE,
      0,
      ControllerCheckboxParamIndex(slot)
    );

    const std::string selectItems = BuildSelectControllerPopupItems(selectConfig);
    AEFX_CLR_STRUCT(def);
    def.flags = PF_ParamFlag_SUPERVISE;
    def.ui_flags = (selectActive || kDebugExposeAllControllerParams) ? PF_PUI_NONE : PF_PUI_INVISIBLE;
    PF_ADD_POPUP(
      selectLabel.c_str(),
      static_cast<A_short>(std::max<std::size_t>(1, selectConfig.options.size())),
      static_cast<A_short>(ClampSelectControllerIndex(selectConfig.defaultValue, selectConfig) + 1),
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
    if (!angleActive && !kDebugExposeAllControllerParams) {
      def.ui_flags |= PF_PUI_INVISIBLE;
    }
    PF_ADD_FLOAT_SLIDER(
      angleLabel.c_str(),
      angleValidMin,
      angleValidMax,
      angleSliderMin,
      angleSliderMax,
      AEFX_DEFAULT_CURVE_TOLERANCE,
      static_cast<PF_FpShort>(angleActive ? angleConfig.defaultValue : 0.0),
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

  std::string errorMessage;
  const std::vector<PF_Pixel>* raster = NULL;
  const auto scene =
    ExecuteSketchAtCurrentTime(
      in_data,
      revision,
      instanceId,
      output,
      &raster,
      NULL,
      true,
      SketchExecutionMode::kCpuFallback,
      &errorMessage
    );
  if (!scene.has_value() || !raster) {
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  if (PF_WORLD_IS_DEEP(output)) {
    CopySurface8To16(output, *raster);
    return PF_Err_NONE;
  }

  CopySurface8To8(output, *raster);
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
  momentum::TracePluginEntry(
    "effect_main_dispatch",
    in_data,
    std::string("cmd=") + momentum::CommandName(cmd) +
      " raw_cmd=" + std::to_string(static_cast<int>(cmd))
  );
  if (out_data && cmd != PF_Cmd_QUERY_DYNAMIC_FLAGS) {
    AEFX_CLR_STRUCT(*out_data);
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
      {
        PF_EventExtra* eventExtra = reinterpret_cast<PF_EventExtra*>(extra);
        const PF_WindowType windowType =
          (eventExtra && eventExtra->contextH && *eventExtra->contextH)
            ? (*eventExtra->contextH)->w_type
            : PF_Window_NONE;
        if (windowType == PF_Window_COMP || windowType == PF_Window_LAYER) {
          err = momentum::HandleCustomCompUIEvent(
            in_data,
            out_data,
            params,
            output,
            eventExtra
          );
        } else {
          err = momentum::HandleCustomEffectUIEvent(
            in_data,
            out_data,
            params,
            output,
            eventExtra
          );
        }
      }
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

  return err;
}
