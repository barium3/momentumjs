// ----------------------------------------
// Shape - 动态索引分配模式
// ----------------------------------------

// 从 registry 获取形状函数信息
// #include "registry.js"

// 获取图形类型的槽位数（使用 registry）
function getShapeSlots(type) {
  // 优先使用 registry
  if (typeof functionRegistry !== 'undefined' && functionRegistry.getShapeSlots) {
    return functionRegistry.getShapeSlots(type);
  }

  // 备用：硬编码的插槽定义
  var slots = {
    ellipse: 7,
    circle: 7,
    rect: 7,
    square: 7,
    line: 6,
    point: 5
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
      case "ellipse": createEllipseFromContext(i, shapeIndex); break;
      case "rect": createRectFromContext(i, shapeIndex); break;
      case "line": createLineFromContext(i, shapeIndex); break;
      case "point": createPointFromContext(i, shapeIndex); break;
    }
  }
}

function createEllipseFromContext(index, shapeIndex) {
  var layer = engineComp.layers.addShape();
  layer.name = "Shape_" + index;
  layer.property("Transform").property("Anchor Point").setValue([0, 0]);
  layer.property("Transform").property("Position").setValue([0, 0]);
  var shapeGroup = layer.property("Contents").addProperty("ADBE Vector Group");
  var ellipse = shapeGroup.property("Contents").addProperty("ADBE Vector Shape - Ellipse");
  var transform = shapeGroup.property("Transform");
  
  // ellipse 数据结构: [pos, size, rot, fill1, fill2, stroke1, stroke2, marker]
  // marker 在位置 N, pos 在 N-7, size 在 N-6, rot 在 N-5
  var expr = [
    'var ctx = thisComp.layer("__engine__").content("Program").content("Main").path;',
    'var pts = ctx.points();',
    'var targetType = 1001;',
    'var targetIndex = ' + shapeIndex + ';',
    'var markerIdx = -1;',
    'for (var i = pts.length - 1; i >= 0; i--) {',
    '  if (pts[i] && pts[i].length === 2 && pts[i][1] === targetType && pts[i][0] === targetIndex) {',
    '    markerIdx = i;',
    '    break;',
    '  }',
    '}',
    'if (markerIdx < 0) [-9999, -9999];',
    'var p = pts[markerIdx - 7];',
    'p ? p : [-9999, -9999]'
  ].join('\n');
  transform.property("Position").expression = expr;
  
  expr = [
    'var ctx = thisComp.layer("__engine__").content("Program").content("Main").path;',
    'var pts = ctx.points();',
    'var targetType = 1001;',
    'var targetIndex = ' + shapeIndex + ';',
    'var markerIdx = -1;',
    'for (var i = pts.length - 1; i >= 0; i--) {',
    '  if (pts[i] && pts[i].length === 2 && pts[i][1] === targetType && pts[i][0] === targetIndex) {',
    '    markerIdx = i;',
    '    break;',
    '  }',
    '}',
    'if (markerIdx < 0) [0, 0];',
    'var s = pts[markerIdx - 6];',
    's ? s : [0, 0]'
  ].join('\n');
  ellipse.property("Size").expression = expr;
  
  expr = [
    'var ctx = thisComp.layer("__engine__").content("Program").content("Main").path;',
    'var pts = ctx.points();',
    'var targetType = 1001;',
    'var targetIndex = ' + shapeIndex + ';',
    'var markerIdx = -1;',
    'for (var i = pts.length - 1; i >= 0; i--) {',
    '  if (pts[i] && pts[i].length === 2 && pts[i][1] === targetType && pts[i][0] === targetIndex) {',
    '    markerIdx = i;',
    '    break;',
    '  }',
    '}',
    'if (markerIdx < 0) 0;',
    'var r = pts[markerIdx - 5];',
    'r ? r[0] : 0'
  ].join('\n');
  transform.property("Rotation").expression = expr;
  
  var fill = shapeGroup.property("Contents").addProperty("ADBE Vector Graphic - Fill");
  // fill1 在 markerIdx-4, fill2 在 markerIdx-3
  expr = [
    'var ctx = thisComp.layer("__engine__").content("Program").content("Main").path;',
    'var pts = ctx.points();',
    'var targetType = 1001;',
    'var targetIndex = ' + shapeIndex + ';',
    'var markerIdx = -1;',
    'for (var i = pts.length - 1; i >= 0; i--) {',
    '  if (pts[i] && pts[i].length === 2 && pts[i][1] === targetType && pts[i][0] === targetIndex) {',
    '    markerIdx = i;',
    '    break;',
    '  }',
    '}',
    'if (markerIdx < 0) [1,1,1,1];',
    'var f1 = pts[markerIdx - 4], f2 = pts[markerIdx - 3];',
    'if (!f1 || f1[0] < 0) [0,0,0,0];',
    '[f1[0], f1[1], f2[0], f2[1]]'
  ].join('\n');
  fill.property("Color").expression = expr;
  
  var stroke = shapeGroup.property("Contents").addProperty("ADBE Vector Graphic - Stroke");
  // stroke1 在 markerIdx-2, stroke2 在 markerIdx-1
  expr = [
    'var ctx = thisComp.layer("__engine__").content("Program").content("Main").path;',
    'var pts = ctx.points();',
    'var targetType = 1001;',
    'var targetIndex = ' + shapeIndex + ';',
    'var markerIdx = -1;',
    'for (var i = pts.length - 1; i >= 0; i--) {',
    '  if (pts[i] && pts[i].length === 2 && pts[i][1] === targetType && pts[i][0] === targetIndex) {',
    '    markerIdx = i;',
    '    break;',
    '  }',
    '}',
    'if (markerIdx < 0) [0,0,0,1];',
    'var s1 = pts[markerIdx - 2], s2 = pts[markerIdx - 1];',
    'if (!s1 || s1[0] < 0) [0,0,0,0];',
    '[s1[0], s1[1], s2[0], 1]'
  ].join('\n');
  stroke.property("Color").expression = expr;
  
  expr = [
    'var ctx = thisComp.layer("__engine__").content("Program").content("Main").path;',
    'var pts = ctx.points();',
    'var targetType = 1001;',
    'var targetIndex = ' + shapeIndex + ';',
    'var markerIdx = -1;',
    'for (var i = pts.length - 1; i >= 0; i--) {',
    '  if (pts[i] && pts[i].length === 2 && pts[i][1] === targetType && pts[i][0] === targetIndex) {',
    '    markerIdx = i;',
    '    break;',
    '  }',
    '}',
    'if (markerIdx < 0) 1;',
    'var s2 = pts[markerIdx - 1];',
    's2 ? s2[1] : 1'
  ].join('\n');
  stroke.property("Stroke Width").expression = expr;
}

