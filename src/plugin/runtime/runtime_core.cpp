#include "runtime_core.h"
#include "runtime_internal.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <iomanip>
#include <memory>
#include <mutex>
#include <optional>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

#include "../api/api_internal.h"
#include "../cache/frame_cache.h"
#include "../gpu/bitmap_gpu_backend.h"
#include "../gpu/bitmap_draw_plan.h"
#include "../model/controller_schema.h"
#include "../render/render_core.h"

namespace momentum {

thread_local JsHostRuntime* g_activeRuntime = NULL;
thread_local const RuntimeSketchBundle* g_activeRuntimeDocument = NULL;
thread_local const std::vector<ControllerPoolState>* g_activeControllerTimeline = NULL;

class ScopedRuntimeDocument final {
 public:
  explicit ScopedRuntimeDocument(const RuntimeSketchBundle* document)
    : previous_(g_activeRuntimeDocument) {
    g_activeRuntimeDocument = document;
  }

  ~ScopedRuntimeDocument() {
    g_activeRuntimeDocument = previous_;
  }

 private:
  const RuntimeSketchBundle* previous_ = NULL;
};

class ScopedControllerTimeline final {
 public:
  explicit ScopedControllerTimeline(const std::vector<ControllerPoolState>* timeline)
    : previous_(g_activeControllerTimeline) {
    g_activeControllerTimeline = timeline;
  }

  ~ScopedControllerTimeline() {
    g_activeControllerTimeline = previous_;
  }

