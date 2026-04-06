#include "runtime_core.h"
#include "runtime_internal.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <mutex>
#include <optional>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

#include "../api/api_internal.h"
#include "../cache/frame_cache.h"
#include "../gpu/bitmap_gpu_backend.h"
#include "../gpu/bitmap_gpu_plan.h"
#include "../render/render_core.h"

namespace momentum {

thread_local JsHostRuntime* g_activeRuntime = NULL;

namespace {

using runtime_internal::CallFunction;
using runtime_internal::CaptureRuntimeState;
using runtime_internal::EvaluateScript;
using runtime_internal::GetBindingValue;
using runtime_internal::GetCompTimeSeconds;
using runtime_internal::GetEffectCacheKey;
using runtime_internal::GetFrameRate;
using runtime_internal::IsDirectTimeProfile;
using runtime_internal::IsOpaqueBackgroundProfile;
using runtime_internal::BuildBindingRegistrationScript;
using runtime_internal::ExtractTopLevelBindings;
using runtime_internal::ReadRuntimeSketchBundle;
using runtime_internal::ReadRuntimeSketchSource;
using runtime_internal::ReadTextFile;
using runtime_internal::RestoreRuntimeState;

void ResetCachedSketchState(CachedSketchState* cache);
void ClearCachedGpuFramePlansByKey(std::uint64_t cacheKey);

std::unordered_map<std::uintptr_t, CachedSketchState> g_cachedSketches;
std::unordered_map<std::uint64_t, std::unordered_map<long, GpuRenderPlan>> g_cachedGpuFramePlans;
std::unordered_map<std::uintptr_t, ControllerPoolState> g_liveControllerStates;
std::recursive_mutex gSketchRuntimeMutex;
std::mutex gLiveControllerStateMutex;
void AppendColorTraceLine(const std::string& line);

ControllerColorValue ResolveColorControllerValue(
  PF_InData* in_data,
  const PF_ParamDef* colorParam
) {
  ControllerColorValue color;
  if (!in_data || !colorParam || !colorParam->u.arb_d.value) {
    return color;
  }
  ControllerColorValue* data =
    reinterpret_cast<ControllerColorValue*>(PF_LOCK_HANDLE(colorParam->u.arb_d.value));
  if (!data) {
    return color;
  }
  color = *data;
  AppendColorTraceLine(
    "phase=runtime_read_color_arb"
    " r=" + std::to_string(color.r) +
    " g=" + std::to_string(color.g) +
    " b=" + std::to_string(color.b) +
    " a=" + std::to_string(color.a)
  );
  PF_UNLOCK_HANDLE(colorParam->u.arb_d.value);
  return color;
}

std::string GetColorTraceLogPath() {
  return runtime_internal::GetRuntimeDirectoryPath() + "/color_trace.log";
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

unsigned long long HashBytes(const void* data, std::size_t size) {
  const unsigned char* bytes = static_cast<const unsigned char*>(data);
  unsigned long long hash = 1469598103934665603ULL;
  for (std::size_t index = 0; index < size; index += 1) {
    hash ^= static_cast<unsigned long long>(bytes[index]);
    hash *= 1099511628211ULL;
  }
  return hash;
}

unsigned long long HashString(const std::string& value) {
  return HashBytes(value.data(), value.size());
}

unsigned long long HashRasterSample(const std::vector<PF_Pixel>& raster) {
  if (raster.empty()) {
    return 0ULL;
  }

  const std::size_t sampleCount = std::min<std::size_t>(raster.size(), 2048);
  return HashBytes(raster.data(), sampleCount * sizeof(PF_Pixel));
}

std::string CaptureDebugSample(CachedSketchState* cache) {
  (void)cache;
  return std::string();
}

void SetExecutionTrace(std::uintptr_t cacheKey, const std::string& trace) {
  (void)cacheKey;
  (void)trace;
}

void SetExecutionTrace(const std::string& trace) {
  (void)trace;
}

std::string SummarizeScenePayload(const ScenePayload& scene) {
  std::ostringstream stream;
  stream
    << "cmds=" << scene.commands.size()
    << ",assets=" << scene.imageAssets.size()
    << ",bg=" << (scene.hasBackground ? 1 : 0)
    << ",bga=" << static_cast<int>(scene.background.alpha)
    << ",clear=" << (scene.clearsSurface ? 1 : 0);
  if (!scene.commands.empty()) {
    stream
      << ",first=" << scene.commands.front().type
      << ",last=" << scene.commands.back().type;
  }
  if (scene.commands.size() == 1 && scene.commands.front().type == "text") {
    std::string text = scene.commands.front().text;
    for (char& ch : text) {
      if (std::isspace(static_cast<unsigned char>(ch))) {
        ch = ' ';
      }
    }
    if (text.size() > 96) {
      text.resize(96);
      text.append("...");
    }
    stream << ",text=" << text;
  }
  return stream.str();
}

std::string SummarizeGpuDrawPlan(const GpuRenderPlan& plan) {
  std::ostringstream stream;
  stream
    << "clear=" << (plan.clearsSurface ? 1 : 0)
    << ",ca=" << static_cast<int>(plan.clearColor.alpha)
    << ",fills=" << plan.fillTriangles.size()
    << ",paths=" << plan.pathFills.size()
    << ",images=" << plan.imageDraws.size()
    << ",filters=" << plan.filterPasses.size()
    << ",masks=" << plan.maskPasses.size();
  return stream.str();
}

void ClearCachedGpuFramePlansByKey(std::uint64_t cacheKey) {
  const std::lock_guard<std::recursive_mutex> lock(gSketchRuntimeMutex);
  g_cachedGpuFramePlans.erase(cacheKey);
}

void ClearAllCachedGpuFramePlans() {
  const std::lock_guard<std::recursive_mutex> lock(gSketchRuntimeMutex);
  g_cachedGpuFramePlans.clear();
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

  for (auto it = cache->checkpointSnapshots.begin(); it != cache->checkpointSnapshots.end();) {
    if (it->first >= frameThreshold) {
      it = cache->checkpointSnapshots.erase(it);
    } else {
      ++it;
    }
  }
  RemoveFramesFromOrder(&cache->checkpointOrder, frameThreshold);

  for (auto it = cache->gpuFrameScenes.begin(); it != cache->gpuFrameScenes.end();) {
    if (it->first >= frameThreshold) {
      it = cache->gpuFrameScenes.erase(it);
    } else {
      ++it;
    }
  }

  ClearCachedGpuFramePlansByKey(cacheKey);
  DisposeBitmapGpuStateByCacheKey(cacheKey, "controller-history-dirty");
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

bool IsValidRawSelectControllerValue(
  int rawValue,
  const RuntimeSelectControllerSpec& config
) {
  const int optionCount = std::max<int>(1, static_cast<int>(config.options.size()));
  return rawValue >= 1 && rawValue <= optionCount;
}

const RuntimeControllerSlotSpec* FindControllerSlotSpec(
  const RuntimeSketchBundle& bundle,
  int logicalSlot
) {
  if (logicalSlot < 0 || static_cast<std::size_t>(logicalSlot) >= bundle.controllerSlots.size()) {
    return NULL;
  }
  return &bundle.controllerSlots[static_cast<std::size_t>(logicalSlot)];
}

RuntimeControllerSlotKind ResolveControllerSlotKind(
  const RuntimeSketchBundle& bundle,
  int logicalSlot
) {
  const RuntimeControllerSlotSpec* slotSpec = FindControllerSlotSpec(bundle, logicalSlot);
  return slotSpec ? slotSpec->kind : RuntimeControllerSlotKind::kNone;
}

double FixedToDouble(PF_Fixed value) {
  return static_cast<double>(value) / 65536.0;
}

double ClampAndSnapSliderValue(double value, const RuntimeSliderControllerSpec& config) {
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

RuntimeSliderControllerSpec ResolveSliderControllerSpecWithDefaults(
  const RuntimeSketchBundle& bundle,
  int logicalSlot
) {
  RuntimeSliderControllerSpec config;
  const RuntimeControllerSlotSpec* slotSpec = FindControllerSlotSpec(bundle, logicalSlot);
  if (!slotSpec || slotSpec->kind != RuntimeControllerSlotKind::kSlider) {
    return config;
  }
  config = slotSpec->slider;
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
  int logicalSlot
) {
  RuntimeSelectControllerSpec config;
  const RuntimeControllerSlotSpec* slotSpec = FindControllerSlotSpec(bundle, logicalSlot);
  if (!slotSpec || slotSpec->kind != RuntimeControllerSlotKind::kSelect) {
    return config;
  }
  config = slotSpec->select;
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

std::uintptr_t ResolveControllerLiveStateCacheKey(
  PF_InData* in_data,
  A_long instanceId
) {
  if (instanceId > 0) {
    return static_cast<std::uintptr_t>(static_cast<std::uint64_t>(instanceId));
  }
  return GetEffectCacheKey(in_data);
}

bool CheckoutControllerStateAtTime(
  PF_InData* in_data,
  A_long instanceId,
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
  const RuntimeSketchBundle bundle = runtime_internal::ReadRuntimeSketchBundleForEffect(
    in_data,
    0,
    NULL
  );
  ControllerPoolState liveOverrideState;
  const bool hasLiveOverride =
    GetLiveControllerState(
      ResolveControllerLiveStateCacheKey(in_data, instanceId),
      &liveOverrideState
    );
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
    const RuntimeControllerSlotKind kind = ResolveControllerSlotKind(bundle, logicalSlot);
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
        if (hasLiveOverride) {
          outState->colors[static_cast<std::size_t>(colorSlot)] =
            liveOverrideState.colors[static_cast<std::size_t>(colorSlot)];
        } else {
          PF_ParamDef colorParam;
          if (!checkoutParam(ControllerColorValueParamIndex(logicalSlot), timeValue, &colorParam)) {
            return false;
          }
          outState->colors[static_cast<std::size_t>(colorSlot)] =
            ResolveColorControllerValue(in_data, &colorParam);
          PF_CHECKIN_PARAM(in_data, &colorParam);
        }
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
          ResolveSliderControllerSpecWithDefaults(bundle, logicalSlot);
        outState->sliders[static_cast<std::size_t>(sliderSlot)].value =
          ClampAndSnapSliderValue(param.u.fs_d.value, config);
      }
      sliderSlot += 1;
    } else if (kind == RuntimeControllerSlotKind::kAngle) {
      if (angleSlot < kControllerAngleSlotCount) {
        outState->angles[static_cast<std::size_t>(angleSlot)].degrees =
          hasLiveOverride
            ? liveOverrideState.angles[static_cast<std::size_t>(angleSlot)].degrees
            : static_cast<double>(param.u.fs_d.value);
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
          ResolveSelectControllerSpecWithDefaults(bundle, logicalSlot);
        int clampedIndex = 0;
        if (hasLiveOverride) {
          // AE popup checkout is not reliable enough for select controllers across
          // test/revision switches, so prefer the instance-scoped live snapshot
          // whenever the UI thread has one.
          clampedIndex = ClampSelectControllerIndex(
            liveOverrideState.selects[static_cast<std::size_t>(selectSlot)].index,
            config
          );
        } else {
          int rawValue = static_cast<int>(param.u.pd.value);
          // AE popup params sometimes come back as 0 during smart-render historical checkout.
          // When that happens, retry at the live comp time so non-animated selects still reflect
          // the user's current controller choice instead of snapping back to the default frame.
          if (!IsValidRawSelectControllerValue(rawValue, config) &&
              in_data->current_time != timeValue) {
            PF_ParamDef currentTimeParam;
            if (checkoutParam(paramIndex, in_data->current_time, &currentTimeParam, false)) {
              const int currentTimeRawValue = static_cast<int>(currentTimeParam.u.pd.value);
              if (IsValidRawSelectControllerValue(currentTimeRawValue, config)) {
                rawValue = currentTimeRawValue;
              }
              PF_CHECKIN_PARAM(in_data, &currentTimeParam);
            }
          }
          clampedIndex = ClampSelectControllerIndex(rawValue - 1, config);
        }
        outState->selects[static_cast<std::size_t>(selectSlot)].index = clampedIndex;
      }
      selectSlot += 1;
    } else if (kind == RuntimeControllerSlotKind::kPoint) {
      if (pointSlot < kControllerPointSlotCount) {
        ControllerPointValue& point = outState->points[static_cast<std::size_t>(pointSlot)];
        point.x = FixedToDouble(param.u.td.x_value);
        point.y = FixedToDouble(param.u.td.y_value);
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
  A_long instanceId,
  long frame,
  double simulationFrameRate,
  ControllerPoolState* outState,
  std::string* errorMessage
) {
  const A_long timeValue =
    SketchFrameToTimeValue(frame, simulationFrameRate, in_data ? in_data->time_scale : 0);
  return CheckoutControllerStateAtTime(
    in_data,
    instanceId,
    timeValue,
    outState,
    errorMessage
  );
}

long ResolveControllerHistoryStartFrameForStateMismatch(
  PF_InData* in_data,
  A_long instanceId,
  const ControllerPoolState& cachedState,
  const ControllerPoolState& liveState
) {
  if (!in_data) {
    return 0;
  }

  const double frameRate = ResolveSketchSimulationFrameRate(in_data, instanceId);
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

  const RuntimeSketchBundle bundle = runtime_internal::ReadRuntimeSketchBundleForEffect(
    in_data,
    0,
    NULL
  );
  bool foundMismatchingSlot = false;
  long earliestDirtyFrame = 0;
  int sliderSlot = 0;
  int angleSlot = 0;
  int colorSlot = 0;
  int checkboxSlot = 0;
  int selectSlot = 0;
  int pointSlot = 0;
  for (int logicalSlot = 0; logicalSlot < kControllerSlotCount; ++logicalSlot) {
    const RuntimeControllerSlotKind kind = ResolveControllerSlotKind(bundle, logicalSlot);
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
  A_long instanceId,
  std::uintptr_t cacheKey,
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

  const double simulationFrameRate = ResolveSketchSimulationFrameRate(in_data, instanceId);
  ControllerPoolState liveState;
  if (!CheckoutControllerStateForSketchFrame(
        in_data,
        instanceId,
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
    instanceId,
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

A_long ScaleRenderDimension(A_long logicalSize, double scale) {
  if (!(scale > 0.0) || std::fabs(scale - 1.0) <= 1e-6) {
    return std::max<A_long>(1, logicalSize);
  }
  return std::max<A_long>(
    1,
    static_cast<A_long>(std::lround(static_cast<double>(logicalSize) * scale))
  );
}

bool BuildBitmapFramePlanWithoutPlanCache(
  PF_LayerDef* output,
  BitmapGpuExecutionProfile profile,
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
  framePlan.profile = profile;
  framePlan.cacheKey = cacheKey;
  framePlan.targetFrame = targetFrame;
  framePlan.width = output->width;
  framePlan.height = output->height;
  framePlan.logicalWidth = output->width;
  framePlan.logicalHeight = output->height;
  for (std::size_t index = 0; index < scenes.size(); index += 1) {
    BitmapFramePlanOp op;
    op.frame = scenes[index].first;
    if (!BuildBitmapGpuPlan(
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
          : "GPU bitmap v2 does not support one or more commands in this sketch.";
      *outPlan = framePlan;
      return false;
    }
    framePlan.operations.push_back(op);
  }

  *outPlan = framePlan;
  return true;
}

bool BuildBitmapFramePlanWithPlanCache(
  PF_LayerDef* output,
  BitmapGpuExecutionProfile profile,
  std::uint64_t cacheKey,
  long targetFrame,
  const std::vector<std::pair<long, ScenePayload>>& scenes,
  BitmapFramePlan* outPlan,
  std::string* errorMessage
) {
  const std::lock_guard<std::recursive_mutex> lock(gSketchRuntimeMutex);
  if (!output || !outPlan) {
    if (errorMessage) {
      *errorMessage = "Bitmap frame plan request is missing an output target.";
    }
    return false;
  }

  BitmapFramePlan framePlan;
  framePlan.profile = profile;
  framePlan.cacheKey = cacheKey;
  framePlan.targetFrame = targetFrame;
  framePlan.width = output->width;
  framePlan.height = output->height;
  framePlan.logicalWidth = output->width;
  framePlan.logicalHeight = output->height;
  auto& planCache = g_cachedGpuFramePlans[cacheKey];
  for (std::size_t index = 0; index < scenes.size(); index += 1) {
    BitmapFramePlanOp op;
    op.frame = scenes[index].first;

    const auto cachedPlan = planCache.find(op.frame);
    if (cachedPlan != planCache.end()) {
      op.drawPlan = cachedPlan->second;
    } else {
      if (!BuildBitmapGpuPlan(
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
            : "GPU bitmap v2 does not support one or more commands in this sketch.";
        *outPlan = framePlan;
        return false;
      }
      planCache[op.frame] = op.drawPlan;
    }

    framePlan.operations.push_back(op);
  }

  *outPlan = framePlan;
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

bool RestoreFrameSnapshot(
  CachedSketchState* cache,
  const CachedSketchState::FrameSnapshot& snapshot,
  std::string* errorMessage
) {
  if (!cache) {
    return false;
  }

  if (!snapshot.runtimeStateJson.empty()) {
    if (!RestoreRuntimeState(cache->context, snapshot.runtimeStateJson, errorMessage)) {
      return false;
    }
  }

  if (snapshot.hasEngineState) {
    RestoreRuntimeEngineState(&cache->runtime, snapshot.engineState);
  }

  cache->raster = snapshot.raster;
  cache->latestScene = snapshot.scene;
  cache->latestSceneIsAccumulated = snapshot.sceneIsAccumulated;
  cache->runtime.scene = snapshot.scene;
  cache->lastFrame = snapshot.frame;
  cache->simulatedFrame = snapshot.frame;
  if (snapshot.hasControllerState) {
    cache->controllerState = snapshot.controllerState;
    cache->controllerStateHash = snapshot.controllerState.stateHash;
    cache->hasControllerState = true;
  }
  return true;
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
  const ScenePayload& scene,
  bool sceneIsAccumulated,
  const std::vector<PF_Pixel>& raster,
  bool captureRuntimeState
) {
  if (!cache) {
    return;
  }

  CachedSketchState::FrameSnapshot exactSnapshot;
  exactSnapshot.frame = frame;
  exactSnapshot.scene = scene;
  exactSnapshot.sceneIsAccumulated = sceneIsAccumulated;
  exactSnapshot.raster = raster;
  exactSnapshot.controllerState = cache->controllerState;
  exactSnapshot.hasControllerState = cache->hasControllerState;
  exactSnapshot.engineState = CaptureRuntimeEngineState(cache->runtime);
  exactSnapshot.hasEngineState = true;
  if (captureRuntimeState) {
    std::string captureError;
    const auto captured = cache->context ? CaptureRuntimeState(cache->context, &captureError) : std::nullopt;
    if (captured.has_value()) {
      exactSnapshot.runtimeStateJson = *captured;
      CachedSketchState::FrameSnapshot checkpointSnapshot = exactSnapshot;
      cache->checkpointSnapshots[frame] = checkpointSnapshot;

      auto existingCheckpoint = std::find(cache->checkpointOrder.begin(), cache->checkpointOrder.end(), frame);
      if (existingCheckpoint != cache->checkpointOrder.end()) {
        cache->checkpointOrder.erase(existingCheckpoint);
      }
      cache->checkpointOrder.push_back(frame);
      EnforceCheckpointBudget(cache);
    }
  }

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
  PF_InData* in_data,
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
  cache->latestSceneIsAccumulated = true;
  cache->runtime = JsHostRuntime();
  cache->raster.clear();
  cache->source.clear();
  cache->sourceHash.clear();
  cache->controllerHash.clear();
  cache->controllerStateHash.clear();
  cache->controllerState = ControllerPoolState();
  cache->hasControllerState = false;
  cache->revision = -1;
  cache->frameCacheBudgetBytes = kDefaultRecentFrameBudgetBytes;
  cache->checkpointInterval = 12;
  cache->denseWindowBacktrack = kDefaultDenseWindowBacktrack;
  cache->denseWindowForward = kDefaultDenseWindowForward;
  cache->outputWidth = 0;
  cache->outputHeight = 0;
  cache->lastFrame = 0;
  cache->simulatedFrame = 0;
  cache->controllerHistoryDirty = false;
  cache->controllerHistoryDirtyFrame = -1;
  cache->valid = false;
  cache->exactSnapshots.clear();
  cache->exactSnapshotOrder.clear();
  cache->checkpointSnapshots.clear();
  cache->checkpointOrder.clear();
  cache->gpuFrameScenes.clear();
}

bool InitializeCachedSketchState(
  CachedSketchState* cache,
  PF_InData* in_data,
  A_long instanceId,
  PF_LayerDef* output,
  const std::string& source,
  const std::string& sourceHash,
  const std::string& debugTracePath,
  const std::string& debugSessionId,
  const std::string& controllerHash,
  const std::string& controllerStateHash,
  const ControllerPoolState* controllerState,
  double pixelDensity,
  std::size_t frameCacheBudgetBytes,
  long checkpointInterval,
  long denseWindowBacktrack,
  long denseWindowForward,
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
  cache->denseWindowBacktrack = ClampPositiveLong(denseWindowBacktrack, kDefaultDenseWindowBacktrack);
  cache->denseWindowForward = ClampPositiveLong(denseWindowForward, kDefaultDenseWindowForward);
  cache->outputWidth = output->width;
  cache->outputHeight = output->height;
  cache->raster.assign(static_cast<std::size_t>(output->width * output->height), PF_Pixel{0, 0, 0, 0});
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
        instanceId,
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

  ApplySceneToRaster8(&cache->raster, output->width, output->height, cache->runtime.scene);

  if (drawFn && !JSValueIsNull(cache->context, drawFn) && !JSValueIsUndefined(cache->context, drawFn)) {
    cache->drawFn = drawFn;
    JSValueProtect(cache->context, cache->drawFn);
  }

  cache->latestScene = cache->runtime.scene;
  cache->latestSceneIsAccumulated = true;
  cache->lastFrame = 0;
  cache->simulatedFrame = 0;
  cache->valid = true;
  cache->gpuFrameScenes[0] = cache->latestScene;
  StoreFrameSnapshot(cache, 0, cache->latestScene, true, cache->raster, true);
  return true;
}

double GetSimulationFrameRate(const CachedSketchState& cache, PF_InData* in_data) {
  return cache.runtime.desiredFrameRate > 0.0 ? cache.runtime.desiredFrameRate : GetFrameRate(in_data);
}

ScenePayload AppendScenePayload(const ScenePayload& base, const ScenePayload& overlay) {
  ScenePayload combined = base;
  if (overlay.canvasWidth > 0.0) {
    combined.canvasWidth = overlay.canvasWidth;
  }
  if (overlay.canvasHeight > 0.0) {
    combined.canvasHeight = overlay.canvasHeight;
  }
  for (const auto& entry : overlay.imageAssets) {
    combined.imageAssets[entry.first] = entry.second;
  }
  combined.commands.insert(
    combined.commands.end(),
    overlay.commands.begin(),
    overlay.commands.end()
  );
  return combined;
}

bool ScenePayloadIsEmpty(const ScenePayload& scene) {
  return !scene.hasBackground &&
    !scene.clearsSurface &&
    scene.commands.empty() &&
    scene.imageAssets.empty();
}

bool TrimBitmapPlanScenesAfterLastFullClear(
  std::vector<std::pair<long, ScenePayload>>* scenes,
  long* outTrimmedFirstFrame
) {
  if (!scenes || scenes->size() <= 1) {
    return false;
  }

  std::size_t trimStartIndex = 0;
  bool foundFullClear = false;
  for (std::size_t index = 0; index < scenes->size(); index += 1) {
    if (SceneFullyClearsSurface((*scenes)[index].second)) {
      trimStartIndex = index;
      foundFullClear = true;
    }
  }

  if (!foundFullClear || trimStartIndex == 0) {
    return false;
  }

  if (outTrimmedFirstFrame) {
    *outTrimmedFirstFrame = (*scenes)[trimStartIndex].first;
  }
  scenes->erase(scenes->begin(), scenes->begin() + static_cast<std::ptrdiff_t>(trimStartIndex));
  return true;
}

bool AdvanceCachedSketchState(
  CachedSketchState* cache,
  PF_InData* in_data,
  A_long instanceId,
  PF_LayerDef* output,
  long targetFrame,
  bool requireRaster,
  bool gpuPrimaryExecution,
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
    cache->latestSceneIsAccumulated = true;
    cache->simulatedFrame = cache->lastFrame;
    return true;
  }

  const double simulationFrameRate = GetSimulationFrameRate(*cache, in_data);
  JSObjectRef globalObject = JSContextGetGlobalObject(cache->context);

  for (long frame = cache->simulatedFrame + 1; frame <= targetFrame; ++frame) {
    const std::string previousControllerStateHash = cache->controllerStateHash;
    const bool hadPreviousControllerState = cache->hasControllerState;
    ControllerPoolState frameControllerState;
    if (!CheckoutControllerStateForSketchFrame(
          in_data,
          instanceId,
          frame,
          simulationFrameRate,
          &frameControllerState,
          errorMessage
        )) {
      return false;
    }
    const bool shouldCaptureRaster =
      requireRaster ||
      (!gpuPrimaryExecution &&
        (frame == 0 || (cache->checkpointInterval > 0 && (frame % cache->checkpointInterval) == 0)));
    std::vector<PF_Pixel> snapshotRaster;
    const ScenePayload priorCommittedScene = cache->latestScene;
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

    ScenePayload frameScene = cache->runtime.scene;
    if (hadPreviousControllerState &&
        previousControllerStateHash != frameControllerState.stateHash) {
      ScenePayload settledScene;
      if (!BuildSettledDisplaySceneForFrame(
            cache,
            in_data,
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
    } else {
    }
    const bool fullyClears =
      SceneFullyClearsSurface(frameScene) ||
      ScenePayloadIsEmpty(priorCommittedScene);
    const bool sceneIsAccumulated = true;
    const ScenePayload accumulatedScene = fullyClears
      ? frameScene
      : AppendScenePayload(priorCommittedScene, frameScene);
    cache->latestScene = accumulatedScene;
    cache->latestSceneIsAccumulated = sceneIsAccumulated;
    cache->runtime.scene = cache->latestScene;

    if (shouldCaptureRaster) {
      ApplySceneToRaster8(
        &cache->raster,
        output->width,
        output->height,
        cache->latestScene
      );
      snapshotRaster = cache->raster;
    }

    cache->lastFrame = frame;
    cache->simulatedFrame = frame;
    cache->controllerState = frameControllerState;
    cache->controllerStateHash = frameControllerState.stateHash;
    cache->hasControllerState = true;
    // Keep per-frame snapshots for exact raster output, but treat the live JS
    // heap as trustworthy only along this sequentially advanced frontier.
    const bool shouldCaptureRuntimeState = true;
    StoreFrameSnapshot(
      cache,
      frame,
      cache->latestScene,
      sceneIsAccumulated,
      shouldCaptureRaster ? snapshotRaster : std::vector<PF_Pixel>(),
      shouldCaptureRuntimeState
    );
    cache->gpuFrameScenes[frame] = frameScene;
  }

  return true;
}

std::optional<ScenePayload> ExecuteDirectTimeSketchAtFrame(
  CachedSketchState* cache,
  PF_InData* in_data,
  A_long instanceId,
  PF_LayerDef* output,
  long targetFrame,
  const std::vector<PF_Pixel>** rasterOut,
  std::string* errorMessage
) {
  if (!cache || !cache->valid || !output) {
    if (errorMessage) {
      *errorMessage = "Invalid direct-time sketch state.";
    }
    return std::nullopt;
  }

  const CachedSketchState::FrameSnapshot* exactSnapshot = FindFrameSnapshot(cache, targetFrame);
  if (exactSnapshot) {
    if (!RestoreFrameSnapshot(cache, *exactSnapshot, errorMessage)) {
      return std::nullopt;
    }
    SetExecutionTrace(
      "path=direct-exact"
      " target=" + std::to_string(targetFrame) +
      " restored=" + std::to_string(cache->lastFrame) +
      " runtimeHash=" + std::to_string(HashString(exactSnapshot->runtimeStateJson)) +
      " rasterHash=" + std::to_string(HashRasterSample(cache->raster)) +
      " sample=" + CaptureDebugSample(cache)
    );
    if (rasterOut) {
      *rasterOut = &cache->raster;
    }
    return cache->latestScene;
  }

  const CachedSketchState::FrameSnapshot* setupSnapshot = FindFrameSnapshot(cache, 0);
  if (!setupSnapshot) {
    if (errorMessage) {
      *errorMessage = "Missing setup snapshot for direct-time evaluation.";
    }
    return std::nullopt;
  }

  if (!RestoreFrameSnapshot(cache, *setupSnapshot, errorMessage)) {
    return std::nullopt;
  }

  if (!cache->drawFn) {
    SetExecutionTrace(
      "path=direct-static"
      " target=" + std::to_string(targetFrame) +
      " restored=" + std::to_string(cache->lastFrame) +
      " rasterHash=" + std::to_string(HashRasterSample(cache->raster))
    );
    if (rasterOut) {
      *rasterOut = &cache->raster;
    }
    return cache->latestScene;
  }

  const double simulationFrameRate = GetSimulationFrameRate(*cache, in_data);
  JSObjectRef globalObject = JSContextGetGlobalObject(cache->context);
  ControllerPoolState frameControllerState;
  if (!CheckoutControllerStateForSketchFrame(
        in_data,
        instanceId,
        targetFrame,
        simulationFrameRate,
        &frameControllerState,
        errorMessage
      )) {
    return std::nullopt;
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
    simulationFrameRate > 0.0 ? static_cast<double>(targetFrame - 1) / simulationFrameRate : 0.0,
    targetFrame
  );

  if (!ApplyControllerStateToRuntime(cache->context, frameControllerState, errorMessage)) {
    return std::nullopt;
  }
  g_activeRuntime = &cache->runtime;
  const bool drawOk = CallFunction(cache->context, globalObject, cache->drawFn, errorMessage);
  g_activeRuntime = NULL;
  if (!drawOk) {
    return std::nullopt;
  }

  cache->latestScene = cache->runtime.scene;
  cache->latestSceneIsAccumulated = true;
  cache->controllerState = frameControllerState;
  cache->controllerStateHash = frameControllerState.stateHash;
  cache->hasControllerState = true;
  ApplySceneToRaster8(&cache->raster, output->width, output->height, cache->runtime.scene);
  StoreFrameSnapshot(cache, targetFrame, cache->latestScene, true, cache->raster, false);

  const CachedSketchState::FrameSnapshot* finalSnapshot = FindFrameSnapshot(cache, targetFrame);
  if (finalSnapshot) {
      if (!RestoreFrameSnapshot(cache, *finalSnapshot, errorMessage)) {
        return std::nullopt;
      }
  }
  if (rasterOut) {
    *rasterOut = &cache->raster;
  }

  SetExecutionTrace(
    "path=direct-build"
    " target=" + std::to_string(targetFrame) +
    " restored=" + std::to_string(cache->lastFrame) +
    " rasterHash=" + std::to_string(HashRasterSample(cache->raster)) +
    " sample=" + CaptureDebugSample(cache)
  );

  return cache->latestScene;
}

}  // namespace

void MarkControllerHistoryDirty(
  std::uintptr_t cacheKey,
  long earliestAffectedFrame,
  const char* reason
) {
  const std::lock_guard<std::recursive_mutex> lock(gSketchRuntimeMutex);
  if (!cacheKey) {
    return;
  }

  auto it = g_cachedSketches.find(cacheKey);
  if (it == g_cachedSketches.end() || !it->second.valid) {
    return;
  }

  CachedSketchState& cache = it->second;
  const long dirtyFrame = std::max<long>(0, earliestAffectedFrame);
  cache.controllerHistoryDirty = true;
  cache.controllerHistoryDirtyFrame =
    cache.controllerHistoryDirtyFrame < 0
      ? dirtyFrame
      : std::min(cache.controllerHistoryDirtyFrame, dirtyFrame);

}

void UpdateLiveControllerState(
  std::uintptr_t cacheKey,
  const ControllerPoolState& state
) {
  if (!cacheKey) {
    return;
  }
  const std::lock_guard<std::mutex> lock(gLiveControllerStateMutex);
  g_liveControllerStates[cacheKey] = state;
}

bool GetLiveControllerState(
  std::uintptr_t cacheKey,
  ControllerPoolState* outState
) {
  if (!cacheKey || !outState) {
    return false;
  }
  const std::lock_guard<std::mutex> lock(gLiveControllerStateMutex);
  const auto it = g_liveControllerStates.find(cacheKey);
  if (it == g_liveControllerStates.end()) {
    return false;
  }
  *outState = it->second;
  return true;
}

void ClearLiveControllerState(std::uintptr_t cacheKey) {
  if (!cacheKey) {
    return;
  }
  const std::lock_guard<std::mutex> lock(gLiveControllerStateMutex);
  g_liveControllerStates.erase(cacheKey);
}

void ClearAllLiveControllerStates() {
  const std::lock_guard<std::mutex> lock(gLiveControllerStateMutex);
  g_liveControllerStates.clear();
}

void ClearCachedSketchByKey(std::uintptr_t cacheKey, const char* reason) {
  const std::lock_guard<std::recursive_mutex> lock(gSketchRuntimeMutex);
  if (!cacheKey) {
    return;
  }
  g_cachedSketches.erase(cacheKey);
  ClearCachedGpuFramePlansByKey(static_cast<std::uint64_t>(cacheKey));
  DisposeBitmapGpuStateByCacheKey(static_cast<std::uint64_t>(cacheKey), reason);
  ClearBitmapGpuTextAtlasCacheByKey(static_cast<std::uint64_t>(cacheKey));
}

void ClearAllCachedSketches(const char* reason) {
  const std::lock_guard<std::recursive_mutex> lock(gSketchRuntimeMutex);
  g_cachedSketches.clear();
  ClearAllCachedGpuFramePlans();
  ClearAllBitmapGpuTextAtlasCaches();
}

long ResolveSketchTargetFrame(
  PF_InData* in_data,
  A_long instanceId
) {
  const double simulationFrameRate = ResolveSketchSimulationFrameRate(in_data, instanceId);
  const double currentTime = GetCompTimeSeconds(in_data);
  return std::max<long>(
    1,
    static_cast<long>(std::floor(currentTime * simulationFrameRate)) + 1L
  );
}

double ResolveSketchSimulationFrameRate(
  PF_InData* in_data,
  A_long instanceId
) {
  const std::lock_guard<std::recursive_mutex> lock(gSketchRuntimeMutex);
  const std::uintptr_t cacheKey =
    instanceId > 0
      ? static_cast<std::uintptr_t>(static_cast<std::uint64_t>(instanceId))
      : GetEffectCacheKey(in_data);
  double simulationFrameRate = GetFrameRate(in_data);
  const auto it = g_cachedSketches.find(cacheKey);
  if (it != g_cachedSketches.end() && it->second.valid) {
    simulationFrameRate = GetSimulationFrameRate(it->second, in_data);
  }
  return simulationFrameRate;
}

std::optional<ScenePayload> ExecuteSketchAtCurrentTime(
  PF_InData* in_data,
  A_long revision,
  A_long instanceId,
  PF_LayerDef* output,
  const std::vector<PF_Pixel>** rasterOut,
  long* targetFrameOut,
  bool requireRaster,
  SketchExecutionMode executionMode,
  std::string* errorMessage
) {
  const std::lock_guard<std::recursive_mutex> lock(gSketchRuntimeMutex);
  const RuntimeSketchBundle bundle = runtime_internal::ReadRuntimeSketchBundleForEffect(
    in_data,
    instanceId,
    errorMessage
  );
  if (errorMessage && !errorMessage->empty()) {
    return std::nullopt;
  }

  const std::uintptr_t cacheKey =
    instanceId > 0
      ? static_cast<std::uintptr_t>(static_cast<std::uint64_t>(instanceId))
      : GetEffectCacheKey(in_data);
  CachedSketchState& cache = g_cachedSketches[cacheKey];
  const A_long effectiveRevision = bundle.revision >= 0 ? static_cast<A_long>(bundle.revision) : revision;
  const bool revisionChanged = cache.revision != effectiveRevision;
  const bool sourceHashChanged = !bundle.sourceHash.empty() && cache.sourceHash != bundle.sourceHash;
  const bool controllerHashChanged = cache.controllerHash != bundle.controllerHash;
  const bool sizeChanged = cache.outputWidth != output->width || cache.outputHeight != output->height;
  std::optional<std::string> source;
  const long targetFrame = ResolveSketchTargetFrame(in_data, instanceId);
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
    source = ReadRuntimeSketchSource(bundle);
    if (!source.has_value()) {
      if (errorMessage) {
        *errorMessage = "No runtime sketch source found.";
      }
      return std::nullopt;
    }

    // In stateful bitmap mode, the Metal accumulation canvas is keyed by the
    // same instance id as the runtime cache. If the sketch revision, source,
    // controller wiring, or output size changes, any retained GPU canvas is no
    // longer valid and must be discarded before the cache is rebuilt.
    ClearCachedGpuFramePlansByKey(static_cast<std::uint64_t>(cacheKey));
    DisposeBitmapGpuStateByCacheKey(
      static_cast<std::uint64_t>(cacheKey),
      invalidateReasonText.empty() ? "runtime-cache-invalidate" : invalidateReasonText.c_str()
    );
    ClearBitmapGpuTextAtlasCacheByKey(static_cast<std::uint64_t>(cacheKey));
    ResetCachedSketchState(&cache);
    if (!InitializeCachedSketchState(
      &cache,
      in_data,
      instanceId,
      output,
      *source,
      bundle.sourceHash,
      bundle.debugTracePath,
      bundle.debugSessionId,
      bundle.controllerHash,
      std::string(),
      NULL,
      bundle.pixelDensity,
      bundle.recentFrameBudgetBytes,
      bundle.checkpointInterval,
      bundle.denseWindowBacktrack,
      bundle.denseWindowForward,
      effectiveRevision,
      errorMessage
    )) {
      return std::nullopt;
    }
  }
  const bool controllerDirtyBeforeConsistencyCheck = cache.controllerHistoryDirty;
  if (!EnsureControllerStateFreshForTargetFrame(
        in_data,
        instanceId,
        cacheKey,
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
    InvalidateCachedHistoryFromFrame(
      &cache,
      static_cast<std::uint64_t>(cacheKey),
      dirtyStartFrame
    );
  }

  // The old direct-time + opaque profile shortcut remains available only for
  // CPU fallback rendering. GPU-primary execution must not depend on sketch
  // classification for correctness.
  const bool useLegacyProfileFastPath = false;
  const bool gpuPrimaryExecution = executionMode == SketchExecutionMode::kGpuPrimary;

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

      ClearCachedGpuFramePlansByKey(static_cast<std::uint64_t>(cacheKey));
      DisposeBitmapGpuStateByCacheKey(static_cast<std::uint64_t>(cacheKey), "controller-history-dirty");
      ResetCachedSketchState(&cache);
      if (!InitializeCachedSketchState(
        &cache,
        in_data,
        instanceId,
        output,
        *source,
        bundle.sourceHash,
        bundle.debugTracePath,
        bundle.debugSessionId,
        bundle.controllerHash,
        std::string(),
        NULL,
        bundle.pixelDensity,
        bundle.recentFrameBudgetBytes,
        bundle.checkpointInterval,
        bundle.denseWindowBacktrack,
        bundle.denseWindowForward,
        effectiveRevision,
        errorMessage
      )) {
        return std::nullopt;
      }
    }

    const CachedSketchState::FrameSnapshot* staticSnapshot = FindFrameSnapshot(&cache, targetFrame);
    if (!staticSnapshot) {
      StoreFrameSnapshot(&cache, targetFrame, cache.latestScene, cache.latestSceneIsAccumulated, cache.raster, false);
      staticSnapshot = FindFrameSnapshot(&cache, targetFrame);
    }

    if (staticSnapshot && rasterOut) {
      *rasterOut = &staticSnapshot->raster;
    } else if (rasterOut) {
      *rasterOut = &cache.raster;
    }

    SetExecutionTrace(
      "path=static"
      " target=" + std::to_string(targetFrame) +
      " restored=" + std::to_string(cache.lastFrame) +
      " rasterHash=" + std::to_string(HashRasterSample(cache.raster))
    );

    if (controllerHistoryAffectsTarget) {
      cache.controllerHistoryDirty = false;
      cache.controllerHistoryDirtyFrame = -1;
    }

    return cache.latestScene;
  }

  if (useLegacyProfileFastPath) {
    return ExecuteDirectTimeSketchAtFrame(
      &cache,
      in_data,
      instanceId,
      output,
      targetFrame,
      rasterOut,
      errorMessage
    );
  }

  const CachedSketchState::FrameSnapshot* exactSnapshot = FindFrameSnapshot(&cache, targetFrame);
  const bool exactSnapshotMatchesExecution =
    exactSnapshot &&
    (gpuPrimaryExecution || exactSnapshot->sceneIsAccumulated);
  const bool exactSnapshotCanDirectRestore =
    exactSnapshotMatchesExecution &&
    (
      !exactSnapshot->runtimeStateJson.empty() ||
      targetFrame == cache.lastFrame
    );

  if (exactSnapshotCanDirectRestore) {
    if (!RestoreFrameSnapshot(&cache, *exactSnapshot, errorMessage)) {
      return std::nullopt;
    }
    if (requireRaster && cache.raster.empty()) {
      ApplySceneToRaster8(&cache.raster, output->width, output->height, cache.latestScene);
      cache.exactSnapshots[targetFrame].raster = cache.raster;
    }
    SetExecutionTrace(
      "path=stateful-exact"
      " target=" + std::to_string(targetFrame) +
      " restored=" + std::to_string(cache.lastFrame) +
      " runtimeHash=" + std::to_string(HashString(exactSnapshot->runtimeStateJson)) +
      " rasterHash=" + std::to_string(HashRasterSample(cache.raster)) +
      " sample=" + CaptureDebugSample(&cache)
    );
    if (rasterOut) {
      *rasterOut = &cache.raster;
    }
    return cache.latestScene;
  }

  const long exactCapacity = EstimateExactFramesCapacity(cache);
  const long requestedWindowSize = cache.denseWindowBacktrack + cache.denseWindowForward + 1;
  const long windowSize = std::max<long>(1, std::min<long>(requestedWindowSize, exactCapacity));
  const long desiredBacktrack = gpuPrimaryExecution
    ? 0L
    : std::min<long>(cache.denseWindowBacktrack, windowSize - 1);
  const long desiredForward = gpuPrimaryExecution
    ? 0L
    : std::max<long>(0, windowSize - 1 - desiredBacktrack);
  const long windowStart = std::max<long>(1, targetFrame - desiredBacktrack);
  const long windowEnd = gpuPrimaryExecution
    ? targetFrame
    : std::max<long>(targetFrame, targetFrame + desiredForward);
  const bool canAdvanceFromCurrent = controllerHistoryAffectsTarget
    ? false
    : (gpuPrimaryExecution
      ? (targetFrame > cache.lastFrame)
    : (
      targetFrame > cache.lastFrame &&
      cache.latestSceneIsAccumulated &&
      cache.lastFrame >= (windowStart - 1)
    ));

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

    std::unordered_map<long, CachedSketchState::FrameSnapshot> preservedCheckpointSnapshots = cache.checkpointSnapshots;
    std::vector<long> preservedCheckpointOrder = cache.checkpointOrder;
    std::unordered_map<long, CachedSketchState::FrameSnapshot> preservedExactSnapshots = cache.exactSnapshots;
    std::vector<long> preservedExactOrder = cache.exactSnapshotOrder;
    std::unordered_map<long, ScenePayload> preservedGpuFrameScenes = cache.gpuFrameScenes;
    const long checkpointSearchFrame = controllerHistoryAffectsTarget
      ? std::max<long>(0, dirtyStartFrame - 1)
      : targetFrame;
    const CachedSketchState::FrameSnapshot* checkpoint = FindNearestSnapshotAtOrBefore(&cache, checkpointSearchFrame);
    const CachedSketchState::FrameSnapshot* suitableCheckpoint = checkpoint;
    if (!gpuPrimaryExecution) {
      while (suitableCheckpoint && !suitableCheckpoint->sceneIsAccumulated) {
        suitableCheckpoint = FindNearestSnapshotAtOrBefore(&cache, suitableCheckpoint->frame - 1);
      }
    }
    std::optional<CachedSketchState::FrameSnapshot> checkpointCopy;
    if (suitableCheckpoint) {
      checkpointCopy = *suitableCheckpoint;
    }

    ResetCachedSketchState(&cache);
    if (!InitializeCachedSketchState(
      &cache,
      in_data,
      instanceId,
      output,
      *source,
      bundle.sourceHash,
      bundle.debugTracePath,
      bundle.debugSessionId,
      bundle.controllerHash,
      std::string(),
      NULL,
      bundle.pixelDensity,
      bundle.recentFrameBudgetBytes,
      bundle.checkpointInterval,
      bundle.denseWindowBacktrack,
      bundle.denseWindowForward,
      effectiveRevision,
      errorMessage
    )) {
      return std::nullopt;
    }

    for (const auto& entry : preservedCheckpointSnapshots) {
      cache.checkpointSnapshots[entry.first] = entry.second;
    }
    MergeFrameOrder(&cache.checkpointOrder, preservedCheckpointOrder);

    for (const auto& entry : preservedExactSnapshots) {
      cache.exactSnapshots[entry.first] = entry.second;
    }
    MergeFrameOrder(&cache.exactSnapshotOrder, preservedExactOrder);

    for (const auto& entry : preservedGpuFrameScenes) {
      cache.gpuFrameScenes[entry.first] = entry.second;
    }

    if (checkpointCopy.has_value()) {
      if (!RestoreFrameSnapshot(&cache, *checkpointCopy, errorMessage)) {
        return std::nullopt;
      }
      SetExecutionTrace(
        "path=checkpoint-restore"
        " target=" + std::to_string(targetFrame) +
        " checkpoint=" + std::to_string(checkpointCopy->frame) +
        " restored=" + std::to_string(cache.lastFrame) +
        " runtimeHash=" + std::to_string(HashString(checkpointCopy->runtimeStateJson)) +
        " rasterHash=" + std::to_string(HashRasterSample(cache.raster)) +
        " sample=" + CaptureDebugSample(&cache)
      );
    }
  }

  if (!AdvanceCachedSketchState(
    &cache,
    in_data,
    instanceId,
    output,
    windowEnd,
    requireRaster,
    gpuPrimaryExecution,
    errorMessage
  )) {
    return std::nullopt;
  }

  exactSnapshot = FindFrameSnapshot(&cache, targetFrame);
  if (!exactSnapshot) {
    if (errorMessage) {
      *errorMessage = "Failed to materialize dense frame window.";
    }
    return std::nullopt;
  }

  if (!RestoreFrameSnapshot(&cache, *exactSnapshot, errorMessage)) {
    return std::nullopt;
  }
  if (requireRaster && cache.raster.empty()) {
    ApplySceneToRaster8(&cache.raster, output->width, output->height, cache.latestScene);
    cache.exactSnapshots[targetFrame].raster = cache.raster;
  }

  SetExecutionTrace(
    "path=advance-window"
    " target=" + std::to_string(targetFrame) +
    " windowEnd=" + std::to_string(windowEnd) +
    " restored=" + std::to_string(cache.lastFrame) +
    " runtimeHash=" + std::to_string(HashString(exactSnapshot->runtimeStateJson)) +
    " rasterHash=" + std::to_string(HashRasterSample(cache.raster)) +
    " sample=" + CaptureDebugSample(&cache)
  );

  if (rasterOut) {
    *rasterOut = &cache.raster;
  }

  if (controllerHistoryAffectsTarget) {
    cache.controllerHistoryDirty = false;
    cache.controllerHistoryDirtyFrame = -1;
  }

  return cache.latestScene;
}

bool BuildBitmapFramePlanAtCurrentTime(
  PF_InData* in_data,
  A_long revision,
  A_long instanceId,
  PF_LayerDef* output,
  BitmapFramePlan* outPlan,
  std::string* errorMessage
) {
  const std::lock_guard<std::recursive_mutex> lock(gSketchRuntimeMutex);
  if (!output || !outPlan) {
    if (errorMessage) {
      *errorMessage = "Bitmap GPU frame plan request is missing an output surface.";
    }
    return false;
  }

  const std::uintptr_t cacheKeyPtr =
    instanceId > 0
      ? static_cast<std::uintptr_t>(static_cast<std::uint64_t>(instanceId))
      : GetEffectCacheKey(in_data);
  const std::uint64_t cacheKey = static_cast<std::uint64_t>(cacheKeyPtr);
  long targetFrame = 0;
  const auto scene = ExecuteSketchAtCurrentTime(
    in_data,
    revision,
    instanceId,
    output,
    NULL,
    &targetFrame,
    false,
    SketchExecutionMode::kGpuPrimary,
    errorMessage
  );
  if (!scene.has_value()) {
    return false;
  }

  auto cacheIt = g_cachedSketches.find(cacheKeyPtr);
  if (cacheIt == g_cachedSketches.end()) {
    if (errorMessage) {
      *errorMessage = "Missing cached sketch state for bitmap GPU planning.";
    }
    return false;
  }
  CachedSketchState& cache = cacheIt->second;
  PF_LayerDef planSurface = *output;

  auto collectScenes = [&](long firstFrame, long lastFrame, std::vector<std::pair<long, ScenePayload>>* outScenes) -> bool {
    if (!outScenes || firstFrame > lastFrame) {
      return true;
    }
    outScenes->clear();
    outScenes->reserve(static_cast<std::size_t>(lastFrame - firstFrame + 1));
    for (long frame = firstFrame; frame <= lastFrame; ++frame) {
      const auto gpuScene = cache.gpuFrameScenes.find(frame);
      if (gpuScene == cache.gpuFrameScenes.end()) {
        return false;
      }
      outScenes->push_back(std::make_pair(frame, gpuScene->second));
    }
    return true;
  };

  std::vector<std::pair<long, ScenePayload>> scenes;
  BitmapGpuExecutionProfile profile = BITMAP_GPU_PROFILE_STATEFUL_ACCUMULATION;
  std::string planMode = "stateful-replay";
  std::string planSeed = "none";
  std::string fallbackReason = "none";
  long planFirstFrame = targetFrame;
  bool planHasSeedGpuCheckpoint = false;
  long planSeedFrame = 0;

  long canvasLastFrame = 0;
  bool canvasInitialized = false;
  const bool haveCanvasCursor = QueryBitmapGpuCanvasCursor(cacheKey, &canvasLastFrame, &canvasInitialized);
  const bool canAppendFromCanvas =
    haveCanvasCursor &&
    canvasInitialized &&
    canvasLastFrame >= 0 &&
    canvasLastFrame <= targetFrame;

  if (canAppendFromCanvas) {
    const long firstAppendFrame = canvasLastFrame + 1;
    if (firstAppendFrame <= targetFrame && collectScenes(firstAppendFrame, targetFrame, &scenes)) {
      planMode = "stateful-append";
      planFirstFrame = firstAppendFrame;
    } else if (firstAppendFrame > targetFrame) {
      scenes.clear();
      planMode = "stateful-reuse-canvas";
      planFirstFrame = targetFrame;
    }
  }

  if (scenes.empty() && planMode != "stateful-reuse-canvas") {
    long checkpointFrame = -1;
    if (QueryBitmapGpuNearestCheckpoint(cacheKey, targetFrame, &checkpointFrame) &&
        checkpointFrame >= 0 &&
        checkpointFrame < targetFrame &&
        collectScenes(checkpointFrame + 1, targetFrame, &scenes)) {
      planHasSeedGpuCheckpoint = true;
      planSeedFrame = checkpointFrame;
      planMode = "stateful-gpu-checkpoint-replay";
      planSeed = std::to_string(checkpointFrame);
      planFirstFrame = checkpointFrame + 1;
    }
  }

  if (scenes.empty() && planMode != "stateful-reuse-canvas") {
    const long fullReplayStartFrame = cache.gpuFrameScenes.find(0) != cache.gpuFrameScenes.end() ? 0L : 1L;
    if (!collectScenes(fullReplayStartFrame, targetFrame, &scenes)) {
      fallbackReason = "missing-gpu-frame-scene";
      scenes.clear();
      scenes.push_back(std::make_pair(targetFrame, *scene));
      profile = BITMAP_GPU_PROFILE_DIRECT_FRAME;
      planMode = "authoritative-scene";
      planSeed = "none";
      planFirstFrame = targetFrame;
    } else {
      planMode = "stateful-full-replay";
      planFirstFrame = fullReplayStartFrame;
    }
  }

  long trimmedPlanFirstFrame = -1;
  const bool trimmedAfterClear =
    profile == BITMAP_GPU_PROFILE_STATEFUL_ACCUMULATION &&
    planMode != "stateful-reuse-canvas" &&
    TrimBitmapPlanScenesAfterLastFullClear(&scenes, &trimmedPlanFirstFrame);
  if (trimmedAfterClear && !scenes.empty()) {
    planFirstFrame = scenes.front().first;
    if (SceneFullyClearsSurface(scenes.front().second)) {
      planHasSeedGpuCheckpoint = false;
      planSeedFrame = 0;
      planSeed = "none";
    }
  }

  const std::vector<std::pair<long, ScenePayload>>* planScenes = &scenes;

  const bool planOk = BuildBitmapFramePlanWithPlanCache(
    &planSurface,
    profile,
    cacheKey,
    targetFrame,
    *planScenes,
    outPlan,
    errorMessage
  );
  if (planOk && outPlan) {
    outPlan->logicalWidth = output->width;
    outPlan->logicalHeight = output->height;
    outPlan->checkpointInterval = profile == BITMAP_GPU_PROFILE_STATEFUL_ACCUMULATION
      ? cache.checkpointInterval
      : 0;
    outPlan->hasSeedGpuCheckpoint =
      profile == BITMAP_GPU_PROFILE_STATEFUL_ACCUMULATION && planHasSeedGpuCheckpoint;
    outPlan->seedFrame = outPlan->hasSeedGpuCheckpoint ? planSeedFrame : 0;
    if (!outPlan->operations.empty()) {
      const BitmapFramePlanOp& firstOp = outPlan->operations.front();
      const BitmapFramePlanOp& lastOp = outPlan->operations.back();
      (void)firstOp;
      (void)lastOp;
    }
  }
  (void)planFirstFrame;
  (void)planScenes;
  (void)fallbackReason;
  return planOk;
}

}  // namespace momentum
