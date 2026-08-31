#pragma once

#include "host/ae_sdk.h"

namespace momentum {

PF_Err SequenceSetup(PF_InData* input, PF_OutData* output);
PF_Err SequenceResetup(PF_InData* input, PF_OutData* output);
PF_Err SequenceFlatten(PF_InData* input, PF_OutData* output);
PF_Err GetFlattenedSequenceData(PF_InData* input, PF_OutData* output);
PF_Err SequenceSetdown(PF_InData* input, PF_OutData* output);

}  // namespace momentum
