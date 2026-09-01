#include "rendering/bitmap/backends/cuda/compatibility.h"
#include "rendering/bitmap/backends/cuda/context_scope.h"

#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <vector>

namespace {

using ContextHandle = void*;

struct FakeDriverState {
  ContextHandle current = nullptr;
  std::vector<ContextHandle> stack;
  int getResult = 0;
  int pushResult = 0;
  int popResult = 0;
  int getCalls = 0;
  int pushCalls = 0;
  int popCalls = 0;
};

FakeDriverState* gState = nullptr;

int GetCurrent(ContextHandle* output) {
  gState->getCalls += 1;
  if (gState->getResult == 0 && output) {
    *output = gState->current;
  }
  return gState->getResult;
}

int PushCurrent(ContextHandle context) {
  gState->pushCalls += 1;
  if (gState->pushResult == 0) {
    gState->stack.push_back(gState->current);
    gState->current = context;
  }
  return gState->pushResult;
}

int PopCurrent(ContextHandle* output) {
  gState->popCalls += 1;
  if (gState->popResult != 0) {
    return gState->popResult;
  }
  if (output) {
    *output = gState->current;
  }
  gState->current = gState->stack.empty() ? nullptr : gState->stack.back();
  if (!gState->stack.empty()) {
    gState->stack.pop_back();
  }
  return 0;
}

struct FakeApi {
  int (*ctxGetCurrent)(ContextHandle*) = &GetCurrent;
  int (*ctxPushCurrent)(ContextHandle) = &PushCurrent;
  int (*ctxPopCurrent)(ContextHandle*) = &PopCurrent;
};

void Expect(bool condition, const char* message) {
  if (!condition) {
    std::cerr << message << '\n';
    std::exit(1);
  }
}

ContextHandle Handle(std::uintptr_t value) {
  return reinterpret_cast<ContextHandle>(value);
}

}  // namespace

int main() {
  const FakeApi api;
  const ContextHandle aeContext = Handle(0x1000);
  const ContextHandle previousContext = Handle(0x2000);

  static_assert(
    !momentum::bitmap::cuda::detail::IsComputeCapabilitySupported(5, 0),
    "compute 5.0 must remain below the embedded PTX baseline"
  );
  static_assert(
    momentum::bitmap::cuda::detail::IsComputeCapabilitySupported(5, 2),
    "compute 5.2 must match the embedded PTX baseline"
  );
  static_assert(
    momentum::bitmap::cuda::detail::IsComputeCapabilitySupported(7, 5),
    "Turing must remain compatible with the embedded PTX baseline"
  );
  static_assert(
    momentum::bitmap::cuda::detail::IsComputeCapabilitySupported(12, 0),
    "newer compute capabilities must remain forward-compatible"
  );

  {
    FakeDriverState state;
    gState = &state;
    momentum::bitmap::cuda::detail::ContextScope<FakeApi, ContextHandle> scope(
      api,
      nullptr
    );
    Expect(!scope.active(), "a null AE context must be rejected");
    Expect(
      state.getCalls == 0 && state.pushCalls == 0 && state.popCalls == 0,
      "a null AE context must not call the CUDA driver"
    );
  }

  {
    FakeDriverState state;
    state.current = aeContext;
    gState = &state;
    momentum::bitmap::cuda::detail::ContextScope<FakeApi, ContextHandle> scope(
      api,
      aeContext
    );
    Expect(scope.active(), "an already-current AE context must be accepted");
    Expect(!scope.pushed(), "an already-current AE context must not be pushed again");
    Expect(state.getCalls == 1 && state.pushCalls == 0, "same-context call counts are wrong");
  }

  {
    FakeDriverState state;
    state.current = previousContext;
    gState = &state;
    {
      momentum::bitmap::cuda::detail::ContextScope<FakeApi, ContextHandle> scope(
        api,
        aeContext
      );
      Expect(scope.active() && scope.pushed(), "AE context must be pushed when another is current");
      Expect(state.current == aeContext, "AE context was not made current");
    }
    Expect(state.current == previousContext, "the previous CUDA context was not restored");
    Expect(state.pushCalls == 1 && state.popCalls == 1, "push/pop must stay balanced");
  }

  {
    FakeDriverState state;
    state.getResult = 201;
    gState = &state;
    momentum::bitmap::cuda::detail::ContextScope<FakeApi, ContextHandle> scope(
      api,
      aeContext
    );
    Expect(!scope.active(), "a failed current-context query must reject the scope");
    Expect(
      scope.operation() == momentum::bitmap::cuda::detail::ContextScopeOperation::kGetCurrent,
      "a current-context query failure must retain its failure stage"
    );
    Expect(state.pushCalls == 0 && state.popCalls == 0, "a failed query must not mutate context state");
  }

  {
    FakeDriverState state;
    state.pushResult = 201;
    gState = &state;
    momentum::bitmap::cuda::detail::ContextScope<FakeApi, ContextHandle> scope(
      api,
      aeContext
    );
    Expect(!scope.active(), "a failed CUDA context push must reject the scope");
    Expect(
      scope.operation() == momentum::bitmap::cuda::detail::ContextScopeOperation::kPushCurrent,
      "a failed CUDA context push must retain its failure stage"
    );
    Expect(scope.result() == 201, "a failed CUDA context push must retain its driver result");
    Expect(state.popCalls == 0, "a failed push must not be popped");
  }

  {
    FakeDriverState state;
    state.current = previousContext;
    state.popResult = 201;
    gState = &state;
    momentum::bitmap::cuda::detail::ContextScope<FakeApi, ContextHandle> scope(
      api,
      aeContext
    );
    Expect(scope.active(), "the pop-failure case must first bind the AE context");
    Expect(!scope.Release(), "a CUDA context pop failure must be reported");
    Expect(
      scope.operation() == momentum::bitmap::cuda::detail::ContextScopeOperation::kPopCurrent,
      "a CUDA context pop failure must retain its failure stage"
    );
    Expect(scope.result() == 201, "a CUDA context pop failure must retain its driver result");
  }

  return 0;
}
