#pragma once

#include <cstddef>

struct MomentumJSContext;
struct MomentumJSString;
struct MomentumJSValue;

using JSContextRef = MomentumJSContext*;
using JSGlobalContextRef = MomentumJSContext*;
using JSStringRef = MomentumJSString*;
using JSValueRef = MomentumJSValue*;
using JSObjectRef = MomentumJSValue*;
using JSClassRef = void*;
using JSPropertyAttributes = unsigned;

constexpr JSPropertyAttributes kJSPropertyAttributeNone = 0;

using JSObjectCallAsFunctionCallback = JSValueRef (*)(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);

JSGlobalContextRef JSGlobalContextCreate(JSClassRef globalObjectClass);
void JSGlobalContextRelease(JSGlobalContextRef ctx);
void JSGarbageCollect(JSContextRef ctx);

JSObjectRef JSContextGetGlobalObject(JSContextRef ctx);

JSStringRef JSStringCreateWithUTF8CString(const char* string);
void JSStringRelease(JSStringRef string);
std::size_t JSStringGetMaximumUTF8CStringSize(JSStringRef string);
std::size_t JSStringGetUTF8CString(
  JSStringRef string,
  char* buffer,
  std::size_t bufferSize
);

JSValueRef JSValueMakeUndefined(JSContextRef ctx);
JSValueRef JSValueMakeNull(JSContextRef ctx);
JSValueRef JSValueMakeBoolean(JSContextRef ctx, bool boolean);
JSValueRef JSValueMakeNumber(JSContextRef ctx, double number);
JSValueRef JSValueMakeString(JSContextRef ctx, JSStringRef string);
JSValueRef JSValueMakeFromJSONString(JSContextRef ctx, JSStringRef string);

bool JSValueIsUndefined(JSContextRef ctx, JSValueRef value);
bool JSValueIsNull(JSContextRef ctx, JSValueRef value);
bool JSValueIsBoolean(JSContextRef ctx, JSValueRef value);
bool JSValueIsString(JSContextRef ctx, JSValueRef value);
bool JSValueIsObject(JSContextRef ctx, JSValueRef value);
bool JSValueToBoolean(JSContextRef ctx, JSValueRef value);
double JSValueToNumber(
  JSContextRef ctx,
  JSValueRef value,
  JSValueRef* exception
);
JSStringRef JSValueToStringCopy(
  JSContextRef ctx,
  JSValueRef value,
  JSValueRef* exception
);
JSObjectRef JSValueToObject(
  JSContextRef ctx,
  JSValueRef value,
  JSValueRef* exception
);
void JSValueProtect(JSContextRef ctx, JSValueRef value);
void JSValueUnprotect(JSContextRef ctx, JSValueRef value);

JSObjectRef JSObjectMake(JSContextRef ctx, JSClassRef jsClass, void* data);
JSObjectRef JSObjectMakeArray(
  JSContextRef ctx,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSObjectRef JSObjectMakeFunctionWithCallback(
  JSContextRef ctx,
  JSStringRef name,
  JSObjectCallAsFunctionCallback callback
);
void JSObjectSetProperty(
  JSContextRef ctx,
  JSObjectRef object,
  JSStringRef propertyName,
  JSValueRef value,
  JSPropertyAttributes attributes,
  JSValueRef* exception
);
JSValueRef JSObjectGetProperty(
  JSContextRef ctx,
  JSObjectRef object,
  JSStringRef propertyName,
  JSValueRef* exception
);
void JSObjectSetPropertyAtIndex(
  JSContextRef ctx,
  JSObjectRef object,
  unsigned propertyIndex,
  JSValueRef value,
  JSValueRef* exception
);
JSValueRef JSObjectGetPropertyAtIndex(
  JSContextRef ctx,
  JSObjectRef object,
  unsigned propertyIndex,
  JSValueRef* exception
);
bool JSObjectIsFunction(JSContextRef ctx, JSObjectRef object);
JSValueRef JSObjectCallAsFunction(
  JSContextRef ctx,
  JSObjectRef object,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);

JSValueRef JSEvaluateScript(
  JSContextRef ctx,
  JSStringRef script,
  JSObjectRef thisObject,
  JSStringRef sourceURL,
  int startingLineNumber,
  JSValueRef* exception
);
