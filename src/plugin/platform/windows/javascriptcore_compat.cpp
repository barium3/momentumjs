#include <JavaScriptCore/JavaScript.h>

#include <quickjs.h>

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <limits>
#include <list>
#include <string>
#include <utility>
#include <vector>

struct MomentumJSString {
  std::string value;
};

struct MomentumJSValue {
  JSValue value = JS_UNDEFINED;
  std::size_t protectionCount = 0;
  std::uint64_t generation = 0;
};

struct MomentumJSContext {
  JSRuntime* runtime = nullptr;
  JSContext* context = nullptr;
  std::list<MomentumJSValue> values;
  std::vector<JSObjectCallAsFunctionCallback> callbacks;
  std::uint64_t nextGeneration = 1;
  std::uint64_t activeGeneration = 0;
};

namespace {

MomentumJSValue* WrapOwned(MomentumJSContext* context, JSValue value) {
  if (!context) {
    return nullptr;
  }
  context->values.emplace_back();
  MomentumJSValue& wrapped = context->values.back();
  wrapped.value = value;
  wrapped.generation = context->activeGeneration;
  return &wrapped;
}

MomentumJSValue* WrapBorrowed(
  MomentumJSContext* context,
  JSValueConst value
) {
  if (!context || !context->context) {
    return nullptr;
  }
  return WrapOwned(context, JS_DupValue(context->context, value));
}

void ReleaseGeneration(
  MomentumJSContext* context,
  std::uint64_t generation
) {
  if (!context || !context->context || generation == 0) {
    return;
  }
  for (auto current = context->values.begin(); current != context->values.end();) {
    if (current->generation == generation && current->protectionCount == 0) {
      JS_FreeValue(context->context, current->value);
      current = context->values.erase(current);
    } else {
      ++current;
    }
  }
}

const std::string& StringValue(JSStringRef string) {
  static const std::string empty;
  return string ? string->value : empty;
}

void StoreQuickJsException(
  MomentumJSContext* context,
  JSValueRef* exception
) {
  if (!context || !context->context) {
    if (exception) {
      *exception = nullptr;
    }
    return;
  }
  JSValue quickException = JS_GetException(context->context);
  if (exception) {
    *exception = WrapOwned(context, quickException);
  } else {
    JS_FreeValue(context->context, quickException);
  }
}

bool IsUsableObject(JSObjectRef object) {
  return object && JS_IsObject(object->value);
}

JSValue NativeCallbackBridge(
  JSContext* quickContext,
  JSValueConst thisValue,
  int argumentCount,
  JSValueConst* arguments,
  int callbackIndex
) {
  auto* context = static_cast<MomentumJSContext*>(
    JS_GetContextOpaque(quickContext)
  );
  if (!context || callbackIndex < 0 ||
      static_cast<std::size_t>(callbackIndex) >= context->callbacks.size()) {
    return JS_ThrowInternalError(quickContext, "Invalid Momentum native callback");
  }

  const std::uint64_t previousGeneration = context->activeGeneration;
  const std::uint64_t callbackGeneration = context->nextGeneration++;
  context->activeGeneration = callbackGeneration;

  JSObjectRef thisObject = WrapBorrowed(context, thisValue);
  std::vector<JSValueRef> wrappedArguments;
  wrappedArguments.reserve(static_cast<std::size_t>(std::max(0, argumentCount)));
  for (int index = 0; index < argumentCount; ++index) {
    wrappedArguments.push_back(WrapBorrowed(context, arguments[index]));
  }

  JSValueRef callbackException = nullptr;
  JSValueRef callbackResult = nullptr;
  try {
    callbackResult = context->callbacks[static_cast<std::size_t>(callbackIndex)](
      context,
      nullptr,
      thisObject,
      wrappedArguments.size(),
      wrappedArguments.empty() ? nullptr : wrappedArguments.data(),
      &callbackException
    );
  } catch (...) {
    context->activeGeneration = previousGeneration;
    ReleaseGeneration(context, callbackGeneration);
    return JS_ThrowInternalError(
      quickContext,
      "Unhandled exception in Momentum native callback"
    );
  }

  JSValue result = callbackResult
    ? JS_DupValue(quickContext, callbackResult->value)
    : JS_UNDEFINED;
  JSValue thrown = callbackException
    ? JS_DupValue(quickContext, callbackException->value)
    : JS_UNDEFINED;

  context->activeGeneration = previousGeneration;
  ReleaseGeneration(context, callbackGeneration);

  if (callbackException) {
    JS_FreeValue(quickContext, result);
    return JS_Throw(quickContext, thrown);
  }
  return result;
}

}  // namespace

