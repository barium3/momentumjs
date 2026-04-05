#include "api_internal.h"

namespace momentum {

JSValueRef JsPoint(
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
  if (argumentCount == 1) {
    double x = 0.0;
    double y = 0.0;
    if (!ReadVector2(ctx, arguments[0], &x, &y)) {
      return JSValueMakeUndefined(ctx);
    }
    values.push_back(x);
    values.push_back(y);
  } else if (!ReadNumericArgs(ctx, argumentCount, arguments, 2, values)) {
    return JSValueMakeUndefined(ctx);
  }

  SceneCommand command = MakePointCommandFromVertex(MakeVertexSpec(values[0], values[1]));
  ApplyCurrentStyle(&command);
  command.hasFill = false;
  AppendSceneCommand(g_activeRuntime, command);
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsCircle(
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
  if (!ReadNumericArgs(ctx, argumentCount, arguments, 3, values)) {
    return JSValueMakeUndefined(ctx);
  }

  double x = values[0];
  double y = values[1];
  double diameter = values[2];
  double height = diameter;
  NormalizeEllipseArgs(g_activeRuntime->ellipseMode, &x, &y, &diameter, &height);

  VectorPath path;
  path.subpaths.push_back(BuildEllipseSubpath(x, y, diameter, height));
  SceneCommand command = MakePathCommandFromPath(path);
  ApplyCurrentStyle(&command);
  AppendSceneCommand(g_activeRuntime, command);
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsEllipse(
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
  if (!ReadNumericArgs(ctx, argumentCount, arguments, 3, values)) {
    return JSValueMakeUndefined(ctx);
  }
  if (values.size() < 4) {
    values.push_back(values[2]);
  }

  NormalizeEllipseArgs(g_activeRuntime->ellipseMode, &values[0], &values[1], &values[2], &values[3]);

  VectorPath path;
  path.subpaths.push_back(BuildEllipseSubpath(values[0], values[1], values[2], values[3]));
  SceneCommand command = MakePathCommandFromPath(path);
  ApplyCurrentStyle(&command);
  AppendSceneCommand(g_activeRuntime, command);
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsRect(
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
  if (!ReadNumericArgs(ctx, argumentCount, arguments, 3, values)) {
    return JSValueMakeUndefined(ctx);
  }
  if (values.size() < 4) {
    values.push_back(values[2]);
  }

  NormalizeRectArgs(g_activeRuntime->rectMode, &values[0], &values[1], &values[2], &values[3]);

  if (argumentCount > 4) {
    double tl = 0.0;
    double tr = 0.0;
    double br = 0.0;
    double bl = 0.0;
    if (!JsValueToNumberSafe(ctx, arguments[4], tl)) {
      tl = 0.0;
    }
    if (argumentCount > 5) {
      if (!JsValueToNumberSafe(ctx, arguments[5], tr)) {
        tr = tl;
      }
      if (argumentCount > 6) {
        if (!JsValueToNumberSafe(ctx, arguments[6], br)) {
          br = tr;
        }
        if (argumentCount > 7) {
          if (!JsValueToNumberSafe(ctx, arguments[7], bl)) {
            bl = br;
          }
        } else {
          bl = br;
        }
      } else {
        br = tr;
        bl = tr;
      }
    } else {
      tr = tl;
      br = tl;
      bl = tl;
    }

      VectorPath path;
      path.subpaths.push_back(BuildRoundedRectSubpath(values[0], values[1], values[2], values[3], tl, tr, br, bl));
      SceneCommand command = MakePathCommandFromPath(path);
      ApplyCurrentStyle(&command);
      AppendSceneCommand(g_activeRuntime, command);
      return JSValueMakeUndefined(ctx);
  }

  VectorPath path;
  path.subpaths.push_back(BuildRectSubpath(values[0], values[1], values[2], values[3]));
  SceneCommand command = MakePathCommandFromPath(path);
  ApplyCurrentStyle(&command);
  AppendSceneCommand(g_activeRuntime, command);
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsSquare(
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
  if (!ReadNumericArgs(ctx, argumentCount, arguments, 3, values)) {
    return JSValueMakeUndefined(ctx);
  }

  double x = values[0];
  double y = values[1];
  double size = values[2];
  double height = size;
  NormalizeRectArgs(g_activeRuntime->rectMode, &x, &y, &size, &height);

  VectorPath path;
  path.subpaths.push_back(BuildRectSubpath(x, y, size, height));
  SceneCommand command = MakePathCommandFromPath(path);
  ApplyCurrentStyle(&command);
  AppendSceneCommand(g_activeRuntime, command);
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsTriangle(
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

  VectorPath path;
  PathSubpath subpath;
  subpath.segments.push_back(MakeMoveToSegment(values[0], values[1]));
  subpath.segments.push_back(MakeLineToSegment(values[2], values[3]));
  subpath.segments.push_back(MakeLineToSegment(values[4], values[5]));
  subpath.segments.push_back(MakeCloseSegment());
  path.subpaths.push_back(subpath);
  SceneCommand command = MakePathCommandFromPath(path);
  ApplyCurrentStyle(&command);
  AppendSceneCommand(g_activeRuntime, command);
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsQuad(
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
  if (!ReadNumericArgs(ctx, argumentCount, arguments, 8, values)) {
    return JSValueMakeUndefined(ctx);
  }

  VectorPath path;
  PathSubpath subpath;
  subpath.segments.push_back(MakeMoveToSegment(values[0], values[1]));
  subpath.segments.push_back(MakeLineToSegment(values[2], values[3]));
  subpath.segments.push_back(MakeLineToSegment(values[4], values[5]));
  subpath.segments.push_back(MakeLineToSegment(values[6], values[7]));
  subpath.segments.push_back(MakeCloseSegment());
  path.subpaths.push_back(subpath);
  SceneCommand command = MakePathCommandFromPath(path);
  ApplyCurrentStyle(&command);
  AppendSceneCommand(g_activeRuntime, command);
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsLine(
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

  SceneCommand command = MakeLineCommandFromVertices(
    MakeVertexSpec(values[0], values[1]),
    MakeVertexSpec(values[2], values[3])
  );
  ApplyCurrentStyle(&command);
  command.hasFill = false;
  AppendSceneCommand(g_activeRuntime, command);
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsArc(
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

  NormalizeEllipseArgs(g_activeRuntime->ellipseMode, &values[0], &values[1], &values[2], &values[3]);
  const bool hasExplicitMode = argumentCount > 6;
  int mode = ARC_MODE_OPEN;
  if (hasExplicitMode) {
    mode = ParseArcMode(ctx, arguments[6], ARC_MODE_OPEN);
  }

  values[4] = ToRadiansForRuntime(g_activeRuntime, values[4]);
  values[5] = ToRadiansForRuntime(g_activeRuntime, values[5]);

  PathSubpath openArc = BuildArcSubpath(
    values[0], values[1], values[2], values[3], values[4], values[5], false
  );
  if (openArc.segments.size() < 2) {
    return JSValueMakeUndefined(ctx);
  }

  if (!hasExplicitMode) {
    if (g_activeRuntime->hasFill) {
      VectorPath fillPath;
      fillPath.subpaths.push_back(BuildArcSubpath(
        values[0], values[1], values[2], values[3], values[4], values[5], true
      ));
      SceneCommand fillCommand = MakePathCommandFromPath(fillPath);
      ApplyCurrentStyle(&fillCommand);
      fillCommand.hasStroke = false;
      AppendSceneCommand(g_activeRuntime, fillCommand);
    }

    if (g_activeRuntime->hasStroke) {
      VectorPath strokePath;
      strokePath.subpaths.push_back(openArc);
      SceneCommand strokeCommand = MakePathCommandFromPath(strokePath);
      ApplyCurrentStyle(&strokeCommand);
      strokeCommand.hasFill = false;
      AppendSceneCommand(g_activeRuntime, strokeCommand);
    }

    return JSValueMakeUndefined(ctx);
  }

  if (mode == ARC_MODE_OPEN) {
    if (g_activeRuntime->hasFill) {
      PathSubpath fillSubpath = openArc;
      fillSubpath.segments.push_back(MakeCloseSegment());
      VectorPath fillPath;
      fillPath.subpaths.push_back(fillSubpath);
      SceneCommand fillCommand = MakePathCommandFromPath(fillPath);
      ApplyCurrentStyle(&fillCommand);
      fillCommand.hasStroke = false;
      AppendSceneCommand(g_activeRuntime, fillCommand);
    }

    if (g_activeRuntime->hasStroke) {
      VectorPath strokePath;
      strokePath.subpaths.push_back(openArc);
      SceneCommand strokeCommand = MakePathCommandFromPath(strokePath);
      ApplyCurrentStyle(&strokeCommand);
      strokeCommand.hasFill = false;
      AppendSceneCommand(g_activeRuntime, strokeCommand);
    }

    return JSValueMakeUndefined(ctx);
  }

  if (mode == ARC_MODE_CHORD) {
    PathSubpath chordSubpath = openArc;
    chordSubpath.segments.push_back(MakeCloseSegment());
    VectorPath chordPath;
    chordPath.subpaths.push_back(chordSubpath);
    SceneCommand chordCommand = MakePathCommandFromPath(chordPath);
    ApplyCurrentStyle(&chordCommand);
    AppendSceneCommand(g_activeRuntime, chordCommand);
    return JSValueMakeUndefined(ctx);
  }

  VectorPath piePath;
  piePath.subpaths.push_back(BuildArcSubpath(
    values[0], values[1], values[2], values[3], values[4], values[5], true
  ));
  SceneCommand pieCommand = MakePathCommandFromPath(piePath);
  ApplyCurrentStyle(&pieCommand);
  AppendSceneCommand(g_activeRuntime, pieCommand);
  return JSValueMakeUndefined(ctx);
}

}
