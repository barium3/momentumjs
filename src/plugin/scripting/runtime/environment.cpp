#include "scripting/runtime/internal.h"
#include "scripting/runtime/maintenance.h"
#include "host/sequence_data.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstring>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <sstream>

#if defined(__APPLE__)
#include <dlfcn.h>
#elif defined(_WIN32)
#include <windows.h>
#endif

namespace momentum::runtime_internal {

namespace {

std::mutex gEffectRuntimeDiagnosticMutex;

bool IsVerboseRenderDiagnosticEnabled() {
  static const bool enabled = []() {
    const char* value = std::getenv("MOMENTUM_VERBOSE_RENDER_LOG");
    return value && (*value == '1' || *value == 'y' || *value == 'Y');
  }();
  return enabled;
}

bool ShouldWriteRenderDiagnostic(const char* eventName) {
  if (IsVerboseRenderDiagnosticEnabled()) {
    return true;
  }
  const std::string event = eventName ? eventName : "unknown";
  return event.find("failed") != std::string::npos ||
    event.find("error") != std::string::npos ||
    event == "runtime-cache-rebuild" ||
    event == "controller-history-dirty" ||
    event == "controller-render-superseded";
}

bool IsCompatibleSequenceDataVersion(A_u_long version) {
  return
    version == kSequenceCacheDataLegacyVersion ||
    version == kSequenceCacheDataSnapshotVersion ||
    version == kSequenceCacheDataSharedRuntimeVersion ||
    version == kSequenceCacheDataDocumentVersion ||
    version == kSequenceCacheDataIdentityVersion ||
    version == kSequenceCacheDataVersion;
}

std::size_t FindJsonFieldValueStart(const std::string& json, const char* key) {
  const std::string token = std::string("\"") + key + "\"";
  const std::size_t keyPosition = json.find(token);
  if (keyPosition == std::string::npos) {
    return std::string::npos;
  }

  const std::size_t colonPosition = json.find(':', keyPosition + token.size());
  if (colonPosition == std::string::npos) {
    return std::string::npos;
  }

  std::size_t valuePosition = colonPosition + 1;
  while (valuePosition < json.size() && std::isspace(static_cast<unsigned char>(json[valuePosition]))) {
    valuePosition += 1;
  }
  return valuePosition;
}

std::string DecodeSimpleJsonString(const std::string& value) {
  std::string decoded;
  decoded.reserve(value.size());
  for (std::size_t index = 0; index < value.size(); index += 1) {
    const char current = value[index];
    if (current == '\\' && (index + 1) < value.size()) {
      index += 1;
      const char escaped = value[index];
      switch (escaped) {
        case '\\': decoded.push_back('\\'); break;
        case '"': decoded.push_back('"'); break;
        case 'n': decoded.push_back('\n'); break;
        case 'r': decoded.push_back('\r'); break;
        case 't': decoded.push_back('\t'); break;
        default: decoded.push_back(escaped); break;
      }
    } else {
      decoded.push_back(current);
    }
  }
  return decoded;
}

std::optional<std::string> ExtractJsonStringField(const std::string& json, const char* key) {
  const std::size_t valueStart = FindJsonFieldValueStart(json, key);
  if (valueStart == std::string::npos || valueStart >= json.size() || json[valueStart] != '"') {
    return std::nullopt;
  }

  std::string raw;
  bool escaping = false;
  for (std::size_t index = valueStart + 1; index < json.size(); index += 1) {
    const char current = json[index];
    if (escaping) {
      raw.push_back('\\');
      raw.push_back(current);
      escaping = false;
      continue;
    }

    if (current == '\\') {
      escaping = true;
      continue;
    }

    if (current == '"') {
      return DecodeSimpleJsonString(raw);
    }

    raw.push_back(current);
  }

  return std::nullopt;
}

std::optional<long> ExtractJsonLongField(const std::string& json, const char* key) {
  const std::size_t valueStart = FindJsonFieldValueStart(json, key);
  if (valueStart == std::string::npos || valueStart >= json.size()) {
    return std::nullopt;
  }

  std::size_t valueEnd = valueStart;
  while (
    valueEnd < json.size() &&
    (std::isdigit(static_cast<unsigned char>(json[valueEnd])) || json[valueEnd] == '-')
  ) {
    valueEnd += 1;
  }

  if (valueEnd == valueStart) {
    return std::nullopt;
  }

  return std::strtol(json.substr(valueStart, valueEnd - valueStart).c_str(), NULL, 10);
}

std::optional<double> ExtractJsonDoubleField(const std::string& json, const char* key) {
  const std::size_t valueStart = FindJsonFieldValueStart(json, key);
  if (valueStart == std::string::npos || valueStart >= json.size()) {
    return std::nullopt;
  }

  std::size_t valueEnd = valueStart;
  while (
    valueEnd < json.size() &&
    (std::isdigit(static_cast<unsigned char>(json[valueEnd])) ||
      json[valueEnd] == '-' ||
      json[valueEnd] == '+' ||
      json[valueEnd] == '.')
  ) {
    valueEnd += 1;
  }

  if (valueEnd == valueStart) {
    return std::nullopt;
  }

  char* end = NULL;
  const std::string token = json.substr(valueStart, valueEnd - valueStart);
  const double parsed = std::strtod(token.c_str(), &end);
  if (end == token.c_str() || !end || *end != '\0' || !std::isfinite(parsed) || std::isnan(parsed)) {
    return std::nullopt;
  }
  return parsed;
}

std::optional<bool> ExtractJsonBoolField(const std::string& json, const char* key) {
  const std::size_t valueStart = FindJsonFieldValueStart(json, key);
  if (valueStart == std::string::npos || valueStart >= json.size()) {
    return std::nullopt;
  }

  if (json.compare(valueStart, 4, "true") == 0) {
    return true;
  }
  if (json.compare(valueStart, 5, "false") == 0) {
    return false;
  }
  return std::nullopt;
}

std::optional<std::string> ExtractJsonObjectField(const std::string& json, const char* key) {
  const std::string token = "\"" + std::string(key) + "\"";
  const std::size_t keyPosition = json.find(token);
  if (keyPosition == std::string::npos) {
    return std::nullopt;
  }

  const std::size_t objectStart = json.find('{', keyPosition + token.size());
  if (objectStart == std::string::npos) {
    return std::nullopt;
  }

  int depth = 0;
  bool inString = false;
  bool escaping = false;
  std::size_t objectEnd = std::string::npos;
  for (std::size_t index = objectStart; index < json.size(); index += 1) {
    const char current = json[index];
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (current == '\\') {
        escaping = true;
        continue;
      }
      if (current == '"') {
        inString = false;
      }
      continue;
    }
    if (current == '"') {
      inString = true;
      continue;
    }
    if (current == '{') {
      depth += 1;
    } else if (current == '}') {
      depth -= 1;
      if (depth == 0) {
        objectEnd = index;
        break;
      }
    }
  }

