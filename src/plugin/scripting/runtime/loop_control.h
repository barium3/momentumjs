#pragma once

namespace momentum {

// p5 loop control belongs to the sketch evaluator, not to an AE render
// request. AE may request frames out of order, so this state is replayed from
// the code document together with the rest of the JavaScript runtime.
struct RuntimeLoopState {
  bool looping = true;
  bool setupDone = false;
  bool inUserDraw = false;
  bool hasDrawn = false;
  long pendingRedraws = 0;
  long drawCount = 0;
};

constexpr long kMaxPendingRedraws = 1000;

void PauseRuntimeLoop(RuntimeLoopState* state);
void ResumeRuntimeLoop(RuntimeLoopState* state);
void CompleteRuntimeSetup(RuntimeLoopState* state);
void EnterRuntimeUserDraw(RuntimeLoopState* state);
void ExitRuntimeUserDraw(RuntimeLoopState* state);
void RequestRuntimeRedraw(RuntimeLoopState* state, long count);

// Returns whether draw() should run for a newly simulated AE timeline frame.
// The first draw is always admitted, matching p5's noLoop() behavior when it
// is called from setup(). Accepted redraw work takes precedence over the
// ordinary looping draw for this host tick.
bool BeginRuntimeDrawTick(RuntimeLoopState* state);

// Consumes redraw() work previously requested outside setup() and draw().
// Unlike BeginRuntimeDrawTick(), this never admits the normal looping draw a
// second time in the same AE timeline frame.
bool ConsumeRuntimeQueuedRedraw(RuntimeLoopState* state);

void CompleteRuntimeDraw(RuntimeLoopState* state);

}  // namespace momentum