JSGlobalContextRef JSGlobalContextCreate(JSClassRef globalObjectClass) {
  (void)globalObjectClass;
  auto* context = new MomentumJSContext();
  context->runtime = JS_NewRuntime();
  if (!context->runtime) {
    delete context;
    return nullptr;
  }
  context->context = JS_NewContext(context->runtime);
  if (!context->context) {
    JS_FreeRuntime(context->runtime);
    delete context;
    return nullptr;
  }
  JS_SetContextOpaque(context->context, context);
  return context;
}

void JSGlobalContextRelease(JSGlobalContextRef context) {
  if (!context) {
    return;
  }
  if (context->context) {
    JS_SetContextOpaque(context->context, nullptr);
    for (MomentumJSValue& value : context->values) {
      JS_FreeValue(context->context, value.value);
    }
    context->values.clear();
    JS_FreeContext(context->context);
  }
  if (context->runtime) {
    JS_FreeRuntime(context->runtime);
  }
  delete context;
}

void JSGarbageCollect(JSContextRef context) {
  if (!context || !context->context) {
    return;
  }
  for (auto current = context->values.begin();
       current != context->values.end();) {
    if (current->protectionCount == 0) {
      JS_FreeValue(context->context, current->value);
      current = context->values.erase(current);
    } else {
      ++current;
    }
  }
  JS_RunGC(context->runtime);
}

JSObjectRef JSContextGetGlobalObject(JSContextRef context) {
  if (!context || !context->context) {
    return nullptr;
  }
  return WrapOwned(context, JS_GetGlobalObject(context->context));
}

JSStringRef JSStringCreateWithUTF8CString(const char* string) {
  auto* result = new MomentumJSString();
  if (string) {
    result->value = string;
  }
  return result;
}

void JSStringRelease(JSStringRef string) {
  delete string;
}

std::size_t JSStringGetMaximumUTF8CStringSize(JSStringRef string) {
  return StringValue(string).size() + 1;
}

std::size_t JSStringGetUTF8CString(
  JSStringRef string,
  char* buffer,
  std::size_t bufferSize
) {
  if (!buffer || bufferSize == 0) {
    return 0;
  }
  const std::string& value = StringValue(string);
  const std::size_t copySize = std::min(value.size(), bufferSize - 1);
  if (copySize > 0) {
    std::memcpy(buffer, value.data(), copySize);
  }
  buffer[copySize] = '\0';
  return copySize + 1;
}

JSValueRef JSValueMakeUndefined(JSContextRef context) {
  return WrapOwned(context, JS_UNDEFINED);
}

JSValueRef JSValueMakeNull(JSContextRef context) {
  return WrapOwned(context, JS_NULL);
}

JSValueRef JSValueMakeBoolean(JSContextRef context, bool boolean) {
  return context && context->context
    ? WrapOwned(context, JS_NewBool(context->context, boolean))
    : nullptr;
}

JSValueRef JSValueMakeNumber(JSContextRef context, double number) {
  return context && context->context
    ? WrapOwned(context, JS_NewFloat64(context->context, number))
    : nullptr;
}

JSValueRef JSValueMakeString(JSContextRef context, JSStringRef string) {
  if (!context || !context->context) {
    return nullptr;
  }
  const std::string& value = StringValue(string);
  return WrapOwned(
    context,
    JS_NewStringLen(context->context, value.data(), value.size())
  );
}

JSValueRef JSValueMakeFromJSONString(JSContextRef context, JSStringRef string) {
  if (!context || !context->context || !string) {
    return nullptr;
  }
  JSValue value = JS_ParseJSON(
    context->context,
    string->value.data(),
    string->value.size(),
    "<json>"
  );
  if (JS_IsException(value)) {
    JSValue exception = JS_GetException(context->context);
    JS_FreeValue(context->context, exception);
    return nullptr;
  }
  return WrapOwned(context, value);
}

bool JSValueIsUndefined(JSContextRef ctx, JSValueRef value) {
  (void)ctx;
  return !value || JS_IsUndefined(value->value);
}

bool JSValueIsNull(JSContextRef ctx, JSValueRef value) {
  (void)ctx;
  return value && JS_IsNull(value->value);
}

bool JSValueIsBoolean(JSContextRef ctx, JSValueRef value) {
  (void)ctx;
  return value && JS_IsBool(value->value);
}

