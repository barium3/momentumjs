#pragma once

#include "scripting/api/common.h"

namespace momentum {

const char* GetDataBootstrapScript();
const char* GetControllerBootstrapScript();
const char* GetIoBootstrapScript();
bool ApplyControllerStateToRuntime(
  JSContextRef ctx,
  const ControllerPoolState& state,
  std::string* errorMessage
);

JSValueRef JsMomentumNativeLoadJSON(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeLoadStrings(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeLoadBytes(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeLoadXML(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeLoadTable(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);

}  // namespace momentum
