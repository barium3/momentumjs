#include "api_internal.h"

#include <algorithm>
#include <cmath>

namespace momentum {

namespace {

constexpr int kPerlinYWrapB = 4;
constexpr int kPerlinYWrap = 1 << kPerlinYWrapB;
constexpr int kPerlinZWrapB = 8;
constexpr int kPerlinZWrap = 1 << kPerlinZWrapB;
constexpr int kPerlinSize = 4095;
constexpr double kPi = 3.14159265358979323846;

JSValueRef MakeAngleModeValue(JSContextRef ctx, int angleMode) {
  const char* text = angleMode == ANGLE_MODE_DEGREES ? "degrees" : "radians";
  JSStringRef value = JSStringCreateWithUTF8CString(text);
  JSValueRef result = JSValueMakeString(ctx, value);
  JSStringRelease(value);
  return result;
}

double RandomUnitExclusive(JsHostRuntime* runtime) {
  return std::max(1.0e-12, NextRandomUnit(runtime));
}

double ScaledCosine(double value) {
  return 0.5 * (1.0 - std::cos(value * kPi));
}

void EnsureNoiseValues(JsHostRuntime* runtime) {
  if (!runtime || runtime->noiseInitialized) {
    return;
  }

  runtime->noiseValues.resize(static_cast<std::size_t>(kPerlinSize + 1));
  A_u_long state = runtime->noiseSeed;
  for (int index = 0; index <= kPerlinSize; index += 1) {
    state = state * 1664525UL + 1013904223UL;
    runtime->noiseValues[static_cast<std::size_t>(index)] =
      static_cast<double>(state) / 4294967296.0;
  }

  runtime->noiseInitialized = true;
}

double P5Noise(JsHostRuntime* runtime, double x, double y, double z) {
  if (!runtime) {
    return 0.0;
  }

  EnsureNoiseValues(runtime);
  const std::vector<double>& noiseValues = runtime->noiseValues;
  if (noiseValues.size() < static_cast<std::size_t>(kPerlinSize + 1)) {
    return 0.0;
  }

  x = std::fabs(x);
  y = std::fabs(y);
  z = std::fabs(z);

  int xi = static_cast<int>(std::floor(x));
  int yi = static_cast<int>(std::floor(y));
  int zi = static_cast<int>(std::floor(z));
  double xf = x - static_cast<double>(xi);
  double yf = y - static_cast<double>(yi);
  double zf = z - static_cast<double>(zi);
  double result = 0.0;
  double amplitude = 0.5;

  for (int octave = 0; octave < std::max(1, runtime->noiseOctaves); octave += 1) {
    int offset = xi + (yi << kPerlinYWrapB) + (zi << kPerlinZWrapB);
    const double rxf = ScaledCosine(xf);
    const double ryf = ScaledCosine(yf);

    double n1 = noiseValues[static_cast<std::size_t>(offset & kPerlinSize)];
    n1 += rxf * (noiseValues[static_cast<std::size_t>((offset + 1) & kPerlinSize)] - n1);
    double n2 = noiseValues[static_cast<std::size_t>((offset + kPerlinYWrap) & kPerlinSize)];
    n2 += rxf * (noiseValues[static_cast<std::size_t>((offset + kPerlinYWrap + 1) & kPerlinSize)] - n2);
    n1 += ryf * (n2 - n1);

    offset += kPerlinZWrap;
    n2 = noiseValues[static_cast<std::size_t>(offset & kPerlinSize)];
    n2 += rxf * (noiseValues[static_cast<std::size_t>((offset + 1) & kPerlinSize)] - n2);
    double n3 = noiseValues[static_cast<std::size_t>((offset + kPerlinYWrap) & kPerlinSize)];
    n3 += rxf * (noiseValues[static_cast<std::size_t>((offset + kPerlinYWrap + 1) & kPerlinSize)] - n3);
    n2 += ryf * (n3 - n2);

    n1 += ScaledCosine(zf) * (n2 - n1);
    result += n1 * amplitude;
    amplitude *= runtime->noiseFalloff;

    xi <<= 1;
    yi <<= 1;
    zi <<= 1;
    xf *= 2.0;
    yf *= 2.0;
    zf *= 2.0;

    if (xf >= 1.0) {
      xi += 1;
      xf -= 1.0;
    }
    if (yf >= 1.0) {
      yi += 1;
      yf -= 1.0;
    }
    if (zf >= 1.0) {
      zi += 1;
      zf -= 1.0;
    }
  }

  return result;
}

}  // namespace

JSValueRef JsRandomGaussian(
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

  double mean = 0.0;
  double standardDeviation = 1.0;
  if (argumentCount >= 1) {
    JsValueToNumberSafe(ctx, arguments[0], mean);
  }
  if (argumentCount >= 2) {
    JsValueToNumberSafe(ctx, arguments[1], standardDeviation);
  }

  double gaussian = 0.0;
  if (g_activeRuntime->gaussianHasSpare) {
    gaussian = g_activeRuntime->gaussianSpare;
    g_activeRuntime->gaussianHasSpare = false;
  } else {
    const double u1 = RandomUnitExclusive(g_activeRuntime);
    const double u2 = NextRandomUnit(g_activeRuntime);
    const double radius = std::sqrt(-2.0 * std::log(u1));
    const double theta = 2.0 * kPi * u2;
    gaussian = radius * std::cos(theta);
    g_activeRuntime->gaussianSpare = radius * std::sin(theta);
    g_activeRuntime->gaussianHasSpare = true;
  }

  return JSValueMakeNumber(ctx, mean + gaussian * standardDeviation);
}

JSValueRef JsNoise(
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

  double x = 0.0;
  double y = 0.0;
  double z = 0.0;
  if (argumentCount < 1 || !JsValueToNumberSafe(ctx, arguments[0], x)) {
    return JSValueMakeNumber(ctx, 0.0);
  }
  if (argumentCount >= 2) {
    JsValueToNumberSafe(ctx, arguments[1], y);
  }
  if (argumentCount >= 3) {
    JsValueToNumberSafe(ctx, arguments[2], z);
  }

  return JSValueMakeNumber(ctx, P5Noise(g_activeRuntime, x, y, z));
}

JSValueRef JsNoiseDetail(
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

  long octaves = g_activeRuntime->noiseOctaves;
  if (JsValueToLongSafe(ctx, arguments[0], octaves) && octaves > 0) {
    g_activeRuntime->noiseOctaves = static_cast<int>(octaves);
  }

  if (argumentCount >= 2) {
    double falloff = g_activeRuntime->noiseFalloff;
    if (JsValueToNumberSafe(ctx, arguments[1], falloff) && std::isfinite(falloff) && falloff > 0.0) {
      g_activeRuntime->noiseFalloff = falloff;
    }
  }

  return JSValueMakeUndefined(ctx);
}

JSValueRef JsNoiseSeed(
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
    g_activeRuntime->noiseSeed = static_cast<A_u_long>(std::llround(seed));
    g_activeRuntime->noiseInitialized = false;
    g_activeRuntime->noiseValues.clear();
  }
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsAngleMode(
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
    return MakeAngleModeValue(ctx, ANGLE_MODE_RADIANS);
  }

  if (argumentCount >= 1) {
    int nextMode = g_activeRuntime->angleMode;
    if (JsValueToAngleModeSafe(ctx, arguments[0], &nextMode)) {
      g_activeRuntime->angleMode = nextMode;
    }
  }

  return MakeAngleModeValue(ctx, g_activeRuntime->angleMode);
}

}  // namespace momentum
