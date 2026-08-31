#include "scripting/api/common.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <string>
#include <unordered_map>
#include <vector>

namespace momentum {

namespace {

constexpr double kBezierArcMaxSweep = 3.14159265358979323846 * 0.5;

double ClampColorByte(double value) {
  return std::max(0.0, std::min(255.0, value));
}

double ClampUnitInterval(double value) {
  return std::max(0.0, std::min(1.0, value));
}

std::string TrimAscii(std::string value) {
  auto notSpace = [](unsigned char ch) {
    return !std::isspace(ch);
  };
  value.erase(value.begin(), std::find_if(value.begin(), value.end(), notSpace));
  value.erase(std::find_if(value.rbegin(), value.rend(), notSpace).base(), value.end());
  return value;
}

std::string LowerAscii(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });
  return value;
}

bool ParseFiniteDouble(const std::string& token, double* outValue) {
  if (!outValue) {
    return false;
  }
  const std::string trimmed = TrimAscii(token);
  if (trimmed.empty()) {
    return false;
  }
  char* end = nullptr;
  const double value = std::strtod(trimmed.c_str(), &end);
  if (end == trimmed.c_str() || *end != '\0' || !std::isfinite(value) || std::isnan(value)) {
    return false;
  }
  *outValue = value;
  return true;
}

std::vector<std::string> SplitCommaSeparated(const std::string& value) {
  std::vector<std::string> parts;
  std::size_t start = 0;
  while (start <= value.size()) {
    const std::size_t comma = value.find(',', start);
    const std::size_t end = comma == std::string::npos ? value.size() : comma;
    parts.push_back(TrimAscii(value.substr(start, end - start)));
    if (comma == std::string::npos) {
      break;
    }
    start = comma + 1;
  }
  return parts;
}

bool ParseHexByte(const std::string& token, int index, int count, double* outValue) {
  if (!outValue || index < 0 || count <= 0 || static_cast<std::size_t>(index + count) > token.size()) {
    return false;
  }
  const std::string part = token.substr(static_cast<std::size_t>(index), static_cast<std::size_t>(count));
  char* end = nullptr;
  const long value = std::strtol(part.c_str(), &end, 16);
  if (end == part.c_str() || *end != '\0') {
    return false;
  }
  *outValue = static_cast<double>(value);
  return true;
}