bool JSValueIsString(JSContextRef ctx, JSValueRef value) {
  (void)ctx;
  return value && JS_IsString(value->value);
}

bool JSValueIsObject(JSContextRef ctx, JSValueRef value) {
  (void)ctx;
  return value && JS_IsObject(value->value);
}

bool JSValueToBoolean(JSContextRef context, JSValueRef value) {
  if (!context || !context->context || !value) {
    return false;
  }
  return JS_ToBool(context->context, value->value) > 0;
}

double JSValueToNumber(
  JSContextRef context,
  JSValueRef value,
  JSValueRef* exception
) {
  if (exception) {
    *exception = nullptr;
  }
  if (!context || !context->context || !value) {
    return std::numeric_limits<double>::quiet_NaN();
  }
  double result = 0.0;
  if (JS_ToFloat64(context->context, &result, value->value) < 0) {
    StoreQuickJsException(context, exception);
    return std::numeric_limits<double>::quiet_NaN();
  }
  return result;
}

JSStringRef JSValueToStringCopy(
  JSContextRef context,
  JSValueRef value,
  JSValueRef* exception
) {
  if (exception) {
    *exception = nullptr;
  }
  if (!context || !context->context || !value) {
    return nullptr;
  }
  std::size_t length = 0;
  const char* utf8 = JS_ToCStringLen(context->context, &length, value->value);
  if (!utf8) {
    StoreQuickJsException(context, exception);
    return nullptr;
  }
  auto* result = new MomentumJSString();
  result->value.assign(utf8, length);
  JS_FreeCString(context->context, utf8);
  return result;
}

JSObjectRef JSValueToObject(
  JSContextRef context,
  JSValueRef value,
  JSValueRef* exception
) {
  if (exception) {
    *exception = nullptr;
  }
  if (!context || !context->context || !value) {
    return nullptr;
  }
  if (JS_IsObject(value->value)) {
    return value;
  }
  JSValue object = JS_ToObject(context->context, value->value);
  if (JS_IsException(object)) {
    StoreQuickJsException(context, exception);
    return nullptr;
  }
  return WrapOwned(context, object);
}

void JSValueProtect(JSContextRef ctx, JSValueRef value) {
  (void)ctx;
  if (value) {
    value->protectionCount += 1;
  }
}

void JSValueUnprotect(JSContextRef ctx, JSValueRef value) {
  (void)ctx;
  if (value && value->protectionCount > 0) {
    value->protectionCount -= 1;
  }
}

JSObjectRef JSObjectMake(JSContextRef context, JSClassRef jsClass, void* data) {
  (void)jsClass;
  (void)data;
  return context && context->context
    ? WrapOwned(context, JS_NewObject(context->context))
    : nullptr;
}

JSObjectRef JSObjectMakeArray(
  JSContextRef context,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  if (exception) {
    *exception = nullptr;
  }
  if (!context || !context->context) {
    return nullptr;
  }
  JSValue array = JS_NewArray(context->context);
  if (JS_IsException(array)) {
    StoreQuickJsException(context, exception);
    return nullptr;
  }
  for (std::size_t index = 0; index < argumentCount; ++index) {
    JSValue item = arguments && arguments[index]
      ? JS_DupValue(context->context, arguments[index]->value)
      : JS_UNDEFINED;
    if (JS_SetPropertyUint32(
          context->context,
          array,
          static_cast<std::uint32_t>(index),
          item
        ) < 0) {
      JS_FreeValue(context->context, array);
      StoreQuickJsException(context, exception);
      return nullptr;
    }
  }
  return WrapOwned(context, array);
}

JSObjectRef JSObjectMakeFunctionWithCallback(
  JSContextRef context,
  JSStringRef name,
  JSObjectCallAsFunctionCallback callback
) {
  if (!context || !context->context || !callback ||
      context->callbacks.size() >= static_cast<std::size_t>(
        std::numeric_limits<int>::max()
      )) {
    return nullptr;
  }
  const int callbackIndex = static_cast<int>(context->callbacks.size());
  context->callbacks.push_back(callback);
  const std::string& functionName = StringValue(name);
  JSValue function = JS_NewCFunctionMagic(
    context->context,
    NativeCallbackBridge,
    functionName.c_str(),
    0,
    JS_CFUNC_generic_magic,
    callbackIndex
  );
  if (JS_IsException(function)) {
    context->callbacks.pop_back();
    JSValue exception = JS_GetException(context->context);
    JS_FreeValue(context->context, exception);
    return nullptr;
  }
  return WrapOwned(context, function);
}