 private:
  const std::vector<ControllerPoolState>* previous_ = NULL;
};

namespace {

using runtime_internal::CallFunction;
using runtime_internal::CaptureRuntimeState;
using runtime_internal::EvaluateScript;
using runtime_internal::GetBindingValue;
using runtime_internal::GetCompTimeSeconds;
using runtime_internal::ResolveEffectRuntimeKey;
using runtime_internal::GetFrameRate;
using runtime_internal::BuildBindingRegistrationScript;
using runtime_internal::EffectRuntimeKey;
using runtime_internal::ExtractTopLevelBindings;
using runtime_internal::ReadRuntimeSketchBundle;
using runtime_internal::ReadRuntimeSketchSource;
using runtime_internal::ReadTextFile;
using runtime_internal::RestoreRuntimeState;

void ResetCachedSketchState(CachedSketchState* cache);
void ClearCachedBitmapFramePlansByKey(std::uint64_t cacheKey);

double ExpandDownsampledPointCoordinate(
  double renderedCoordinate,
  const PF_RationalScale& downsample
) {
  if (downsample.num <= 0 || downsample.den <= 0) {
    return renderedCoordinate;
  }
  return renderedCoordinate *
    static_cast<double>(downsample.den) /
    static_cast<double>(downsample.num);
}

struct EffectRuntimeState {
  std::recursive_mutex mutex;
  RuntimeSketchBundle document;
  bool hasDocument = false;
  A_long documentRevisionParam = -1;
  std::vector<ControllerPoolState> controllerTimeline;
  std::vector<std::uint64_t> controllerTimelinePrefixHashes;
  std::vector<PF_ParamIndex> controllerDependencyParamIndices;
  std::vector<PF_State> controllerDependencyStates;
  bool hasControllerDependencyStates = false;
  std::string controllerTimelineHash;
  double controllerTimelineFrameRate = 0.0;
  long controllerTimelineTargetFrame = -1;
  bool hasControllerTimeline = false;
  CachedSketchState sketch;
  std::unordered_map<long, BitmapDrawPlan> bitmapFramePlans;
  std::vector<long> bitmapFramePlanOrder;
  std::uint64_t transportInstanceId = 0;
  A_long syncedRevision = -1;
  std::string syncedControllerHash;
  std::string syncedControllerUiHash;
};

std::mutex gEffectRuntimeStatesMutex;
std::unordered_map<EffectRuntimeKey, std::shared_ptr<EffectRuntimeState>> gEffectRuntimeStates;

constexpr std::uintptr_t kPersistentRuntimeNamespace =
  static_cast<std::uintptr_t>(0x4d00000000000000ULL);
constexpr std::uintptr_t kPersistentRuntimeRoleShift = 48;

std::uintptr_t BuildPersistentRuntimeKey(
  std::uint64_t lineageIdentity,
  std::uintptr_t role
) {
  std::uint64_t mixed = lineageIdentity ? lineageIdentity : 1ULL;
  mixed ^= mixed >> 33;
  mixed *= 0xff51afd7ed558ccdULL;
  mixed ^= mixed >> 33;
  return kPersistentRuntimeNamespace |
    ((role & static_cast<std::uintptr_t>(0xffU)) << kPersistentRuntimeRoleShift) |
    static_cast<std::uintptr_t>(mixed & 0x0000ffffffffffffULL);
}

std::shared_ptr<EffectRuntimeState> ResolveEffectRuntimeState(
  EffectRuntimeKey runtimeKey,
  bool create
) {
  if (!runtimeKey) {
    return std::shared_ptr<EffectRuntimeState>();
  }
  const std::lock_guard<std::mutex> lock(gEffectRuntimeStatesMutex);
  const auto existing = gEffectRuntimeStates.find(runtimeKey);
  if (existing != gEffectRuntimeStates.end()) {
    return existing->second;
  }
  if (!create) {
    return std::shared_ptr<EffectRuntimeState>();
  }
  auto state = std::make_shared<EffectRuntimeState>();
  gEffectRuntimeStates[runtimeKey] = state;
  return state;
}

std::shared_ptr<EffectRuntimeState> RemoveEffectRuntimeState(EffectRuntimeKey runtimeKey) {
  if (!runtimeKey) {
    return std::shared_ptr<EffectRuntimeState>();
  }
  const std::lock_guard<std::mutex> lock(gEffectRuntimeStatesMutex);
  const auto existing = gEffectRuntimeStates.find(runtimeKey);
  if (existing == gEffectRuntimeStates.end()) {
    return std::shared_ptr<EffectRuntimeState>();
  }
  const auto state = existing->second;
  gEffectRuntimeStates.erase(existing);
  return state;
}

ControllerColorValue ResolveColorControllerValue(
  PF_InData* in_data,
  const PF_ParamDef* colorParam,
  const ControllerColorValue& fallbackColor
) {
  ControllerColorValue color = fallbackColor;
  if (!in_data || !colorParam || !colorParam->u.arb_d.value) {
    return color;
  }
  ControllerColorValue* data =
    reinterpret_cast<ControllerColorValue*>(PF_LOCK_HANDLE(colorParam->u.arb_d.value));
  if (!data) {
    return color;
  }
  color = *data;
  PF_UNLOCK_HANDLE(colorParam->u.arb_d.value);
  if (!std::isfinite(color.a) || std::isnan(color.a) || color.a < 0.0) {
    return fallbackColor;
  }
  color.r = ClampColorComponent(color.r, fallbackColor.r);
  color.g = ClampColorComponent(color.g, fallbackColor.g);
  color.b = ClampColorComponent(color.b, fallbackColor.b);
  color.a = ClampColorComponent(color.a, fallbackColor.a);
  return color;
}

void ClearCachedBitmapFramePlansByKey(std::uint64_t cacheKey) {
  const auto state = ResolveEffectRuntimeState(static_cast<std::uintptr_t>(cacheKey), false);
  if (!state) {
    return;
  }
  const std::lock_guard<std::recursive_mutex> lock(state->mutex);
  state->bitmapFramePlans.clear();
  state->bitmapFramePlanOrder.clear();
}

void RemoveFramesFromOrder(std::vector<long>* order, long frameThreshold) {
  if (!order) {
    return;
  }
  order->erase(
    std::remove_if(
      order->begin(),
      order->end(),
      [frameThreshold](long frame) { return frame >= frameThreshold; }
    ),
    order->end()
  );
}

void MergeFrameOrder(std::vector<long>* order, const std::vector<long>& preserved) {
  if (!order || preserved.empty()) {
    return;
  }

  order->insert(order->end(), preserved.begin(), preserved.end());
  std::sort(order->begin(), order->end());
  order->erase(std::unique(order->begin(), order->end()), order->end());
}

void InvalidateCachedHistoryFromFrame(
  CachedSketchState* cache,
  std::uint64_t cacheKey,
  long frameThreshold
) {
  if (!cache || frameThreshold < 0) {
    return;
  }

  for (auto it = cache->exactSnapshots.begin(); it != cache->exactSnapshots.end();) {
    if (it->first >= frameThreshold) {
      it = cache->exactSnapshots.erase(it);
    } else {
      ++it;
    }
  }
  RemoveFramesFromOrder(&cache->exactSnapshotOrder, frameThreshold);

  for (auto it = cache->frameScenes.begin(); it != cache->frameScenes.end();) {
    if (it->first >= frameThreshold) {
      it = cache->frameScenes.erase(it);
    } else {
      ++it;
    }
  }
  for (auto it = cache->frameControllerTimelineHashes.begin();
       it != cache->frameControllerTimelineHashes.end();) {
    if (it->first >= frameThreshold) {
      it = cache->frameControllerTimelineHashes.erase(it);
    } else {
      ++it;
    }
  }

  ClearCachedBitmapFramePlansByKey(cacheKey);
  DisposeBitmapGpuStateByCacheKey(cacheKey, "controller-history-dirty");
}

std::string BuildControllerStateHash(const ControllerPoolState& state) {
  std::ostringstream stream;
  stream << std::fixed << std::setprecision(17);
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

double FixedToDouble(PF_Fixed value) {
  return static_cast<double>(value) / 65536.0;
}

bool CheckoutControllerStateAtTime(
  PF_InData* in_data,
  A_long timeValue,
  ControllerPoolState* outState,
  std::string* errorMessage
) {
  if (!in_data || !outState) {
    if (errorMessage) {
      *errorMessage = "Controller checkout request is missing input state.";
    }
    return false;
  }

  *outState = ControllerPoolState();
  RuntimeSketchBundle fallbackBundle;
  const RuntimeSketchBundle* bundle = g_activeRuntimeDocument;
  if (!bundle) {
    fallbackBundle = runtime_internal::ReadRuntimeSketchBundleForEffect(
      in_data,
      0,
      NULL
    );
    bundle = &fallbackBundle;
  }
  PF_ParamDef param;
  auto checkoutParam =
    [&](PF_ParamIndex index, A_long checkoutTime, PF_ParamDef* outParam, bool reportFailure = true) -> bool {
    AEFX_CLR_STRUCT(*outParam);
    const PF_Err err = PF_CHECKOUT_PARAM(
      in_data,
      index,
      checkoutTime,
      in_data->time_step,
      in_data->time_scale,
      outParam
    );
    if (err == PF_Err_NONE) {
      return true;
    }
    if (reportFailure && errorMessage) {
      *errorMessage = "Controller parameter checkout failed for animated replay.";
    }
    return false;
  };

  int sliderSlot = 0;
  int angleSlot = 0;
  int colorSlot = 0;
  int checkboxSlot = 0;
  int selectSlot = 0;
  int pointSlot = 0;
  for (int logicalSlot = 0; logicalSlot < kControllerSlotCount; ++logicalSlot) {
    const RuntimeControllerSlotKind kind = ResolveControllerSlotKind(*bundle, logicalSlot);
    if (kind == RuntimeControllerSlotKind::kNone) {
      continue;
    }

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
    if (kind == RuntimeControllerSlotKind::kColor) {
      if (colorSlot < kControllerColorSlotCount) {
        PF_ParamDef colorParam;
        if (!checkoutParam(ControllerColorValueParamIndex(logicalSlot), timeValue, &colorParam)) {
          return false;
        }
        const ControllerColorValue defaultColor =
          ResolveColorControllerDefaultValue(*bundle, logicalSlot);
        outState->colors[static_cast<std::size_t>(colorSlot)] =
          ResolveColorControllerValue(in_data, &colorParam, defaultColor);
        PF_CHECKIN_PARAM(in_data, &colorParam);
      }
      colorSlot += 1;
      continue;
    }

    if (!checkoutParam(paramIndex, timeValue, &param)) {
      return false;
    }

    if (kind == RuntimeControllerSlotKind::kSlider) {
      if (sliderSlot < kControllerSliderSlotCount) {
        const RuntimeSliderControllerSpec config =
          ResolveSliderControllerSpecWithDefaults(*bundle, logicalSlot);
        outState->sliders[static_cast<std::size_t>(sliderSlot)].value =
          ClampAndSnapSliderValue(param.u.fs_d.value, config);
      }
      sliderSlot += 1;
    } else if (kind == RuntimeControllerSlotKind::kAngle) {
      if (angleSlot < kControllerAngleSlotCount) {
        outState->angles[static_cast<std::size_t>(angleSlot)].degrees =
          static_cast<double>(param.u.fs_d.value);
      }
      angleSlot += 1;
    } else if (kind == RuntimeControllerSlotKind::kCheckbox) {
      if (checkboxSlot < kControllerCheckboxSlotCount) {
        outState->checkboxes[static_cast<std::size_t>(checkboxSlot)].checked =
          param.u.bd.value != FALSE;
      }
      checkboxSlot += 1;
    } else if (kind == RuntimeControllerSlotKind::kSelect) {
      if (selectSlot < kControllerSelectSlotCount) {
        const RuntimeSelectControllerSpec config =
          ResolveSelectControllerSpecWithDefaults(*bundle, logicalSlot);
        int rawValue = static_cast<int>(param.u.pd.value);
        int clampedIndex = config.defaultValue;
        if (IsValidRawSelectControllerValue(rawValue, config)) {
          clampedIndex = ClampSelectControllerIndex(rawValue - 1, config);
        }
        outState->selects[static_cast<std::size_t>(selectSlot)].index = clampedIndex;
      }
      selectSlot += 1;
    } else if (kind == RuntimeControllerSlotKind::kPoint) {
      if (pointSlot < kControllerPointSlotCount) {
        ControllerPointValue& point = outState->points[static_cast<std::size_t>(pointSlot)];
        // AE adapts native PF_POINT values to the active render downsample.
        // Momentum's script and retained controller timeline stay in the
        // createCanvas() logical coordinate space, so restore the full-size
        // coordinate here. Executor output scaling then happens exactly once.
        point.x = ExpandDownsampledPointCoordinate(
          FixedToDouble(param.u.td.x_value),
          in_data->downsample_x
        );
        point.y = ExpandDownsampledPointCoordinate(
          FixedToDouble(param.u.td.y_value),
          in_data->downsample_y
        );
      }
      pointSlot += 1;
    }

    PF_CHECKIN_PARAM(in_data, &param);
  }

  outState->stateHash = BuildControllerStateHash(*outState);
  return true;
}

A_long SketchFrameToTimeValue(
  long frame,
  double simulationFrameRate,
  A_u_long timeScale
) {
  if (!(simulationFrameRate > 0.0) || timeScale == 0) {
    return 0;
  }
  const long clampedFrame = std::max<long>(0, frame);
  const double timeSeconds =
    clampedFrame <= 0
      ? 0.0
      : static_cast<double>(clampedFrame - 1) / simulationFrameRate;
  return static_cast<A_long>(std::llround(timeSeconds * static_cast<double>(timeScale)));
}

long TimeValueToSketchFrame(
  A_long timeValue,
  A_u_long timeScale,
  double frameRate
) {
  if (!(frameRate > 0.0) || timeScale == 0) {
    return 0;
  }
  const double timeSeconds = static_cast<double>(timeValue) / static_cast<double>(timeScale);
  return std::max<long>(
    0,
    static_cast<long>(std::floor(timeSeconds * frameRate)) + 1L
  );
}

bool CheckoutControllerStateForSketchFrame(
  PF_InData* in_data,
  long frame,
  double simulationFrameRate,
  ControllerPoolState* outState,
  std::string* errorMessage
) {
  if (g_activeControllerTimeline && frame >= 0) {
    const std::size_t frameIndex = static_cast<std::size_t>(frame);
    if (frameIndex < g_activeControllerTimeline->size()) {
      *outState = (*g_activeControllerTimeline)[frameIndex];
      return true;
    }
    if (errorMessage) {
      *errorMessage = "Controller timeline does not contain the requested sketch frame.";
    }
    return false;
  }
  const A_long timeValue =
    SketchFrameToTimeValue(frame, simulationFrameRate, in_data ? in_data->time_scale : 0);
  return CheckoutControllerStateAtTime(
    in_data,
    timeValue,
    outState,
    errorMessage
  );
}

long ResolveControllerHistoryStartFrameForStateMismatch(
  PF_InData* in_data,
  const ControllerPoolState& cachedState,
  const ControllerPoolState& liveState
) {
  if (!in_data) {
    return 0;
  }

  const double frameRate = ResolveSketchSimulationFrameRate(in_data);
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

  RuntimeSketchBundle fallbackBundle;
  const RuntimeSketchBundle* bundle = g_activeRuntimeDocument;
  if (!bundle) {
    fallbackBundle = runtime_internal::ReadRuntimeSketchBundleForEffect(
      in_data,
      0,
      NULL
    );
    bundle = &fallbackBundle;
  }
  bool foundMismatchingSlot = false;
  long earliestDirtyFrame = 0;
  int sliderSlot = 0;
  int angleSlot = 0;
  int colorSlot = 0;
  int checkboxSlot = 0;
  int selectSlot = 0;
  int pointSlot = 0;
  for (int logicalSlot = 0; logicalSlot < kControllerSlotCount; ++logicalSlot) {
    const RuntimeControllerSlotKind kind = ResolveControllerSlotKind(*bundle, logicalSlot);
    bool differs = false;
    PF_ParamIndex paramIndex = ControllerPointParamIndex(logicalSlot);

    if (kind == RuntimeControllerSlotKind::kSlider) {
      const double cachedValue = cachedState.sliders[static_cast<std::size_t>(sliderSlot)].value;
      const double liveValue = liveState.sliders[static_cast<std::size_t>(sliderSlot)].value;
      differs = std::fabs(cachedValue - liveValue) > 1e-6;
      paramIndex = ControllerSliderParamIndex(logicalSlot);
      sliderSlot += 1;
    } else if (kind == RuntimeControllerSlotKind::kAngle) {
      const double cachedValue = cachedState.angles[static_cast<std::size_t>(angleSlot)].degrees;
      const double liveValue = liveState.angles[static_cast<std::size_t>(angleSlot)].degrees;
      differs = std::fabs(cachedValue - liveValue) > 1e-6;
      paramIndex = ControllerAngleValueParamIndex(logicalSlot);
      angleSlot += 1;
    } else if (kind == RuntimeControllerSlotKind::kColor) {
      const ControllerColorValue& cachedColor =
        cachedState.colors[static_cast<std::size_t>(colorSlot)];
      const ControllerColorValue& liveColor =
        liveState.colors[static_cast<std::size_t>(colorSlot)];
      differs =
        std::fabs(cachedColor.r - liveColor.r) > 1e-6 ||
        std::fabs(cachedColor.g - liveColor.g) > 1e-6 ||
        std::fabs(cachedColor.b - liveColor.b) > 1e-6 ||
        std::fabs(cachedColor.a - liveColor.a) > 1e-6;
      paramIndex = ControllerColorValueParamIndex(logicalSlot);
      colorSlot += 1;
    } else if (kind == RuntimeControllerSlotKind::kCheckbox) {
      const bool cachedValue =
        cachedState.checkboxes[static_cast<std::size_t>(checkboxSlot)].checked;
      const bool liveValue =
        liveState.checkboxes[static_cast<std::size_t>(checkboxSlot)].checked;
      differs = cachedValue != liveValue;
      paramIndex = ControllerCheckboxParamIndex(logicalSlot);
      checkboxSlot += 1;
    } else if (kind == RuntimeControllerSlotKind::kSelect) {
      const int cachedValue = cachedState.selects[static_cast<std::size_t>(selectSlot)].index;
      const int liveValue = liveState.selects[static_cast<std::size_t>(selectSlot)].index;
      differs = cachedValue != liveValue;
      paramIndex = ControllerSelectParamIndex(logicalSlot);
      selectSlot += 1;
    } else if (kind == RuntimeControllerSlotKind::kPoint) {
      const ControllerPointValue& cachedPoint = cachedState.points[static_cast<std::size_t>(pointSlot)];
      const ControllerPointValue& livePoint = liveState.points[static_cast<std::size_t>(pointSlot)];
      differs =
        std::fabs(cachedPoint.x - livePoint.x) > 1e-6 ||
        std::fabs(cachedPoint.y - livePoint.y) > 1e-6;
      paramIndex = ControllerPointParamIndex(logicalSlot);
      pointSlot += 1;
    } else {
      continue;
    }

    if (!differs) {
      continue;
    }

    foundMismatchingSlot = true;
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
    if (findErr != PF_Err_NONE || !foundPreviousKey || previousKeyTime <= 0) {
      return 0;
    }

    const long slotDirtyFrame =
      TimeValueToSketchFrame(previousKeyTime, previousKeyTimeScale, frameRate);
    earliestDirtyFrame = earliestDirtyFrame > 0
      ? std::min<long>(earliestDirtyFrame, slotDirtyFrame)
      : slotDirtyFrame;
  }

  return foundMismatchingSlot ? earliestDirtyFrame : -1;
}

bool EnsureControllerStateFreshForTargetFrame(
  PF_InData* in_data,
  long targetFrame,
  CachedSketchState* cache,
  std::string* errorMessage
) {
  if (!in_data || !cache || !cache->valid || cache->controllerHistoryDirty || targetFrame < 0) {
    return true;
  }

  const CachedSketchState::FrameSnapshot* exactSnapshot = FindFrameSnapshot(cache, targetFrame);
  if (!exactSnapshot || !exactSnapshot->hasControllerState) {
    return true;
  }

  const double simulationFrameRate = ResolveSketchSimulationFrameRate(in_data);
  ControllerPoolState liveState;
  if (!CheckoutControllerStateForSketchFrame(
        in_data,
        targetFrame,
        simulationFrameRate,
        &liveState,
        errorMessage
      )) {
    return false;
  }

  if (exactSnapshot->controllerState.stateHash == liveState.stateHash) {
    return true;
  }

  const long dirtyStartFrame = ResolveControllerHistoryStartFrameForStateMismatch(
    in_data,
    exactSnapshot->controllerState,
    liveState
  );
  cache->controllerHistoryDirty = true;
  cache->controllerHistoryDirtyFrame =
    cache->controllerHistoryDirtyFrame < 0
      ? std::max<long>(0, dirtyStartFrame)
      : std::min<long>(cache->controllerHistoryDirtyFrame, std::max<long>(0, dirtyStartFrame));

  return true;
}

long FindControllerTimelineMismatchFrame(
  const CachedSketchState& cache,
  const std::vector<std::uint64_t>& livePrefixHashes,
  long targetFrame
) {
  if (targetFrame < 0 ||
      targetFrame >= static_cast<long>(livePrefixHashes.size())) {
    return -1;
  }
  const auto targetCachedHash = cache.frameControllerTimelineHashes.find(targetFrame);
  if (targetCachedHash == cache.frameControllerTimelineHashes.end() ||
      targetCachedHash->second == livePrefixHashes[static_cast<std::size_t>(targetFrame)]) {
    return -1;
  }

  for (long frame = 0; frame <= targetFrame; ++frame) {
    const auto cachedHash = cache.frameControllerTimelineHashes.find(frame);
    if (cachedHash == cache.frameControllerTimelineHashes.end() ||
        cachedHash->second != livePrefixHashes[static_cast<std::size_t>(frame)]) {
      return frame;
    }
  }
  return 0;
}

bool CachedControllerTimelineMatchesTarget(
  const CachedSketchState& cache,
  const std::vector<std::uint64_t>& livePrefixHashes,
  long targetFrame
) {
  if (targetFrame < 0 ||
      targetFrame >= static_cast<long>(livePrefixHashes.size())) {
    return false;
  }
  const auto cachedHash = cache.frameControllerTimelineHashes.find(targetFrame);
  return cachedHash != cache.frameControllerTimelineHashes.end() &&
    cachedHash->second == livePrefixHashes[static_cast<std::size_t>(targetFrame)];
}

bool BuildBitmapFramePlanWithPlanCache(
  PF_LayerDef* output,
  std::uint64_t cacheKey,
  long targetFrame,
  const std::vector<std::pair<long, ScenePayload>>& scenes,
  BitmapFramePlan* outPlan,
  std::string* errorMessage
) {
  if (!output || !outPlan) {
    if (errorMessage) {
      *errorMessage = "Bitmap frame plan request is missing an output target.";
    }
    return false;
  }

  BitmapFramePlan framePlan;
  framePlan.cacheKey = cacheKey;
  framePlan.targetFrame = targetFrame;
  framePlan.width = output->width;
  framePlan.height = output->height;
  framePlan.logicalWidth = output->width;
  framePlan.logicalHeight = output->height;
  const auto runtimeState = ResolveEffectRuntimeState(
    static_cast<std::uintptr_t>(cacheKey),
    true
  );
  if (!runtimeState) {
    if (errorMessage) {
      *errorMessage = "Missing Effect runtime state for bitmap plan caching.";
    }
    return false;
  }
  const std::lock_guard<std::recursive_mutex> lock(runtimeState->mutex);
  auto& planCache = runtimeState->bitmapFramePlans;
  auto& planOrder = runtimeState->bitmapFramePlanOrder;
  constexpr std::size_t kMaxBitmapFramePlans = 256;
  for (std::size_t index = 0; index < scenes.size(); index += 1) {
    BitmapFramePlanOp op;
    op.frame = scenes[index].first;

    const auto cachedPlan = planCache.find(op.frame);
    if (cachedPlan != planCache.end()) {
      op.drawPlan = cachedPlan->second;
      const auto orderIt = std::find(planOrder.begin(), planOrder.end(), op.frame);
      if (orderIt != planOrder.end()) {
        planOrder.erase(orderIt);
      }
      planOrder.push_back(op.frame);
    } else {
      if (!BuildBitmapDrawPlan(
        output,
        cacheKey,
        scenes[index].first,
        scenes[index].second,
        &op.drawPlan,
        errorMessage
      )) {
        framePlan.supported = false;
        framePlan.unsupportedReason =
          errorMessage && !errorMessage->empty()
            ? *errorMessage
            : "The Bitmap frame planner does not support one or more commands in this sketch.";
        *outPlan = framePlan;
        return false;
      }
      planCache[op.frame] = op.drawPlan;
      planOrder.push_back(op.frame);
      while (planOrder.size() > kMaxBitmapFramePlans) {
        const long evictedFrame = planOrder.front();
        planOrder.erase(planOrder.begin());
        planCache.erase(evictedFrame);
      }
    }

    if (op.drawPlan.resetsHistory) {
      // A compositor-safe clear/background makes every earlier frame
      // irrelevant. Keep residual sketches stateful, while making ordinary
      // opaque-background frames independently renderable.
      framePlan.operations.clear();
    }
    framePlan.operations.push_back(std::move(op));
  }

  *outPlan = std::move(framePlan);
  return true;
}

void ResetRuntimeTransientDrawingState(JsHostRuntime* runtime, bool resetTransform) {
  if (!runtime) {
    return;
  }

  if (resetTransform) {
    runtime->currentTransform = MakeIdentityTransform();
  }
  runtime->stateStack.clear();
  runtime->shapeVertices.clear();
  runtime->shapeContours.clear();
  runtime->curveVertices.clear();
  runtime->contourVertices.clear();
  runtime->contourCurveVertices.clear();
  runtime->shapeSubpath.segments.clear();
  runtime->shapeSubpath.isContour = false;
  runtime->shapeContourSubpaths.clear();
  runtime->contourSubpath.segments.clear();
  runtime->contourSubpath.isContour = false;
  runtime->shapeUsesCurve = false;
  runtime->contourUsesCurve = false;
  runtime->insideContour = false;
  runtime->shapeKind = BEGIN_SHAPE_DEFAULT;
}

RuntimeEngineState CaptureRuntimeEngineState(const JsHostRuntime& runtime) {
  RuntimeEngineState state;
  state.currentFill = runtime.currentFill;
  state.hasFill = runtime.hasFill;
  state.fillExplicit = runtime.fillExplicit;
  state.currentStroke = runtime.currentStroke;
  state.hasStroke = runtime.hasStroke;
  state.strokeExplicit = runtime.strokeExplicit;
  state.strokeWeight = runtime.strokeWeight;
  state.currentTransform = runtime.currentTransform;
  state.rectMode = runtime.rectMode;
  state.ellipseMode = runtime.ellipseMode;
  state.colorMode = runtime.colorMode;
  state.strokeCap = runtime.strokeCap;
  state.strokeJoin = runtime.strokeJoin;
  state.curveTightness = runtime.curveTightness;
  state.angleMode = runtime.angleMode;
  state.blendMode = runtime.blendMode;
  state.eraseActive = runtime.eraseActive;
  state.eraseFillStrength = runtime.eraseFillStrength;
  state.eraseStrokeStrength = runtime.eraseStrokeStrength;
  state.clipCapturing = runtime.clipCapturing;
  state.clipInvert = runtime.clipInvert;
  state.textFontName = runtime.textFontName;
  state.textStyle = runtime.textStyle;
  state.textWrap = runtime.textWrap;
  state.textSize = runtime.textSize;
  state.textLeading = runtime.textLeading;
  state.textLeadingExplicit = runtime.textLeadingExplicit;
  state.textAlignH = runtime.textAlignH;
  state.textAlignV = runtime.textAlignV;
  state.randomState = runtime.randomState;
  state.gaussianHasSpare = runtime.gaussianHasSpare;
  state.gaussianSpare = runtime.gaussianSpare;
  state.noiseSeed = runtime.noiseSeed;
  state.noiseOctaves = runtime.noiseOctaves;
  state.noiseFalloff = runtime.noiseFalloff;
  return state;
}

void RestoreRuntimeEngineState(JsHostRuntime* runtime, const RuntimeEngineState& state) {
  if (!runtime) {
    return;
  }

  runtime->currentFill = state.currentFill;
  runtime->hasFill = state.hasFill;
  runtime->fillExplicit = state.fillExplicit;
  runtime->currentStroke = state.currentStroke;
  runtime->hasStroke = state.hasStroke;
  runtime->strokeExplicit = state.strokeExplicit;
  runtime->strokeWeight = state.strokeWeight;
  runtime->currentTransform = state.currentTransform;
  runtime->rectMode = state.rectMode;
  runtime->ellipseMode = state.ellipseMode;
  runtime->colorMode = state.colorMode;
  runtime->strokeCap = state.strokeCap;
  runtime->strokeJoin = state.strokeJoin;
  runtime->curveTightness = state.curveTightness;
  runtime->angleMode = state.angleMode;
  runtime->blendMode = state.blendMode;
  runtime->eraseActive = state.eraseActive;
  runtime->eraseFillStrength = state.eraseFillStrength;
  runtime->eraseStrokeStrength = state.eraseStrokeStrength;
  runtime->clipCapturing = state.clipCapturing;
  runtime->clipInvert = state.clipInvert;
  runtime->textFontName = state.textFontName;
  runtime->textStyle = state.textStyle;
  runtime->textWrap = state.textWrap;
  runtime->textSize = state.textSize;
  runtime->textLeading = state.textLeading;
  runtime->textLeadingExplicit = state.textLeadingExplicit;
  runtime->textAlignH = state.textAlignH;
  runtime->textAlignV = state.textAlignV;
  runtime->randomState = state.randomState;
  runtime->gaussianHasSpare = state.gaussianHasSpare;
  runtime->gaussianSpare = state.gaussianSpare;
  runtime->noiseSeed = state.noiseSeed;
  runtime->noiseOctaves = state.noiseOctaves;
  runtime->noiseFalloff = state.noiseFalloff;
  runtime->noiseInitialized = false;
  runtime->noiseValues.clear();
  ResetRuntimeTransientDrawingState(runtime, false);
}

void UpdateFrameGlobals(
  JSContextRef ctx,
  JSObjectRef globalObject,
  JsHostRuntime* runtime,
  const ScenePayload& scene,
  PF_LayerDef* output,
  double frameRate,
  double currentTime,
  long frameCount
) {
  if (runtime) {
    runtime->currentFrameCount = frameCount;
    runtime->currentTimeSeconds = currentTime;
  }
  SetJsNumber(ctx, globalObject, "width", GetSceneWidth(scene, output));
  SetJsNumber(ctx, globalObject, "height", GetSceneHeight(scene, output));
  SetJsNumber(ctx, globalObject, "frameCount", static_cast<double>(frameCount));
  SetJsNumber(ctx, globalObject, "time", currentTime);
  SetJsNumber(ctx, globalObject, "deltaTime", frameRate > 0.0 ? (1000.0 / frameRate) : 0.0);
  SetJsNumber(ctx, globalObject, "millis", currentTime * 1000.0);
}

void StoreFrameSnapshot(
  CachedSketchState* cache,
  long frame,
  const ScenePayload& scene
) {
  if (!cache) {
    return;
  }

  CachedSketchState::FrameSnapshot exactSnapshot;
  exactSnapshot.frame = frame;
  exactSnapshot.scene = scene;
  exactSnapshot.controllerState = cache->controllerState;
  exactSnapshot.hasControllerState = cache->hasControllerState;

  cache->exactSnapshots[frame] = exactSnapshot;
  auto existingExact = std::find(cache->exactSnapshotOrder.begin(), cache->exactSnapshotOrder.end(), frame);
  if (existingExact != cache->exactSnapshotOrder.end()) {
    cache->exactSnapshotOrder.erase(existingExact);
  }
  cache->exactSnapshotOrder.push_back(frame);
  EnforceFrameSnapshotBudget(cache);
}

bool BuildSettledDisplaySceneForFrame(
  CachedSketchState* cache,
  PF_LayerDef* output,
  JSObjectRef globalObject,
  long frame,
  double simulationFrameRate,
  const ControllerPoolState& frameControllerState,
  ScenePayload* settledSceneOut,
  std::string* errorMessage
) {
  if (!cache || !cache->context || !cache->drawFn || !settledSceneOut) {
    if (errorMessage) {
      *errorMessage = "Invalid state for settled display evaluation.";
    }
    return false;
  }

  std::string primaryRuntimeStateJson;
  if (const auto captured = CaptureRuntimeState(cache->context, errorMessage)) {
    primaryRuntimeStateJson = *captured;
  } else {
    if (errorMessage && errorMessage->empty()) {
      *errorMessage = "Failed to capture runtime state for settled display evaluation.";
    }
    return false;
  }

  const RuntimeEngineState primaryEngineState = CaptureRuntimeEngineState(cache->runtime);
  const ScenePayload primaryRuntimeScene = cache->runtime.scene;

  cache->runtime.scene.commands.clear();
  cache->runtime.scene.imageAssets.clear();
  cache->runtime.scene.hasBackground = false;
  cache->runtime.scene.clearsSurface = false;
  ResetRuntimeTransientDrawingState(&cache->runtime, true);
  UpdateFrameGlobals(
    cache->context,
    globalObject,
    &cache->runtime,
    cache->runtime.scene,
    output,
    simulationFrameRate,
    simulationFrameRate > 0.0 ? static_cast<double>(frame - 1) / simulationFrameRate : 0.0,
    frame
  );

  if (!ApplyControllerStateToRuntime(cache->context, frameControllerState, errorMessage)) {
    return false;
  }

  g_activeRuntime = &cache->runtime;
  const bool drawOk = CallFunction(cache->context, globalObject, cache->drawFn, errorMessage);
  g_activeRuntime = NULL;
  if (!drawOk) {
    return false;
  }

  *settledSceneOut = cache->runtime.scene;

  if (!RestoreRuntimeState(cache->context, primaryRuntimeStateJson, errorMessage)) {
    return false;
  }
  RestoreRuntimeEngineState(&cache->runtime, primaryEngineState);
  cache->runtime.scene = primaryRuntimeScene;
  cache->controllerState = frameControllerState;
  cache->controllerStateHash = frameControllerState.stateHash;
  cache->hasControllerState = true;
  return true;
}

void ResetCachedSketchState(CachedSketchState* cache) {
  if (!cache) {
    return;
  }

  if (cache->context) {
    if (cache->drawFn) {
      JSValueUnprotect(cache->context, cache->drawFn);
      cache->drawFn = NULL;
    }
    JSGlobalContextRelease(cache->context);
    cache->context = NULL;
  }

  cache->latestScene = ScenePayload();
  cache->runtime = JsHostRuntime();
  cache->source.clear();
  cache->sourceHash.clear();
  cache->controllerHash.clear();
  cache->controllerStateHash.clear();
  cache->controllerState = ControllerPoolState();
  cache->hasControllerState = false;
  cache->revision = -1;
  cache->frameCacheBudgetBytes = kDefaultRecentFrameBudgetBytes;
  cache->checkpointInterval = 12;
  cache->outputWidth = 0;
  cache->outputHeight = 0;
  cache->lastFrame = 0;
  cache->simulatedFrame = 0;
  cache->controllerHistoryDirty = false;
  cache->controllerHistoryDirtyFrame = -1;
  cache->valid = false;
  cache->exactSnapshots.clear();
  cache->exactSnapshotOrder.clear();
  cache->frameScenes.clear();
  cache->frameControllerTimelineHashes.clear();
}

bool InitializeCachedSketchState(
  CachedSketchState* cache,
  PF_InData* in_data,
  PF_LayerDef* output,
  const std::string& source,
  const std::string& sourceHash,
  const std::string& debugTracePath,
  const std::string& debugSessionId,
  const std::string& controllerHash,
  const ControllerPoolState* controllerState,
  double pixelDensity,
  std::size_t frameCacheBudgetBytes,
  long checkpointInterval,
  A_long revision,
  std::string* errorMessage
) {
  if (!cache || !output) {
    if (errorMessage) {
      *errorMessage = "Invalid cache initialization request.";
    }
    return false;
  }

  ResetCachedSketchState(cache);

  cache->context = JSGlobalContextCreate(NULL);
  if (!cache->context) {
    if (errorMessage) {
      *errorMessage = "Could not create JavaScript runtime.";
    }
    return false;
  }

  cache->source = source;
  cache->sourceHash = sourceHash;
  cache->controllerHash = controllerHash;
  cache->revision = revision;
  cache->frameCacheBudgetBytes = frameCacheBudgetBytes > 0 ? frameCacheBudgetBytes : kDefaultRecentFrameBudgetBytes;
  cache->checkpointInterval = checkpointInterval > 0 ? checkpointInterval : 12;
  cache->outputWidth = output->width;
  cache->outputHeight = output->height;
  cache->runtime.scene.canvasWidth = static_cast<double>(output->width);
  cache->runtime.scene.canvasHeight = static_cast<double>(output->height);
  cache->runtime.desiredFrameRate = GetFrameRate(in_data);
  cache->runtime.randomState = 0x12345678UL;
  cache->runtime.pixelDensity = std::max(1.0, pixelDensity);
  cache->runtime.debugTracePath = debugTracePath;
  cache->runtime.debugSessionId = debugSessionId;
  cache->runtime.currentFrameCount = 0;
  cache->runtime.currentTimeSeconds = 0.0;

  ControllerPoolState initialControllerState = controllerState ? *controllerState : ControllerPoolState();
  if (in_data &&
      !CheckoutControllerStateForSketchFrame(
        in_data,
        0,
        cache->runtime.desiredFrameRate,
        &initialControllerState,
        errorMessage
      )) {
    ResetCachedSketchState(cache);
    return false;
  }
  initialControllerState.stateHash = BuildControllerStateHash(initialControllerState);
  cache->controllerStateHash = initialControllerState.stateHash;
  cache->controllerState = initialControllerState;
  cache->hasControllerState = true;

  JSObjectRef globalObject = JSContextGetGlobalObject(cache->context);
  InstallRuntimeBootstrap(cache->context, globalObject);
  UpdateFrameGlobals(
    cache->context,
    globalObject,
    &cache->runtime,
    cache->runtime.scene,
    output,
    cache->runtime.desiredFrameRate,
    0.0,
    0
  );

  const std::vector<runtime_internal::CapturedBinding> capturedBindings =
    ExtractTopLevelBindings(source);
  const std::string bindingRegistrationScript =
    BuildBindingRegistrationScript(capturedBindings);

  std::string instrumentedSource = source;
  if (!bindingRegistrationScript.empty()) {
    instrumentedSource.push_back('\n');
    instrumentedSource.append(bindingRegistrationScript);
  }

  if (!EvaluateScript(cache->context, instrumentedSource, "momentum-sketch.js", NULL, errorMessage)) {
    ResetCachedSketchState(cache);
    return false;
  }

  JSValueRef setupFn = GetBindingValue(cache->context, "setup", errorMessage);
  if (errorMessage && !errorMessage->empty()) {
    ResetCachedSketchState(cache);
    return false;
  }

  JSValueRef preloadFn = GetBindingValue(cache->context, "preload", errorMessage);
  if (errorMessage && !errorMessage->empty()) {
    ResetCachedSketchState(cache);
    return false;
  }

  JSValueRef drawFn = GetBindingValue(cache->context, "draw", errorMessage);
  if (errorMessage && !errorMessage->empty()) {
    ResetCachedSketchState(cache);
    return false;
  }

  if (preloadFn && !JSValueIsNull(cache->context, preloadFn) && !JSValueIsUndefined(cache->context, preloadFn)) {
    if (!ApplyControllerStateToRuntime(cache->context, initialControllerState, errorMessage)) {
      ResetCachedSketchState(cache);
      return false;
    }
    g_activeRuntime = &cache->runtime;
    const bool preloadOk = CallFunction(cache->context, globalObject, preloadFn, errorMessage);
    g_activeRuntime = NULL;
    if (!preloadOk) {
      ResetCachedSketchState(cache);
      return false;
    }
  }

  if (!ApplyControllerStateToRuntime(cache->context, initialControllerState, errorMessage)) {
    ResetCachedSketchState(cache);
    return false;
  }
  g_activeRuntime = &cache->runtime;
  const bool setupOk = CallFunction(cache->context, globalObject, setupFn, errorMessage);
  g_activeRuntime = NULL;
  if (!setupOk) {
    ResetCachedSketchState(cache);
    return false;
  }

  if (drawFn && !JSValueIsNull(cache->context, drawFn) && !JSValueIsUndefined(cache->context, drawFn)) {
    cache->drawFn = drawFn;
    JSValueProtect(cache->context, cache->drawFn);
  }

  cache->latestScene = cache->runtime.scene;
  cache->lastFrame = 0;
  cache->simulatedFrame = 0;
  cache->valid = true;
  cache->frameScenes[0] = cache->latestScene;
  StoreFrameSnapshot(cache, 0, cache->latestScene);
  return true;
}

double GetSimulationFrameRate(const CachedSketchState& cache, PF_InData* in_data) {
  return cache.runtime.desiredFrameRate > 0.0 ? cache.runtime.desiredFrameRate : GetFrameRate(in_data);
}

bool AdvanceCachedSketchState(
  CachedSketchState* cache,
  PF_InData* in_data,
  PF_LayerDef* output,
  long targetFrame,
  const std::function<bool()>& shouldCancel,
  std::string* errorMessage
) {
  if (!cache || !cache->valid || !output) {
    if (errorMessage) {
      *errorMessage = "Invalid cached sketch state.";
    }
    return false;
  }

  if (!cache->drawFn) {
    cache->latestScene = cache->runtime.scene;
    cache->simulatedFrame = cache->lastFrame;
    return true;
  }

  const double simulationFrameRate = GetSimulationFrameRate(*cache, in_data);
  JSObjectRef globalObject = JSContextGetGlobalObject(cache->context);

  for (long frame = cache->simulatedFrame + 1; frame <= targetFrame; ++frame) {
    if (shouldCancel && shouldCancel()) {
      if (errorMessage) {
        *errorMessage = "render-cancelled";
      }
      return false;
    }
    const std::string previousControllerStateHash = cache->controllerStateHash;
    const bool hadPreviousControllerState = cache->hasControllerState;
    ControllerPoolState frameControllerState;
    if (!CheckoutControllerStateForSketchFrame(
          in_data,
          frame,
          simulationFrameRate,
          &frameControllerState,
          errorMessage
        )) {
      return false;
    }
    cache->runtime.scene.commands.clear();
    cache->runtime.scene.imageAssets.clear();
    cache->runtime.scene.hasBackground = false;
    cache->runtime.scene.clearsSurface = false;
    ResetRuntimeTransientDrawingState(&cache->runtime, true);
    UpdateFrameGlobals(
      cache->context,
      globalObject,
      &cache->runtime,
      cache->runtime.scene,
      output,
      simulationFrameRate,
      simulationFrameRate > 0.0 ? static_cast<double>(frame - 1) / simulationFrameRate : 0.0,
      frame
    );

    if (!ApplyControllerStateToRuntime(cache->context, frameControllerState, errorMessage)) {
      return false;
    }
    g_activeRuntime = &cache->runtime;
    const bool drawOk = CallFunction(cache->context, globalObject, cache->drawFn, errorMessage);
    g_activeRuntime = NULL;
    if (!drawOk) {
      return false;
    }
    if (shouldCancel && shouldCancel()) {
      if (errorMessage) {
        *errorMessage = "render-cancelled";
      }
      return false;
    }

    ScenePayload frameScene = cache->runtime.scene;
    if (hadPreviousControllerState &&
        previousControllerStateHash != frameControllerState.stateHash) {
      ScenePayload settledScene;
      if (!BuildSettledDisplaySceneForFrame(
            cache,
            output,
            globalObject,
            frame,
            simulationFrameRate,
            frameControllerState,
            &settledScene,
            errorMessage
          )) {
        return false;
      }
      frameScene = settledScene;
    }
    // Keep the live evaluator as a forward-only lane. Both executors consume
    // these immutable per-frame command deltas through BitmapFramePlan; the
    // evaluator no longer owns a backend-specific raster history.
    cache->latestScene = frameScene;
    cache->runtime.scene = frameScene;

    cache->lastFrame = frame;
    cache->simulatedFrame = frame;
    cache->controllerState = frameControllerState;
    cache->controllerStateHash = frameControllerState.stateHash;
    cache->hasControllerState = true;
    cache->frameScenes[frame] = frameScene;
    if (frame == targetFrame) {
      StoreFrameSnapshot(cache, frame, frameScene);
    }
  }

  return true;
}

}  // namespace

bool ResolveInvocationColorControllerDefault(
  PF_InData* in_data,
  PF_ParamIndex colorParamIndex,
  ControllerColorValue* outColor
) {
  if (!outColor || colorParamIndex < ControllerColorValueParamIndex(0) ||
      colorParamIndex > ControllerColorValueParamIndex(kControllerSlotCount - 1)) {
    return false;
  }
  const int relativeIndex = static_cast<int>(
    colorParamIndex - ControllerColorValueParamIndex(0)
  );
  if ((relativeIndex % kControllerParamKindsPerSlot) != 0) {
    return false;
  }
  const int logicalSlot = relativeIndex / kControllerParamKindsPerSlot;
  if (logicalSlot < 0 || logicalSlot >= kControllerSlotCount) {
    return false;
  }

  RuntimeSketchBundle fallbackBundle;
  const RuntimeSketchBundle* bundle = g_activeRuntimeDocument;
  if (!bundle) {
    std::string bundleError;
    fallbackBundle = runtime_internal::ReadRuntimeSketchBundleForEffect(
      in_data,
      0,
      &bundleError
    );
    if (!bundleError.empty()) {
      return false;
    }
    bundle = &fallbackBundle;
  }

  const RuntimeControllerSlotSpec* slotSpec = FindControllerSlotSpec(*bundle, logicalSlot);
  if (!slotSpec || slotSpec->kind != RuntimeControllerSlotKind::kColor) {
    return false;
  }

  *outColor = ResolveColorControllerDefaultValue(*bundle, logicalSlot);
  return true;
}

std::uint64_t GetEffectSessionInstanceId(std::uintptr_t sessionKey) {
  const auto state = ResolveEffectRuntimeState(sessionKey, false);
  if (!state) {
    return 0;
  }
  const std::lock_guard<std::recursive_mutex> lock(state->mutex);
  return state->transportInstanceId;
}

std::uintptr_t ResolveEffectPreparationCacheKey(std::uint64_t lineageIdentity) {
  return BuildPersistentRuntimeKey(lineageIdentity, 1);
}

std::uintptr_t ResolveEffectRenderCacheKey(std::uint64_t lineageIdentity) {
  return BuildPersistentRuntimeKey(lineageIdentity, 2);
}

std::uintptr_t ResolveEffectRenderCacheKeyForScale(
  std::uint64_t lineageIdentity,
  double scaleX,
  double scaleY
) {
  const double safeScale = std::min(
    std::max(0.0, scaleX),
    std::max(0.0, scaleY)
  );
  if (safeScale >= 0.999999) {
    return ResolveEffectRenderCacheKey(lineageIdentity);
  }
  // Keep AE's interactive downsample canvases away from the exact lane so a
  // preview resize cannot evict full-resolution checkpoints.
  const std::uint32_t lane = safeScale > 0.60
    ? 4U
    : safeScale > 0.40
      ? 5U
      : safeScale > 0.28
        ? 6U
        : 7U;
  return BuildPersistentRuntimeKey(lineageIdentity, lane);
}

void InvalidateEffectPersistentRenderCaches(
  std::uint64_t lineageIdentity,
  const char* reason
) {
  if (lineageIdentity == 0) {
    return;
  }
  ClearCachedSketchByKey(ResolveEffectPreparationCacheKey(lineageIdentity), reason);
  ClearCachedSketchByKey(ResolveEffectRenderCacheKey(lineageIdentity), reason);
  for (std::uint32_t lane = 4U; lane <= 7U; ++lane) {
    ClearCachedSketchByKey(BuildPersistentRuntimeKey(lineageIdentity, lane), reason);
  }
}

void SetEffectSessionInstanceId(std::uintptr_t sessionKey, std::uint64_t instanceId) {
  const auto state = ResolveEffectRuntimeState(sessionKey, true);
  if (!state || instanceId == 0) {
    return;
  }
  const std::lock_guard<std::recursive_mutex> lock(state->mutex);
  state->transportInstanceId = instanceId;
}

A_long GetEffectSessionSyncedRevision(std::uintptr_t sessionKey) {
  const auto state = ResolveEffectRuntimeState(sessionKey, false);
  if (!state) {
    return -1;
  }
  const std::lock_guard<std::recursive_mutex> lock(state->mutex);
  return state->syncedRevision;
}

void SetEffectSessionSyncedRevision(std::uintptr_t sessionKey, A_long revision) {
  const auto state = ResolveEffectRuntimeState(sessionKey, true);
  if (!state) {
    return;
  }
  const std::lock_guard<std::recursive_mutex> lock(state->mutex);
  state->syncedRevision = revision;
}

std::string GetEffectSessionControllerHash(std::uintptr_t sessionKey) {
  const auto state = ResolveEffectRuntimeState(sessionKey, false);
  if (!state) {
    return std::string();
  }
  const std::lock_guard<std::recursive_mutex> lock(state->mutex);
  return state->syncedControllerHash;
}

void SetEffectSessionControllerHash(
  std::uintptr_t sessionKey,
  const std::string& hash
) {
  const auto state = ResolveEffectRuntimeState(sessionKey, true);
  if (!state) {
    return;
  }
  const std::lock_guard<std::recursive_mutex> lock(state->mutex);
  state->syncedControllerHash = hash;
}

std::string GetEffectSessionControllerUiHash(std::uintptr_t sessionKey) {
  const auto state = ResolveEffectRuntimeState(sessionKey, false);
  if (!state) {
    return std::string();
  }
  const std::lock_guard<std::recursive_mutex> lock(state->mutex);
  return state->syncedControllerUiHash;
}

void SetEffectSessionControllerUiHash(
  std::uintptr_t sessionKey,
  const std::string& hash
) {
  const auto state = ResolveEffectRuntimeState(sessionKey, true);
  if (!state) {
    return;
  }
  const std::lock_guard<std::recursive_mutex> lock(state->mutex);
  state->syncedControllerUiHash = hash;
}

void ClearCachedSketchByKey(std::uintptr_t cacheKey, const char* reason) {
  if (!cacheKey) {
    return;
  }
  const auto runtimeState = RemoveEffectRuntimeState(cacheKey);
  if (runtimeState) {
    const std::lock_guard<std::recursive_mutex> lock(runtimeState->mutex);
    runtimeState->bitmapFramePlans.clear();
    runtimeState->bitmapFramePlanOrder.clear();
    ResetCachedSketchState(&runtimeState->sketch);
  }
  DisposeBitmapGpuStateByCacheKey(static_cast<std::uint64_t>(cacheKey), reason);
  ClearBitmapGpuTextAtlasCacheByKey(static_cast<std::uint64_t>(cacheKey));
}

void ClearAllCachedSketches() {
  std::vector<std::shared_ptr<EffectRuntimeState>> runtimeStates;
  {
    const std::lock_guard<std::mutex> lock(gEffectRuntimeStatesMutex);
    for (const auto& entry : gEffectRuntimeStates) {
      runtimeStates.push_back(entry.second);
    }
    gEffectRuntimeStates.clear();
  }
  for (const auto& runtimeState : runtimeStates) {
    const std::lock_guard<std::recursive_mutex> lock(runtimeState->mutex);
    runtimeState->bitmapFramePlans.clear();
    runtimeState->bitmapFramePlanOrder.clear();
    ResetCachedSketchState(&runtimeState->sketch);
  }
  ClearAllBitmapGpuTextAtlasCaches();
}

long ResolveSketchTargetFrame(
  PF_InData* in_data,
  std::uintptr_t runtimeKey
) {
  const double simulationFrameRate = ResolveSketchSimulationFrameRate(
    in_data,
    runtimeKey
  );
  const double currentTime = GetCompTimeSeconds(in_data);
  return std::max<long>(
    1,
    static_cast<long>(std::floor(currentTime * simulationFrameRate)) + 1L
  );
}

double ResolveSketchSimulationFrameRate(
  PF_InData* in_data,
  std::uintptr_t runtimeKey
) {
  const std::uintptr_t cacheKey = runtimeKey
    ? runtimeKey
    : ResolveEffectRuntimeKey(in_data);
  double simulationFrameRate = GetFrameRate(in_data);
  const auto runtimeState = ResolveEffectRuntimeState(cacheKey, false);
  if (runtimeState) {
    const std::lock_guard<std::recursive_mutex> lock(runtimeState->mutex);
    if (runtimeState->sketch.valid) {
      simulationFrameRate = GetSimulationFrameRate(runtimeState->sketch, in_data);
    }
  }
  return simulationFrameRate;
}

bool PrepareEffectRuntimeDocument(
  PF_InData* in_data,
  std::uintptr_t invocationKey,
  std::uintptr_t preparationCacheKey,
  A_long revision,
  A_long instanceId,
  std::string* errorMessage
) {
  if (!invocationKey || !preparationCacheKey) {
    if (errorMessage) {
      *errorMessage = "PreRender could not allocate an isolated render runtime.";
    }
    return false;
  }

  const auto preparationState = ResolveEffectRuntimeState(preparationCacheKey, true);
  const auto invocationState = ResolveEffectRuntimeState(invocationKey, true);
  if (!preparationState || !invocationState) {
    if (errorMessage) {
      *errorMessage = "Could not create Effect-local runtime state during PreRender.";
    }
    return false;
  }

  RuntimeSketchBundle preparedDocument;
  {
    const std::lock_guard<std::recursive_mutex> lock(preparationState->mutex);
    if (!preparationState->hasDocument ||
        preparationState->documentRevisionParam != revision) {
      RuntimeSketchBundle loadedDocument = runtime_internal::ReadRuntimeSketchBundleForEffect(
        in_data,
        instanceId,
        errorMessage
      );
      if (errorMessage && !errorMessage->empty()) {
        return false;
      }
      preparationState->document = std::move(loadedDocument);
      preparationState->hasDocument = true;
      preparationState->documentRevisionParam = revision;
      preparationState->controllerTimeline.clear();
      preparationState->controllerTimelinePrefixHashes.clear();
      preparationState->controllerDependencyParamIndices.clear();
      preparationState->controllerDependencyStates.clear();
      preparationState->hasControllerDependencyStates = false;
      preparationState->controllerTimelineHash.clear();
      preparationState->controllerTimelineFrameRate = 0.0;
      preparationState->controllerTimelineTargetFrame = -1;
      preparationState->hasControllerTimeline = false;
    }
    preparedDocument = preparationState->document;
  }

  {
    const std::lock_guard<std::recursive_mutex> lock(invocationState->mutex);
    invocationState->document = std::move(preparedDocument);
    invocationState->hasDocument = true;
    invocationState->documentRevisionParam = revision;
  }
  return true;
}

bool CaptureEffectControllerTimeline(
  PF_InData* in_data,
  std::uintptr_t invocationKey,
  std::uintptr_t preparationCacheKey,
  long* targetFrameOut,
  std::string* timelineHashOut,
  std::string* errorMessage
) {
  if (!in_data || !invocationKey || !preparationCacheKey) {
    if (errorMessage) {
      *errorMessage = "Controller timeline capture is missing its render invocation.";
    }
    return false;
  }

  const auto invocationState = ResolveEffectRuntimeState(invocationKey, false);
  const auto preparationState = ResolveEffectRuntimeState(preparationCacheKey, false);
  if (!invocationState || !preparationState) {
    if (errorMessage) {
      *errorMessage = "Controller timeline capture could not resolve the render runtime.";
    }
    return false;
  }

  RuntimeSketchBundle document;
  A_long documentRevisionParam = -1;
  {
    const std::lock_guard<std::recursive_mutex> lock(invocationState->mutex);
    if (!invocationState->hasDocument) {
      if (errorMessage) {
        *errorMessage = "Controller timeline capture requires a prepared Sketch Document.";
      }
      return false;
    }
    document = invocationState->document;
    documentRevisionParam = invocationState->documentRevisionParam;
  }
  if (!preparationState->hasDocument) {
    if (errorMessage) {
      *errorMessage = "Controller timeline capture requires a prepared Sketch Document.";
    }
    return false;
  }

  const ScopedRuntimeDocument documentScope(&document);
  const double simulationFrameRate = GetFrameRate(in_data);
  const double currentTime = GetCompTimeSeconds(in_data);
  const long targetFrame = std::max<long>(
    1,
    static_cast<long>(std::floor(currentTime * simulationFrameRate)) + 1L
  );

  std::vector<PF_ParamIndex> dependencyParamIndices;
  for (int logicalSlot = 0; logicalSlot < kControllerSlotCount; ++logicalSlot) {
    const RuntimeControllerSlotKind kind = ResolveControllerSlotKind(document, logicalSlot);
    if (kind == RuntimeControllerSlotKind::kNone) {
      continue;
    }
    PF_ParamIndex paramIndex = ControllerPointParamIndex(logicalSlot);
    if (kind == RuntimeControllerSlotKind::kSlider) {
      paramIndex = ControllerSliderParamIndex(logicalSlot);
    } else if (kind == RuntimeControllerSlotKind::kAngle) {
      paramIndex = ControllerAngleValueParamIndex(logicalSlot);
    } else if (kind == RuntimeControllerSlotKind::kColor) {
      paramIndex = ControllerColorValueParamIndex(logicalSlot);
    } else if (kind == RuntimeControllerSlotKind::kCheckbox) {
      paramIndex = ControllerCheckboxParamIndex(logicalSlot);
    } else if (kind == RuntimeControllerSlotKind::kSelect) {
      paramIndex = ControllerSelectParamIndex(logicalSlot);
    }
    dependencyParamIndices.push_back(paramIndex);
  }

  AEFX_SuiteScoper<PF_ParamUtilsSuite3> paramUtilsSuite(
    in_data,
    kPFParamUtilsSuite,
    kPFParamUtilsSuiteVersion3,
    NULL
  );
  std::vector<PF_State> dependencyStates;
  bool capturedDependencyStates = paramUtilsSuite.get() != NULL;
  if (capturedDependencyStates) {
    dependencyStates.reserve(dependencyParamIndices.size());
    for (const PF_ParamIndex paramIndex : dependencyParamIndices) {
      PF_State state;
      AEFX_CLR_STRUCT(state);
      const PF_Err stateErr = paramUtilsSuite->PF_GetCurrentState(
        in_data->effect_ref,
        paramIndex,
        NULL,
        NULL,
        &state
      );
      if (stateErr != PF_Err_NONE) {
        capturedDependencyStates = false;
        dependencyStates.clear();
        break;
      }
      dependencyStates.push_back(state);
    }
  }

  std::vector<ControllerPoolState> timeline;
  std::vector<std::uint64_t> timelinePrefixHashes;
  std::string timelineHashText;
  {
    const std::lock_guard<std::recursive_mutex> lock(preparationState->mutex);
    bool dependencyStatesMatch =
      capturedDependencyStates &&
      preparationState->hasControllerDependencyStates &&
      preparationState->controllerDependencyParamIndices == dependencyParamIndices &&
      preparationState->controllerDependencyStates.size() == dependencyStates.size();
    if (dependencyStatesMatch) {
      for (std::size_t index = 0; index < dependencyStates.size(); ++index) {
        A_Boolean identical = FALSE;
        const PF_Err compareErr = paramUtilsSuite->PF_AreStatesIdentical(
          in_data->effect_ref,
          &preparationState->controllerDependencyStates[index],
          &dependencyStates[index],
          &identical
        );
        if (compareErr != PF_Err_NONE || !identical) {
          dependencyStatesMatch = false;
          break;
        }
      }
    }
    const bool timelineCompatible =
      preparationState->hasControllerTimeline &&
      dependencyStatesMatch &&
      std::fabs(preparationState->controllerTimelineFrameRate - simulationFrameRate) < 1e-9 &&
      preparationState->documentRevisionParam == documentRevisionParam &&
      preparationState->document.sourceHash == document.sourceHash &&
      preparationState->document.controllerHash == document.controllerHash;
    if (!timelineCompatible) {
      preparationState->controllerTimeline.clear();
      preparationState->controllerTimelinePrefixHashes.clear();
      preparationState->controllerTimelineFrameRate = simulationFrameRate;
      preparationState->controllerTimelineTargetFrame = -1;
      preparationState->hasControllerTimeline = true;
    }
    preparationState->controllerDependencyParamIndices = dependencyParamIndices;
    preparationState->controllerDependencyStates = dependencyStates;
    preparationState->hasControllerDependencyStates = capturedDependencyStates;

    if (targetFrame < static_cast<long>(preparationState->controllerTimeline.size())) {
      ControllerPoolState liveTargetState;
      if (!CheckoutControllerStateAtTime(
            in_data,
            SketchFrameToTimeValue(targetFrame, simulationFrameRate, in_data->time_scale),
            &liveTargetState,
            errorMessage
          )) {
        return false;
      }
      const ControllerPoolState& cachedTargetState =
        preparationState->controllerTimeline[static_cast<std::size_t>(targetFrame)];
      if (liveTargetState.stateHash != cachedTargetState.stateHash) {
        preparationState->controllerTimeline.clear();
        preparationState->controllerTimelinePrefixHashes.clear();
        preparationState->controllerTimelineTargetFrame = -1;
      }
    }

    std::uint64_t rollingHash = preparationState->controllerTimelinePrefixHashes.empty()
      ? 1469598103934665603ULL
      : preparationState->controllerTimelinePrefixHashes.back();
    const long firstMissingFrame = static_cast<long>(
      preparationState->controllerTimeline.size()
    );
    for (long frame = firstMissingFrame; frame <= targetFrame; ++frame) {
      ControllerPoolState state;
      if (!CheckoutControllerStateAtTime(
            in_data,
            SketchFrameToTimeValue(frame, simulationFrameRate, in_data->time_scale),
            &state,
            errorMessage
          )) {
        return false;
      }
      for (const unsigned char byte : state.stateHash) {
        rollingHash ^= static_cast<std::uint64_t>(byte);
        rollingHash *= 1099511628211ULL;
      }
      preparationState->controllerTimeline.push_back(std::move(state));
      preparationState->controllerTimelinePrefixHashes.push_back(rollingHash);
    }

    if (targetFrame >= static_cast<long>(preparationState->controllerTimeline.size()) ||
        targetFrame >= static_cast<long>(preparationState->controllerTimelinePrefixHashes.size())) {
      if (errorMessage) {
        *errorMessage = "Controller timeline cache did not materialize the target frame.";
      }
      return false;
    }
    preparationState->controllerTimelineTargetFrame = std::max(
      preparationState->controllerTimelineTargetFrame,
      targetFrame
    );
    std::ostringstream hashStream;
    hashStream << std::hex << std::setfill('0') << std::setw(16)
               << preparationState->controllerTimelinePrefixHashes[static_cast<std::size_t>(targetFrame)];
    timelineHashText = hashStream.str();
    timeline.assign(
      preparationState->controllerTimeline.begin(),
      preparationState->controllerTimeline.begin() + static_cast<std::ptrdiff_t>(targetFrame + 1)
    );
    timelinePrefixHashes.assign(
      preparationState->controllerTimelinePrefixHashes.begin(),
      preparationState->controllerTimelinePrefixHashes.begin() +
        static_cast<std::ptrdiff_t>(targetFrame + 1)
    );
  }

  {
    const std::lock_guard<std::recursive_mutex> lock(invocationState->mutex);
    invocationState->controllerTimeline = std::move(timeline);
    invocationState->controllerTimelinePrefixHashes = std::move(timelinePrefixHashes);
    invocationState->controllerTimelineHash = timelineHashText;
    invocationState->controllerTimelineFrameRate = simulationFrameRate;
    invocationState->controllerTimelineTargetFrame = targetFrame;
    invocationState->hasControllerTimeline = true;
  }

  if (targetFrameOut) {
    *targetFrameOut = targetFrame;
  }
  if (timelineHashOut) {
    *timelineHashOut = timelineHashText;
  }
  return true;
}

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
) {
  const auto executeStarted = std::chrono::steady_clock::now();
  const auto invocationState = ResolveEffectRuntimeState(invocationKey, false);
  const auto renderState = ResolveEffectRuntimeState(renderCacheKey, true);
  if (!invocationState || !renderState) {
    if (errorMessage) {
      *errorMessage = "Could not resolve Effect-local runtime state.";
    }
    return std::nullopt;
  }
  if (shouldCancel && shouldCancel()) {
    if (errorMessage) {
      *errorMessage = "render-cancelled";
    }
    return std::nullopt;
  }
  const std::lock_guard<std::recursive_mutex> renderLock(renderState->mutex);
  const std::lock_guard<std::recursive_mutex> invocationLock(invocationState->mutex);
  if (!invocationState->hasDocument || invocationState->documentRevisionParam != revision) {
    if (errorMessage) {
      *errorMessage =
        "PreRender did not prepare the requested Sketch Document for this invocation.";
    }
    return std::nullopt;
  }
  const RuntimeSketchBundle& bundle = invocationState->document;
  const ScopedRuntimeDocument documentScope(&bundle);
  if (!invocationState->hasControllerTimeline) {
    if (errorMessage) {
      *errorMessage = "PreRender did not capture the controller timeline for this invocation.";
    }
    return std::nullopt;
  }
  const ScopedControllerTimeline controllerTimelineScope(
    &invocationState->controllerTimeline
  );
  CachedSketchState& cache = renderState->sketch;
  const A_long effectiveRevision = bundle.revision >= 0 ? static_cast<A_long>(bundle.revision) : revision;
  const bool revisionChanged = cache.revision != effectiveRevision;
  const bool sourceHashChanged = !bundle.sourceHash.empty() && cache.sourceHash != bundle.sourceHash;
  const bool controllerHashChanged = cache.controllerHash != bundle.controllerHash;
  const bool sizeChanged = cache.outputWidth != output->width || cache.outputHeight != output->height;
  std::optional<std::string> source;
  const long targetFrame = ResolveSketchTargetFrame(in_data, renderCacheKey);
  if (targetFrameOut) {
    *targetFrameOut = targetFrame;
  }

  if (!cache.valid ||
      revisionChanged ||
      sourceHashChanged ||
      controllerHashChanged ||
      sizeChanged) {
    std::ostringstream invalidateReason;
    bool needsSeparator = false;
    auto appendInvalidateReason = [&](const char* token) {
      if (!token || !*token) {
        return;
      }
      if (needsSeparator) {
        invalidateReason << ',';
      }
      invalidateReason << token;
      needsSeparator = true;
    };
    if (!cache.valid) {
      appendInvalidateReason("cache-invalid");
    }
    if (revisionChanged) {
      appendInvalidateReason("revision-changed");
    }
    if (sourceHashChanged) {
      appendInvalidateReason("source-changed");
    }
    if (controllerHashChanged) {
      appendInvalidateReason("controller-schema-changed");
    }
    if (sizeChanged) {
      appendInvalidateReason("output-size-changed");
    }
    const std::string invalidateReasonText = invalidateReason.str();
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "runtime-cache-rebuild",
      instanceId,
      static_cast<PF_ParamIndex>(-1),
      targetFrame,
      invalidateReasonText
    );
    source = ReadRuntimeSketchSource(bundle);
    if (!source.has_value()) {
      if (errorMessage) {
        *errorMessage = "No runtime sketch source found.";
      }
      return std::nullopt;
    }

    // In stateful bitmap mode, the Metal accumulation canvas is keyed by the
    // same effect-local runtime key as the JS/frame cache. If the sketch revision, source,
    // controller wiring, or output size changes, any retained GPU canvas is no
    // longer valid and must be discarded before the cache is rebuilt.
    ClearCachedBitmapFramePlansByKey(static_cast<std::uint64_t>(renderCacheKey));
    DisposeBitmapGpuStateByCacheKey(
      static_cast<std::uint64_t>(renderCacheKey),
      invalidateReasonText.empty() ? "runtime-cache-invalidate" : invalidateReasonText.c_str()
    );
    ClearBitmapGpuTextAtlasCacheByKey(static_cast<std::uint64_t>(renderCacheKey));
    ResetCachedSketchState(&cache);
    if (!InitializeCachedSketchState(
      &cache,
      in_data,
      output,
      *source,
      bundle.sourceHash,
      bundle.debugTracePath,
      bundle.debugSessionId,
      bundle.controllerHash,
      NULL,
      bundle.pixelDensity,
      bundle.recentFrameBudgetBytes,
      bundle.checkpointInterval,
      effectiveRevision,
      errorMessage
    )) {
      return std::nullopt;
    }
  }
  if (!invocationState->controllerTimelinePrefixHashes.empty() &&
      cache.frameControllerTimelineHashes.find(0) ==
        cache.frameControllerTimelineHashes.end()) {
    cache.frameControllerTimelineHashes[0] =
      invocationState->controllerTimelinePrefixHashes.front();
  }

