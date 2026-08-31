#pragma once

#include "scripting/api/common.h"

namespace momentum {

JSValueRef JsMomentumNativeDebugLog(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);

}  // namespace momentum
