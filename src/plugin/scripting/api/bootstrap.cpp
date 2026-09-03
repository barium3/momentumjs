#include "scripting/api/callbacks.h"
#include "scripting/api/bootstrap_scripts.h"

#include <filesystem>
#include <fstream>
#include <iomanip>
#include <mutex>
#include <sstream>
#include <string>

namespace momentum {

namespace {

struct JsCallbackRegistration {
  const char* name;
  JSObjectCallAsFunctionCallback callback;
};

std::mutex gRuntimeDebugTraceMutex;
constexpr std::uintmax_t kRuntimeDebugTraceLimitBytes = 512U * 1024U;

std::string SanitizeDebugTraceText(const std::string& value) {
  std::string sanitized;
  sanitized.reserve(value.size());
  for (char current : value) {
    if (current == '\r' || current == '\n') {
      if (sanitized.empty() || sanitized.back() != ' ') {
        sanitized.push_back(' ');
      }
      continue;
    }
    sanitized.push_back(current);
  }

  while (!sanitized.empty() && sanitized.back() == ' ') {
    sanitized.pop_back();
  }
  return sanitized;
}

std::string ResolveRuntimeDebugTracePath(const JsHostRuntime* runtime) {
  if (runtime && !runtime->debugTracePath.empty()) {
    return runtime->debugTracePath;
  }
  const std::string runtimeDirectory = runtime_internal::GetRuntimeDirectoryPath();
  return runtimeDirectory.empty() ? std::string() : runtimeDirectory + "/debug_trace.log";
}

void AppendRuntimeDebugTraceLine(
  const JsHostRuntime* runtime,
  const std::string& level,
  const std::string& message
) {
  const std::string logPath = ResolveRuntimeDebugTracePath(runtime);
  if (logPath.empty()) {
    return;
  }

  const std::lock_guard<std::mutex> lock(gRuntimeDebugTraceMutex);
  std::error_code sizeError;
  const std::uintmax_t currentSize = std::filesystem::file_size(
    logPath,
    sizeError
  );
  if (!sizeError && currentSize > kRuntimeDebugTraceLimitBytes) {
    std::ofstream resetStream(
      logPath.c_str(),
      std::ios::out | std::ios::trunc
    );
    if (!resetStream.is_open()) {
      return;
    }
  }

  std::ofstream stream(logPath.c_str(), std::ios::out | std::ios::app);
  if (!stream.is_open()) {
    return;
  }

  std::ostringstream line;
  line << "frame=" << (runtime ? runtime->currentFrameCount : 0);
  line << " time=" << std::fixed << std::setprecision(3)
       << (runtime ? runtime->currentTimeSeconds : 0.0);
  line << " level=" << SanitizeDebugTraceText(level);
  line << " message=" << SanitizeDebugTraceText(message);

  stream << line.str() << '\n';
}

constexpr JsCallbackRegistration kRuntimeCallbackRegistrations[] = {
  {"createCanvas", JsCreateCanvas},
  {"frameRate", JsFrameRate},
  {"isLooping", JsIsLooping},
  {"loop", JsLoop},
  {"noLoop", JsNoLoop},
  {"redraw", JsRedraw},
  {"background", JsBackground},
  {"clear", JsClear},
  {"fill", JsFill},
  {"stroke", JsStroke},
  {"colorMode", JsColorMode},
  {"color", JsColor},
  {"noFill", JsNoFill},
  {"noStroke", JsNoStroke},
  {"strokeWeight", JsStrokeWeight},
  {"strokeCap", JsStrokeCap},
  {"strokeJoin", JsStrokeJoin},
  {"blendMode", JsBlendMode},
  {"erase", JsErase},
  {"noErase", JsNoErase},
  {"beginClip", JsBeginClip},
  {"endClip", JsEndClip},
  {"randomSeed", JsRandomSeed},
  {"random", JsRandom},
  {"randomGaussian", JsRandomGaussian},
  {"noise", JsNoise},
  {"noiseDetail", JsNoiseDetail},
  {"noiseSeed", JsNoiseSeed},
  {"angleMode", JsAngleMode},
  {"translate", JsTranslate},
  {"rotate", JsRotate},
  {"scale", JsScale},
  {"applyMatrix", JsApplyMatrix},
  {"resetMatrix", JsResetMatrix},
  {"text", JsText},
  {"textSize", JsTextSize},
  {"textLeading", JsTextLeading},
  {"textFont", JsTextFont},
  {"textStyle", JsTextStyle},
  {"textWrap", JsTextWrap},
  {"textAlign", JsTextAlign},
  {"textWidth", JsTextWidth},
  {"textAscent", JsTextAscent},
  {"textDescent", JsTextDescent},
  {"image", JsImage},
  {"imageMode", JsImageMode},
  {"pixelDensity", JsPixelDensity},
  {"tint", JsTint},
  {"noTint", JsNoTint},
  {"createImage", JsMomentumNativeCreateImage},
  {"__momentumNativeLoadFont", JsMomentumNativeLoadFont},
  {"__momentumNativeFontTextBounds", JsMomentumNativeFontTextBounds},
  {"__momentumNativeFontTextToPoints", JsMomentumNativeFontTextToPoints},
  {"__momentumNativeLoadImage", JsMomentumNativeLoadImage},
  {"__momentumNativeLoadJSON", JsMomentumNativeLoadJSON},
  {"__momentumNativeLoadStrings", JsMomentumNativeLoadStrings},
  {"__momentumNativeLoadBytes", JsMomentumNativeLoadBytes},
  {"__momentumNativeLoadXML", JsMomentumNativeLoadXML},
  {"__momentumNativeLoadTable", JsMomentumNativeLoadTable},
  {"__momentumNativeBackgroundImage", JsMomentumNativeBackgroundImage},
  {"__momentumNativeImageLoadPixels", JsMomentumNativeImageLoadPixels},
  {"__momentumNativeImageUpdatePixels", JsMomentumNativeImageUpdatePixels},
  {"__momentumNativeImageClone", JsMomentumNativeImageClone},
  {"__momentumNativeImageGetPixel", JsMomentumNativeImageGetPixel},
  {"__momentumNativeImageGetRegion", JsMomentumNativeImageGetRegion},
  {"__momentumNativeImageSetColor", JsMomentumNativeImageSetColor},
  {"__momentumNativeImageSetImage", JsMomentumNativeImageSetImage},
  {"__momentumNativeImageResize", JsMomentumNativeImageResize},
  {"__momentumNativeImageMask", JsMomentumNativeImageMask},
  {"__momentumNativeImageCopy", JsMomentumNativeImageCopy},
  {"__momentumNativeImageBlend", JsMomentumNativeImageBlend},
  {"__momentumNativeImageFilter", JsMomentumNativeImageFilter},
  {"__momentumNativeCanvasImage", JsMomentumNativeCanvasImage},
  {"__momentumNativeCreateGraphics", JsMomentumNativeCreateGraphics},
  {"__momentumNativeEnterGraphics", JsMomentumNativeEnterGraphics},
  {"__momentumNativeExitGraphics", JsMomentumNativeExitGraphics},
  {"__momentumNativePrepareGraphicsBitmap", JsMomentumNativePrepareGraphicsBitmap},
  {"__momentumNativeCommitGraphicsBitmap", JsMomentumNativeCommitGraphicsBitmap},
  {"__momentumNativeDebugLog", JsMomentumNativeDebugLog},
  {"rectMode", JsRectMode},
  {"ellipseMode", JsEllipseMode},
  {"push", JsPush},
  {"pop", JsPop},
  {"ellipse", JsEllipse},
  {"arc", JsArc},
  {"circle", JsCircle},
  {"rect", JsRect},
  {"square", JsSquare},
  {"triangle", JsTriangle},
  {"quad", JsQuad},
  {"line", JsLine},
  {"point", JsPoint},
  {"beginShape", JsBeginShape},
  {"vertex", JsVertex},
  {"bezierVertex", JsBezierVertex},
  {"quadraticVertex", JsQuadraticVertex},
  {"curveVertex", JsCurveVertex},
  {"endShape", JsEndShape},
  {"bezier", JsBezier},
  {"curve", JsCurve},
  {"beginContour", JsBeginContour},
  {"endContour", JsEndContour},
  {"curveTightness", JsCurveTightness},
};

void InstallJsCallback(
  JSContextRef ctx,
  JSObjectRef globalObject,
  const char* name,
  JSObjectCallAsFunctionCallback callback
) {
  JSStringRef functionName = JSStringCreateWithUTF8CString(name);
  JSObjectRef function = JSObjectMakeFunctionWithCallback(ctx, functionName, callback);
  JSObjectSetProperty(
    ctx,
    globalObject,
    functionName,
    function,
    kJSPropertyAttributeNone,
    NULL
  );
  JSStringRelease(functionName);
}

void InstallRuntimeCallbacks(JSContextRef ctx, JSObjectRef globalObject) {
  for (const JsCallbackRegistration& registration : kRuntimeCallbackRegistrations) {
    InstallJsCallback(ctx, globalObject, registration.name, registration.callback);
  }
}

std::string BuildBootstrapSource() {
  const char* foundation = BootstrapFoundationScript();
  const char* p5Compat = BootstrapP5CompatScript();
  const char* stateCapture = BootstrapStateCaptureScript();
  std::string source;
  source.reserve(
    std::char_traits<char>::length(foundation) +
    std::char_traits<char>::length(GetDataBootstrapScript()) +
    std::char_traits<char>::length(p5Compat) +
    std::char_traits<char>::length(stateCapture) +
    std::char_traits<char>::length(GetIoBootstrapScript()) +
    std::char_traits<char>::length(GetControllerBootstrapScript())
  );
  source.append(foundation);
  source.append(GetDataBootstrapScript());
  source.append(p5Compat);
  source.append(stateCapture);
  source.append(GetIoBootstrapScript());
  source.append(GetControllerBootstrapScript());
  return source;
}

void EvaluateBootstrapSource(JSContextRef ctx, const std::string& source) {
  JSStringRef script = JSStringCreateWithUTF8CString(source.c_str());
  JSStringRef sourceURL = JSStringCreateWithUTF8CString("momentum-bootstrap");
  JSValueRef exception = NULL;
  JSEvaluateScript(ctx, script, NULL, sourceURL, 0, &exception);
  JSStringRelease(sourceURL);
  JSStringRelease(script);
  (void)exception;
}

}  // namespace

JSValueRef JsMomentumNativeDebugLog(
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

  std::string level = "log";
  std::string message;
  if (argumentCount > 0) {
    level = JsValueToStdString(ctx, arguments[0]);
  }
  if (argumentCount > 1) {
    message = JsValueToStdString(ctx, arguments[1]);
  } else if (argumentCount > 0) {
    message = level;
    level = "log";
  }

  AppendRuntimeDebugTraceLine(g_activeRuntime, level, message);
  return JSValueMakeUndefined(ctx);
}

void SetJsNumber(JSContextRef ctx, JSObjectRef object, const char* name, double value) {
  JSStringRef key = JSStringCreateWithUTF8CString(name);
  JSObjectSetProperty(
    ctx,
    object,
    key,
    JSValueMakeNumber(ctx, value),
    kJSPropertyAttributeNone,
    NULL
  );
  JSStringRelease(key);
}

void InstallRuntimeBootstrap(JSContextRef ctx, JSObjectRef globalObject) {
  InstallRuntimeCallbacks(ctx, globalObject);
  EvaluateBootstrapSource(ctx, BuildBootstrapSource());
}

}  // namespace momentum
