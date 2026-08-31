#include "host/effect/sequence.h"

#include "host/code/timeline.h"
#include "host/effect/render.h"
#include "host/sequence_data.h"
#include "scripting/runtime/core.h"
#include "scripting/runtime/internal.h"

#include <cstdint>
#include <sstream>

namespace momentum {

namespace {

using runtime_internal::ResolveEffectRuntimeKey;
using runtime_internal::ResolveLiveEffectSessionId;

void DiscardRuntime(
  runtime_internal::EffectRuntimeKey runtimeKey,
  const char* reason
) {
  if (runtimeKey) {
    ClearCachedSketchByKey(runtimeKey, reason);
  }
}

PF_Err ResetSequence(
  PF_InData* input,
  PF_OutData* output,
  const char* diagnosticName
) {
  if (!input) {
    return PF_Err_NONE;
  }

  const auto previousSessionId = ResolveEffectRuntimeKey(input);
  PF_Handle sequenceHandle = NULL;
  const PF_Err err = EnsureSequenceDataHandleInitialized(
    input,
    output,
    &sequenceHandle,
    LiveEffectSessionMode::kCreateFresh
  );
  if (err != PF_Err_NONE) {
    return err;
  }

  const auto currentSessionId = ResolveEffectRuntimeKey(input);
  if (previousSessionId != currentSessionId) {
    DiscardKnownCodeCueTimeline(previousSessionId);
  }
  if (output) {
    output->out_flags |= PF_OutFlag_REFRESH_UI;
  }

  std::ostringstream detail;
  detail
    << diagnosticName
    << " previousLiveEffectSession=" << previousSessionId
    << " currentLiveEffectSession=" << currentSessionId;
  runtime_internal::AppendEffectRuntimeDiagnostic(
    input,
    "live-effect-session-created",
    0,
    static_cast<PF_ParamIndex>(-1),
    0,
    detail.str()
  );
  return PF_Err_NONE;
}

}  // namespace

PF_Err SequenceSetup(PF_InData* input, PF_OutData* output) {
  return ResetSequence(input, output, "sequence-setup");
}

PF_Err SequenceResetup(PF_InData* input, PF_OutData* output) {
  return ResetSequence(input, output, "sequence-resetup");
}

PF_Err SequenceFlatten(PF_InData* input, PF_OutData* output) {
  return CopyFlattenedSequenceData(input, output);
}

PF_Err GetFlattenedSequenceData(PF_InData* input, PF_OutData* output) {
  return CopyFlattenedSequenceData(input, output);
}

PF_Err SequenceSetdown(PF_InData* in_data, PF_OutData* output) {
  // PF_DISPOSE_HANDLE is an AE SDK macro that requires this exact local name.
  const auto runtimeKey = ResolveEffectRuntimeKey(in_data);
  const auto liveEffectSessionId = ResolveLiveEffectSessionId(in_data);
  if (runtimeKey) {
    InvalidateEffectPersistentRenderCaches(
      liveEffectSessionId,
      "sequence-setdown"
    );
  }
  DiscardKnownCodeCueTimeline(liveEffectSessionId);
  DiscardControllerInteractionState(liveEffectSessionId);
  DiscardRuntime(runtimeKey, "sequence-setdown");
  if (in_data && in_data->sequence_data) {
    PF_DISPOSE_HANDLE(in_data->sequence_data);
    in_data->sequence_data = NULL;
  }
  ClearSequenceDataOutput(output);
  return PF_Err_NONE;
}

}  // namespace momentum