function createRectFromContext(index, shapeIndex) {
  var layer = engineComp.layers.addShape();
  layer.name = "Shape_" + index;
  layer.property("Transform").property("Anchor Point").setValue([0, 0]);
  layer.property("Transform").property("Position").setValue([0, 0]);
  var shapeGroup = layer.property("Contents").addProperty("ADBE Vector Group");
  var rect = shapeGroup.property("Contents").addProperty("ADBE Vector Shape - Rect");
  var transform = shapeGroup.property("Transform");
  
  var expr = [
    'var ctx = thisComp.layer("__engine__").content("Program").content("Main").path;',
    'var pts = ctx.points();',
    'var targetType = 1002;',
    'var targetIndex = ' + shapeIndex + ';',
    'var markerIdx = -1;',
    'for (var i = pts.length - 1; i >= 0; i--) {',
    '  if (pts[i] && pts[i].length === 2 && pts[i][1] === targetType && pts[i][0] === targetIndex) {',
    '    markerIdx = i;',
    '    break;',
    '  }',
    '}',
    'if (markerIdx < 0) [-9999, -9999];',
    'var p = pts[markerIdx - 7];',
    'p ? p : [-9999, -9999]'
  ].join('\n');
  transform.property("Position").expression = expr;
  
  expr = [
    'var ctx = thisComp.layer("__engine__").content("Program").content("Main").path;',
    'var pts = ctx.points();',
    'var targetType = 1002;',
    'var targetIndex = ' + shapeIndex + ';',
    'var markerIdx = -1;',
    'for (var i = pts.length - 1; i >= 0; i--) {',
    '  if (pts[i] && pts[i].length === 2 && pts[i][1] === targetType && pts[i][0] === targetIndex) {',
    '    markerIdx = i;',
    '    break;',
    '  }',
    '}',
    'if (markerIdx < 0) [0, 0];',
    'var s = pts[markerIdx - 6];',
    's ? s : [0, 0]'
  ].join('\n');
  rect.property("Size").expression = expr;
  
  expr = [
    'var ctx = thisComp.layer("__engine__").content("Program").content("Main").path;',
    'var pts = ctx.points();',
    'var targetType = 1002;',
    'var targetIndex = ' + shapeIndex + ';',
    'var markerIdx = -1;',
    'for (var i = pts.length - 1; i >= 0; i--) {',
    '  if (pts[i] && pts[i].length === 2 && pts[i][1] === targetType && pts[i][0] === targetIndex) {',
    '    markerIdx = i;',
    '    break;',
    '  }',
    '}',
    'if (markerIdx < 0) 0;',
    'var r = pts[markerIdx - 5];',
    'r ? r[0] : 0'
  ].join('\n');
  transform.property("Rotation").expression = expr;
  
  var fill = shapeGroup.property("Contents").addProperty("ADBE Vector Graphic - Fill");
  expr = [
    'var ctx = thisComp.layer("__engine__").content("Program").content("Main").path;',
    'var pts = ctx.points();',
    'var targetType = 1002;',
    'var targetIndex = ' + shapeIndex + ';',
    'var markerIdx = -1;',
    'for (var i = pts.length - 1; i >= 0; i--) {',
    '  if (pts[i] && pts[i].length === 2 && pts[i][1] === targetType && pts[i][0] === targetIndex) {',
    '    markerIdx = i;',
    '    break;',
    '  }',
    '}',
    'if (markerIdx < 0) [1,1,1,1];',
    'var f1 = pts[markerIdx - 4], f2 = pts[markerIdx - 3];',
    'if (!f1 || f1[0] < 0) [0,0,0,0];',
    '[f1[0], f1[1], f2[0], f2[1]]'
  ].join('\n');
  fill.property("Color").expression = expr;
  
  var stroke = shapeGroup.property("Contents").addProperty("ADBE Vector Graphic - Stroke");
  expr = [
    'var ctx = thisComp.layer("__engine__").content("Program").content("Main").path;',
    'var pts = ctx.points();',
    'var targetType = 1002;',
    'var targetIndex = ' + shapeIndex + ';',
    'var markerIdx = -1;',
    'for (var i = pts.length - 1; i >= 0; i--) {',
    '  if (pts[i] && pts[i].length === 2 && pts[i][1] === targetType && pts[i][0] === targetIndex) {',
    '    markerIdx = i;',
    '    break;',
    '  }',
    '}',
    'if (markerIdx < 0) [0,0,0,1];',
    'var s1 = pts[markerIdx - 2], s2 = pts[markerIdx - 1];',
    'if (!s1 || s1[0] < 0) [0,0,0,0];',
    '[s1[0], s1[1], s2[0], 1]'
  ].join('\n');
  stroke.property("Color").expression = expr;
  
  expr = [
    'var ctx = thisComp.layer("__engine__").content("Program").content("Main").path;',
    'var pts = ctx.points();',
    'var targetType = 1002;',
    'var targetIndex = ' + shapeIndex + ';',
    'var markerIdx = -1;',
    'for (var i = pts.length - 1; i >= 0; i--) {',
    '  if (pts[i] && pts[i].length === 2 && pts[i][1] === targetType && pts[i][0] === targetIndex) {',
    '    markerIdx = i;',
    '    break;',
    '  }',
    '}',
    'if (markerIdx < 0) 1;',
    'var s2 = pts[markerIdx - 1];',
    's2 ? s2[1] : 1'
  ].join('\n');
  stroke.property("Stroke Width").expression = expr;
}

