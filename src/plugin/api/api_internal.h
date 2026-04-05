#pragma once

#include "api_drawing.h"

#include <utility>

#include "../render/render_core.h"
#include "../runtime/runtime_internal.h"

namespace momentum {

std::string JsStringToStdString(JSStringRef value);
std::string JsValueToStdString(JSContextRef ctx, JSValueRef value);
bool JsValueToNumberSafe(JSContextRef ctx, JSValueRef value, double& result);
bool JsValueToLongSafe(JSContextRef ctx, JSValueRef value, long& result);
RuntimeSnapshot CaptureRuntimeStyleState(const JsHostRuntime& runtime);
void RestoreRuntimeStyleState(JsHostRuntime* runtime, const RuntimeSnapshot& snapshot);
RuntimeEngineState CaptureRuntimeEngineStateSnapshot(const JsHostRuntime& runtime);
void RestoreRuntimeEngineStateSnapshot(JsHostRuntime* runtime, const RuntimeEngineState& state);
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
SceneCommand MakePolygonCommandFromVertices(
  const std::vector<VertexSpec>& vertices,
  bool closePath,
  const std::vector<std::vector<VertexSpec>>* contours = NULL
);
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
void AppendBezierSegmentVertices(
  std::vector<VertexSpec>* vertices,
  double x0,
  double y0,
  double x1,
  double y1,
  double x2,
  double y2,
  double x3,
  double y3,
  int segments
);
void AppendQuadraticSegmentVertices(
  std::vector<VertexSpec>* vertices,
  double x0,
  double y0,
  double cx,
  double cy,
  double x1,
  double y1,
  int segments
);
void AppendCurveSegmentVertices(
  std::vector<VertexSpec>* vertices,
  const VertexSpec& p0,
  const VertexSpec& p1,
  const VertexSpec& p2,
  const VertexSpec& p3,
  int segments,
  double tightness = 0.0
);
std::vector<VertexSpec> BuildCurveShapeVertices(
  const std::vector<VertexSpec>& controlVertices,
  bool closePath,
  double tightness = 0.0
);
void ApplyCurrentStyle(SceneCommand* command);
std::vector<VertexSpec> BuildArcVertices(
  double cx,
  double cy,
  double width,
  double height,
  double start,
  double stop,
  bool includeCenter
);
PathSubpath BuildArcSubpath(
  double cx,
  double cy,
  double width,
  double height,
  double start,
  double stop,
  bool includeCenter
);
std::vector<VertexSpec> BuildRoundedRectVertices(
  double x,
  double y,
  double width,
  double height,
  double tl,
  double tr,
  double br,
  double bl
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
std::vector<VertexSpec> BuildRectVertices(
  double x,
  double y,
  double width,
  double height
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

JSValueRef JsBackground(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsFill(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsStroke(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsClear(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsColorMode(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsColor(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsNoFill(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsNoStroke(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsStrokeWeight(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsStrokeCap(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsStrokeJoin(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsBlendMode(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsErase(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsNoErase(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsBeginClip(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsEndClip(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsRandomSeed(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsRandom(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsRandomGaussian(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsNoise(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsNoiseDetail(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsNoiseSeed(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsAngleMode(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsFrameRate(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsImageMode(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsPixelDensity(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsTint(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsNoTint(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsImage(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeLoadImage(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeBackgroundImage(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeCreateImage(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeImageLoadPixels(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeImageUpdatePixels(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeImageClone(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeImageGetPixel(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeImageGetRegion(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeImageSetColor(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeImageSetImage(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeImageResize(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeImageMask(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeImageCopy(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeImageBlend(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeImageFilter(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeCanvasImage(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeCreateGraphics(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeEnterGraphics(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeExitGraphics(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativePrepareGraphicsBitmap(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeCommitGraphicsBitmap(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsCreateCanvas(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsTranslate(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsRotate(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsScale(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsApplyMatrix(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsResetMatrix(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsText(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsTextSize(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsTextLeading(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsTextFont(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsTextStyle(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsTextWrap(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsTextAlign(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsTextWidth(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsTextAscent(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsTextDescent(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeLoadFont(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeFontTextBounds(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeFontTextToPoints(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsRectMode(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsEllipseMode(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsPush(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsPop(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsPoint(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsCircle(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsEllipse(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsRect(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsSquare(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsTriangle(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsQuad(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsLine(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsArc(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsBeginShape(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsBeginContour(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsEndContour(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsVertex(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsBezierVertex(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsQuadraticVertex(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsCurveVertex(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsBezier(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsCurve(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsCurveTightness(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsEndShape(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);

const char* GetDataBootstrapScript();
const char* GetControllerBootstrapScript();
const char* GetIoBootstrapScript();
bool ApplyControllerStateToRuntime(
  JSContextRef ctx,
  const ControllerPoolState& state,
  std::string* errorMessage
);

JSValueRef JsMomentumNativeLoadJSON(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeLoadStrings(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeLoadBytes(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeLoadXML(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
JSValueRef JsMomentumNativeLoadTable(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
);
}
