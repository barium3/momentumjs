#include <JavaScriptCore/JavaScript.h>

#include <cmath>
#include <iostream>
#include <string>

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
  return ok ? 0 : 1;
}
