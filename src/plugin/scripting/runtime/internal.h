#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "scripting/runtime/types.h"

namespace momentum::runtime_internal {

enum class BindingKind {
  kVar,
  kLet,
  kConst,
};

struct CapturedBinding {
  std::string name;
  BindingKind kind = BindingKind::kVar;
};

double GetFrameRate(PF_InData* in_data);

std::string GetRuntimeSketchPath();
std::string GetRuntimeDirectoryPath();
std::string GetCreationTransportSketchPath(A_long creationToken);
std::string GetCreationTransportBundlePath(A_long creationToken);

using EffectRuntimeKey = std::uintptr_t;

PF_ConstHandle ResolveEffectSequenceDataHandle(PF_InData* in_data);
EffectRuntimeKey ResolveEffectRuntimeKey(PF_InData* in_data);
std::uint64_t ResolveLiveEffectSessionId(PF_InData* in_data);
void AppendEffectRuntimeDiagnostic(
  PF_InData* in_data,
  const char* eventName,
  A_long creationToken,
  PF_ParamIndex paramIndex,
  long frame,
  const std::string& detail
);
void AppendEffectUiDiagnostic(
  PF_InData* in_data,
  const char* eventName,
  const std::string& detail
);
std::optional<std::string> ReadTextFile(const std::string& path);
bool FileExists(const std::string& path);

RuntimeSketchBundle ReadRuntimeSketchBundleFromText(
  const std::string& bundleText,
  const std::string& defaultSketchPath,
  std::string* errorMessage
);
std::optional<std::string> ReadRuntimeSketchSource(const RuntimeSketchBundle& bundle);

bool EvaluateScript(
  JSContextRef ctx,
  const std::string& source,
  const char* label,
  JSValueRef* resultValue,
  std::string* errorMessage
);

JSValueRef GetBindingValue(JSContextRef ctx, const char* name, std::string* errorMessage);

bool CallFunction(
  JSContextRef ctx,
  JSObjectRef globalObject,
  JSValueRef functionValue,
  std::string* errorMessage
);

std::optional<std::string> CaptureRuntimeState(JSContextRef ctx, std::string* errorMessage);
bool RestoreRuntimeState(JSContextRef ctx, const std::string& stateJson, std::string* errorMessage);

std::vector<CapturedBinding> ExtractTopLevelBindings(const std::string& source);
std::string BuildBindingRegistrationScript(const std::vector<CapturedBinding>& bindings);

}  // namespace momentum::runtime_internal
