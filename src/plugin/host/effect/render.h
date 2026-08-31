#pragma once

#include <cstdint>

#include "host/ae_sdk.h"

namespace momentum {

std::uint64_t RegisterControllerInteractionChange(
  std::uint64_t liveEffectSessionId
);
void DiscardControllerInteractionState(
  std::uint64_t liveEffectSessionId
);

PF_Err QueryDynamicFlags(
  PF_InData* input,
  PF_OutData* output,
  PF_ParamDef* parameters[],
  void* extra
);
PF_Err PreRender(
  PF_InData* input,
  PF_OutData* output,
  PF_PreRenderExtra* extra
);
PF_Err SmartRender(
  PF_InData* input,
  PF_OutData* output,
  PF_SmartRenderExtra* extra,
  bool useGpu
);
PF_Err GPUDeviceSetup(
  PF_InData* input,
  PF_OutData* output,
  PF_GPUDeviceSetupExtra* extra
);
PF_Err GPUDeviceSetdown(
  PF_InData* input,
  PF_OutData* output,
  PF_GPUDeviceSetdownExtra* extra
);
PF_Err Render(
  PF_InData* input,
  PF_ParamDef* parameters[],
  PF_LayerDef* output
);

}  // namespace momentum
