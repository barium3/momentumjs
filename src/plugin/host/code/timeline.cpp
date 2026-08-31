#include "host/code/timeline.h"

#include <algorithm>
#include <cstdint>
#include <limits>
#include <mutex>
#include <numeric>
#include <sstream>
#include <unordered_map>

namespace momentum {

namespace {

std::mutex gCodeCueTimelineMutex;
std::unordered_map<std::uint64_t, CodeCueTimelineFingerprint>
  gKnownCodeCueTimelines;

bool CodeCueFingerprintsEqual(
  const CodeCueFingerprint& left,
  const CodeCueFingerprint& right
) {
  return
    CodeCueTimesEqual(left.time, right.time) &&
    left.sourceHash == right.sourceHash;
}

}  // namespace

int CompareCodeCueTimes(const A_Time& left, const A_Time& right) {
  const std::int64_t leftScale = std::max<std::int64_t>(1, left.scale);
  const std::int64_t rightScale = std::max<std::int64_t>(1, right.scale);
  const std::int64_t leftProduct =
    static_cast<std::int64_t>(left.value) * rightScale;
  const std::int64_t rightProduct =
    static_cast<std::int64_t>(right.value) * leftScale;
  return leftProduct < rightProduct ? -1 : leftProduct > rightProduct ? 1 : 0;
}

bool CodeCueTimesEqual(const A_Time& left, const A_Time& right) {
  return CompareCodeCueTimes(left, right) == 0;
}

A_Time NormalizeCodeCueTime(const A_Time& time) {
  const std::int64_t scale = std::max<std::int64_t>(1, time.scale);
  const std::int64_t value = static_cast<std::int64_t>(time.value);
  const std::uint64_t magnitude = value < 0
    ? static_cast<std::uint64_t>(-value)
    : static_cast<std::uint64_t>(value);
  const std::uint64_t divisor = std::gcd(
    magnitude,
    static_cast<std::uint64_t>(scale)
  );
  A_Time normalized;
  normalized.value = static_cast<A_long>(
    value / static_cast<std::int64_t>(std::max<std::uint64_t>(1, divisor))
  );
  normalized.scale = static_cast<A_u_long>(
    scale / static_cast<std::int64_t>(std::max<std::uint64_t>(1, divisor))
  );
  return normalized;
}

std::string CodeCueTimeIdentity(const A_Time& time) {
  const A_Time normalized = NormalizeCodeCueTime(time);
  return std::to_string(normalized.value) + "/" +
    std::to_string(normalized.scale);
}

CodeRestartTimelineSelection ResolveCodeRestartTimelineSelection(
  const std::vector<A_Time>& codeCueTimes,
  const std::vector<bool>& hardCodeCues,
  const std::vector<A_Time>& restartCueTimes,
  const A_Time& currentTime
) {
  CodeRestartTimelineSelection selection;

  long latestHardCodeCueIndex = -1;
  for (std::size_t index = 0; index < codeCueTimes.size(); ++index) {
    if (CompareCodeCueTimes(codeCueTimes[index], currentTime) > 0) {
      break;
    }
    selection.activeCodeCueIndex = static_cast<long>(index);
    if (index < hardCodeCues.size() && hardCodeCues[index]) {
      latestHardCodeCueIndex = static_cast<long>(index);
    }
  }

  long latestRestartCueIndex = -1;
  for (std::size_t index = 0; index < restartCueTimes.size(); ++index) {
    if (CompareCodeCueTimes(restartCueTimes[index], currentTime) > 0) {
      selection.hasNextRestartCue = true;
      selection.nextRestartCueTime = restartCueTimes[index];
      break;
    }
    latestRestartCueIndex = static_cast<long>(index);
  }

  const bool restartWins =
    latestRestartCueIndex >= 0 &&
    (latestHardCodeCueIndex < 0 ||
     CompareCodeCueTimes(
       restartCueTimes[static_cast<std::size_t>(latestRestartCueIndex)],
       codeCueTimes[static_cast<std::size_t>(latestHardCodeCueIndex)]
     ) >= 0);
  if (restartWins) {
    selection.restartCueAnchor = true;
    selection.hardAnchorTime =
      restartCueTimes[static_cast<std::size_t>(latestRestartCueIndex)];
    for (std::size_t index = 0; index < codeCueTimes.size(); ++index) {
      if (CompareCodeCueTimes(
            codeCueTimes[index],
            selection.hardAnchorTime
          ) > 0) {
        break;
      }
      selection.hardAnchorCodeCueIndex = static_cast<long>(index);
    }
  } else if (latestHardCodeCueIndex >= 0) {
    selection.hardAnchorCodeCueIndex = latestHardCodeCueIndex;
    selection.hardAnchorTime = codeCueTimes[
      static_cast<std::size_t>(latestHardCodeCueIndex)
    ];
  }

  return selection;
}

namespace {

using WideInteger = __int128_t;

WideInteger DivideDown(WideInteger numerator, WideInteger denominator) {
  if (denominator <= 0) {
    return 0;
  }
  if (numerator >= 0) {
    return numerator / denominator;
  }
  return -((-numerator + denominator - 1) / denominator);
}

WideInteger DivideUp(WideInteger numerator, WideInteger denominator) {
  if (denominator <= 0) {
    return 0;
  }
  if (numerator >= 0) {
    return (numerator + denominator - 1) / denominator;
  }
  return -((-numerator) / denominator);
}

A_long ClampWideToTimeValue(WideInteger value) {
  return static_cast<A_long>(std::max<WideInteger>(
    std::numeric_limits<A_long>::min(),
    std::min<WideInteger>(std::numeric_limits<A_long>::max(), value)
  ));
}

}  // namespace

long ResolveCodeTimelineFrame(
  const A_Time& time,
  const A_Time& startTime,
  A_long frameStep,
  A_u_long frameScale,
  CodeTimelineFrameRounding rounding
) {
  if (frameStep <= 0 || frameScale == 0) {
    return 1;
  }
  const WideInteger timeScale = std::max<A_u_long>(1, time.scale);
  const WideInteger startScale = std::max<A_u_long>(1, startTime.scale);
  const WideInteger deltaNumerator =
    static_cast<WideInteger>(time.value) * startScale -
    static_cast<WideInteger>(startTime.value) * timeScale;
  if (deltaNumerator <= 0) {
    return 1;
  }
  const WideInteger frameNumerator =
    deltaNumerator * static_cast<WideInteger>(frameScale);
  const WideInteger frameDenominator =
    timeScale * startScale * static_cast<WideInteger>(frameStep);
  const WideInteger offset = rounding == CodeTimelineFrameRounding::kUp
    ? DivideUp(frameNumerator, frameDenominator)
    : DivideDown(frameNumerator, frameDenominator);
  const WideInteger frame = offset + 1;
  return static_cast<long>(std::max<WideInteger>(
    1,
    std::min<WideInteger>(std::numeric_limits<long>::max(), frame)
  ));
}

A_long ResolveCodeTimelineFrameTimeValue(
  long frame,
  const A_Time& startTime,
  A_long frameStep,
  A_u_long outputTimeScale
) {
  if (outputTimeScale == 0) {
    return 0;
  }
  const WideInteger startScale = std::max<A_u_long>(1, startTime.scale);
  const WideInteger scaledStartNumerator =
    static_cast<WideInteger>(startTime.value) *
    static_cast<WideInteger>(outputTimeScale);
  const WideInteger roundedStart = scaledStartNumerator >= 0
    ? (scaledStartNumerator + startScale / 2) / startScale
    : -((-scaledStartNumerator + startScale / 2) / startScale);
  const WideInteger frameOffset = static_cast<WideInteger>(
    std::max<long>(0, frame - 1)
  ) * static_cast<WideInteger>(std::max<A_long>(0, frameStep));
  return ClampWideToTimeValue(roundedStart + frameOffset);
}

bool FindSingleInsertedCodeCue(
  const CodeCueTimelineFingerprint& previous,
  const CodeCueTimelineFingerprint& current,
  std::size_t* insertedIndex
) {
  if (current.size() != previous.size() + 1) {
    return false;
  }
  std::size_t previousIndex = 0;
  std::size_t currentIndex = 0;
  std::size_t insertion = current.size();
  while (currentIndex < current.size()) {
    if (previousIndex < previous.size() &&
        CodeCueFingerprintsEqual(
          previous[previousIndex],
          current[currentIndex]
        )) {
      ++previousIndex;
      ++currentIndex;
      continue;
    }
    if (insertion != current.size()) {
      return false;
    }
    insertion = currentIndex;
    ++currentIndex;
  }
  if (previousIndex != previous.size() || insertion == current.size()) {
    return false;
  }
  if (insertedIndex) {
    *insertedIndex = insertion;
  }
  return true;
}

void ObserveKnownCodeCueTimelineFromRender(
  std::uint64_t liveEffectSessionId,
  const CodeCueTimelineFingerprint& timeline
) {
  if (liveEffectSessionId == 0) {
    return;
  }
  std::lock_guard<std::mutex> lock(gCodeCueTimelineMutex);
  const auto existing = gKnownCodeCueTimelines.find(liveEffectSessionId);
  if (existing == gKnownCodeCueTimelines.end()) {
    gKnownCodeCueTimelines.emplace(liveEffectSessionId, timeline);
  } else if (timeline.size() <= existing->second.size()) {
    // Preserve the older state across a size increase. The UI-thread observer
    // needs that predecessor to recognize a native AE key insertion.
    existing->second = timeline;
  }
}

void SetKnownCodeCueTimeline(
  std::uint64_t liveEffectSessionId,
  const CodeCueTimelineFingerprint& timeline
) {
  if (liveEffectSessionId == 0) {
    return;
  }
  std::lock_guard<std::mutex> lock(gCodeCueTimelineMutex);
  gKnownCodeCueTimelines[liveEffectSessionId] = timeline;
}

bool ReplaceKnownCodeCueTimeline(
  std::uint64_t liveEffectSessionId,
  const CodeCueTimelineFingerprint& current,
  CodeCueTimelineFingerprint* previous
) {
  if (liveEffectSessionId == 0) {
    return false;
  }
  std::lock_guard<std::mutex> lock(gCodeCueTimelineMutex);
  const auto existing = gKnownCodeCueTimelines.find(liveEffectSessionId);
  const bool hadPrevious = existing != gKnownCodeCueTimelines.end();
  if (hadPrevious && previous) {
    *previous = existing->second;
  }
  gKnownCodeCueTimelines[liveEffectSessionId] = current;
  return hadPrevious;
}

void DiscardKnownCodeCueTimeline(std::uint64_t liveEffectSessionId) {
  if (liveEffectSessionId == 0) {
    return;
  }
  std::lock_guard<std::mutex> lock(gCodeCueTimelineMutex);
  gKnownCodeCueTimelines.erase(liveEffectSessionId);
}

}  // namespace momentum
