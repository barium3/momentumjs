#pragma once

#include <cstdint>

#include "host/ae_sdk.h"

namespace momentum {

struct SequenceCacheData {
  A_u_long magic = 0;
  A_u_long version = 0;
  // Process-local identity for this live Effect. It is created afresh on
  // Setup/Resetup (including duplication and project reopen) and is never
  // flattened into the AE project.
  std::uint64_t liveEffectSessionId = 0;
};

constexpr A_u_long kSequenceCacheDataMagic = 0x4D4F4D54UL;  // 'MOMT'
constexpr A_u_long kSequenceCacheDataLegacyVersion = 2;
constexpr A_u_long kSequenceCacheDataSnapshotVersion = 3;
constexpr A_u_long kSequenceCacheDataSharedRuntimeVersion = 4;
constexpr A_u_long kSequenceCacheDataDocumentVersion = 5;
constexpr A_u_long kSequenceCacheDataIdentityVersion = 6;
constexpr A_u_long kSequenceCacheDataVersion = 7;

enum class LiveEffectSessionMode {
  kReuseExisting,
  kCreateFresh,
};

PF_Err EnsureSequenceDataHandleInitialized(
  PF_InData* input,
  PF_OutData* output,
  PF_Handle* sequenceHandle,
  LiveEffectSessionMode mode
);

PF_Err CopyFlattenedSequenceData(PF_InData* input, PF_OutData* output);
void ClearSequenceDataOutput(PF_OutData* output);

}  // namespace momentum