function createLineFromContext(index, shapeIndex) {
  var layer = engineComp.layers.addShape();
  layer.name = "Shape_" + index;
  layer.property("Transform").property("Anchor Point").setValue([0, 0]);
  layer.property("Transform").property("Position").setValue([0, 0]);
  var shapeGroup = layer.property("Contents").addProperty("ADBE Vector Group");
  var path = shapeGroup.property("Contents").addProperty("ADBE Vector Shape - Group");
  
  // line 数据结构: [p1, p2, fill1, fill2, stroke1, stroke2, marker]
  var expr = [
    'var ctx = thisComp.layer("__engine__").content("Program").content("Main").path;',
    'var pts = ctx.points();',
    'var targetType = 1003;',
    'var targetIndex = ' + shapeIndex + ';',
    'var markerIdx = -1;',
    'for (var i = pts.length - 1; i >= 0; i--) {',
    '  if (pts[i] && pts[i].length === 2 && pts[i][1] === targetType && pts[i][0] === targetIndex) {',
    '    markerIdx = i;',
    '    break;',
    '  }',
    '}',
    'if (markerIdx < 0) createPath([[0,0]], [], [], false);',
    'var p1 = pts[markerIdx - 5], p2 = pts[markerIdx - 4];',
    'createPath([p1||[0,0], p2||[0,0]], [], [], false)'
  ].join('\n');
  path.property("Path").expression = expr;
  
  var stroke = shapeGroup.property("Contents").addProperty("ADBE Vector Graphic - Stroke");
  expr = [
    'var ctx = thisComp.layer("__engine__").content("Program").content("Main").path;',
    'var pts = ctx.points();',
    'var targetType = 1003;',
    'var targetIndex = ' + shapeIndex + ';',
    'var markerIdx = -1;',
    'for (var i = pts.length - 1; i >= 0; i--) {',
    '  if (pts[i] && pts[i].length === 2 && pts[i][1] === targetType && pts[i][0] === targetIndex) {',
    '    markerIdx = i;',
    '    break;',
    '  }',
    '}',
    'if (markerIdx < 0) [0,0,0,1];',
    'var s1 = pts[markerIdx - 2], s2 = pts[markerIdx - 1];',
    'if (!s1 || s1[0] < 0) [0,0,0,0];',
    '[s1[0], s1[1], s2[0], 1]'
  ].join('\n');
  stroke.property("Color").expression = expr;
  
  expr = [
    'var ctx = thisComp.layer("__engine__").content("Program").content("Main").path;',
    'var pts = ctx.points();',
    'var targetType = 1003;',
    'var targetIndex = ' + shapeIndex + ';',
    'var markerIdx = -1;',
    'for (var i = pts.length - 1; i >= 0; i--) {',
    '  if (pts[i] && pts[i].length === 2 && pts[i][1] === targetType && pts[i][0] === targetIndex) {',
    '    markerIdx = i;',
    '    break;',
    '  }',
    '}',
    'if (markerIdx < 0) 2;',
    'var s2 = pts[markerIdx - 1];',
    's2 ? s2[1] : 2'
  ].join('\n');
  stroke.property("Stroke Width").expression = expr;
}