double HueToRgb(double p, double q, double t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

PF_Pixel HslToRgbByteColor(double hue, double saturation, double lightness, double alpha) {
  double red = lightness;
  double green = lightness;
  double blue = lightness;

  if (saturation > 0.0) {
    const double q = lightness < 0.5
      ? lightness * (1.0 + saturation)
      : lightness + saturation - lightness * saturation;
    const double p = 2.0 * lightness - q;
    red = HueToRgb(p, q, hue + 1.0 / 3.0);
    green = HueToRgb(p, q, hue);
    blue = HueToRgb(p, q, hue - 1.0 / 3.0);
  }

  return PF_Pixel{
    static_cast<A_u_char>(std::round(ClampColorByte(alpha * 255.0))),
    static_cast<A_u_char>(std::round(ClampColorByte(red * 255.0))),
    static_cast<A_u_char>(std::round(ClampColorByte(green * 255.0))),
    static_cast<A_u_char>(std::round(ClampColorByte(blue * 255.0)))
  };
}

bool ParseCssColorString(const std::string& rawValue, PF_Pixel* outColor) {
  if (!outColor) {
    return false;
  }

  const std::string value = LowerAscii(TrimAscii(rawValue));
  if (value.empty()) {
    return false;
  }

  if (value == "transparent") {
    *outColor = PF_Pixel{0, 0, 0, 0};
    return true;
  }

  static const std::unordered_map<std::string, PF_Pixel> kNamedColors = {
    {"black", PF_Pixel{255, 0, 0, 0}},
    {"white", PF_Pixel{255, 255, 255, 255}},
    {"red", PF_Pixel{255, 255, 0, 0}},
    {"lime", PF_Pixel{255, 0, 255, 0}},
    {"blue", PF_Pixel{255, 0, 0, 255}},
    {"yellow", PF_Pixel{255, 255, 255, 0}},
    {"cyan", PF_Pixel{255, 0, 255, 255}},
    {"magenta", PF_Pixel{255, 255, 0, 255}},
    {"gray", PF_Pixel{255, 128, 128, 128}},
    {"grey", PF_Pixel{255, 128, 128, 128}},
    {"orange", PF_Pixel{255, 255, 166, 0}},
    {"purple", PF_Pixel{255, 128, 0, 128}},
    {"pink", PF_Pixel{255, 255, 191, 204}},
    {"green", PF_Pixel{255, 0, 128, 0}},
    {"navy", PF_Pixel{255, 0, 0, 128}},
    {"teal", PF_Pixel{255, 0, 128, 128}},
    {"maroon", PF_Pixel{255, 128, 0, 0}},
    {"olive", PF_Pixel{255, 128, 128, 0}},
    {"silver", PF_Pixel{255, 191, 191, 191}},
    {"aqua", PF_Pixel{255, 0, 255, 255}},
    {"fuchsia", PF_Pixel{255, 255, 0, 255}},
  };

  const auto namedIt = kNamedColors.find(value);
  if (namedIt != kNamedColors.end()) {
    *outColor = namedIt->second;
    return true;
  }

  if (!value.empty() && value[0] == '#') {
    const std::string hex = value.substr(1);
    double red = 0.0;
    double green = 0.0;
    double blue = 0.0;
    double alpha = 255.0;

    if (hex.size() == 3 || hex.size() == 4) {
      std::string expanded;
      expanded.reserve(hex.size() * 2);
      for (char ch : hex) {
        expanded.push_back(ch);
        expanded.push_back(ch);
      }
      const std::string normalized = expanded;
      if (!ParseHexByte(normalized, 0, 2, &red) ||
          !ParseHexByte(normalized, 2, 2, &green) ||
          !ParseHexByte(normalized, 4, 2, &blue)) {
        return false;
      }
      if (normalized.size() == 8 && !ParseHexByte(normalized, 6, 2, &alpha)) {
        return false;
      }
    } else if (hex.size() == 6 || hex.size() == 8) {
      if (!ParseHexByte(hex, 0, 2, &red) ||
          !ParseHexByte(hex, 2, 2, &green) ||
          !ParseHexByte(hex, 4, 2, &blue)) {
        return false;
      }
      if (hex.size() == 8 && !ParseHexByte(hex, 6, 2, &alpha)) {
        return false;
      }
    } else {
      return false;
    }

    *outColor = PF_Pixel{
      static_cast<A_u_char>(std::round(ClampColorByte(alpha))),
      static_cast<A_u_char>(std::round(ClampColorByte(red))),
      static_cast<A_u_char>(std::round(ClampColorByte(green))),
      static_cast<A_u_char>(std::round(ClampColorByte(blue)))
    };
    return true;
  }

  const auto parseFunctionColor = [&](const std::string& prefix, bool hasAlpha, bool isPercentRgb, bool isHsl) -> bool {
    const std::string open = prefix + "(";
    if (value.rfind(open, 0) != 0 || value.back() != ')') {
      return false;
    }

    const std::vector<std::string> parts = SplitCommaSeparated(value.substr(open.size(), value.size() - open.size() - 1));
    const std::size_t expected = hasAlpha ? 4 : 3;
    if (parts.size() != expected) {
      return false;
    }

    double alpha = 1.0;
    if (hasAlpha) {
      if (!ParseFiniteDouble(parts[3], &alpha)) {
        return false;
      }
      if (alpha > 1.0) {
        alpha /= 255.0;
      }
      alpha = ClampUnitInterval(alpha);
    }

    if (isHsl) {
      double hue = 0.0;
      double saturation = 0.0;
      double lightness = 0.0;
      if (!ParseFiniteDouble(parts[0], &hue)) {
        return false;
      }
      if (parts[1].empty() || parts[1].back() != '%' || parts[2].empty() || parts[2].back() != '%') {
        return false;
      }
      if (!ParseFiniteDouble(parts[1].substr(0, parts[1].size() - 1), &saturation) ||
          !ParseFiniteDouble(parts[2].substr(0, parts[2].size() - 1), &lightness)) {
        return false;
      }
      hue = std::fmod(hue / 360.0, 1.0);
      if (hue < 0.0) {
        hue += 1.0;
      }
      *outColor = HslToRgbByteColor(
        hue,
        ClampUnitInterval(saturation / 100.0),
        ClampUnitInterval(lightness / 100.0),
        alpha
      );
      return true;
    }

    double channels[3] = {0.0, 0.0, 0.0};
    for (int i = 0; i < 3; ++i) {
      if (isPercentRgb) {
        if (parts[i].empty() || parts[i].back() != '%') {
          return false;
        }
        if (!ParseFiniteDouble(parts[i].substr(0, parts[i].size() - 1), &channels[i])) {
          return false;
        }
        channels[i] = ClampColorByte((channels[i] / 100.0) * 255.0);
      } else {
        if (!ParseFiniteDouble(parts[i], &channels[i])) {
          return false;
        }
        channels[i] = ClampColorByte(channels[i]);
      }
    }

    *outColor = PF_Pixel{
      static_cast<A_u_char>(std::round(alpha * 255.0)),
      static_cast<A_u_char>(std::round(channels[0])),
      static_cast<A_u_char>(std::round(channels[1])),
      static_cast<A_u_char>(std::round(channels[2]))
    };
    return true;
  };

  return
    parseFunctionColor("rgb", false, false, false) ||
    parseFunctionColor("rgba", true, false, false) ||
    parseFunctionColor("rgb", false, true, false) ||
    parseFunctionColor("rgba", true, true, false) ||
    parseFunctionColor("hsl", false, false, true) ||
    parseFunctionColor("hsla", true, false, true);
}

void AppendCubicArcSegment(
  PathSubpath* subpath,
  double cx,
  double cy,
  double rx,
  double ry,
  double startAngle,
  double stopAngle
) {
  if (!subpath) {
    return;
  }

  const double delta = stopAngle - startAngle;
  const double k = (4.0 / 3.0) * std::tan(delta * 0.25);
  const double cos0 = std::cos(startAngle);
  const double sin0 = std::sin(startAngle);
  const double cos1 = std::cos(stopAngle);
  const double sin1 = std::sin(stopAngle);
  const double x0 = cx + rx * cos0;
  const double y0 = cy + ry * sin0;
  const double x3 = cx + rx * cos1;
  const double y3 = cy + ry * sin1;

  subpath->segments.push_back(MakeCubicToSegment(
    x0 - k * rx * sin0,
    y0 + k * ry * cos0,
    x3 + k * rx * sin1,
    y3 - k * ry * cos1,
    x3,
    y3
  ));
}

}  // namespace

