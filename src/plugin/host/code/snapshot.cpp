#include "host/code/snapshot.h"

#include "scripting/runtime/internal.h"

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <sstream>

namespace momentum {

namespace {

constexpr A_u_long kCodeSnapshotMagic = 0x4D434F44UL;  // 'MCOD'
constexpr A_u_long kCodeSnapshotVersion = 3;
constexpr std::size_t kMaxCodeSnapshotBytes = 64ULL * 1024ULL * 1024ULL;
constexpr A_u_long kCodeArbPrintBufferSize = 64;

struct CodeSnapshotHeader {
  A_u_long magic = kCodeSnapshotMagic;
  A_u_long version = kCodeSnapshotVersion;
  A_u_long transitionMode = kCodeSnapshotTransitionRestart;
  A_u_long sourceTextSize = 0;
  A_u_long bundleTextSize = 0;
};

struct CodeSnapshotHeaderV2 {
  A_u_long magic = kCodeSnapshotMagic;
  A_u_long version = 2;
  A_u_long transitionMode = kCodeSnapshotTransitionRestart;
  A_u_long sourceTextSize = 0;
  A_u_long bundleTextSize = 0;
  A_long startTimeValue = 0;
  A_long startTimeScale = 1;
};

char gCodeSnapshotArbitraryRefconTag = 0;

bool IsCodeSnapshotValidSize(std::size_t sourceSize, std::size_t bundleSize) {
  return
    sourceSize <= kMaxCodeSnapshotBytes &&
    bundleSize <= kMaxCodeSnapshotBytes &&
    sourceSize + bundleSize <= kMaxCodeSnapshotBytes;
}

}  // namespace

void* CodeSnapshotArbitraryRefcon() {
  return &gCodeSnapshotArbitraryRefconTag;
}

std::string NormalizeCodeSourceText(const std::string& text) {
  std::size_t start = 0;
  if (text.size() >= 3 &&
      static_cast<unsigned char>(text[0]) == 0xEF &&
      static_cast<unsigned char>(text[1]) == 0xBB &&
      static_cast<unsigned char>(text[2]) == 0xBF) {
    start = 3;
  }
  std::string normalized;
  normalized.reserve(text.size() - start);
  for (std::size_t index = start; index < text.size(); ++index) {
    if (text[index] == '\r') {
      normalized.push_back('\n');
      if (index + 1 < text.size() && text[index + 1] == '\n') {
        ++index;
      }
    } else {
      normalized.push_back(text[index]);
    }
  }
  while (!normalized.empty() && normalized.back() == '\n') {
    normalized.pop_back();
  }
  return normalized;
}

bool CodeSourcesAreEquivalent(
  const RuntimeSketchBundle& left,
  const RuntimeSketchBundle& right
) {
  if (!left.codeCueSemanticHash.empty() &&
      !right.codeCueSemanticHash.empty()) {
    return left.codeCueSemanticHash == right.codeCueSemanticHash;
  }
  return
    left.hasEmbeddedSource &&
    right.hasEmbeddedSource &&
    left.sourceText == right.sourceText;
}

PF_Err AllocateCodeSnapshotHandle(
  PF_InData* in_data,
  const CodeSnapshotValue& snapshot,
  PF_ArbitraryH* outHandle
) {
  if (!in_data || !outHandle ||
      !IsCodeSnapshotValidSize(snapshot.sourceText.size(), snapshot.bundleText.size())) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  const std::size_t handleSize =
    sizeof(CodeSnapshotHeader) +
    snapshot.sourceText.size() +
    snapshot.bundleText.size();
  PF_Handle handle = PF_NEW_HANDLE(static_cast<A_u_long>(handleSize));
  if (!handle) {
    return PF_Err_OUT_OF_MEMORY;
  }
  auto* header =
    reinterpret_cast<CodeSnapshotHeader*>(PF_LOCK_HANDLE(handle));
  if (!header) {
    PF_DISPOSE_HANDLE(handle);
    return PF_Err_OUT_OF_MEMORY;
  }
  header->magic = kCodeSnapshotMagic;
  header->version = kCodeSnapshotVersion;
  header->transitionMode =
    snapshot.transitionMode == kCodeSnapshotTransitionSoft
      ? kCodeSnapshotTransitionSoft
      : kCodeSnapshotTransitionRestart;
  header->sourceTextSize = static_cast<A_u_long>(snapshot.sourceText.size());
  header->bundleTextSize = static_cast<A_u_long>(snapshot.bundleText.size());
  char* payload = reinterpret_cast<char*>(header + 1);
  if (!snapshot.sourceText.empty()) {
    std::memcpy(payload, snapshot.sourceText.data(), snapshot.sourceText.size());
  }
  if (!snapshot.bundleText.empty()) {
    std::memcpy(
      payload + snapshot.sourceText.size(),
      snapshot.bundleText.data(),
      snapshot.bundleText.size()
    );
  }
  PF_UNLOCK_HANDLE(handle);
  *outHandle = handle;
  return PF_Err_NONE;
}

bool ReadCodeSnapshotHandle(
  PF_InData* in_data,
  PF_ArbitraryH handle,
  CodeSnapshotValue* outSnapshot
) {
  if (!in_data || !handle || !outSnapshot ||
      PF_GET_HANDLE_SIZE(handle) < sizeof(CodeSnapshotHeader)) {
    return false;
  }
  const auto* header =
    reinterpret_cast<const CodeSnapshotHeader*>(PF_LOCK_HANDLE(handle));
  if (!header) {
    return false;
  }
  const bool isV1 =
    header->magic == kCodeSnapshotMagic && header->version == 1;
  const bool isV2 =
    header->magic == kCodeSnapshotMagic &&
    header->version == 2 &&
    PF_GET_HANDLE_SIZE(handle) >= sizeof(CodeSnapshotHeaderV2);
  const bool isV3 =
    header->magic == kCodeSnapshotMagic &&
    header->version == kCodeSnapshotVersion;
  const std::size_t headerSize =
    isV2 ? sizeof(CodeSnapshotHeaderV2) : sizeof(CodeSnapshotHeader);
  const std::size_t sourceSize = header->sourceTextSize;
  const std::size_t bundleSize = header->bundleTextSize;
  const std::size_t expectedSize = headerSize + sourceSize + bundleSize;
  const bool valid =
    (isV1 || isV2 || isV3) &&
    IsCodeSnapshotValidSize(sourceSize, bundleSize) &&
    expectedSize == PF_GET_HANDLE_SIZE(handle);
  if (valid) {
    const char* payload = reinterpret_cast<const char*>(header) + headerSize;
    outSnapshot->transitionMode =
      header->transitionMode == kCodeSnapshotTransitionSoft
        ? kCodeSnapshotTransitionSoft
        : kCodeSnapshotTransitionRestart;
    outSnapshot->sourceText.assign(payload, sourceSize);
    outSnapshot->bundleText.assign(payload + sourceSize, bundleSize);
  }
  PF_UNLOCK_HANDLE(handle);
  return valid;
}

bool ReadCodeSnapshotHandleWithSuite(
  const PF_HandleSuite1* handleSuite,
  PF_ArbitraryH handle,
  CodeSnapshotValue* outSnapshot
) {
  if (!handleSuite || !handle || !outSnapshot ||
      handleSuite->host_get_handle_size(handle) < sizeof(CodeSnapshotHeader)) {
    return false;
  }
  const auto* header = reinterpret_cast<const CodeSnapshotHeader*>(
    handleSuite->host_lock_handle(handle)
  );
  if (!header) {
    return false;
  }
  const A_HandleSize handleSize = handleSuite->host_get_handle_size(handle);
  const bool isV1 = header->magic == kCodeSnapshotMagic && header->version == 1;
  const bool isV2 = header->magic == kCodeSnapshotMagic &&
    header->version == 2 && handleSize >= sizeof(CodeSnapshotHeaderV2);
  const bool isV3 = header->magic == kCodeSnapshotMagic &&
    header->version == kCodeSnapshotVersion;
  const std::size_t headerSize =
    isV2 ? sizeof(CodeSnapshotHeaderV2) : sizeof(CodeSnapshotHeader);
  const std::size_t sourceSize = header->sourceTextSize;
  const std::size_t bundleSize = header->bundleTextSize;
  const bool valid = (isV1 || isV2 || isV3) &&
    IsCodeSnapshotValidSize(sourceSize, bundleSize) &&
    headerSize + sourceSize + bundleSize == handleSize;
  if (valid) {
    const char* payload = reinterpret_cast<const char*>(header) + headerSize;
    outSnapshot->transitionMode =
      header->transitionMode == kCodeSnapshotTransitionSoft
        ? kCodeSnapshotTransitionSoft
        : kCodeSnapshotTransitionRestart;
    outSnapshot->sourceText.assign(payload, sourceSize);
    outSnapshot->bundleText.assign(payload + sourceSize, bundleSize);
  }
  handleSuite->host_unlock_handle(handle);
  return valid;
}

std::string DescribeCodeSnapshotHandle(
  PF_InData* in_data,
  PF_ArbitraryH handle
) {
  std::ostringstream detail;
  detail << "handle=" << reinterpret_cast<std::uintptr_t>(handle);
  if (!in_data || !handle) {
    detail << " bytes=0 valid=0";
    return detail.str();
  }

  const auto handleSize = PF_GET_HANDLE_SIZE(handle);
  CodeSnapshotValue snapshot;
  const bool valid = ReadCodeSnapshotHandle(in_data, handle, &snapshot);
  detail
    << " bytes=" << handleSize
    << " valid=" << (valid ? 1 : 0);
  if (valid) {
    detail
      << " sourceBytes=" << snapshot.sourceText.size()
      << " bundleBytes=" << snapshot.bundleText.size()
      << " transition=" << snapshot.transitionMode;
  }
  return detail.str();
}

RuntimeSketchBundle ReadRuntimeSketchBundleFromCodeSnapshot(
  PF_InData* in_data,
  PF_ArbitraryH handle,
  const std::string& defaultSourcePath,
  std::string* errorMessage
) {
  CodeSnapshotValue snapshot;
  if (!ReadCodeSnapshotHandle(in_data, handle, &snapshot) ||
      snapshot.sourceText.empty() ||
      snapshot.bundleText.empty()) {
    return RuntimeSketchBundle();
  }
  RuntimeSketchBundle bundle = runtime_internal::ReadRuntimeSketchBundleFromText(
    snapshot.bundleText,
    defaultSourcePath,
    errorMessage
  );
  bundle.sourceText = NormalizeCodeSourceText(snapshot.sourceText);
  bundle.hasEmbeddedSource = true;
  return bundle;
}

PF_Err HandleCodeSnapshotArbitraryCallbacks(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ArbParamsExtra* extra
) {
  (void)out_data;
  if (!in_data || !extra) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  auto copyHandle = [&](PF_ArbitraryH source, PF_ArbitraryH* destination) -> PF_Err {
    CodeSnapshotValue snapshot;
    if (source && !ReadCodeSnapshotHandle(in_data, source, &snapshot)) {
      return PF_Err_BAD_CALLBACK_PARAM;
    }
    return AllocateCodeSnapshotHandle(in_data, snapshot, destination);
  };

  switch (extra->which_function) {
    case PF_Arbitrary_NEW_FUNC:
      if (extra->u.new_func_params.refconPV != CodeSnapshotArbitraryRefcon()) {
        return PF_Err_NONE;
      }
      return AllocateCodeSnapshotHandle(
        in_data,
        CodeSnapshotValue(),
        extra->u.new_func_params.arbPH
      );

    case PF_Arbitrary_DISPOSE_FUNC:
      if (extra->u.dispose_func_params.refconPV != CodeSnapshotArbitraryRefcon()) {
        return PF_Err_NONE;
      }
      if (extra->u.dispose_func_params.arbH) {
        PF_DISPOSE_HANDLE(extra->u.dispose_func_params.arbH);
      }
      return PF_Err_NONE;

    case PF_Arbitrary_COPY_FUNC:
      if (extra->u.copy_func_params.refconPV != CodeSnapshotArbitraryRefcon()) {
        return PF_Err_NONE;
      }
      return copyHandle(
        extra->u.copy_func_params.src_arbH,
        extra->u.copy_func_params.dst_arbPH
      );

    case PF_Arbitrary_FLAT_SIZE_FUNC:
      if (!extra->u.flat_size_func_params.arbH ||
          !extra->u.flat_size_func_params.flat_data_sizePLu) {
        return PF_Err_BAD_CALLBACK_PARAM;
      }
      *extra->u.flat_size_func_params.flat_data_sizePLu =
        static_cast<A_u_long>(
          PF_GET_HANDLE_SIZE(extra->u.flat_size_func_params.arbH)
        );
      return PF_Err_NONE;

    case PF_Arbitrary_FLATTEN_FUNC: {
      PF_ArbitraryH handle = extra->u.flatten_func_params.arbH;
      if (!handle || !extra->u.flatten_func_params.flat_dataPV) {
        return PF_Err_BAD_CALLBACK_PARAM;
      }
      const A_u_long handleSize =
        static_cast<A_u_long>(PF_GET_HANDLE_SIZE(handle));
      if (extra->u.flatten_func_params.buf_sizeLu < handleSize) {
        return PF_Err_BAD_CALLBACK_PARAM;
      }
      const void* data = PF_LOCK_HANDLE(handle);
      if (!data) {
        return PF_Err_OUT_OF_MEMORY;
      }
      std::memcpy(extra->u.flatten_func_params.flat_dataPV, data, handleSize);
      PF_UNLOCK_HANDLE(handle);
      return PF_Err_NONE;
    }

    case PF_Arbitrary_UNFLATTEN_FUNC: {
      const A_u_long dataSize = extra->u.unflatten_func_params.buf_sizeLu;
      if (!extra->u.unflatten_func_params.flat_dataPV ||
          !extra->u.unflatten_func_params.arbPH ||
          dataSize < sizeof(CodeSnapshotHeader) ||
          dataSize > kMaxCodeSnapshotBytes + sizeof(CodeSnapshotHeaderV2)) {
        return PF_Err_BAD_CALLBACK_PARAM;
      }
      PF_Handle handle = PF_NEW_HANDLE(dataSize);
      if (!handle) {
        return PF_Err_OUT_OF_MEMORY;
      }
      void* data = PF_LOCK_HANDLE(handle);
      if (!data) {
        PF_DISPOSE_HANDLE(handle);
        return PF_Err_OUT_OF_MEMORY;
      }
      std::memcpy(data, extra->u.unflatten_func_params.flat_dataPV, dataSize);
      PF_UNLOCK_HANDLE(handle);
      CodeSnapshotValue snapshot;
      if (!ReadCodeSnapshotHandle(in_data, handle, &snapshot)) {
        PF_DISPOSE_HANDLE(handle);
        return PF_Err_BAD_CALLBACK_PARAM;
      }
      *extra->u.unflatten_func_params.arbPH = handle;
      return PF_Err_NONE;
    }

    case PF_Arbitrary_INTERP_FUNC: {
      PF_ArbitraryH source =
        extra->u.interp_func_params.tF >= 1.0
          ? extra->u.interp_func_params.right_arbH
          : extra->u.interp_func_params.left_arbH;
      return copyHandle(source, extra->u.interp_func_params.interpPH);
    }

    case PF_Arbitrary_COMPARE_FUNC: {
      CodeSnapshotValue left;
      CodeSnapshotValue right;
      if (!ReadCodeSnapshotHandle(
            in_data,
            extra->u.compare_func_params.a_arbH,
            &left
          ) ||
          !ReadCodeSnapshotHandle(
            in_data,
            extra->u.compare_func_params.b_arbH,
            &right
          )) {
        return PF_Err_BAD_CALLBACK_PARAM;
      }
      const std::string leftBytes = left.sourceText + '\0' + left.bundleText;
      const std::string rightBytes = right.sourceText + '\0' + right.bundleText;
      *extra->u.compare_func_params.compareP =
        leftBytes == rightBytes
          ? PF_ArbCompare_EQUAL
          : (leftBytes < rightBytes ? PF_ArbCompare_LESS : PF_ArbCompare_MORE);
      return PF_Err_NONE;
    }

    case PF_Arbitrary_PRINT_SIZE_FUNC:
      *extra->u.print_size_func_params.print_sizePLu = kCodeArbPrintBufferSize;
      return PF_Err_NONE;

    case PF_Arbitrary_PRINT_FUNC: {
      CodeSnapshotValue snapshot;
      if (!extra->u.print_func_params.print_bufferPC ||
          extra->u.print_func_params.print_sizeLu == 0 ||
          !ReadCodeSnapshotHandle(
            in_data,
            extra->u.print_func_params.arbH,
            &snapshot
          )) {
        return PF_Err_BAD_CALLBACK_PARAM;
      }
      std::snprintf(
        extra->u.print_func_params.print_bufferPC,
        extra->u.print_func_params.print_sizeLu,
        "Momentum Code (%lu bytes)",
        static_cast<unsigned long>(snapshot.sourceText.size())
      );
      return PF_Err_NONE;
    }

    case PF_Arbitrary_SCAN_FUNC:
      return PF_Err_CANNOT_PARSE_KEYFRAME_TEXT;

    default:
      return PF_Err_NONE;
  }
}

}  // namespace momentum
