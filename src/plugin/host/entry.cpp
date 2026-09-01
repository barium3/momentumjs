#include "host/effect/code_editor.h"
#include "host/effect/events.h"
#include "host/effect/parameters.h"
#include "host/effect/render.h"
#include "host/effect/sequence.h"
#include "host/code/snapshot.h"
#include "host/effect_contract.h"
#include "host/parameter_layout.h"
#include "host/version.h"
#include "rendering/bitmap/backends/gpu/renderer.h"
#include "scripting/runtime/core.h"
#include "scripting/runtime/internal.h"

#include "AE_PluginData.h"

#include <cstdio>
#include <cstdint>
#include <sstream>

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
  PF_OutFlag2_SUPPORTS_THREADED_RENDERING
#if defined(__APPLE__) || defined(_WIN32)
  | PF_OutFlag2_SUPPORTS_GPU_RENDER_F32
#endif
  ;

static_assert(
  kMomentumBaseOutFlags ==
    static_cast<PF_OutFlags>(MOMENTUM_EFFECT_OUT_FLAGS),
  "C++ and PiPL out_flags contract diverged"
);
static_assert(
  kMomentumBaseOutFlags2 ==
    static_cast<PF_OutFlags2>(MOMENTUM_EFFECT_OUT_FLAGS2),
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

void ApplyMomentumOutFlags(PF_OutData* output) {
  if (!output) {
    return;
  }
  output->out_flags = kMomentumBaseOutFlags;
  output->out_flags2 = kMomentumBaseOutFlags2;
}

PF_Err About(PF_OutData* output) {
  std::snprintf(
    output->return_msg,
    sizeof(output->return_msg),
    "Momentum v%d.%d\rPlugin-side JavaScript runtime renderer "
    "for Momentum sketches.",
    MOMENTUM_VERSION_MAJOR,
    MOMENTUM_VERSION_MINOR
  );
  return PF_Err_NONE;
}

PF_Err GlobalSetup(PF_InData* input, PF_OutData* output) {
  output->my_version = PF_VERSION(
    MOMENTUM_VERSION_MAJOR,
    MOMENTUM_VERSION_MINOR,
    MOMENTUM_VERSION_BUG,
    MOMENTUM_VERSION_STAGE,
    MOMENTUM_VERSION_BUILD
  );
  ApplyMomentumOutFlags(output);
  AEGP_PluginID pluginId = 0;
  (void)AcquireAegpPluginId(input, &pluginId);
  return PF_Err_NONE;
}

PF_Err GlobalSetdown(PF_InData* input, PF_OutData* output) {
  (void)output;
  ShutdownCodeEditor(input);
  ClearAllCachedSketches();
  bitmap::gpu::ClearAllCaches();
  return PF_Err_NONE;
}

const char* CommandName(PF_Cmd command) {
  switch (command) {
    case PF_Cmd_GLOBAL_SETUP: return "global-setup";
    case PF_Cmd_GLOBAL_SETDOWN: return "global-setdown";
    case PF_Cmd_PARAMS_SETUP: return "params-setup";
    case PF_Cmd_SEQUENCE_SETUP: return "sequence-setup";
    case PF_Cmd_SEQUENCE_RESETUP: return "sequence-resetup";
    case PF_Cmd_SEQUENCE_FLATTEN: return "sequence-flatten";
    case PF_Cmd_SEQUENCE_SETDOWN: return "sequence-setdown";
    case PF_Cmd_RENDER: return "render";
    case PF_Cmd_EVENT: return "event";
    case PF_Cmd_USER_CHANGED_PARAM: return "user-changed-param";
    case PF_Cmd_UPDATE_PARAMS_UI: return "update-params-ui";
    case PF_Cmd_QUERY_DYNAMIC_FLAGS: return "query-dynamic-flags";
    case PF_Cmd_SMART_PRE_RENDER: return "smart-prerender";
    case PF_Cmd_SMART_RENDER: return "smart-render-cpu";
    case PF_Cmd_SMART_RENDER_GPU: return "smart-render-gpu";
    case PF_Cmd_GPU_DEVICE_SETUP: return "gpu-device-setup";
    case PF_Cmd_GPU_DEVICE_SETDOWN: return "gpu-device-setdown";
    case PF_Cmd_GET_FLATTENED_SEQUENCE_DATA:
      return "get-flattened-sequence-data";
    default:
      return "other";
  }
}

bool ShouldTraceRenderCommand(PF_Cmd command) {
  return command == PF_Cmd_RENDER ||
    command == PF_Cmd_SMART_PRE_RENDER ||
    command == PF_Cmd_SMART_RENDER ||
    command == PF_Cmd_SMART_RENDER_GPU;
}

bool ShouldTraceUiCommand(PF_Cmd command, void* extra) {
  if (command == PF_Cmd_USER_CHANGED_PARAM ||
      command == PF_Cmd_UPDATE_PARAMS_UI) {
    return true;
  }
  if (command != PF_Cmd_EVENT || !extra) {
    return false;
  }
  const auto* event = reinterpret_cast<const PF_EventExtra*>(extra);
  return event->e_type == PF_Event_DO_CLICK ||
    event->e_type == PF_Event_DRAG;
}

void TraceCommandEnter(
  PF_Cmd command,
  PF_InData* input,
  PF_LayerDef* output,
  void* extra,
  bool traceRender,
  bool traceUi
) {
  const char* name = CommandName(command);
  if (traceRender) {
    std::ostringstream detail;
    detail
      << "cmd=" << static_cast<long>(command)
      << " name=" << name
      << " time=" << (input ? input->current_time : 0)
      << '/' << (input ? input->time_scale : 0)
      << " output=" << reinterpret_cast<std::uintptr_t>(output)
      << " extra=" << reinterpret_cast<std::uintptr_t>(extra);
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "command-enter",
      -1,
      static_cast<PF_ParamIndex>(-1),
      -1,
      detail.str()
    );
  }

  if (!traceUi) {
    return;
  }
  std::ostringstream detail;
  detail << "cmd=" << static_cast<long>(command) << " name=" << name;
  if (command == PF_Cmd_EVENT) {
    const auto* event = reinterpret_cast<const PF_EventExtra*>(extra);
    const PF_WindowType windowType =
      (event && event->contextH && *event->contextH)
        ? (*event->contextH)->w_type
        : PF_Window_NONE;
    detail
      << " eventType=" << (event ? static_cast<long>(event->e_type) : -1)
      << " windowType=" << static_cast<long>(windowType)
      << " area=" << (event ? static_cast<long>(event->effect_win.area) : -1)
      << " index=" << (event ? static_cast<long>(event->effect_win.index) : -1)
      << " inFlags=" << (event ? static_cast<unsigned long>(event->evt_in_flags) : 0)
      << " sendDrag=" << (event ? static_cast<long>(event->u.do_click.send_drag) : -1)
      << " lastTime=" << (event ? static_cast<long>(event->u.do_click.last_time) : -1);
  } else if (command == PF_Cmd_USER_CHANGED_PARAM) {
    const auto* changed =
      reinterpret_cast<const PF_UserChangedParamExtra*>(extra);
    detail << " paramIndex="
      << (changed ? static_cast<long>(changed->param_index) : -1);
  }
  runtime_internal::AppendEffectUiDiagnostic(
    input,
    "ui-command-enter",
    detail.str()
  );
}