  const long timelineMismatchFrame = FindControllerTimelineMismatchFrame(
    cache,
    invocationState->controllerTimelinePrefixHashes,
    targetFrame
  );
  if (timelineMismatchFrame >= 0) {
    cache.controllerHistoryDirty = true;
    cache.controllerHistoryDirtyFrame =
      cache.controllerHistoryDirtyFrame < 0
        ? timelineMismatchFrame
        : std::min<long>(cache.controllerHistoryDirtyFrame, timelineMismatchFrame);
  }
  if (!EnsureControllerStateFreshForTargetFrame(
        in_data,
        targetFrame,
        &cache,
        errorMessage
      )) {
    return std::nullopt;
  }

  const bool controllerHistoryAffectsTarget =
    cache.controllerHistoryDirty &&
    cache.controllerHistoryDirtyFrame >= 0 &&
    targetFrame >= cache.controllerHistoryDirtyFrame;
  const long dirtyStartFrame =
    controllerHistoryAffectsTarget ? cache.controllerHistoryDirtyFrame : -1;
  if (controllerHistoryAffectsTarget) {
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "controller-history-replay",
      instanceId,
      static_cast<PF_ParamIndex>(-1),
      targetFrame,
      "dirtyStartFrame=" + std::to_string(dirtyStartFrame)
    );
    InvalidateCachedHistoryFromFrame(
      &cache,
      static_cast<std::uint64_t>(renderCacheKey),
      dirtyStartFrame
    );
  }

  if (!cache.drawFn) {
    if (controllerHistoryAffectsTarget) {
      if (!source.has_value()) {
        source = ReadRuntimeSketchSource(bundle);
        if (!source.has_value()) {
          if (errorMessage) {
            *errorMessage = "No runtime sketch source found.";
          }
          return std::nullopt;
        }
      }

      ClearCachedBitmapFramePlansByKey(static_cast<std::uint64_t>(renderCacheKey));
      DisposeBitmapGpuStateByCacheKey(static_cast<std::uint64_t>(renderCacheKey), "controller-history-dirty");
      ResetCachedSketchState(&cache);
      if (!InitializeCachedSketchState(
        &cache,
        in_data,
        output,
        *source,
        bundle.sourceHash,
        bundle.debugTracePath,
        bundle.debugSessionId,
        bundle.controllerHash,
        NULL,
        bundle.pixelDensity,
        bundle.recentFrameBudgetBytes,
        bundle.checkpointInterval,
        effectiveRevision,
        errorMessage
      )) {
        return std::nullopt;
      }
    }

    const CachedSketchState::FrameSnapshot* staticSnapshot = FindFrameSnapshot(&cache, targetFrame);
    if (!staticSnapshot) {
      StoreFrameSnapshot(&cache, targetFrame, cache.latestScene);
      staticSnapshot = FindFrameSnapshot(&cache, targetFrame);
    }

    if (controllerHistoryAffectsTarget) {
      cache.controllerHistoryDirty = false;
      cache.controllerHistoryDirtyFrame = -1;
    }

    return cache.latestScene;
  }

  const CachedSketchState::FrameSnapshot* exactSnapshot = FindFrameSnapshot(&cache, targetFrame);
  const bool exactSnapshotCanReturn =
    exactSnapshot &&
    CachedControllerTimelineMatchesTarget(
      cache,
      invocationState->controllerTimelinePrefixHashes,
      targetFrame
    );
  if (exactSnapshotCanReturn) {
    // Exact-frame output is immutable. Do not restore its partial JSON state
    // into the live forward lane; that lane remains parked at its frontier.
    const double totalMs = std::chrono::duration<double, std::milli>(
      std::chrono::steady_clock::now() - executeStarted
    ).count();
    std::ostringstream timingDetail;
    timingDetail << std::fixed << std::setprecision(3)
      << "stage=evaluator cache=exact totalMs=" << totalMs
      << " target=" << targetFrame
      << " frontier=" << cache.lastFrame
      << " renderCache=" << renderCacheKey;
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "render-timing",
      instanceId,
      static_cast<PF_ParamIndex>(-1),
      targetFrame,
      timingDetail.str()
    );
    return exactSnapshot->scene;
  }

  const auto recordedScene = cache.frameScenes.find(targetFrame);
  const bool recordedSceneCanReturn =
    targetFrame < cache.lastFrame &&
    recordedScene != cache.frameScenes.end() &&
    CachedControllerTimelineMatchesTarget(
      cache,
      invocationState->controllerTimelinePrefixHashes,
      targetFrame
    );
  if (recordedSceneCanReturn) {
    // Immutable per-frame command history serves both render backends. Keep
    // the live JavaScript evaluator parked at its forward frontier.
    const double totalMs = std::chrono::duration<double, std::milli>(
      std::chrono::steady_clock::now() - executeStarted
    ).count();
    std::ostringstream timingDetail;
    timingDetail << std::fixed << std::setprecision(3)
      << "stage=evaluator cache=history totalMs=" << totalMs
      << " target=" << targetFrame
      << " frontier=" << cache.lastFrame
      << " renderCache=" << renderCacheKey;
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "render-timing",
      instanceId,
      static_cast<PF_ParamIndex>(-1),
      targetFrame,
      timingDetail.str()
    );
    return recordedScene->second;
  }

  const long windowEnd = targetFrame;
  const bool canAdvanceFromCurrent = controllerHistoryAffectsTarget
    ? false
    : targetFrame > cache.lastFrame;

  if (!canAdvanceFromCurrent) {
    if (!source.has_value()) {
      source = ReadRuntimeSketchSource(bundle);
      if (!source.has_value()) {
        if (errorMessage) {
          *errorMessage = "No runtime sketch source found.";
        }
        return std::nullopt;
      }
    }

    std::unordered_map<long, CachedSketchState::FrameSnapshot> preservedExactSnapshots = cache.exactSnapshots;
    std::vector<long> preservedExactOrder = cache.exactSnapshotOrder;
    std::unordered_map<long, ScenePayload> preservedFrameScenes = cache.frameScenes;
    std::unordered_map<long, std::uint64_t> preservedFrameTimelineHashes =
      cache.frameControllerTimelineHashes;

    ResetCachedSketchState(&cache);
    if (!InitializeCachedSketchState(
      &cache,
      in_data,
      output,
      *source,
      bundle.sourceHash,
      bundle.debugTracePath,
      bundle.debugSessionId,
      bundle.controllerHash,
      NULL,
      bundle.pixelDensity,
      bundle.recentFrameBudgetBytes,
      bundle.checkpointInterval,
      effectiveRevision,
      errorMessage
    )) {
      return std::nullopt;
    }

    for (const auto& entry : preservedExactSnapshots) {
      cache.exactSnapshots[entry.first] = entry.second;
    }
    MergeFrameOrder(&cache.exactSnapshotOrder, preservedExactOrder);

    for (const auto& entry : preservedFrameScenes) {
      cache.frameScenes[entry.first] = entry.second;
    }
    for (const auto& entry : preservedFrameTimelineHashes) {
      cache.frameControllerTimelineHashes[entry.first] = entry.second;
    }

  }

  const long advanceStartFrame = cache.lastFrame;
  const auto advanceStarted = std::chrono::steady_clock::now();
  if (!AdvanceCachedSketchState(
    &cache,
    in_data,
    output,
    windowEnd,
    shouldCancel,
    errorMessage
  )) {
    return std::nullopt;
  }
  const long firstHashFrame = std::max<long>(0, advanceStartFrame + 1);
  const long lastHashFrame = std::min<long>(
    targetFrame,
    static_cast<long>(invocationState->controllerTimelinePrefixHashes.size()) - 1
  );
  for (long frame = firstHashFrame; frame <= lastHashFrame; ++frame) {
    cache.frameControllerTimelineHashes[frame] =
      invocationState->controllerTimelinePrefixHashes[static_cast<std::size_t>(frame)];
  }
  const double advanceMs = std::chrono::duration<double, std::milli>(
    std::chrono::steady_clock::now() - advanceStarted
  ).count();

  exactSnapshot = FindFrameSnapshot(&cache, targetFrame);
  if (!exactSnapshot) {
    if (errorMessage) {
      *errorMessage = "Failed to materialize dense frame window.";
    }
    return std::nullopt;
  }

  if (controllerHistoryAffectsTarget) {
    cache.controllerHistoryDirty = false;
    cache.controllerHistoryDirtyFrame = -1;
  }

  const double totalMs = std::chrono::duration<double, std::milli>(
    std::chrono::steady_clock::now() - executeStarted
  ).count();
  std::ostringstream timingDetail;
  timingDetail << std::fixed << std::setprecision(3)
    << "stage=evaluator cache=advance totalMs=" << totalMs
    << " advanceMs=" << advanceMs
    << " from=" << advanceStartFrame
    << " target=" << targetFrame
    << " frames=" << std::max<long>(0, targetFrame - advanceStartFrame)
    << " renderCache=" << renderCacheKey;
  runtime_internal::AppendEffectRuntimeDiagnostic(
    in_data,
    "render-timing",
    instanceId,
    static_cast<PF_ParamIndex>(-1),
    targetFrame,
    timingDetail.str()
  );

  return exactSnapshot->scene;
}

