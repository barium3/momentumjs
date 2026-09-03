#include <JavaScriptCore/JavaScript.h>

#include <algorithm>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {

JSValueRef AddOne(
  JSContextRef context,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  if (argumentCount == 0) {
    return JSValueMakeNumber(context, 1.0);
  }
  return JSValueMakeNumber(
    context,
    JSValueToNumber(context, arguments[0], nullptr) + 1.0
  );
}

JSValueRef Evaluate(
  JSContextRef context,
  const char* source,
  JSValueRef* exception
) {
  JSStringRef script = JSStringCreateWithUTF8CString(source);
  JSStringRef sourceUrl = JSStringCreateWithUTF8CString("compat-test.js");
  JSValueRef result = JSEvaluateScript(
    context,
    script,
    nullptr,
    sourceUrl,
    1,
    exception
  );
  JSStringRelease(sourceUrl);
  JSStringRelease(script);
  return result;
}

std::string ToString(JSContextRef context, JSValueRef value) {
  JSStringRef string = JSValueToStringCopy(context, value, nullptr);
  if (!string) {
    return std::string();
  }
  std::string result(JSStringGetMaximumUTF8CStringSize(string), '\0');
  const std::size_t written = JSStringGetUTF8CString(
    string,
    result.data(),
    result.size()
  );
  JSStringRelease(string);
  if (written > 0) {
    result.resize(written - 1);
  } else {
    result.clear();
  }
  return result;
}

bool Expect(bool condition, const char* message) {
  if (!condition) {
    std::cerr << message << '\n';
  }
  return condition;
}

class ThreadWorkers final {
 public:
  explicit ThreadWorkers(std::size_t count)
    : stackAddresses_(count),
      tasks_(count),
      taskPending_(count, false),
      completed_(count, 0) {
    threads_.reserve(count);
    for (std::size_t index = 0; index < count; ++index) {
      threads_.emplace_back([this, index]() {
        char stackMarker = 0;
        std::unique_lock<std::mutex> lock(mutex_);
        stackAddresses_[index] = reinterpret_cast<std::uintptr_t>(&stackMarker);
        readyCount_ += 1;
        condition_.notify_all();

        for (;;) {
          condition_.wait(lock, [this, index]() {
            return stopping_ || taskPending_[index];
          });
          if (stopping_) {
            return;
          }

          std::function<void()> task = std::move(tasks_[index]);
          taskPending_[index] = false;
          lock.unlock();
          task();
          lock.lock();
          completed_[index] += 1;
          condition_.notify_all();
        }
      });
    }

    std::unique_lock<std::mutex> lock(mutex_);
    condition_.wait(lock, [this, count]() {
      return readyCount_ == count;
    });
    lowest_ = static_cast<std::size_t>(std::distance(
      stackAddresses_.begin(),
      std::min_element(stackAddresses_.begin(), stackAddresses_.end())
    ));
    highest_ = static_cast<std::size_t>(std::distance(
      stackAddresses_.begin(),
      std::max_element(stackAddresses_.begin(), stackAddresses_.end())
    ));
  }

  ~ThreadWorkers() {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      stopping_ = true;
    }
    condition_.notify_all();
    for (std::thread& thread : threads_) {
      thread.join();
    }
  }

  ThreadWorkers(const ThreadWorkers&) = delete;
  ThreadWorkers& operator=(const ThreadWorkers&) = delete;

  void Run(std::size_t index, std::function<void()> task) {
    std::unique_lock<std::mutex> lock(mutex_);
    const std::uint64_t targetCompletion = completed_[index] + 1;
    tasks_[index] = std::move(task);
    taskPending_[index] = true;
    condition_.notify_all();
    condition_.wait(lock, [this, index, targetCompletion]() {
      return completed_[index] >= targetCompletion;
    });
  }

  std::size_t lowest() const {
    return lowest_;
  }

  std::size_t highest() const {
    return highest_;
  }

  std::uintptr_t stackSpan() const {
    return stackAddresses_[highest_] - stackAddresses_[lowest_];
  }

 private:
  std::mutex mutex_;
  std::condition_variable condition_;
  std::vector<std::thread> threads_;
  std::vector<std::uintptr_t> stackAddresses_;
  std::vector<std::function<void()>> tasks_;
  std::vector<bool> taskPending_;
  std::vector<std::uint64_t> completed_;
  std::size_t readyCount_ = 0;
  std::size_t lowest_ = 0;
  std::size_t highest_ = 0;
  bool stopping_ = false;
};

}  // namespace