void TraceCommandExit(
  PF_Cmd command,
  PF_InData* input,
  PF_OutData* outputData,
  PF_ParamDef* parameters[],
  void* extra,
  PF_Err error,
  bool traceRender,
  bool traceUi
) {
  const char* name = CommandName(command);
  if (traceRender) {
    std::ostringstream detail;
    detail
      << "cmd=" << static_cast<long>(command)
      << " name=" << name
      << " err=" << static_cast<long>(error)
      << " outFlags="
      << (outputData ? static_cast<unsigned long>(outputData->out_flags) : 0)
      << " outFlags2="
      << (outputData ? static_cast<unsigned long>(outputData->out_flags2) : 0);
    runtime_internal::AppendEffectRuntimeDiagnostic(
      input,
      "command-exit",
      -1,
      static_cast<PF_ParamIndex>(-1),
      -1,
      detail.str()
    );
  }

  if (!traceUi) {
    return;
  }
  std::ostringstream detail;
  detail
    << "cmd=" << static_cast<long>(command)
    << " name=" << name
    << " err=" << static_cast<long>(error)
    << " outFlags="
    << (outputData ? static_cast<unsigned long>(outputData->out_flags) : 0);
  if (command == PF_Cmd_EVENT) {
    const auto* event = reinterpret_cast<const PF_EventExtra*>(extra);
    const PF_ParamIndex index =
      event ? event->effect_win.index : static_cast<PF_ParamIndex>(-1);
    const PF_ChangeFlags changeFlags =
      parameters && index >= 0 && index < PARAM_COUNT && parameters[index]
        ? parameters[index]->uu.change_flags
        : PF_ChangeFlag_NONE;
    detail
      << " eventType=" << (event ? static_cast<long>(event->e_type) : -1)
      << " outEventFlags="
      << (event ? static_cast<unsigned long>(event->evt_out_flags) : 0)
      << " sendDrag=" << (event ? static_cast<long>(event->u.do_click.send_drag) : -1)
      << " lastTime=" << (event ? static_cast<long>(event->u.do_click.last_time) : -1)
      << " changeFlags=" << static_cast<unsigned long>(changeFlags);
  }
  runtime_internal::AppendEffectUiDiagnostic(
    input,
    "ui-command-exit",
    detail.str()
  );
}

