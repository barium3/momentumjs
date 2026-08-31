#pragma once

#include "host/ae_sdk.h"
#include "scripting/runtime/types.h"

#include <string>

#if defined(MOMENTUM_CODE_EDITOR_INTERNALS)
#include "host/code/timeline.h"

#include <cstdint>
#include <optional>
#include <vector>
#endif

namespace momentum {

#if defined(MOMENTUM_CODE_EDITOR_INTERNALS)

struct NativeCodeEditSession {
  std::string token;
  std::uint64_t liveEffectSessionId = 0;
  A_long compId = 0;
  int32_t codeStreamUniqueId = 0;
  A_Time targetTime = {0, 1};
  bool editsExistingCue = false;
  std::string baseSourceHash;
  std::string originalSourceHash;
  std::string controllerHash;
  CodeCueTimelineFingerprint cues;
};

struct PendingCodeEditCommit {
  std::string token;
  std::uint64_t liveEffectSessionId = 0;
  AEGP_EffectRefH effectH = NULL;
  A_Time targetTime = {0, 1};
  bool editsBase = false;
  bool editsExistingCue = false;
  std::string originalSourceHash;
  CodeCueTimelineFingerprint frozenCues;
  PF_ArbitraryH snapshotH = NULL;
  std::string sourceHash;
  std::string controllerHash;
};

struct PendingNativeCodeCueReconcile {
  std::uint64_t liveEffectSessionId = 0;
  AEGP_EffectRefH effectH = NULL;
  A_Time targetTime = {0, 1};
  PF_ArbitraryH baseSnapshotH = NULL;
  std::string inheritedSourceHash;
  std::string baseSourceHash;
  CodeCueTimelineFingerprint observedTimeline;
};

struct PendingCodeEditorWork {
  std::optional<PendingNativeCodeCueReconcile> reconcile;
  std::optional<PendingCodeEditCommit> commit;
};

bool IsCodeEditSessionActive(const std::string& token);

void StoreCodeEditSession(
  NativeCodeEditSession session,
  std::vector<std::string>* supersededTokens
);

bool ReadCodeEditSession(
  const std::string& token,
  NativeCodeEditSession* session
);

bool ReadActiveCodeEditSession(NativeCodeEditSession* session);

void RemoveCodeEditSession(const std::string& token);

bool HasPendingCodeCueReconcile();
bool QueueCodeCueReconcile(PendingNativeCodeCueReconcile pending);
bool QueueCodeEditCommit(PendingCodeEditCommit pending);

PendingCodeEditorWork TakePendingCodeEditorWork();

PendingCodeEditorWork ResetCodeEditSessions();

#endif

RuntimeSketchBundle ReadEffectRuntimeSketchBundle(
  PF_InData* input,
  PF_ParamDef* parameters[],
  std::string* errorMessage = nullptr
);

RuntimeSketchBundle ReadEffectRuntimeSketchBundleAtTime(
  PF_InData* input,
  PF_ArbitraryH currentCodeSnapshot,
  PF_ArbitraryH defaultCodeSnapshot,
  std::string* errorMessage,
  std::string* selectionMode,
  PF_KeyIndex* keyframeCount,
  PF_KeyIndex* restartKeyframeCount
);

A_Err AcquireAegpPluginId(
  PF_InData* input,
  AEGP_PluginID* pluginId
);

PF_Err OpenCodeEditorWindow(
  PF_InData* input,
  PF_ParamDef* parameters[]
);

// Uses AE's supported Comp redraw stream to publish timeline samples while
// scrubbing. The handler never draws or consumes Comp input.
void ObserveCodeEditorCompDraw();

PF_Err InitializeEffectDocument(
  PF_InData* input,
  PF_OutData* output,
  PF_ParamDef* parameters[]
);

PF_Err HandleCodeEditorSignal(
  PF_InData* input,
  PF_ParamDef* parameters[]
);

PF_Err ObserveCodeCueTimeline(
  PF_InData* input,
  PF_ParamDef* parameters[],
  const char* reason
);

void ShutdownCodeEditor(PF_InData* input);

}  // namespace momentum
