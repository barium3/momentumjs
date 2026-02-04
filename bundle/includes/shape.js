// ----------------------------------------
// Shape - 动态索引分配模式
// ----------------------------------------

// 从 registry 获取形状函数信息
// #include "registry.js"

// 获取图形类型的槽位数（使用 registry）
function getShapeSlots(type) {
  // 优先使用 registry
  if (
    typeof functionRegistry !== "undefined" &&
    functionRegistry.getShapeSlots
  ) {
    return functionRegistry.getShapeSlots(type);
  }

  // 备用：硬编码的插槽定义
  var slots = {
    ellipse: 9,
    circle: 9,
    rect: 9,
    square: 9,
    line: 8,
    point: 7,
    background: 3,
  };
  return slots[type] || 7;
}

/**
 * 创建形状图层
 * 根据 shapeQueue 中的数据创建对应的 AE 图层
 */
function createShapeLayers() {
  if (shapeQueue.length === 0) return;
  for (var i = 0; i < shapeQueue.length; i++) {
    var shape = shapeQueue[i];
    var shapeIndex = shape.shapeIndex || 1;
    switch (shape.type) {
      case "ellipse":
        createEllipseFromContext(i, shapeIndex);
        break;
      case "rect":
        createRectFromContext(i, shapeIndex);
        break;
      case "line":
        createLineFromContext(i, shapeIndex);
        break;
      case "point":
        createPointFromContext(i, shapeIndex);
        break;
      case "background":
        createBackgroundFromContext(i, shapeIndex);
        break;
    }
  }
}

/**
 * 生成查找 marker 的表达式代码片段
 * @param {number} markerType - marker 类型代码
 * @param {number} shapeIndex - 形状索引
 */
function _getMarkerFindExpr(markerType, shapeIndex) {
  return [
    'var ctx = thisComp.layer("__engine__").content("Program").content("Main").path;',
    "var pts = ctx.points();",
    "var targetType = " + markerType + ";",
    "var targetIndex = " + shapeIndex + ";",
    "var markerIdx = -1;",
    "for (var i = pts.length - 1; i >= 0; i--) {",
    "  if (pts[i] && pts[i].length === 2 && pts[i][1] === targetType && pts[i][0] === targetIndex) {",
    "    markerIdx = i;",
    "    break;",
    "  }",
    "}",
  ].join("\n");
}

/**
 * ellipse 数据结构 (slots=9):
 * [pos, size, rot, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
 * 偏移: pos=-9, size=-8, rot=-7, fill1=-6, fill2=-5, stroke1=-4, stroke2=-3, opacity=-2, strokeWeight=-1
 */
function createEllipseFromContext(index, shapeIndex) {
  var layer = engineComp.layers.addShape();
  layer.name = "Shape_" + index;
  layer.property("Transform").property("Anchor Point").setValue([0, 0]);
  layer.property("Transform").property("Position").setValue([0, 0]);
  var shapeGroup = layer.property("Contents").addProperty("ADBE Vector Group");
  var ellipse = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Shape - Ellipse");
  var transform = shapeGroup.property("Transform");

  var markerFind = _getMarkerFindExpr(1001, shapeIndex);

  // Position (pos at -9)
  transform.property("Position").expression = [
    markerFind,
    "if (markerIdx < 0) [-9999, -9999];",
    "var p = pts[markerIdx - 9];",
    "p ? p : [-9999, -9999]",
  ].join("\n");

  // Size (size at -8)
  ellipse.property("Size").expression = [
    markerFind,
    "if (markerIdx < 0) [0, 0];",
    "var s = pts[markerIdx - 8];",
    "s ? s : [0, 0]",
  ].join("\n");

  // Rotation (rot at -7)
  transform.property("Rotation").expression = [
    markerFind,
    "if (markerIdx < 0) 0;",
    "var r = pts[markerIdx - 7];",
    "r ? r[0] : 0",
  ].join("\n");

  // Fill
  var fill = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Graphic - Fill");

  // Fill Color (fill1 at -6, fill2 at -5)
  fill.property("Color").expression = [
    markerFind,
    "if (markerIdx < 0) [1,1,1,1];",
    "var f1 = pts[markerIdx - 6], f2 = pts[markerIdx - 5];",
    "if (!f1 || f1[0] < 0) [0,0,0,0];",
    "[f1[0], f1[1], f2[0], 1]",
  ].join("\n");

  // Fill Opacity (opacity at -2, fillOpacity is first element)
  fill.property("Opacity").expression = [
    markerFind,
    "if (markerIdx < 0) 100;",
    "var op = pts[markerIdx - 2];",
    "op ? op[0] : 100",
  ].join("\n");

  // Stroke
  var stroke = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Graphic - Stroke");

  // Stroke Color (stroke1 at -4, stroke2 at -3)
  stroke.property("Color").expression = [
    markerFind,
    "if (markerIdx < 0) [0,0,0,1];",
    "var s1 = pts[markerIdx - 4], s2 = pts[markerIdx - 3];",
    "if (!s1 || s1[0] < 0) [0,0,0,0];",
    "[s1[0], s1[1], s2[0], 1]",
  ].join("\n");

  // Stroke Opacity (opacity at -2, strokeOpacity is second element)
  stroke.property("Opacity").expression = [
    markerFind,
    "if (markerIdx < 0) 100;",
    "var op = pts[markerIdx - 2];",
    "op ? op[1] : 100",
  ].join("\n");

  // Stroke Width (strokeWeight at -1)
  stroke.property("Stroke Width").expression = [
    markerFind,
    "if (markerIdx < 0) 1;",
    "var sw = pts[markerIdx - 1];",
    "sw ? sw[0] : 1",
  ].join("\n");
}