PF_Err RouteCommand(
  PF_Cmd command,
  PF_InData* input,
  PF_OutData* outputData,
  PF_ParamDef* parameters[],
  PF_LayerDef* output,
  void* extra
) {
  switch (command) {
    case PF_Cmd_ABOUT:
      return About(outputData);
    case PF_Cmd_GLOBAL_SETUP:
      return GlobalSetup(input, outputData);
    case PF_Cmd_GLOBAL_SETDOWN:
      return GlobalSetdown(input, outputData);
    case PF_Cmd_PARAMS_SETUP:
      return ParamsSetup(input, outputData);
    case PF_Cmd_SEQUENCE_SETUP:
      return SequenceSetup(input, outputData);
    case PF_Cmd_SEQUENCE_RESETUP:
      return SequenceResetup(input, outputData);
    case PF_Cmd_SEQUENCE_FLATTEN:
      return SequenceFlatten(input, outputData);
    case PF_Cmd_SEQUENCE_SETDOWN:
      return SequenceSetdown(input, outputData);
    case PF_Cmd_RENDER:
      return Render(input, parameters, output);
    case PF_Cmd_EVENT:
      return HandleCustomEffectUIEvent(
        input,
        outputData,
        parameters,
        reinterpret_cast<PF_EventExtra*>(extra)
      );
    case PF_Cmd_USER_CHANGED_PARAM:
      return HandleUserChangedParam(
        input,
        outputData,
        parameters,
        reinterpret_cast<const PF_UserChangedParamExtra*>(extra)
      );
    case PF_Cmd_ARBITRARY_CALLBACK: {
      auto* arbitrary = reinterpret_cast<PF_ArbParamsExtra*>(extra);
      return arbitrary &&
          (arbitrary->id == kCodeSnapshotParamDiskId ||
           arbitrary->id == kDefaultCodeParamDiskId)
        ? HandleCodeSnapshotArbitraryCallbacks(input, outputData, arbitrary)
        : HandleColorArbitraryCallbacks(input, outputData, arbitrary);
    }
    case PF_Cmd_QUERY_DYNAMIC_FLAGS:
      return QueryDynamicFlags(input, outputData, parameters, extra);
    case PF_Cmd_UPDATE_PARAMS_UI:
      return UpdateParamsUI(input, outputData, parameters);
    case PF_Cmd_SMART_PRE_RENDER:
      return PreRender(
        input,
        outputData,
        reinterpret_cast<PF_PreRenderExtra*>(extra)
      );
    case PF_Cmd_SMART_RENDER:
      return SmartRender(
        input,
        outputData,
        reinterpret_cast<PF_SmartRenderExtra*>(extra),
        false
      );
    case PF_Cmd_SMART_RENDER_GPU:
      return SmartRender(
        input,
        outputData,
        reinterpret_cast<PF_SmartRenderExtra*>(extra),
        true
      );
    case PF_Cmd_GPU_DEVICE_SETUP:
      return GPUDeviceSetup(
        input,
        outputData,
        reinterpret_cast<PF_GPUDeviceSetupExtra*>(extra)
      );
    case PF_Cmd_GPU_DEVICE_SETDOWN:
      return GPUDeviceSetdown(
        input,
        outputData,
        reinterpret_cast<PF_GPUDeviceSetdownExtra*>(extra)
      );
    case PF_Cmd_GET_FLATTENED_SEQUENCE_DATA:
      return GetFlattenedSequenceData(input, outputData);
    default:
      return PF_Err_NONE;
  }
}

}  // namespace

