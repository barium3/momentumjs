#include "api_internal.h"

#include <algorithm>
#include <cmath>

namespace momentum {

namespace {

int NormalizeBlendModeValue(long value, int fallback) {
  switch (value) {
    case BLEND_MODE_BLEND:
    case BLEND_MODE_ADD:
    case BLEND_MODE_DARKEST:
    case BLEND_MODE_LIGHTEST:
    case BLEND_MODE_DIFFERENCE:
    case BLEND_MODE_EXCLUSION:
    case BLEND_MODE_MULTIPLY:
    case BLEND_MODE_SCREEN:
    case BLEND_MODE_REPLACE:
    case BLEND_MODE_REMOVE:
    case BLEND_MODE_OVERLAY:
    case BLEND_MODE_HARD_LIGHT:
    case BLEND_MODE_SOFT_LIGHT:
    case BLEND_MODE_DODGE:
    case BLEND_MODE_BURN:
      return static_cast<int>(value);
    default:
      return fallback;
  }
}

double NormalizeEraseStrength(double value) {
  if (!std::isfinite(value) || std::isnan(value)) {
    return 1.0;
  }
  return std::max(0.0, std::min(1.0, value / 255.0));
}

bool ReadClipInvertOption(JSContextRef ctx, JSValueRef value, bool fallback) {
  if (!value || JSValueIsUndefined(ctx, value) || JSValueIsNull(ctx, value)) {
    return fallback;
  }

  if (JSValueIsBoolean(ctx, value)) {
    return JSValueToBoolean(ctx, value);
  }

  if (!JSValueIsObject(ctx, value)) {
    return fallback;
  }

  JSObjectRef object = JSValueToObject(ctx, value, NULL);
  if (!object) {
    return fallback;
  }

  JSStringRef invertKey = JSStringCreateWithUTF8CString("invert");
  JSValueRef invertValue = JSObjectGetProperty(ctx, object, invertKey, NULL);
  JSStringRelease(invertKey);
  if (!invertValue || JSValueIsUndefined(ctx, invertValue) || JSValueIsNull(ctx, invertValue)) {
    return fallback;
  }
  return JSValueToBoolean(ctx, invertValue);
}

}  // namespace

JSValueRef JsBackground(
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
    return JSValueMakeUndefined(ctx);
  }

  const PF_Pixel color = ParseColorArgs(
    ctx,
    argumentCount,
    arguments,
    g_activeRuntime->scene.background
  );
  g_activeRuntime->scene.hasBackground = true;
  g_activeRuntime->scene.background = color;
  if (!g_activeRuntime->eraseActive &&
      g_activeRuntime->blendMode == BLEND_MODE_BLEND &&
      color.alpha >= 255) {
    g_activeRuntime->scene.clearsSurface = true;
  }

  SceneCommand command;
  command.type = "background";
  command.hasFill = true;
  command.fill = color;
  command.hasStroke = false;
  command.blendMode = g_activeRuntime->blendMode;
  command.transform = MakeIdentityTransform();
  if (g_activeRuntime->eraseActive) {
    command.eraseFill = true;
    command.eraseFillStrength = g_activeRuntime->eraseFillStrength;
  }
  AppendSceneCommand(g_activeRuntime, command);
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsFill(
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
    return JSValueMakeUndefined(ctx);
  }

  g_activeRuntime->currentFill = ParseColorArgs(ctx, argumentCount, arguments, g_activeRuntime->currentFill);
  g_activeRuntime->hasFill = true;
  g_activeRuntime->fillExplicit = true;
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsStroke(
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
    return JSValueMakeUndefined(ctx);
  }

  g_activeRuntime->currentStroke = ParseColorArgs(ctx, argumentCount, arguments, g_activeRuntime->currentStroke);
  g_activeRuntime->hasStroke = true;
  g_activeRuntime->strokeExplicit = true;
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsClear(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)ctx;
  (void)function;
  (void)thisObject;
  (void)argumentCount;
  (void)arguments;
  (void)exception;
  if (!g_activeRuntime) {
    return JSValueMakeUndefined(ctx);
  }

  g_activeRuntime->scene.clearsSurface = true;
  g_activeRuntime->scene.hasBackground = false;
  g_activeRuntime->scene.background = PF_Pixel{0, 0, 0, 0};
  SceneCommand command;
  command.type = "clear";
  AppendSceneCommand(g_activeRuntime, command);
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsColorMode(
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
    return JSValueMakeUndefined(ctx);
  }

