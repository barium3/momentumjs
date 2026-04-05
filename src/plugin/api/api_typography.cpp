#include "api_internal.h"

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <string>
#include <vector>

#include "../render/render_text.h"
#include "../runtime/runtime_internal.h"

namespace momentum {

namespace {

constexpr int kTextAlignLeft = 0;
constexpr int kTextAlignRight = 1;
constexpr int kTextAlignCenter = 2;
constexpr int kTextAlignBaseline = 3;

std::string ToLowerCopy(const std::string& value) {
  std::string lowered = value;
  std::transform(
    lowered.begin(),
    lowered.end(),
    lowered.begin(),
    [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); }
  );
  return lowered;
}

std::string NormalizeTextWrap(const std::string& value) {
  const std::string lowered = ToLowerCopy(value);
  return lowered == "char" ? "CHAR" : "WORD";
}

std::string NormalizeTextStyle(const std::string& value) {
  const std::string lowered = ToLowerCopy(value);
  const bool bold = lowered.find("bold") != std::string::npos;
  const bool italic =
    lowered.find("italic") != std::string::npos ||
    lowered.find("oblique") != std::string::npos;

  if (bold && italic) {
    return "BOLDITALIC";
  }
  if (bold) {
    return "BOLD";
  }
  if (italic) {
    return "ITALIC";
  }
  return "NORMAL";
}

std::string NormalizeFontSourceKind(const std::string& value) {
  return ToLowerCopy(value) == "file" ? "file" : "system";
}

bool EndsWithFontExtension(const std::string& value) {
  const std::string extension = ToLowerCopy(std::filesystem::path(value).extension().string());
  return
    extension == ".ttf" ||
    extension == ".otf" ||
    extension == ".ttc" ||
    extension == ".otc" ||
    extension == ".dfont";
}

std::string NormalizeFontSource(const std::string& value) {
  std::string normalized = value;
  std::replace(normalized.begin(), normalized.end(), '\\', '/');
  return normalized;
}

bool ParseTextAlignValue(
  JSContextRef ctx,
  JSValueRef value,
  bool vertical,
  int fallback,
  int* outValue
) {
  if (!outValue || !value) {
    return false;
  }

  long numeric = 0;
  if (JsValueToLongSafe(ctx, value, numeric)) {
    switch (numeric) {
      case kTextAlignLeft:
      case kTextAlignRight:
      case kTextAlignCenter:
        *outValue = static_cast<int>(numeric);
        return true;
      case kTextAlignBaseline:
        if (vertical) {
          *outValue = kTextAlignBaseline;
          return true;
        }
        break;
      default:
        break;
    }
  }

  const std::string lowered = ToLowerCopy(JsValueToStdString(ctx, value));
  if (lowered == "left") {
    *outValue = kTextAlignLeft;
    return true;
  }
  if (lowered == "right") {
    *outValue = kTextAlignRight;
    return true;
  }
  if (lowered == "center") {
    *outValue = kTextAlignCenter;
    return true;
  }
  if (vertical && lowered == "top") {
    *outValue = kTextAlignLeft;
    return true;
  }
  if (vertical && lowered == "bottom") {
    *outValue = kTextAlignRight;
    return true;
  }
  if (vertical && lowered == "baseline") {
    *outValue = kTextAlignBaseline;
    return true;
  }

  *outValue = fallback;
  return false;
}

SceneCommand MakeTextCommandTemplate() {
  SceneCommand command;
  command.type = "text";
  if (g_activeRuntime) {
    command.fontName = g_activeRuntime->textFontName;
    command.fontPath = g_activeRuntime->textFontPath;
    command.fontSourceKind = g_activeRuntime->textFontSourceKind;
    command.textStyle = g_activeRuntime->textStyle;
    command.textWrap = g_activeRuntime->textWrap;
    command.textSize = g_activeRuntime->textSize;
    command.textLeading = g_activeRuntime->textLeading;
    command.textAlignH = g_activeRuntime->textAlignH;
    command.textAlignV = g_activeRuntime->textAlignV;
  }
  return command;
}

JSValueRef MakeJsString(JSContextRef ctx, const std::string& value) {
  JSStringRef stringValue = JSStringCreateWithUTF8CString(value.c_str());
  JSValueRef result = JSValueMakeString(ctx, stringValue);
  JSStringRelease(stringValue);
  return result;
}

JSValueRef MakeJsBoolean(JSContextRef ctx, bool value) {
  return JSValueMakeBoolean(ctx, value);
}

JSValueRef GetJsProperty(JSContextRef ctx, JSObjectRef object, const char* name) {
  if (!ctx || !object || !name) {
    return NULL;
  }

  JSStringRef key = JSStringCreateWithUTF8CString(name);
  JSValueRef value = JSObjectGetProperty(ctx, object, key, NULL);
  JSStringRelease(key);
  return value;
}

void SetJsProperty(JSContextRef ctx, JSObjectRef object, const char* name, JSValueRef value) {
  if (!ctx || !object || !name || !value) {
    return;
  }

  JSStringRef key = JSStringCreateWithUTF8CString(name);
  JSObjectSetProperty(ctx, object, key, value, kJSPropertyAttributeNone, NULL);
  JSStringRelease(key);
}

void ApplyTextStyleDefaults(SceneCommand* command) {
  if (!command || !g_activeRuntime) {
    return;
  }

  if (!g_activeRuntime->fillExplicit) {
    command->fill = PF_Pixel{255, 0, 0, 0};
    command->hasFill = true;
  }

  if (!g_activeRuntime->strokeExplicit) {
    command->hasStroke = false;
    command->stroke = PF_Pixel{0, 0, 0, 0};
  }
}

FontDescriptor BuildRequestedFontDescriptor(const std::string& source) {
  FontDescriptor descriptor;
  descriptor.source = NormalizeFontSource(source);

  const std::filesystem::path sourcePath(descriptor.source);
  if (sourcePath.is_absolute() || EndsWithFontExtension(descriptor.source)) {
    descriptor.fontSourceKind = "file";
    std::filesystem::path resolvedPath = sourcePath;
    if (!resolvedPath.is_absolute()) {
      const std::string runtimeDirectory = runtime_internal::GetRuntimeDirectoryPath();
      if (!runtimeDirectory.empty()) {
        resolvedPath = std::filesystem::path(runtimeDirectory) / resolvedPath;
      }
    }
    descriptor.fontPath = resolvedPath.lexically_normal().string();
    descriptor.fontName = sourcePath.stem().string();
  } else {
    descriptor.fontSourceKind = "system";
    descriptor.fontName = descriptor.source;
  }

  return descriptor;
}

bool ResolveRequestedFontDescriptor(
  const FontDescriptor& request,
  const std::string& textStyle,
  FontDescriptor* outResolved
) {
  if (!outResolved) {
    return false;
  }

  FontDescriptor resolved;
  if (!ResolveFont(
        request.fontName,
        request.fontPath,
        request.fontSourceKind,
        textStyle,
        &resolved)) {
    *outResolved = resolved;
    outResolved->source = request.source;
    if (outResolved->fontName.empty()) {
      outResolved->fontName = request.fontName;
    }
    if (outResolved->fontPath.empty()) {
      outResolved->fontPath = request.fontPath;
    }
    if (outResolved->fontSourceKind.empty()) {
      outResolved->fontSourceKind = request.fontSourceKind;
    }
    return false;
  }

  *outResolved = resolved;
  outResolved->source = request.source;
  return true;
}

JSObjectRef MakeFontDescriptorObject(JSContextRef ctx, const FontDescriptor& descriptor) {
  JSObjectRef result = JSObjectMake(ctx, NULL, NULL);
  SetJsProperty(ctx, result, "source", MakeJsString(ctx, descriptor.source));
  SetJsProperty(ctx, result, "fontName", MakeJsString(ctx, descriptor.fontName));
  SetJsProperty(ctx, result, "fontPath", MakeJsString(ctx, descriptor.fontPath));
  SetJsProperty(ctx, result, "fontSourceKind", MakeJsString(ctx, descriptor.fontSourceKind));
  SetJsProperty(ctx, result, "loaded", MakeJsBoolean(ctx, descriptor.loaded));
  SetJsProperty(ctx, result, "loadError", MakeJsString(ctx, descriptor.loadError));
  return result;
}

bool ReadBooleanProperty(JSContextRef ctx, JSObjectRef object, const char* name, bool fallback) {
  JSValueRef value = GetJsProperty(ctx, object, name);
  if (!value || JSValueIsUndefined(ctx, value) || JSValueIsNull(ctx, value)) {
    return fallback;
  }
  return JSValueToBoolean(ctx, value);
}

std::string ReadStringProperty(JSContextRef ctx, JSObjectRef object, const char* name) {
  JSValueRef value = GetJsProperty(ctx, object, name);
  return value ? JsValueToStdString(ctx, value) : std::string();
}

bool ReadFontDescriptorValue(
  JSContextRef ctx,
  JSValueRef value,
  FontDescriptor* outDescriptor
) {
  if (!ctx || !value || !outDescriptor || !JSValueIsObject(ctx, value)) {
    return false;
  }

  JSObjectRef object = JSValueToObject(ctx, value, NULL);
  if (!object) {
    return false;
  }

  JSValueRef fontDataValue = GetJsProperty(ctx, object, "_fontData");
  if (fontDataValue && JSValueIsObject(ctx, fontDataValue)) {
    object = JSValueToObject(ctx, fontDataValue, NULL);
    if (!object) {
      return false;
    }
  }

  outDescriptor->source = ReadStringProperty(ctx, object, "source");
  outDescriptor->fontName = ReadStringProperty(ctx, object, "fontName");
  outDescriptor->fontPath = ReadStringProperty(ctx, object, "fontPath");
  outDescriptor->fontSourceKind = NormalizeFontSourceKind(ReadStringProperty(ctx, object, "fontSourceKind"));
  outDescriptor->loaded = ReadBooleanProperty(ctx, object, "loaded", true);
  outDescriptor->loadError = ReadStringProperty(ctx, object, "loadError");

  if (outDescriptor->fontSourceKind == "system" && !outDescriptor->fontPath.empty()) {
    outDescriptor->fontSourceKind = "file";
  }
  if (outDescriptor->fontName.empty() && !outDescriptor->fontPath.empty()) {
    outDescriptor->fontName = std::filesystem::path(outDescriptor->fontPath).stem().string();
  }

  return !outDescriptor->fontName.empty() || !outDescriptor->fontPath.empty();
}

void ApplyFontDescriptorToRuntime(const FontDescriptor& descriptor) {
  if (!g_activeRuntime) {
    return;
  }

  g_activeRuntime->textFontName = descriptor.fontName.empty() ? "Arial" : descriptor.fontName;
  g_activeRuntime->textFontPath = descriptor.fontPath;
  g_activeRuntime->textFontSourceKind = NormalizeFontSourceKind(descriptor.fontSourceKind);
}

SceneCommand MakeFontCommand(
  const FontDescriptor& descriptor,
  const std::string& text,
  double x,
  double y,
  double size
) {
  SceneCommand command = MakeTextCommandTemplate();
  command.text = text;
  command.x.value = x;
  command.y.value = y;
  command.fontName = descriptor.fontName;
  command.fontPath = descriptor.fontPath;
  command.fontSourceKind = NormalizeFontSourceKind(descriptor.fontSourceKind);
  if (size > 0.0) {
    command.textSize = size;
    if (!g_activeRuntime || !g_activeRuntime->textLeadingExplicit) {
      command.textLeading = size * 1.2;
    }
  }
  return command;
}

JSObjectRef MakeTextBoundsObject(JSContextRef ctx, const TextBounds& bounds) {
  JSObjectRef result = JSObjectMake(ctx, NULL, NULL);
  SetJsProperty(ctx, result, "x", JSValueMakeNumber(ctx, bounds.x));
  SetJsProperty(ctx, result, "y", JSValueMakeNumber(ctx, bounds.y));
  SetJsProperty(ctx, result, "w", JSValueMakeNumber(ctx, bounds.width));
  SetJsProperty(ctx, result, "h", JSValueMakeNumber(ctx, bounds.height));
  return result;
}

JSObjectRef MakeTextPointsArray(JSContextRef ctx, const std::vector<TextPoint>& points) {
  JSObjectRef array = JSObjectMakeArray(ctx, 0, NULL, NULL);
  for (std::size_t i = 0; i < points.size(); ++i) {
    JSObjectRef point = JSObjectMake(ctx, NULL, NULL);
    SetJsProperty(ctx, point, "x", JSValueMakeNumber(ctx, points[i].x));
    SetJsProperty(ctx, point, "y", JSValueMakeNumber(ctx, points[i].y));
    SetJsProperty(ctx, point, "alpha", JSValueMakeNumber(ctx, points[i].alpha));
    JSObjectSetPropertyAtIndex(ctx, array, static_cast<unsigned>(i), point, NULL);
  }
  return array;
}

}  // namespace

