#pragma once

#include <optional>
#include <string>
#include <vector>

#include "../model/momentum_types.h"

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

double GetTimeSeconds(PF_InData* in_data);
bool GetCompTime(PF_InData* in_data, A_Time* compTime);
double GetCompTimeSeconds(PF_InData* in_data);
double GetFrameRate(PF_InData* in_data);

std::string GetRuntimeSketchPath();
std::string GetRuntimeDirectoryPath();
std::string GetRuntimeBundlePath();
std::string GetRuntimeInstanceSketchPath(A_long instanceId);
std::string GetRuntimeInstanceBundlePath(A_long instanceId);

using EffectRuntimeKey = std::uintptr_t;

PF_ConstHandle ResolveEffectSequenceDataHandle(PF_InData* in_data);
EffectRuntimeKey ResolveEffectRuntimeKey(PF_InData* in_data);
void AppendEffectRuntimeDiagnostic(
  PF_InData* in_data,
  const char* eventName,
  A_long instanceId,
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

RuntimeSketchBundle ReadRuntimeSketchBundle(std::string* errorMessage);
RuntimeSketchBundle ReadRuntimeSketchBundleFromText(
  const std::string& bundleText,
  const std::string& defaultSketchPath,
  std::string* errorMessage
);
RuntimeSketchBundle ReadRuntimeSketchBundleForEffect(
  PF_InData* in_data,
  A_long instanceId,
  std::string* errorMessage
);
std::optional<std::string> ReadRuntimeSketchDependencyBytes(
  PF_InData* in_data,
  A_long instanceId,
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
