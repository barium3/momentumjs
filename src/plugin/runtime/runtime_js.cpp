#include "runtime_internal.h"

#include "../api/api_internal.h"

namespace momentum::runtime_internal {

bool EvaluateScript(
  JSContextRef ctx,
  const std::string& source,
  const char* label,
  JSValueRef* resultValue,
  std::string* errorMessage
) {
  JSStringRef script = JSStringCreateWithUTF8CString(source.c_str());
  JSStringRef sourceURL = JSStringCreateWithUTF8CString(label);
  JSValueRef exception = NULL;
  JSValueRef result = JSEvaluateScript(ctx, script, NULL, sourceURL, 0, &exception);
  JSStringRelease(sourceURL);
  JSStringRelease(script);

  if (exception) {
    if (errorMessage) {
      *errorMessage = momentum::JsValueToStdString(ctx, exception);
    }
    return false;
  }

  if (resultValue) {
    *resultValue = result;
  }
  return true;
}

JSValueRef GetBindingValue(JSContextRef ctx, const char* name, std::string* errorMessage) {
  const std::string expression =
    "(typeof " + std::string(name) + " === 'function' ? " + std::string(name) + " : null)";
  JSValueRef value = NULL;
  if (!EvaluateScript(ctx, expression, name, &value, errorMessage)) {
    return NULL;
  }
  return value;
}

bool CallFunction(
  JSContextRef ctx,
  JSObjectRef globalObject,
  JSValueRef functionValue,
  std::string* errorMessage
) {
  if (!functionValue || JSValueIsNull(ctx, functionValue) || JSValueIsUndefined(ctx, functionValue)) {
    return true;
  }

  if (!JSValueIsObject(ctx, functionValue)) {
    return true;
  }

  JSObjectRef functionObject = JSValueToObject(ctx, functionValue, NULL);
  if (!functionObject || !JSObjectIsFunction(ctx, functionObject)) {
    return true;
  }

  JSValueRef exception = NULL;
  JSObjectCallAsFunction(ctx, functionObject, globalObject, 0, NULL, &exception);
  if (exception) {
    if (errorMessage) {
      *errorMessage = momentum::JsValueToStdString(ctx, exception);
    }
    return false;
  }

  return true;
}

std::optional<std::string> CaptureRuntimeState(JSContextRef ctx, std::string* errorMessage) {
  JSValueRef value = NULL;
  if (!EvaluateScript(ctx, "__momentumCaptureState()", "__momentumCaptureState", &value, errorMessage)) {
    return std::nullopt;
  }

  if (!value) {
    return std::nullopt;
  }

  return momentum::JsValueToStdString(ctx, value);
}

bool RestoreRuntimeState(JSContextRef ctx, const std::string& stateJson, std::string* errorMessage) {
  std::string escaped;
  escaped.reserve(stateJson.size() * 2);
  for (std::size_t index = 0; index < stateJson.size(); index += 1) {
    const char current = stateJson[index];
    if (current == '\\' || current == '\'') {
      escaped.push_back('\\');
    }
    if (current == '\n') {
      escaped.append("\\n");
      continue;
    }
    if (current == '\r') {
      escaped.append("\\r");
      continue;
    }
    escaped.push_back(current);
  }

  const std::string script = "__momentumRestoreState('" + escaped + "')";
  return EvaluateScript(ctx, script, "__momentumRestoreState", NULL, errorMessage);
}

}  // namespace momentum::runtime_internal