JSValueRef JsText(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  if (!g_activeRuntime || argumentCount < 3) {
    return JSValueMakeUndefined(ctx);
  }

  double x = 0.0;
  double y = 0.0;
  if (!JsValueToNumberSafe(ctx, arguments[1], x) || !JsValueToNumberSafe(ctx, arguments[2], y)) {
    return JSValueMakeUndefined(ctx);
  }

  SceneCommand command = MakeTextCommandTemplate();
  command.text = JsValueToStdString(ctx, arguments[0]);

  double width = 0.0;
  double height = 0.0;
  bool hasWidth = false;
  bool hasHeight = false;
  if (argumentCount >= 4) {
    hasWidth = JsValueToNumberSafe(ctx, arguments[3], width);
  }
  if (argumentCount >= 5) {
    hasHeight = JsValueToNumberSafe(ctx, arguments[4], height);
  }

  if (hasWidth) {
    double normalizedX = x;
    double normalizedY = y;
    double normalizedWidth = width;
    double normalizedHeight = hasHeight ? height : 0.0;
    NormalizeRectArgs(
      g_activeRuntime->rectMode,
      &normalizedX,
      &normalizedY,
      &normalizedWidth,
      &normalizedHeight
    );
    x = normalizedX;
    y = normalizedY;
    width = normalizedWidth;
    height = normalizedHeight;
  }

  command.x.value = x;
  command.y.value = y;
  if (hasWidth) {
    command.width.value = width;
    command.textHasWidth = true;
  }
  if (hasHeight) {
    command.height.value = height;
    command.textHasHeight = true;
  }

  ApplyCurrentStyle(&command);
  ApplyTextStyleDefaults(&command);
  AppendSceneCommand(g_activeRuntime, command);
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsTextSize(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  if (!g_activeRuntime) {
    return JSValueMakeNumber(ctx, 12.0);
  }
  if (argumentCount < 1) {
    return JSValueMakeNumber(ctx, g_activeRuntime->textSize);
  }

  double nextSize = 0.0;
  if (!JsValueToNumberSafe(ctx, arguments[0], nextSize)) {
    return JSValueMakeUndefined(ctx);
  }
  g_activeRuntime->textSize = std::max(1.0, nextSize);
  if (!g_activeRuntime->textLeadingExplicit) {
    g_activeRuntime->textLeading = g_activeRuntime->textSize * 1.2;
  }
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsTextLeading(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  if (!g_activeRuntime) {
    return JSValueMakeNumber(ctx, 15.0);
  }
  if (argumentCount < 1) {
    return JSValueMakeNumber(ctx, g_activeRuntime->textLeading);
  }

  double nextLeading = 0.0;
  if (!JsValueToNumberSafe(ctx, arguments[0], nextLeading)) {
    return JSValueMakeUndefined(ctx);
  }
  g_activeRuntime->textLeading = std::max(1.0, nextLeading);
  g_activeRuntime->textLeadingExplicit = true;
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsTextFont(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  if (!g_activeRuntime) {
    return MakeJsString(ctx, "Arial");
  }
  if (argumentCount < 1) {
    return MakeJsString(ctx, g_activeRuntime->textFontName);
  }

  FontDescriptor descriptor;
  if (ReadFontDescriptorValue(ctx, arguments[0], &descriptor)) {
    if (descriptor.loaded) {
      FontDescriptor resolved;
      if (ResolveRequestedFontDescriptor(descriptor, g_activeRuntime->textStyle, &resolved)) {
        ApplyFontDescriptorToRuntime(resolved);
      }
    }
  } else {
    g_activeRuntime->textFontName = JsValueToStdString(ctx, arguments[0]);
    if (g_activeRuntime->textFontName.empty()) {
      g_activeRuntime->textFontName = "Arial";
    }
    g_activeRuntime->textFontPath.clear();
    g_activeRuntime->textFontSourceKind = "system";
  }

  if (argumentCount >= 2) {
    double size = 0.0;
    if (JsValueToNumberSafe(ctx, arguments[1], size) && size > 0.0) {
      g_activeRuntime->textSize = size;
      if (!g_activeRuntime->textLeadingExplicit) {
        g_activeRuntime->textLeading = g_activeRuntime->textSize * 1.2;
      }
    }
  }

  return JSValueMakeUndefined(ctx);
}

JSValueRef JsTextStyle(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  if (!g_activeRuntime) {
    return MakeJsString(ctx, "NORMAL");
  }
  if (argumentCount < 1) {
    return MakeJsString(ctx, g_activeRuntime->textStyle);
  }

  g_activeRuntime->textStyle = NormalizeTextStyle(JsValueToStdString(ctx, arguments[0]));
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsTextWrap(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  if (!g_activeRuntime) {
    return MakeJsString(ctx, "WORD");
  }
  if (argumentCount < 1) {
    return MakeJsString(ctx, g_activeRuntime->textWrap);
  }

  g_activeRuntime->textWrap = NormalizeTextWrap(JsValueToStdString(ctx, arguments[0]));
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsTextAlign(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  if (!g_activeRuntime) {
    return JSValueMakeNumber(ctx, kTextAlignLeft);
  }
  if (argumentCount < 1) {
    return JSValueMakeNumber(ctx, g_activeRuntime->textAlignH);
  }

  int horizontal = g_activeRuntime->textAlignH;
  ParseTextAlignValue(ctx, arguments[0], false, horizontal, &horizontal);
  g_activeRuntime->textAlignH = horizontal;

  if (argumentCount >= 2) {
    int vertical = g_activeRuntime->textAlignV;
    ParseTextAlignValue(ctx, arguments[1], true, vertical, &vertical);
    g_activeRuntime->textAlignV = vertical;
  }

  return JSValueMakeUndefined(ctx);
}

JSValueRef JsTextWidth(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  if (!g_activeRuntime || argumentCount < 1) {
    return JSValueMakeNumber(ctx, 0.0);
  }

  SceneCommand command = MakeTextCommandTemplate();
  command.text = JsValueToStdString(ctx, arguments[0]);
  TextLayoutMetrics metrics;
  if (!MeasureTextCommand(command, &metrics)) {
    return JSValueMakeNumber(ctx, 0.0);
  }
  return JSValueMakeNumber(ctx, metrics.width);
}

JSValueRef JsTextAscent(
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
  if (!g_activeRuntime) {
    return JSValueMakeNumber(ctx, 0.0);
  }

  TextLayoutMetrics metrics;
  if (!MeasureTextCommand(MakeTextCommandTemplate(), &metrics)) {
    return JSValueMakeNumber(ctx, 0.0);
  }
  return JSValueMakeNumber(ctx, metrics.ascent);
}

JSValueRef JsTextDescent(
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
  if (!g_activeRuntime) {
    return JSValueMakeNumber(ctx, 0.0);
  }

  TextLayoutMetrics metrics;
  if (!MeasureTextCommand(MakeTextCommandTemplate(), &metrics)) {
    return JSValueMakeNumber(ctx, 0.0);
  }
  return JSValueMakeNumber(ctx, metrics.descent);
}

JSValueRef JsMomentumNativeLoadFont(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;

  FontDescriptor request = BuildRequestedFontDescriptor(
    argumentCount > 0 ? JsValueToStdString(ctx, arguments[0]) : std::string()
  );
  if (request.source.empty()) {
    request.loaded = false;
    request.loadError = "Font source is empty";
    return MakeFontDescriptorObject(ctx, request);
  }

  FontDescriptor resolved;
  if (ResolveRequestedFontDescriptor(request, "NORMAL", &resolved)) {
    return MakeFontDescriptorObject(ctx, resolved);
  }

  request.loaded = false;
  request.loadError = resolved.loadError;
  if (!resolved.fontName.empty()) {
    request.fontName = resolved.fontName;
  }
  if (!resolved.fontPath.empty()) {
    request.fontPath = resolved.fontPath;
  }
  return MakeFontDescriptorObject(ctx, request);
}

JSValueRef JsMomentumNativeFontTextBounds(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;

  FontDescriptor descriptor;
  if (argumentCount < 4 || !ReadFontDescriptorValue(ctx, arguments[0], &descriptor) || !descriptor.loaded) {
    return MakeTextBoundsObject(ctx, TextBounds());
  }

  double x = 0.0;
  double y = 0.0;
  double size = g_activeRuntime ? g_activeRuntime->textSize : 12.0;
  if (!JsValueToNumberSafe(ctx, arguments[2], x) || !JsValueToNumberSafe(ctx, arguments[3], y)) {
    return MakeTextBoundsObject(ctx, TextBounds());
  }
  if (argumentCount >= 5) {
    double requestedSize = 0.0;
    if (JsValueToNumberSafe(ctx, arguments[4], requestedSize) && requestedSize > 0.0) {
      size = requestedSize;
    }
  }

  const SceneCommand command = MakeFontCommand(
    descriptor,
    JsValueToStdString(ctx, arguments[1]),
    x,
    y,
    size
  );
  TextBounds bounds;
  if (!ComputeTextBounds(command, &bounds)) {
    return MakeTextBoundsObject(ctx, TextBounds());
  }
  return MakeTextBoundsObject(ctx, bounds);
}

JSValueRef JsMomentumNativeFontTextToPoints(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;

  FontDescriptor descriptor;
  if (argumentCount < 4 || !ReadFontDescriptorValue(ctx, arguments[0], &descriptor) || !descriptor.loaded) {
    return MakeTextPointsArray(ctx, std::vector<TextPoint>());
  }

  double x = 0.0;
  double y = 0.0;
  double size = g_activeRuntime ? g_activeRuntime->textSize : 12.0;
  double sampleFactor = 0.1;
  double simplifyThreshold = 0.0;
  if (!JsValueToNumberSafe(ctx, arguments[2], x) || !JsValueToNumberSafe(ctx, arguments[3], y)) {
    return MakeTextPointsArray(ctx, std::vector<TextPoint>());
  }
  if (argumentCount >= 5) {
    double requestedSize = 0.0;
    if (JsValueToNumberSafe(ctx, arguments[4], requestedSize) && requestedSize > 0.0) {
      size = requestedSize;
    }
  }
  if (argumentCount >= 6) {
    double requestedSampleFactor = 0.0;
    if (JsValueToNumberSafe(ctx, arguments[5], requestedSampleFactor) && requestedSampleFactor > 0.0) {
      sampleFactor = requestedSampleFactor;
    }
  }
  if (argumentCount >= 7) {
    double requestedSimplifyThreshold = 0.0;
    if (JsValueToNumberSafe(ctx, arguments[6], requestedSimplifyThreshold) && requestedSimplifyThreshold > 0.0) {
      simplifyThreshold = requestedSimplifyThreshold;
    }
  }

  const SceneCommand command = MakeFontCommand(
    descriptor,
    JsValueToStdString(ctx, arguments[1]),
    x,
    y,
    size
  );
  std::vector<TextPoint> points;
  if (!ComputeTextPoints(command, sampleFactor, simplifyThreshold, &points)) {
    points.clear();
  }
  return MakeTextPointsArray(ctx, points);
}

}  // namespace momentum
