#include "runtime_internal.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>

#if defined(__APPLE__)
#include <dlfcn.h>
#endif

namespace momentum::runtime_internal {

namespace {

bool IsCompatibleSequenceDataVersion(A_u_long version) {
  return version == kSequenceCacheDataLegacyVersion || version == kSequenceCacheDataVersion;
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
  std::size_t objectEnd = std::string::npos;
  for (std::size_t index = objectStart; index < json.size(); index += 1) {
    if (json[index] == '{') {
      depth += 1;
    } else if (json[index] == '}') {
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

double GetTimeSeconds(PF_InData* in_data) {
  if (!in_data || in_data->time_scale == 0) {
    return 0.0;
  }

  return static_cast<double>(in_data->current_time) /
    static_cast<double>(in_data->time_scale);
}

bool GetCompTime(PF_InData* in_data, A_Time* compTime) {
  if (!in_data || !compTime || !in_data->effect_ref || in_data->time_scale == 0) {
    return false;
  }

  AEFX_SuiteScoper<AEGP_PFInterfaceSuite1> interfaceSuite(
    in_data,
    kAEGPPFInterfaceSuite,
    kAEGPPFInterfaceSuiteVersion1,
    NULL
  );

  A_Time result = {0, 1};
  const A_Err suiteErr = interfaceSuite->AEGP_ConvertEffectToCompTime(
    in_data->effect_ref,
    in_data->current_time,
    in_data->time_scale,
    &result
  );

  if (suiteErr) {
    return false;
  }

  *compTime = result;
  return true;
}

double GetCompTimeSeconds(PF_InData* in_data) {
  A_Time compTime = {0, 1};
  if (!GetCompTime(in_data, &compTime) || compTime.scale == 0) {
    return GetTimeSeconds(in_data);
  }

  return static_cast<double>(compTime.value) /
    static_cast<double>(compTime.scale);
}

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

std::string GetRuntimeBundlePath() {
  return BuildRuntimePath("sketch_bundle.json");
}

std::string GetPendingRuntimeBundlePath() {
  return BuildRuntimePath("pending_sketch_bundle.json");
}

std::string BuildRuntimeInstancePath(A_long instanceId, const char* fileName = NULL) {
  if (instanceId <= 0) {
    return std::string();
  }

  std::string path = BuildRuntimePath("instances");
  if (path.empty()) {
    return std::string();
  }

  path.push_back('/');
  path.append(std::to_string(instanceId));
  if (fileName && fileName[0]) {
    path.push_back('/');
    path.append(fileName);
  }
  return path;
}

std::string GetRuntimeInstanceSketchPath(A_long instanceId) {
  return BuildRuntimeInstancePath(instanceId, "sketch.js");
}

std::string GetRuntimeInstanceBundlePath(A_long instanceId) {
  return BuildRuntimeInstancePath(instanceId, "sketch_bundle.json");
}

std::uintptr_t GetEffectCacheKey(PF_InData* in_data) {
  if (!in_data) {
    return 0;
  }

  if (in_data->sequence_data) {
    auto* seqData =
      reinterpret_cast<SequenceCacheData*>(DH(in_data->sequence_data));
    if (seqData) {
      const bool valid =
        seqData->magic == kSequenceCacheDataMagic &&
        IsCompatibleSequenceDataVersion(seqData->version) &&
        seqData->instanceId != 0;
      const std::uintptr_t key = valid
        ? static_cast<std::uintptr_t>(seqData->instanceId)
        : reinterpret_cast<std::uintptr_t>(in_data->sequence_data);
      return key;
    }
  }

  return reinterpret_cast<std::uintptr_t>(in_data->effect_ref);
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

struct LegacySequenceCacheDataHeader {
  A_u_long magic = 0;
  A_u_long version = 0;
  std::uint64_t instanceId = 0;
  A_long syncedRevision = -1;
};

struct SequenceRuntimeSnapshot {
  std::string bundleText;
  std::string sourceText;
};

std::uint64_t ResolveRuntimeBundleInstanceId(PF_InData* in_data, A_long instanceId) {
  if (instanceId > 0) {
    return static_cast<std::uint64_t>(static_cast<A_u_long>(instanceId));
  }

  if (!in_data || !in_data->sequence_data) {
    return 0;
  }

  auto* sequenceData =
    reinterpret_cast<SequenceCacheData*>(DH(in_data->sequence_data));
  if (!sequenceData) {
    return 0;
  }

  const bool valid =
    sequenceData->magic == kSequenceCacheDataMagic &&
    IsCompatibleSequenceDataVersion(sequenceData->version) &&
    sequenceData->instanceId != 0;
  return valid ? sequenceData->instanceId : 0;
}

std::optional<A_long> ReadEffectRevisionParam(PF_InData* in_data) {
  if (!in_data) {
    return std::nullopt;
  }

  PF_ParamDef param;
  AEFX_CLR_STRUCT(param);
  PF_Err err = PF_CHECKOUT_PARAM(
    in_data,
    PARAM_REVISION,
    in_data->current_time,
    in_data->time_step,
    in_data->time_scale,
    &param
  );
  if (err != PF_Err_NONE) {
    return std::nullopt;
  }

  const A_long revision = param.u.sd.value;
  PF_CHECKIN_PARAM(in_data, &param);
  return revision;
}

std::optional<SequenceRuntimeSnapshot> ReadSequenceRuntimeSnapshot(PF_InData* in_data) {
  if (!in_data || !in_data->sequence_data) {
    return std::nullopt;
  }

  const auto handleSize = PF_GET_HANDLE_SIZE(in_data->sequence_data);
  if (handleSize < sizeof(LegacySequenceCacheDataHeader)) {
    return std::nullopt;
  }

  const auto* legacyHeader =
    reinterpret_cast<const LegacySequenceCacheDataHeader*>(DH(in_data->sequence_data));
  if (!legacyHeader ||
      legacyHeader->magic != kSequenceCacheDataMagic ||
      legacyHeader->version != kSequenceCacheDataVersion) {
    return std::nullopt;
  }

  if (handleSize < sizeof(SequenceCacheData)) {
    return std::nullopt;
  }

  const auto* sequenceData =
    reinterpret_cast<const SequenceCacheData*>(legacyHeader);
  const std::size_t payloadBytes =
    static_cast<std::size_t>(sequenceData->bundleTextSize) +
    static_cast<std::size_t>(sequenceData->sourceTextSize);
  const std::size_t expectedSize = sizeof(SequenceCacheData) + payloadBytes;
  if (sequenceData->bundleTextSize == 0 ||
      sequenceData->sourceTextSize == 0 ||
      expectedSize > handleSize) {
    return std::nullopt;
  }

  const char* payload = reinterpret_cast<const char*>(sequenceData + 1);
  SequenceRuntimeSnapshot snapshot;
  snapshot.bundleText.assign(payload, sequenceData->bundleTextSize);
  snapshot.sourceText.assign(
    payload + sequenceData->bundleTextSize,
    sequenceData->sourceTextSize
  );
  return snapshot;
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
  if (const auto revision = ExtractJsonLongField(bundleText, "revision")) {
    bundle.revision = *revision;
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
  if (const auto debugSessionId = ExtractJsonStringField(bundleText, "debugSessionId")) {
    bundle.debugSessionId = *debugSessionId;
  }
  if (const auto profile = ExtractJsonStringField(bundleText, "profile")) {
    bundle.profile = *profile;
  } else if (const auto nestedProfile = ExtractNestedJsonStringField(bundleText, "analysis", "profile")) {
    bundle.profile = *nestedProfile;
  }
  if (const auto backgroundMode = ExtractJsonStringField(bundleText, "backgroundMode")) {
    bundle.backgroundMode = *backgroundMode;
  } else if (const auto nestedBackgroundMode = ExtractNestedJsonStringField(bundleText, "analysis", "backgroundMode")) {
    bundle.backgroundMode = *nestedBackgroundMode;
  }
  if (const auto controllerHash = ExtractJsonStringField(bundleText, "hash")) {
    bundle.controllerHash = *controllerHash;
  } else if (const auto nestedControllerHash = ExtractNestedJsonStringField(bundleText, "controller", "hash")) {
    bundle.controllerHash = *nestedControllerHash;
  }
  if (const auto pixelDensity = ExtractJsonDoubleField(bundleText, "pixelDensity")) {
    bundle.pixelDensity = std::max(1.0, *pixelDensity);
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

  if (const auto denseWindowBacktrack = ExtractNestedJsonLongField(bundleText, "cache", "denseWindowBacktrack")) {
    bundle.denseWindowBacktrack = std::max<long>(1, std::min<long>(120, *denseWindowBacktrack));
  }
  if (const auto denseWindowForward = ExtractNestedJsonLongField(bundleText, "cache", "denseWindowForward")) {
    bundle.denseWindowForward = std::max<long>(1, std::min<long>(240, *denseWindowForward));
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

RuntimeSketchBundle ReadRuntimeSketchBundleFromPath(
  const std::string& bundlePath,
  const std::string& defaultSketchPath,
  std::string* errorMessage
) {
  const auto bundleText = ReadTextFile(bundlePath);
  if (!bundleText.has_value()) {
    RuntimeSketchBundle bundle;
    bundle.sourcePath = defaultSketchPath.empty() ? GetRuntimeSketchPath() : defaultSketchPath;
    return bundle;
  }

  return ReadRuntimeSketchBundleFromText(*bundleText, defaultSketchPath, errorMessage);
}

bool TryReadRuntimeSketchBundleFromSequenceData(
  PF_InData* in_data,
  const std::string& defaultSketchPath,
  RuntimeSketchBundle* outBundle,
  std::string* errorMessage
) {
  if (!outBundle) {
    return false;
  }

  const std::optional<SequenceRuntimeSnapshot> snapshot = ReadSequenceRuntimeSnapshot(in_data);
  if (!snapshot.has_value()) {
    return false;
  }

  *outBundle = ReadRuntimeSketchBundleFromText(snapshot->bundleText, defaultSketchPath, errorMessage);
  outBundle->sourceText = snapshot->sourceText;
  outBundle->hasEmbeddedSource = !snapshot->sourceText.empty();
  return true;
}

RuntimeSketchBundle ReadRuntimeSketchBundle(std::string* errorMessage) {
  const std::string pendingBundlePath = GetPendingRuntimeBundlePath();
  if (FileExists(pendingBundlePath)) {
    return ReadRuntimeSketchBundleFromPath(
      pendingBundlePath,
      GetRuntimeSketchPath(),
      errorMessage
    );
  }

  return ReadRuntimeSketchBundleFromPath(
    GetRuntimeBundlePath(),
    GetRuntimeSketchPath(),
    errorMessage
  );
}

RuntimeSketchBundle ReadRuntimeSketchBundleForEffect(
  PF_InData* in_data,
  A_long instanceId,
  std::string* errorMessage
) {
  const std::uint64_t resolvedInstanceId = ResolveRuntimeBundleInstanceId(in_data, instanceId);
  const A_long expectedRevision = ReadEffectRevisionParam(in_data).value_or(-1);
  RuntimeSketchBundle sequenceBundle;
  RuntimeSketchBundle localBundle;
  bool hasSequenceBundle = false;
  bool hasLocalBundle = false;
  std::string sequenceError;
  std::string localError;
  if (resolvedInstanceId != 0) {
    const std::string instanceBundlePath =
      GetRuntimeInstanceBundlePath(static_cast<A_long>(resolvedInstanceId));
    const std::string instanceSketchPath =
      GetRuntimeInstanceSketchPath(static_cast<A_long>(resolvedInstanceId));
    hasSequenceBundle = TryReadRuntimeSketchBundleFromSequenceData(
      in_data,
      instanceSketchPath,
      &sequenceBundle,
      &sequenceError
    );
    if (FileExists(instanceBundlePath)) {
      localBundle = ReadRuntimeSketchBundleFromPath(
        instanceBundlePath,
        instanceSketchPath,
        &localError
      );
      hasLocalBundle = true;
    }
  }

  if (expectedRevision >= 0) {
    if (hasSequenceBundle && sequenceBundle.revision == expectedRevision) {
      if (errorMessage) {
        *errorMessage = sequenceError;
      }
      return sequenceBundle;
    }
    if (hasLocalBundle && localBundle.revision == expectedRevision) {
      if (errorMessage) {
        *errorMessage = localError;
      }
      return localBundle;
    }
  }

  if (hasSequenceBundle) {
    if (errorMessage) {
      *errorMessage = sequenceError;
    }
    return sequenceBundle;
  }

  if (hasLocalBundle) {
    if (errorMessage) {
      *errorMessage = localError;
    }
    return localBundle;
  }

  return ReadRuntimeSketchBundle(errorMessage);
}

std::optional<std::string> ReadRuntimeSketchSource(const RuntimeSketchBundle& bundle) {
  if (bundle.hasEmbeddedSource) {
    return bundle.sourceText;
  }
  return ReadTextFile(bundle.sourcePath);
}

bool IsDirectTimeProfile(const RuntimeSketchBundle& bundle) {
  return bundle.profile == "direct-time-js";
}

bool IsOpaqueBackgroundProfile(const RuntimeSketchBundle& bundle) {
  return bundle.backgroundMode == "opaque-likely";
}

}  // namespace momentum::runtime_internal
