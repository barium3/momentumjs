#pragma once

#include <string>

#include "scripting/runtime/types.h"

namespace momentum {

constexpr A_u_long kCodeSnapshotTransitionRestart = 1;
constexpr A_u_long kCodeSnapshotTransitionSoft = 2;

struct CodeSnapshotValue {
  A_u_long transitionMode = kCodeSnapshotTransitionRestart;
  std::string sourceText;
  std::string bundleText;
};

void* CodeSnapshotArbitraryRefcon();

std::string NormalizeCodeSourceText(const std::string& text);

bool CodeSourcesAreEquivalent(
  const RuntimeSketchBundle& left,
  const RuntimeSketchBundle& right
);

PF_Err AllocateCodeSnapshotHandle(
  PF_InData* in_data,
  const CodeSnapshotValue& snapshot,
  PF_ArbitraryH* outHandle
);

bool ReadCodeSnapshotHandle(
  PF_InData* in_data,
  PF_ArbitraryH handle,
  CodeSnapshotValue* outSnapshot
);

bool ReadCodeSnapshotHandleWithSuite(
  const PF_HandleSuite1* handleSuite,
  PF_ArbitraryH handle,
  CodeSnapshotValue* outSnapshot
);

std::string DescribeCodeSnapshotHandle(
  PF_InData* in_data,
  PF_ArbitraryH handle
);

RuntimeSketchBundle ReadRuntimeSketchBundleFromCodeSnapshot(
  PF_InData* in_data,
  PF_ArbitraryH handle,
  const std::string& defaultSourcePath,
  std::string* errorMessage
);

PF_Err HandleCodeSnapshotArbitraryCallbacks(
  PF_InData* in_data,
  PF_OutData* out_data,
  PF_ArbParamsExtra* extra
);

}  // namespace momentum
