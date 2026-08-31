#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "AE_Effect.h"

namespace momentum {

int CompareCodeCueTimes(const A_Time& left, const A_Time& right);
bool CodeCueTimesEqual(const A_Time& left, const A_Time& right);
A_Time NormalizeCodeCueTime(const A_Time& time);
std::string CodeCueTimeIdentity(const A_Time& time);

struct CodeRestartTimelineSelection {
  long activeCodeCueIndex = -1;
  long hardAnchorCodeCueIndex = -1;
  A_Time hardAnchorTime = {0, 1};
  bool restartCueAnchor = false;
  bool hasNextRestartCue = false;
  A_Time nextRestartCueTime = {0, 1};
};

// Code Cue times and Restart Cue times must be sorted. A Restart Cue is a
// hard event whose source is the latest Code Cue at or before that time.
// When both tracks have a key at the same time, Code is selected first and
// the shared time becomes one hard anchor.
CodeRestartTimelineSelection ResolveCodeRestartTimelineSelection(
  const std::vector<A_Time>& codeCueTimes,
  const std::vector<bool>& hardCodeCues,
  const std::vector<A_Time>& restartCueTimes,
  const A_Time& currentTime
);

enum class CodeTimelineFrameRounding {
  kDown,
  kUp,
};

// Maps an AE timeline time to the sketch frame whose sample lies before it
// (kDown) or the first sketch frame whose sample reaches it (kUp). The
// calculation is entirely rational, so NTSC frame rates never pass through
// floating-point seconds.
long ResolveCodeTimelineFrame(
  const A_Time& time,
  const A_Time& startTime,
  A_long frameStep,
  A_u_long frameScale,
  CodeTimelineFrameRounding rounding
);

// Converts a segment-local sketch frame back into AE's checkout time domain.
A_long ResolveCodeTimelineFrameTimeValue(
  long frame,
  const A_Time& startTime,
  A_long frameStep,
  A_u_long outputTimeScale
);

struct CodeCueFingerprint {
  A_Time time = {0, 1};
  std::string sourceHash;
};

using CodeCueTimelineFingerprint = std::vector<CodeCueFingerprint>;

bool FindSingleInsertedCodeCue(
  const CodeCueTimelineFingerprint& previous,
  const CodeCueTimelineFingerprint& current,
  std::size_t* insertedIndex
);

void ObserveKnownCodeCueTimelineFromRender(
  std::uint64_t liveEffectSessionId,
  const CodeCueTimelineFingerprint& timeline
);

void SetKnownCodeCueTimeline(
  std::uint64_t liveEffectSessionId,
  const CodeCueTimelineFingerprint& timeline
);

bool ReplaceKnownCodeCueTimeline(
  std::uint64_t liveEffectSessionId,
  const CodeCueTimelineFingerprint& current,
  CodeCueTimelineFingerprint* previous
);

void DiscardKnownCodeCueTimeline(std::uint64_t liveEffectSessionId);

}  // namespace momentum