  if (objectEnd == std::string::npos || objectEnd <= objectStart) {
    return std::nullopt;
  }

  return json.substr(objectStart, objectEnd - objectStart + 1);
}

std::optional<std::string> ExtractJsonArrayField(const std::string& json, const char* key) {
  const std::string token = "\"" + std::string(key) + "\"";
  const std::size_t keyPosition = json.find(token);
  if (keyPosition == std::string::npos) {
    return std::nullopt;
  }

  const std::size_t arrayStart = json.find('[', keyPosition + token.size());
  if (arrayStart == std::string::npos) {
    return std::nullopt;
  }

  int depth = 0;
  bool inString = false;
  bool escaping = false;
  std::size_t arrayEnd = std::string::npos;
  for (std::size_t index = arrayStart; index < json.size(); index += 1) {
    const char current = json[index];
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (current == '\\') {
        escaping = true;
        continue;
      }
      if (current == '"') {
        inString = false;
      }
      continue;
    }

    if (current == '"') {
      inString = true;
      continue;
    }
    if (current == '[') {
      depth += 1;
    } else if (current == ']') {
      depth -= 1;
      if (depth == 0) {
        arrayEnd = index;
        break;
      }
    }
  }

  if (arrayEnd == std::string::npos || arrayEnd <= arrayStart) {
    return std::nullopt;
  }
  return json.substr(arrayStart, arrayEnd - arrayStart + 1);
}

std::vector<std::string> ExtractJsonObjectEntries(const std::string& arrayJson) {
  std::vector<std::string> entries;
  if (arrayJson.size() < 2 || arrayJson.front() != '[' || arrayJson.back() != ']') {
    return entries;
  }

  int depth = 0;
  bool inString = false;
  bool escaping = false;
  std::size_t objectStart = std::string::npos;
  for (std::size_t index = 1; index + 1 < arrayJson.size(); index += 1) {
    const char current = arrayJson[index];
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (current == '\\') {
        escaping = true;
        continue;
      }
      if (current == '"') {
        inString = false;
      }
      continue;
    }

    if (current == '"') {
      inString = true;
      continue;
    }
    if (current == '{') {
      if (depth == 0) {
        objectStart = index;
      }
      depth += 1;
    } else if (current == '}') {
      depth -= 1;
      if (depth == 0 && objectStart != std::string::npos) {
        entries.push_back(arrayJson.substr(objectStart, index - objectStart + 1));
        objectStart = std::string::npos;
      }
    }
  }
  return entries;
}

