#include "host/sequence_data.h"

#include <atomic>
#include <chrono>
#include <cstring>

#include "scripting/runtime/core.h"
#include "scripting/runtime/internal.h"

namespace momentum {

using runtime_internal::ResolveEffectRuntimeKey;

namespace {

void DiscardEffectRuntimeState(
  runtime_internal::EffectRuntimeKey runtimeKey,
  const char* reason
) {
  if (runtimeKey) {
    ClearCachedSketchByKey(runtimeKey, reason);
  }
}

struct SequenceDataHeader {
  A_u_long magic = 0;
  A_u_long version = 0;
};

bool IsCompatibleSequenceDataVersion(A_u_long version) {
  return
    version == kSequenceCacheDataLegacyVersion ||
    version == kSequenceCacheDataSnapshotVersion ||
    version == kSequenceCacheDataSharedRuntimeVersion ||
    version == kSequenceCacheDataDocumentVersion ||
    version == kSequenceCacheDataIdentityVersion ||
    version == kSequenceCacheDataVersion;
}

std::uint64_t NextLiveEffectSessionId() {
  static std::atomic<std::uint64_t> nextIdentity{
    static_cast<std::uint64_t>(
      std::chrono::high_resolution_clock::now().time_since_epoch().count()
    ) | 1ULL
  };
  std::uint64_t identity = nextIdentity.fetch_add(2, std::memory_order_relaxed);
  if (identity == 0) {
    identity = nextIdentity.fetch_add(2, std::memory_order_relaxed);
  }
  return identity;
}


bool ReadCompatibleSequenceData(
  PF_InData* in_data,
  PF_ConstHandle handle,
  SequenceCacheData* outHeader
) {
  if (!in_data || !handle || !outHeader) {
    return false;
  }

  const auto handleSize = PF_GET_HANDLE_SIZE(handle);
  if (handleSize < sizeof(SequenceDataHeader)) {
    return false;
  }

  const auto* header = reinterpret_cast<const SequenceDataHeader*>(DH(handle));
  if (!header ||
      header->magic != kSequenceCacheDataMagic ||
      !IsCompatibleSequenceDataVersion(header->version)) {
    return false;
  }

  AEFX_CLR_STRUCT(*outHeader);
  outHeader->magic = header->magic;
  outHeader->version = header->version;
  if (header->version == kSequenceCacheDataVersion &&
      handleSize >= sizeof(SequenceCacheData)) {
    const auto* sequenceData = reinterpret_cast<const SequenceCacheData*>(header);
    outHeader->liveEffectSessionId = sequenceData->liveEffectSessionId;
  }
  return true;
}

}  // namespace

PF_Err EnsureSequenceDataHandleInitialized(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_Handle* outHandle,
  LiveEffectSessionMode sessionMode
) {
  if (!in_data || !outHandle) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  const auto previousRuntimeKey = ResolveEffectRuntimeKey(in_data);
  PF_Handle handle = in_data->sequence_data;
  const PF_ConstHandle sourceHandle = handle
    ? reinterpret_cast<PF_ConstHandle>(handle)
    : runtime_internal::ResolveEffectSequenceDataHandle(in_data);
  SequenceCacheData header;
  const bool hadCompatibleHeader =
    ReadCompatibleSequenceData(in_data, sourceHandle, &header);

  if (sessionMode == LiveEffectSessionMode::kReuseExisting &&
      handle &&
      hadCompatibleHeader &&
      header.version == kSequenceCacheDataVersion &&
      header.liveEffectSessionId != 0 &&
      PF_GET_HANDLE_SIZE(handle) >= sizeof(SequenceCacheData)) {
    if (out_data) {
      out_data->sequence_data = handle;
    }
    *outHandle = handle;
    return PF_Err_NONE;
  }

  const std::size_t requiredSize = sizeof(SequenceCacheData);

  PF_Err err = PF_Err_NONE;
  if (!handle) {
    handle = PF_NEW_HANDLE(static_cast<A_u_long>(requiredSize));
    if (!handle) {
      return PF_Err_OUT_OF_MEMORY;
    }
  } else {
    err = PF_RESIZE_HANDLE(static_cast<A_u_long>(requiredSize), &handle);
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
  sequenceData->liveEffectSessionId = NextLiveEffectSessionId();

  in_data->sequence_data = handle;
  if (out_data) {
    out_data->sequence_data = handle;
  }
  const auto currentRuntimeKey = ResolveEffectRuntimeKey(in_data);
  // A fresh session is requested by AE lifecycle selectors such as Resetup.
  // The prior token can belong to the source effect when AE has duplicated the
  // sequence handle in memory, so deleting it here would invalidate the source
  // effect's UI state. Reuse-mode replacements own their prior session and may
  // safely retire it.
  if (sessionMode == LiveEffectSessionMode::kReuseExisting &&
      previousRuntimeKey &&
      previousRuntimeKey != currentRuntimeKey) {
    DiscardEffectRuntimeState(previousRuntimeKey, "sequence-handle-replaced");
  }
  *outHandle = handle;
  return PF_Err_NONE;
}

PF_Err CopyFlattenedSequenceData(PF_InData* in_data, PF_OutData* out_data) {
  if (!out_data) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  const PF_ConstHandle sourceHandle =
    runtime_internal::ResolveEffectSequenceDataHandle(in_data);
  if (!in_data || !sourceHandle) {
    out_data->sequence_data = NULL;
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  const auto handleSize = PF_GET_HANDLE_SIZE(sourceHandle);
  PF_Handle copyHandle = PF_NEW_HANDLE(handleSize);
  if (!copyHandle) {
    return PF_Err_OUT_OF_MEMORY;
  }

  void* destination = DH(copyHandle);
  const void* source = DH(sourceHandle);
  if (!destination || !source) {
    PF_DISPOSE_HANDLE(copyHandle);
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  std::memcpy(destination, source, handleSize);
  auto* flattenedData = reinterpret_cast<SequenceCacheData*>(destination);
  if (flattenedData &&
      flattenedData->magic == kSequenceCacheDataMagic &&
      flattenedData->version == kSequenceCacheDataVersion) {
    // Sequence Data now carries lifecycle identity only. Process-local UI
    // identity must never enter a duplicate, render worker, or reopened
    // project; Code documents live in AE parameter streams.
    flattenedData->liveEffectSessionId = 0;
  }
  out_data->sequence_data = copyHandle;
  return PF_Err_NONE;
}

void ClearSequenceDataOutput(PF_OutData* out_data) {
  if (out_data) {
    out_data->sequence_data = NULL;
  }
}

}  // namespace momentum
