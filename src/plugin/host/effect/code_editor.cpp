#define MOMENTUM_CODE_EDITOR_INTERNALS 1
#include "host/effect/code_editor.h"
#undef MOMENTUM_CODE_EDITOR_INTERNALS

#include "controllers/schema.h"
#include "host/code/snapshot.h"
#include "host/code/timeline.h"
#include "host/effect/parameters.h"
#include "host/effect/render.h"
#include "host/parameter_layout.h"
#include "scripting/runtime/core.h"
#include "scripting/runtime/internal.h"
#include "scripting/runtime/maintenance.h"

#include "AE_EffectSuites.h"

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <limits>
#include <mutex>
#include <random>
#include <sstream>
#include <unordered_map>
#include <utility>

#if defined(_WIN32)
#include <windows.h>
#endif

namespace momentum {

namespace {

constexpr long kOrderIndependentCodeCueSafetyVersion = 7;
constexpr char kCodeEditorOpenIntentFileName[] =
  "code-editor-open.pending";
constexpr char kCodeEditorPanelClaimFileName[] =
  "code-editor-open.claimed";
constexpr char kCodeEditorViewClockFileName[] =
  "code-editor-view-clock.txt";
constexpr auto kCodeEditorPanelWakeDelay =
  std::chrono::milliseconds(300);

struct CodeEditorState {
  std::mutex mutex;
  std::unordered_map<std::string, NativeCodeEditSession> sessions;
  std::optional<std::string> activeSessionToken;
  std::optional<PendingCodeEditCommit> pendingCommit;
  std::optional<PendingNativeCodeCueReconcile> pendingReconcile;
  std::optional<std::string> pendingPanelWakeToken;
  std::chrono::steady_clock::time_point panelWakeAfter;
};

struct AegpRegistrationState {
  AEGP_PluginID pluginId = 0;
  SPBasicSuite* basicSuite = NULL;
  bool idleHookRegistered = false;
  std::mutex viewClockMutex;
  std::string lastViewClockSample;
  std::string lastLoggedViewClockSession;
  int lastLoggedViewClockPreview = -1;
  bool viewClockWriteFailureLogged = false;
};

CodeEditorState& State() {
  static CodeEditorState state;
  return state;
}

AegpRegistrationState& AegpRegistration() {
  static AegpRegistrationState state;
  return state;
}

A_Err CodeEditIdleHook(
  AEGP_GlobalRefcon pluginRefcon,
  AEGP_IdleRefcon idleRefcon,
  A_long* maxSleep
);

#if !defined(MOMENTUM_CODE_EDITOR_STATE_ONLY)
bool PublishCodeEditorViewClockInternal();
void ResetCodeEditorViewClock();
void WakeCodeEditorIdleHook();
#endif

}  // namespace

bool IsCodeEditSessionActive(const std::string& token) {
  CodeEditorState& state = State();
  std::lock_guard<std::mutex> lock(state.mutex);
  return state.sessions.find(token) != state.sessions.end();
}

void StoreCodeEditSession(
  NativeCodeEditSession session,
  std::vector<std::string>* supersededTokens
) {
  CodeEditorState& state = State();
  const std::string activeToken = session.token;
  {
    std::lock_guard<std::mutex> lock(state.mutex);
    for (auto iterator = state.sessions.begin();
         iterator != state.sessions.end();) {
      const bool sameCodeStream =
        iterator->second.codeStreamUniqueId == session.codeStreamUniqueId;
      const bool commitPending = state.pendingCommit.has_value() &&
        state.pendingCommit->token == iterator->first;
      if (sameCodeStream && !commitPending) {
        if (supersededTokens) {
          supersededTokens->push_back(iterator->first);
        }
        iterator = state.sessions.erase(iterator);
      } else {
        ++iterator;
      }
    }
    state.sessions[activeToken] = std::move(session);
    state.activeSessionToken = activeToken;
  }
}

bool ReadCodeEditSession(
  const std::string& token,
  NativeCodeEditSession* session
) {
  if (!session) {
    return false;
  }
  CodeEditorState& state = State();
  std::lock_guard<std::mutex> lock(state.mutex);
  const auto iterator = state.sessions.find(token);
  if (iterator == state.sessions.end()) {
    return false;
  }
  *session = iterator->second;
  return true;
}

bool ReadActiveCodeEditSession(NativeCodeEditSession* session) {
  if (!session) {
    return false;
  }
  CodeEditorState& state = State();
  std::lock_guard<std::mutex> lock(state.mutex);
  if (!state.activeSessionToken.has_value()) {
    return false;
  }
  const auto iterator = state.sessions.find(*state.activeSessionToken);
  if (iterator == state.sessions.end()) {
    return false;
  }
  *session = iterator->second;
  return true;
}

void RemoveCodeEditSession(const std::string& token) {
  CodeEditorState& state = State();
  bool removedActiveSession = false;
  {
    std::lock_guard<std::mutex> lock(state.mutex);
    removedActiveSession =
      state.activeSessionToken.has_value() &&
      *state.activeSessionToken == token;
    if (removedActiveSession) {
      state.activeSessionToken.reset();
    }
    state.sessions.erase(token);
  }
#if !defined(MOMENTUM_CODE_EDITOR_STATE_ONLY)
  if (removedActiveSession) {
    ResetCodeEditorViewClock();
  }
#endif
}

void QueueCodeEditorPanelWake(const std::string& token) {
  CodeEditorState& state = State();
  std::lock_guard<std::mutex> lock(state.mutex);
  state.pendingPanelWakeToken = token;
  state.panelWakeAfter =
    std::chrono::steady_clock::now() + kCodeEditorPanelWakeDelay;
}

std::optional<std::string> TakeDueCodeEditorPanelWake(
  bool* waiting
) {
  CodeEditorState& state = State();
  std::lock_guard<std::mutex> lock(state.mutex);
  if (waiting) {
    *waiting = false;
  }
  if (!state.pendingPanelWakeToken.has_value()) {
    return std::nullopt;
  }
  if (std::chrono::steady_clock::now() < state.panelWakeAfter) {
    if (waiting) {
      *waiting = true;
    }
    return std::nullopt;
  }
  std::optional<std::string> token =
    std::move(state.pendingPanelWakeToken);
  state.pendingPanelWakeToken.reset();
  return token;
}

bool HasPendingCodeCueReconcile() {
  CodeEditorState& state = State();
  std::lock_guard<std::mutex> lock(state.mutex);
  return state.pendingReconcile.has_value();
}

bool QueueCodeCueReconcile(PendingNativeCodeCueReconcile pending) {
  CodeEditorState& state = State();
  {
    std::lock_guard<std::mutex> lock(state.mutex);
    if (state.pendingReconcile.has_value()) {
      return false;
    }
    state.pendingReconcile = std::move(pending);
  }
#if !defined(MOMENTUM_CODE_EDITOR_STATE_ONLY)
  WakeCodeEditorIdleHook();
#endif
  return true;
}

bool QueueCodeEditCommit(PendingCodeEditCommit pending) {
  CodeEditorState& state = State();
  {
    std::lock_guard<std::mutex> lock(state.mutex);
    if (state.pendingCommit.has_value()) {
      return false;
    }
    state.pendingCommit = std::move(pending);
  }
#if !defined(MOMENTUM_CODE_EDITOR_STATE_ONLY)
  WakeCodeEditorIdleHook();
#endif
  return true;
}

PendingCodeEditorWork TakePendingCodeEditorWork() {
  CodeEditorState& state = State();
  std::lock_guard<std::mutex> lock(state.mutex);
  PendingCodeEditorWork work;
  work.reconcile = std::move(state.pendingReconcile);
  state.pendingReconcile.reset();
  work.commit = std::move(state.pendingCommit);
  state.pendingCommit.reset();
  return work;
}

PendingCodeEditorWork ResetCodeEditSessions() {
  CodeEditorState& state = State();
  std::lock_guard<std::mutex> lock(state.mutex);
  PendingCodeEditorWork work;
  work.reconcile = std::move(state.pendingReconcile);
  state.pendingReconcile.reset();
  work.commit = std::move(state.pendingCommit);
  state.pendingCommit.reset();
  state.pendingPanelWakeToken.reset();
  state.activeSessionToken.reset();
  state.sessions.clear();
  return work;
}

#if !defined(MOMENTUM_CODE_EDITOR_STATE_ONLY)

namespace {

using runtime_internal::ResolveEffectRuntimeKey;
using runtime_internal::ResolveLiveEffectSessionId;

void DisposeHandle(PF_InData* input, PF_Handle handle) {
  if (input && input->utils && input->utils->host_dispose_handle &&
      handle) {
    (*input->utils->host_dispose_handle)(handle);
  }
}

struct CodeKeyframeTimeline {
  bool querySucceeded = false;
  bool hasAnyKeyframe = false;
  bool hasActiveKeyframe = false;
  PF_KeyIndex keyframeCount = 0;
  A_long activeTimeValue = 0;
  A_u_long activeTimeScale = 1;
};

CodeKeyframeTimeline ResolveCodeKeyframeTimeline(PF_InData* input) {
  CodeKeyframeTimeline result;
  if (!input) {
    return result;
  }

  AEFX_SuiteScoper<PF_ParamUtilsSuite3> paramUtilsSuite(
    input,
    kPFParamUtilsSuite,
    kPFParamUtilsSuiteVersion3,
    NULL
  );
  if (!paramUtilsSuite.get()) {
    return result;
  }

  PF_KeyIndex keyframeCount = PF_KeyIndex_NONE;
  const PF_Err countError = paramUtilsSuite->PF_GetKeyframeCount(
    input->effect_ref,
    PARAM_CODE_SNAPSHOT,
    &keyframeCount
  );
  if (countError != PF_Err_NONE) {
    return result;
  }

  result.querySucceeded = true;
  if (keyframeCount == PF_KeyIndex_NONE || keyframeCount <= 0) {
    return result;
  }
  result.keyframeCount = keyframeCount;
  result.hasAnyKeyframe = true;

  PF_Boolean foundActiveKey = FALSE;
  PF_KeyIndex activeKeyIndex = PF_KeyIndex_NONE;
  A_long activeTime = 0;
  A_u_long activeTimeScale =
    std::max<A_u_long>(1, input->time_scale);
  const PF_Err findError = paramUtilsSuite->PF_FindKeyframeTime(
    input->effect_ref,
    PARAM_CODE_SNAPSHOT,
    input->current_time,
    input->time_scale,
    PF_TimeDir_LESS_THAN_OR_EQUAL,
    &foundActiveKey,
    &activeKeyIndex,
    &activeTime,
    &activeTimeScale
  );
  if (findError != PF_Err_NONE) {
    return CodeKeyframeTimeline();
  }
  if (foundActiveKey && activeKeyIndex != PF_KeyIndex_NONE) {
    result.hasActiveKeyframe = true;
    result.activeTimeValue = activeTime;
    result.activeTimeScale =
      std::max<A_u_long>(1, activeTimeScale);
  }
  return result;
}

struct ResolvedCodeCue {
  A_Time time = {0, 1};
  CodeSnapshotValue snapshot;
  RuntimeSketchBundle bundle;
};

struct ResolvedCodeCueTimeline {
  bool querySucceeded = false;
  PF_KeyIndex keyframeCount = 0;
  std::vector<ResolvedCodeCue> cues;
};

struct ResolvedCueTimes {
  bool querySucceeded = false;
  PF_KeyIndex keyframeCount = 0;
  std::vector<A_Time> times;
};

ResolvedCueTimes ResolveCueTimes(
  PF_InData* input,
  PF_ParamIndex paramIndex
) {
  ResolvedCueTimes result;
  if (!input) {
    return result;
  }

  AEFX_SuiteScoper<PF_ParamUtilsSuite3> paramUtilsSuite(
    input,
    kPFParamUtilsSuite,
    kPFParamUtilsSuiteVersion3,
    NULL
  );
  if (!paramUtilsSuite.get()) {
    return result;
  }

  PF_KeyIndex keyframeCount = PF_KeyIndex_NONE;
  const PF_Err countError = paramUtilsSuite->PF_GetKeyframeCount(
    input->effect_ref,
    paramIndex,
    &keyframeCount
  );
  if (countError != PF_Err_NONE) {
    return result;
  }

  result.querySucceeded = true;
  if (keyframeCount == PF_KeyIndex_NONE || keyframeCount <= 0) {
    return result;
  }
  result.keyframeCount = keyframeCount;
  result.times.reserve(static_cast<std::size_t>(keyframeCount));
  for (PF_KeyIndex keyIndex = 0;
       keyIndex < keyframeCount;
       ++keyIndex) {
    A_Time keyTime = {0, 1};
    const PF_Err timeError = paramUtilsSuite->PF_KeyIndexToTime(
      input->effect_ref,
      paramIndex,
      keyIndex,
      &keyTime.value,
      &keyTime.scale
    );
    if (timeError != PF_Err_NONE) {
      result.querySucceeded = false;
      result.times.clear();
      return result;
    }
    keyTime.scale = std::max<A_u_long>(1, keyTime.scale);
    result.times.push_back(keyTime);
  }
  std::stable_sort(
    result.times.begin(),
    result.times.end(),
    [](const A_Time& left, const A_Time& right) {
      return CompareCodeCueTimes(left, right) < 0;
    }
  );
  return result;
}

ResolvedCodeCueTimeline ResolveFullCodeCueTimeline(PF_InData* input) {
  ResolvedCodeCueTimeline result;
  if (!input) {
    return result;
  }

  AEFX_SuiteScoper<PF_ParamUtilsSuite3> paramUtilsSuite(
    input,
    kPFParamUtilsSuite,
    kPFParamUtilsSuiteVersion3,
    NULL
  );
  if (!paramUtilsSuite.get()) {
    return result;
  }

  PF_KeyIndex keyframeCount = PF_KeyIndex_NONE;
  const PF_Err countError = paramUtilsSuite->PF_GetKeyframeCount(
    input->effect_ref,
    PARAM_CODE_SNAPSHOT,
    &keyframeCount
  );
  if (countError != PF_Err_NONE) {
    return result;
  }

  result.querySucceeded = true;
  if (keyframeCount == PF_KeyIndex_NONE || keyframeCount <= 0) {
    return result;
  }
  result.keyframeCount = keyframeCount;
  result.cues.reserve(static_cast<std::size_t>(
    std::max<PF_KeyIndex>(0, keyframeCount)
  ));

  for (PF_KeyIndex keyIndex = 0;
       keyIndex < keyframeCount;
       ++keyIndex) {
    A_long keyTime = 0;
    A_u_long keyTimeScale =
      std::max<A_u_long>(1, input->time_scale);
    PF_ParamDef keyParam;
    AEFX_CLR_STRUCT(keyParam);
    const PF_Err checkoutError =
      paramUtilsSuite->PF_CheckoutKeyframe(
        input->effect_ref,
        PARAM_CODE_SNAPSHOT,
        keyIndex,
        &keyTime,
        &keyTimeScale,
        &keyParam
      );
    if (checkoutError != PF_Err_NONE) {
      result.querySucceeded = false;
      result.cues.clear();
      return result;
    }

    CodeSnapshotValue snapshot;
    const bool snapshotValid = ReadCodeSnapshotHandle(
      input,
      keyParam.u.arb_d.value,
      &snapshot
    );
    std::string bundleError;
    RuntimeSketchBundle bundle =
      ReadRuntimeSketchBundleFromCodeSnapshot(
        input,
        keyParam.u.arb_d.value,
        std::string(),
        &bundleError
      );
    const PF_Err checkinError =
      paramUtilsSuite->PF_CheckinKeyframe(
        input->effect_ref,
        &keyParam
      );
    if (!snapshotValid || !bundleError.empty() ||
        !bundle.hasEmbeddedSource ||
        checkinError != PF_Err_NONE) {
      result.querySucceeded = false;
      result.cues.clear();
      return result;
    }

    ResolvedCodeCue cue;
    cue.time.value = keyTime;
    cue.time.scale = std::max<A_u_long>(1, keyTimeScale);
    cue.snapshot = std::move(snapshot);
    cue.bundle = std::move(bundle);
    result.cues.push_back(std::move(cue));
  }

  std::stable_sort(
    result.cues.begin(),
    result.cues.end(),
    [](const ResolvedCodeCue& left, const ResolvedCodeCue& right) {
      return CompareCodeCueTimes(left.time, right.time) < 0;
    }
  );
  return result;
}

CodeCueTimelineFingerprint FingerprintCodeCueTimeline(
  const ResolvedCodeCueTimeline& timeline
) {
  CodeCueTimelineFingerprint fingerprint;
  fingerprint.reserve(timeline.cues.size());
  for (const ResolvedCodeCue& cue : timeline.cues) {
    fingerprint.push_back(
      CodeCueFingerprint{cue.time, cue.bundle.sourceHash}
    );
  }
  return fingerprint;
}

bool CanApplySoftCodeCue(
  const ResolvedCodeCue& cue,
  const RuntimeSketchBundle& previousBundle
) {
  if (cue.snapshot.transitionMode != kCodeSnapshotTransitionSoft ||
      cue.bundle.requestedCodeTransition !=
        RuntimeCodeTransitionMode::kSoft ||
      !cue.bundle.codeCueHasDraw ||
      cue.bundle.codeCueSafetyVersion !=
        kOrderIndependentCodeCueSafetyVersion ||
      previousBundle.codeCueSafetyVersion !=
        kOrderIndependentCodeCueSafetyVersion) {
    return false;
  }
  return !cue.bundle.codeCueContextHash.empty() &&
    cue.bundle.codeCueContextHash ==
      previousBundle.codeCueContextHash &&
    !cue.bundle.codeCueTargetPatchSource.empty();
}

RuntimeSketchBundle SelectEffectRuntimeSketchBundle(
  PF_InData* input,
  PF_ArbitraryH currentCodeSnapshot,
  PF_ArbitraryH defaultCodeSnapshot,
  std::string* errorMessage,
  std::string* selectionMode,
  PF_KeyIndex* keyframeCount,
  PF_KeyIndex* restartKeyframeCount
) {
  const std::string defaultSourcePath;
  PF_ArbitraryH defaultSnapshot = defaultCodeSnapshot;
  const CodeKeyframeTimeline compactTimeline =
    ResolveCodeKeyframeTimeline(input);
  if (!defaultSnapshot && compactTimeline.querySucceeded &&
      !compactTimeline.hasAnyKeyframe) {
    defaultSnapshot = currentCodeSnapshot;
  }
  std::string defaultError;
  RuntimeSketchBundle defaultBundle =
    ReadRuntimeSketchBundleFromCodeSnapshot(
      input,
      defaultSnapshot,
      defaultSourcePath,
      &defaultError
    );

  const ResolvedCodeCueTimeline cueTimeline =
    ResolveFullCodeCueTimeline(input);
  const ResolvedCueTimes restartCueTimeline =
    ResolveCueTimes(input, PARAM_RESTART_CUE);
  if (cueTimeline.querySucceeded) {
    ObserveKnownCodeCueTimelineFromRender(
      ResolveLiveEffectSessionId(input),
      FingerprintCodeCueTimeline(cueTimeline)
    );
  }
  if (keyframeCount) {
    *keyframeCount = cueTimeline.querySucceeded
      ? cueTimeline.keyframeCount
      : compactTimeline.keyframeCount;
  }
  if (restartKeyframeCount) {
    *restartKeyframeCount = restartCueTimeline.querySucceeded
      ? restartCueTimeline.keyframeCount
      : 0;
  }

  if (cueTimeline.querySucceeded && defaultError.empty() &&
      defaultBundle.hasEmbeddedSource) {
    const A_Time currentTime = input
      ? A_Time{
          input->current_time,
          std::max<A_u_long>(1, input->time_scale)
        }
      : A_Time{0, 1};
    std::vector<bool> effectiveSoft(cueTimeline.cues.size(), false);
    std::vector<bool> effectiveIdentity(
      cueTimeline.cues.size(),
      false
    );
    std::vector<bool> effectiveHard(cueTimeline.cues.size(), false);
    std::vector<A_Time> codeCueTimes;
    codeCueTimes.reserve(cueTimeline.cues.size());
    RuntimeSketchBundle previousBundle = defaultBundle;
    for (std::size_t index = 0;
         index < cueTimeline.cues.size();
         ++index) {
      const ResolvedCodeCue& cue = cueTimeline.cues[index];
      const bool isIdentity =
        CodeSourcesAreEquivalent(cue.bundle, previousBundle);
      effectiveIdentity[index] = isIdentity;
      if (!isIdentity) {
        effectiveSoft[index] =
          CanApplySoftCodeCue(cue, previousBundle);
      }
      effectiveHard[index] = !isIdentity && !effectiveSoft[index];
      codeCueTimes.push_back(cue.time);
      previousBundle = cue.bundle;
    }

    const std::vector<A_Time> noRestartCues;
    const CodeRestartTimelineSelection timelineSelection =
      ResolveCodeRestartTimelineSelection(
        codeCueTimes,
        effectiveHard,
        restartCueTimeline.querySucceeded
          ? restartCueTimeline.times
          : noRestartCues,
        currentTime
      );
    const long activeIndex = timelineSelection.activeCodeCueIndex;
    const long hardAnchorIndex =
      timelineSelection.hardAnchorCodeCueIndex;

    RuntimeSketchBundle effectiveBundle = hardAnchorIndex >= 0
      ? cueTimeline.cues[
          static_cast<std::size_t>(hardAnchorIndex)
        ].bundle
      : defaultBundle;
    const A_Time hardAnchorTime = timelineSelection.hardAnchorTime;
    effectiveBundle.codeStartTime = hardAnchorTime;
    effectiveBundle.softCodeCues.clear();

    std::ostringstream segmentIdentity;
    segmentIdentity
      << effectiveBundle.sourceHash
      << "@hard=" << CodeCueTimeIdentity(hardAnchorTime);
    for (std::size_t index =
           static_cast<std::size_t>(hardAnchorIndex + 1);
         index < cueTimeline.cues.size();
         ++index) {
      if (timelineSelection.hasNextRestartCue &&
          CompareCodeCueTimes(
            cueTimeline.cues[index].time,
            timelineSelection.nextRestartCueTime
          ) >= 0) {
        break;
      }
      if (effectiveIdentity[index]) {
        continue;
      }
      if (!effectiveSoft[index]) {
        break;
      }
      const ResolvedCodeCue& cue = cueTimeline.cues[index];
      RuntimeSoftCodeCue softCue;
      softCue.time = cue.time;
      softCue.sourceHash = cue.bundle.sourceHash;
      softCue.patchSource = cue.bundle.codeCueTargetPatchSource;
      effectiveBundle.softCodeCues.push_back(std::move(softCue));
      segmentIdentity
        << "|soft=" << CodeCueTimeIdentity(cue.time)
        << ':' << cue.bundle.sourceHash;
    }
    if (!effectiveBundle.softCodeCues.empty()) {
      effectiveBundle.sourceHash = segmentIdentity.str();
    }

    if (errorMessage) {
      errorMessage->clear();
    }
    if (selectionMode) {
      if (timelineSelection.restartCueAnchor &&
          activeIndex <= hardAnchorIndex) {
        *selectionMode = "active-restart-marker";
      } else if (activeIndex < 0) {
        *selectionMode = cueTimeline.cues.empty()
          ? "default-no-cues"
          : "default-before-first-cue";
      } else if (
        effectiveIdentity[static_cast<std::size_t>(activeIndex)]
      ) {
        *selectionMode = "active-identity-cue";
      } else {
        *selectionMode =
          effectiveSoft[static_cast<std::size_t>(activeIndex)]
            ? "active-soft-cue"
            : "active-restart-cue";
      }
    }
    return effectiveBundle;
  }

  if (compactTimeline.querySucceeded &&
      compactTimeline.hasActiveKeyframe &&
      currentCodeSnapshot) {
    std::string snapshotError;
    RuntimeSketchBundle snapshotBundle =
      ReadRuntimeSketchBundleFromCodeSnapshot(
        input,
        currentCodeSnapshot,
        defaultSourcePath,
        &snapshotError
      );
    if (snapshotError.empty() && snapshotBundle.hasEmbeddedSource) {
      if (errorMessage) {
        errorMessage->clear();
      }
      snapshotBundle.codeStartTime = A_Time{
        compactTimeline.activeTimeValue,
        std::max<A_u_long>(1, compactTimeline.activeTimeScale)
      };
      if (selectionMode) {
        *selectionMode = "active-restart-fallback";
      }
      return snapshotBundle;
    }
  }

  if (defaultError.empty() && defaultBundle.hasEmbeddedSource) {
    if (errorMessage) {
      errorMessage->clear();
    }
    defaultBundle.codeStartTime = A_Time{0, 1};
    if (selectionMode) {
      *selectionMode = "default-timeline-unavailable";
    }
    return defaultBundle;
  }

  std::string currentError;
  RuntimeSketchBundle currentBundle =
    ReadRuntimeSketchBundleFromCodeSnapshot(
      input,
      currentCodeSnapshot,
      defaultSourcePath,
      &currentError
    );
  if (currentError.empty() && currentBundle.hasEmbeddedSource) {
    if (errorMessage) {
      errorMessage->clear();
    }
    currentBundle.codeStartTime = A_Time{0, 1};
    if (selectionMode) {
      *selectionMode = "legacy-code-value";
    }
    return currentBundle;
  }

  if (errorMessage) {
    *errorMessage =
      "Momentum effect has no default Code document. Re-apply the "
      "Bitmap sketch to initialize the Effect parameters.";
  }
  if (selectionMode) {
    *selectionMode = "missing-default-code";
  }
  return RuntimeSketchBundle();
}

}  // namespace

void ObserveCodeEditorCompDraw() {
  (void)PublishCodeEditorViewClockInternal();
}

RuntimeSketchBundle ReadEffectRuntimeSketchBundle(
  PF_InData* input,
  PF_ParamDef* parameters[],
  std::string* errorMessage
) {
  return SelectEffectRuntimeSketchBundle(
    input,
    parameters && parameters[PARAM_CODE_SNAPSHOT]
      ? parameters[PARAM_CODE_SNAPSHOT]->u.arb_d.value
      : NULL,
    parameters && parameters[PARAM_DEFAULT_CODE]
      ? parameters[PARAM_DEFAULT_CODE]->u.arb_d.value
      : NULL,
    errorMessage,
    NULL,
    NULL,
    NULL
  );
}

RuntimeSketchBundle ReadEffectRuntimeSketchBundleAtTime(
  PF_InData* input,
  PF_ArbitraryH currentCodeSnapshot,
  PF_ArbitraryH defaultCodeSnapshot,
  std::string* errorMessage,
  std::string* selectionMode,
  PF_KeyIndex* keyframeCount,
  PF_KeyIndex* restartKeyframeCount
) {
  return SelectEffectRuntimeSketchBundle(
    input,
    currentCodeSnapshot,
    defaultCodeSnapshot,
    errorMessage,
    selectionMode,
    keyframeCount,
    restartKeyframeCount
  );
}

namespace {

A_Err EnsureRegisteredWithAEGP(PF_InData* input) {
  if (!input || !input->pica_basicP) {
    return A_Err_GENERIC;
  }
  AegpRegistrationState& registration = AegpRegistration();
  registration.basicSuite = input->pica_basicP;
  runtime_internal::RunRuntimeMaintenance(
    runtime_internal::GetRuntimeDirectoryPath()
  );

  if (registration.pluginId == 0) {
    AEFX_SuiteScoper<AEGP_UtilitySuite6> utilitySuite(
      input,
      kAEGPUtilitySuite,
      kAEGPUtilitySuiteVersion6,
      NULL
    );
    if (!utilitySuite.get()) {
      return A_Err_GENERIC;
    }
    const A_Err error = utilitySuite->AEGP_RegisterWithAEGP(
      NULL,
      "Momentum",
      &registration.pluginId
    );
    if (error != A_Err_NONE) {
      return error;
    }
  }

  if (!registration.idleHookRegistered) {
    AEFX_SuiteScoper<AEGP_RegisterSuite5> registerSuite(
      input,
      kAEGPRegisterSuite,
      kAEGPRegisterSuiteVersion5,
      NULL
    );
    if (!registerSuite.get()) {
      return A_Err_GENERIC;
    }
    const A_Err error = registerSuite->AEGP_RegisterIdleHook(
      registration.pluginId,
      CodeEditIdleHook,
      NULL
    );
    if (error != A_Err_NONE) {
      return error;
    }
    registration.idleHookRegistered = true;
  }
  return A_Err_NONE;
}

std::string EscapeExtendScriptString(const std::string& value) {
  std::string escaped;
  escaped.reserve(value.size());
  for (const char character : value) {
    switch (character) {
      case '\\': escaped += "\\\\"; break;
      case '\'': escaped += "\\\'"; break;
      case '\r': escaped += "\\r"; break;
      case '\n': escaped += "\\n"; break;
      default: escaped.push_back(character); break;
    }
  }
  return escaped;
}

std::string BuildCodeEditorCepEventScript(
  const std::string& eventType,
  const std::string& eventData
) {
  std::ostringstream script;
  script
    << "(function(){"
    << "var plugPlug=new ExternalObject("
       "'lib:PlugPlugExternalObject');"
    << "var event=new CSXSEvent();"
    << "event.type='" << EscapeExtendScriptString(eventType) << "';"
    << "event.data='" << EscapeExtendScriptString(eventData) << "';"
    << "event.dispatch();"
    << "return 'dispatched';"
    << "}())";
  return script.str();
}

std::string BuildCodeEditorPanelWakeScript() {
  return
    "(function(){"
    "var panelCommandId=app.findMenuCommandId('momentum.js');"
    "if(panelCommandId<=0){return 'missing';}"
    "app.executeCommand(panelCommandId);"
    "return 'requested';"
    "}())";
}

A_Err DispatchCodeEditorCepEvent(
  PF_InData* input,
  const std::string& eventType,
  const std::string& eventData
) {
  if (!input || AegpRegistration().pluginId == 0) {
    return A_Err_GENERIC;
  }
  AEFX_SuiteScoper<AEGP_UtilitySuite6> utilitySuite(
    input,
    kAEGPUtilitySuite,
    kAEGPUtilitySuiteVersion6,
    NULL
  );
  if (!utilitySuite.get()) {
    return A_Err_GENERIC;
  }
  const std::string script = BuildCodeEditorCepEventScript(
    eventType,
    eventData
  );
  return utilitySuite->AEGP_ExecuteScript(
    AegpRegistration().pluginId,
    script.c_str(),
    FALSE,
    NULL,
    NULL
  );
}

A_Err ResolveCodeStreamUniqueId(
  PF_InData* input,
  std::uint64_t* uniqueId
) {
  if (!input || !uniqueId ||
      EnsureRegisteredWithAEGP(input) != A_Err_NONE) {
    return A_Err_GENERIC;
  }
  *uniqueId = 0;
#if !MOMENTUM_AE_HAS_UNIQUE_STREAM_ID
  *uniqueId = ResolveLiveEffectSessionId(input);
  return *uniqueId ? A_Err_NONE : A_Err_GENERIC;
#else
  AEFX_SuiteScoper<AEGP_PFInterfaceSuite1> interfaceSuite(
    input,
    kAEGPPFInterfaceSuite,
    kAEGPPFInterfaceSuiteVersion1,
    NULL
  );
  AEFX_SuiteScoper<AEGP_EffectSuite5> effectSuite(
    input,
    kAEGPEffectSuite,
    kAEGPEffectSuiteVersion5,
    NULL
  );
  AEFX_SuiteScoper<AEGP_StreamSuite6> streamSuite(
    input,
    kAEGPStreamSuite,
    kAEGPStreamSuiteVersion6,
    NULL
  );
  if (!interfaceSuite.get() || !effectSuite.get() ||
      !streamSuite.get()) {
    return A_Err_GENERIC;
  }
  AEGP_EffectRefH effectH = NULL;
  AEGP_StreamRefH streamH = NULL;
  A_Err error = interfaceSuite->AEGP_GetNewEffectForEffect(
    AegpRegistration().pluginId,
    input->effect_ref,
    &effectH
  );
  if (error == A_Err_NONE && effectH) {
    error = streamSuite->AEGP_GetNewEffectStreamByIndex(
      AegpRegistration().pluginId,
      effectH,
      PARAM_CODE_SNAPSHOT,
      &streamH
    );
  }
  if (error == A_Err_NONE && streamH) {
    int32_t sdkUniqueId = 0;
    error = streamSuite->AEGP_GetUniqueStreamID(streamH, &sdkUniqueId);
    if (error == A_Err_NONE) {
      *uniqueId = static_cast<std::uint32_t>(sdkUniqueId);
    }
  }
  if (streamH) {
    (void)streamSuite->AEGP_DisposeStream(streamH);
  }
  if (effectH) {
    (void)effectSuite->AEGP_DisposeEffect(effectH);
  }
  return error;
#endif
}

bool WriteCodeEditTextFileAtomically(
  const std::string& path,
  const std::string& text
) {
  static std::atomic<std::uint64_t> temporaryFileSequence{0};
  const std::uint64_t sequence =
    temporaryFileSequence.fetch_add(1, std::memory_order_relaxed);
  const auto timestamp =
    std::chrono::steady_clock::now().time_since_epoch().count();
  const std::string temporaryPath =
    path + ".tmp." + std::to_string(timestamp) + "." +
      std::to_string(sequence);
  std::ofstream file(
    temporaryPath.c_str(),
    std::ios::out | std::ios::binary | std::ios::trunc
  );
  if (!file.is_open()) {
    return false;
  }
  file.write(text.data(), static_cast<std::streamsize>(text.size()));
  file.flush();
  const bool wrote = file.good();
  file.close();
  if (!wrote || file.fail()) {
    std::remove(temporaryPath.c_str());
    return false;
  }

#if defined(_WIN32)
  const bool replaced = MoveFileExA(
    temporaryPath.c_str(),
    path.c_str(),
    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH
  ) != 0;
#else
  // POSIX rename replaces the destination atomically. Never remove the
  // destination first: readers must always see either the old complete file
  // or the new complete file.
  const bool replaced =
    std::rename(temporaryPath.c_str(), path.c_str()) == 0;
#endif
  if (!replaced) {
    std::remove(temporaryPath.c_str());
    return false;
  }
  return true;
}

bool CodeEditorOpenIntentMatches(const std::string& sessionToken) {
  std::ifstream file(
    runtime_internal::GetRuntimeDirectoryPath() + "/" +
      kCodeEditorOpenIntentFileName,
    std::ios::in | std::ios::binary
  );
  if (!file.is_open()) {
    return false;
  }
  std::string version;
  std::string storedToken;
  std::getline(file, version);
  std::getline(file, storedToken);
  return version == "open-v1" && storedToken == sessionToken;
}

bool CodeEditorPanelClaimed() {
  std::error_code existsError;
  const bool exists = std::filesystem::exists(
    runtime_internal::GetRuntimeDirectoryPath() + "/" +
      kCodeEditorPanelClaimFileName,
    existsError
  );
  return !existsError && exists;
}

bool CodeEditTimelinesMatch(
  const CodeCueTimelineFingerprint& left,
  const CodeCueTimelineFingerprint& right
) {
  if (left.size() != right.size()) {
    return false;
  }
  for (std::size_t index = 0; index < left.size(); ++index) {
    if (!CodeCueTimesEqual(left[index].time, right[index].time) ||
        left[index].sourceHash != right[index].sourceHash) {
      return false;
    }
  }
  return true;
}

std::string SerializeCodeEditTimelineFingerprint(
  const CodeCueTimelineFingerprint& timeline
) {
  std::ostringstream stream;
  stream << "timeline-v1\n";
  for (const CodeCueFingerprint& cue : timeline) {
    stream
      << CodeCueTimeIdentity(cue.time)
      << '\t' << cue.sourceHash << '\n';
  }
  return stream.str();
}

void MarkChangedCodeEditSessions(
  std::uint64_t liveEffectSessionId,
  const CodeCueTimelineFingerprint& current
) {
  std::vector<std::string> staleTokens;
  std::vector<std::string> currentTokens;
  {
    CodeEditorState& state = State();
    std::lock_guard<std::mutex> lock(state.mutex);
    for (auto& entry : state.sessions) {
      if (entry.second.liveEffectSessionId != liveEffectSessionId) {
        continue;
      }
      if (CodeEditTimelinesMatch(entry.second.cues, current)) {
        currentTokens.push_back(entry.first);
      } else {
        staleTokens.push_back(entry.first);
      }
    }
  }
  const std::string sessionRoot =
    runtime_internal::GetRuntimeDirectoryPath() +
    "/code-edit-sessions/";
  for (const std::string& token : currentTokens) {
    std::error_code cleanupError;
    std::filesystem::remove(
      sessionRoot + token + "/timeline.changed",
      cleanupError
    );
  }
  const std::string markerText =
    SerializeCodeEditTimelineFingerprint(current);
  for (const std::string& token : staleTokens) {
    const std::string markerPath =
      sessionRoot + token + "/timeline.changed";
    const auto existingMarker =
      runtime_internal::ReadTextFile(markerPath);
    if (!existingMarker.has_value() ||
        *existingMarker != markerText) {
      (void)WriteCodeEditTextFileAtomically(
        markerPath,
        markerText
      );
    }
  }
}

std::string GenerateCodeEditSessionToken() {
  static std::mutex randomMutex;
  static std::mt19937_64 randomEngine([]() {
    std::random_device device;
    std::seed_seq seed{
      device(),
      device(),
      device(),
      device(),
      static_cast<unsigned int>(
        std::chrono::high_resolution_clock::now()
          .time_since_epoch()
          .count()
      )
    };
    return std::mt19937_64(seed);
  }());

  std::lock_guard<std::mutex> lock(randomMutex);
  std::ostringstream token;
  token
    << std::hex << std::setfill('0')
    << std::setw(16) << randomEngine()
    << std::setw(16) << randomEngine();
  return token.str();
}

long SelectCodeEditSourceIndex(
  const ResolvedCodeCueTimeline& cueTimeline,
  const A_Time& targetTime,
  bool* exactCue
) {
  if (exactCue) {
    *exactCue = false;
  }
  long selectedIndex = -1;
  for (std::size_t index = 0;
       index < cueTimeline.cues.size();
       ++index) {
    const int comparison = CompareCodeCueTimes(
      cueTimeline.cues[index].time,
      targetTime
    );
    if (comparison == 0) {
      if (exactCue) {
        *exactCue = true;
      }
      return static_cast<long>(index);
    }
    if (comparison < 0) {
      selectedIndex = static_cast<long>(index);
      continue;
    }
    break;
  }
  return selectedIndex;
}

long SelectCodeEditSourceIndex(
  const CodeCueTimelineFingerprint& cues,
  const A_Time& targetTime,
  bool* exactCue
) {
  if (exactCue) {
    *exactCue = false;
  }
  long selectedIndex = -1;
  for (std::size_t index = 0; index < cues.size(); ++index) {
    const int comparison = CompareCodeCueTimes(
      cues[index].time,
      targetTime
    );
    if (comparison == 0) {
      if (exactCue) {
        *exactCue = true;
      }
      return static_cast<long>(index);
    }
    if (comparison < 0) {
      selectedIndex = static_cast<long>(index);
      continue;
    }
    break;
  }
  return selectedIndex;
}

}  // namespace

A_Err AcquireAegpPluginId(
  PF_InData* input,
  AEGP_PluginID* pluginId
) {
  if (!pluginId) {
    return A_Err_GENERIC;
  }
  *pluginId = 0;
  const A_Err error = EnsureRegisteredWithAEGP(input);
  if (error == A_Err_NONE) {
    *pluginId = AegpRegistration().pluginId;
  }
  return error;
}

PF_Err OpenCodeEditorWindow(
  PF_InData* input,
  PF_ParamDef* parameters[]
) {
  if (!input || !parameters || !parameters[PARAM_DEFAULT_CODE]) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  if (EnsureRegisteredWithAEGP(input) != A_Err_NONE ||
      AegpRegistration().pluginId == 0) {
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  CodeSnapshotValue baseSnapshot;
  if (!ReadCodeSnapshotHandle(
        input,
        parameters[PARAM_DEFAULT_CODE]->u.arb_d.value,
        &baseSnapshot
      ) ||
      baseSnapshot.sourceText.empty() ||
      baseSnapshot.bundleText.empty()) {
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  std::string baseBundleError;
  const RuntimeSketchBundle baseBundle =
    runtime_internal::ReadRuntimeSketchBundleFromText(
      baseSnapshot.bundleText,
      std::string(),
      &baseBundleError
    );
  if (!baseBundleError.empty() || baseBundle.sourceHash.empty()) {
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  const ResolvedCodeCueTimeline cueTimeline =
    ResolveFullCodeCueTimeline(input);
  if (!cueTimeline.querySucceeded) {
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  for (const ResolvedCodeCue& cue : cueTimeline.cues) {
    if (cue.bundle.sourceHash.empty() ||
        cue.bundle.controllerHash != baseBundle.controllerHash ||
        cue.snapshot.sourceText.empty() ||
        cue.snapshot.bundleText.empty()) {
      return PF_Err_INTERNAL_STRUCT_DAMAGED;
    }
  }
  SetKnownCodeCueTimeline(
    ResolveLiveEffectSessionId(input),
    FingerprintCodeCueTimeline(cueTimeline)
  );

  A_Time targetTime;
  targetTime.value = input->current_time;
  targetTime.scale = std::max<A_u_long>(1, input->time_scale);
  bool editsExistingCue = false;
  const long selectedCueIndex = SelectCodeEditSourceIndex(
    cueTimeline,
    targetTime,
    &editsExistingCue
  );
  std::uint64_t codeStreamUniqueId = 0;
  if (ResolveCodeStreamUniqueId(input, &codeStreamUniqueId) !=
      A_Err_NONE) {
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  A_long compId = 0;
  AEGP_ItemH activeItemH = NULL;
  AEFX_SuiteScoper<AEGP_ItemSuite9> itemSuite(
    input,
    kAEGPItemSuite,
    kAEGPItemSuiteVersion9,
    NULL
  );
  if (!itemSuite.get() ||
      itemSuite->AEGP_GetActiveItem(&activeItemH) != A_Err_NONE ||
      !activeItemH ||
      itemSuite->AEGP_GetItemID(activeItemH, &compId) != A_Err_NONE ||
      compId <= 0) {
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  const std::string sessionToken = GenerateCodeEditSessionToken();

  const std::string sessionDirectory =
    runtime_internal::GetRuntimeDirectoryPath() +
    "/code-edit-sessions/" + sessionToken;
  const std::string snapshotDirectory =
    sessionDirectory + "/snapshots";
  std::error_code directoryError;
  std::filesystem::create_directories(
    snapshotDirectory,
    directoryError
  );
  if (directoryError) {
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  const std::string baseSourceRelativePath = "snapshots/base.js";
  const std::string baseBundleRelativePath = "snapshots/base.json";
  if (!WriteCodeEditTextFileAtomically(
        sessionDirectory + "/" + baseSourceRelativePath,
        baseSnapshot.sourceText
      ) ||
      !WriteCodeEditTextFileAtomically(
        sessionDirectory + "/" + baseBundleRelativePath,
        baseSnapshot.bundleText
      )) {
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  const std::string selectedSourceRelativePath =
    selectedCueIndex >= 0
      ? "snapshots/cue-" + std::to_string(selectedCueIndex) + ".js"
      : baseSourceRelativePath;
  const std::string selectedBundleRelativePath =
    selectedCueIndex >= 0
      ? "snapshots/cue-" + std::to_string(selectedCueIndex) +
          ".json"
      : baseBundleRelativePath;
  const std::string selectedSourceHash = selectedCueIndex >= 0
    ? cueTimeline.cues[
        static_cast<std::size_t>(selectedCueIndex)
      ].bundle.sourceHash
    : baseBundle.sourceHash;

  std::ostringstream contextText;
  contextText
    << "3\n"
    << baseBundle.sourceHash << '\t'
    << baseBundle.controllerHash << '\t'
    << baseSourceRelativePath << '\t'
    << baseBundleRelativePath << "\n"
    << targetTime.value << '\t'
    << targetTime.scale << '\t'
    << (editsExistingCue ? "existing-cue" : "new-cue") << '\t'
    << selectedSourceHash << '\t'
    << selectedSourceRelativePath << '\t'
    << selectedBundleRelativePath << "\n"
    << cueTimeline.cues.size() << "\n"
    << std::setprecision(17);
  for (std::size_t cueIndex = 0;
       cueIndex < cueTimeline.cues.size();
       ++cueIndex) {
    const ResolvedCodeCue& cue = cueTimeline.cues[cueIndex];
    const std::string cueStem =
      "snapshots/cue-" + std::to_string(cueIndex);
    const std::string cueSourceRelativePath = cueStem + ".js";
    const std::string cueBundleRelativePath = cueStem + ".json";
    if (!WriteCodeEditTextFileAtomically(
          sessionDirectory + "/" + cueSourceRelativePath,
          cue.snapshot.sourceText
        ) ||
        !WriteCodeEditTextFileAtomically(
          sessionDirectory + "/" + cueBundleRelativePath,
          cue.snapshot.bundleText
        )) {
      return PF_Err_INTERNAL_STRUCT_DAMAGED;
    }
    contextText
      << cue.time.value << '\t'
      << cue.time.scale << '\t'
      << cue.bundle.sourceHash << '\t'
      << cue.bundle.controllerHash << '\t'
      << cueSourceRelativePath << '\t'
      << cueBundleRelativePath << "\n";
  }

  const std::string editorContextPath =
    sessionDirectory + "/context.txt";
  if (!WriteCodeEditTextFileAtomically(
        editorContextPath,
        contextText.str()
      )) {
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  const std::string openIntentPath =
    runtime_internal::GetRuntimeDirectoryPath() + "/" +
    kCodeEditorOpenIntentFileName;
  std::error_code claimCleanupError;
  std::filesystem::remove(
    runtime_internal::GetRuntimeDirectoryPath() + "/" +
      kCodeEditorPanelClaimFileName,
    claimCleanupError
  );
  if (claimCleanupError) {
    std::error_code cleanupError;
    std::filesystem::remove_all(sessionDirectory, cleanupError);
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  if (!WriteCodeEditTextFileAtomically(
        openIntentPath,
        "open-v1\n" + sessionToken + "\n"
      )) {
    std::error_code cleanupError;
    std::filesystem::remove_all(sessionDirectory, cleanupError);
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  NativeCodeEditSession nativeSession;
  nativeSession.token = sessionToken;
  nativeSession.liveEffectSessionId =
    ResolveLiveEffectSessionId(input);
  nativeSession.compId = compId;
  nativeSession.codeStreamUniqueId = codeStreamUniqueId;
  nativeSession.targetTime = targetTime;
  nativeSession.editsExistingCue = editsExistingCue;
  nativeSession.baseSourceHash = baseBundle.sourceHash;
  nativeSession.originalSourceHash = selectedSourceHash;
  nativeSession.controllerHash = baseBundle.controllerHash;
  nativeSession.cues.reserve(cueTimeline.cues.size());
  for (const ResolvedCodeCue& cue : cueTimeline.cues) {
    const CodeCueFingerprint fingerprint = {
      cue.time,
      cue.bundle.sourceHash
    };
    nativeSession.cues.push_back(fingerprint);
  }
  std::vector<std::string> supersededSessionTokens;
  StoreCodeEditSession(
    std::move(nativeSession),
    &supersededSessionTokens
  );
  for (const std::string& staleToken :
       supersededSessionTokens) {
    std::error_code cleanupError;
    std::filesystem::remove_all(
      runtime_internal::GetRuntimeDirectoryPath() +
        "/code-edit-sessions/" + staleToken,
      cleanupError
    );
  }

  runtime_internal::AppendEffectUiDiagnostic(
    input,
    "code-edit-session-opened",
    "session=" + sessionToken +
      " baseHash=" + baseBundle.sourceHash +
      " target=" + std::to_string(targetTime.value) + "/" +
        std::to_string(targetTime.scale) +
      " mode=" +
        (editsExistingCue ? "existing-cue" : "new-cue") +
      " frozenCues=" +
        std::to_string(cueTimeline.cues.size())
  );

  QueueCodeEditorPanelWake(sessionToken);
  const A_Err scriptError = DispatchCodeEditorCepEvent(
    input,
    "com.example.momentum.codeEditor.open",
    sessionToken
  );
  if (scriptError != A_Err_NONE) {
    runtime_internal::AppendEffectUiDiagnostic(
      input,
      "code-editor-fast-path-dispatch-failed",
      "session=" + sessionToken +
        " err=" + std::to_string(static_cast<long>(scriptError))
    );
  }
  return PF_Err_NONE;
}

PF_Err ObserveCodeCueTimeline(
  PF_InData* input,
  PF_ParamDef* parameters[],
  const char* observer
) {
  if (!input || !parameters || !parameters[PARAM_DEFAULT_CODE]) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  const std::uint64_t liveEffectSessionId =
    ResolveLiveEffectSessionId(input);
  const ResolvedCodeCueTimeline timeline =
    ResolveFullCodeCueTimeline(input);
  if (!timeline.querySucceeded) {
    return PF_Err_NONE;
  }

  const CodeCueTimelineFingerprint current =
    FingerprintCodeCueTimeline(timeline);
  MarkChangedCodeEditSessions(liveEffectSessionId, current);
  CodeCueTimelineFingerprint previous;
  const bool hadPrevious = ReplaceKnownCodeCueTimeline(
    liveEffectSessionId,
    current,
    &previous
  );
  if (!hadPrevious) {
    return PF_Err_NONE;
  }

  std::size_t insertedIndex = current.size();
  if (!FindSingleInsertedCodeCue(
        previous,
        current,
        &insertedIndex
      ) ||
      insertedIndex != 0 ||
      timeline.cues.empty()) {
    return PF_Err_NONE;
  }

  CodeSnapshotValue baseSnapshot;
  const bool baseSnapshotValid = ReadCodeSnapshotHandle(
    input,
    parameters[PARAM_DEFAULT_CODE]->u.arb_d.value,
    &baseSnapshot
  );
  std::string baseBundleError;
  const RuntimeSketchBundle baseBundle =
    ReadRuntimeSketchBundleFromCodeSnapshot(
      input,
      parameters[PARAM_DEFAULT_CODE]->u.arb_d.value,
      std::string(),
      &baseBundleError
    );
  if (!baseSnapshotValid || !baseBundleError.empty() ||
      !baseBundle.hasEmbeddedSource ||
      CodeSourcesAreEquivalent(
        timeline.cues.front().bundle,
        baseBundle
      )) {
    return PF_Err_NONE;
  }

  if (HasPendingCodeCueReconcile()) {
    SetKnownCodeCueTimeline(liveEffectSessionId, previous);
    return PF_Err_NONE;
  }
  if (EnsureRegisteredWithAEGP(input) != A_Err_NONE ||
      AegpRegistration().pluginId == 0) {
    SetKnownCodeCueTimeline(liveEffectSessionId, previous);
    return PF_Err_NONE;
  }

  PF_ArbitraryH baseSnapshotH = NULL;
  const PF_Err allocateError = AllocateCodeSnapshotHandle(
    input,
    baseSnapshot,
    &baseSnapshotH
  );
  if (allocateError != PF_Err_NONE || !baseSnapshotH) {
    SetKnownCodeCueTimeline(liveEffectSessionId, previous);
    return allocateError != PF_Err_NONE
      ? allocateError
      : PF_Err_OUT_OF_MEMORY;
  }

  AEFX_SuiteScoper<AEGP_PFInterfaceSuite1> interfaceSuite(
    input,
    kAEGPPFInterfaceSuite,
    kAEGPPFInterfaceSuiteVersion1,
    NULL
  );
  AEFX_SuiteScoper<AEGP_EffectSuite5> effectSuite(
    input,
    kAEGPEffectSuite,
    kAEGPEffectSuiteVersion5,
    NULL
  );
  AEGP_EffectRefH effectH = NULL;
  const A_Err effectError = interfaceSuite.get()
    ? interfaceSuite->AEGP_GetNewEffectForEffect(
        AegpRegistration().pluginId,
        input->effect_ref,
        &effectH
      )
    : A_Err_GENERIC;
  if (effectError != A_Err_NONE || !effectH) {
    DisposeHandle(input, baseSnapshotH);
    SetKnownCodeCueTimeline(liveEffectSessionId, previous);
    return PF_Err_NONE;
  }

  PendingNativeCodeCueReconcile pending;
  pending.liveEffectSessionId = liveEffectSessionId;
  pending.effectH = effectH;
  pending.targetTime = timeline.cues.front().time;
  pending.baseSnapshotH = baseSnapshotH;
  pending.inheritedSourceHash =
    timeline.cues.front().bundle.sourceHash;
  pending.baseSourceHash = baseBundle.sourceHash;
  pending.observedTimeline = current;
  if (!QueueCodeCueReconcile(std::move(pending))) {
    if (effectSuite.get()) {
      (void)effectSuite->AEGP_DisposeEffect(effectH);
    }
    DisposeHandle(input, baseSnapshotH);
    SetKnownCodeCueTimeline(liveEffectSessionId, previous);
    return PF_Err_NONE;
  }

  std::ostringstream detail;
  detail
    << "observer=" << (observer ? observer : "unknown")
    << " target=" << timeline.cues.front().time.value << "/"
    << timeline.cues.front().time.scale
    << " previousKeys=" << previous.size()
    << " currentKeys=" << current.size()
    << " inheritedHash="
    << timeline.cues.front().bundle.sourceHash
    << " baseHash=" << baseBundle.sourceHash;
  runtime_internal::AppendEffectUiDiagnostic(
    input,
    "native-code-key-reconcile-queued",
    detail.str()
  );
  return PF_Err_NONE;
}

namespace {

PF_Err InitializeEffectCodeDocument(
  PF_InData* input,
  PF_OutData* output,
  A_long creationToken,
  RuntimeSketchBundle* initializedBundle
) {
  if (!input || creationToken <= 0) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  const std::string sourcePath =
    runtime_internal::GetCreationTransportSketchPath(creationToken);
  const std::string bundlePath =
    runtime_internal::GetCreationTransportBundlePath(creationToken);
  const std::optional<std::string> sourceText =
    runtime_internal::ReadTextFile(sourcePath);
  const std::optional<std::string> bundleText =
    runtime_internal::ReadTextFile(bundlePath);
  if (!sourceText.has_value() || sourceText->empty() ||
      !bundleText.has_value() || bundleText->empty()) {
    runtime_internal::AppendEffectUiDiagnostic(
      input,
      "default-code-initialize-failed",
      "creationToken=" + std::to_string(creationToken) +
        " reason=missing-creation-transport"
    );
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  runtime_internal::AppendEffectUiDiagnostic(
    input,
    "default-code-initialize-enter",
    "creationToken=" + std::to_string(creationToken) +
      " sourceBytes=" + std::to_string(sourceText->size()) +
      " bundleBytes=" + std::to_string(bundleText->size())
  );

  std::string bundleError;
  const std::string canonicalSource =
    NormalizeCodeSourceText(*sourceText);
  RuntimeSketchBundle document =
    runtime_internal::ReadRuntimeSketchBundleFromText(
      *bundleText,
      sourcePath,
      &bundleError
    );
  document.sourceText = canonicalSource;
  document.hasEmbeddedSource = true;
  if (!bundleError.empty() || document.sourceHash.empty()) {
    runtime_internal::AppendEffectUiDiagnostic(
      input,
      "default-code-initialize-failed",
      "creationToken=" + std::to_string(creationToken) +
        " reason=invalid-creation-document error=" + bundleError
    );
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  CodeSnapshotValue snapshot;
  snapshot.sourceText = canonicalSource;
  snapshot.bundleText = *bundleText;
  PF_ArbitraryH snapshotHandle = NULL;
  PF_Err error = AllocateCodeSnapshotHandle(
    input,
    snapshot,
    &snapshotHandle
  );
  if (error != PF_Err_NONE || !snapshotHandle) {
    return error != PF_Err_NONE ? error : PF_Err_OUT_OF_MEMORY;
  }

  if (EnsureRegisteredWithAEGP(input) != A_Err_NONE ||
      AegpRegistration().pluginId == 0) {
    DisposeHandle(input, snapshotHandle);
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  AEFX_SuiteScoper<AEGP_PFInterfaceSuite1> interfaceSuite(
    input,
    kAEGPPFInterfaceSuite,
    kAEGPPFInterfaceSuiteVersion1,
    NULL
  );
  AEFX_SuiteScoper<AEGP_EffectSuite5> effectSuite(
    input,
    kAEGPEffectSuite,
    kAEGPEffectSuiteVersion5,
    NULL
  );
  AEFX_SuiteScoper<AEGP_StreamSuite6> streamSuite(
    input,
    kAEGPStreamSuite,
    kAEGPStreamSuiteVersion6,
    NULL
  );
  AEFX_SuiteScoper<AEGP_KeyframeSuite5> keyframeSuite(
    input,
    kAEGPKeyframeSuite,
    kAEGPKeyframeSuiteVersion5,
    NULL
  );
  if (!interfaceSuite.get() || !effectSuite.get() ||
      !streamSuite.get() || !keyframeSuite.get()) {
    DisposeHandle(input, snapshotHandle);
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  AEGP_EffectRefH effectH = NULL;
  A_Err suiteError = interfaceSuite->AEGP_GetNewEffectForEffect(
    AegpRegistration().pluginId,
    input->effect_ref,
    &effectH
  );
  if (suiteError == A_Err_NONE && !effectH) {
    suiteError = A_Err_GENERIC;
  }

  auto setStaticCodeStream = [&](
    PF_ParamIndex paramIndex,
    bool supportsKeyframes
  ) -> A_Err {
    AEGP_StreamRefH streamH = NULL;
    A_Err localError = streamSuite->AEGP_GetNewEffectStreamByIndex(
      AegpRegistration().pluginId,
      effectH,
      paramIndex,
      &streamH
    );
    A_long keyframeCount = 0;
    if (localError == A_Err_NONE && supportsKeyframes) {
      localError =
        keyframeSuite->AEGP_GetStreamNumKFs(
          streamH,
          &keyframeCount
        );
    }
    if (localError == A_Err_NONE && supportsKeyframes &&
        keyframeCount != 0) {
      localError = A_Err_GENERIC;
    }
    if (localError == A_Err_NONE) {
      AEGP_StreamValue2 value;
      AEFX_CLR_STRUCT(value);
      value.streamH = streamH;
      value.val.arbH = snapshotHandle;
      localError = streamSuite->AEGP_SetStreamValue(
        AegpRegistration().pluginId,
        streamH,
        &value
      );
    }
    if (streamH) {
      (void)streamSuite->AEGP_DisposeStream(streamH);
    }
    runtime_internal::AppendEffectUiDiagnostic(
      input,
      "default-code-stream-write",
      "creationToken=" + std::to_string(creationToken) +
        " paramIndex=" +
          std::to_string(static_cast<long>(paramIndex)) +
        " keyframes=" + std::to_string(keyframeCount) +
        " err=" + std::to_string(static_cast<long>(localError))
    );
    return localError;
  };

  if (suiteError == A_Err_NONE && effectH) {
    suiteError = setStaticCodeStream(PARAM_DEFAULT_CODE, false);
  }
  if (suiteError == A_Err_NONE) {
    suiteError = setStaticCodeStream(PARAM_CODE_SNAPSHOT, true);
  }

  DisposeHandle(input, snapshotHandle);
  if (effectH) {
    (void)effectSuite->AEGP_DisposeEffect(effectH);
  }
  if (suiteError != A_Err_NONE) {
    runtime_internal::AppendEffectUiDiagnostic(
      input,
      "default-code-initialize-failed",
      "creationToken=" + std::to_string(creationToken) +
        " reason=set-stream-value err=" +
        std::to_string(static_cast<long>(suiteError))
    );
    return static_cast<PF_Err>(suiteError);
  }

  InvalidateEffectPersistentRenderCaches(
    ResolveLiveEffectSessionId(input),
    "default-code-initialized"
  );
  if (output) {
    output->out_flags |= PF_OutFlag_REFRESH_UI;
  }
  if (initializedBundle) {
    *initializedBundle = document;
  }
  SetKnownCodeCueTimeline(
    ResolveLiveEffectSessionId(input),
    CodeCueTimelineFingerprint()
  );
  std::ostringstream detail;
  detail
    << "creationToken=" << creationToken
    << " sourceHash=" << document.sourceHash
    << " sourceBytes=" << canonicalSource.size()
    << " bundleBytes=" << bundleText->size()
    << " aeStreams=code,default";
  runtime_internal::AppendEffectUiDiagnostic(
    input,
    "default-code-initialized",
    detail.str()
  );
  return PF_Err_NONE;
}

template <typename SuiteType>
class ScopedGlobalSuite {
 public:
  ScopedGlobalSuite(const char* name, int version)
    : name_(name), version_(version) {
    if (AegpRegistration().basicSuite && name_) {
      const void* suite = NULL;
      if (AegpRegistration().basicSuite->AcquireSuite(
            name_,
            version_,
            &suite
          ) == kSPNoError) {
        suite_ = reinterpret_cast<const SuiteType*>(suite);
      }
    }
  }

  ~ScopedGlobalSuite() {
    if (suite_ && AegpRegistration().basicSuite) {
      (void)AegpRegistration().basicSuite->ReleaseSuite(
        name_,
        version_
      );
    }
  }

  const SuiteType* get() const { return suite_; }
  const SuiteType* operator->() const { return suite_; }

 private:
  const char* name_ = NULL;
  int version_ = 0;
  const SuiteType* suite_ = NULL;
};

}  // namespace

PF_Err InitializeEffectDocument(
  PF_InData* input,
  PF_OutData* output,
  PF_ParamDef* parameters[]
) {
  if (!input || !parameters ||
      !parameters[PARAM_CREATION_TOKEN]) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  const A_long creationToken =
    parameters[PARAM_CREATION_TOKEN]->u.sd.value;
  if (creationToken <= 0) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  RuntimeSketchBundle bundle;
  const PF_Err error = InitializeEffectCodeDocument(
    input,
    output,
    creationToken,
    &bundle
  );
  if (error != PF_Err_NONE) {
    return error;
  }
  if (!bundle.controllerHash.empty()) {
    return SyncControllerParamValuesFromBundle(
      input,
      output,
      parameters,
      bundle,
      "effect-created"
    );
  }
  return PF_Err_NONE;
}

namespace {

std::string NormalizeCodeEditTransportText(const std::string& text) {
  std::string normalized;
  normalized.reserve(text.size());
  for (std::size_t index = 0; index < text.size(); ++index) {
    if (text[index] == '\r') {
      normalized.push_back('\n');
      if (index + 1 < text.size() && text[index + 1] == '\n') {
        ++index;
      }
    } else {
      normalized.push_back(text[index]);
    }
  }
  return normalized;
}

bool IsSafeCodeEditSessionToken(const std::string& token) {
  return token.size() == 32 && std::all_of(
    token.begin(),
    token.end(),
    [](unsigned char character) {
      return std::isxdigit(character) != 0;
    }
  );
}

std::string CodeEditResultPath(const std::string& token) {
  return runtime_internal::GetRuntimeDirectoryPath() +
    "/code-edit-results/" + token + ".result";
}

void WriteCodeEditCommitResult(
  const std::string& token,
  bool succeeded,
  A_Err error,
  const std::string& message
) {
  if (!IsSafeCodeEditSessionToken(token)) {
    return;
  }
  std::error_code directoryError;
  std::filesystem::create_directories(
    runtime_internal::GetRuntimeDirectoryPath() +
      "/code-edit-results",
    directoryError
  );
  if (directoryError) {
    return;
  }
  std::ostringstream result;
  result
    << (succeeded ? "ok" : "error") << '\n'
    << static_cast<long>(error) << '\n'
    << message << '\n';
  (void)WriteCodeEditTextFileAtomically(
    CodeEditResultPath(token),
    result.str()
  );
}

bool ParseSignedLong(const std::string& text, A_long* value) {
  if (!value) {
    return false;
  }
  try {
    std::size_t parsed = 0;
    const long long result = std::stoll(text, &parsed);
    if (parsed != text.size() ||
        result < std::numeric_limits<A_long>::min() ||
        result > std::numeric_limits<A_long>::max()) {
      return false;
    }
    *value = static_cast<A_long>(result);
    return true;
  } catch (...) {
    return false;
  }
}

bool ParseTimeScale(const std::string& text, A_u_long* value) {
  if (!value) {
    return false;
  }
  try {
    std::size_t parsed = 0;
    const unsigned long long result = std::stoull(text, &parsed);
    if (parsed != text.size() || result == 0 ||
        result > std::numeric_limits<A_u_long>::max()) {
      return false;
    }
    *value = static_cast<A_u_long>(result);
    return true;
  } catch (...) {
    return false;
  }
}

}  // namespace

std::optional<std::string> TakeCodeEditorSignalCommand(
  const std::string& runtimeDirectory,
  const char* commandName
) {
  if (!commandName || !*commandName) {
    return std::nullopt;
  }
  const std::string path = runtimeDirectory + "/code-edit-" +
    commandName + ".pending";
  const auto commandText = runtime_internal::ReadTextFile(path);
  if (!commandText.has_value()) {
    return std::nullopt;
  }
  std::error_code cleanupError;
  std::filesystem::remove(path, cleanupError);
  std::istringstream commandStream(
    NormalizeCodeEditTransportText(*commandText)
  );
  std::string version;
  std::string token;
  std::getline(commandStream, version);
  std::getline(commandStream, token);
  if (version != "1" || !IsSafeCodeEditSessionToken(token)) {
    return std::string();
  }
  return token;
}

PF_Err HandleCodeEditorSignal(
  PF_InData* input,
  PF_ParamDef* parameters[]
) {
  if (!input || !parameters ||
      EnsureRegisteredWithAEGP(input) != A_Err_NONE) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  const std::string runtimeDirectory =
    runtime_internal::GetRuntimeDirectoryPath();

  const auto closeToken = TakeCodeEditorSignalCommand(
    runtimeDirectory,
    "close"
  );
  if (closeToken.has_value()) {
    if (closeToken->empty()) {
      return PF_Err_BAD_CALLBACK_PARAM;
    }
    NativeCodeEditSession session;
    if (ReadCodeEditSession(*closeToken, &session)) {
      std::uint64_t currentCodeStreamUniqueId = 0;
      if (ResolveCodeStreamUniqueId(
            input,
            &currentCodeStreamUniqueId
          ) != A_Err_NONE ||
          currentCodeStreamUniqueId != session.codeStreamUniqueId) {
        return PF_Err_BAD_CALLBACK_PARAM;
      }
      RemoveCodeEditSession(*closeToken);
    }
    std::error_code cleanupError;
    std::filesystem::remove_all(
      runtimeDirectory + "/code-edit-sessions/" + *closeToken,
      cleanupError
    );
    runtime_internal::AppendEffectUiDiagnostic(
      input,
      "code-edit-session-closed",
      "session=" + *closeToken
    );
    return PF_Err_NONE;
  }

  const auto refreshToken = TakeCodeEditorSignalCommand(
    runtimeDirectory,
    "refresh"
  );
  if (refreshToken.has_value()) {
    if (refreshToken->empty()) {
      return PF_Err_BAD_CALLBACK_PARAM;
    }
    runtime_internal::AppendEffectUiDiagnostic(
      input,
      "code-edit-session-refresh-requested",
      "session=" + *refreshToken
    );
    return OpenCodeEditorWindow(input, parameters);
  }

  const std::string pendingPath =
    runtimeDirectory + "/code-edit-commit.pending";
  const auto pendingText =
    runtime_internal::ReadTextFile(pendingPath);
  if (!pendingText.has_value()) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  std::error_code cleanupError;
  std::filesystem::remove(pendingPath, cleanupError);

  std::istringstream pendingStream(
    NormalizeCodeEditTransportText(*pendingText)
  );
  std::string pendingVersion;
  std::string sessionToken;
  std::getline(pendingStream, pendingVersion);
  std::getline(pendingStream, sessionToken);
  if (pendingVersion != "1" ||
      !IsSafeCodeEditSessionToken(sessionToken)) {
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  const std::string sessionDirectory =
    runtimeDirectory + "/code-edit-sessions/" + sessionToken;
  const std::string requestPath =
    sessionDirectory + "/commit.request";
  const auto requestText =
    runtime_internal::ReadTextFile(requestPath);
  std::filesystem::remove(requestPath, cleanupError);
  if (!requestText.has_value()) {
    WriteCodeEditCommitResult(
      sessionToken,
      false,
      A_Err_GENERIC,
      "The editor commit request is missing."
    );
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  std::istringstream requestStream(
    NormalizeCodeEditTransportText(*requestText)
  );
  std::string requestVersion;
  std::string requestToken;
  std::string targetMode;
  std::string targetValueText;
  std::string targetScaleText;
  std::string originalSourceHash;
  std::getline(requestStream, requestVersion);
  std::getline(requestStream, requestToken);
  std::getline(requestStream, targetMode);
  std::getline(requestStream, targetValueText);
  std::getline(requestStream, targetScaleText);
  std::getline(requestStream, originalSourceHash);
  A_Time requestedTime = {0, 1};
  const bool editsBase = targetMode == "base";
  const bool editsExistingCue =
    targetMode == "existing-cue";
  const bool validMode =
    editsBase || editsExistingCue || targetMode == "new-cue";
  if (requestVersion != "2" ||
      requestToken != sessionToken ||
      !validMode ||
      !ParseSignedLong(targetValueText, &requestedTime.value) ||
      !ParseTimeScale(targetScaleText, &requestedTime.scale) ||
      originalSourceHash.empty()) {
    WriteCodeEditCommitResult(
      sessionToken,
      false,
      A_Err_GENERIC,
      "The editor commit target is invalid."
    );
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  NativeCodeEditSession session;
  if (!ReadCodeEditSession(sessionToken, &session)) {
    WriteCodeEditCommitResult(
      sessionToken,
      false,
      A_Err_GENERIC,
      "This native code edit transaction is no longer active."
    );
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  std::uint64_t currentCodeStreamUniqueId = 0;
  const A_Err streamIdentityError = ResolveCodeStreamUniqueId(
    input,
    &currentCodeStreamUniqueId
  );
  const ResolvedCodeCueTimeline liveCueTimeline =
    ResolveFullCodeCueTimeline(input);
  std::string liveBaseBundleError;
  const RuntimeSketchBundle liveBaseBundle =
    parameters && parameters[PARAM_DEFAULT_CODE]
      ? ReadRuntimeSketchBundleFromCodeSnapshot(
          input,
          parameters[PARAM_DEFAULT_CODE]->u.arb_d.value,
          std::string(),
          &liveBaseBundleError
        )
      : RuntimeSketchBundle();
  A_Time liveTargetTime = {
    input->current_time,
    std::max<A_u_long>(1, input->time_scale)
  };
  bool liveEditsExistingCue = false;
  const long liveSourceIndex = liveCueTimeline.querySucceeded
    ? SelectCodeEditSourceIndex(
        liveCueTimeline,
        requestedTime,
        &liveEditsExistingCue
      )
    : -1;
  std::string liveOriginalSourceHash;
  if (liveCueTimeline.querySucceeded && liveSourceIndex >= 0) {
    liveOriginalSourceHash = liveCueTimeline.cues[
      static_cast<std::size_t>(liveSourceIndex)
    ].bundle.sourceHash;
  } else if (liveCueTimeline.querySucceeded) {
    if (liveBaseBundleError.empty()) {
      liveOriginalSourceHash = liveBaseBundle.sourceHash;
    }
  }
  const bool baseTargetValid = editsBase &&
    liveBaseBundleError.empty() &&
    !liveBaseBundle.sourceHash.empty() &&
    session.baseSourceHash == originalSourceHash &&
    liveBaseBundle.sourceHash == originalSourceHash &&
    liveBaseBundle.controllerHash == session.controllerHash;
  const bool cueTargetValid = !editsBase &&
    liveCueTimeline.querySucceeded &&
    CodeCueTimesEqual(liveTargetTime, requestedTime) &&
    liveEditsExistingCue == editsExistingCue &&
    liveOriginalSourceHash == originalSourceHash;
  if (streamIdentityError != A_Err_NONE ||
      session.codeStreamUniqueId != currentCodeStreamUniqueId ||
      (!baseTargetValid && !cueTargetValid)) {
    WriteCodeEditCommitResult(
      sessionToken,
      false,
      A_Err_GENERIC,
      "The commit signal came from a different effect or Cue "
      "target."
    );
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  const std::string sourcePath =
    sessionDirectory + "/source.js";
  const std::string bundlePath =
    sessionDirectory + "/bundle.json";
  const auto sourceText =
    runtime_internal::ReadTextFile(sourcePath);
  const auto bundleText =
    runtime_internal::ReadTextFile(bundlePath);
  if (!sourceText.has_value() || !bundleText.has_value()) {
    WriteCodeEditCommitResult(
      sessionToken,
      false,
      A_Err_GENERIC,
      "The compiled code edit payload is missing."
    );
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }
  std::string bundleError;
  const RuntimeSketchBundle nextBundle =
    runtime_internal::ReadRuntimeSketchBundleFromText(
      *bundleText,
      sourcePath,
      &bundleError
    );
  if (!bundleError.empty() || nextBundle.sourceHash.empty()) {
    WriteCodeEditCommitResult(
      sessionToken,
      false,
      A_Err_GENERIC,
      "The compiled code is incompatible."
    );
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  if (nextBundle.controllerHash != session.controllerHash) {
    WriteCodeEditCommitResult(
      sessionToken,
      false,
      A_Err_GENERIC,
      "不支持二次修改控件"
    );
    return PF_Err_BAD_CALLBACK_PARAM;
  }

  const std::string canonicalSource =
    NormalizeCodeSourceText(*sourceText);
  CodeSnapshotValue nextSnapshot;
  nextSnapshot.transitionMode =
    nextBundle.requestedCodeTransition ==
        RuntimeCodeTransitionMode::kSoft &&
      nextBundle.codeCueHasDraw &&
      nextBundle.codeCueSafetyVersion ==
        kOrderIndependentCodeCueSafetyVersion &&
      !nextBundle.codeCueTargetPatchSource.empty()
      ? kCodeSnapshotTransitionSoft
      : kCodeSnapshotTransitionRestart;
  nextSnapshot.sourceText = canonicalSource;
  nextSnapshot.bundleText = *bundleText;
  PF_ArbitraryH nextHandle = NULL;
  const PF_Err allocateError = AllocateCodeSnapshotHandle(
    input,
    nextSnapshot,
    &nextHandle
  );
  if (allocateError != PF_Err_NONE || !nextHandle) {
    WriteCodeEditCommitResult(
      sessionToken,
      false,
      A_Err_ALLOC,
      "After Effects could not allocate the Code snapshot."
    );
    return allocateError != PF_Err_NONE
      ? allocateError
      : PF_Err_OUT_OF_MEMORY;
  }

  AEFX_SuiteScoper<AEGP_PFInterfaceSuite1> interfaceSuite(
    input,
    kAEGPPFInterfaceSuite,
    kAEGPPFInterfaceSuiteVersion1,
    NULL
  );
  AEFX_SuiteScoper<AEGP_EffectSuite5> effectSuite(
    input,
    kAEGPEffectSuite,
    kAEGPEffectSuiteVersion5,
    NULL
  );
  AEGP_EffectRefH effectH = NULL;
  const A_Err effectError = interfaceSuite.get()
    ? interfaceSuite->AEGP_GetNewEffectForEffect(
        AegpRegistration().pluginId,
        input->effect_ref,
        &effectH
      )
    : A_Err_GENERIC;
  if (effectError != A_Err_NONE || !effectH) {
    DisposeHandle(input, nextHandle);
    WriteCodeEditCommitResult(
      sessionToken,
      false,
      effectError,
      "The target Momentum effect is no longer available."
    );
    return PF_Err_INTERNAL_STRUCT_DAMAGED;
  }

  PendingCodeEditCommit pendingCommit;
  pendingCommit.token = sessionToken;
  pendingCommit.liveEffectSessionId =
    session.liveEffectSessionId;
  pendingCommit.effectH = effectH;
  pendingCommit.targetTime = requestedTime;
  pendingCommit.editsBase = editsBase;
  pendingCommit.editsExistingCue = !editsBase && liveEditsExistingCue;
  pendingCommit.originalSourceHash = editsBase
    ? liveBaseBundle.sourceHash
    : liveOriginalSourceHash;
  if (!editsBase) {
    pendingCommit.frozenCues =
      FingerprintCodeCueTimeline(liveCueTimeline);
  }
  pendingCommit.snapshotH = nextHandle;
  pendingCommit.sourceHash = nextBundle.sourceHash;
  pendingCommit.controllerHash = nextBundle.controllerHash;
  if (!QueueCodeEditCommit(std::move(pendingCommit))) {
    if (effectSuite.get()) {
      (void)effectSuite->AEGP_DisposeEffect(effectH);
    }
    DisposeHandle(input, nextHandle);
    WriteCodeEditCommitResult(
      sessionToken,
      false,
      A_Err_GENERIC,
      "Another Momentum code edit is still being committed."
    );
    return PF_Err_BAD_CALLBACK_PARAM;
  }
  runtime_internal::AppendEffectUiDiagnostic(
    input,
    "code-edit-idle-job-queued",
    "session=" + sessionToken +
      " target=" + std::to_string(session.targetTime.value) +
      "/" + std::to_string(session.targetTime.scale) +
      " mode=" +
        (editsBase
          ? "base"
          : session.editsExistingCue ? "existing-cue" : "new-cue")
  );
  return PF_Err_NONE;
}

namespace {

void ProcessNativeCodeCueReconcile(
  PendingNativeCodeCueReconcile job
) {
  ScopedGlobalSuite<AEGP_EffectSuite5> effectSuite(
    kAEGPEffectSuite,
    kAEGPEffectSuiteVersion5
  );
  ScopedGlobalSuite<AEGP_StreamSuite6> streamSuite(
    kAEGPStreamSuite,
    kAEGPStreamSuiteVersion6
  );
  ScopedGlobalSuite<AEGP_KeyframeSuite5> keyframeSuite(
    kAEGPKeyframeSuite,
    kAEGPKeyframeSuiteVersion5
  );
  ScopedGlobalSuite<AEGP_UtilitySuite6> utilitySuite(
    kAEGPUtilitySuite,
    kAEGPUtilitySuiteVersion6
  );
  ScopedGlobalSuite<PF_HandleSuite1> handleSuite(
    kPFHandleSuite,
    kPFHandleSuiteVersion1
  );

  A_Err error = A_Err_NONE;
  std::string failureMessage;
  AEGP_StreamRefH streamH = NULL;
  bool undoStarted = false;
  if (!effectSuite.get() || !streamSuite.get() ||
      !keyframeSuite.get() || !utilitySuite.get() ||
      !handleSuite.get() || !job.effectH ||
      !job.baseSnapshotH) {
    error = A_Err_GENERIC;
    failureMessage =
      "The native Code reconciliation services are unavailable.";
  }
  if (error == A_Err_NONE) {
    error = streamSuite->AEGP_GetNewEffectStreamByIndex(
      AegpRegistration().pluginId,
      job.effectH,
      PARAM_CODE_SNAPSHOT,
      &streamH
    );
    if (error != A_Err_NONE || !streamH) {
      failureMessage =
        "The Code stream disappeared before reconciliation.";
    }
  }

  A_long keyCount = 0;
  if (error == A_Err_NONE) {
    error = keyframeSuite->AEGP_GetStreamNumKFs(
      streamH,
      &keyCount
    );
    if (error != A_Err_NONE || keyCount <= 0) {
      if (error == A_Err_NONE) {
        error = A_Err_GENERIC;
      }
      failureMessage = "The inserted Code key no longer exists.";
    }
  }

  A_Time firstKeyTime = {0, 1};
  if (error == A_Err_NONE) {
    error = keyframeSuite->AEGP_GetKeyframeTime(
      streamH,
      0,
      AEGP_LTimeMode_LayerTime,
      &firstKeyTime
    );
    if (error != A_Err_NONE ||
        !CodeCueTimesEqual(firstKeyTime, job.targetTime)) {
      if (error == A_Err_NONE) {
        error = A_Err_GENERIC;
      }
      failureMessage =
        "The inserted Code key was moved before reconciliation.";
    }
  }

  std::string currentSourceHash;
  if (error == A_Err_NONE) {
    AEGP_StreamValue2 currentValue;
    AEFX_CLR_STRUCT(currentValue);
    error = keyframeSuite->AEGP_GetNewKeyframeValue(
      AegpRegistration().pluginId,
      streamH,
      0,
      &currentValue
    );
    if (error == A_Err_NONE) {
      CodeSnapshotValue snapshot;
      std::string bundleError;
      const bool snapshotValid = ReadCodeSnapshotHandleWithSuite(
        handleSuite.get(),
        reinterpret_cast<PF_ArbitraryH>(
          currentValue.val.arbH
        ),
        &snapshot
      );
      const RuntimeSketchBundle bundle = snapshotValid
        ? runtime_internal::ReadRuntimeSketchBundleFromText(
            snapshot.bundleText,
            std::string(),
            &bundleError
          )
        : RuntimeSketchBundle();
      currentSourceHash = bundle.sourceHash;
      const A_Err disposeValueError =
        streamSuite->AEGP_DisposeStreamValue(&currentValue);
      if (!snapshotValid || !bundleError.empty() ||
          (currentSourceHash != job.inheritedSourceHash &&
           currentSourceHash != job.baseSourceHash)) {
        error = A_Err_GENERIC;
        failureMessage =
          "The inserted Code key changed before reconciliation.";
      } else if (disposeValueError != A_Err_NONE) {
        error = disposeValueError;
        failureMessage =
          "After Effects could not release the Code key value.";
      }
    } else {
      failureMessage =
        "After Effects could not read the inserted Code key.";
    }
  }

  const bool alreadyBase =
    error == A_Err_NONE &&
    currentSourceHash == job.baseSourceHash;
  if (error == A_Err_NONE && !alreadyBase) {
    error = utilitySuite->AEGP_StartUndoGroup(
      "Initialize Momentum Code Keyframe from Base"
    );
    undoStarted = error == A_Err_NONE;
    if (!undoStarted) {
      failureMessage =
        "After Effects could not begin Code reconciliation.";
    }
  }
  if (error == A_Err_NONE && !alreadyBase) {
    AEGP_StreamValue2 baseValue;
    AEFX_CLR_STRUCT(baseValue);
    baseValue.streamH = streamH;
    baseValue.val.arbH = job.baseSnapshotH;
    error = keyframeSuite->AEGP_SetKeyframeValue(
      streamH,
      0,
      &baseValue
    );
    if (error != A_Err_NONE) {
      failureMessage =
        "After Effects rejected the Base Code key value.";
    }
  }
  if (undoStarted) {
    const A_Err endUndoError = utilitySuite->AEGP_EndUndoGroup();
    if (error == A_Err_NONE) {
      error = endUndoError;
      if (error != A_Err_NONE) {
        failureMessage =
          "After Effects could not finish Code reconciliation.";
      }
    }
  }

  if (streamH && streamSuite.get()) {
    (void)streamSuite->AEGP_DisposeStream(streamH);
  }
  if (job.effectH && effectSuite.get()) {
    (void)effectSuite->AEGP_DisposeEffect(job.effectH);
  }
  if (job.baseSnapshotH && handleSuite.get()) {
    handleSuite->host_dispose_handle(job.baseSnapshotH);
  }

  const bool succeeded = error == A_Err_NONE;
  if (succeeded) {
    CodeCueTimelineFingerprint reconciled = job.observedTimeline;
    if (!reconciled.empty()) {
      reconciled.front().sourceHash = job.baseSourceHash;
    }
    SetKnownCodeCueTimeline(job.liveEffectSessionId, reconciled);
    InvalidateEffectPersistentRenderCaches(
      job.liveEffectSessionId,
      "native-code-key-reconciled"
    );
  }
  std::ostringstream detail;
  detail
    << "target=" << job.targetTime.value << "/"
    << job.targetTime.scale
    << " inheritedHash=" << job.inheritedSourceHash
    << " baseHash=" << job.baseSourceHash
    << " err=" << static_cast<long>(error);
  if (!failureMessage.empty()) {
    detail << " message=" << failureMessage;
  }
  runtime_internal::AppendEffectUiDiagnostic(
    NULL,
    succeeded
      ? "native-code-key-reconcile-complete"
      : "native-code-key-reconcile-failed",
    detail.str()
  );
}

void ProcessBaseCodeCommit(PendingCodeEditCommit job) {
  ScopedGlobalSuite<AEGP_EffectSuite5> effectSuite(
    kAEGPEffectSuite,
    kAEGPEffectSuiteVersion5
  );
  ScopedGlobalSuite<AEGP_StreamSuite6> streamSuite(
    kAEGPStreamSuite,
    kAEGPStreamSuiteVersion6
  );
  ScopedGlobalSuite<AEGP_UtilitySuite6> utilitySuite(
    kAEGPUtilitySuite,
    kAEGPUtilitySuiteVersion6
  );
  ScopedGlobalSuite<PF_HandleSuite1> handleSuite(
    kPFHandleSuite,
    kPFHandleSuiteVersion1
  );

  A_Err error = A_Err_NONE;
  std::string failureMessage;
  AEGP_StreamRefH streamH = NULL;
  bool undoStarted = false;
  if (!effectSuite.get() || !streamSuite.get() ||
      !utilitySuite.get() || !handleSuite.get() ||
      !job.effectH || !job.snapshotH) {
    error = A_Err_GENERIC;
    failureMessage =
      "The After Effects Base Code services are unavailable.";
  }
  if (error == A_Err_NONE) {
    error = streamSuite->AEGP_GetNewEffectStreamByIndex(
      AegpRegistration().pluginId,
      job.effectH,
      PARAM_DEFAULT_CODE,
      &streamH
    );
    if (error != A_Err_NONE || !streamH) {
      failureMessage =
        "The target Base Code stream is no longer available.";
    }
  }

  if (error == A_Err_NONE) {
    const A_Time sampleTime = {0, 1};
    AEGP_StreamValue2 currentValue;
    AEFX_CLR_STRUCT(currentValue);
    error = streamSuite->AEGP_GetNewStreamValue(
      AegpRegistration().pluginId,
      streamH,
      AEGP_LTimeMode_LayerTime,
      &sampleTime,
      FALSE,
      &currentValue
    );
    if (error == A_Err_NONE) {
      CodeSnapshotValue currentSnapshot;
      std::string bundleError;
      const bool snapshotValid = ReadCodeSnapshotHandleWithSuite(
        handleSuite.get(),
        reinterpret_cast<PF_ArbitraryH>(currentValue.val.arbH),
        &currentSnapshot
      );
      const RuntimeSketchBundle currentBundle = snapshotValid
        ? runtime_internal::ReadRuntimeSketchBundleFromText(
            currentSnapshot.bundleText,
            std::string(),
            &bundleError
          )
        : RuntimeSketchBundle();
      const A_Err disposeValueError =
        streamSuite->AEGP_DisposeStreamValue(&currentValue);
      if (!snapshotValid || !bundleError.empty() ||
          currentBundle.sourceHash != job.originalSourceHash ||
          currentBundle.controllerHash != job.controllerHash) {
        error = A_Err_GENERIC;
        failureMessage =
          "The Base Code changed while the editor was open.";
      } else if (disposeValueError != A_Err_NONE) {
        error = disposeValueError;
        failureMessage =
          "After Effects could not release the Base Code value.";
      }
    } else {
      failureMessage =
        "After Effects could not read the current Base Code.";
    }
  }

  if (error == A_Err_NONE) {
    error = utilitySuite->AEGP_StartUndoGroup(
      "Modify Momentum Base Code"
    );
    undoStarted = error == A_Err_NONE;
    if (!undoStarted) {
      failureMessage =
        "After Effects could not begin the Base Code transaction.";
    }
  }
  if (error == A_Err_NONE) {
    AEGP_StreamValue2 nextValue;
    AEFX_CLR_STRUCT(nextValue);
    nextValue.streamH = streamH;
    nextValue.val.arbH = job.snapshotH;
    error = streamSuite->AEGP_SetStreamValue(
      AegpRegistration().pluginId,
      streamH,
      &nextValue
    );
    if (error != A_Err_NONE) {
      failureMessage =
        "After Effects rejected the Base Code value.";
    }
  }
  if (undoStarted) {
    const A_Err endUndoError = utilitySuite->AEGP_EndUndoGroup();
    if (error == A_Err_NONE) {
      error = endUndoError;
      if (error != A_Err_NONE) {
        failureMessage =
          "After Effects could not finish the Base Code transaction.";
      }
    }
  }

  if (streamH && streamSuite.get()) {
    (void)streamSuite->AEGP_DisposeStream(streamH);
  }
  if (job.effectH && effectSuite.get()) {
    (void)effectSuite->AEGP_DisposeEffect(job.effectH);
  }
  if (job.snapshotH && handleSuite.get()) {
    handleSuite->host_dispose_handle(job.snapshotH);
  }

  const bool succeeded = error == A_Err_NONE;
  if (succeeded) {
    InvalidateEffectPersistentRenderCaches(
      job.liveEffectSessionId,
      "base-code-atomic-commit"
    );
    RemoveCodeEditSession(job.token);
    std::error_code cleanupError;
    std::filesystem::remove_all(
      runtime_internal::GetRuntimeDirectoryPath() +
        "/code-edit-sessions/" + job.token,
      cleanupError
    );
  }
  WriteCodeEditCommitResult(
    job.token,
    succeeded,
    error,
    succeeded ? "The Base Code was committed." : failureMessage
  );
  runtime_internal::AppendEffectUiDiagnostic(
    NULL,
    succeeded
      ? "base-code-idle-commit-complete"
      : "base-code-idle-commit-failed",
    "session=" + job.token +
      " err=" + std::to_string(static_cast<long>(error)) +
      " sourceHash=" + job.sourceHash
  );
}

void ProcessCodeEditorPanelWake(const std::string& sessionToken) {
  if (!CodeEditorOpenIntentMatches(sessionToken)) {
    runtime_internal::AppendEffectUiDiagnostic(
      NULL,
      "code-editor-panel-wake-cancelled",
      "session=" + sessionToken + " reason=intent-completed"
    );
    return;
  }
  if (CodeEditorPanelClaimed()) {
    runtime_internal::AppendEffectUiDiagnostic(
      NULL,
      "code-editor-panel-wake-cancelled",
      "session=" + sessionToken + " reason=panel-claimed"
    );
    return;
  }

  ScopedGlobalSuite<AEGP_UtilitySuite6> utilitySuite(
    kAEGPUtilitySuite,
    kAEGPUtilitySuiteVersion6
  );
  A_Err error = A_Err_GENERIC;
  if (utilitySuite.get() && AegpRegistration().pluginId != 0) {
    const std::string script = BuildCodeEditorPanelWakeScript();
    error = utilitySuite->AEGP_ExecuteScript(
      AegpRegistration().pluginId,
      script.c_str(),
      FALSE,
      NULL,
      NULL
    );
  }
  runtime_internal::AppendEffectUiDiagnostic(
    NULL,
    error == A_Err_NONE
      ? "code-editor-panel-wake-requested"
      : "code-editor-panel-wake-failed",
    "session=" + sessionToken +
      " err=" + std::to_string(static_cast<long>(error))
  );
}

void WakeCodeEditorIdleHook() {
  ScopedGlobalSuite<AEGP_UtilitySuite6> utilitySuite(
    kAEGPUtilitySuite,
    kAEGPUtilitySuiteVersion6
  );
  if (utilitySuite.get()) {
    (void)utilitySuite->AEGP_CauseIdleRoutinesToBeCalled();
  }
}

void ResetCodeEditorViewClock() {
  AegpRegistrationState& registration = AegpRegistration();
  std::lock_guard<std::mutex> clockLock(
    registration.viewClockMutex
  );
  registration.lastViewClockSample.clear();
  registration.lastLoggedViewClockSession.clear();
  registration.lastLoggedViewClockPreview = -1;
  registration.viewClockWriteFailureLogged = false;
  std::error_code cleanupError;
  std::filesystem::remove(
    runtime_internal::GetRuntimeDirectoryPath() + "/" +
      kCodeEditorViewClockFileName,
    cleanupError
  );
}

bool WriteCodeEditorViewClockSample(
  const std::string& sessionToken,
  A_long itemId,
  A_Boolean previewing,
  const A_Time& viewTime
) {
  std::ostringstream sample;
  sample
    << "view-clock-v2\t"
    << sessionToken << '\t'
    << itemId << '\t'
    << (previewing ? 1 : 0) << '\t'
    << viewTime.value << '\t'
    << viewTime.scale << '\n';
  const std::string sampleText = sample.str();
  CodeEditorState& state = State();
  AegpRegistrationState& registration = AegpRegistration();
  bool shouldLogState = false;
  bool shouldLogFailure = false;
  bool shouldLogRecovery = false;
  bool wroteSample = false;

  {
    // Keep the active session stable through the file replacement, then
    // serialize both native clock publishers around the shared cache and
    // destination. Lock order is always session state, then view clock.
    std::lock_guard<std::mutex> stateLock(state.mutex);
    if (!state.activeSessionToken.has_value() ||
        *state.activeSessionToken != sessionToken ||
        state.sessions.find(sessionToken) == state.sessions.end()) {
      return false;
    }
    std::lock_guard<std::mutex> clockLock(
      registration.viewClockMutex
    );
    if (sampleText == registration.lastViewClockSample) {
      return true;
    }

    const std::string clockPath =
      runtime_internal::GetRuntimeDirectoryPath() + "/" +
      kCodeEditorViewClockFileName;
    wroteSample = WriteCodeEditTextFileAtomically(
      clockPath,
      sampleText
    );
    if (!wroteSample) {
      shouldLogFailure = !registration.viewClockWriteFailureLogged;
      registration.viewClockWriteFailureLogged = true;
    } else {
      shouldLogRecovery = registration.viewClockWriteFailureLogged;
      registration.viewClockWriteFailureLogged = false;
      registration.lastViewClockSample = sampleText;
      const int previewState = previewing ? 1 : 0;
      shouldLogState =
        registration.lastLoggedViewClockSession != sessionToken ||
        registration.lastLoggedViewClockPreview != previewState;
      if (shouldLogState) {
        registration.lastLoggedViewClockSession = sessionToken;
        registration.lastLoggedViewClockPreview = previewState;
      }
    }
  }

  if (shouldLogFailure) {
    runtime_internal::AppendEffectUiDiagnostic(
      NULL,
      "code-editor-view-clock-write-failed",
      "session=" + sessionToken
    );
  }
  if (shouldLogRecovery) {
    runtime_internal::AppendEffectUiDiagnostic(
      NULL,
      "code-editor-view-clock-write-recovered",
      "session=" + sessionToken
    );
  }
  if (shouldLogState) {
    runtime_internal::AppendEffectUiDiagnostic(
      NULL,
      "code-editor-view-clock-state",
      "session=" + sessionToken +
        " item=" + std::to_string(itemId) +
        " preview=" + (previewing ? "1" : "0") +
        " time=" + std::to_string(viewTime.value) + "/" +
          std::to_string(viewTime.scale)
    );
  }
  return wroteSample;
}

bool PublishCodeEditorViewClockInternal() {
  NativeCodeEditSession activeSession;
  if (!ReadActiveCodeEditSession(&activeSession)) {
    return false;
  }

  ScopedGlobalSuite<AEGP_ItemSuite9> itemSuite(
    kAEGPItemSuite,
    kAEGPItemSuiteVersion9
  );
  ScopedGlobalSuite<AEGP_ItemViewSuite1> itemViewSuite(
    kAEGPItemViewSuite,
    kAEGPItemViewSuiteVersion1
  );
  if (!itemSuite.get() || !itemViewSuite.get()) {
    return true;
  }

  AEGP_ItemH activeItemH = NULL;
  AEGP_ItemViewP activeViewP = NULL;
  A_long itemId = 0;
  A_Boolean previewing = FALSE;
  A_Time viewTime = {0, 1};
  A_Err error = itemSuite->AEGP_GetActiveItem(&activeItemH);
  if (error == A_Err_NONE && activeItemH) {
    error = itemSuite->AEGP_GetItemID(activeItemH, &itemId);
  }
  if (error == A_Err_NONE && activeItemH) {
    error = itemSuite->AEGP_GetItemMRUView(
      activeItemH,
      &activeViewP
    );
  }
  if (error == A_Err_NONE && activeViewP) {
    error = itemViewSuite->AEGP_GetItemViewPlaybackTime(
      activeViewP,
      &previewing,
      &viewTime
    );
  }
  if (error != A_Err_NONE || !activeItemH || !activeViewP ||
      itemId <= 0 || viewTime.scale <= 0) {
    return true;
  }
  (void)WriteCodeEditorViewClockSample(
    activeSession.token,
    itemId,
    previewing,
    viewTime
  );
  // This return value describes whether a session needs clock polling, not
  // whether the latest filesystem write succeeded. Keep the idle hook awake
  // so a transient write failure is retried.
  return true;
}

A_Err CodeEditIdleHook(
  AEGP_GlobalRefcon pluginRefcon,
  AEGP_IdleRefcon idleRefcon,
  A_long* maxSleep
) {
  (void)pluginRefcon;
  (void)idleRefcon;
  bool panelWakeWaiting = false;
  std::optional<std::string> panelWakeToken =
    TakeDueCodeEditorPanelWake(&panelWakeWaiting);
  PendingCodeEditorWork work = TakePendingCodeEditorWork();
  const bool viewClockActive = PublishCodeEditorViewClockInternal();
  if (!panelWakeToken.has_value() &&
      !work.reconcile.has_value() &&
      !work.commit.has_value()) {
    if ((panelWakeWaiting || viewClockActive) && maxSleep) {
      *maxSleep = 1;
    }
    return A_Err_NONE;
  }
  if (maxSleep) {
    *maxSleep = 0;
  }
  if (panelWakeToken.has_value()) {
    ProcessCodeEditorPanelWake(*panelWakeToken);
  }
  if (work.reconcile.has_value()) {
    ProcessNativeCodeCueReconcile(
      std::move(*work.reconcile)
    );
  }
  if (!work.commit.has_value()) {
    return A_Err_NONE;
  }
  PendingCodeEditCommit job = std::move(*work.commit);
  if (job.editsBase) {
    ProcessBaseCodeCommit(std::move(job));
    return A_Err_NONE;
  }

  ScopedGlobalSuite<AEGP_EffectSuite5> effectSuite(
    kAEGPEffectSuite,
    kAEGPEffectSuiteVersion5
  );
  ScopedGlobalSuite<AEGP_StreamSuite6> streamSuite(
    kAEGPStreamSuite,
    kAEGPStreamSuiteVersion6
  );
  ScopedGlobalSuite<AEGP_KeyframeSuite5> keyframeSuite(
    kAEGPKeyframeSuite,
    kAEGPKeyframeSuiteVersion5
  );
  ScopedGlobalSuite<AEGP_UtilitySuite6> utilitySuite(
    kAEGPUtilitySuite,
    kAEGPUtilitySuiteVersion6
  );
  ScopedGlobalSuite<PF_HandleSuite1> handleSuite(
    kPFHandleSuite,
    kPFHandleSuiteVersion1
  );

  A_Err error = A_Err_NONE;
  std::string failureMessage;
  AEGP_StreamRefH streamH = NULL;
  bool undoStarted = false;
  if (!effectSuite.get() || !streamSuite.get() ||
      !keyframeSuite.get() || !utilitySuite.get() ||
      !handleSuite.get() || !job.effectH || !job.snapshotH) {
    error = A_Err_GENERIC;
    failureMessage =
      "The After Effects keyframe services are unavailable.";
  }
  if (error == A_Err_NONE) {
    error = streamSuite->AEGP_GetNewEffectStreamByIndex(
      AegpRegistration().pluginId,
      job.effectH,
      PARAM_CODE_SNAPSHOT,
      &streamH
    );
    if (error != A_Err_NONE || !streamH) {
      failureMessage =
        "The target Code stream is no longer available.";
    }
  }

  A_long liveKeyCount = 0;
  A_long exactKeyIndex = -1;
  if (error == A_Err_NONE) {
    error = keyframeSuite->AEGP_GetStreamNumKFs(
      streamH,
      &liveKeyCount
    );
    if (error != A_Err_NONE || liveKeyCount < 0 ||
        static_cast<std::size_t>(liveKeyCount) !=
          job.frozenCues.size()) {
      if (error == A_Err_NONE) {
        error = A_Err_GENERIC;
      }
      failureMessage =
        "The Code keyframe timeline changed while the editor "
        "was open.";
    }
  }
  for (A_long index = 0;
       error == A_Err_NONE && index < liveKeyCount;
       ++index) {
    A_Time keyTime = {0, 1};
    error = keyframeSuite->AEGP_GetKeyframeTime(
      streamH,
      index,
      AEGP_LTimeMode_LayerTime,
      &keyTime
    );
    if (error != A_Err_NONE ||
        !CodeCueTimesEqual(
          keyTime,
          job.frozenCues[
            static_cast<std::size_t>(index)
          ].time
        )) {
      if (error == A_Err_NONE) {
        error = A_Err_GENERIC;
      }
      failureMessage =
        "A Code keyframe was inserted, moved, or deleted while "
        "editing.";
      break;
    }
    if (CodeCueTimesEqual(keyTime, job.targetTime)) {
      exactKeyIndex = index;
    }

    AEGP_StreamValue2 keyValue;
    AEFX_CLR_STRUCT(keyValue);
    error = keyframeSuite->AEGP_GetNewKeyframeValue(
      AegpRegistration().pluginId,
      streamH,
      index,
      &keyValue
    );
    if (error == A_Err_NONE) {
      CodeSnapshotValue snapshot;
      std::string bundleError;
      const bool snapshotValid = ReadCodeSnapshotHandleWithSuite(
        handleSuite.get(),
        reinterpret_cast<PF_ArbitraryH>(keyValue.val.arbH),
        &snapshot
      );
      const RuntimeSketchBundle bundle = snapshotValid
        ? runtime_internal::ReadRuntimeSketchBundleFromText(
            snapshot.bundleText,
            std::string(),
            &bundleError
          )
        : RuntimeSketchBundle();
      const A_Err disposeValueError =
        streamSuite->AEGP_DisposeStreamValue(&keyValue);
      if (!snapshotValid || !bundleError.empty() ||
          bundle.sourceHash !=
            job.frozenCues[
              static_cast<std::size_t>(index)
            ].sourceHash) {
        error = A_Err_GENERIC;
        failureMessage =
          "A Code keyframe changed while the editor was open.";
      } else if (disposeValueError != A_Err_NONE) {
        error = disposeValueError;
        failureMessage =
          "After Effects could not release a Code keyframe "
          "value.";
      }
    } else {
      failureMessage =
        "After Effects could not read the Code keyframe "
        "timeline.";
    }
  }
  if (error == A_Err_NONE &&
      ((job.editsExistingCue && exactKeyIndex < 0) ||
       (!job.editsExistingCue && exactKeyIndex >= 0))) {
    error = A_Err_GENERIC;
    failureMessage = job.editsExistingCue
      ? "The Code keyframe being edited was moved or deleted."
      : "A Code keyframe was added at this time while the editor "
        "was open.";
  }

  CodeCueTimelineFingerprint expectedTimeline;
  bool timelineTrackerPrepared = false;
  if (error == A_Err_NONE) {
    expectedTimeline = job.frozenCues;
    if (job.editsExistingCue) {
      expectedTimeline[
        static_cast<std::size_t>(exactKeyIndex)
      ].sourceHash = job.sourceHash;
    } else {
      const CodeCueFingerprint insertedCue{
        job.targetTime,
        job.sourceHash
      };
      const auto insertion = std::lower_bound(
        expectedTimeline.begin(),
        expectedTimeline.end(),
        insertedCue,
        [](
          const CodeCueFingerprint& left,
          const CodeCueFingerprint& right
        ) {
          return CompareCodeCueTimes(left.time, right.time) < 0;
        }
      );
      expectedTimeline.insert(insertion, insertedCue);
    }
    SetKnownCodeCueTimeline(
      job.liveEffectSessionId,
      expectedTimeline
    );
    timelineTrackerPrepared = true;
  }

  if (error == A_Err_NONE) {
    error = utilitySuite->AEGP_StartUndoGroup(
      job.editsExistingCue
        ? "Edit Momentum Code Keyframe"
        : "Add Momentum Code Keyframe"
    );
    undoStarted = error == A_Err_NONE;
    if (!undoStarted) {
      failureMessage =
        "After Effects could not begin the Code edit "
        "transaction.";
    }
  }
  if (error == A_Err_NONE) {
    AEGP_StreamValue2 nextValue;
    AEFX_CLR_STRUCT(nextValue);
    nextValue.streamH = streamH;
    nextValue.val.arbH = job.snapshotH;
    if (job.editsExistingCue) {
      error = keyframeSuite->AEGP_SetKeyframeValue(
        streamH,
        exactKeyIndex,
        &nextValue
      );
    } else {
      AEGP_AddKeyframesInfoH addKeyframesH = NULL;
      error = keyframeSuite->AEGP_StartAddKeyframes(
        streamH,
        &addKeyframesH
      );
      A_long newKeyIndex = -1;
      if (error == A_Err_NONE) {
        error = keyframeSuite->AEGP_AddKeyframes(
          addKeyframesH,
          AEGP_LTimeMode_LayerTime,
          &job.targetTime,
          &newKeyIndex
        );
      }
      if (error == A_Err_NONE) {
        error = keyframeSuite->AEGP_SetAddKeyframe(
          addKeyframesH,
          newKeyIndex,
          &nextValue
        );
      }
      if (addKeyframesH) {
        const A_Err endAddError =
          keyframeSuite->AEGP_EndAddKeyframes(
            error == A_Err_NONE ? TRUE : FALSE,
            addKeyframesH
          );
        if (error == A_Err_NONE) {
          error = endAddError;
        }
      }
    }
    if (error != A_Err_NONE) {
      failureMessage =
        "After Effects rejected the atomic Code keyframe write.";
    }
  }
  if (undoStarted) {
    const A_Err endUndoError = utilitySuite->AEGP_EndUndoGroup();
    if (error == A_Err_NONE) {
      error = endUndoError;
      if (error != A_Err_NONE) {
        failureMessage =
          "After Effects could not finish the Code edit "
          "transaction.";
      }
    }
  }

  if (streamH && streamSuite.get()) {
    (void)streamSuite->AEGP_DisposeStream(streamH);
  }
  if (job.effectH && effectSuite.get()) {
    (void)effectSuite->AEGP_DisposeEffect(job.effectH);
  }
  if (job.snapshotH && handleSuite.get()) {
    handleSuite->host_dispose_handle(job.snapshotH);
  }

  const bool succeeded = error == A_Err_NONE;
  if (!succeeded && timelineTrackerPrepared) {
    SetKnownCodeCueTimeline(
      job.liveEffectSessionId,
      job.frozenCues
    );
  }
  if (succeeded) {
    InvalidateEffectPersistentRenderCaches(
      job.liveEffectSessionId,
      "code-keyframe-atomic-commit"
    );
    RemoveCodeEditSession(job.token);
    std::error_code cleanupError;
    std::filesystem::remove_all(
      runtime_internal::GetRuntimeDirectoryPath() +
        "/code-edit-sessions/" + job.token,
      cleanupError
    );
  }
  WriteCodeEditCommitResult(
    job.token,
    succeeded,
    error,
    succeeded
      ? "The Code keyframe was committed."
      : failureMessage
  );
  runtime_internal::AppendEffectUiDiagnostic(
    NULL,
    succeeded
      ? "code-edit-idle-commit-complete"
      : "code-edit-idle-commit-failed",
    "session=" + job.token +
      " target=" + std::to_string(job.targetTime.value) +
      "/" + std::to_string(job.targetTime.scale) +
      " mode=" +
        (job.editsExistingCue ? "existing-cue" : "new-cue") +
      " err=" + std::to_string(static_cast<long>(error)) +
      " sourceHash=" + job.sourceHash
  );
  return A_Err_NONE;
}

}  // namespace

void ShutdownCodeEditor(PF_InData* input) {
  PendingCodeEditorWork abandoned = ResetCodeEditSessions();
  ResetCodeEditorViewClock();
  std::error_code openIntentError;
  std::filesystem::remove(
    runtime_internal::GetRuntimeDirectoryPath() + "/" +
      kCodeEditorOpenIntentFileName,
    openIntentError
  );
  std::error_code panelClaimError;
  std::filesystem::remove(
    runtime_internal::GetRuntimeDirectoryPath() + "/" +
      kCodeEditorPanelClaimFileName,
    panelClaimError
  );
  if (!abandoned.reconcile.has_value() &&
      !abandoned.commit.has_value()) {
    return;
  }

  AEFX_SuiteScoper<AEGP_EffectSuite5> effectSuite(
    input,
    kAEGPEffectSuite,
    kAEGPEffectSuiteVersion5,
    NULL
  );
  if (abandoned.reconcile.has_value() &&
      abandoned.reconcile->effectH &&
      effectSuite.get()) {
    (void)effectSuite->AEGP_DisposeEffect(
      abandoned.reconcile->effectH
    );
  }
  if (abandoned.reconcile.has_value() &&
      abandoned.reconcile->baseSnapshotH &&
      input) {
    DisposeHandle(input, abandoned.reconcile->baseSnapshotH);
  }
  if (abandoned.commit.has_value() &&
      abandoned.commit->effectH &&
      effectSuite.get()) {
    (void)effectSuite->AEGP_DisposeEffect(
      abandoned.commit->effectH
    );
  }
  if (abandoned.commit.has_value() &&
      abandoned.commit->snapshotH &&
      input) {
    DisposeHandle(input, abandoned.commit->snapshotH);
  }
}

#endif

}  // namespace momentum
