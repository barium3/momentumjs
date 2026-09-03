#include "scripting/api/callbacks/structure.h"

#include <algorithm>
#include <cmath>

#include "scripting/runtime/loop_control.h"

namespace momentum {
namespace {

long ParseRedrawCount(
  JSContextRef ctx,
  JSValueRef value,
  JSValueRef* exception
) {
  if (!ctx || !value) {
    return 1;
  }

  JSValueRef localException = NULL;
  JSObjectRef globalObject = JSContextGetGlobalObject(ctx);
  JSStringRef parseIntName = JSStringCreateWithUTF8CString("parseInt");
  JSValueRef parseIntValue = JSObjectGetProperty(
    ctx,
    globalObject,
    parseIntName,
    &localException
  );
  JSStringRelease(parseIntName);
  if (localException || !parseIntValue || !JSValueIsObject(ctx, parseIntValue)) {
    if (localException && exception) {
      *exception = localException;
    }
    return 1;
  }

  JSObjectRef parseIntFunction = JSValueToObject(
    ctx,
    parseIntValue,
    &localException
  );
  if (localException || !parseIntFunction) {
    if (localException && exception) {
      *exception = localException;
    }
    return 1;
  }

  JSValueRef parsedValue = JSObjectCallAsFunction(
    ctx,
    parseIntFunction,
    globalObject,
    1,
    &value,
    &localException
  );
  if (localException) {
    if (exception) {
      *exception = localException;
    }
    return 1;
  }

  const double parsedNumber = JSValueToNumber(
    ctx,
    parsedValue,
    &localException
  );
  if (localException) {
    if (exception) {
      *exception = localException;
    }
    return 1;
  }
  if (!std::isfinite(parsedNumber) || parsedNumber < 1.0) {
    return 1;
  }
  return static_cast<long>(std::min<double>(
    parsedNumber,
    static_cast<double>(kMaxPendingRedraws)
  ));
}

}  // namespace

JSValueRef JsIsLooping(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)argumentCount;
  (void)arguments;
  (void)exception;
  return JSValueMakeBoolean(
    ctx,
    !g_activeRuntime || g_activeRuntime->loopState.looping
  );
}

JSValueRef JsLoop(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)argumentCount;
  (void)arguments;
  (void)exception;
  if (g_activeRuntime) {
    ResumeRuntimeLoop(&g_activeRuntime->loopState);
  }
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsNoLoop(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)argumentCount;
  (void)arguments;
  (void)exception;
  if (g_activeRuntime) {
    PauseRuntimeLoop(&g_activeRuntime->loopState);
  }
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsRedraw(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  const long count = argumentCount > 0
    ? ParseRedrawCount(ctx, arguments[0], exception)
    : 1;
  if (exception && *exception) {
    return JSValueMakeUndefined(ctx);
  }
  if (g_activeRuntime) {
    RequestRuntimeRedraw(&g_activeRuntime->loopState, count);
  }
  return JSValueMakeUndefined(ctx);
}

}  // namespace momentum