std::optional<std::array<double, 2>> ExtractJsonNumberPair(const std::string& json, const char* key) {
  const auto arrayJson = ExtractJsonArrayField(json, key);
  if (!arrayJson.has_value()) {
    return std::nullopt;
  }

  std::array<double, 2> result = {0.0, 0.0};
  std::size_t cursor = 1;
  for (int index = 0; index < 2; index += 1) {
    while (cursor < arrayJson->size() &&
           (std::isspace(static_cast<unsigned char>((*arrayJson)[cursor])) || (*arrayJson)[cursor] == ',')) {
      cursor += 1;
    }
    if (cursor >= arrayJson->size() || (*arrayJson)[cursor] == ']') {
      return std::nullopt;
    }

    std::size_t end = cursor;
    while (end < arrayJson->size() &&
           (std::isdigit(static_cast<unsigned char>((*arrayJson)[end])) ||
            (*arrayJson)[end] == '-' ||
            (*arrayJson)[end] == '+' ||
            (*arrayJson)[end] == '.')) {
      end += 1;
    }
    if (end == cursor) {
      return std::nullopt;
    }

    char* parseEnd = NULL;
    const std::string token = arrayJson->substr(cursor, end - cursor);
    const double value = std::strtod(token.c_str(), &parseEnd);
    if (parseEnd == token.c_str() || !parseEnd || *parseEnd != '\0' || !std::isfinite(value) || std::isnan(value)) {
      return std::nullopt;
    }
    result[static_cast<std::size_t>(index)] = value;
    cursor = end;
  }

  return result;
}

std::optional<std::array<double, 4>> ExtractJsonColorArray(const std::string& json, const char* key) {
  const auto arrayJson = ExtractJsonArrayField(json, key);
  if (!arrayJson.has_value()) {
    return std::nullopt;
  }

  std::array<double, 4> result = {1.0, 1.0, 1.0, 1.0};
  std::size_t cursor = 1;
  int count = 0;
  while (cursor < arrayJson->size() && count < 4) {
    while (cursor < arrayJson->size() &&
           (std::isspace(static_cast<unsigned char>((*arrayJson)[cursor])) || (*arrayJson)[cursor] == ',')) {
      cursor += 1;
    }
    if (cursor >= arrayJson->size() || (*arrayJson)[cursor] == ']') {
      break;
    }

    std::size_t end = cursor;
    while (end < arrayJson->size() &&
           (std::isdigit(static_cast<unsigned char>((*arrayJson)[end])) ||
            (*arrayJson)[end] == '-' ||
            (*arrayJson)[end] == '+' ||
            (*arrayJson)[end] == '.')) {
      end += 1;
    }
    if (end == cursor) {
      return std::nullopt;
    }

    char* parseEnd = NULL;
    const std::string token = arrayJson->substr(cursor, end - cursor);
    const double value = std::strtod(token.c_str(), &parseEnd);
    if (parseEnd == token.c_str() || !parseEnd || *parseEnd != '\0' || !std::isfinite(value) || std::isnan(value)) {
      return std::nullopt;
    }
    result[static_cast<std::size_t>(count)] = value;
    cursor = end;
    count += 1;
  }

  if (count < 3) {
    return std::nullopt;
  }
  if (count == 3) {
    result[3] = 1.0;
  }
  return result;
}

std::optional<ControllerColorValue> ExtractJsonColorValue(const std::string& json, const char* key) {
  if (const auto text = ExtractJsonStringField(json, key)) {
    std::string hex = *text;
    if (!hex.empty() && hex[0] == '#') {
      hex.erase(hex.begin());
    }
    if (hex.size() == 3 || hex.size() == 4) {
      std::string expanded;
      expanded.reserve(hex.size() * 2);
      for (char ch : hex) {
        expanded.push_back(ch);
        expanded.push_back(ch);
      }
      hex = expanded;
    }
    if (hex.size() == 6 || hex.size() == 8) {
      auto parseChannel = [&](std::size_t offset, int fallback) -> int {
        const std::string token = hex.substr(offset, 2);
        char* end = NULL;
        const long value = std::strtol(token.c_str(), &end, 16);
        if (end == token.c_str() || !end || *end != '\0') {
          return fallback;
        }
        return static_cast<int>(std::max<long>(0, std::min<long>(255, value)));
      };

      ControllerColorValue color;
      color.r = static_cast<double>(parseChannel(0, 255)) / 255.0;
      color.g = static_cast<double>(parseChannel(2, 255)) / 255.0;
      color.b = static_cast<double>(parseChannel(4, 255)) / 255.0;
      color.a =
        hex.size() == 8
          ? static_cast<double>(parseChannel(6, 255)) / 255.0
          : 1.0;
      return color;
    }
  }

  if (const auto raw = ExtractJsonColorArray(json, key)) {
    const bool uses255Scale =
      (*raw)[0] > 1.0 || (*raw)[1] > 1.0 || (*raw)[2] > 1.0 || (*raw)[3] > 1.0;
    const double divisor = uses255Scale ? 255.0 : 1.0;
    auto clampComponent = [&](double value, double fallback) -> double {
      const double normalized =
        (std::isfinite(value) && !std::isnan(value) ? value : fallback) / divisor;
      return std::max(0.0, std::min(1.0, normalized));
    };

    ControllerColorValue color;
    color.r = clampComponent((*raw)[0], 1.0);
    color.g = clampComponent((*raw)[1], 1.0);
    color.b = clampComponent((*raw)[2], 1.0);
    color.a = clampComponent((*raw)[3], 1.0);
    return color;
  }

  return std::nullopt;
}

