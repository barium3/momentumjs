#include "api_internal.h"

namespace momentum {

namespace {

void ClearShapeBuilder(JsHostRuntime* runtime) {
  if (!runtime) {
    return;
  }
  runtime->shapeVertices.clear();
  runtime->shapeContours.clear();
  runtime->curveVertices.clear();
  runtime->contourVertices.clear();
  runtime->contourCurveVertices.clear();
  runtime->shapeSubpath.segments.clear();
  runtime->shapeSubpath.isContour = false;
  runtime->shapeContourSubpaths.clear();
  runtime->contourSubpath.segments.clear();
  runtime->contourSubpath.isContour = false;
  runtime->shapeUsesCurve = false;
  runtime->contourUsesCurve = false;
  runtime->insideContour = false;
  runtime->shapeKind = BEGIN_SHAPE_DEFAULT;
}

bool IsCloseSegment(const PathSegment& segment) {
  return segment.type == PATH_SEGMENT_CLOSE;
}

bool SubpathHasDrawableGeometry(const PathSubpath& subpath) {
  for (std::size_t index = 0; index < subpath.segments.size(); ++index) {
    if (subpath.segments[index].type != PATH_SEGMENT_MOVE_TO &&
        subpath.segments[index].type != PATH_SEGMENT_CLOSE) {
      return true;
    }
  }
  return false;
}

void AppendPendingVerticesToSubpath(
  const std::vector<VertexSpec>& pendingVertices,
  PathSubpath* subpath
) {
  if (!subpath || pendingVertices.empty()) {
    return;
  }

  std::size_t index = 0;
  if (subpath->segments.empty()) {
    const std::pair<double, double> point = VertexToPair(pendingVertices[0]);
    subpath->segments.push_back(MakeMoveToSegment(point.first, point.second));
    index = 1;
  }

  for (; index < pendingVertices.size(); ++index) {
    const std::pair<double, double> point = VertexToPair(pendingVertices[index]);
    subpath->segments.push_back(MakeLineToSegment(point.first, point.second));
  }
}

PathSubpath BuildCurveSubpath(
  const std::vector<VertexSpec>& controlVertices,
  bool closePath,
  double tightness,
  bool isContour
) {
  PathSubpath subpath;
  subpath.isContour = isContour;
  if (controlVertices.size() < 4) {
    return subpath;
  }

  if (!closePath) {
    for (std::size_t index = 0; index + 3 < controlVertices.size(); index += 1) {
      AppendCurvePathSegment(
        &subpath,
        controlVertices[index],
        controlVertices[index + 1],
        controlVertices[index + 2],
        controlVertices[index + 3],
        tightness
      );
    }
    return subpath;
  }

  std::vector<VertexSpec> wrapped = controlVertices;
  wrapped.insert(wrapped.begin(), controlVertices[controlVertices.size() - 2]);
  wrapped.push_back(controlVertices[1]);
  wrapped.push_back(controlVertices[2]);
  for (std::size_t index = 0; index + 3 < wrapped.size(); index += 1) {
    AppendCurvePathSegment(
      &subpath,
      wrapped[index],
      wrapped[index + 1],
      wrapped[index + 2],
      wrapped[index + 3],
      tightness
    );
  }
  if (SubpathHasDrawableGeometry(subpath)) {
    subpath.segments.push_back(MakeCloseSegment());
  }
  return subpath;
}

void EmitShapeKindCommands(
  JsHostRuntime* runtime,
  const std::vector<VertexSpec>& vertices,
  int shapeKind
) {
  if (!runtime) {
    return;
  }

  auto emitSubpath = [&](const PathSubpath& subpath, bool closePath, bool strokeOnly) {
    if (!SubpathHasDrawableGeometry(subpath) && subpath.segments.size() < 1) {
      return;
    }
    VectorPath path;
    path.subpaths.push_back(subpath);
    SceneCommand command = MakePathCommandFromPath(path);
    ApplyCurrentStyle(&command);
    if (strokeOnly) {
      command.hasFill = false;
    }
    if (!closePath) {
      command.hasFill = false;
    }
    AppendSceneCommand(runtime, command);
  };

  switch (shapeKind) {
    case BEGIN_SHAPE_POINTS:
      for (std::size_t index = 0; index < vertices.size(); index += 1) {
        PathSubpath subpath;
        const std::pair<double, double> point = VertexToPair(vertices[index]);
        subpath.segments.push_back(MakeMoveToSegment(point.first, point.second));
        emitSubpath(subpath, false, true);
      }
      return;

    case BEGIN_SHAPE_LINES:
      for (std::size_t index = 0; index + 1 < vertices.size(); index += 2) {
        PathSubpath subpath;
        const std::pair<double, double> start = VertexToPair(vertices[index]);
        const std::pair<double, double> end = VertexToPair(vertices[index + 1]);
        subpath.segments.push_back(MakeMoveToSegment(start.first, start.second));
        subpath.segments.push_back(MakeLineToSegment(end.first, end.second));
        emitSubpath(subpath, false, true);
      }
      return;

    case BEGIN_SHAPE_TRIANGLES:
      for (std::size_t index = 0; index + 2 < vertices.size(); index += 3) {
        PathSubpath subpath;
        const std::pair<double, double> a = VertexToPair(vertices[index]);
        const std::pair<double, double> b = VertexToPair(vertices[index + 1]);
        const std::pair<double, double> c = VertexToPair(vertices[index + 2]);
        subpath.segments.push_back(MakeMoveToSegment(a.first, a.second));
        subpath.segments.push_back(MakeLineToSegment(b.first, b.second));
        subpath.segments.push_back(MakeLineToSegment(c.first, c.second));
        subpath.segments.push_back(MakeCloseSegment());
        emitSubpath(subpath, true, false);
      }
      return;

    case BEGIN_SHAPE_TRIANGLE_STRIP:
      for (std::size_t index = 2; index < vertices.size(); index += 1) {
        PathSubpath subpath;
        std::pair<double, double> a;
        std::pair<double, double> b;
        std::pair<double, double> c;
        if (index % 2 == 0) {
          a = VertexToPair(vertices[index - 2]);
          b = VertexToPair(vertices[index - 1]);
          c = VertexToPair(vertices[index]);
        } else {
          a = VertexToPair(vertices[index - 1]);
          b = VertexToPair(vertices[index - 2]);
          c = VertexToPair(vertices[index]);
        }
        subpath.segments.push_back(MakeMoveToSegment(a.first, a.second));
        subpath.segments.push_back(MakeLineToSegment(b.first, b.second));
        subpath.segments.push_back(MakeLineToSegment(c.first, c.second));
        subpath.segments.push_back(MakeCloseSegment());
        emitSubpath(subpath, true, false);
      }
      return;

    case BEGIN_SHAPE_TRIANGLE_FAN:
      for (std::size_t index = 2; index < vertices.size(); index += 1) {
        PathSubpath subpath;
        const std::pair<double, double> a = VertexToPair(vertices[0]);
        const std::pair<double, double> b = VertexToPair(vertices[index - 1]);
        const std::pair<double, double> c = VertexToPair(vertices[index]);
        subpath.segments.push_back(MakeMoveToSegment(a.first, a.second));
        subpath.segments.push_back(MakeLineToSegment(b.first, b.second));
        subpath.segments.push_back(MakeLineToSegment(c.first, c.second));
        subpath.segments.push_back(MakeCloseSegment());
        emitSubpath(subpath, true, false);
      }
      return;

    case BEGIN_SHAPE_QUADS:
      for (std::size_t index = 0; index + 3 < vertices.size(); index += 4) {
        PathSubpath subpath;
        const std::pair<double, double> a = VertexToPair(vertices[index]);
        const std::pair<double, double> b = VertexToPair(vertices[index + 1]);
        const std::pair<double, double> c = VertexToPair(vertices[index + 2]);
        const std::pair<double, double> d = VertexToPair(vertices[index + 3]);
        subpath.segments.push_back(MakeMoveToSegment(a.first, a.second));
        subpath.segments.push_back(MakeLineToSegment(b.first, b.second));
        subpath.segments.push_back(MakeLineToSegment(c.first, c.second));
        subpath.segments.push_back(MakeLineToSegment(d.first, d.second));
        subpath.segments.push_back(MakeCloseSegment());
        emitSubpath(subpath, true, false);
      }
      return;

    case BEGIN_SHAPE_QUAD_STRIP:
      for (std::size_t index = 3; index < vertices.size(); index += 2) {
        PathSubpath subpath;
        const std::pair<double, double> a = VertexToPair(vertices[index - 3]);
        const std::pair<double, double> b = VertexToPair(vertices[index - 2]);
        const std::pair<double, double> c = VertexToPair(vertices[index]);
        const std::pair<double, double> d = VertexToPair(vertices[index - 1]);
        subpath.segments.push_back(MakeMoveToSegment(a.first, a.second));
        subpath.segments.push_back(MakeLineToSegment(b.first, b.second));
        subpath.segments.push_back(MakeLineToSegment(c.first, c.second));
        subpath.segments.push_back(MakeLineToSegment(d.first, d.second));
        subpath.segments.push_back(MakeCloseSegment());
        emitSubpath(subpath, true, false);
      }
      return;

    default:
      return;
  }
}

void FlushPendingLinearVertices(JsHostRuntime* runtime, bool intoContour) {
  if (!runtime) {
    return;
  }
  if (intoContour) {
    AppendPendingVerticesToSubpath(runtime->contourVertices, &runtime->contourSubpath);
    runtime->contourVertices.clear();
  } else {
    AppendPendingVerticesToSubpath(runtime->shapeVertices, &runtime->shapeSubpath);
    runtime->shapeVertices.clear();
  }
}

}

JSValueRef JsBeginShape(
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
  if (g_activeRuntime) {
    ClearShapeBuilder(g_activeRuntime);
    if (argumentCount >= 1) {
      g_activeRuntime->shapeKind = ParseBeginShapeKind(ctx, arguments[0], BEGIN_SHAPE_DEFAULT);
    }
  }
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsBeginContour(
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
  if (!g_activeRuntime || g_activeRuntime->insideContour) {
    return JSValueMakeUndefined(ctx);
  }

  g_activeRuntime->insideContour = true;
  g_activeRuntime->contourUsesCurve = false;
  g_activeRuntime->contourVertices.clear();
  g_activeRuntime->contourCurveVertices.clear();
  g_activeRuntime->contourSubpath.segments.clear();
  g_activeRuntime->contourSubpath.isContour = true;
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsEndContour(
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
  if (!g_activeRuntime || !g_activeRuntime->insideContour) {
    return JSValueMakeUndefined(ctx);
  }

  PathSubpath subpath;
  if (g_activeRuntime->contourUsesCurve) {
    subpath = BuildCurveSubpath(
      g_activeRuntime->contourCurveVertices,
      true,
      g_activeRuntime->curveTightness,
      true
    );
  } else {
    FlushPendingLinearVertices(g_activeRuntime, true);
    subpath = g_activeRuntime->contourSubpath;
    if (SubpathHasDrawableGeometry(subpath) &&
        (subpath.segments.empty() || !IsCloseSegment(subpath.segments.back()))) {
      subpath.segments.push_back(MakeCloseSegment());
    }
  }

  if (SubpathHasDrawableGeometry(subpath)) {
    subpath.isContour = true;
    g_activeRuntime->shapeContourSubpaths.push_back(subpath);
  }

  g_activeRuntime->insideContour = false;
  g_activeRuntime->contourUsesCurve = false;
  g_activeRuntime->contourVertices.clear();
  g_activeRuntime->contourCurveVertices.clear();
  g_activeRuntime->contourSubpath.segments.clear();
  g_activeRuntime->contourSubpath.isContour = false;
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsVertex(
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

  std::vector<double> values;
  if (!ReadNumericArgs(ctx, argumentCount, arguments, 2, values)) {
    return JSValueMakeUndefined(ctx);
  }

  VertexSpec vertex = MakeVertexSpec(values[0], values[1]);
  if (g_activeRuntime->insideContour) {
    g_activeRuntime->contourVertices.push_back(vertex);
  } else {
    g_activeRuntime->shapeVertices.push_back(vertex);
  }
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsBezierVertex(
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

  std::vector<double> values;
  if (!ReadNumericArgs(ctx, argumentCount, arguments, 6, values)) {
    return JSValueMakeUndefined(ctx);
  }

  const bool intoContour = g_activeRuntime->insideContour;
  FlushPendingLinearVertices(g_activeRuntime, intoContour);
  PathSubpath* subpath = intoContour ? &g_activeRuntime->contourSubpath : &g_activeRuntime->shapeSubpath;
  if (subpath->segments.empty()) {
    return JSValueMakeUndefined(ctx);
  }

  subpath->segments.push_back(MakeCubicToSegment(
    values[0], values[1],
    values[2], values[3],
    values[4], values[5]
  ));
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsQuadraticVertex(
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

  std::vector<double> values;
  if (!ReadNumericArgs(ctx, argumentCount, arguments, 4, values)) {
    return JSValueMakeUndefined(ctx);
  }

  const bool intoContour = g_activeRuntime->insideContour;
  FlushPendingLinearVertices(g_activeRuntime, intoContour);
  PathSubpath* subpath = intoContour ? &g_activeRuntime->contourSubpath : &g_activeRuntime->shapeSubpath;
  if (subpath->segments.empty()) {
    return JSValueMakeUndefined(ctx);
  }

  subpath->segments.push_back(MakeQuadraticToSegment(
    values[0], values[1],
    values[2], values[3]
  ));
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsCurveVertex(
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

  std::vector<double> values;
  if (!ReadNumericArgs(ctx, argumentCount, arguments, 2, values)) {
    return JSValueMakeUndefined(ctx);
  }

  if (g_activeRuntime->insideContour) {
    g_activeRuntime->contourUsesCurve = true;
    g_activeRuntime->contourCurveVertices.push_back(MakeVertexSpec(values[0], values[1]));
  } else {
    g_activeRuntime->shapeUsesCurve = true;
    g_activeRuntime->curveVertices.push_back(MakeVertexSpec(values[0], values[1]));
  }
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsBezier(
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
  if (!g_activeRuntime || !g_activeRuntime->hasStroke) {
    return JSValueMakeUndefined(ctx);
  }

  std::vector<double> values;
  if (!ReadNumericArgs(ctx, argumentCount, arguments, 8, values)) {
    return JSValueMakeUndefined(ctx);
  }

  PathSubpath subpath;
  subpath.segments.push_back(MakeMoveToSegment(values[0], values[1]));
  subpath.segments.push_back(MakeCubicToSegment(
    values[2], values[3],
    values[4], values[5],
    values[6], values[7]
  ));

  VectorPath path;
  path.subpaths.push_back(subpath);
  SceneCommand command = MakePathCommandFromPath(path);
  ApplyCurrentStyle(&command);
  command.hasFill = false;
  AppendSceneCommand(g_activeRuntime, command);
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsCurve(
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
  if (!g_activeRuntime || !g_activeRuntime->hasStroke) {
    return JSValueMakeUndefined(ctx);
  }

  std::vector<double> values;
  if (!ReadNumericArgs(ctx, argumentCount, arguments, 8, values)) {
    return JSValueMakeUndefined(ctx);
  }

  std::vector<VertexSpec> controlVertices;
  controlVertices.push_back(MakeVertexSpec(values[0], values[1]));
  controlVertices.push_back(MakeVertexSpec(values[2], values[3]));
  controlVertices.push_back(MakeVertexSpec(values[4], values[5]));
  controlVertices.push_back(MakeVertexSpec(values[6], values[7]));

  PathSubpath subpath = BuildCurveSubpath(
    controlVertices,
    false,
    g_activeRuntime->curveTightness,
    false
  );
  VectorPath path;
  path.subpaths.push_back(subpath);
  SceneCommand command = MakePathCommandFromPath(path);
  ApplyCurrentStyle(&command);
  command.hasFill = false;
  AppendSceneCommand(g_activeRuntime, command);
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsCurveTightness(
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

  double tightness = 0.0;
  if (JsValueToNumberSafe(ctx, arguments[0], tightness)) {
    g_activeRuntime->curveTightness = tightness;
  }
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsEndShape(
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

  if (!g_activeRuntime->shapeUsesCurve &&
      g_activeRuntime->shapeKind != BEGIN_SHAPE_DEFAULT &&
      g_activeRuntime->shapeKind != BEGIN_SHAPE_TESS) {
    EmitShapeKindCommands(
      g_activeRuntime,
      g_activeRuntime->shapeVertices,
      g_activeRuntime->shapeKind
    );
    ClearShapeBuilder(g_activeRuntime);
    return JSValueMakeUndefined(ctx);
  }

  bool closePath = false;
  if (argumentCount >= 1) {
    long mode = 0;
    if (JsValueToLongSafe(ctx, arguments[0], mode)) {
      closePath = (mode == 100);
    }
  }

  PathSubpath outerSubpath;
  if (g_activeRuntime->shapeUsesCurve) {
    outerSubpath = BuildCurveSubpath(
      g_activeRuntime->curveVertices,
      closePath,
      g_activeRuntime->curveTightness,
      false
    );
  } else {
    FlushPendingLinearVertices(g_activeRuntime, false);
    outerSubpath = g_activeRuntime->shapeSubpath;
    if (closePath &&
        SubpathHasDrawableGeometry(outerSubpath) &&
        (outerSubpath.segments.empty() || !IsCloseSegment(outerSubpath.segments.back()))) {
      outerSubpath.segments.push_back(MakeCloseSegment());
    }
  }

  VectorPath path;
  if (SubpathHasDrawableGeometry(outerSubpath) || outerSubpath.segments.size() == 1) {
    path.subpaths.push_back(outerSubpath);
  }
  for (std::size_t index = 0; index < g_activeRuntime->shapeContourSubpaths.size(); ++index) {
    if (SubpathHasDrawableGeometry(g_activeRuntime->shapeContourSubpaths[index])) {
      path.subpaths.push_back(g_activeRuntime->shapeContourSubpaths[index]);
    }
  }

  if (!path.subpaths.empty()) {
    SceneCommand command = MakePathCommandFromPath(path);
    ApplyCurrentStyle(&command);
    if (!closePath) {
      command.hasFill = false;
    }
    AppendSceneCommand(g_activeRuntime, command);
  }

  ClearShapeBuilder(g_activeRuntime);
  return JSValueMakeUndefined(ctx);
}

}