function createPointFromContext(index, shapeIndex) {
  var layer = engineComp.layers.addShape();
  layer.name = "Shape_" + index;
  layer.property("Transform").property("Anchor Point").setValue([0, 0]);
  layer.property("Transform").property("Position").setValue([0, 0]);
  var shapeGroup = layer.property("Contents").addProperty("ADBE Vector Group");
  var ellipse = shapeGroup.property("Contents").addProperty("ADBE Vector Shape - Ellipse");
  var transform = shapeGroup.property("Transform");
  
  // point 数据结构: [pos, fill1, fill2, stroke1, stroke2, marker]
  var expr = [
    'var ctx = thisComp.layer("__engine__").content("Program").content("Main").path;',
    'var pts = ctx.points();',
    'var targetType = 1004;',
    'var targetIndex = ' + shapeIndex + ';',
    'var markerIdx = -1;',
    'for (var i = pts.length - 1; i >= 0; i--) {',
    '  if (pts[i] && pts[i].length === 2 && pts[i][1] === targetType && pts[i][0] === targetIndex) {',
    '    markerIdx = i;',
    '    break;',
    '  }',
    '}',
    'if (markerIdx < 0) [-9999, -9999];',
    'var p = pts[markerIdx - 5];',
    'p ? p : [-9999, -9999]'
  ].join('\n');
  transform.property("Position").expression = expr;
  
  expr = [
    'var ctx = thisComp.layer("__engine__").content("Program").content("Main").path;',
    'var pts = ctx.points();',
    'var targetType = 1004;',
    'var targetIndex = ' + shapeIndex + ';',
    'var markerIdx = -1;',
    'for (var i = pts.length - 1; i >= 0; i--) {',
    '  if (pts[i] && pts[i].length === 2 && pts[i][1] === targetType && pts[i][0] === targetIndex) {',
    '    markerIdx = i;',
    '    break;',
    '  }',
    '}',
    'if (markerIdx < 0) [4,4];',
    'var s = pts[markerIdx - 1];',
    's ? [s[1]*2, s[1]*2] : [4,4]'
  ].join('\n');
  ellipse.property("Size").expression = expr;
  
  var fill = shapeGroup.property("Contents").addProperty("ADBE Vector Graphic - Fill");
  expr = [
    'var ctx = thisComp.layer("__engine__").content("Program").content("Main").path;',
    'var pts = ctx.points();',
    'var targetType = 1004;',
    'var targetIndex = ' + shapeIndex + ';',
    'var markerIdx = -1;',
    'for (var i = pts.length - 1; i >= 0; i--) {',
    '  if (pts[i] && pts[i].length === 2 && pts[i][1] === targetType && pts[i][0] === targetIndex) {',
    '    markerIdx = i;',
    '    break;',
    '  }',
    '}',
    'if (markerIdx < 0) [0,0,0,1];',
    'var s1 = pts[markerIdx - 2], s2 = pts[markerIdx - 1];',
    'if (!s1 || s1[0] < 0) [0,0,0,1];',
    '[s1[0], s1[1], s2[0], 1]'
  ].join('\n');
  fill.property("Color").expression = expr;
}