std::vector<RuntimeSelectControllerOptionSpec> ExtractJsonSelectOptions(const std::string& json, const char* key) {
  std::vector<RuntimeSelectControllerOptionSpec> options;
  const auto optionsArray = ExtractJsonArrayField(json, key);
  if (!optionsArray.has_value()) {
    return options;
  }

  const std::vector<std::string> optionEntries = ExtractJsonObjectEntries(*optionsArray);
  options.reserve(optionEntries.size());
  for (std::size_t index = 0; index < optionEntries.size(); index += 1) {
    RuntimeSelectControllerOptionSpec option;
    if (const auto label = ExtractJsonStringField(optionEntries[index], "label")) {
      option.label = *label;
    } else if (const auto value = ExtractJsonStringField(optionEntries[index], "value")) {
      option.label = *value;
    } else {
      option.label = "Option " + std::to_string(index + 1);
    }
    options.push_back(option);
  }
  return options;
}

void PopulateControllerConfigs(
  const std::string& bundleJson,
  RuntimeSketchBundle* bundle
) {
  if (!bundle) {
    return;
  }

  const auto controllerObject = ExtractJsonObjectField(bundleJson, "controller");
  if (!controllerObject.has_value()) {
    return;
  }
  const auto configsArray = ExtractJsonArrayField(*controllerObject, "configs");
  if (!configsArray.has_value()) {
    return;
  }

  for (const std::string& entry : ExtractJsonObjectEntries(*configsArray)) {
    if (bundle->controllerSlots.size() >= static_cast<std::size_t>(kControllerSlotCount)) {
      break;
    }

    const auto type = ExtractJsonStringField(entry, "type");
    if (!type.has_value()) {
      continue;
    }

    if (*type == "slider") {
      RuntimeControllerSlotSpec slotSpec;
      RuntimeSliderControllerSpec config;
      if (const auto id = ExtractJsonStringField(entry, "id")) {
        slotSpec.id = *id;
      }
      if (const auto label = ExtractJsonStringField(entry, "label")) {
        slotSpec.label = *label;
      } else if (const auto name = ExtractJsonStringField(entry, "name")) {
        slotSpec.label = *name;
      }

      if (const auto minValue = ExtractJsonDoubleField(entry, "min")) {
        config.minValue = *minValue;
      }
      if (const auto maxValue = ExtractJsonDoubleField(entry, "max")) {
        config.maxValue = *maxValue;
      }
      if (const auto step = ExtractJsonDoubleField(entry, "step")) {
        config.step = *step;
      }
      if (const auto value = ExtractJsonDoubleField(entry, "value")) {
        config.defaultValue = *value;
        config.hasDefaultValue = true;
      } else {
        config.defaultValue = config.minValue;
      }

      slotSpec.kind = RuntimeControllerSlotKind::kSlider;
      slotSpec.slider = config;
      bundle->controllerSlots.push_back(slotSpec);
      continue;
    }

    if (*type == "angle") {
      RuntimeControllerSlotSpec slotSpec;
      RuntimeAngleControllerSpec config;
      if (const auto id = ExtractJsonStringField(entry, "id")) {
        slotSpec.id = *id;
      }
      if (const auto label = ExtractJsonStringField(entry, "label")) {
        slotSpec.label = *label;
      } else if (const auto name = ExtractJsonStringField(entry, "name")) {
        slotSpec.label = *name;
      }
      if (const auto value = ExtractJsonDoubleField(entry, "value")) {
        config.defaultValue = *value;
        config.hasDefaultValue = true;
      }
      slotSpec.kind = RuntimeControllerSlotKind::kAngle;
      slotSpec.angle = config;
      bundle->controllerSlots.push_back(slotSpec);
      continue;
    }

    if (*type == "color") {
      RuntimeControllerSlotSpec slotSpec;
      RuntimeColorControllerSpec config;
      if (const auto id = ExtractJsonStringField(entry, "id")) {
        slotSpec.id = *id;
      }
      if (const auto label = ExtractJsonStringField(entry, "label")) {
        slotSpec.label = *label;
      } else if (const auto name = ExtractJsonStringField(entry, "name")) {
        slotSpec.label = *name;
      }
      if (const auto value = ExtractJsonColorValue(entry, "value")) {
        config.defaultValue = *value;
        config.hasDefaultValue = true;
      }
      slotSpec.kind = RuntimeControllerSlotKind::kColor;
      slotSpec.color = config;
      bundle->controllerSlots.push_back(slotSpec);
      continue;
    }

    if (*type == "checkbox") {
      RuntimeControllerSlotSpec slotSpec;
      RuntimeCheckboxControllerSpec config;
      if (const auto id = ExtractJsonStringField(entry, "id")) {
        slotSpec.id = *id;
      }
      if (const auto label = ExtractJsonStringField(entry, "label")) {
        slotSpec.label = *label;
      } else if (const auto name = ExtractJsonStringField(entry, "name")) {
        slotSpec.label = *name;
      }
      if (const auto value = ExtractJsonBoolField(entry, "value")) {
        config.defaultValue = *value;
        config.hasDefaultValue = true;
      }
      slotSpec.kind = RuntimeControllerSlotKind::kCheckbox;
      slotSpec.checkbox = config;
      bundle->controllerSlots.push_back(slotSpec);
      continue;
    }

    if (*type == "select") {
      RuntimeControllerSlotSpec slotSpec;
      RuntimeSelectControllerSpec config;
      if (const auto id = ExtractJsonStringField(entry, "id")) {
        slotSpec.id = *id;
      }
      if (const auto label = ExtractJsonStringField(entry, "label")) {
        slotSpec.label = *label;
      } else if (const auto name = ExtractJsonStringField(entry, "name")) {
        slotSpec.label = *name;
      }
      config.options = ExtractJsonSelectOptions(entry, "options");
      if (const auto value = ExtractJsonLongField(entry, "value")) {
        config.defaultValue = static_cast<int>(*value);
        config.hasDefaultValue = true;
      }
      slotSpec.kind = RuntimeControllerSlotKind::kSelect;
      slotSpec.select = config;
      bundle->controllerSlots.push_back(slotSpec);
      continue;
    }

    if (*type == "point") {
      RuntimeControllerSlotSpec slotSpec;
      RuntimePointControllerSpec config;
      if (const auto id = ExtractJsonStringField(entry, "id")) {
        slotSpec.id = *id;
      }
      if (const auto label = ExtractJsonStringField(entry, "label")) {
        slotSpec.label = *label;
      } else if (const auto name = ExtractJsonStringField(entry, "name")) {
        slotSpec.label = *name;
      }

      const auto value = ExtractJsonNumberPair(entry, "value");
      if (value.has_value()) {
        config.defaultValue.x = (*value)[0];
        config.defaultValue.y = (*value)[1];
        config.hasDefaultValue = true;
      }

      slotSpec.kind = RuntimeControllerSlotKind::kPoint;
      slotSpec.point = config;
      bundle->controllerSlots.push_back(slotSpec);
    }
  }
}