int main() {
  JSGlobalContextRef context = JSGlobalContextCreate(nullptr);
  if (!Expect(context != nullptr, "context creation failed")) {
    return 1;
  }

  JSObjectRef global = JSContextGetGlobalObject(context);
  JSStringRef addOneName = JSStringCreateWithUTF8CString("nativeAddOne");
  JSObjectRef addOne = JSObjectMakeFunctionWithCallback(
    context,
    addOneName,
    AddOne
  );
  JSObjectSetProperty(
    context,
    global,
    addOneName,
    addOne,
    kJSPropertyAttributeNone,
    nullptr
  );
  JSStringRelease(addOneName);

  JSValueRef exception = nullptr;
  JSValueRef numeric = Evaluate(context, "nativeAddOne(41)", &exception);
  bool ok = Expect(exception == nullptr, "native callback raised an exception") &&
    Expect(numeric != nullptr, "native callback returned no value") &&
    Expect(
      std::fabs(JSValueToNumber(context, numeric, nullptr) - 42.0) < 1e-9,
      "native callback returned the wrong number"
    );

  JSValueRef json = Evaluate(
    context,
    "JSON.stringify({answer:nativeAddOne(41), list:[1,2,3]})",
    &exception
  );
  ok = Expect(exception == nullptr, "JSON evaluation raised an exception") && ok;
  ok = Expect(
    ToString(context, json) == "{\"answer\":42,\"list\":[1,2,3]}",
    "JSON evaluation returned the wrong value"
  ) && ok;

  JSValueProtect(context, numeric);
  JSGarbageCollect(context);
  JSValueRef second = Evaluate(context, "nativeAddOne(9)", &exception);
  ok = Expect(exception == nullptr, "second evaluation raised an exception") && ok;
  ok = Expect(
    std::fabs(JSValueToNumber(context, second, nullptr) - 10.0) < 1e-9,
    "second evaluation returned the wrong value"
  ) && ok;
  ok = Expect(
    std::fabs(JSValueToNumber(context, numeric, nullptr) - 42.0) < 1e-9,
    "protected value did not survive another evaluation"
  ) && ok;
  JSValueUnprotect(context, numeric);

  exception = nullptr;
  JSValueRef failed = Evaluate(context, "throw new Error('boom')", &exception);
  ok = Expect(failed == nullptr, "throwing script unexpectedly returned a value") && ok;
  ok = Expect(exception != nullptr, "throwing script did not expose an exception") && ok;
  ok = Expect(
    exception && ToString(context, exception).find("boom") != std::string::npos,
    "exception text did not contain the thrown message"
  ) && ok;

  JSGlobalContextRelease(context);

  // AE Multi-Frame Rendering can reuse one persistent runtime on different
  // worker threads. Keep a set of workers alive so Windows cannot recycle the
  // same stack, then deliberately migrate from the highest stack address to
  // the lowest. Without JS_UpdateStackTop this deterministically trips
  // QuickJS's stale stack-overflow boundary.
  ThreadWorkers workers(16);
  const bool separatedStacks = workers.stackSpan() > 2 * 1024 * 1024;
  ok = Expect(
    separatedStacks,
    "worker stacks were not separated enough for the migration test"
  ) && ok;

  if (separatedStacks) {
    JSGlobalContextRef callContext = nullptr;
    JSObjectRef recursiveFunction = nullptr;
    bool functionCreated = false;
    workers.Run(workers.highest(), [&]() {
      callContext = JSGlobalContextCreate(nullptr);
      JSValueRef workerException = nullptr;
      recursiveFunction = Evaluate(
        callContext,
        "(function(){function recurse(n){return n ? recurse(n-1)+1 : 0;}"
        "return recurse(112);})",
        &workerException
      );
      functionCreated = workerException == nullptr &&
        recursiveFunction != nullptr &&
        JSObjectIsFunction(callContext, recursiveFunction);
      if (recursiveFunction) {
        JSValueProtect(callContext, recursiveFunction);
      }
    });
    ok = Expect(functionCreated, "failed to create the cross-thread callable") && ok;

    bool callOk = false;
    if (functionCreated) {
      workers.Run(workers.lowest(), [&]() {
        JSValueRef workerException = nullptr;
        JSValueRef value = JSObjectCallAsFunction(
          callContext,
          recursiveFunction,
          nullptr,
          0,
          nullptr,
          &workerException
        );
        callOk = workerException == nullptr &&
          value != nullptr &&
          std::fabs(JSValueToNumber(callContext, value, nullptr) - 112.0) < 1e-9;
      });
      ok = Expect(
        callOk,
        "function call failed after a worker-thread migration"
      ) && ok;
    }
    workers.Run(workers.highest(), [&]() {
      if (recursiveFunction) {
        JSValueUnprotect(callContext, recursiveFunction);
      }
      JSGlobalContextRelease(callContext);
    });

    JSGlobalContextRef evalContext = nullptr;
    workers.Run(workers.highest(), [&]() {
      evalContext = JSGlobalContextCreate(nullptr);
    });
    ok = Expect(evalContext != nullptr, "migration context creation failed") && ok;

    bool evalOk = false;
    if (evalContext) {
      workers.Run(workers.lowest(), [&]() {
        JSValueRef workerException = nullptr;
        JSValueRef value = Evaluate(
          evalContext,
          "(function recurse(n){return n ? recurse(n-1)+1 : 0;})(128)",
          &workerException
        );
        evalOk = workerException == nullptr &&
          value != nullptr &&
          std::fabs(JSValueToNumber(evalContext, value, nullptr) - 128.0) < 1e-9;
      });
      ok = Expect(
        evalOk,
        "evaluation failed after a worker-thread migration"
      ) && ok;
      workers.Run(workers.highest(), [&]() {
        JSGlobalContextRelease(evalContext);
      });
    }
  }

  return ok ? 0 : 1;
}