function getShapeCollectionLib(shapeCounts) {
  return [
    "var _render = true;",
    "function _ellipse(a,b,c,d){if(_render){_ellipseCount++;var m=_ellipseCount;var p=_applyTransform(a,b);var s=[c*_scaleX,(d||c)*_scaleY];var r=[_rotation*180/Math.PI,0];var c2=_encodeColorState();var mk=[m,1001];_out=_out.concat([p,s,r,c2[0],c2[1],c2[2],c2[3],mk]);}}",
    "function _rect(a,b,c,d){if(_render){_rectCount++;var m=_rectCount;var w=c,h=d||c;var p=_applyTransform(a+w/2,b+h/2);var s=[w*_scaleX,h*_scaleY];var r=[_rotation*180/Math.PI,0];var c2=_encodeColorState();var mk=[m,1002];_out=_out.concat([p,s,r,c2[0],c2[1],c2[2],c2[3],mk]);}}",
    "function _line(x1,y1,x2,y2){if(_render){_lineCount++;var m=_lineCount;var p1=_applyTransform(x1,y1);var p2=_applyTransform(x2,y2);var c2=_encodeColorState();var mk=[m,1003];_out=_out.concat([p1,p2,c2[0],c2[1],c2[2],c2[3],mk]);}}",
    "function _point(x,y){if(_render){_pointCount++;var m=_pointCount;var p=_applyTransform(x,y);var c2=_encodeColorState();var mk=[m,1004];_out=_out.concat([p,c2[0],c2[1],c2[2],c2[3],mk]);}}"
  ].join("\n");
}

/**
 * 获取形状函数库（根据依赖动态构建）
 * @param {Object} deps - 依赖对象，包含 shapes: { ellipse, rect, line, point }
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

  // 形状函数
  if (deps.ellipse || deps.circle) {
    funcs.push("function _ellipse(a,b,c,d){if(_render){_ellipseCount++;var m=_ellipseCount;var p=_applyTransform(a,b);var s=[c*_scaleX,(d||c)*_scaleY];var r=[_rotation*180/Math.PI,0];var c2=_encodeColorState();var mk=[m,1001];_out=_out.concat([p,s,r,c2[0],c2[1],c2[2],c2[3],mk]);}}");
  }
  if (deps.rect || deps.square) {
    funcs.push("function _rect(a,b,c,d){if(_render){_rectCount++;var m=_rectCount;var w=c,h=d||c;var p=_applyTransform(a+w/2,b+h/2);var s=[w*_scaleX,h*_scaleY];var r=[_rotation*180/Math.PI,0];var c2=_encodeColorState();var mk=[m,1002];_out=_out.concat([p,s,r,c2[0],c2[1],c2[2],c2[3],mk]);}}");
  }
  if (deps.line) {
    funcs.push("function _line(x1,y1,x2,y2){if(_render){_lineCount++;var m=_lineCount;var p1=_applyTransform(x1,y1);var p2=_applyTransform(x2,y2);var c2=_encodeColorState();var mk=[m,1003];_out=_out.concat([p1,p2,c2[0],c2[1],c2[2],c2[3],mk]);}}");
  }
  if (deps.point) {
    funcs.push("function _point(x,y){if(_render){_pointCount++;var m=_pointCount;var p=_applyTransform(x,y);var c2=_encodeColorState();var mk=[m,1004];_out=_out.concat([p,c2[0],c2[1],c2[2],c2[3],mk]);}}");
  }

  return funcs.join("\n");
}