std::optional<long> ExtractNestedJsonLongField(
  const std::string& json,
  const char* parentKey,
  const char* childKey
) {
  const auto objectJson = ExtractJsonObjectField(json, parentKey);
  if (!objectJson.has_value()) {
    return std::nullopt;
  }
  return ExtractJsonLongField(*objectJson, childKey);
}

std::optional<std::string> ExtractNestedJsonStringField(
  const std::string& json,
  const char* parentKey,
  const char* childKey
) {
  const auto objectJson = ExtractJsonObjectField(json, parentKey);
  if (!objectJson.has_value()) {
    return std::nullopt;
  }
  return ExtractJsonStringField(*objectJson, childKey);
}

std::string GetRuntimeDirectoryOverridePath() {
  const char* overridePath = std::getenv("MOMENTUM_RUNTIME_DIR");
  if (!overridePath || !overridePath[0]) {
    return std::string();
  }
  return std::string(overridePath);
}

std::string GetInstalledPluginRuntimeDirectoryPath() {
#if defined(__APPLE__)
  Dl_info info{};
  if (dladdr(reinterpret_cast<const void*>(&GetInstalledPluginRuntimeDirectoryPath), &info) == 0) {
    return std::string();
  }
  if (!info.dli_fname || !info.dli_fname[0]) {
    return std::string();
  }

  std::filesystem::path binaryPath(info.dli_fname);
  std::error_code ec;
  const std::filesystem::path canonicalBinaryPath = std::filesystem::weakly_canonical(binaryPath, ec);
  if (!ec) {
    binaryPath = canonicalBinaryPath;
  }

  const std::filesystem::path macOsDir = binaryPath.parent_path();
  const std::filesystem::path contentsDir = macOsDir.parent_path();
  const std::filesystem::path pluginBundleDir = contentsDir.parent_path();
  const std::filesystem::path pluginInstallDir = pluginBundleDir.parent_path();
  if (pluginInstallDir.empty()) {
    return std::string();
  }

  return (pluginInstallDir / "runtime").string();
#elif defined(_WIN32)
  HMODULE module = NULL;
  if (!GetModuleHandleExW(
        GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
          GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
        reinterpret_cast<LPCWSTR>(
          &GetInstalledPluginRuntimeDirectoryPath
        ),
        &module
      ) || !module) {
    return std::string();
  }

  std::vector<wchar_t> modulePath(32768, L'\0');
  const DWORD length = GetModuleFileNameW(
    module,
    modulePath.data(),
    static_cast<DWORD>(modulePath.size())
  );
  if (length == 0 || length >= modulePath.size()) {
    return std::string();
  }

  std::filesystem::path binaryPath(
    std::wstring(modulePath.data(), length)
  );
  std::error_code ec;
  const std::filesystem::path canonicalBinaryPath =
    std::filesystem::weakly_canonical(binaryPath, ec);
  if (!ec) {
    binaryPath = canonicalBinaryPath;
  }
  const std::filesystem::path pluginInstallDir =
    binaryPath.parent_path();
  if (pluginInstallDir.empty()) {
    return std::string();
  }
  return (pluginInstallDir / "runtime").u8string();
#else
  return std::string();
#endif
}