bool BuildBitmapFramePlanAtCurrentTime(
  PF_InData* in_data,
  std::uintptr_t invocationKey,
  std::uintptr_t renderCacheKey,
  A_long revision,
  A_long instanceId,
  PF_LayerDef* output,
  BitmapFramePlan* outPlan,
  std::string* errorMessage
) {
  if (!output || !outPlan) {
    if (errorMessage) {
      *errorMessage = "Bitmap frame plan request is missing an output surface.";
    }
    return false;
  }

  const std::uintptr_t cacheKeyPtr = renderCacheKey;
  const std::uint64_t cacheKey = static_cast<std::uint64_t>(cacheKeyPtr);
  const auto runtimeState = ResolveEffectRuntimeState(cacheKeyPtr, true);
  if (!runtimeState) {
    if (errorMessage) {
      *errorMessage = "Could not resolve Effect-local runtime state for Bitmap planning.";
    }
    return false;
  }
  const std::lock_guard<std::recursive_mutex> lock(runtimeState->mutex);
  long targetFrame = 0;
  const auto scene = ExecuteSketchAtCurrentTime(
    in_data,
    invocationKey,
    renderCacheKey,
    revision,
    instanceId,
    output,
    &targetFrame,
    std::function<bool()>(),
    errorMessage
  );
  if (!scene.has_value()) {
    return false;
  }

  CachedSketchState& cache = runtimeState->sketch;
  if (!cache.valid) {
    if (errorMessage) {
      *errorMessage = "Missing cached sketch state for Bitmap planning.";
    }
    return false;
  }
  PF_LayerDef planSurface = *output;

  auto collectScenes = [&](long firstFrame, long lastFrame, std::vector<std::pair<long, ScenePayload>>* outScenes) -> bool {
    if (!outScenes || firstFrame > lastFrame) {
      return true;
    }
    outScenes->clear();
    outScenes->reserve(static_cast<std::size_t>(lastFrame - firstFrame + 1));
    for (long frame = firstFrame; frame <= lastFrame; ++frame) {
      const auto frameScene = cache.frameScenes.find(frame);
      if (frameScene == cache.frameScenes.end()) {
        return false;
      }
      outScenes->push_back(std::make_pair(frame, frameScene->second));
    }
    return true;
  };

  std::vector<std::pair<long, ScenePayload>> scenes;
  std::string planMode = "stateful-replay";
  std::string planSeed = "none";
  bool planHasSeedGpuCheckpoint = false;
  long planSeedFrame = 0;
  bool planUsesRecoveryCanvas = false;
  bool planHasPreferredRecoveryCursor = false;
  long planPreferredRecoveryFrame = 0;
  bool planResolved = false;

  long canvasLastFrame = 0;
  bool canvasInitialized = false;
  const bool haveCanvasCursor = QueryBitmapGpuCanvasCursor(cacheKey, &canvasLastFrame, &canvasInitialized);
  long recoveryLastFrame = 0;
  bool recoveryInitialized = false;
  const bool haveRecoveryCursor = QueryBitmapGpuRecoveryCanvasCursor(
    cacheKey,
    &recoveryLastFrame,
    &recoveryInitialized
  );

  const bool canAppendFromCanvas = !planResolved &&
    haveCanvasCursor && canvasInitialized &&
    canvasLastFrame >= 0 && canvasLastFrame <= targetFrame;
  if (canAppendFromCanvas) {
    const long firstAppendFrame = canvasLastFrame + 1;
    if (firstAppendFrame <= targetFrame && collectScenes(firstAppendFrame, targetFrame, &scenes)) {
      planMode = "stateful-append";
      planResolved = true;
    } else if (firstAppendFrame > targetFrame) {
      planMode = "stateful-reuse-playback-canvas";
      planResolved = true;
    }
  }

  const bool playbackIsAhead =
    haveCanvasCursor && canvasInitialized && canvasLastFrame > targetFrame;
  const bool canAppendFromRecovery =
    playbackIsAhead &&
    haveRecoveryCursor && recoveryInitialized &&
    recoveryLastFrame >= 0 && recoveryLastFrame <= targetFrame;

  if (!planResolved) {
    long checkpointFrame = -1;
    if (QueryBitmapGpuNearestCheckpoint(cacheKey, targetFrame, &checkpointFrame) &&
        checkpointFrame >= 0 &&
        checkpointFrame <= targetFrame &&
        collectScenes(checkpointFrame + 1, targetFrame, &scenes)) {
      planHasSeedGpuCheckpoint = true;
      planSeedFrame = checkpointFrame;
      planUsesRecoveryCanvas = true;
      // The draw operations start at the checkpoint, so they remain a complete
      // fallback. Metal may skip the earlier operations only when the recovery
      // canvas still has the exact cursor observed during planning.
      if (canAppendFromRecovery && recoveryLastFrame >= checkpointFrame) {
        planHasPreferredRecoveryCursor = true;
        planPreferredRecoveryFrame = recoveryLastFrame;
        planMode = "stateful-recovery-preferred-with-checkpoint";
      } else {
        planMode = "stateful-gpu-checkpoint-replay";
      }
      planSeed = std::to_string(checkpointFrame);
      planResolved = true;
    }
  }

  if (!planResolved) {
    const long fullReplayStartFrame = cache.frameScenes.find(0) != cache.frameScenes.end() ? 0L : 1L;
    if (!collectScenes(fullReplayStartFrame, targetFrame, &scenes)) {
      if (errorMessage) {
        *errorMessage = "The shared frame lane is missing a frame delta; a reliable rebuild is required.";
      }
      return false;
    } else {
      planUsesRecoveryCanvas = playbackIsAhead;
      if (canAppendFromRecovery) {
        // With no retained checkpoint, keep the full operation range in the
        // plan. It is the correctness fallback if another AE render advances
        // the recovery canvas before this plan reaches Metal.
        planHasPreferredRecoveryCursor = true;
        planPreferredRecoveryFrame = recoveryLastFrame;
        planUsesRecoveryCanvas = true;
        planMode = "stateful-recovery-preferred-with-full-fallback";
      } else {
        planMode = "stateful-full-replay";
      }
      planResolved = true;
    }
  }

  const bool planOk = BuildBitmapFramePlanWithPlanCache(
    &planSurface,
    cacheKey,
    targetFrame,
    scenes,
    outPlan,
    errorMessage
  );
  if (planOk && outPlan) {
    const bool startsAtHistoryReset =
      !outPlan->operations.empty() &&
      outPlan->operations.front().drawPlan.resetsHistory;
    if (startsAtHistoryReset) {
      planHasSeedGpuCheckpoint = false;
      planUsesRecoveryCanvas = false;
      planHasPreferredRecoveryCursor = false;
      planMode = "history-reset-barrier";
      planSeed = "none";
    }
    outPlan->logicalWidth = output->width;
    outPlan->logicalHeight = output->height;
    outPlan->checkpointInterval = cache.checkpointInterval;
    outPlan->hasSeedGpuCheckpoint = planHasSeedGpuCheckpoint;
    outPlan->seedFrame = outPlan->hasSeedGpuCheckpoint ? planSeedFrame : 0;
    outPlan->useRecoveryCanvas = planUsesRecoveryCanvas;
    outPlan->hasPreferredRecoveryCursor = planHasPreferredRecoveryCursor;
    outPlan->preferredRecoveryFrame = planHasPreferredRecoveryCursor
      ? planPreferredRecoveryFrame
      : 0;
    std::ostringstream planningDetail;
    planningDetail
      << "stage=planner mode=" << planMode
      << " target=" << targetFrame
      << " ops=" << outPlan->operations.size()
      << " seed=" << planSeed
      << " preferredRecovery="
      << (planHasPreferredRecoveryCursor
        ? std::to_string(planPreferredRecoveryFrame)
        : "none")
      << " playback=" << (canvasInitialized ? std::to_string(canvasLastFrame) : "none")
      << " recovery=" << (recoveryInitialized ? std::to_string(recoveryLastFrame) : "none")
      << " renderCache=" << renderCacheKey;
    runtime_internal::AppendEffectRuntimeDiagnostic(
      in_data,
      "render-timing",
      instanceId,
      static_cast<PF_ParamIndex>(-1),
      targetFrame,
      planningDetail.str()
    );
  }
  return planOk;
}

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
) {
  if (!output || !outPlan) {
    if (errorMessage) {
      *errorMessage = "Bitmap CPU frame plan request is missing an output surface.";
    }
    return false;
  }
  auto cancelled = [&]() {
    return shouldCancel && shouldCancel();
  };
  if (cancelled()) {
    if (errorMessage) {
      *errorMessage = "render-cancelled";
    }
    return false;
  }

  const std::uint64_t cacheKey = static_cast<std::uint64_t>(renderCacheKey);
  const auto runtimeState = ResolveEffectRuntimeState(renderCacheKey, true);
  if (!runtimeState) {
    if (errorMessage) {
      *errorMessage = "Could not resolve Effect-local runtime state for CPU planning.";
    }
    return false;
  }
  const std::lock_guard<std::recursive_mutex> lock(runtimeState->mutex);
  long targetFrame = 0;
  const auto scene = ExecuteSketchAtCurrentTime(
    in_data,
    invocationKey,
    renderCacheKey,
    revision,
    instanceId,
    output,
    &targetFrame,
    shouldCancel,
    errorMessage
  );
  if (!scene.has_value() || cancelled()) {
    if (cancelled() && errorMessage) {
      *errorMessage = "render-cancelled";
    }
    return false;
  }

  CachedSketchState& cache = runtimeState->sketch;
  if (!cache.valid) {
    if (errorMessage) {
      *errorMessage = "Missing cached sketch state for bitmap CPU planning.";
    }
    return false;
  }

  PF_LayerDef planSurface = *output;
  std::vector<std::pair<long, ScenePayload>> scenes;
  scenes.push_back(std::make_pair(targetFrame, *scene));
  BitmapFramePlan targetOnlyPlan;
  if (!BuildBitmapFramePlanWithPlanCache(
        &planSurface,
        cacheKey,
        targetFrame,
        scenes,
        &targetOnlyPlan,
        errorMessage
      )) {
    return false;
  }

  std::string planMode = "history-reset-barrier";
  const bool targetResetsHistory =
    !targetOnlyPlan.operations.empty() &&
    targetOnlyPlan.operations.front().drawPlan.resetsHistory;
  if (targetResetsHistory) {
    *outPlan = std::move(targetOnlyPlan);
  } else {
    planMode = "stateful-full-replay";
    const long firstFrame = cache.frameScenes.find(0) != cache.frameScenes.end() ? 0L : 1L;
    scenes.clear();
    scenes.reserve(static_cast<std::size_t>(std::max<long>(0, targetFrame - firstFrame + 1)));
    for (long frame = firstFrame; frame <= targetFrame; ++frame) {
      if (cancelled()) {
        if (errorMessage) {
          *errorMessage = "render-cancelled";
        }
        return false;
      }
      const auto frameScene = cache.frameScenes.find(frame);
      if (frameScene == cache.frameScenes.end()) {
        if (errorMessage) {
          *errorMessage = "The shared frame lane is missing a frame delta required for CPU replay.";
        }
        return false;
      }
      scenes.push_back(std::make_pair(frame, frameScene->second));
    }
    if (!BuildBitmapFramePlanWithPlanCache(
          &planSurface,
          cacheKey,
          targetFrame,
          scenes,
          outPlan,
          errorMessage
        )) {
      return false;
    }
  }

  outPlan->logicalWidth = output->width;
  outPlan->logicalHeight = output->height;
  outPlan->checkpointInterval = cache.checkpointInterval;
  outPlan->hasSeedGpuCheckpoint = false;
  outPlan->seedFrame = 0;
  outPlan->useRecoveryCanvas = false;
  outPlan->hasPreferredRecoveryCursor = false;
  outPlan->preferredRecoveryFrame = 0;

  std::ostringstream planningDetail;
  planningDetail
    << "stage=planner backend=cpu mode=" << planMode
    << " target=" << targetFrame
    << " ops=" << outPlan->operations.size()
    << " renderCache=" << renderCacheKey;
  runtime_internal::AppendEffectRuntimeDiagnostic(
    in_data,
    "render-timing",
    instanceId,
    static_cast<PF_ParamIndex>(-1),
    targetFrame,
    planningDetail.str()
  );
  return true;
}

}  // namespace momentum