std::string JsStringToStdString(JSStringRef value) {
  if (!value) {
    return std::string();
  }

  const std::size_t maxSize = JSStringGetMaximumUTF8CStringSize(value);
  std::string result(maxSize, '\0');
  const std::size_t actualSize = JSStringGetUTF8CString(value, &result[0], maxSize);
  if (actualSize == 0) {
    return std::string();
  }
  result.resize(actualSize - 1);
  return result;
}

std::string JsValueToStdString(JSContextRef ctx, JSValueRef value) {
  if (!value) {
    return std::string();
  }

  JSStringRef stringValue = JSValueToStringCopy(ctx, value, NULL);
  if (!stringValue) {
    return std::string();
  }

  const std::string result = JsStringToStdString(stringValue);
  JSStringRelease(stringValue);
  return result;
}

bool JsValueToNumberSafe(JSContextRef ctx, JSValueRef value, double& result) {
  JSValueRef exception = NULL;
  const double numeric = JSValueToNumber(ctx, value, &exception);
  if (exception || std::isnan(numeric) || std::isinf(numeric)) {
    return false;
  }

  result = numeric;
  return true;
}

bool JsValueToLongSafe(JSContextRef ctx, JSValueRef value, long& result) {
  double numeric = 0.0;
  if (!JsValueToNumberSafe(ctx, value, numeric)) {
    return false;
  }
  result = static_cast<long>(std::llround(numeric));
  return true;
}

RuntimeSnapshot CaptureRuntimeStyleState(const JsHostRuntime& runtime) {
  RuntimeSnapshot snapshot;
  static_cast<RuntimeStyleState&>(snapshot) =
    static_cast<const RuntimeStyleState&>(runtime);
  return snapshot;
}

void RestoreRuntimeStyleState(JsHostRuntime* runtime, const RuntimeSnapshot& snapshot) {
  if (!runtime) {
    return;
  }

  static_cast<RuntimeStyleState&>(*runtime) = snapshot;
}

void MarkSceneDirty(JsHostRuntime* runtime) {
  if (!runtime) {
    return;
  }
  runtime->sceneVersion += 1;
}

void AppendSceneCommand(JsHostRuntime* runtime, const SceneCommand& command) {
  if (!runtime) {
    return;
  }
  runtime->scene.commands.push_back(command);
  MarkSceneDirty(runtime);
}

void ClearSceneCommands(JsHostRuntime* runtime) {
  if (!runtime) {
    return;
  }
  runtime->scene.commands.clear();
  MarkSceneDirty(runtime);
}

bool ReadVector2(JSContextRef ctx, JSValueRef value, double* x, double* y) {
  if (!ctx || !value || !x || !y || !JSValueIsObject(ctx, value)) {
    return false;
  }

  JSObjectRef object = JSValueToObject(ctx, value, NULL);
  if (!object) {
    return false;
  }

  double indexedX = 0.0;
  double indexedY = 0.0;
  JSValueRef indexedXValue = JSObjectGetPropertyAtIndex(ctx, object, 0, NULL);
  JSValueRef indexedYValue = JSObjectGetPropertyAtIndex(ctx, object, 1, NULL);
  if (JsValueToNumberSafe(ctx, indexedXValue, indexedX) &&
      JsValueToNumberSafe(ctx, indexedYValue, indexedY)) {
    *x = indexedX;
    *y = indexedY;
    return true;
  }

  JSStringRef xKey = JSStringCreateWithUTF8CString("x");
  JSStringRef yKey = JSStringCreateWithUTF8CString("y");
  JSValueRef xValue = JSObjectGetProperty(ctx, object, xKey, NULL);
  JSValueRef yValue = JSObjectGetProperty(ctx, object, yKey, NULL);
  JSStringRelease(xKey);
  JSStringRelease(yKey);

  double nextX = 0.0;
  double nextY = 0.0;
  if (!JsValueToNumberSafe(ctx, xValue, nextX) || !JsValueToNumberSafe(ctx, yValue, nextY)) {
    return false;
  }

  *x = nextX;
  *y = nextY;
  return true;
}