std::string BuildRuntimePath(const char* fileName = NULL) {
  std::string path = GetRuntimeDirectoryOverridePath();
  if (path.empty()) {
    path = GetInstalledPluginRuntimeDirectoryPath();
  }
  if (path.empty()) {
    return std::string();
  }

  if (fileName && fileName[0]) {
    path.push_back('/');
    path.append(fileName);
  }
  return path;
}

std::string ResolveBundleSketchPath(const RuntimeSketchBundle& bundle) {
  if (bundle.sourcePath.empty()) {
    return GetRuntimeSketchPath();
  }

  if (bundle.sourcePath[0] == '/') {
    return bundle.sourcePath;
  }

  const std::string runtimeDirectory = GetRuntimeDirectoryPath();
  if (runtimeDirectory.empty()) {
    return bundle.sourcePath;
  }

  return runtimeDirectory + "/" + bundle.sourcePath;
}

std::string ResolveBundleDebugTracePath(const RuntimeSketchBundle& bundle) {
  if (!bundle.debugTracePath.empty()) {
    if (bundle.debugTracePath[0] == '/') {
      return bundle.debugTracePath;
    }
    const std::string runtimeDirectory = GetRuntimeDirectoryPath();
    if (runtimeDirectory.empty()) {
      return bundle.debugTracePath;
    }
    return runtimeDirectory + "/" + bundle.debugTracePath;
  }

  if (bundle.sourcePath.empty()) {
    const std::string runtimeDirectory = GetRuntimeDirectoryPath();
    return runtimeDirectory.empty() ? std::string() : runtimeDirectory + "/debug_trace.log";
  }

  std::filesystem::path sourcePath(bundle.sourcePath);
  if (sourcePath.has_parent_path()) {
    return (sourcePath.parent_path() / "debug_trace.log").string();
  }

  const std::string runtimeDirectory = GetRuntimeDirectoryPath();
  return runtimeDirectory.empty() ? std::string() : runtimeDirectory + "/debug_trace.log";
}

}  // namespace

double GetFrameRate(PF_InData* in_data) {
  if (!in_data || in_data->time_step == 0) {
    return 30.0;
  }

  return static_cast<double>(in_data->time_scale) /
    static_cast<double>(in_data->time_step);
}

std::string GetRuntimeSketchPath() {
  return BuildRuntimePath("sketch.js");
}

std::string GetRuntimeDirectoryPath() {
  return BuildRuntimePath();
}

std::string BuildCreationTransportPath(A_long creationToken, const char* fileName = NULL) {
  if (creationToken <= 0) {
    return std::string();
  }

  std::string path = BuildRuntimePath("creation-transports");
  if (path.empty()) {
    return std::string();
  }

  path.push_back('/');
  path.append(std::to_string(creationToken));
  if (fileName && fileName[0]) {
    path.push_back('/');
    path.append(fileName);
  }
  return path;
}

std::string GetCreationTransportSketchPath(A_long creationToken) {
  return BuildCreationTransportPath(creationToken, "sketch.js");
}

std::string GetCreationTransportBundlePath(A_long creationToken) {
  return BuildCreationTransportPath(creationToken, "sketch_bundle.json");
}

PF_ConstHandle ResolveEffectSequenceDataHandle(PF_InData* in_data) {
  if (!in_data) {
    return NULL;
  }

  if (in_data->sequence_data) {
    return reinterpret_cast<PF_ConstHandle>(in_data->sequence_data);
  }

  if (!in_data->effect_ref || !in_data->pica_basicP) {
    return NULL;
  }

  // With multi-frame rendering enabled AE intentionally clears
  // in_data->sequence_data for render selectors. This suite is the only
  // supported way to access the Effect-owned, read-only sequence snapshot.
  AEFX_SuiteScoper<PF_EffectSequenceDataSuite1, true> sequenceSuite(
    in_data,
    kPFEffectSequenceDataSuite,
    kPFEffectSequenceDataSuiteVersion1,
    NULL
  );
  if (!sequenceSuite.get()) {
    return NULL;
  }

  PF_ConstHandle sequenceHandle = NULL;
  const PF_Err err = sequenceSuite->PF_GetConstSequenceData(
    in_data->effect_ref,
    &sequenceHandle
  );
  return err == PF_Err_NONE ? sequenceHandle : NULL;
}

namespace {

std::uint64_t ReadLiveEffectSessionId(
  PF_InData* in_data,
  PF_ConstHandle sequenceHandle
) {
  if (!in_data || !sequenceHandle ||
      PF_GET_HANDLE_SIZE(sequenceHandle) < sizeof(SequenceCacheData)) {
    return 0;
  }
  const auto* sequenceData =
    reinterpret_cast<const SequenceCacheData*>(DH(sequenceHandle));
  if (!sequenceData ||
      sequenceData->magic != kSequenceCacheDataMagic ||
      sequenceData->version != kSequenceCacheDataVersion) {
    return 0;
  }
  return sequenceData->liveEffectSessionId;
}

}  // namespace