PF_Err DispatchEffectCommand(
  PF_Cmd command,
  PF_InData* input,
  PF_OutData* outputData,
  PF_ParamDef* parameters[],
  PF_LayerDef* output,
  void* extra
) {
  if (outputData && command != PF_Cmd_QUERY_DYNAMIC_FLAGS) {
    AEFX_CLR_STRUCT(*outputData);
  }

  const bool traceRender = ShouldTraceRenderCommand(command);
  const bool traceUi = ShouldTraceUiCommand(command, extra);
  TraceCommandEnter(
    command,
    input,
    output,
    extra,
    traceRender,
    traceUi
  );
  const PF_Err error = RouteCommand(
    command,
    input,
    outputData,
    parameters,
    output,
    extra
  );
  TraceCommandExit(
    command,
    input,
    outputData,
    parameters,
    extra,
    error,
    traceRender,
    traceUi
  );
  return error;
}

}  // namespace momentum

extern "C" DllExport
#ifdef PF_REGISTER_EFFECT_EXT2
PF_Err PluginDataEntryFunction2(
  PF_PluginDataPtr input,
  PF_PluginDataCB2 registerEffect,
  SPBasicSuite* suites,
  const char* hostName,
  const char* hostVersion
) {
  (void)suites;
  (void)hostName;
  (void)hostVersion;

  PF_Err result = PF_Err_INVALID_CALLBACK;
  PF_REGISTER_EFFECT_EXT2(
    input,
    registerEffect,
    "Momentum",
    "Momentum",
    "Momentum",
    AE_RESERVED_INFO,
    "EffectMain",
    "https://github.com/barium3/momentum"
  );
  return result;
}
#else
PF_Err PluginDataEntryFunction(
  PF_PluginDataPtr input,
  PF_PluginDataCB registerEffect,
  SPBasicSuite* suites,
  const char* hostName,
  const char* hostVersion
) {
  (void)suites;
  (void)hostName;
  (void)hostVersion;

  PF_Err result = PF_Err_INVALID_CALLBACK;
  PF_REGISTER_EFFECT(
    input,
    registerEffect,
    "Momentum",
    "Momentum",
    "Momentum",
    AE_RESERVED_INFO
  );
  return result;
}
#endif

extern "C" DllExport
PF_Err EffectMain(
  PF_Cmd command,
  PF_InData* input,
  PF_OutData* outputData,
  PF_ParamDef* parameters[],
  PF_LayerDef* output,
  void* extra
) {
  return momentum::DispatchEffectCommand(
    command,
    input,
    outputData,
    parameters,
    output,
    extra
  );
}