/**
 * rect 数据结构 (slots=9):
 * [pos, size, rot, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
 * 偏移: pos=-9, size=-8, rot=-7, fill1=-6, fill2=-5, stroke1=-4, stroke2=-3, opacity=-2, strokeWeight=-1
 */
function createRectFromContext(index, shapeIndex) {
  var layer = engineComp.layers.addShape();
  layer.name = "Shape_" + index;
  layer.property("Transform").property("Anchor Point").setValue([0, 0]);
  layer.property("Transform").property("Position").setValue([0, 0]);
  var shapeGroup = layer.property("Contents").addProperty("ADBE Vector Group");
  var rect = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Shape - Rect");
  var transform = shapeGroup.property("Transform");

  var markerFind = _getMarkerFindExpr(1002, shapeIndex);

  // Position (pos at -9)
  transform.property("Position").expression = [
    markerFind,
    "if (markerIdx < 0) [-9999, -9999];",
    "var p = pts[markerIdx - 9];",
    "p ? p : [-9999, -9999]",
  ].join("\n");

  // Size (size at -8)
  rect.property("Size").expression = [
    markerFind,
    "if (markerIdx < 0) [0, 0];",
    "var s = pts[markerIdx - 8];",
    "s ? s : [0, 0]",
  ].join("\n");

  // Rotation (rot at -7)
  transform.property("Rotation").expression = [
    markerFind,
    "if (markerIdx < 0) 0;",
    "var r = pts[markerIdx - 7];",
    "r ? r[0] : 0",
  ].join("\n");

  // Fill
  var fill = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Graphic - Fill");

  // Fill Color (fill1 at -6, fill2 at -5)
  fill.property("Color").expression = [
    markerFind,
    "if (markerIdx < 0) [1,1,1,1];",
    "var f1 = pts[markerIdx - 6], f2 = pts[markerIdx - 5];",
    "if (!f1 || f1[0] < 0) [0,0,0,0];",
    "[f1[0], f1[1], f2[0], 1]",
  ].join("\n");

  // Fill Opacity (opacity at -2, fillOpacity is first element)
  fill.property("Opacity").expression = [
    markerFind,
    "if (markerIdx < 0) 100;",
    "var op = pts[markerIdx - 2];",
    "op ? op[0] : 100",
  ].join("\n");

  // Stroke
  var stroke = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Graphic - Stroke");

  // Stroke Color (stroke1 at -4, stroke2 at -3)
  stroke.property("Color").expression = [
    markerFind,
    "if (markerIdx < 0) [0,0,0,1];",
    "var s1 = pts[markerIdx - 4], s2 = pts[markerIdx - 3];",
    "if (!s1 || s1[0] < 0) [0,0,0,0];",
    "[s1[0], s1[1], s2[0], 1]",
  ].join("\n");

  // Stroke Opacity (opacity at -2, strokeOpacity is second element)
  stroke.property("Opacity").expression = [
    markerFind,
    "if (markerIdx < 0) 100;",
    "var op = pts[markerIdx - 2];",
    "op ? op[1] : 100",
  ].join("\n");

  // Stroke Width (strokeWeight at -1)
  stroke.property("Stroke Width").expression = [
    markerFind,
    "if (markerIdx < 0) 1;",
    "var sw = pts[markerIdx - 1];",
    "sw ? sw[0] : 1",
  ].join("\n");
}

/**
 * line 数据结构 (slots=8):
 * [p1, p2, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
 * 偏移: p1=-8, p2=-7, fill1=-6, fill2=-5, stroke1=-4, stroke2=-3, opacity=-2, strokeWeight=-1
 */