EffectRuntimeKey ResolveEffectRuntimeKey(PF_InData* in_data) {
  if (!in_data) {
    return 0;
  }

  const PF_ConstHandle sequenceHandle = ResolveEffectSequenceDataHandle(in_data);
  // This process-local id identifies one live Effect session. effect_ref is
  // deliberately not part of that identity because AE may vary it between
  // render callbacks.
  return static_cast<EffectRuntimeKey>(
    ReadLiveEffectSessionId(in_data, sequenceHandle)
  );
}

std::uint64_t ResolveLiveEffectSessionId(PF_InData* in_data) {
  const auto sessionId =
    static_cast<std::uint64_t>(ResolveEffectRuntimeKey(in_data));
  return sessionId ? sessionId : 1ULL;
}

void AppendEffectRuntimeDiagnostic(
  PF_InData* in_data,
  const char* eventName,
  A_long creationToken,
  PF_ParamIndex paramIndex,
  long frame,
  const std::string& detail
) {
  if (!ShouldWriteRenderDiagnostic(eventName)) {
    return;
  }
  const std::string runtimeDirectory = GetRuntimeDirectoryPath();
  if (runtimeDirectory.empty()) {
    return;
  }
  const std::string logPath = runtimeDirectory + "/effect_runtime.log";
  const std::lock_guard<std::mutex> lock(gEffectRuntimeDiagnosticMutex);

  RotateLogFileIfNeeded(logPath, 1024U * 1024U);
  std::ofstream stream(logPath.c_str(), std::ios::out | std::ios::app);
  if (!stream.is_open()) {
    return;
  }

  std::string safeDetail = detail;
  std::replace(safeDetail.begin(), safeDetail.end(), '\n', ' ');
  std::replace(safeDetail.begin(), safeDetail.end(), '\r', ' ');
  const auto now = std::chrono::system_clock::now().time_since_epoch();
  const auto milliseconds =
    std::chrono::duration_cast<std::chrono::milliseconds>(now).count();
  const PF_ConstHandle resolvedSequenceHandle = ResolveEffectSequenceDataHandle(in_data);
  const std::uint64_t liveEffectSessionId =
    ReadLiveEffectSessionId(in_data, resolvedSequenceHandle);
  stream
    << "timeMs=" << milliseconds
    << " event=" << (eventName ? eventName : "unknown")
    << " runtimeKey=" << ResolveEffectRuntimeKey(in_data)
    << " sequenceHandle=" << reinterpret_cast<std::uintptr_t>(
         in_data ? in_data->sequence_data : NULL
       )
    << " resolvedSequenceHandle=" << reinterpret_cast<std::uintptr_t>(
         resolvedSequenceHandle
       )
    << " liveEffectSessionId=" << liveEffectSessionId
    << " effectRef=" << reinterpret_cast<std::uintptr_t>(
         in_data ? in_data->effect_ref : NULL
       )
    << " creationToken=" << creationToken
    << " paramIndex=" << static_cast<long>(paramIndex)
    << " frame=" << frame;
  if (!safeDetail.empty()) {
    stream << " detail=" << safeDetail;
  }
  stream << '\n';
}

void AppendEffectUiDiagnostic(
  PF_InData* in_data,
  const char* eventName,
  const std::string& detail
) {
  const std::string runtimeDirectory = GetRuntimeDirectoryPath();
  if (runtimeDirectory.empty()) {
    return;
  }
  const std::string logPath = runtimeDirectory + "/effect_runtime.log";
  const std::lock_guard<std::mutex> lock(gEffectRuntimeDiagnosticMutex);

  RotateLogFileIfNeeded(logPath, 1024U * 1024U);
  std::ofstream stream(logPath.c_str(), std::ios::out | std::ios::app);
  if (!stream.is_open()) {
    return;
  }

  std::string safeDetail = detail;
  std::replace(safeDetail.begin(), safeDetail.end(), '\n', ' ');
  std::replace(safeDetail.begin(), safeDetail.end(), '\r', ' ');
  const auto now = std::chrono::system_clock::now().time_since_epoch();
  const auto milliseconds =
    std::chrono::duration_cast<std::chrono::milliseconds>(now).count();
  stream
    << "timeMs=" << milliseconds
    << " event=" << (eventName ? eventName : "ui-unknown")
    << " effectRef=" << reinterpret_cast<std::uintptr_t>(
         in_data ? in_data->effect_ref : NULL
       );
  if (!safeDetail.empty()) {
    stream << " detail=" << safeDetail;
  }
  stream << '\n';
}

std::optional<std::string> ReadTextFile(const std::string& path) {
  if (path.empty()) {
    return std::nullopt;
  }

  std::ifstream stream(path.c_str(), std::ios::in | std::ios::binary);
  if (!stream.is_open()) {
    return std::nullopt;
  }

  std::stringstream buffer;
  buffer << stream.rdbuf();
  return buffer.str();
}

bool FileExists(const std::string& path) {
  if (path.empty()) {
    return false;
  }

  std::ifstream stream(path.c_str(), std::ios::in | std::ios::binary);
  return stream.is_open();
}

