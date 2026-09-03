#include "scripting/runtime/loop_control.h"

#include <algorithm>
#include <limits>

namespace momentum {

void PauseRuntimeLoop(RuntimeLoopState* state) {
  if (state) {
    state->looping = false;
  }
}

void ResumeRuntimeLoop(RuntimeLoopState* state) {
  if (!state) {
    return;
  }
  state->looping = true;
}

void CompleteRuntimeSetup(RuntimeLoopState* state) {
  if (state) {
    state->setupDone = true;
  }
}

void EnterRuntimeUserDraw(RuntimeLoopState* state) {
  if (state) {
    state->inUserDraw = true;
  }
}

void ExitRuntimeUserDraw(RuntimeLoopState* state) {
  if (state) {
    state->inUserDraw = false;
  }
}

void RequestRuntimeRedraw(RuntimeLoopState* state, long count) {
  // p5 1.9 ignores redraw() until setup has completed and while user draw()
  // is on the stack. It does not require noLoop(); event handlers may request
  // an explicit redraw while the normal loop is still running.
  if (!state || !state->setupDone || state->inUserDraw || count <= 0) {
    return;
  }
  const long safeCount = std::min<long>(count, kMaxPendingRedraws);
  state->pendingRedraws = std::min<long>(
    kMaxPendingRedraws,
    state->pendingRedraws + safeCount
  );
}

bool ConsumeRuntimeQueuedRedraw(RuntimeLoopState* state) {
  if (!state || state->pendingRedraws <= 0) {
    return false;
  }
  state->pendingRedraws -= 1;
  return true;
}

bool BeginRuntimeDrawTick(RuntimeLoopState* state) {
  if (!state) {
    return false;
  }
  if (state->pendingRedraws > 0) {
    return ConsumeRuntimeQueuedRedraw(state);
  }
  if (!state->hasDrawn) {
    return true;
  }
  if (state->looping) {
    return true;
  }
  return false;
}

void CompleteRuntimeDraw(RuntimeLoopState* state) {
  if (!state) {
    return;
  }
  state->hasDrawn = true;
  if (state->drawCount < std::numeric_limits<long>::max()) {
    state->drawCount += 1;
  }
}

}  // namespace momentum
