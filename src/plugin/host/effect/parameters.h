#pragma once

#include "host/ae_sdk.h"
#include "scripting/runtime/types.h"

namespace momentum {

bool TryMapAngleParamIndexToSlot(PF_ParamIndex paramIndex, int* slot);
bool TryMapColorParamIndexToSlot(PF_ParamIndex paramIndex, int* slot);
ControllerColorValue ReadColorControllerParam(
  PF_InData* input,
  PF_ParamDef* parameter,
  const ControllerColorValue& fallback
);
PF_Err SetColorControllerParam(
  PF_InData* input,
  PF_ParamDef* parameter,
  const ControllerColorValue& color
);
void MarkControllerParamHistoryDirty(
  PF_InData* input,
  PF_ParamIndex paramIndex,
  const char* reason
);
PF_Err PromptForColorControllerValue(
  PF_InData* input,
  PF_OutData* output,
  const ControllerColorValue& current,
  ControllerColorValue* selected
);

PF_Err SyncControllerParamValuesFromBundle(
  PF_InData* input,
  PF_OutData* output,
  PF_ParamDef* parameters[],
  const RuntimeSketchBundle& bundle,
  const char* reason
);

PF_Err ParamsSetup(PF_InData* input, PF_OutData* output);
PF_Err HandleUserChangedParam(
  PF_InData* input,
  PF_OutData* output,
  PF_ParamDef* parameters[],
  const PF_UserChangedParamExtra* changed
);
PF_Err HandleColorArbitraryCallbacks(
  PF_InData* input,
  PF_OutData* output,
  PF_ArbParamsExtra* extra
);
PF_Err UpdateParamsUI(
  PF_InData* input,
  PF_OutData* output,
  PF_ParamDef* parameters[]
);

}  // namespace momentum
