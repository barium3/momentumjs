#include "host/code/timeline.h"

#include <iostream>

namespace {

bool Require(bool condition, const char* message) {
  if (!condition) {
    std::cerr << message << '\n';
  }
  return condition;
}

}  // namespace

int main() {
  using momentum::CodeTimelineFrameRounding;
  using momentum::ResolveCodeTimelineFrame;

  bool passed = true;
  const A_Time zero = {0, 1};
  const A_Time oneSecond = {1, 1};

  passed &= Require(
    ResolveCodeTimelineFrame(
      oneSecond,
      zero,
      1001,
      30000,
      CodeTimelineFrameRounding::kDown
    ) == 30,
    "29.97 target frame mapping drifted"
  );
  passed &= Require(
    ResolveCodeTimelineFrame(
      A_Time{30030, 30000},
      zero,
      1001,
      30000,
      CodeTimelineFrameRounding::kDown
    ) == 31,
    "an exact NTSC frame boundary mapped incorrectly"
  );
  passed &= Require(
    ResolveCodeTimelineFrame(
      A_Time{1, 60},
      zero,
      1,
      30,
      CodeTimelineFrameRounding::kUp
    ) == 2,
    "a subframe Cue activated before its first rendered frame"
  );
  passed &= Require(
    ResolveCodeTimelineFrame(
      A_Time{1, 1},
      A_Time{1, 2},
      1,
      24,
      CodeTimelineFrameRounding::kDown
    ) == 13,
    "segment-relative frame mapping is incorrect"
  );
  passed &= Require(
    momentum::CodeCueTimeIdentity(A_Time{2, 4}) == "1/2",
    "equivalent AE times do not share a stable identity"
  );
  passed &= Require(
    momentum::ResolveCodeTimelineFrameTimeValue(
      31,
      A_Time{1, 2},
      1001,
      30000
    ) == 45030,
    "frame-to-AE-time conversion is incorrect"
  );

  {
    const momentum::CodeRestartTimelineSelection selection =
      momentum::ResolveCodeRestartTimelineSelection(
        {A_Time{2, 1}, A_Time{5, 1}},
        {false, false},
        {A_Time{5, 1}},
        A_Time{5, 1}
      );
    passed &= Require(
      selection.restartCueAnchor &&
        selection.hardAnchorCodeCueIndex == 1 &&
        momentum::CodeCueTimesEqual(
          selection.hardAnchorTime,
          A_Time{5, 1}
        ),
      "same-time Code and Restart did not select Code before restarting"
    );
  }
  {
    const momentum::CodeRestartTimelineSelection selection =
      momentum::ResolveCodeRestartTimelineSelection(
        {A_Time{4, 1}, A_Time{7, 1}},
        {false, true},
        {A_Time{5, 1}},
        A_Time{8, 1}
      );
    passed &= Require(
      !selection.restartCueAnchor &&
        selection.hardAnchorCodeCueIndex == 1 &&
        momentum::CodeCueTimesEqual(
          selection.hardAnchorTime,
          A_Time{7, 1}
        ),
      "a later hard Code Cue did not supersede Restart"
    );
  }
  {
    const momentum::CodeRestartTimelineSelection selection =
      momentum::ResolveCodeRestartTimelineSelection(
        {A_Time{6, 1}},
        {false},
        {A_Time{3, 1}, A_Time{9, 1}},
        A_Time{4, 1}
      );
    passed &= Require(
      selection.restartCueAnchor &&
        selection.hardAnchorCodeCueIndex == -1 &&
        selection.hasNextRestartCue &&
        momentum::CodeCueTimesEqual(
          selection.nextRestartCueTime,
          A_Time{9, 1}
        ),
      "Restart without a preceding Code Cue did not anchor the Base source"
    );
  }
  return passed ? 0 : 1;
}
