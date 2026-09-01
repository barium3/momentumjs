#pragma once

#include <string>

namespace momentum {
namespace bitmap {
namespace cuda {
namespace detail {

enum class ContextScopeOperation {
  kNone,
  kGetCurrent,
  kPushCurrent,
  kPopCurrent,
  kUnexpectedPoppedContext,
};

inline const char* ContextScopeOperationName(ContextScopeOperation operation) {
  switch (operation) {
    case ContextScopeOperation::kGetCurrent:
      return "CUDA current-context query";
    case ContextScopeOperation::kPushCurrent:
      return "CUDA context bind";
    case ContextScopeOperation::kPopCurrent:
      return "CUDA context restore";
    case ContextScopeOperation::kUnexpectedPoppedContext:
      return "CUDA context restore validation";
    case ContextScopeOperation::kNone:
    default:
      return "CUDA context scope";
  }
}

// CUDA contexts are current per CPU thread. AE owns the context, so Momentum
// only borrows it for the duration of one setup/render/setdown operation. The
// API type is intentionally templated so this lifecycle can be tested without
// loading a CUDA driver or depending on one GPU model.
template <typename Api, typename ContextHandle>
class ContextScope {
 public:
  ContextScope(const Api& api, ContextHandle requestedContext)
    : api_(api), requestedContext_(requestedContext) {
    if (!requestedContext_ ||
        !api_.ctxGetCurrent ||
        !api_.ctxPushCurrent ||
        !api_.ctxPopCurrent) {
      operation_ = ContextScopeOperation::kGetCurrent;
      result_ = -1;
      return;
    }

    ContextHandle currentContext = nullptr;
    result_ = api_.ctxGetCurrent(&currentContext);
    if (result_ != 0) {
      operation_ = ContextScopeOperation::kGetCurrent;
      return;
    }

    if (currentContext == requestedContext_) {
      active_ = true;
      return;
    }

    result_ = api_.ctxPushCurrent(requestedContext_);
    if (result_ != 0) {
      operation_ = ContextScopeOperation::kPushCurrent;
      return;
    }

    active_ = true;
    pushed_ = true;
  }

  ~ContextScope() {
    (void)Release();
  }

  ContextScope(const ContextScope&) = delete;
  ContextScope& operator=(const ContextScope&) = delete;

  bool active() const {
    return active_;
  }

  bool pushed() const {
    return pushed_;
  }

  int result() const {
    return result_;
  }

  ContextScopeOperation operation() const {
    return operation_;
  }

  bool Release() {
    if (released_) {
      return operation_ == ContextScopeOperation::kNone;
    }
    released_ = true;

    if (!pushed_) {
      active_ = false;
      return operation_ == ContextScopeOperation::kNone;
    }

    ContextHandle poppedContext = nullptr;
    const int popResult = api_.ctxPopCurrent(&poppedContext);
    pushed_ = false;
    active_ = false;
    if (popResult != 0) {
      result_ = popResult;
      operation_ = ContextScopeOperation::kPopCurrent;
      return false;
    }
    if (poppedContext != requestedContext_) {
      result_ = -1;
      operation_ = ContextScopeOperation::kUnexpectedPoppedContext;
      return false;
    }

    result_ = 0;
    operation_ = ContextScopeOperation::kNone;
    return true;
  }

 private:
  const Api& api_;
  ContextHandle requestedContext_ = nullptr;
  bool active_ = false;
  bool pushed_ = false;
  bool released_ = false;
  int result_ = 0;
  ContextScopeOperation operation_ = ContextScopeOperation::kNone;
};

}  // namespace detail
}  // namespace cuda
}  // namespace bitmap
}  // namespace momentum