void JSObjectSetProperty(
  JSContextRef context,
  JSObjectRef object,
  JSStringRef propertyName,
  JSValueRef value,
  JSPropertyAttributes attributes,
  JSValueRef* exception
) {
  (void)attributes;
  if (exception) {
    *exception = nullptr;
  }
  if (!context || !context->context || !IsUsableObject(object)) {
    return;
  }
  JSValue propertyValue = value
    ? JS_DupValue(context->context, value->value)
    : JS_UNDEFINED;
  if (JS_SetPropertyStr(
        context->context,
        object->value,
        StringValue(propertyName).c_str(),
        propertyValue
      ) < 0) {
    StoreQuickJsException(context, exception);
  }
}

JSValueRef JSObjectGetProperty(
  JSContextRef context,
  JSObjectRef object,
  JSStringRef propertyName,
  JSValueRef* exception
) {
  if (exception) {
    *exception = nullptr;
  }
  if (!context || !context->context || !IsUsableObject(object)) {
    return nullptr;
  }
  JSValue value = JS_GetPropertyStr(
    context->context,
    object->value,
    StringValue(propertyName).c_str()
  );
  if (JS_IsException(value)) {
    StoreQuickJsException(context, exception);
    return nullptr;
  }
  return WrapOwned(context, value);
}

void JSObjectSetPropertyAtIndex(
  JSContextRef context,
  JSObjectRef object,
  unsigned propertyIndex,
  JSValueRef value,
  JSValueRef* exception
) {
  if (exception) {
    *exception = nullptr;
  }
  if (!context || !context->context || !IsUsableObject(object)) {
    return;
  }
  JSValue propertyValue = value
    ? JS_DupValue(context->context, value->value)
    : JS_UNDEFINED;
  if (JS_SetPropertyUint32(
        context->context,
        object->value,
        propertyIndex,
        propertyValue
      ) < 0) {
    StoreQuickJsException(context, exception);
  }
}

JSValueRef JSObjectGetPropertyAtIndex(
  JSContextRef context,
  JSObjectRef object,
  unsigned propertyIndex,
  JSValueRef* exception
) {
  if (exception) {
    *exception = nullptr;
  }
  if (!context || !context->context || !IsUsableObject(object)) {
    return nullptr;
  }
  JSValue value = JS_GetPropertyUint32(
    context->context,
    object->value,
    propertyIndex
  );
  if (JS_IsException(value)) {
    StoreQuickJsException(context, exception);
    return nullptr;
  }
  return WrapOwned(context, value);
}

bool JSObjectIsFunction(JSContextRef context, JSObjectRef object) {
  return context && context->context && object &&
    JS_IsFunction(context->context, object->value);
}

JSValueRef JSObjectCallAsFunction(
  JSContextRef context,
  JSObjectRef object,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  if (exception) {
    *exception = nullptr;
  }
  if (!context || !context->context || !object ||
      !JS_IsFunction(context->context, object->value)) {
    return nullptr;
  }
  std::vector<JSValue> quickArguments;
  quickArguments.reserve(argumentCount);
  for (std::size_t index = 0; index < argumentCount; ++index) {
    quickArguments.push_back(arguments && arguments[index]
      ? arguments[index]->value
      : JS_UNDEFINED);
  }
  JSValue result = JS_Call(
    context->context,
    object->value,
    thisObject ? thisObject->value : JS_UNDEFINED,
    static_cast<int>(argumentCount),
    quickArguments.empty() ? nullptr : quickArguments.data()
  );
  if (JS_IsException(result)) {
    StoreQuickJsException(context, exception);
    return nullptr;
  }
  return WrapOwned(context, result);
}

JSValueRef JSEvaluateScript(
  JSContextRef context,
  JSStringRef script,
  JSObjectRef thisObject,
  JSStringRef sourceURL,
  int startingLineNumber,
  JSValueRef* exception
) {
  (void)thisObject;
  (void)startingLineNumber;
  if (exception) {
    *exception = nullptr;
  }
  if (!context || !context->context || !script) {
    return nullptr;
  }
  const std::string& sourceName = StringValue(sourceURL);
  JSValue result = JS_Eval(
    context->context,
    script->value.data(),
    script->value.size(),
    sourceName.empty() ? "<script>" : sourceName.c_str(),
    JS_EVAL_TYPE_GLOBAL
  );
  if (JS_IsException(result)) {
    StoreQuickJsException(context, exception);
    return nullptr;
  }
  return WrapOwned(context, result);
}
