#define MOMENTUM_CODE_EDITOR_INTERNALS 1
#include "host/effect/code_editor.h"
#undef MOMENTUM_CODE_EDITOR_INTERNALS

#include <cassert>
#include <string>
#include <utility>
#include <vector>

int main() {
  (void)momentum::ResetCodeEditSessions();

  momentum::NativeCodeEditSession first;
  first.token = "first";
  first.codeStreamUniqueId = 7;
  std::vector<std::string> superseded;
  momentum::StoreCodeEditSession(std::move(first), &superseded);
  assert(superseded.empty());
  assert(momentum::IsCodeEditSessionActive("first"));
  momentum::NativeCodeEditSession activeSession;
  assert(momentum::ReadActiveCodeEditSession(&activeSession));
  assert(activeSession.token == "first");

  momentum::NativeCodeEditSession second;
  second.token = "second";
  second.codeStreamUniqueId = 7;
  momentum::StoreCodeEditSession(std::move(second), &superseded);
  assert(superseded.size() == 1);
  assert(superseded.front() == "first");
  assert(!momentum::IsCodeEditSessionActive("first"));
  assert(momentum::IsCodeEditSessionActive("second"));
  assert(momentum::ReadActiveCodeEditSession(&activeSession));
  assert(activeSession.token == "second");

  momentum::PendingCodeEditCommit commit;
  commit.token = "second";
  assert(momentum::QueueCodeEditCommit(std::move(commit)));

  momentum::PendingCodeEditCommit duplicateCommit;
  duplicateCommit.token = "duplicate";
  assert(!momentum::QueueCodeEditCommit(std::move(duplicateCommit)));

  momentum::NativeCodeEditSession third;
  third.token = "third";
  third.codeStreamUniqueId = 7;
  superseded.clear();
  momentum::StoreCodeEditSession(std::move(third), &superseded);
  assert(superseded.empty());
  assert(momentum::IsCodeEditSessionActive("second"));
  assert(momentum::IsCodeEditSessionActive("third"));
  assert(momentum::ReadActiveCodeEditSession(&activeSession));
  assert(activeSession.token == "third");

  momentum::PendingNativeCodeCueReconcile reconcile;
  assert(momentum::QueueCodeCueReconcile(std::move(reconcile)));
  momentum::PendingNativeCodeCueReconcile duplicateReconcile;
  assert(!momentum::QueueCodeCueReconcile(
    std::move(duplicateReconcile)
  ));

  momentum::PendingCodeEditorWork work =
    momentum::TakePendingCodeEditorWork();
  assert(work.commit.has_value());
  assert(work.commit->token == "second");
  assert(work.reconcile.has_value());

  momentum::NativeCodeEditSession readBack;
  assert(momentum::ReadCodeEditSession("third", &readBack));
  assert(readBack.codeStreamUniqueId == 7);
  momentum::RemoveCodeEditSession("third");
  assert(!momentum::IsCodeEditSessionActive("third"));
  assert(!momentum::ReadActiveCodeEditSession(&activeSession));

  momentum::PendingNativeCodeCueReconcile abandonedReconcile;
  abandonedReconcile.inheritedSourceHash = "inherited";
  assert(momentum::QueueCodeCueReconcile(
    std::move(abandonedReconcile)
  ));
  momentum::PendingCodeEditCommit abandonedCommit;
  abandonedCommit.token = "abandoned";
  assert(momentum::QueueCodeEditCommit(std::move(abandonedCommit)));
  momentum::PendingCodeEditorWork abandoned =
    momentum::ResetCodeEditSessions();
  assert(abandoned.reconcile.has_value());
  assert(
    abandoned.reconcile->inheritedSourceHash == "inherited"
  );
  assert(abandoned.commit.has_value());
  assert(abandoned.commit->token == "abandoned");
  assert(!momentum::HasPendingCodeCueReconcile());
  assert(!momentum::ReadActiveCodeEditSession(&activeSession));
  return 0;
}