RuntimeSketchBundle ReadRuntimeSketchBundleFromText(
  const std::string& bundleText,
  const std::string& defaultSketchPath,
  std::string* errorMessage
) {
  RuntimeSketchBundle bundle;
  bundle.sourcePath = defaultSketchPath.empty() ? GetRuntimeSketchPath() : defaultSketchPath;
  if (bundleText.empty()) {
    return bundle;
  }

  if (const auto bundleVersion = ExtractJsonLongField(bundleText, "bundleVersion")) {
    bundle.bundleVersion = static_cast<int>(*bundleVersion);
  }
  if (const auto runtimeTarget = ExtractJsonStringField(bundleText, "runtimeTarget")) {
    bundle.runtimeTarget = *runtimeTarget;
  }
  if (const auto sourcePath = ExtractJsonStringField(bundleText, "sourcePath")) {
    bundle.sourcePath = *sourcePath;
  }
  if (const auto sourceHash = ExtractJsonStringField(bundleText, "sourceHash")) {
    bundle.sourceHash = *sourceHash;
  }
  if (const auto debugTracePath = ExtractJsonStringField(bundleText, "debugTracePath")) {
    bundle.debugTracePath = *debugTracePath;
  }
  if (const auto controllerHash = ExtractJsonStringField(bundleText, "hash")) {
    bundle.controllerHash = *controllerHash;
  } else if (const auto nestedControllerHash = ExtractNestedJsonStringField(bundleText, "controller", "hash")) {
    bundle.controllerHash = *nestedControllerHash;
  }
  if (const auto pixelDensity = ExtractJsonDoubleField(bundleText, "pixelDensity")) {
    bundle.pixelDensity = std::max(1.0, *pixelDensity);
  }
  if (const auto cueTime = ExtractJsonDoubleField(bundleText, "momentumCueTimeSeconds")) {
    bundle.requestedCueTimeSeconds = std::max(0.0, *cueTime);
  }
  if (const auto codeCueObject = ExtractJsonObjectField(bundleText, "momentumCodeCue")) {
    if (const auto safetyVersion = ExtractJsonLongField(*codeCueObject, "safetyVersion")) {
      bundle.codeCueSafetyVersion = std::max<long>(0, *safetyVersion);
    }
    if (const auto mode = ExtractJsonStringField(*codeCueObject, "mode")) {
      bundle.requestedCodeTransition =
        *mode == "soft"
          ? RuntimeCodeTransitionMode::kSoft
          : RuntimeCodeTransitionMode::kRestart;
    }
    if (const auto contextHash = ExtractJsonStringField(*codeCueObject, "contextHash")) {
      bundle.codeCueContextHash = *contextHash;
    }
    if (const auto semanticHash = ExtractJsonStringField(*codeCueObject, "semanticHash")) {
      bundle.codeCueSemanticHash = *semanticHash;
    }
    if (const auto targetPatchSource =
          ExtractJsonStringField(*codeCueObject, "targetPatchSource")) {
      bundle.codeCueTargetPatchSource = *targetPatchSource;
    }
    if (const auto hasDraw = ExtractJsonBoolField(*codeCueObject, "hasDraw")) {
      bundle.codeCueHasDraw = *hasDraw;
    }
  }

  std::optional<long> recentFrameBudgetMB = ExtractJsonLongField(bundleText, "recentFrameBudgetMB");
  if (!recentFrameBudgetMB.has_value()) {
    recentFrameBudgetMB = ExtractNestedJsonLongField(bundleText, "cache", "recentFrameBudgetMB");
  }
  if (recentFrameBudgetMB.has_value()) {
    const long safeMB = std::max<long>(16, std::min<long>(512, *recentFrameBudgetMB));
    bundle.recentFrameBudgetBytes = static_cast<std::size_t>(safeMB) * 1024ULL * 1024ULL;
  }

  std::optional<long> checkpointInterval = ExtractJsonLongField(bundleText, "checkpointInterval");
  if (!checkpointInterval.has_value()) {
    checkpointInterval = ExtractNestedJsonLongField(bundleText, "cache", "checkpointInterval");
  }
  if (checkpointInterval.has_value()) {
    bundle.checkpointInterval = std::max<long>(1, std::min<long>(120, *checkpointInterval));
  }

  if (bundle.runtimeTarget.empty()) {
    bundle.runtimeTarget = "momentum-plugin-js-runtime";
  }

  PopulateControllerConfigs(bundleText, &bundle);

  const bool supportsBitmapRuntime =
    bundle.runtimeTarget == "momentum-plugin-js-runtime" ||
    bundle.runtimeTarget == "momentum-bitmap-runtime";
  if (!supportsBitmapRuntime && errorMessage) {
    *errorMessage = "Unsupported runtime target: " + bundle.runtimeTarget;
  }

  bundle.sourcePath = ResolveBundleSketchPath(bundle);
  bundle.debugTracePath = ResolveBundleDebugTracePath(bundle);
  return bundle;
}

std::optional<std::string> ReadRuntimeSketchSource(const RuntimeSketchBundle& bundle) {
  if (bundle.hasEmbeddedSource) {
    return bundle.sourceText;
  }
  return ReadTextFile(bundle.sourcePath);
}

}  // namespace momentum::runtime_internal