bool JsValueToAngleModeSafe(JSContextRef ctx, JSValueRef value, int* angleModeOut) {
  if (!value || !angleModeOut) {
    return false;
  }

  if (JSValueIsString(ctx, value)) {
    const std::string text = JsValueToStdString(ctx, value);
    if (text == "degrees") {
      *angleModeOut = ANGLE_MODE_DEGREES;
      return true;
    }
    if (text == "radians") {
      *angleModeOut = ANGLE_MODE_RADIANS;
      return true;
    }
  }

  long numeric = 0;
  if (JsValueToLongSafe(ctx, value, numeric)) {
    if (numeric == ANGLE_MODE_DEGREES) {
      *angleModeOut = ANGLE_MODE_DEGREES;
      return true;
    }
    if (numeric == ANGLE_MODE_RADIANS) {
      *angleModeOut = ANGLE_MODE_RADIANS;
      return true;
    }
  }

  return false;
}

double ToRadiansForRuntime(JsHostRuntime* runtime, double angle) {
  if (runtime && runtime->angleMode == ANGLE_MODE_DEGREES) {
    return angle * (3.14159265358979323846 / 180.0);
  }
  return angle;
}

bool ReadColorArray(JSContextRef ctx, JSValueRef value, double channels[4], int* count) {
  if (!JSValueIsObject(ctx, value)) {
    return false;
  }

  JSObjectRef object = JSValueToObject(ctx, value, NULL);
  if (!object) {
    return false;
  }

  int found = 0;
  for (int index = 0; index < 4; index += 1) {
    const std::string keyString = std::to_string(index);
    JSStringRef key = JSStringCreateWithUTF8CString(keyString.c_str());
    JSValueRef channelValue = JSObjectGetProperty(ctx, object, key, NULL);
    JSStringRelease(key);
    double numeric = 0.0;
    if (!channelValue || !JsValueToNumberSafe(ctx, channelValue, numeric)) {
      break;
    }
    channels[index] = numeric;
    found += 1;
  }

  if (found > 0) {
    if (count) {
      *count = found;
    }
    return true;
  }

  const char* keys[] = {"r", "g", "b", "a"};
  for (int index = 0; index < 4; index += 1) {
    JSStringRef key = JSStringCreateWithUTF8CString(keys[index]);
    JSValueRef channelValue = JSObjectGetProperty(ctx, object, key, NULL);
    JSStringRelease(key);
    double numeric = 0.0;
    if (!channelValue || !JsValueToNumberSafe(ctx, channelValue, numeric)) {
      if (index < 3) {
        return false;
      }
      break;
    }
    channels[index] = numeric;
    found = index + 1;
  }

  if (found >= 3) {
    if (count) {
      *count = found;
    }
    return true;
  }

  return false;
}

PF_Pixel HsbToRgb(double hue, double saturation, double brightness, double alpha) {
  const double h = std::fmod(std::max(0.0, hue), 255.0) / 255.0 * 360.0;
  const double s = std::max(0.0, std::min(255.0, saturation)) / 255.0;
  const double v = std::max(0.0, std::min(255.0, brightness)) / 255.0;
  const double c = v * s;
  const double x = c * (1.0 - std::fabs(std::fmod(h / 60.0, 2.0) - 1.0));
  const double m = v - c;

  double r = 0.0;
  double g = 0.0;
  double b = 0.0;
  if (h < 60.0) {
    r = c;
    g = x;
  } else if (h < 120.0) {
    r = x;
    g = c;
  } else if (h < 180.0) {
    g = c;
    b = x;
  } else if (h < 240.0) {
    g = x;
    b = c;
  } else if (h < 300.0) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  PF_Pixel color;
  color.alpha = static_cast<A_u_char>(std::round(std::max(0.0, std::min(255.0, alpha))));
  color.red = static_cast<A_u_char>(std::round((r + m) * 255.0));
  color.green = static_cast<A_u_char>(std::round((g + m) * 255.0));
  color.blue = static_cast<A_u_char>(std::round((b + m) * 255.0));
  return color;
}

