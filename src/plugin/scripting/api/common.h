#pragma once

#include <utility>

#include "rendering/software/rasterizer.h"
#include "scripting/api/drawing.h"
#include "scripting/runtime/internal.h"

namespace momentum {

std::string JsStringToStdString(JSStringRef value);
std::string JsValueToStdString(JSContextRef ctx, JSValueRef value);
bool JsValueToNumberSafe(JSContextRef ctx, JSValueRef value, double& result);
bool JsValueToLongSafe(JSContextRef ctx, JSValueRef value, long& result);
RuntimeSnapshot CaptureRuntimeStyleState(const JsHostRuntime& runtime);
void RestoreRuntimeStyleState(JsHostRuntime* runtime, const RuntimeSnapshot& snapshot);
void MarkSceneDirty(JsHostRuntime* runtime);
void AppendSceneCommand(JsHostRuntime* runtime, const SceneCommand& command);
void ClearSceneCommands(JsHostRuntime* runtime);
bool ReadVector2(JSContextRef ctx, JSValueRef value, double* x, double* y);
bool ReadColorArray(JSContextRef ctx, JSValueRef value, double channels[4], int* count);
PF_Pixel HsbToRgb(double hue, double saturation, double brightness, double alpha);
int ParseShapeMode(JSContextRef ctx, JSValueRef value, int fallbackMode);
int ParseStrokeCapMode(JSContextRef ctx, JSValueRef value, int fallbackMode);
int ParseStrokeJoinMode(JSContextRef ctx, JSValueRef value, int fallbackMode);
int ParseArcMode(JSContextRef ctx, JSValueRef value, int fallbackMode);
int ParseBeginShapeKind(JSContextRef ctx, JSValueRef value, int fallbackKind);
void NormalizeRectArgs(int mode, double* x, double* y, double* width, double* height);
void NormalizeEllipseArgs(int mode, double* x, double* y, double* width, double* height);
SceneCommand MakePathCommandFromPath(const VectorPath& path);
PathSegment MakeMoveToSegment(double x, double y);
PathSegment MakeLineToSegment(double x, double y);
PathSegment MakeQuadraticToSegment(double cx, double cy, double x, double y);
PathSegment MakeCubicToSegment(double cx1, double cy1, double cx2, double cy2, double x, double y);
PathSegment MakeCloseSegment();
SceneCommand MakePointCommandFromVertex(const VertexSpec& vertex);
SceneCommand MakeLineCommandFromVertices(const VertexSpec& start, const VertexSpec& end);
VertexSpec MakeVertexSpec(double x, double y);
std::pair<double, double> VertexToPair(const VertexSpec& vertex);
void AppendCurvePathSegment(
  PathSubpath* subpath,
  const VertexSpec& p0,
  const VertexSpec& p1,
  const VertexSpec& p2,
  const VertexSpec& p3,
  double tightness = 0.0
);
void ApplyCurrentStyle(SceneCommand* command);
PathSubpath BuildArcSubpath(
  double cx,
  double cy,
  double width,
  double height,
  double start,
  double stop,
  bool includeCenter
);
PathSubpath BuildRoundedRectSubpath(
  double x,
  double y,
  double width,
  double height,
  double tl,
  double tr,
  double br,
  double bl
);
PathSubpath BuildRectSubpath(
  double x,
  double y,
  double width,
  double height
);
PathSubpath BuildEllipseSubpath(
  double cx,
  double cy,
  double width,
  double height
);
PF_Pixel ParseColorArgs(
  JSContextRef ctx,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  const PF_Pixel& fallback
);
bool ReadNumericArgs(
  JSContextRef ctx,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  std::size_t requiredCount,
  std::vector<double>& out
);
double NextRandomUnit(JsHostRuntime* runtime);
bool JsValueToAngleModeSafe(JSContextRef ctx, JSValueRef value, int* angleModeOut);
double ToRadiansForRuntime(JsHostRuntime* runtime, double angle);

}  // namespace momentum
