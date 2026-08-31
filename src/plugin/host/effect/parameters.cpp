#include "host/effect/parameters.h"

#include "controllers/schema.h"
#include "host/effect/code_editor.h"
#include "host/effect/events.h"
#include "host/effect/render.h"
#include "host/effect_contract.h"
#include "host/code/snapshot.h"
#include "host/parameter_layout.h"
#include "scripting/runtime/core.h"
#include "scripting/runtime/internal.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <sstream>

namespace momentum {

namespace {

constexpr A_short kAngleControlUiWidth = 112;
constexpr A_short kAngleControlUiHeight = 60;
constexpr PF_ParamUIFlags kAngleControlUiFlags = PF_PUI_CONTROL;
constexpr A_short kColorControlUiWidth = 96;
constexpr A_short kColorControlUiHeight = 18;
constexpr PF_ParamUIFlags kColorControlUiFlags = PF_PUI_TOPIC;
constexpr A_short kCodeControlUiWidth = 112;
constexpr A_short kCodeControlUiHeight = 22;
constexpr PF_ParamUIFlags kCodeControlUiFlags = PF_PUI_CONTROL;
constexpr A_short kRestartControlUiSize = 1;
constexpr double kStaticSliderValidMin = -1000000.0;
constexpr double kStaticSliderValidMax = 1000000.0;
constexpr A_short kControllerSliderPrecision =
  PF_Precision_HUNDREDTHS;
constexpr int kStaticSelectControllerChoiceCount = 32;

PF_Fixed DoubleToFixed(double value) {
  return static_cast<PF_Fixed>(value * 65536.0);
}

}  // namespace

static std::string BuildStaticSelectControllerPopupItems() {
  std::ostringstream stream;
  for (int index = 0; index < kStaticSelectControllerChoiceCount; ++index) {
    if (index > 0) {
      stream << '|';
    }
    stream << "Option " << (index + 1);
  }
  return stream.str();
}

static void CopyParamName(
  PF_ParamDef* definition,
  const std::string& name
) {
  if (!definition) {
    return;
  }
  std::strncpy(
    definition->PF_DEF_NAME,
    name.c_str(),
    PF_MAX_EFFECT_PARAM_NAME_LEN
  );
  definition->PF_DEF_NAME[PF_MAX_EFFECT_PARAM_NAME_LEN] = '\0';
}

static void ResolveSafeSliderUiRange(
  double minValue,
  double maxValue,
  PF_FpShort* validMin,
  PF_FpShort* validMax,
  PF_FpShort* sliderMin,
  PF_FpShort* sliderMax
) {
  double safeMin = std::isfinite(minValue) ? minValue : 0.0;
  double safeMax = std::isfinite(maxValue) ? maxValue : 100.0;
  if (!(safeMax > safeMin)) {
    const double center = safeMin;
    safeMin = center - 1.0;
    safeMax = center + 1.0;
  }

  safeMin = std::max(
    kStaticSliderValidMin,
    std::min(kStaticSliderValidMax, safeMin)
  );
  safeMax = std::max(
    kStaticSliderValidMin,
    std::min(kStaticSliderValidMax, safeMax)
  );
  if (!(safeMax > safeMin)) {
    if (safeMin <= kStaticSliderValidMin) {
      safeMin = kStaticSliderValidMin;
      safeMax = std::min(
        kStaticSliderValidMax,
        kStaticSliderValidMin + 1.0
      );
    } else if (safeMax >= kStaticSliderValidMax) {
      safeMax = kStaticSliderValidMax;
      safeMin = std::max(
        kStaticSliderValidMin,
        kStaticSliderValidMax - 1.0
      );
    } else {
      safeMin = std::max(kStaticSliderValidMin, safeMin - 0.5);
      safeMax = std::min(kStaticSliderValidMax, safeMax + 0.5);
    }
  }

  if (validMin) {
    *validMin = static_cast<PF_FpShort>(kStaticSliderValidMin);
  }
  if (validMax) {
    *validMax = static_cast<PF_FpShort>(kStaticSliderValidMax);
  }
  if (sliderMin) {
    *sliderMin = static_cast<PF_FpShort>(safeMin);
  }
  if (sliderMax) {
    *sliderMax = static_cast<PF_FpShort>(safeMax);
  }
}

static void ResolveAngleUiRange(
  PF_FpShort* validMin,
  PF_FpShort* validMax,
  PF_FpShort* sliderMin,
  PF_FpShort* sliderMax
) {
  if (validMin) {
    *validMin = static_cast<PF_FpShort>(-100000.0);
  }
  if (validMax) {
    *validMax = static_cast<PF_FpShort>(100000.0);
  }
  if (sliderMin) {
    *sliderMin = static_cast<PF_FpShort>(-360.0);
  }
  if (sliderMax) {
    *sliderMax = static_cast<PF_FpShort>(360.0);
  }
}

static bool TryMapSliderParamIndexToSlot(
  PF_ParamIndex paramIndex,
  int* slot
) {
  if (paramIndex < ControllerSliderParamIndex(0) ||
      paramIndex > ControllerSliderParamIndex(kControllerSlotCount - 1)) {
    return false;
  }
  const int relativeIndex =
    static_cast<int>(paramIndex - ControllerSliderParamIndex(0));
  if ((relativeIndex % kControllerParamKindsPerSlot) != 0) {
    return false;
  }
  const int resolvedSlot = relativeIndex / kControllerParamKindsPerSlot;
  if (resolvedSlot < 0 || resolvedSlot >= kControllerSlotCount) {
    return false;
  }
  if (slot) {
    *slot = resolvedSlot;
  }
  return true;
}

static bool TryMapAngleValueParamIndexToSlot(
  PF_ParamIndex paramIndex,
  int* slot
) {
  if (paramIndex < ControllerAngleValueParamIndex(0) ||
      paramIndex > ControllerAngleValueParamIndex(kControllerSlotCount - 1)) {
    return false;
  }
  const int relativeIndex =
    static_cast<int>(paramIndex - ControllerAngleValueParamIndex(0));
  if ((relativeIndex % kControllerParamKindsPerSlot) != 0) {
    return false;
  }
  const int resolvedSlot = relativeIndex / kControllerParamKindsPerSlot;
  if (resolvedSlot < 0 || resolvedSlot >= kControllerSlotCount) {
    return false;
  }
  if (slot) {
    *slot = resolvedSlot;
  }
  return true;
}

static bool TryMapAngleUiParamIndexToSlot(
  PF_ParamIndex paramIndex,
  int* slot
) {
  if (paramIndex < ControllerAngleValueParamIndex(0) ||
      paramIndex > ControllerAngleUiParamIndex(kControllerSlotCount - 1)) {
    return false;
  }
  const int relativeIndex =
    static_cast<int>(paramIndex - ControllerAngleValueParamIndex(0));
  if ((relativeIndex % kControllerParamKindsPerSlot) != 1) {
    return false;
  }
  const int resolvedSlot = relativeIndex / kControllerParamKindsPerSlot;
  if (resolvedSlot < 0 || resolvedSlot >= kControllerSlotCount) {
    return false;
  }
  if (slot) {
    *slot = resolvedSlot;
  }
  return true;
}

bool TryMapAngleParamIndexToSlot(
  PF_ParamIndex paramIndex,
  int* slot
) {
  return TryMapAngleValueParamIndexToSlot(paramIndex, slot) ||
    TryMapAngleUiParamIndexToSlot(paramIndex, slot);
}

bool TryMapColorParamIndexToSlot(
  PF_ParamIndex paramIndex,
  int* slot
) {
  if (paramIndex < ControllerColorParamIndex(0) ||
      paramIndex > ControllerColorParamIndex(kControllerSlotCount - 1)) {
    return false;
  }
  const int relativeIndex =
    static_cast<int>(paramIndex - ControllerColorParamIndex(0));
  if ((relativeIndex % kControllerParamKindsPerSlot) != 0) {
    return false;
  }
  const int resolvedSlot = relativeIndex / kControllerParamKindsPerSlot;
  if (resolvedSlot < 0 || resolvedSlot >= kControllerSlotCount) {
    return false;
  }
  if (slot) {
    *slot = resolvedSlot;
  }
  return true;
}

static bool IsControllerParamIndex(PF_ParamIndex paramIndex) {
  return paramIndex >= PARAM_CONTROLLER_SLOT_BASE &&
    paramIndex < PARAM_CONTROLLER_AFTER;
}

static long TimeValueToSketchFrame(
  A_long timeValue,
  A_u_long timeScale,
  double frameRate
) {
  if (!(frameRate > 0.0) || timeScale == 0) {
    return 0;
  }
  const double seconds =
    static_cast<double>(timeValue) / static_cast<double>(timeScale);
  return std::max<long>(
    0,
    static_cast<long>(std::floor(seconds * frameRate)) + 1L
  );
}

static long ResolveControllerHistoryStartFrame(
  PF_InData* input,
  PF_ParamIndex paramIndex
) {
  if (!input || paramIndex <= 0) {
    return 0;
  }
  const double frameRate = ResolveSketchSimulationFrameRate(input);
  if (!(frameRate > 0.0)) {
    return 0;
  }

  AEFX_SuiteScoper<PF_ParamUtilsSuite3> paramUtils(
    input,
    kPFParamUtilsSuite,
    kPFParamUtilsSuiteVersion3,
    NULL
  );
  if (!paramUtils.get()) {
    return 0;
  }

  PF_Boolean found = FALSE;
  PF_KeyIndex keyIndex = PF_KeyIndex_NONE;
  A_long keyTime = 0;
  A_u_long keyTimeScale = input->time_scale;
  const PF_Err error = paramUtils->PF_FindKeyframeTime(
    input->effect_ref,
    paramIndex,
    input->current_time,
    input->time_scale,
    PF_TimeDir_LESS_THAN,
    &found,
    &keyIndex,
    &keyTime,
    &keyTimeScale
  );
  if (error != PF_Err_NONE || !found || keyTime <= 0) {
    return 0;
  }
  return TimeValueToSketchFrame(keyTime, keyTimeScale, frameRate);
}

void MarkControllerParamHistoryDirty(
  PF_InData* input,
  PF_ParamIndex paramIndex,
  const char* reason
) {
  if (!IsControllerParamIndex(paramIndex)) {
    return;
  }
  const std::uint64_t liveEffectSessionId =
    runtime_internal::ResolveLiveEffectSessionId(input);
  const std::uint64_t interactionGeneration =
    RegisterControllerInteractionChange(liveEffectSessionId);
  InvalidateEffectPersistentRenderCaches(liveEffectSessionId, reason);
  runtime_internal::AppendEffectRuntimeDiagnostic(
    input,
    "controller-history-dirty",
    0,
    paramIndex,
    ResolveControllerHistoryStartFrame(input, paramIndex),
    (reason ? std::string(reason) : std::string()) +
      " interactionGeneration=" + std::to_string(interactionGeneration)
  );
}

static void* ColorArbitraryRefcon() {
  static char tag = 0;
  return &tag;
}

static bool IsColorArbRefcon(void* refcon) {
  return refcon == ColorArbitraryRefcon();
}

static ControllerColorValue MakeUnsetColorValue() {
  ControllerColorValue color;
  color.a = -1.0;
  return color;
}

static bool IsUnsetColorValue(const ControllerColorValue& color) {
  return std::isfinite(color.a) && !std::isnan(color.a) && color.a < 0.0;
}

static ControllerColorValue SanitizeColorValue(
  const ControllerColorValue& color
) {
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

static PF_Err AllocateColorArbHandle(
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

static ControllerColorValue ReadColorArbHandle(
  PF_InData* in_data,
  PF_ArbitraryH handle
) {
  ControllerColorValue color = MakeUnsetColorValue();
  if (!in_data || !handle) {
    return color;
  }
  ControllerColorValue* data =
    reinterpret_cast<ControllerColorValue*>(PF_LOCK_HANDLE(handle));
  if (!data) {
    return color;
  }
  color = SanitizeColorValue(*data);
  PF_UNLOCK_HANDLE(handle);
  return color;
}

ControllerColorValue ReadColorControllerParam(
  PF_InData* in_data,
  PF_ParamDef* parameter,
  const ControllerColorValue& fallback
) {
  if (!parameter) {
    return fallback;
  }
  const ControllerColorValue storedColor =
    ReadColorArbHandle(in_data, parameter->u.arb_d.value);
  return IsUnsetColorValue(storedColor) ? fallback : storedColor;
}

static void WriteAngleControllerValueToParams(
  PF_ParamDef* params[],
  int angleParamSlot,
  double degrees
) {
  if (!params || angleParamSlot < 0 ||
      angleParamSlot >= kControllerSlotCount) {
    return;
  }
  PF_ParamDef* angleParam =
    params[ControllerAngleValueParamIndex(angleParamSlot)];
  if (!angleParam) {
    return;
  }
  angleParam->u.fs_d.value = static_cast<PF_FpLong>(
    std::isfinite(degrees) ? degrees : 0.0
  );
  angleParam->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
}

PF_Err SetColorControllerParam(
  PF_InData* in_data,
  PF_ParamDef* parameter,
  const ControllerColorValue& color
) {
  if (!in_data || !parameter) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  const ControllerColorValue safeColor = SanitizeColorValue(color);
  PF_ArbitraryH existingHandle = parameter->u.arb_d.value;
  bool wroteInPlace = false;
  if (existingHandle) {
    ControllerColorValue* data =
      reinterpret_cast<ControllerColorValue*>(
        PF_LOCK_HANDLE(existingHandle)
      );
    if (data) {
      *data = safeColor;
      PF_UNLOCK_HANDLE(existingHandle);
      wroteInPlace = true;
    }
  }

  if (!wroteInPlace) {
    PF_ArbitraryH nextHandle = NULL;
    const PF_Err error =
      AllocateColorArbHandle(in_data, safeColor, &nextHandle);
    if (error != PF_Err_NONE || !nextHandle) {
      return error != PF_Err_NONE ? error : PF_Err_OUT_OF_MEMORY;
    }
    parameter->u.arb_d.value = nextHandle;
  }
  parameter->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
  return PF_Err_NONE;
}

PF_Err PromptForColorControllerValue(
  PF_InData* input,
  PF_OutData* output,
  const ControllerColorValue& current,
  ControllerColorValue* selected
) {
  if (!input || !selected) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  AEFX_SuiteScoper<PFAppSuite6, true> appSuite(
    input,
    kPFAppSuite,
    kPFAppSuiteVersion6,
    output
  );
  if (!appSuite.get()) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  PF_PixelFloat sample;
  sample.red = static_cast<PF_FpShort>(current.r);
  sample.green = static_cast<PF_FpShort>(current.g);
  sample.blue = static_cast<PF_FpShort>(current.b);
  sample.alpha = static_cast<PF_FpShort>(current.a);
  PF_PixelFloat result = sample;
  const PF_Err error = appSuite->PF_AppColorPickerDialog(
    "Momentum Color",
    &sample,
    TRUE,
    &result
  );
  if (error != PF_Err_NONE) {
    return error;
  }

  selected->r = static_cast<double>(result.red);
  selected->g = static_cast<double>(result.green);
  selected->b = static_cast<double>(result.blue);
  selected->a = static_cast<double>(result.alpha);
  return PF_Err_NONE;
}

static PF_Err AllocateDefaultColorArbHandleForSlot(
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

static ControllerColorValue ResolveColorArbValueForInterpolation(
  PF_InData* in_data,
  PF_ParamIndex paramId,
  const ControllerColorValue& storedColor
) {
  if (!IsUnsetColorValue(storedColor)) {
    return storedColor;
  }

  ControllerColorValue resolvedColor;
  if (ResolveInvocationColorControllerDefault(
        in_data,
        paramId,
        &resolvedColor
      )) {
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

  constexpr A_u_long kPrintBufferSize = 128;
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
      return AllocateColorArbHandle(
        in_data,
        color,
        extra->u.copy_func_params.dst_arbPH
      );
    }

    case PF_Arbitrary_FLAT_SIZE_FUNC:
      *extra->u.flat_size_func_params.flat_data_sizePLu =
        sizeof(ControllerColorValue);
      return PF_Err_NONE;

    case PF_Arbitrary_FLATTEN_FUNC: {
      if (extra->u.flatten_func_params.buf_sizeLu <
            sizeof(ControllerColorValue) ||
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
      if (extra->u.unflatten_func_params.buf_sizeLu !=
            sizeof(ControllerColorValue) ||
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
      const double t = std::max(
        0.0,
        std::min(
          1.0,
          static_cast<double>(extra->u.interp_func_params.tF)
        )
      );
      const bool neededDefault =
        IsUnsetColorValue(storedLeft) || IsUnsetColorValue(storedRight);
      const bool resolvedDefault =
        !IsUnsetColorValue(left) && !IsUnsetColorValue(right);
      if (neededDefault) {
        static std::atomic<int> successLogBudget{12};
        static std::atomic<int> failureLogBudget{12};
        std::atomic<int>& budget =
          resolvedDefault ? successLogBudget : failureLogBudget;
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
        leftMagnitude < rightMagnitude
          ? PF_ArbCompare_LESS
          : PF_ArbCompare_MORE;
      return PF_Err_NONE;
    }

    case PF_Arbitrary_PRINT_SIZE_FUNC:
      *extra->u.print_size_func_params.print_sizePLu = kPrintBufferSize;
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
      if (!extra->u.scan_func_params.bufPC ||
          !extra->u.scan_func_params.arbPH) {
        return PF_Err_BAD_CALLBACK_PARAM;
      }
      ControllerColorValue color;
      const char* buffer = extra->u.scan_func_params.bufPC;
      const int parsed =
        std::sscanf(
          buffer,
          "rgba(%lf,%lf,%lf,%lf)",
          &color.r,
          &color.g,
          &color.b,
          &color.a
        ) == 4 ||
        std::sscanf(
          buffer,
          "%lf,%lf,%lf,%lf",
          &color.r,
          &color.g,
          &color.b,
          &color.a
        ) == 4 ||
        std::sscanf(
          buffer,
          "%lf %lf %lf %lf",
          &color.r,
          &color.g,
          &color.b,
          &color.a
        ) == 4;
      if (!parsed) {
        return PF_Err_CANNOT_PARSE_KEYFRAME_TEXT;
      }
      return AllocateColorArbHandle(
        in_data,
        color,
        extra->u.scan_func_params.arbPH
      );
    }

    default:
      return PF_Err_NONE;
  }
}

namespace {

PF_Err SyncControllerParamVisibility(
  PF_InData* input,
  PF_ParamDef* parameters[]
) {
  if (!input || !parameters) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  AEGP_PluginID pluginId = 0;
  if (AcquireAegpPluginId(input, &pluginId) != A_Err_NONE ||
      pluginId == 0) {
    return PF_Err_NONE;
  }

  AEFX_SuiteScoper<AEGP_PFInterfaceSuite1> interfaceSuite(
    input,
    kAEGPPFInterfaceSuite,
    kAEGPPFInterfaceSuiteVersion1,
    NULL
  );
  AEFX_SuiteScoper<AEGP_EffectSuite5> effectSuite(
    input,
    kAEGPEffectSuite,
    kAEGPEffectSuiteVersion5,
    NULL
  );
  AEFX_SuiteScoper<AEGP_StreamSuite6> streamSuite(
    input,
    kAEGPStreamSuite,
    kAEGPStreamSuiteVersion6,
    NULL
  );
  AEFX_SuiteScoper<AEGP_DynamicStreamSuite4> dynamicStreamSuite(
    input,
    kAEGPDynamicStreamSuite,
    kAEGPDynamicStreamSuiteVersion4,
    NULL
  );
  if (!interfaceSuite.get() || !effectSuite.get() ||
      !streamSuite.get() || !dynamicStreamSuite.get()) {
    return PF_Err_NONE;
  }

  const RuntimeSketchBundle bundle =
    ReadEffectRuntimeSketchBundle(input, parameters);

  AEGP_EffectRefH effectH = NULL;
  const A_Err effectErr = interfaceSuite->AEGP_GetNewEffectForEffect(
    pluginId,
    input->effect_ref,
    &effectH
  );
  if (effectErr != A_Err_NONE || !effectH) {
    return static_cast<PF_Err>(effectErr);
  }

  PF_Err result = PF_Err_NONE;
  for (int slot = 0; slot < kControllerSlotCount; ++slot) {
    auto isVisible = [&](RuntimeControllerSlotKind kind) {
      return ResolveControllerSlotKind(bundle, slot) == kind;
    };
    auto setHidden = [&](PF_ParamIndex paramIndex, bool hidden) {
      AEGP_StreamRefH streamH = NULL;
      A_Err suiteErr = streamSuite->AEGP_GetNewEffectStreamByIndex(
        pluginId,
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
        (void)streamSuite->AEGP_DisposeStream(streamH);
      }
      if (suiteErr != A_Err_NONE && result == PF_Err_NONE) {
        result = static_cast<PF_Err>(suiteErr);
      }
    };
    auto hideUnless = [&](PF_ParamIndex paramIndex, bool visible) {
      setHidden(paramIndex, !visible);
    };

    hideUnless(
      ControllerPointParamIndex(slot),
      isVisible(RuntimeControllerSlotKind::kPoint)
    );
    hideUnless(
      ControllerSliderParamIndex(slot),
      isVisible(RuntimeControllerSlotKind::kSlider)
    );
    hideUnless(
      ControllerAngleValueParamIndex(slot),
      isVisible(RuntimeControllerSlotKind::kAngle)
    );
    setHidden(
      ControllerAngleUiParamIndex(slot),
      true
    );
    hideUnless(
      ControllerColorValueParamIndex(slot),
      isVisible(RuntimeControllerSlotKind::kColor)
    );
    hideUnless(
      ControllerCheckboxParamIndex(slot),
      isVisible(RuntimeControllerSlotKind::kCheckbox)
    );
    hideUnless(
      ControllerSelectParamIndex(slot),
      isVisible(RuntimeControllerSlotKind::kSelect)
    );
  }

  (void)effectSuite->AEGP_DisposeEffect(effectH);
  return result;
}

PF_Err SyncControllerParamUI(
  PF_InData* input,
  PF_OutData* output,
  PF_ParamDef* parameters[]
) {
  if (!input || !parameters) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  const RuntimeSketchBundle bundle =
    ReadEffectRuntimeSketchBundle(input, parameters);

  AEFX_SuiteScoper<PF_ParamUtilsSuite3> paramUtilsSuite(
    input,
    kPFParamUtilsSuite,
    kPFParamUtilsSuiteVersion3,
    NULL
  );
  if (!paramUtilsSuite.get()) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  for (int slot = 0; slot < kControllerSlotCount; ++slot) {
    const RuntimeControllerSlotKind kind =
      ResolveControllerSlotKind(bundle, slot);

    PF_ParamDef* pointSource =
      parameters[ControllerPointParamIndex(slot)];
    if (pointSource) {
      PF_ParamDef definition = *pointSource;
      CopyParamName(
        &definition,
        kind == RuntimeControllerSlotKind::kPoint
          ? ResolveControllerSlotLabel(
              bundle,
              slot,
              RuntimeControllerSlotKind::kPoint
            )
          : DefaultPointControllerLabel(slot)
      );
      const PF_Err error = paramUtilsSuite->PF_UpdateParamUI(
        input->effect_ref,
        ControllerPointParamIndex(slot),
        &definition
      );
      if (error != PF_Err_NONE) {
        return error;
      }
    }

    PF_ParamDef* sliderSource =
      parameters[ControllerSliderParamIndex(slot)];
    if (sliderSource) {
      PF_ParamDef definition = *sliderSource;
      const RuntimeSliderControllerSpec config =
        kind == RuntimeControllerSlotKind::kSlider
          ? ResolveSliderControllerSpecWithDefaults(bundle, slot)
          : RuntimeSliderControllerSpec();
      definition.ui_width = 0;
      definition.ui_height = 0;
      CopyParamName(
        &definition,
        config.label.empty()
          ? DefaultSliderControllerLabel(slot)
          : config.label
      );
      PF_FpShort ignoredValidMin = 0;
      PF_FpShort ignoredValidMax = 0;
      ResolveSafeSliderUiRange(
        config.minValue,
        config.maxValue,
        &ignoredValidMin,
        &ignoredValidMax,
        &definition.u.fs_d.slider_min,
        &definition.u.fs_d.slider_max
      );
      definition.u.fs_d.precision = kControllerSliderPrecision;
      const PF_Err error = paramUtilsSuite->PF_UpdateParamUI(
        input->effect_ref,
        ControllerSliderParamIndex(slot),
        &definition
      );
      if (error != PF_Err_NONE) {
        return error;
      }
    }

    PF_ParamDef* angleValueSource =
      parameters[ControllerAngleValueParamIndex(slot)];
    if (angleValueSource) {
      PF_ParamDef definition = *angleValueSource;
      const RuntimeAngleControllerSpec config =
        kind == RuntimeControllerSlotKind::kAngle
          ? ResolveAngleControllerSpecWithDefaults(bundle, slot)
          : RuntimeAngleControllerSpec();
      ResolveAngleUiRange(
        &definition.u.fs_d.valid_min,
        &definition.u.fs_d.valid_max,
        &definition.u.fs_d.slider_min,
        &definition.u.fs_d.slider_max
      );
      definition.u.fs_d.precision = 2;
      definition.ui_width = kAngleControlUiWidth;
      definition.ui_height = kAngleControlUiHeight;
      const std::string label = config.label.empty()
        ? DefaultAngleControllerLabel(slot)
        : config.label;
      CopyParamName(&definition, label);
      const PF_Err error = paramUtilsSuite->PF_UpdateParamUI(
        input->effect_ref,
        ControllerAngleValueParamIndex(slot),
        &definition
      );
      if (error != PF_Err_NONE) {
        return error;
      }
    }

    PF_ParamDef* angleUiSource =
      parameters[ControllerAngleUiParamIndex(slot)];
    if (angleUiSource) {
      PF_ParamDef definition = *angleUiSource;
      const RuntimeAngleControllerSpec config =
        kind == RuntimeControllerSlotKind::kAngle
          ? ResolveAngleControllerSpecWithDefaults(bundle, slot)
          : RuntimeAngleControllerSpec();
      definition.ui_width = 0;
      definition.ui_height = 0;
      const std::string label = config.label.empty()
        ? DefaultAngleControllerLabel(slot)
        : config.label;
      CopyParamName(&definition, label);
      const PF_Err error = paramUtilsSuite->PF_UpdateParamUI(
        input->effect_ref,
        ControllerAngleUiParamIndex(slot),
        &definition
      );
      if (error != PF_Err_NONE) {
        return error;
      }
    }

    PF_ParamDef* colorSource =
      parameters[ControllerColorParamIndex(slot)];
    if (colorSource) {
      PF_ParamDef definition = *colorSource;
      const RuntimeColorControllerSpec config =
        kind == RuntimeControllerSlotKind::kColor
          ? ResolveColorControllerSpecWithDefaults(bundle, slot)
          : RuntimeColorControllerSpec();
      definition.ui_width = kColorControlUiWidth;
      definition.ui_height = kColorControlUiHeight;
      CopyParamName(
        &definition,
        config.label.empty()
          ? DefaultColorControllerLabel(slot)
          : config.label
      );
      const PF_Err error = paramUtilsSuite->PF_UpdateParamUI(
        input->effect_ref,
        ControllerColorParamIndex(slot),
        &definition
      );
      if (error != PF_Err_NONE) {
        return error;
      }
    }

    PF_ParamDef* checkboxSource =
      parameters[ControllerCheckboxParamIndex(slot)];
    if (checkboxSource) {
      PF_ParamDef definition = *checkboxSource;
      const RuntimeCheckboxControllerSpec config =
        kind == RuntimeControllerSlotKind::kCheckbox
          ? ResolveCheckboxControllerSpecWithDefaults(bundle, slot)
          : RuntimeCheckboxControllerSpec();
      CopyParamName(
        &definition,
        config.label.empty()
          ? DefaultCheckboxControllerLabel(slot)
          : config.label
      );
      const PF_Err error = paramUtilsSuite->PF_UpdateParamUI(
        input->effect_ref,
        ControllerCheckboxParamIndex(slot),
        &definition
      );
      if (error != PF_Err_NONE) {
        return error;
      }
    }

    PF_ParamDef* selectSource =
      parameters[ControllerSelectParamIndex(slot)];
    if (selectSource) {
      PF_ParamDef definition = *selectSource;
      const RuntimeSelectControllerSpec config =
        kind == RuntimeControllerSlotKind::kSelect
          ? ResolveSelectControllerSpecWithDefaults(bundle, slot)
          : RuntimeSelectControllerSpec();
      CopyParamName(
        &definition,
        config.label.empty()
          ? DefaultSelectControllerLabel(slot)
          : config.label
      );
      const PF_Err error = paramUtilsSuite->PF_UpdateParamUI(
        input->effect_ref,
        ControllerSelectParamIndex(slot),
        &definition
      );
      if (error != PF_Err_NONE) {
        return error;
      }
    }
  }

  (void)output;
  return SyncControllerParamVisibility(input, parameters);
}

}  // namespace

PF_Err HandleUserChangedParam(
  PF_InData* input,
  PF_OutData* output,
  PF_ParamDef* parameters[],
  const PF_UserChangedParamExtra* changed
) {
  if (!input || !changed) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  if (changed->param_index == PARAM_CREATION_TOKEN) {
    return InitializeEffectDocument(input, output, parameters);
  }

  if (changed->param_index == PARAM_CODE_COMMIT) {
    const A_long commitValue =
      parameters && parameters[PARAM_CODE_COMMIT]
        ? parameters[PARAM_CODE_COMMIT]->u.sd.value
        : 0;
    runtime_internal::AppendEffectUiDiagnostic(
      input,
      "code-editor-signal-enter",
      "commitValue=" +
        std::to_string(static_cast<long>(commitValue))
    );
    const PF_Err error = HandleCodeEditorSignal(input, parameters);
    runtime_internal::AppendEffectUiDiagnostic(
      input,
      error == PF_Err_NONE
        ? "code-editor-signal-handled"
        : "code-editor-signal-rejected",
      "commitValue=" +
        std::to_string(static_cast<long>(commitValue)) +
        " err=" + std::to_string(static_cast<long>(error))
    );
    return PF_Err_NONE;
  }

  if (changed->param_index == PARAM_CODE_SNAPSHOT) {
    const PF_Err error = ObserveCodeCueTimeline(
      input,
      parameters,
      "user-changed-param"
    );
    InvalidateEffectPersistentRenderCaches(
      runtime_internal::ResolveLiveEffectSessionId(input),
      "code-snapshot-changed"
    );
    return error;
  }

  if (changed->param_index == PARAM_DEFAULT_CODE) {
    InvalidateEffectPersistentRenderCaches(
      runtime_internal::ResolveLiveEffectSessionId(input),
      "code-snapshot-changed"
    );
    return PF_Err_NONE;
  }

  if (changed->param_index == PARAM_RESTART_CUE) {
    InvalidateEffectPersistentRenderCaches(
      runtime_internal::ResolveLiveEffectSessionId(input),
      "restart-cue-changed"
    );
    return PF_Err_NONE;
  }

  if (!IsControllerParamIndex(changed->param_index)) {
    return PF_Err_NONE;
  }

  int sliderSlot = -1;
  int angleParamSlot = -1;
  int colorSlot = -1;
  (void)TryMapSliderParamIndexToSlot(
    changed->param_index,
    &sliderSlot
  );
  const bool angleValueChanged = TryMapAngleValueParamIndexToSlot(
    changed->param_index,
    &angleParamSlot
  );
  const bool angleUiChanged = TryMapAngleUiParamIndexToSlot(
    changed->param_index,
    &angleParamSlot
  );
  const bool colorValueChanged = TryMapColorParamIndexToSlot(
    changed->param_index,
    &colorSlot
  );
  MarkControllerParamHistoryDirty(
    input,
    (angleValueChanged || angleUiChanged)
      ? ControllerAngleValueParamIndex(angleParamSlot)
      : colorValueChanged
        ? ControllerColorValueParamIndex(colorSlot)
        : changed->param_index,
    "controller-param-changed"
  );

  if (sliderSlot >= 0) {
    PF_ParamDef* sliderParam =
      parameters[ControllerSliderParamIndex(sliderSlot)];
    if (sliderParam) {
      const RuntimeSketchBundle bundle =
        ReadEffectRuntimeSketchBundle(input, parameters);
      const RuntimeSliderControllerSpec config =
        ResolveControllerSlotKind(bundle, sliderSlot) ==
            RuntimeControllerSlotKind::kSlider
          ? ResolveSliderControllerSpecWithDefaults(
              bundle,
              sliderSlot
            )
          : RuntimeSliderControllerSpec();
      const double rawValue =
        static_cast<double>(sliderParam->u.fs_d.value);
      const double snappedValue =
        ClampAndSnapSliderValue(rawValue, config);
      if (std::fabs(snappedValue - rawValue) > 1e-6) {
        sliderParam->u.fs_d.value =
          static_cast<PF_FpLong>(snappedValue);
        sliderParam->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
      }
    }
  }

  (void)output;
  return PF_Err_NONE;
}

PF_Err UpdateParamsUI(
  PF_InData* input,
  PF_OutData* output,
  PF_ParamDef* parameters[]
) {
  const PF_Err timelineError = ObserveCodeCueTimeline(
    input,
    parameters,
    "update-params-ui"
  );
  if (timelineError != PF_Err_NONE) {
    return timelineError;
  }
  const RuntimeSketchBundle bundle =
    ReadEffectRuntimeSketchBundle(input, parameters);
  const auto runtimeKey =
    runtime_internal::ResolveEffectRuntimeKey(input);
  const std::string appliedUiHash =
    GetEffectSessionControllerUiHash(runtimeKey);
  if (runtimeKey != 0 && !bundle.controllerHash.empty() &&
      appliedUiHash == bundle.controllerHash) {
    return PF_Err_NONE;
  }

  const PF_Err error =
    SyncControllerParamUI(input, output, parameters);
  if (error == PF_Err_NONE && runtimeKey != 0 &&
      !bundle.controllerHash.empty()) {
    SetEffectSessionControllerUiHash(
      runtimeKey,
      bundle.controllerHash
    );
  }
  return error;
}

PF_Err SyncControllerParamValuesFromBundle(
  PF_InData* input,
  PF_OutData* output,
  PF_ParamDef* parameters[],
  const RuntimeSketchBundle& bundle,
  const char* reason
) {
  if (!input || !parameters) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  for (int slot = 0; slot < kControllerSlotCount; ++slot) {
    const RuntimeControllerSlotKind kind =
      ResolveControllerSlotKind(bundle, slot);

    PF_ParamDef* pointParam =
      parameters[ControllerPointParamIndex(slot)];
    if (pointParam) {
      pointParam->u.td.x_value = DoubleToFixed(0.0);
      pointParam->u.td.y_value = DoubleToFixed(0.0);
      pointParam->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
    }

    PF_ParamDef* sliderParam =
      parameters[ControllerSliderParamIndex(slot)];
    if (sliderParam) {
      sliderParam->u.fs_d.value = 0.0;
      sliderParam->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
    }

    PF_ParamDef* colorParam =
      parameters[ControllerColorValueParamIndex(slot)];
    if (colorParam) {
      const PF_Err error = SetColorControllerParam(
        input,
        colorParam,
        MakeUnsetColorValue()
      );
      if (error != PF_Err_NONE) {
        return error;
      }
    }

    PF_ParamDef* checkboxParam =
      parameters[ControllerCheckboxParamIndex(slot)];
    if (checkboxParam) {
      checkboxParam->u.bd.value = FALSE;
      checkboxParam->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
    }

    PF_ParamDef* selectParam =
      parameters[ControllerSelectParamIndex(slot)];
    if (selectParam) {
      selectParam->u.pd.value = 1;
      selectParam->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
    }

    WriteAngleControllerValueToParams(parameters, slot, 0.0);

    switch (kind) {
      case RuntimeControllerSlotKind::kSlider: {
        PF_ParamDef* parameter =
          parameters[ControllerSliderParamIndex(slot)];
        if (parameter) {
          const RuntimeSliderControllerSpec config =
            ResolveSliderControllerSpecWithDefaults(bundle, slot);
          parameter->u.fs_d.value =
            ClampAndSnapSliderValue(config.defaultValue, config);
          parameter->uu.change_flags |=
            PF_ChangeFlag_CHANGED_VALUE;
        }
        break;
      }
      case RuntimeControllerSlotKind::kAngle: {
        const RuntimeAngleControllerSpec config =
          ResolveAngleControllerSpecWithDefaults(bundle, slot);
        WriteAngleControllerValueToParams(
          parameters,
          slot,
          config.defaultValue
        );
        break;
      }
      case RuntimeControllerSlotKind::kColor: {
        PF_ParamDef* parameter =
          parameters[ControllerColorValueParamIndex(slot)];
        if (!parameter) {
          break;
        }
        const PF_Err error = SetColorControllerParam(
          input,
          parameter,
          ResolveColorControllerSpecWithDefaults(bundle, slot).defaultValue
        );
        if (error != PF_Err_NONE) {
          return error;
        }
        break;
      }
      case RuntimeControllerSlotKind::kCheckbox: {
        PF_ParamDef* parameter =
          parameters[ControllerCheckboxParamIndex(slot)];
        if (parameter) {
          const RuntimeCheckboxControllerSpec config =
            ResolveCheckboxControllerSpecWithDefaults(bundle, slot);
          parameter->u.bd.value =
            config.defaultValue ? TRUE : FALSE;
          parameter->uu.change_flags |=
            PF_ChangeFlag_CHANGED_VALUE;
        }
        break;
      }
      case RuntimeControllerSlotKind::kSelect: {
        PF_ParamDef* parameter =
          parameters[ControllerSelectParamIndex(slot)];
        if (parameter) {
          const RuntimeSelectControllerSpec config =
            ResolveSelectControllerSpecWithDefaults(bundle, slot);
          parameter->u.pd.value = static_cast<A_short>(
            ClampSelectControllerIndex(config.defaultValue, config) + 1
          );
          parameter->uu.change_flags |=
            PF_ChangeFlag_CHANGED_VALUE;
        }
        break;
      }
      case RuntimeControllerSlotKind::kPoint: {
        PF_ParamDef* parameter =
          parameters[ControllerPointParamIndex(slot)];
        if (parameter) {
          const ControllerPointValue point =
            ResolvePointControllerDefaultValue(bundle, slot);
          parameter->u.td.x_value = DoubleToFixed(point.x);
          parameter->u.td.y_value = DoubleToFixed(point.y);
          parameter->uu.change_flags |=
            PF_ChangeFlag_CHANGED_VALUE;
        }
        break;
      }
      case RuntimeControllerSlotKind::kNone:
      default:
        break;
    }
  }

  std::ostringstream detail;
  detail
    << "reason=" << (reason ? reason : "unknown")
    << " controllerHash=" << bundle.controllerHash
    << " slots=" << bundle.controllerSlots.size();
  runtime_internal::AppendEffectRuntimeDiagnostic(
    input,
    "controller-defaults-applied",
    0,
    static_cast<PF_ParamIndex>(-1),
    0,
    detail.str()
  );
  (void)output;
  return PF_Err_NONE;
}

PF_Err ParamsSetup(PF_InData* in_data, PF_OutData* out_data) {
  PF_Err error = PF_Err_NONE;
  PF_ParamDef def;
  AEFX_CLR_STRUCT(def);
  def.flags =
    PF_ParamFlag_SUPERVISE |
    PF_ParamFlag_CANNOT_TIME_VARY;
  def.ui_flags = PF_PUI_INVISIBLE;

  PF_ADD_SLIDER(
    "Creation Token",
    0,
    2000000000,
    0,
    2000000000,
    0,
    kCreationTokenParamDiskId
  );

  PF_ArbitraryH codeDefaultHandle = NULL;
  error = AllocateCodeSnapshotHandle(
    in_data,
    CodeSnapshotValue(),
    &codeDefaultHandle
  );
  if (error != PF_Err_NONE || !codeDefaultHandle) {
    return error != PF_Err_NONE ? error : PF_Err_OUT_OF_MEMORY;
  }
  AEFX_CLR_STRUCT(def);
  PF_ADD_ARBITRARY2(
    "Code",
    kCodeControlUiWidth,
    kCodeControlUiHeight,
    PF_ParamFlag_NONE,
    kCodeControlUiFlags,
    codeDefaultHandle,
    kCodeSnapshotParamDiskId,
    CodeSnapshotArbitraryRefcon()
  );

  AEFX_CLR_STRUCT(def);
  def.flags =
    PF_ParamFlag_SUPERVISE |
    PF_ParamFlag_START_COLLAPSED;
  def.ui_flags = PF_PUI_CONTROL;
  def.ui_width = kRestartControlUiSize;
  def.ui_height = kRestartControlUiSize;
  PF_ADD_POPUP(
    "Restart",
    1,
    1,
    "Restart",
    kRestartCueParamDiskId
  );

  for (int slot = 0; slot < kControllerSlotCount; ++slot) {
    const std::string pointLabel =
      DefaultPointControllerLabel(slot);
    const std::string sliderLabel =
      DefaultSliderControllerLabel(slot);
    const std::string colorLabel =
      DefaultColorControllerLabel(slot);
    const std::string checkboxLabel =
      DefaultCheckboxControllerLabel(slot);
    const std::string selectLabel =
      DefaultSelectControllerLabel(slot);
    const std::string angleLabel = DefaultAngleControllerLabel(slot);
    const std::string angleUiLabel = DefaultAngleControllerLabel(slot);

    AEFX_CLR_STRUCT(def);
    def.flags = PF_ParamFlag_SUPERVISE;
    def.ui_flags = PF_PUI_NONE;
    PF_ADD_POINT(
      pointLabel.c_str(),
      0,
      0,
      FALSE,
      ControllerPointParamDiskId(slot)
    );

    AEFX_CLR_STRUCT(def);
    def.flags = PF_ParamFlag_SUPERVISE;
    def.ui_flags = PF_PUI_NONE;
    def.ui_width = 0;
    def.ui_height = 0;
    PF_ADD_FLOAT_SLIDER(
      sliderLabel.c_str(),
      static_cast<PF_FpShort>(kStaticSliderValidMin),
      static_cast<PF_FpShort>(kStaticSliderValidMax),
      0,
      100,
      AEFX_DEFAULT_CURVE_TOLERANCE,
      0,
      kControllerSliderPrecision,
      0,
      false,
      ControllerSliderParamDiskId(slot)
    );

    AEFX_CLR_STRUCT(def);
    def.flags = PF_ParamFlag_SUPERVISE;
    PF_ArbitraryH defaultColorHandle = NULL;
    error = AllocateColorArbHandle(
      in_data,
      MakeUnsetColorValue(),
      &defaultColorHandle
    );
    if (error != PF_Err_NONE) {
      return error;
    }
    PF_ADD_ARBITRARY2(
      colorLabel.c_str(),
      kColorControlUiWidth,
      kColorControlUiHeight,
      0,
      kColorControlUiFlags,
      defaultColorHandle,
      ControllerColorParamDiskId(slot),
      ColorArbitraryRefcon()
    );

    AEFX_CLR_STRUCT(def);
    def.flags = PF_ParamFlag_SUPERVISE;
    def.ui_flags = PF_PUI_NONE;
    PF_ADD_CHECKBOX(
      checkboxLabel.c_str(),
      "",
      FALSE,
      0,
      ControllerCheckboxParamDiskId(slot)
    );

    const std::string selectItems =
      BuildStaticSelectControllerPopupItems();
    AEFX_CLR_STRUCT(def);
    def.flags = PF_ParamFlag_SUPERVISE;
    def.ui_flags = PF_PUI_NONE;
    PF_ADD_POPUP(
      selectLabel.c_str(),
      static_cast<A_short>(kStaticSelectControllerChoiceCount),
      1,
      selectItems.c_str(),
      ControllerSelectParamDiskId(slot)
    );

    PF_FpShort angleValidMin = 0;
    PF_FpShort angleValidMax = 0;
    PF_FpShort angleSliderMin = 0;
    PF_FpShort angleSliderMax = 0;
    ResolveAngleUiRange(
      &angleValidMin,
      &angleValidMax,
      &angleSliderMin,
      &angleSliderMax
    );

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
      ControllerAngleValueParamDiskId(slot)
    );

    AEFX_CLR_STRUCT(def);
    def.flags = PF_ParamFlag_SUPERVISE;
    def.ui_flags = PF_PUI_INVISIBLE | PF_PUI_NO_ECW_UI;
    def.ui_width = 0;
    def.ui_height = 0;
    PF_ADD_SLIDER(
      angleUiLabel.c_str(),
      0,
      1,
      0,
      1,
      0,
      ControllerAngleUiParamDiskId(slot)
    );
  }

  AEFX_CLR_STRUCT(def);
  def.flags =
    PF_ParamFlag_SUPERVISE | PF_ParamFlag_CANNOT_TIME_VARY;
  def.ui_flags = PF_PUI_INVISIBLE;
  PF_ADD_SLIDER(
    "Code Edit Signal",
    0,
    1,
    0,
    1,
    0,
    kCodeCommitParamDiskId
  );

  PF_ArbitraryH defaultCodeDefaultHandle = NULL;
  error = AllocateCodeSnapshotHandle(
    in_data,
    CodeSnapshotValue(),
    &defaultCodeDefaultHandle
  );
  if (error != PF_Err_NONE || !defaultCodeDefaultHandle) {
    return error != PF_Err_NONE ? error : PF_Err_OUT_OF_MEMORY;
  }
  AEFX_CLR_STRUCT(def);
  PF_ADD_ARBITRARY2(
    "Default Code",
    0,
    0,
    PF_ParamFlag_CANNOT_TIME_VARY,
    PF_PUI_INVISIBLE | PF_PUI_NO_ECW_UI,
    defaultCodeDefaultHandle,
    kDefaultCodeParamDiskId,
    CodeSnapshotArbitraryRefcon()
  );

  out_data->out_flags =
    static_cast<PF_OutFlags>(MOMENTUM_EFFECT_OUT_FLAGS);
  out_data->out_flags2 =
    static_cast<PF_OutFlags2>(MOMENTUM_EFFECT_OUT_FLAGS2);
  if (error == PF_Err_NONE) {
    error = RegisterCustomUI(in_data);
  }
  out_data->num_params = PARAM_COUNT;
  return error;
}

}  // namespace momentum