int ParseShapeMode(JSContextRef ctx, JSValueRef value, int fallbackMode) {
  long numeric = fallbackMode;
  if (!JsValueToLongSafe(ctx, value, numeric)) {
    return fallbackMode;
  }

  switch (numeric) {
    case SHAPE_MODE_CORNER:
    case SHAPE_MODE_CORNERS:
    case SHAPE_MODE_CENTER:
    case SHAPE_MODE_RADIUS:
      return static_cast<int>(numeric);
    default:
      return fallbackMode;
  }
}

int ParseStrokeCapMode(JSContextRef ctx, JSValueRef value, int fallbackMode) {
  long numeric = fallbackMode;
  if (!JsValueToLongSafe(ctx, value, numeric)) {
    return fallbackMode;
  }

  switch (numeric) {
    case STROKE_CAP_ROUND:
    case STROKE_CAP_SQUARE:
    case STROKE_CAP_PROJECT:
      return static_cast<int>(numeric);
    default:
      return fallbackMode;
  }
}

int ParseStrokeJoinMode(JSContextRef ctx, JSValueRef value, int fallbackMode) {
  long numeric = fallbackMode;
  if (!JsValueToLongSafe(ctx, value, numeric)) {
    return fallbackMode;
  }

  switch (numeric) {
    case STROKE_JOIN_MITER:
    case STROKE_JOIN_BEVEL:
    case STROKE_JOIN_ROUND:
      return static_cast<int>(numeric);
    case STROKE_CAP_ROUND:
      return STROKE_JOIN_ROUND;
    default:
      return fallbackMode;
  }
}

int ParseArcMode(JSContextRef ctx, JSValueRef value, int fallbackMode) {
  long numeric = fallbackMode;
  if (!JsValueToLongSafe(ctx, value, numeric)) {
    return fallbackMode;
  }

  switch (numeric) {
    case ARC_MODE_OPEN:
    case ARC_MODE_CHORD:
    case ARC_MODE_PIE:
      return static_cast<int>(numeric);
    default:
      return fallbackMode;
  }
}

int ParseBeginShapeKind(JSContextRef ctx, JSValueRef value, int fallbackKind) {
  long numeric = fallbackKind;
  if (!JsValueToLongSafe(ctx, value, numeric)) {
    return fallbackKind;
  }

  switch (numeric) {
    case BEGIN_SHAPE_POINTS:
    case BEGIN_SHAPE_LINES:
    case BEGIN_SHAPE_TRIANGLES:
    case BEGIN_SHAPE_TRIANGLE_FAN:
    case BEGIN_SHAPE_TRIANGLE_STRIP:
    case BEGIN_SHAPE_QUADS:
    case BEGIN_SHAPE_QUAD_STRIP:
    case BEGIN_SHAPE_TESS:
      return static_cast<int>(numeric);
    default:
      return fallbackKind;
  }
}

void NormalizeRectArgs(int mode, double* x, double* y, double* width, double* height) {
  if (!x || !y || !width || !height) {
    return;
  }

  switch (mode) {
    case SHAPE_MODE_CENTER:
      *x -= (*width) * 0.5;
      *y -= (*height) * 0.5;
      break;
    case SHAPE_MODE_RADIUS:
      *x -= *width;
      *y -= *height;
      *width *= 2.0;
      *height *= 2.0;
      break;
    case SHAPE_MODE_CORNERS: {
      const double x1 = *x;
      const double y1 = *y;
      const double x2 = *width;
      const double y2 = *height;
      *x = std::min(x1, x2);
      *y = std::min(y1, y2);
      *width = std::fabs(x2 - x1);
      *height = std::fabs(y2 - y1);
      break;
    }
    default:
      break;
  }
}

void NormalizeEllipseArgs(int mode, double* x, double* y, double* width, double* height) {
  if (!x || !y || !width || !height) {
    return;
  }

  switch (mode) {
    case SHAPE_MODE_CORNER:
      *x += (*width) * 0.5;
      *y += (*height) * 0.5;
      break;
    case SHAPE_MODE_CORNERS: {
      const double x1 = *x;
      const double y1 = *y;
      const double x2 = *width;
      const double y2 = *height;
      *x = (x1 + x2) * 0.5;
      *y = (y1 + y2) * 0.5;
      *width = std::fabs(x2 - x1);
      *height = std::fabs(y2 - y1);
      break;
    }
    case SHAPE_MODE_RADIUS:
      *width *= 2.0;
      *height *= 2.0;
      break;
    default:
      break;
  }
}

SceneCommand MakePointCommandFromVertex(const VertexSpec& vertex) {
  SceneCommand command;
  command.type = "point";
  command.x = vertex.x;
  command.y = vertex.y;
  return command;
}

