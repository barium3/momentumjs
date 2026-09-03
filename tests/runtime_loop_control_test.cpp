#include "scripting/runtime/loop_control.h"

#include <iostream>

namespace {

bool Expect(bool condition, const char* message) {
  if (!condition) {
    std::cerr << message << '\n';
  }
  return condition;
}

}  // namespace

int main() {
  bool ok = true;

  momentum::RuntimeLoopState stoppedInSetup;
  momentum::PauseRuntimeLoop(&stoppedInSetup);
  momentum::RequestRuntimeRedraw(&stoppedInSetup, 3);
  ok = Expect(
    stoppedInSetup.pendingRedraws == 0,
    "redraw() in setup must be ignored"
  ) && ok;
  ok = Expect(
    momentum::BeginRuntimeDrawTick(&stoppedInSetup),
    "noLoop() in setup must still admit the first draw"
  ) && ok;
  momentum::CompleteRuntimeDraw(&stoppedInSetup);
  ok = Expect(
    !momentum::BeginRuntimeDrawTick(&stoppedInSetup),
    "a stopped runtime must freeze after its first draw"
  ) && ok;
  ok = Expect(
    stoppedInSetup.drawCount == 1,
    "drawCount must count executed draw calls"
  ) && ok;

  momentum::CompleteRuntimeSetup(&stoppedInSetup);
  momentum::RequestRuntimeRedraw(&stoppedInSetup, 3);
  for (int index = 0; index < 3; ++index) {
    ok = Expect(
      index == 0
        ? momentum::BeginRuntimeDrawTick(&stoppedInSetup)
        : momentum::ConsumeRuntimeQueuedRedraw(&stoppedInSetup),
      "redraw(n) must admit exactly n draws while stopped"
    ) && ok;
    momentum::CompleteRuntimeDraw(&stoppedInSetup);
  }
  ok = Expect(
    !momentum::ConsumeRuntimeQueuedRedraw(&stoppedInSetup),
    "redraw queue must be empty after n draws"
  ) && ok;
  ok = Expect(
    stoppedInSetup.drawCount == 4,
    "redraw(n) must advance drawCount for every executed draw"
  ) && ok;

  momentum::ResumeRuntimeLoop(&stoppedInSetup);
  ok = Expect(
    stoppedInSetup.looping && momentum::BeginRuntimeDrawTick(&stoppedInSetup),
    "loop() must resume the normal draw tick"
  ) && ok;
  momentum::CompleteRuntimeDraw(&stoppedInSetup);
  momentum::RequestRuntimeRedraw(&stoppedInSetup, 5);
  ok = Expect(
    stoppedInSetup.pendingRedraws == 5,
    "redraw() outside draw must work while already looping"
  ) && ok;

  momentum::RuntimeLoopState requestedInDraw;
  momentum::CompleteRuntimeSetup(&requestedInDraw);
  momentum::EnterRuntimeUserDraw(&requestedInDraw);
  momentum::RequestRuntimeRedraw(&requestedInDraw, 2);
  ok = Expect(
    requestedInDraw.pendingRedraws == 0,
    "redraw() inside draw must be ignored"
  ) && ok;
  momentum::ExitRuntimeUserDraw(&requestedInDraw);

  momentum::RuntimeLoopState resumed;
  momentum::CompleteRuntimeSetup(&resumed);
  momentum::PauseRuntimeLoop(&resumed);
  momentum::ResumeRuntimeLoop(&resumed);
  ok = Expect(
    resumed.looping,
    "loop() must restore the looping state"
  ) && ok;

  momentum::RuntimeLoopState capped;
  momentum::CompleteRuntimeSetup(&capped);
  momentum::PauseRuntimeLoop(&capped);
  momentum::RequestRuntimeRedraw(&capped, momentum::kMaxPendingRedraws + 50);
  ok = Expect(
    capped.pendingRedraws == momentum::kMaxPendingRedraws,
    "redraw queue must be bounded"
  ) && ok;

  return ok ? 0 : 1;
}