function createLineFromContext(index, shapeIndex) {
  var layer = engineComp.layers.addShape();
  layer.name = "Shape_" + index;
  layer.property("Transform").property("Anchor Point").setValue([0, 0]);
  layer.property("Transform").property("Position").setValue([0, 0]);
  var shapeGroup = layer.property("Contents").addProperty("ADBE Vector Group");
  var path = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Shape - Group");

  var markerFind = _getMarkerFindExpr(1003, shapeIndex);

  // Path (p1 at -8, p2 at -7)
  path.property("Path").expression = [
    markerFind,
    "if (markerIdx < 0) createPath([[0,0]], [], [], false);",
    "var p1 = pts[markerIdx - 8], p2 = pts[markerIdx - 7];",
    "createPath([p1||[0,0], p2||[0,0]], [], [], false)",
  ].join("\n");

  // Stroke
  var stroke = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Graphic - Stroke");

  // Stroke Color (stroke1 at -4, stroke2 at -3)
  stroke.property("Color").expression = [
    markerFind,
    "if (markerIdx < 0) [0,0,0,1];",
    "var s1 = pts[markerIdx - 4], s2 = pts[markerIdx - 3];",
    "if (!s1 || s1[0] < 0) [0,0,0,0];",
    "[s1[0], s1[1], s2[0], 1]",
  ].join("\n");

  // Stroke Opacity (opacity at -2, strokeOpacity is second element)
  stroke.property("Opacity").expression = [
    markerFind,
    "if (markerIdx < 0) 100;",
    "var op = pts[markerIdx - 2];",
    "op ? op[1] : 100",
  ].join("\n");

  // Stroke Width (strokeWeight at -1)
  stroke.property("Stroke Width").expression = [
    markerFind,
    "if (markerIdx < 0) 2;",
    "var sw = pts[markerIdx - 1];",
    "sw ? sw[0] : 2",
  ].join("\n");
}

/**
 * point 数据结构 (slots=7):
 * [pos, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
 * 偏移: pos=-7, fill1=-6, fill2=-5, stroke1=-4, stroke2=-3, opacity=-2, strokeWeight=-1
 * 注意: point 使用 strokeWeight 控制点的大小，使用 stroke 颜色填充
 */
function createPointFromContext(index, shapeIndex) {
  var layer = engineComp.layers.addShape();
  layer.name = "Shape_" + index;
  layer.property("Transform").property("Anchor Point").setValue([0, 0]);
  layer.property("Transform").property("Position").setValue([0, 0]);
  var shapeGroup = layer.property("Contents").addProperty("ADBE Vector Group");
  var ellipse = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Shape - Ellipse");
  var transform = shapeGroup.property("Transform");

  var markerFind = _getMarkerFindExpr(1004, shapeIndex);

  // Position (pos at -7)
  transform.property("Position").expression = [
    markerFind,
    "if (markerIdx < 0) [-9999, -9999];",
    "var p = pts[markerIdx - 7];",
    "p ? p : [-9999, -9999]",
  ].join("\n");

  // Size (based on strokeWeight at -1)
  ellipse.property("Size").expression = [
    markerFind,
    "if (markerIdx < 0) [4,4];",
    "var sw = pts[markerIdx - 1];",
    "sw ? [sw[0]*2, sw[0]*2] : [4,4]",
  ].join("\n");

  // Fill (point uses stroke color as fill)
  var fill = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Graphic - Fill");

  // Fill Color (uses stroke1 at -4, stroke2 at -3)
  fill.property("Color").expression = [
    markerFind,
    "if (markerIdx < 0) [0,0,0,1];",
    "var s1 = pts[markerIdx - 4], s2 = pts[markerIdx - 3];",
    "if (!s1 || s1[0] < 0) [0,0,0,1];",
    "[s1[0], s1[1], s2[0], 1]",
  ].join("\n");

  // Fill Opacity (uses strokeOpacity from opacity at -2)
  fill.property("Opacity").expression = [
    markerFind,
    "if (markerIdx < 0) 100;",
    "var op = pts[markerIdx - 2];",
    "op ? op[1] : 100",
  ].join("\n");
}