SceneCommand MakeLineCommandFromVertices(const VertexSpec& start, const VertexSpec& end) {
  SceneCommand command;
  command.type = "line";
  command.x1 = start.x;
  command.y1 = start.y;
  command.x2 = end.x;
  command.y2 = end.y;
  return command;
}

VertexSpec MakeVertexSpec(double x, double y) {
  VertexSpec vertex;
  vertex.x = {"pixels", x};
  vertex.y = {"pixels", y};
  return vertex;
}

std::pair<double, double> VertexToPair(const VertexSpec& vertex) {
  return std::make_pair(vertex.x.value, vertex.y.value);
}

SceneCommand MakePathCommandFromPath(const VectorPath& path) {
  SceneCommand command;
  command.type = "path";
  command.path = path;
  return command;
}

PathSegment MakeMoveToSegment(double x, double y) {
  PathSegment segment;
  segment.type = PATH_SEGMENT_MOVE_TO;
  segment.point = MakeVertexSpec(x, y);
  return segment;
}

PathSegment MakeLineToSegment(double x, double y) {
  PathSegment segment;
  segment.type = PATH_SEGMENT_LINE_TO;
  segment.point = MakeVertexSpec(x, y);
  return segment;
}

PathSegment MakeQuadraticToSegment(double cx, double cy, double x, double y) {
  PathSegment segment;
  segment.type = PATH_SEGMENT_QUADRATIC_TO;
  segment.control1 = MakeVertexSpec(cx, cy);
  segment.point = MakeVertexSpec(x, y);
  return segment;
}

PathSegment MakeCubicToSegment(double cx1, double cy1, double cx2, double cy2, double x, double y) {
  PathSegment segment;
  segment.type = PATH_SEGMENT_CUBIC_TO;
  segment.control1 = MakeVertexSpec(cx1, cy1);
  segment.control2 = MakeVertexSpec(cx2, cy2);
  segment.point = MakeVertexSpec(x, y);
  return segment;
}

PathSegment MakeCloseSegment() {
  PathSegment segment;
  segment.type = PATH_SEGMENT_CLOSE;
  return segment;
}

void AppendCurvePathSegment(
  PathSubpath* subpath,
  const VertexSpec& p0,
  const VertexSpec& p1,
  const VertexSpec& p2,
  const VertexSpec& p3,
  double tightness
) {
  if (!subpath) {
    return;
  }

  const std::pair<double, double> a = VertexToPair(p0);
  const std::pair<double, double> b = VertexToPair(p1);
  const std::pair<double, double> c = VertexToPair(p2);
  const std::pair<double, double> d = VertexToPair(p3);
  const double scale = (1.0 - tightness) * 0.5;
  const double m1x = (c.first - a.first) * scale;
  const double m1y = (c.second - a.second) * scale;
  const double m2x = (d.first - b.first) * scale;
  const double m2y = (d.second - b.second) * scale;

  if (subpath->segments.empty()) {
    subpath->segments.push_back(MakeMoveToSegment(b.first, b.second));
  }
  subpath->segments.push_back(MakeCubicToSegment(
    b.first + m1x / 3.0,
    b.second + m1y / 3.0,
    c.first - m2x / 3.0,
    c.second - m2y / 3.0,
    c.first,
    c.second
  ));
}

void ApplyCurrentStyle(SceneCommand* command) {
  if (!command || !g_activeRuntime) {
    return;
  }

  if (g_activeRuntime->hasFill) {
    command->fill = g_activeRuntime->currentFill;
    command->hasFill = true;
  }
  if (g_activeRuntime->hasStroke) {
    command->stroke = g_activeRuntime->currentStroke;
    command->hasStroke = true;
  }
  command->strokeWeight = g_activeRuntime->strokeWeight;
  command->strokeCap = g_activeRuntime->strokeCap;
  command->strokeJoin = g_activeRuntime->strokeJoin;
  command->blendMode = g_activeRuntime->blendMode;
  command->clipPath = g_activeRuntime->clipCapturing;
  command->clipInvert = g_activeRuntime->clipInvert;
  if (g_activeRuntime->eraseActive) {
    command->eraseFill = command->hasFill;
    command->eraseStroke = command->hasStroke;
    command->eraseFillStrength = g_activeRuntime->eraseFillStrength;
    command->eraseStrokeStrength = g_activeRuntime->eraseStrokeStrength;
  }
  command->transform = g_activeRuntime->currentTransform;
}