  long mode = COLOR_MODE_RGB;
  if (JsValueToLongSafe(ctx, arguments[0], mode) && mode == COLOR_MODE_HSB) {
    g_activeRuntime->colorMode = COLOR_MODE_HSB;
  } else {
    g_activeRuntime->colorMode = COLOR_MODE_RGB;
  }
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsColor(
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
  PF_Pixel color = {255, 255, 255, 255};
  if (g_activeRuntime && g_activeRuntime->colorMode == COLOR_MODE_HSB && argumentCount >= 3) {
    double hue = 0.0;
    double saturation = 0.0;
    double brightness = 0.0;
    double alpha = 255.0;
    if (
      JsValueToNumberSafe(ctx, arguments[0], hue) &&
      JsValueToNumberSafe(ctx, arguments[1], saturation) &&
      JsValueToNumberSafe(ctx, arguments[2], brightness)
    ) {
      if (argumentCount > 3) {
        JsValueToNumberSafe(ctx, arguments[3], alpha);
      }
      color = HsbToRgb(hue, saturation, brightness, alpha);
    }
  } else {
    color = ParseColorArgs(ctx, argumentCount, arguments, color);
  }

  JSObjectRef array = JSObjectMakeArray(ctx, 0, NULL, NULL);
  const double channels[] = {
    static_cast<double>(color.red),
    static_cast<double>(color.green),
    static_cast<double>(color.blue),
    static_cast<double>(color.alpha),
  };
  for (int index = 0; index < 4; index += 1) {
    JSObjectSetPropertyAtIndex(ctx, array, static_cast<unsigned>(index), JSValueMakeNumber(ctx, channels[index]), NULL);
  }
  return array;
}

JSValueRef JsNoFill(
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
  if (g_activeRuntime) {
    g_activeRuntime->hasFill = false;
    g_activeRuntime->fillExplicit = true;
  }
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsNoStroke(
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
  if (g_activeRuntime) {
    g_activeRuntime->hasStroke = false;
    g_activeRuntime->strokeExplicit = true;
  }
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsStrokeWeight(
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
    return JSValueMakeUndefined(ctx);
  }

  double weight = 1.0;
  if (JsValueToNumberSafe(ctx, arguments[0], weight)) {
    g_activeRuntime->strokeWeight = weight;
  }
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsStrokeCap(
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
    return JSValueMakeUndefined(ctx);
  }

  g_activeRuntime->strokeCap = ParseStrokeCapMode(ctx, arguments[0], g_activeRuntime->strokeCap);
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsStrokeJoin(
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
    return JSValueMakeUndefined(ctx);
  }

  g_activeRuntime->strokeJoin = ParseStrokeJoinMode(ctx, arguments[0], g_activeRuntime->strokeJoin);
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsBlendMode(
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
    return JSValueMakeUndefined(ctx);
  }

  long requestedMode = g_activeRuntime->blendMode;
  if (JsValueToLongSafe(ctx, arguments[0], requestedMode)) {
    g_activeRuntime->blendMode = NormalizeBlendModeValue(requestedMode, g_activeRuntime->blendMode);
  }
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsErase(
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
    return JSValueMakeUndefined(ctx);
  }

  double fillStrength = 255.0;
  double strokeStrength = 255.0;
  if (argumentCount > 0) {
    JsValueToNumberSafe(ctx, arguments[0], fillStrength);
  }
  if (argumentCount > 1) {
    JsValueToNumberSafe(ctx, arguments[1], strokeStrength);
  } else {
    strokeStrength = fillStrength;
  }

  g_activeRuntime->eraseActive = true;
  g_activeRuntime->eraseFillStrength = NormalizeEraseStrength(fillStrength);
  g_activeRuntime->eraseStrokeStrength = NormalizeEraseStrength(strokeStrength);
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsNoErase(
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
  if (g_activeRuntime) {
    g_activeRuntime->eraseActive = false;
    g_activeRuntime->eraseFillStrength = 1.0;
    g_activeRuntime->eraseStrokeStrength = 1.0;
  }
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsBeginClip(
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
    return JSValueMakeUndefined(ctx);
  }

  const bool invert = argumentCount > 0
    ? ReadClipInvertOption(ctx, arguments[0], false)
    : false;
  g_activeRuntime->clipCapturing = true;
  g_activeRuntime->clipInvert = invert;

  SceneCommand command;
  command.type = "clip_begin";
  command.clipInvert = invert;
  AppendSceneCommand(g_activeRuntime, command);
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsEndClip(
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
    return JSValueMakeUndefined(ctx);
  }

  SceneCommand command;
  command.type = "clip_end";
  AppendSceneCommand(g_activeRuntime, command);
  g_activeRuntime->clipCapturing = false;
  g_activeRuntime->clipInvert = false;
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsRandomSeed(
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
    return JSValueMakeUndefined(ctx);
  }

  double seed = 0.0;
  if (JsValueToNumberSafe(ctx, arguments[0], seed)) {
    g_activeRuntime->randomState = static_cast<A_u_long>(std::llround(seed));
    g_activeRuntime->gaussianHasSpare = false;
    g_activeRuntime->gaussianSpare = 0.0;
  }
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsRandom(
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
    return JSValueMakeNumber(ctx, 0.0);
  }

  const double unit = NextRandomUnit(g_activeRuntime);
  if (argumentCount == 0) {
    return JSValueMakeNumber(ctx, unit);
  }

  double a = 0.0;
  if (!JsValueToNumberSafe(ctx, arguments[0], a)) {
    return JSValueMakeNumber(ctx, 0.0);
  }

  if (argumentCount == 1) {
    return JSValueMakeNumber(ctx, unit * a);
  }

  double b = 0.0;
  if (!JsValueToNumberSafe(ctx, arguments[1], b)) {
    return JSValueMakeNumber(ctx, unit * a);
  }
  return JSValueMakeNumber(ctx, a + unit * (b - a));
}

JSValueRef JsFrameRate(
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
    return JSValueMakeNumber(ctx, 0.0);
  }

  if (argumentCount >= 1) {
    double fps = 0.0;
    if (JsValueToNumberSafe(ctx, arguments[0], fps) && fps > 0.0) {
      g_activeRuntime->desiredFrameRate = fps;
    }
  }

  return JSValueMakeNumber(ctx, g_activeRuntime->desiredFrameRate);
}

JSValueRef JsCreateCanvas(
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
  if (!g_activeRuntime || argumentCount < 2) {
    return JSValueMakeUndefined(ctx);
  }

  double width = 0.0;
  double height = 0.0;
  if (!JsValueToNumberSafe(ctx, arguments[0], width) ||
      !JsValueToNumberSafe(ctx, arguments[1], height)) {
    return JSValueMakeUndefined(ctx);
  }

  g_activeRuntime->scene.canvasWidth = std::max(1.0, width);
  g_activeRuntime->scene.canvasHeight = std::max(1.0, height);
  MarkSceneDirty(g_activeRuntime);

  JSObjectRef globalObject = JSContextGetGlobalObject(ctx);
  SetJsNumber(ctx, globalObject, "width", g_activeRuntime->scene.canvasWidth);
  SetJsNumber(ctx, globalObject, "height", g_activeRuntime->scene.canvasHeight);

  JSObjectRef canvas = JSObjectMake(ctx, NULL, NULL);
  SetJsNumber(ctx, canvas, "width", g_activeRuntime->scene.canvasWidth);
  SetJsNumber(ctx, canvas, "height", g_activeRuntime->scene.canvasHeight);
  return canvas;
}

JSValueRef JsTranslate(
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
    return JSValueMakeUndefined(ctx);
  }

  double x = 0.0;
  double y = 0.0;
  if (argumentCount == 1) {
    if (!ReadVector2(ctx, arguments[0], &x, &y) &&
        !JsValueToNumberSafe(ctx, arguments[0], x)) {
      return JSValueMakeUndefined(ctx);
    }
  } else if (!JsValueToNumberSafe(ctx, arguments[0], x)) {
    return JSValueMakeUndefined(ctx);
  }
  if (argumentCount > 1) {
    JsValueToNumberSafe(ctx, arguments[1], y);
  }

  g_activeRuntime->currentTransform = MultiplyTransform(
    g_activeRuntime->currentTransform,
    MakeTranslation(x, y)
  );
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsRotate(
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
    return JSValueMakeUndefined(ctx);
  }

  double angle = 0.0;
  if (!JsValueToNumberSafe(ctx, arguments[0], angle)) {
    return JSValueMakeUndefined(ctx);
  }

  angle = ToRadiansForRuntime(g_activeRuntime, angle);

  g_activeRuntime->currentTransform = MultiplyTransform(
    g_activeRuntime->currentTransform,
    MakeRotation(angle)
  );
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsScale(
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
    return JSValueMakeUndefined(ctx);
  }

  double x = 1.0;
  double y = 1.0;
  if (argumentCount == 1) {
    const bool readPair = ReadVector2(ctx, arguments[0], &x, &y);
    if (!readPair && !JsValueToNumberSafe(ctx, arguments[0], x)) {
      return JSValueMakeUndefined(ctx);
    }
    if (!readPair) {
      y = x;
    }
  } else if (!JsValueToNumberSafe(ctx, arguments[0], x)) {
    return JSValueMakeUndefined(ctx);
  }
  if (argumentCount > 1) {
    JsValueToNumberSafe(ctx, arguments[1], y);
  }

  g_activeRuntime->currentTransform = MultiplyTransform(
    g_activeRuntime->currentTransform,
    MakeScale(x, y)
  );
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsApplyMatrix(
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
    return JSValueMakeUndefined(ctx);
  }

  double a = 1.0;
  double b = 0.0;
  double c = 0.0;
  double d = 1.0;
  double tx = 0.0;
  double ty = 0.0;

  if (argumentCount == 1 && JSValueIsObject(ctx, arguments[0])) {
    double values[6] = {1.0, 0.0, 0.0, 1.0, 0.0, 0.0};
    JSObjectRef arrayObject = JSValueToObject(ctx, arguments[0], NULL);
    if (!arrayObject) {
      return JSValueMakeUndefined(ctx);
    }
    for (unsigned index = 0; index < 6; ++index) {
      JSValueRef entry = JSObjectGetPropertyAtIndex(ctx, arrayObject, index, NULL);
      JsValueToNumberSafe(ctx, entry, values[index]);
    }
    a = values[0];
    b = values[1];
    c = values[2];
    d = values[3];
    tx = values[4];
    ty = values[5];
  } else if (argumentCount >= 6) {
    if (
      !JsValueToNumberSafe(ctx, arguments[0], a) ||
      !JsValueToNumberSafe(ctx, arguments[1], b) ||
      !JsValueToNumberSafe(ctx, arguments[2], c) ||
      !JsValueToNumberSafe(ctx, arguments[3], d) ||
      !JsValueToNumberSafe(ctx, arguments[4], tx) ||
      !JsValueToNumberSafe(ctx, arguments[5], ty)
    ) {
      return JSValueMakeUndefined(ctx);
    }
  } else {
    return JSValueMakeUndefined(ctx);
  }

  Transform2D applied;
  applied.a = a;
  applied.b = b;
  applied.c = c;
  applied.d = d;
  applied.tx = tx;
  applied.ty = ty;
  g_activeRuntime->currentTransform = MultiplyTransform(
    g_activeRuntime->currentTransform,
    applied
  );
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsResetMatrix(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)ctx;
  (void)function;
  (void)thisObject;
  (void)argumentCount;
  (void)arguments;
  (void)exception;
  if (g_activeRuntime) {
    g_activeRuntime->currentTransform = MakeIdentityTransform();
  }
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsRectMode(
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
    return JSValueMakeUndefined(ctx);
  }

  g_activeRuntime->rectMode = ParseShapeMode(ctx, arguments[0], g_activeRuntime->rectMode);
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsEllipseMode(
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
    return JSValueMakeUndefined(ctx);
  }

  g_activeRuntime->ellipseMode = ParseShapeMode(ctx, arguments[0], g_activeRuntime->ellipseMode);
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsPush(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)ctx;
  (void)function;
  (void)thisObject;
  (void)argumentCount;
  (void)arguments;
  (void)exception;
  if (!g_activeRuntime) {
    return JSValueMakeUndefined(ctx);
  }

  g_activeRuntime->stateStack.push_back(CaptureRuntimeStyleState(*g_activeRuntime));

  SceneCommand command;
  command.type = "push_state";
  AppendSceneCommand(g_activeRuntime, command);
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsPop(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)ctx;
  (void)function;
  (void)thisObject;
  (void)argumentCount;
  (void)arguments;
  (void)exception;
  if (!g_activeRuntime || g_activeRuntime->stateStack.empty()) {
    return JSValueMakeUndefined(ctx);
  }

  const RuntimeSnapshot snapshot = g_activeRuntime->stateStack.back();
  g_activeRuntime->stateStack.pop_back();
  RestoreRuntimeStyleState(g_activeRuntime, snapshot);

  SceneCommand command;
  command.type = "pop_state";
  AppendSceneCommand(g_activeRuntime, command);
  return JSValueMakeUndefined(ctx);
}

}