function getShapeCollectionLib(shapeCounts) {
  return [
    "var _render = true;",
    // ellipse: [pos, size, rot, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
    "function _ellipse(a,b,c,d){if(_render){_ellipseCount++;var m=_ellipseCount;var p=_applyTransform(a,b);var s=[c*_scaleX,(d||c)*_scaleY];var r=[_rotation*180/Math.PI,0];var c2=_encodeColorState();var mk=[m,1001];_out=_out.concat([p,s,r,c2[0],c2[1],c2[2],c2[3],c2[4],c2[5],mk]);}}",
    // rect: [pos, size, rot, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
    "function _rect(a,b,c,d){if(_render){_rectCount++;var m=_rectCount;var w=c,h=d||c;var p=_applyTransform(a+w/2,b+h/2);var s=[w*_scaleX,h*_scaleY];var r=[_rotation*180/Math.PI,0];var c2=_encodeColorState();var mk=[m,1002];_out=_out.concat([p,s,r,c2[0],c2[1],c2[2],c2[3],c2[4],c2[5],mk]);}}",
    // line: [p1, p2, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
    "function _line(x1,y1,x2,y2){if(_render){_lineCount++;var m=_lineCount;var p1=_applyTransform(x1,y1);var p2=_applyTransform(x2,y2);var c2=_encodeColorState();var mk=[m,1003];_out=_out.concat([p1,p2,c2[0],c2[1],c2[2],c2[3],c2[4],c2[5],mk]);}}",
    // point: [pos, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
    "function _point(x,y){if(_render){_pointCount++;var m=_pointCount;var p=_applyTransform(x,y);var c2=_encodeColorState();var mk=[m,1004];_out=_out.concat([p,c2[0],c2[1],c2[2],c2[3],c2[4],c2[5],mk]);}}",
  ].join("\n");
}

/**
 * 获取形状函数库（根据依赖动态构建）
 * @param {Object} deps - 依赖对象，包含 shapes: { ellipse, rect, line, point }
 *
 * 形状数据格式说明：
 * - ellipse/rect: [pos, size, rot, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
 * - line: [p1, p2, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
 * - point: [pos, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
 *
 * 颜色编码 (_encodeColorState 返回):
 * - c2[0] = fill1: [r, g]
 * - c2[1] = fill2: [b, a]
 * - c2[2] = stroke1: [r, g]
 * - c2[3] = stroke2: [b, a]
 * - c2[4] = opacity: [fillOpacity, strokeOpacity] (0-100)
 * - c2[5] = strokeWeight: [weight, 0]
 */
function getShapeLib(deps) {
  if (!deps) deps = {};
  var funcs = [];

  // 渲染标记
  funcs.push("var _render = true;");

  // 计数器初始化
  if (deps.ellipse || deps.circle) {
    funcs.push("var _ellipseCount = 0;");
  }
  if (deps.rect || deps.square) {
    funcs.push("var _rectCount = 0;");
  }
  if (deps.line) {
    funcs.push("var _lineCount = 0;");
  }
  if (deps.point) {
    funcs.push("var _pointCount = 0;");
  }

  // 形状函数 - 包含新的 opacity 和 strokeWeight slots
  if (deps.ellipse || deps.circle) {
    funcs.push(
      "function _ellipse(a,b,c,d){if(_render){_ellipseCount++;var m=_ellipseCount;var p=_applyTransform(a,b);var s=[c*_scaleX,(d||c)*_scaleY];var r=[_rotation*180/Math.PI,0];var c2=_encodeColorState();var mk=[m,1001];_out=_out.concat([p,s,r,c2[0],c2[1],c2[2],c2[3],c2[4],c2[5],mk]);}}",
    );
  }
  if (deps.rect || deps.square) {
    funcs.push(
      "function _rect(a,b,c,d){if(_render){_rectCount++;var m=_rectCount;var w=c,h=d||c;var p=_applyTransform(a+w/2,b+h/2);var s=[w*_scaleX,h*_scaleY];var r=[_rotation*180/Math.PI,0];var c2=_encodeColorState();var mk=[m,1002];_out=_out.concat([p,s,r,c2[0],c2[1],c2[2],c2[3],c2[4],c2[5],mk]);}}",
    );
  }
  if (deps.line) {
    funcs.push(
      "function _line(x1,y1,x2,y2){if(_render){_lineCount++;var m=_lineCount;var p1=_applyTransform(x1,y1);var p2=_applyTransform(x2,y2);var c2=_encodeColorState();var mk=[m,1003];_out=_out.concat([p1,p2,c2[0],c2[1],c2[2],c2[3],c2[4],c2[5],mk]);}}",
    );
  }
  if (deps.point) {
    funcs.push(
      "function _point(x,y){if(_render){_pointCount++;var m=_pointCount;var p=_applyTransform(x,y);var c2=_encodeColorState();var mk=[m,1004];_out=_out.concat([p,c2[0],c2[1],c2[2],c2[3],c2[4],c2[5],mk]);}}",
    );
  }
  if (deps.background) {
    funcs.push("var _backgroundCount = 0;");
    funcs.push(getBackgroundLib());
  }

  return funcs.join("\n");
}