PathSubpath BuildArcSubpath(
  double cx,
  double cy,
  double width,
  double height,
  double start,
  double stop,
  bool includeCenter
) {
  PathSubpath subpath;
  const double rx = std::max(0.0, width * 0.5);
  const double ry = std::max(0.0, height * 0.5);
  if (rx <= 0.0 || ry <= 0.0) {
    return subpath;
  }

  const double sweep = stop - start;
  if (std::fabs(sweep) < 1e-9) {
    return subpath;
  }

  const double startX = cx + std::cos(start) * rx;
  const double startY = cy + std::sin(start) * ry;
  if (includeCenter) {
    subpath.segments.push_back(MakeMoveToSegment(cx, cy));
    subpath.segments.push_back(MakeLineToSegment(startX, startY));
  } else {
    subpath.segments.push_back(MakeMoveToSegment(startX, startY));
  }

  const int pieces = std::max(1, static_cast<int>(std::ceil(std::fabs(sweep) / kBezierArcMaxSweep)));
  for (int index = 0; index < pieces; ++index) {
    const double pieceStart = start + sweep * (static_cast<double>(index) / static_cast<double>(pieces));
    const double pieceStop = start + sweep * (static_cast<double>(index + 1) / static_cast<double>(pieces));
    AppendCubicArcSegment(&subpath, cx, cy, rx, ry, pieceStart, pieceStop);
  }

  if (includeCenter) {
    subpath.segments.push_back(MakeCloseSegment());
  }
  return subpath;
}

PathSubpath BuildRoundedRectSubpath(
  double x,
  double y,
  double width,
  double height,
  double tl,
  double tr,
  double br,
  double bl
) {
  PathSubpath subpath;
  if (width <= 0.0 || height <= 0.0) {
    return subpath;
  }

  const double maxRadius = std::max(0.0, std::min(width, height) * 0.5);
  tl = std::min(std::max(0.0, tl), maxRadius);
  tr = std::min(std::max(0.0, tr), maxRadius);
  br = std::min(std::max(0.0, br), maxRadius);
  bl = std::min(std::max(0.0, bl), maxRadius);

  subpath.segments.push_back(MakeMoveToSegment(x + tl, y));
  subpath.segments.push_back(MakeLineToSegment(x + width - tr, y));
  if (tr > 0.0) {
    AppendCubicArcSegment(&subpath, x + width - tr, y + tr, tr, tr, -M_PI * 0.5, 0.0);
  } else {
    subpath.segments.push_back(MakeLineToSegment(x + width, y));
  }

  subpath.segments.push_back(MakeLineToSegment(x + width, y + height - br));
  if (br > 0.0) {
    AppendCubicArcSegment(&subpath, x + width - br, y + height - br, br, br, 0.0, M_PI * 0.5);
  } else {
    subpath.segments.push_back(MakeLineToSegment(x + width, y + height));
  }

  subpath.segments.push_back(MakeLineToSegment(x + bl, y + height));
  if (bl > 0.0) {
    AppendCubicArcSegment(&subpath, x + bl, y + height - bl, bl, bl, M_PI * 0.5, M_PI);
  } else {
    subpath.segments.push_back(MakeLineToSegment(x, y + height));
  }

  subpath.segments.push_back(MakeLineToSegment(x, y + tl));
  if (tl > 0.0) {
    AppendCubicArcSegment(&subpath, x + tl, y + tl, tl, tl, M_PI, M_PI * 1.5);
  } else {
    subpath.segments.push_back(MakeLineToSegment(x, y));
  }
  subpath.segments.push_back(MakeCloseSegment());
  return subpath;
}

PathSubpath BuildRectSubpath(double x, double y, double width, double height) {
  PathSubpath subpath;
  subpath.segments.push_back(MakeMoveToSegment(x, y));
  subpath.segments.push_back(MakeLineToSegment(x + width, y));
  subpath.segments.push_back(MakeLineToSegment(x + width, y + height));
  subpath.segments.push_back(MakeLineToSegment(x, y + height));
  subpath.segments.push_back(MakeCloseSegment());
  return subpath;
}

PathSubpath BuildEllipseSubpath(double cx, double cy, double width, double height) {
  PathSubpath subpath;
  const double rx = std::max(0.0, width * 0.5);
  const double ry = std::max(0.0, height * 0.5);
  if (rx <= 0.0 || ry <= 0.0) {
    return subpath;
  }

  subpath.segments.push_back(MakeMoveToSegment(cx + rx, cy));
  AppendCubicArcSegment(&subpath, cx, cy, rx, ry, 0.0, M_PI * 0.5);
  AppendCubicArcSegment(&subpath, cx, cy, rx, ry, M_PI * 0.5, M_PI);
  AppendCubicArcSegment(&subpath, cx, cy, rx, ry, M_PI, M_PI * 1.5);
  AppendCubicArcSegment(&subpath, cx, cy, rx, ry, M_PI * 1.5, M_PI * 2.0);
  subpath.segments.push_back(MakeCloseSegment());
  return subpath;
}

PF_Pixel ParseColorArgs(
  JSContextRef ctx,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  const PF_Pixel& fallback
) {
  PF_Pixel color = fallback;
  if (argumentCount == 0) {
    return color;
  }

  if (argumentCount == 1) {
    if (JSValueIsString(ctx, arguments[0])) {
      PF_Pixel parsedColor;
      if (ParseCssColorString(JsValueToStdString(ctx, arguments[0]), &parsedColor)) {
        return parsedColor;
      }
    }

    double channels[4] = {0.0, 0.0, 0.0, 255.0};
    int count = 0;
    if (ReadColorArray(ctx, arguments[0], channels, &count)) {
      const bool normalizedArray =
        count >= 3 &&
        channels[0] >= 0.0 && channels[0] <= 1.0 &&
        channels[1] >= 0.0 && channels[1] <= 1.0 &&
        channels[2] >= 0.0 && channels[2] <= 1.0 &&
        (count <= 3 || (channels[3] >= 0.0 && channels[3] <= 1.0));
      const double scale = normalizedArray ? 255.0 : 1.0;
      color.red = static_cast<A_u_char>(std::round(std::max(0.0, std::min(255.0, channels[0] * scale))));
      color.green = static_cast<A_u_char>(std::round(std::max(0.0, std::min(255.0, channels[1] * scale))));
      color.blue = static_cast<A_u_char>(std::round(std::max(0.0, std::min(255.0, channels[2] * scale))));
      color.alpha = static_cast<A_u_char>(std::round(std::max(0.0, std::min(255.0, (count > 3 ? channels[3] : (normalizedArray ? 1.0 : 255.0)) * scale))));
      return color;
    }
  }

  if (JSValueIsString(ctx, arguments[0])) {
    PF_Pixel parsedColor;
    if (ParseCssColorString(JsValueToStdString(ctx, arguments[0]), &parsedColor)) {
      color = parsedColor;
      if (argumentCount > 1) {
        double alpha = static_cast<double>(parsedColor.alpha);
        if (JsValueToNumberSafe(ctx, arguments[1], alpha)) {
          color.alpha = static_cast<A_u_char>(std::round(std::max(0.0, std::min(255.0, alpha))));
        }
      }
      return color;
    }
  }

  double value = 0.0;
  if (argumentCount == 1) {
    if (JsValueToNumberSafe(ctx, arguments[0], value)) {
      const A_u_char gray = static_cast<A_u_char>(std::round(std::max(0.0, std::min(255.0, value))));
      color.red = gray;
      color.green = gray;
      color.blue = gray;
      color.alpha = 255;
    }
    return color;
  }

  if (argumentCount == 2) {
    double gray = 0.0;
    double alpha = 255.0;
    if (JsValueToNumberSafe(ctx, arguments[0], gray)) {
      const A_u_char channel = static_cast<A_u_char>(std::round(std::max(0.0, std::min(255.0, gray))));
      color.red = channel;
      color.green = channel;
      color.blue = channel;
    }
    if (JsValueToNumberSafe(ctx, arguments[1], alpha)) {
      color.alpha = static_cast<A_u_char>(std::round(std::max(0.0, std::min(255.0, alpha))));
    } else {
      color.alpha = 255;
    }
    return color;
  }

  if (JsValueToNumberSafe(ctx, arguments[0], value)) {
    color.red = static_cast<A_u_char>(std::round(std::max(0.0, std::min(255.0, value))));
  }
  if (argumentCount > 1 && JsValueToNumberSafe(ctx, arguments[1], value)) {
    color.green = static_cast<A_u_char>(std::round(std::max(0.0, std::min(255.0, value))));
  }
  if (argumentCount > 2 && JsValueToNumberSafe(ctx, arguments[2], value)) {
    color.blue = static_cast<A_u_char>(std::round(std::max(0.0, std::min(255.0, value))));
  }
  if (argumentCount > 3 && JsValueToNumberSafe(ctx, arguments[3], value)) {
    color.alpha = static_cast<A_u_char>(std::round(std::max(0.0, std::min(255.0, value))));
  } else {
    color.alpha = 255;
  }

  return color;
}

bool ReadNumericArgs(
  JSContextRef ctx,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  std::size_t requiredCount,
  std::vector<double>& out
) {
  if (argumentCount < requiredCount) {
    return false;
  }

  out.clear();
  out.reserve(argumentCount);
  for (std::size_t i = 0; i < argumentCount; ++i) {
    double numeric = 0.0;
    if (!JsValueToNumberSafe(ctx, arguments[i], numeric)) {
      return false;
    }
    out.push_back(numeric);
  }
  return true;
}

double NextRandomUnit(JsHostRuntime* runtime) {
  if (!runtime) {
    return 0.0;
  }

  runtime->randomState = runtime->randomState * 1664525UL + 1013904223UL;
  return static_cast<double>(runtime->randomState & 0x00FFFFFFUL) / static_cast<double>(0x01000000UL);
}

}
