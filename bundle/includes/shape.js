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
    arc: 10,
    quad: 10,
    triangle: 9,
    rect: 9,
    square: 9,
    line: 8,
    point: 7,
    background: 3,
    polygon: 9,
  };
  return slots[type] || 7;
}

/**
 * 创建形状图层
 * 根据 shapeQueue 中的数据创建对应的 AE 图层
 */
function createShapeLayers(mainCompName) {
  if (shapeQueue.length === 0) return;
  
  // 形状类型到创建函数的映射表
  var shapeCreators = {
    ellipse: createEllipseFromContext,
    arc: createArcFromContext,
    quad: createQuadFromContext,
    triangle: createTriangleFromContext,
    polygon: createPolygonFromContext,
    rect: createRectFromContext,
    line: createLineFromContext,
    point: createPointFromContext,
    background: createBackgroundFromContext,
    bezier: createBezierFromContext,
    curve: createCurveFromContext
  };
  
  for (var i = 0; i < shapeQueue.length; i++) {
    var shape = shapeQueue[i];
    var shapeIndex = shape.shapeIndex || 1;
    var creator = shapeCreators[shape.type];
    if (creator) {
      creator(i, shapeIndex, mainCompName);
    }
  }
}

/**
 * 生成查找 marker 的表达式代码片段
 * @param {number} markerType - marker 类型代码
 * @param {number} shapeIndex - 形状索引
 * @param {string} mainCompName - 主合成名称（可选，如果提供则从主合成读取）
 */
function _getMarkerFindExpr(markerType, shapeIndex, mainCompName) {
  var engineLayerExpr;
  if (mainCompName) {
    // 从主合成读取，通过合成名称直接调用
    // 转义合成名称中的引号（如果存在）
    var escapedName = mainCompName.replace(/"/g, '\\"');
    engineLayerExpr = 'comp("' + escapedName + '").layer("__engine__").text.sourceText';
  } else {
    // 从当前合成读取
    engineLayerExpr = 'thisComp.layer("__engine__").text.sourceText';
  }
  
  return [
    'var raw = ' + engineLayerExpr + ';',
    "var json = raw && raw.toString ? raw.toString() : raw;",
    "var data = JSON.parse(json);",
    "var shapes = data.shapes || [];",
    "var targetType = " + markerType + ";",
    "var targetIndex = " + shapeIndex + ";",
    "var shape = null;",
    "for (var i = shapes.length - 1; i >= 0; i--) {",
    "  var mk = shapes[i].marker;",
    "  if (mk && mk.length === 2 && mk[1] === targetType && mk[0] === targetIndex) {",
    "    shape = shapes[i];",
    "    break;",
    "  }",
    "}",
  ].join("\n");
}

/**
 * 创建基础形状图层和组
 * @param {number} index - 形状索引
 * @returns {Object} 包含 layer 和 shapeGroup 的对象
 */
function _createBaseShapeLayer(index) {
  var layer = engineComp.layers.addShape();
  layer.name = "Shape_" + index;
  layer.property("Transform").property("Anchor Point").setValue([0, 0]);
  layer.property("Transform").property("Position").setValue([0, 0]);
  var shapeGroup = layer.property("Contents").addProperty("ADBE Vector Group");
  return { layer: layer, shapeGroup: shapeGroup };
}

/**
 * 生成 Fill 颜色表达式
 * @param {string} markerFind - marker 查找表达式
 * @returns {string} Fill 颜色表达式
 */
function _getFillColorExpr(markerFind) {
  return [
    markerFind,
    "if (!shape || !shape.fillColor) [0,0,0,0];",
    "var fc = shape.fillColor;",
    "[fc[0], fc[1], fc[2], 1]",
  ].join("\n");
}

/**
 * 生成 Fill 透明度表达式
 * @param {string} markerFind - marker 查找表达式
 * @returns {string} Fill 透明度表达式
 */
function _getFillOpacityExpr(markerFind) {
  return [
    markerFind,
    "if (!shape) 100;",
    "shape.fillOpacity !== undefined ? shape.fillOpacity : 100",
  ].join("\n");
}

/**
 * 生成 Stroke 颜色表达式
 * @param {string} markerFind - marker 查找表达式
 * @returns {string} Stroke 颜色表达式
 */
function _getStrokeColorExpr(markerFind) {
  return [
    markerFind,
    "if (!shape || !shape.strokeColor) [0,0,0,0];",
    "var sc = shape.strokeColor;",
    "[sc[0], sc[1], sc[2], 1]",
  ].join("\n");
}

/**
 * 生成 Stroke 透明度表达式
 * @param {string} markerFind - marker 查找表达式
 * @returns {string} Stroke 透明度表达式
 */
function _getStrokeOpacityExpr(markerFind) {
  return [
    markerFind,
    "if (!shape) 100;",
    "shape.strokeOpacity !== undefined ? shape.strokeOpacity : 100",
  ].join("\n");
}

/**
 * 生成 Stroke 宽度表达式
 * @param {string} markerFind - marker 查找表达式
 * @param {number} defaultValue - 默认宽度值
 * @returns {string} Stroke 宽度表达式
 */
function _getStrokeWidthExpr(markerFind, defaultValue) {
  defaultValue = defaultValue !== undefined ? defaultValue : 1;
  return [
    markerFind,
    "if (!shape) " + defaultValue + ";",
    "shape.strokeWeight !== undefined ? shape.strokeWeight : " + defaultValue,
  ].join("\n");
}

/**
 * 生成 Position 表达式
 * @param {string} markerFind - marker 查找表达式
 * @returns {string} Position 表达式
 */
function _getPositionExpr(markerFind) {
  return [
    markerFind,
    "!shape ? [-9999, -9999] : (function() {",
    "var p = shape.pos;",
    "return p ? [p[0], p[1]] : [-9999, -9999];",
    "})()",
  ].join("\n");
}

/**
 * 生成 Rotation 表达式
 * @param {string} markerFind - marker 查找表达式
 * @returns {string} Rotation 表达式
 */
function _getRotationExpr(markerFind) {
  return [
    markerFind,
    "if (!shape) 0;",
    "shape.rot !== undefined ? shape.rot : 0",
  ].join("\n");
}

/**
 * 为形状组添加 Fill 属性
 * @param {Object} shapeGroup - 形状组
 * @param {string} markerFind - marker 查找表达式
 * @returns {Object} Fill 属性对象
 */
function _addFillProperties(shapeGroup, markerFind) {
  var fill = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Graphic - Fill");
  fill.property("Color").expression = _getFillColorExpr(markerFind);
  fill.property("Opacity").expression = _getFillOpacityExpr(markerFind);
  return fill;
}

/**
 * 为形状组添加 Stroke 属性
 * @param {Object} shapeGroup - 形状组
 * @param {string} markerFind - marker 查找表达式
 * @param {number} defaultWidth - 默认描边宽度
 * @returns {Object} Stroke 属性对象
 */
function _addStrokeProperties(shapeGroup, markerFind, defaultWidth) {
  var stroke = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Graphic - Stroke");
  stroke.property("Color").expression = _getStrokeColorExpr(markerFind);
  stroke.property("Opacity").expression = _getStrokeOpacityExpr(markerFind);
  stroke.property("Stroke Width").expression = _getStrokeWidthExpr(markerFind, defaultWidth);
  return stroke;
}

/**
 * 生成 arc 路径表达式
 * @param {string} markerFind - marker 查找表达式
 * @param {number} defaultMode - 默认模式（0=OPEN, 1=CHORD, 2=PIE）
 * @returns {string} arc 路径表达式
 */
function _getArcPathExpr(markerFind, defaultMode) {
  var modeCode = defaultMode || 0;
  return [
    markerFind,
    "if (!shape) createPath([[-9999,-9999]], [], [], false);",
    "var pos = shape.pos;",
    "var size = shape.size;",
    "var angs = shape.angles;",
    "var mode = shape.mode;",
    "if (!pos || !size || !angs) createPath([[-9999,-9999]], [], [], false);",
    "var cx = pos[0];",
    "var cy = pos[1];",
    "var w = size[0];",
    "var h = size[1];",
    "var rx = w/2;",
    "var ry = h/2;",
    "var start = angs[0];",
    "var stop = angs[1];",
    "// 规范化角度（确保非 NaN）",
    "if (!(start===start) || !(stop===stop)) createPath([[-9999,-9999]], [], [], false);",
    "if (start === stop) createPath([[-9999,-9999]], [], [], false);",
    "// 将 stop 规范化到 >= start 的范围，接近 p5 的行为",
    "while (stop < start) { stop += Math.PI*2; }",
    "var total = stop - start;",
    "if (total <= 0) createPath([[-9999,-9999]], [], [], false);",
    "var segs = Math.ceil(total / (Math.PI/2));",
    "if (segs < 1) segs = 1;",
    "if (segs > 4) segs = 4;",
    "var step = total / segs;",
    "var verts = [];",
    "var ins = [];",
    "var outs = [];",
    "var i;",
    "for (i = 0; i <= segs; i++) {",
    "  var a = start + step * i;",
    "  var cosA = Math.cos(a);",
    "  var sinA = Math.sin(a);",
    "  verts.push([cx + rx * cosA, cy + ry * sinA]);",
    "  ins.push([0,0]);",
    "  outs.push([0,0]);",
    "}",
    "// 为每段计算贝塞尔切线（Kappa 公式）",
    "for (i = 0; i < segs; i++) {",
    "  var a0 = start + step * i;",
    "  var a1 = start + step * (i+1);",
    "  var delta = a1 - a0;",
    "  var k = (4/3) * Math.tan(delta/4);",
    "  var c0 = Math.cos(a0);",
    "  var s0 = Math.sin(a0);",
    "  var c1 = Math.cos(a1);",
    "  var s1 = Math.sin(a1);",
    "  // 起点的 out 切线",
    "  outs[i] = [k * -rx * s0, k * ry * c0];",
    "  // 终点的 in 切线",
    "  ins[i+1] = [k * rx * s1, k * -ry * c1];",
    "}",
    "// 处理模式：0=OPEN, 1=CHORD, 2=PIE（与 p5 arc 对齐）",
    "var auto = (mode && mode.length > 1) ? mode[1] : 0;",
    "var mcode = (mode && mode.length > 0) ? mode[0] : " + modeCode + ";",
    "if (auto === 1) {",
    "  // 默认模式：根据 defaultMode 设置",
    "  mcode = " + modeCode + ";",
    "}",
    "mcode = Math.floor(mcode + 0.5);",
    "if (mcode < 0) mcode = 0;",
    "if (mcode > 2) mcode = 2;",
    "var closed = false;",
    "if (mcode === 2) {",
    "  // PIE: 在前面插入圆心顶点，形成扇形",
    "  verts.unshift([cx, cy]);",
    "  ins.unshift([0,0]);",
    "  outs.unshift([0,0]);",
    "  closed = true;",
    "} else if (mcode === 1) {",
    "  // CHORD: 闭合，自动用直线连接弧线两端",
    "  closed = true;",
    "} else {",
    "  closed = false;",
    "}",
    "createPath(verts, ins, outs, closed);",
  ].join("\n");
}

/**
 * ellipse 数据结构 (slots=9):
 * [pos, size, rot, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
 * 偏移: pos=-9, size=-8, rot=-7, fill1=-6, fill2=-5, stroke1=-4, stroke2=-3, opacity=-2, strokeWeight=-1
 */
function createEllipseFromContext(index, shapeIndex, mainCompName) {
  var base = _createBaseShapeLayer(index);
  var shapeGroup = base.shapeGroup;
  var ellipse = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Shape - Ellipse");
  var transform = shapeGroup.property("Transform");

  var markerFind = _getMarkerFindExpr(1001, shapeIndex, mainCompName);

  // Position (pos at -9)
  transform.property("Position").expression = _getPositionExpr(markerFind);

  // Size (size at -8)
  ellipse.property("Size").expression = [
    markerFind,
    "!shape ? [0, 0] : (function() {",
    "var s = shape.size;",
    "return s ? [s[0], s[1]] : [0, 0];",
    "})()",
  ].join("\n");

  // Rotation (rot at -7)
  transform.property("Rotation").expression = _getRotationExpr(markerFind);

  // Fill and Stroke
  _addFillProperties(shapeGroup, markerFind);
  _addStrokeProperties(shapeGroup, markerFind, 1);
}

/**
 * polygon 数据结构（语义化 JSON）:
 * {
 *   id, marker, markerType,
 *   type: "polygon",
 *   points: [[x,y], ...],    // 已应用当前变换后的顶点（主轮廓）
 *   contours: [[[x,y], ...], ...],  // 所有轮廓数组，包括主轮廓和子轮廓（洞）
 *   closed: true/false,      // 是否闭合（endShape(CLOSE)）
 *   fillColor, strokeColor,  // [r,g,b,a] 或 null
 *   fillOpacity, strokeOpacity,
 *   strokeWeight
 * }
 *
 * 顶点数量可变，支持多个轮廓（洞形）。
 * 主轮廓从 points 构建，子轮廓从 contours 数组构建。
 */
function createPolygonFromContext(index, shapeIndex, mainCompName) {
  var base = _createBaseShapeLayer(index);
  var shapeGroup = base.shapeGroup;

  var markerFind = _getMarkerFindExpr(1009, shapeIndex, mainCompName);

  // 主路径 Group：包含主路径和子轮廓路径（复合路径）
  var mainPathGroup = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Shape - Group");

  // 主路径：从 contours[0] 构建（主轮廓），如果没有 contours 则使用 points（向后兼容）
  // 注意：在 After Effects 中，要创建带洞的路径，需要在同一个 Vector Group 内
  // 主路径和子轮廓路径都需要在同一个 Group 中，且子轮廓需要反向
  mainPathGroup.property("Path").expression = [
    markerFind,
    "if (!shape) {",
    "  createPath([[-9999,-9999]], [], [], false);",
    "} else {",
    "  // 优先使用 contours[0]（主轮廓），如果没有则使用 points（向后兼容）",
    "  var pts = null;",
    "  if (shape.contours && shape.contours.length > 0) {",
    "    pts = shape.contours[0];",
    "  } else if (shape.points && shape.points.length > 0) {",
    "    pts = shape.points;",
    "  }",
    "  if (!pts || pts.length < 2) {",
    "    createPath([[-9999,-9999]], [], [], false);",
    "  } else {",
    "    var n = pts.length;",
    "    var verts = [];",
    "    var ins = [];",
    "    var outs = [];",
    "    for (var i = 0; i < n; i++) {",
    "      var p = pts[i] || [-9999,-9999];",
    "      verts.push(p);",
    "      ins.push([0,0]);",
    "      outs.push([0,0]);",
    "    }",
    "    var closed = !!shape.closed;",
    "    createPath(verts, ins, outs, closed);",
    "  }",
    "}",
  ].join("\n");

  // 子轮廓路径：只在代码中实际调用了 beginContour() 时才创建
  // 检查依赖信息，判断是否使用了 beginContour
  var hasBeginContour = false;
  if (typeof globalDeps !== "undefined" && globalDeps !== null) {
    if (globalDeps.shapes && globalDeps.shapes.beginContour) {
      hasBeginContour = true;
    }
  }
  
  // 只有在使用了 beginContour 时才创建子路径组
  if (hasBeginContour) {
    // 在 After Effects 中，要创建复合路径（带洞），子轮廓路径必须在同一个 Vector Group 内
    // 并且需要设置为反向（通过 Reverse Path 属性实现）
    // 注意：ADBE Vector Shape - Group 没有 Contents 属性，需要在 shapeGroup 下创建
    var contourPathGroup = shapeGroup
      .property("Contents")
      .addProperty("ADBE Vector Shape - Group");
    
    // 设置子轮廓路径为反向（Reverse Path）
    // After Effects 中，Shape Group 的 "Reverse Path" 属性用于创建洞
    // 必须在脚本中设置，而不是在表达式中
    // 注意：Reverse Path 属性可能在创建 Path 属性后才可用，所以需要先创建 Path 属性
    var reversePropSet = false;
    
    // 方法1：尝试通过属性名 "ADBE Vector Reversed" 设置
    try {
      var reverseProp = contourPathGroup.property("ADBE Vector Reversed");
      if (reverseProp) {
        reverseProp.setValue(true);
        reversePropSet = true;
      }
    } catch (e) {
      // 继续尝试其他方法
    }
    

    
    // 子轮廓路径：从 contours[1] 开始构建（第一个子轮廓）
    // 注意：不在表达式中反转顶点顺序，反转由脚本中的 Reverse Path 属性处理
    contourPathGroup.property("Path").expression = [
      markerFind,
      "// 使用第一个子轮廓（contours[1]）",
      "var contour = shape.contours[1];",
      "if (!contour || contour.length < 2) {",
      "  createPath([[-9999,-9999]], [], [], false);",
      "} else {",
      "  var verts = [];",
      "  var ins = [];",
      "  var outs = [];",
      "  var n = contour.length;",
      "  // 保持原始顶点顺序，反转由脚本中的 Reverse Path 属性处理",
      "  for (var j = 0; j < n; j++) {",
      "    var p = contour[j] || [-9999,-9999];",
      "    verts.push(p);",
      "    ins.push([0,0]);",
      "    outs.push([0,0]);",
      "  }",
      "  // 子轮廓（洞）应该闭合",
      "  createPath(verts, ins, outs, true);",
      "}",
    ].join("\n");
    
    // 在创建 Path 属性后，再次尝试设置 Reverse Path 属性
    // 因为 Reverse Path 属性可能在 Path 属性创建后才可用
    if (!reversePropSet) {
      try {
        var reverseProp = contourPathGroup.property("ADBE Vector Reversed");
        if (reverseProp) {
          reverseProp.setValue(true);
          reversePropSet = true;
        }
      } catch (e) {
        // 如果失败，继续执行
      }
    }
  }

  // Fill and Stroke
  _addFillProperties(shapeGroup, markerFind);
  _addStrokeProperties(shapeGroup, markerFind, 1);
}

/**
 * rect 数据结构 (slots=9):
 * [pos, size, rot, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
 * 偏移: pos=-9, size=-8, rot=-7, fill1=-6, fill2=-5, stroke1=-4, stroke2=-3, opacity=-2, strokeWeight=-1
 */
function createRectFromContext(index, shapeIndex, mainCompName) {
  var base = _createBaseShapeLayer(index);
  var shapeGroup = base.shapeGroup;
  var rect = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Shape - Rect");
  var transform = shapeGroup.property("Transform");

  var markerFind = _getMarkerFindExpr(1002, shapeIndex, mainCompName);

  // Position (pos at -9)
  transform.property("Position").expression = _getPositionExpr(markerFind);

  // Size (size at -8)
  rect.property("Size").expression = [
    markerFind,
    "!shape ? [0, 0] : (function() {",
    "var s = shape.size;",
    "return s ? [s[0], s[1]] : [0, 0];",
    "})()",
  ].join("\n");

  // Rotation (rot at -7)
  transform.property("Rotation").expression = _getRotationExpr(markerFind);

  // Fill and Stroke
  _addFillProperties(shapeGroup, markerFind);
  _addStrokeProperties(shapeGroup, markerFind, 1);
}

/**
 * quad 数据结构 (slots=10):
 * [p1, p2, p3, p4, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
 * 偏移:
 *   p1         = -10
 *   p2         = -9
 *   p3         = -8
 *   p4         = -7
 *   fill1      = -6
 *   fill2      = -5
 *   stroke1    = -4
 *   stroke2    = -3
 *   opacity    = -2
 *   strokeWeight = -1
 */
function createQuadFromContext(index, shapeIndex, mainCompName) {
  var base = _createBaseShapeLayer(index);
  var shapeGroup = base.shapeGroup;

  var path = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Shape - Group");

  var markerFind = _getMarkerFindExpr(1007, shapeIndex, mainCompName);

  // Path (p1~p4 at -10..-7)
  path.property("Path").expression = [
    markerFind,
    "if (!shape || !shape.points || shape.points.length < 4) createPath([[-9999,-9999]], [], [], false);",
    "var p1 = shape.points[0];",
    "var p2 = shape.points[1];",
    "var p3 = shape.points[2];",
    "var p4 = shape.points[3];",
    "if (!p1 || !p2 || !p3 || !p4) createPath([[-9999,-9999]], [], [], false);",
    "var verts = [p1, p2, p3, p4];",
    "var ins = [[0,0],[0,0],[0,0],[0,0]];",
    "var outs = [[0,0],[0,0],[0,0],[0,0]];",
    "createPath(verts, ins, outs, true);",
  ].join("\n");

  // Fill and Stroke
  _addFillProperties(shapeGroup, markerFind);
  _addStrokeProperties(shapeGroup, markerFind, 1);
}

/**
 * triangle 数据结构 (slots=9):
 * [p1, p2, p3, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
 * 偏移:
 *   p1         = -9
 *   p2         = -8
 *   p3         = -7
 *   fill1      = -6
 *   fill2      = -5
 *   stroke1    = -4
 *   stroke2    = -3
 *   opacity    = -2
 *   strokeWeight = -1
 */
function createTriangleFromContext(index, shapeIndex, mainCompName) {
  var base = _createBaseShapeLayer(index);
  var shapeGroup = base.shapeGroup;

  var path = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Shape - Group");

  var markerFind = _getMarkerFindExpr(1008, shapeIndex, mainCompName);

  // Path (p1~p3 at -9..-7)
  path.property("Path").expression = [
    markerFind,
    "if (!shape || !shape.points || shape.points.length < 3) createPath([[-9999,-9999]], [], [], false);",
    "var p1 = shape.points[0];",
    "var p2 = shape.points[1];",
    "var p3 = shape.points[2];",
    "if (!p1 || !p2 || !p3) createPath([[-9999,-9999]], [], [], false);",
    "var verts = [p1, p2, p3];",
    "var ins = [[0,0],[0,0],[0,0]];",
    "var outs = [[0,0],[0,0],[0,0]];",
    "createPath(verts, ins, outs, true);",
  ].join("\n");

  // Fill and Stroke
  _addFillProperties(shapeGroup, markerFind);
  _addStrokeProperties(shapeGroup, markerFind, 1);
}

/**
 * line 数据结构 (slots=8):
 * [p1, p2, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
 * 偏移: p1=-8, p2=-7, fill1=-6, fill2=-5, stroke1=-4, stroke2=-3, opacity=-2, strokeWeight=-1
 */
function createLineFromContext(index, shapeIndex, mainCompName) {
  var base = _createBaseShapeLayer(index);
  var shapeGroup = base.shapeGroup;
  var path = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Shape - Group");

  var markerFind = _getMarkerFindExpr(1003, shapeIndex, mainCompName);

  // Path (p1 at -8, p2 at -7)
  path.property("Path").expression = [
    markerFind,
    "if (!shape || !shape.points || shape.points.length < 2) createPath([[-9999,-9999],[-9999,-9999]], [], [], false);",
    "var p1 = shape.points[0], p2 = shape.points[1];",
    "createPath([p1||[-9999,-9999], p2||[-9999,-9999]], [], [], false)",
  ].join("\n");

  // Stroke only (line has no fill)
  _addStrokeProperties(shapeGroup, markerFind, 2);
}

/**
 * point 数据结构 (slots=7):
 * [pos, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
 * 偏移: pos=-7, fill1=-6, fill2=-5, stroke1=-4, stroke2=-3, opacity=-2, strokeWeight=-1
 * 注意: point 使用 strokeWeight 控制点的大小，使用 stroke 颜色填充
 */
function createPointFromContext(index, shapeIndex, mainCompName) {
  var base = _createBaseShapeLayer(index);
  var shapeGroup = base.shapeGroup;
  var ellipse = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Shape - Ellipse");
  var transform = shapeGroup.property("Transform");

  var markerFind = _getMarkerFindExpr(1004, shapeIndex, mainCompName);

  // Position (pos at -7)
  transform.property("Position").expression = _getPositionExpr(markerFind);

  // Size (based on strokeWeight at -1, 与 p5 对齐：strokeWeight 直接作为直径)
  ellipse.property("Size").expression = [
    markerFind,
    "if (!shape) [2,2];",
    "var d = shape.size;",
    "d ? [d[0], d[1]] : [2,2]",
  ].join("\n");

  // Fill (point uses stroke color as fill, but stored in fillColor)
  var fill = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Graphic - Fill");
  fill.property("Color").expression = [
    markerFind,
    "if (!shape || !shape.fillColor) [0,0,0,1];",
    "var fc = shape.fillColor;",
    "[fc[0], fc[1], fc[2], 1]",
  ].join("\n");
  fill.property("Opacity").expression = [
    markerFind,
    "if (!shape) 100;",
    "shape.strokeOpacity !== undefined ? shape.strokeOpacity : 100",
  ].join("\n");
}

/**
 * bezier 数据结构 (slots=10):
 * [p1, p2, p3, p4, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
 * 偏移: p1=-10, p2=-9, p3=-8, p4=-7, fill1=-6, fill2=-5, stroke1=-4, stroke2=-3, opacity=-2, strokeWeight=-1
 * 其中:
 * - p1: 起点 [x1, y1]
 * - p2: 第一个控制点 [x2, y2]
 * - p3: 第二个控制点 [x3, y3]
 * - p4: 终点 [x4, y4]
 */
function createBezierFromContext(index, shapeIndex, mainCompName) {
  var base = _createBaseShapeLayer(index);
  var shapeGroup = base.shapeGroup;
  var path = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Shape - Group");

  var markerFind = _getMarkerFindExpr(1010, shapeIndex, mainCompName);

  // Path (p1 at -10, p2 at -9, p3 at -8, p4 at -7)
  // 贝塞尔曲线：起点 p1，终点 p4，控制点 p2 和 p3
  // After Effects 使用顶点和切线：起点 p1，终点 p4
  // 起点出切线：p2 - p1，终点入切线：p3 - p4
  path.property("Path").expression = [
    markerFind,
    "if (!shape || !shape.points || shape.points.length < 4) createPath([[-9999,-9999]], [], [], false);",
    "var p1 = shape.points[0] || [-9999,-9999];",
    "var p2 = shape.points[1] || [-9999,-9999];",
    "var p3 = shape.points[2] || [-9999,-9999];",
    "var p4 = shape.points[3] || [-9999,-9999];",
    "// 贝塞尔曲线：起点 p1，终点 p4，控制点 p2 和 p3",
    "// After Effects 切线是相对于顶点的向量",
    "var out1 = [p2[0]-p1[0], p2[1]-p1[1]];",
    "var in4 = [p3[0]-p4[0], p3[1]-p4[1]];",
    "createPath([p1, p4], [[0,0], in4], [out1, [0,0]], false)",
  ].join("\n");

  // Stroke only (bezier has no fill)
  _addStrokeProperties(shapeGroup, markerFind, 2);
}

/**
 * curve 数据结构 (slots=10):
 * [p1, p2, p3, p4, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
 * 偏移: p1=-10, p2=-9, p3=-8, p4=-7, fill1=-6, fill2=-5, stroke1=-4, stroke2=-3, opacity=-2, strokeWeight=-1
 * 其中:
 * - p1: 第一个控制点 [x1, y1] (不绘制)
 * - p2: 第一个锚点 [x2, y2] (可见起点)
 * - p3: 第二个锚点 [x3, y3] (可见终点)
 * - p4: 最后一个控制点 [x4, y4] (不绘制)
 * 使用标准 Catmull-Rom 样条曲线公式绘制
 */
function createCurveFromContext(index, shapeIndex, mainCompName) {
  var base = _createBaseShapeLayer(index);
  var shapeGroup = base.shapeGroup;
  var path = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Shape - Group");

  var markerFind = _getMarkerFindExpr(1011, shapeIndex, mainCompName);

  // Path (p1 at -10, p2 at -9, p3 at -8, p4 at -7)
  // Catmull-Rom 样条曲线：
  // - p1 (x1, y1): 第一个控制点（不绘制）
  // - p2 (x2, y2): 第一个锚点（可见起点）
  // - p3 (x3, y3): 第二个锚点（可见终点）
  // - p4 (x4, y4): 最后一个控制点（不绘制）
  // 使用标准 Catmull-Rom 样条曲线公式：P(t) = 0.5 * [2*P1 + (-P0+P2)*t + (2*P0-5*P1+4*P2-P3)*t^2 + (-P0+3*P1-3*P2+P3)*t^3]
  // 其中 P0=p1, P1=p2, P2=p3, P3=p4, t ∈ [0, 1]
  path.property("Path").expression = [
    markerFind,
    "if (!shape || !shape.points || shape.points.length < 4) createPath([[-9999,-9999]], [], [], false);",
    "var p0 = shape.points[0] || [-9999,-9999];", // P0: 第一个控制点 (x1, y1)
    "var p1 = shape.points[1] || [-9999,-9999];", // P1: 第一个锚点 (x2, y2) - 起点
    "var p2 = shape.points[2] || [-9999,-9999];", // P2: 第二个锚点 (x3, y3) - 终点
    "var p3 = shape.points[3] || [-9999,-9999];", // P3: 最后一个控制点 (x4, y4)
    "",
    "// 带张力的 Cardinal Spline 样条曲线公式（p5.js 兼容）",
    "// 张力参数 s，范围 [-2, 3]，默认 0.5（产生平滑曲线）",
    "var s = shape.tightness !== undefined ? shape.tightness : 0.5;",
    "",
    "// Cardinal Spline 公式：P(t) = (2*t³-3*t²+1)*P1 + (t³-2*t²+t)*s*(P2-P0) + (-2*t³+3*t²)*P2 + (t³-t²)*s*(P3-P1)",
    "",
    "// 采样点数（足够密集以保证平滑）",
    "var numSamples = 50;",
    "var vertices = [];",
    "",
    "// 采样曲线上的点",
    "for (var i = 0; i <= numSamples; i++) {",
    "  var t = i / numSamples;",
    "  var t2 = t * t;",
    "  var t3 = t2 * t;",
    "  // Cardinal Spline 基函数",
    "  var h1 = 2*t3 - 3*t2 + 1;",
    "  var h2 = t3 - 2*t2 + t;",
    "  var h3 = -2*t3 + 3*t2;",
    "  var h4 = t3 - t2;",
    "  // 计算曲线点",
    "  var x = h1*p1[0] + h2*s*(p2[0]-p0[0]) + h3*p2[0] + h4*s*(p3[0]-p1[0]);",
    "  var y = h1*p1[1] + h2*s*(p2[1]-p0[1]) + h3*p2[1] + h4*s*(p3[1]-p1[1]);",
    "  vertices.push([x, y]);",
    "}",
    "",
    "// 创建路径，使用直线段连接采样点（切线为0）",
    "var numVerts = vertices.length;",
    "var inTangents = [];",
    "var outTangents = [];",
    "for (var i = 0; i < numVerts; i++) {",
    "  inTangents.push([0, 0]);",
    "  outTangents.push([0, 0]);",
    "}",
    "",
    "createPath(vertices, inTangents, outTangents, false)",
  ].join("\n");

  // Stroke only (curve has no fill)
  _addStrokeProperties(shapeGroup, markerFind, 2);
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

  // 形状模式常量（与 p5.arc 的 mode 对齐：0=OPEN, 1=CHORD, 2=PIE）
  // 只要使用了 arc，就在表达式环境中注入 OPEN/CHORD/PIE，方便用户直接使用
  if (deps.arc) {
    funcs.push("const OPEN = 0;");
    funcs.push("const CHORD = 1;");
    funcs.push("const PIE = 2;");
  }

  // 渲染标记
  funcs.push("var _render = true;");

  // 计数器初始化
  if (deps.ellipse || deps.circle) {
    funcs.push("var _ellipseCount = 0;");
  }
  if (deps.arc) {
    funcs.push("var _arcCount = 0;");
  }
  if (deps.quad) {
    funcs.push("var _quadCount = 0;");
  }
  if (deps.triangle) {
    funcs.push("var _triangleCount = 0;");
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
  if (deps.polygon) {
    funcs.push("var _polygonCount = 0;");
  }
  if (deps.bezier) {
    funcs.push("var _bezierCount = 0;");
  }
  if (deps.curve) {
    funcs.push("var _curveCount = 0;");
  }

  // 形状函数 - 语义化 JSON 上下文
  if (deps.ellipse || deps.circle) {
    funcs.push(
      [
        "function _ellipse(a,b,c,d){",
        "  if(!_render){return;}",
        "  _ellipseCount++;",
        "  var m=_ellipseCount;",
        "  var p=_applyTransform(a,b);",
        "  var s=[c*_scaleX,(d||c)*_scaleY];",
        "  var r=_rotation*180/Math.PI;",
        "  var c2=_encodeColorState();",
        "  var hasFill = !(c2[0][0] < 0);",
        "  var hasStroke = !(c2[2][0] < 0);",
        "  var fillColor = hasFill ? [c2[0][0],c2[0][1],c2[1][0],c2[1][1]] : null;",
        "  var strokeColor = hasStroke ? [c2[2][0],c2[2][1],c2[3][0],c2[3][1]] : null;",
        "  var fillOp = hasFill ? c2[4][0] : 0;",
        "  var strokeOp = hasStroke ? c2[4][1] : 0;",
        "  var sw = c2[5][0];",
        "  var mk=[m,1001];",
        "  _shapes.push({",
        '    id:m, marker:mk, markerType:1001, type:"ellipse",',
        "    pos:p, size:s, rot:r,",
        "    fillColor:fillColor, strokeColor:strokeColor,",
        "    fillOpacity:fillOp, strokeOpacity:strokeOp,",
        "    strokeWeight:sw",
        "  });",
        "}",
      ].join("\n"),
    );
  }
  if (deps.arc) {
    funcs.push(
      [
        "function _arc(x,y,w,h,start,stop,mode){",
        "  if(!_render){return;}",
        "  _arcCount++;",
        "  var m = _arcCount;",
        "  var p = _applyTransform(x,y);",
        "  var ww = w * _scaleX;",
        "  var hh = (h || w) * _scaleY;",
        "  var ang = [start, stop];",
        "  // mode 编码: [modeCode, autoFlag]",
        "  // - 当用户未传入 mode 时: modeCode=0, autoFlag=1（默认使用 PIE 填充 + OPEN 描边）",
        "  // - 当用户显式传入 mode 时: modeCode=mode, autoFlag=0（保持与 p5.arc 对齐）",
        "  var md;",
        "  if (mode === undefined) {",
        "    md = [0, 1];",
        "  } else {",
        "    md = [mode, 0];",
        "  }",
        "  var c2 = _encodeColorState();",
        "  var hasFill = !(c2[0][0] < 0);",
        "  var hasStroke = !(c2[2][0] < 0);",
        "  var fillColor = hasFill ? [c2[0][0],c2[0][1],c2[1][0],c2[1][1]] : null;",
        "  var strokeColor = hasStroke ? [c2[2][0],c2[2][1],c2[3][0],c2[3][1]] : null;",
        "  var fillOp = hasFill ? c2[4][0] : 0;",
        "  var strokeOp = hasStroke ? c2[4][1] : 0;",
        "  var sw = c2[5][0];",
        "  var mk = [m, 1006];",
        "  _shapes.push({",
        '    id:m, marker:mk, markerType:1006, type:"arc",',
        "    pos:p, size:[ww,hh], angles:ang, mode:md,",
        "    fillColor:fillColor, strokeColor:strokeColor,",
        "    fillOpacity:fillOp, strokeOpacity:strokeOp,",
        "    strokeWeight:sw",
        "  });",
        "}",
      ].join("\n"),
    );
  }
  if (deps.quad) {
    funcs.push(
      [
        "function _quad(x1,y1,x2,y2,x3,y3,x4,y4){",
        "  if(!_render){return;}",
        "  _quadCount++;",
        "  var m=_quadCount;",
        "  var p1=_applyTransform(x1,y1);",
        "  var p2=_applyTransform(x2,y2);",
        "  var p3=_applyTransform(x3,y3);",
        "  var p4=_applyTransform(x4,y4);",
        "  var c2=_encodeColorState();",
        "  var hasFill = !(c2[0][0] < 0);",
        "  var hasStroke = !(c2[2][0] < 0);",
        "  var fillColor = hasFill ? [c2[0][0],c2[0][1],c2[1][0],c2[1][1]] : null;",
        "  var strokeColor = hasStroke ? [c2[2][0],c2[2][1],c2[3][0],c2[3][1]] : null;",
        "  var fillOp = hasFill ? c2[4][0] : 0;",
        "  var strokeOp = hasStroke ? c2[4][1] : 0;",
        "  var sw = c2[5][0];",
        "  var mk=[m,1007];",
        "  _shapes.push({",
        '    id:m, marker:mk, markerType:1007, type:"quad",',
        "    points:[p1,p2,p3,p4],",
        "    fillColor:fillColor, strokeColor:strokeColor,",
        "    fillOpacity:fillOp, strokeOpacity:strokeOp,",
        "    strokeWeight:sw",
        "  });",
        "}",
      ].join("\n"),
    );
  }
  if (deps.triangle) {
    funcs.push(
      [
        "function _triangle(x1,y1,x2,y2,x3,y3){",
        "  if(!_render){return;}",
        "  _triangleCount++;",
        "  var m=_triangleCount;",
        "  var p1=_applyTransform(x1,y1);",
        "  var p2=_applyTransform(x2,y2);",
        "  var p3=_applyTransform(x3,y3);",
        "  var c2=_encodeColorState();",
        "  var hasFill = !(c2[0][0] < 0);",
        "  var hasStroke = !(c2[2][0] < 0);",
        "  var fillColor = hasFill ? [c2[0][0],c2[0][1],c2[1][0],c2[1][1]] : null;",
        "  var strokeColor = hasStroke ? [c2[2][0],c2[2][1],c2[3][0],c2[3][1]] : null;",
        "  var fillOp = hasFill ? c2[4][0] : 0;",
        "  var strokeOp = hasStroke ? c2[4][1] : 0;",
        "  var sw = c2[5][0];",
        "  var mk=[m,1008];",
        "  _shapes.push({",
        '    id:m, marker:mk, markerType:1008, type:"triangle",',
        "    points:[p1,p2,p3],",
        "    fillColor:fillColor, strokeColor:strokeColor,",
        "    fillOpacity:fillOp, strokeOpacity:strokeOp,",
        "    strokeWeight:sw",
        "  });",
        "}",
      ].join("\n"),
    );
  }
  if (deps.rect || deps.square) {
    funcs.push(
      [
        "function _rect(a,b,c,d){",
        "  if(!_render){return;}",
        "  _rectCount++;",
        "  var m=_rectCount;",
        "  var w=c,h=d||c;",
        "  var p=_applyTransform(a+w/2,b+h/2);",
        "  var s=[w*_scaleX,h*_scaleY];",
        "  var r=_rotation*180/Math.PI;",
        "  var c2=_encodeColorState();",
        "  var hasFill = !(c2[0][0] < 0);",
        "  var hasStroke = !(c2[2][0] < 0);",
        "  var fillColor = hasFill ? [c2[0][0],c2[0][1],c2[1][0],c2[1][1]] : null;",
        "  var strokeColor = hasStroke ? [c2[2][0],c2[2][1],c2[3][0],c2[3][1]] : null;",
        "  var fillOp = hasFill ? c2[4][0] : 0;",
        "  var strokeOp = hasStroke ? c2[4][1] : 0;",
        "  var sw = c2[5][0];",
        "  var mk=[m,1002];",
        "  _shapes.push({",
        '    id:m, marker:mk, markerType:1002, type:"rect",',
        "    pos:p, size:s, rot:r,",
        "    fillColor:fillColor, strokeColor:strokeColor,",
        "    fillOpacity:fillOp, strokeOpacity:strokeOp,",
        "    strokeWeight:sw",
        "  });",
        "}",
      ].join("\n"),
    );
  }
  if (deps.line) {
    funcs.push(
      [
        "function _line(x1,y1,x2,y2){",
        "  if(!_render){return;}",
        "  _lineCount++;",
        "  var m=_lineCount;",
        "  var p1=_applyTransform(x1,y1);",
        "  var p2=_applyTransform(x2,y2);",
        "  var c2=_encodeColorState();",
        "  var hasStroke = !(c2[2][0] < 0);",
        "  var strokeColor = hasStroke ? [c2[2][0],c2[2][1],c2[3][0],c2[3][1]] : null;",
        "  var strokeOp = hasStroke ? c2[4][1] : 0;",
        "  var sw = c2[5][0];",
        "  var mk=[m,1003];",
        "  _shapes.push({",
        '    id:m, marker:mk, markerType:1003, type:"line",',
        "    points:[p1,p2],",
        "    fillColor:null, strokeColor:strokeColor,",
        "    fillOpacity:0, strokeOpacity:strokeOp,",
        "    strokeWeight:sw",
        "  });",
        "}",
      ].join("\n"),
    );
  }
  if (deps.point) {
    funcs.push(
      [
        "function _point(x,y){",
        "  if(!_render){return;}",
        "  _pointCount++;",
        "  var m=_pointCount;",
        "  var p=_applyTransform(x,y);",
        "  var c2=_encodeColorState();",
        "  var hasStroke = !(c2[2][0] < 0);",
        "  var strokeColor = hasStroke ? [c2[2][0],c2[2][1],c2[3][0],c2[3][1]] : null;",
        "  var strokeOp = hasStroke ? c2[4][1] : 0;",
        "  var sw = c2[5][0];",
        "  var mk=[m,1004];",
        "  _shapes.push({",
        '    id:m, marker:mk, markerType:1004, type:"point",',
        "    pos:p, size:[sw,sw],",
        "    // point 使用 stroke 作为可见颜色",
        "    fillColor:strokeColor, strokeColor:strokeColor,",
        "    fillOpacity:strokeOp, strokeOpacity:strokeOp,",
        "    strokeWeight:sw",
        "  });",
        "}",
      ].join("\n"),
    );
  }
  if (deps.bezier) {
    funcs.push(
      [
        "function _bezier(x1,y1,x2,y2,x3,y3,x4,y4){",
        "  if(!_render){return;}",
        "  _bezierCount++;",
        "  var m=_bezierCount;",
        "  var p1=_applyTransform(x1,y1);",
        "  var p2=_applyTransform(x2,y2);",
        "  var p3=_applyTransform(x3,y3);",
        "  var p4=_applyTransform(x4,y4);",
        "  var c2=_encodeColorState();",
        "  var hasStroke = !(c2[2][0] < 0);",
        "  var strokeColor = hasStroke ? [c2[2][0],c2[2][1],c2[3][0],c2[3][1]] : null;",
        "  var strokeOp = hasStroke ? c2[4][1] : 0;",
        "  var sw = c2[5][0];",
        "  var mk=[m,1010];",
        "  _shapes.push({",
        '    id:m, marker:mk, markerType:1010, type:"bezier",',
        "    points:[p1,p2,p3,p4],",
        "    fillColor:null, strokeColor:strokeColor,",
        "    fillOpacity:0, strokeOpacity:strokeOp,",
        "    strokeWeight:sw",
        "  });",
        "}",
      ].join("\n"),
    );
  }
  if (deps.curve) {
    funcs.push(
      [
        "function _curve(x1,y1,x2,y2,x3,y3,x4,y4){",
        "  if(!_render){return;}",
        "  _curveCount++;",
        "  var m=_curveCount;",
        "  var p1=_applyTransform(x1,y1);",
        "  var p2=_applyTransform(x2,y2);",
        "  var p3=_applyTransform(x3,y3);",
        "  var p4=_applyTransform(x4,y4);",
        "  var c2=_encodeColorState();",
        "  var hasStroke = !(c2[2][0] < 0);",
        "  var strokeColor = hasStroke ? [c2[2][0],c2[2][1],c2[3][0],c2[3][1]] : null;",
        "  var strokeOp = hasStroke ? c2[4][1] : 0;",
        "  var sw = c2[5][0];",
        "  var mk=[m,1011];",
        "  var tightness = typeof _curveTightness !== 'undefined' ? _curveTightness : 0.5;",
        "  _shapes.push({",
        '    id:m, marker:mk, markerType:1011, type:"curve",',
        "    points:[p1,p2,p3,p4],",
        "    tightness:tightness,",
        "    fillColor:null, strokeColor:strokeColor,",
        "    fillOpacity:0, strokeOpacity:strokeOp,",
        "    strokeWeight:sw",
        "  });",
        "}",
      ].join("\n"),
    );
  }
  if (deps.polygon) {
    funcs.push(
      [
        "// beginShape/vertex 系列多边形支持（含轮廓与贝塞尔/曲线采样）",
        "var _currentPolygon = null;",
        "// 兼容 p5 的 CLOSE 常量，如未定义则提供占位符",
        "var CLOSE = typeof CLOSE !== 'undefined' ? CLOSE : 'CLOSE';",
        "",
        "// 采样细分数（贝塞尔/曲线插值步数）",
        "var _VERTEX_SUBDIV = 16;",
        "",
        "function beginShape(kind){",
        "  if(!_render){ _currentPolygon = null; return; }",
        "  _currentPolygon = {",
        "    id: 0,",
        "    marker: null,",
        "    markerType: 1009,",
        '    type: "polygon",',
        "    points: [],           // 主轮廓的顶点（向后兼容）",
        "    closed: false,",
        "    fillColor: null,",
        "    strokeColor: null,",
        "    fillOpacity: 0,",
        "    strokeOpacity: 0,",
        "    strokeWeight: 0,",
        "    contours: [],         // 所有轮廓数组：[主轮廓, 子轮廓1, 子轮廓2, ...]",
        "    _currentContour: [],  // 当前正在构建的轮廓",
        "    _curveBuffer: [],     // curveVertex 用的历史点缓冲",
        "    _inContour: false      // 标志：是否在 beginContour/endContour 之间",
        "  };",
        "}",
        "",
        "function _pushVertexPoint(p){",
        "  if(!_currentPolygon){ return; }",
        "  _currentPolygon._currentContour.push(p);",
        "  // 只有在非 Contour 状态下，才添加到主轮廓（points）",
        "  if(!_currentPolygon._inContour){",
        "    _currentPolygon.points.push(p);",
        "  }",
        "}",
        "",
        "function vertex(x,y){",
        "  if(!_render || !_currentPolygon){ return; }",
        "  if(!_currentPolygon._currentContour){",
        "    _currentPolygon._currentContour = [];",
        "  }",
        "  var p = _applyTransform(x,y);",
        "  _pushVertexPoint(p);",
        "  // 记录到 curve 缓冲，用于后续 curveVertex 计算",
        "  _currentPolygon._curveBuffer.push(p);",
        "}",
        "",
        "function beginContour(){",
        "  if(!_render || !_currentPolygon){ return; }",
        "  // 如果当前有轮廓（主轮廓），先保存到 contours",
        "  if(_currentPolygon._currentContour && _currentPolygon._currentContour.length){",
        "    // 如果 contours 为空，说明这是主轮廓",
        "    if(_currentPolygon.contours.length === 0){",
        "      _currentPolygon.contours.push(_currentPolygon._currentContour);",
        "    } else {",
        "      // 否则是上一个子轮廓，也保存",
        "      _currentPolygon.contours.push(_currentPolygon._currentContour);",
        "    }",
        "  }",
        "  // 开始新的子轮廓",
        "  _currentPolygon._currentContour = [];",
        "  _currentPolygon._curveBuffer = [];",
        "  _currentPolygon._inContour = true;",
        "}",
        "",
        "function endContour(){",
        "  if(!_render || !_currentPolygon){ return; }",
        "  // 保存当前的子轮廓",
        "  if(_currentPolygon._currentContour && _currentPolygon._currentContour.length){",
        "    _currentPolygon.contours.push(_currentPolygon._currentContour);",
        "  }",
        "  // 结束子轮廓，准备返回主轮廓（如果有）或开始新的轮廓",
        "  _currentPolygon._currentContour = [];",
        "  _currentPolygon._curveBuffer = [];",
        "  _currentPolygon._inContour = false;",
        "}",
        "",
        "// 三次贝塞尔插值，采样后转直线顶点",
        "function bezierVertex(cx1,cy1,cx2,cy2,x,y){",
        "  if(!_render || !_currentPolygon){ return; }",
        "  var contour = _currentPolygon._currentContour;",
        "  if(!contour || contour.length === 0){",
        "    // 没有起点时无法绘制贝塞尔，兼容 p5 行为直接忽略",
        "    return;",
        "  }",
        "  var p0 = contour[contour.length-1];",
        "  var p1 = _applyTransform(cx1,cy1);",
        "  var p2 = _applyTransform(cx2,cy2);",
        "  var p3 = _applyTransform(x,y);",
        "  var n = _VERTEX_SUBDIV;",
        "  for(var i=1;i<=n;i++){",
        "    var t = i/n;",
        "    var it = 1-t;",
        "    var xB = it*it*it*p0[0] + 3*it*it*t*p1[0] + 3*it*t*t*p2[0] + t*t*t*p3[0];",
        "    var yB = it*it*it*p0[1] + 3*it*it*t*p1[1] + 3*it*t*t*p2[1] + t*t*t*p3[1];",
        "    _pushVertexPoint([xB,yB]);",
        "  }",
        "  _currentPolygon._curveBuffer.push(p3);",
        "}",
        "",
        "// 二次贝塞尔插值，采样后转直线顶点",
        "function quadraticVertex(cpx,cpy,x,y){",
        "  if(!_render || !_currentPolygon){ return; }",
        "  var contour = _currentPolygon._currentContour;",
        "  if(!contour || contour.length === 0){",
        "    // 没有起点时无法绘制贝塞尔，兼容 p5 行为直接忽略",
        "    return;",
        "  }",
        "  var p0 = contour[contour.length-1];",
        "  var p1 = _applyTransform(cpx,cpy);",
        "  var p2 = _applyTransform(x,y);",
        "  var n = _VERTEX_SUBDIV;",
        "  for(var i=1;i<=n;i++){",
        "    var t = i/n;",
        "    var it = 1-t;",
        "    var xQ = it*it*p0[0] + 2*it*t*p1[0] + t*t*p2[0];",
        "    var yQ = it*it*p0[1] + 2*it*t*p1[1] + t*t*p2[1];",
        "    _pushVertexPoint([xQ,yQ]);",
        "  }",
        "  _currentPolygon._curveBuffer.push(p2);",
        "}",
        "",
        "// 带张力的 Cardinal Spline 样条近似 curveVertex，内部用线段采样",
        "function curveVertex(x,y){",
        "  if(!_render || !_currentPolygon){ return; }",
        "  if(!_currentPolygon._currentContour){",
        "    _currentPolygon._currentContour = [];",
        "  }",
        "  var p = _applyTransform(x,y);",
        "  var buf = _currentPolygon._curveBuffer;",
        "  buf.push(p);",
        "  if(buf.length < 4){",
        "    // 前三个点仅用于缓冲，不直接输出（靠后续样条补线）",
        "    if(buf.length === 1){",
        "      // p5 会在首次 curveVertex 前需要额外点，这里简单加入轮廓起点",
        "      _pushVertexPoint(p);",
        "    }",
        "    return;",
        "  }",
        "  var p0 = buf[buf.length-4];",
        "  var p1 = buf[buf.length-3];",
        "  var p2 = buf[buf.length-2];",
        "  var p3 = buf[buf.length-1];",
        "  // 获取张力参数（与 curveTightness 对齐）",
        "  var s = typeof _curveTightness !== 'undefined' ? _curveTightness : 0;",
        "  var n = _VERTEX_SUBDIV;",
        "  for(var i=1;i<=n;i++){",
        "    var t = i/n;",
        "    var t2 = t*t;",
        "    var t3 = t2*t;",
        "    // Cardinal Spline 基函数",
        "    var h1 = 2*t3 - 3*t2 + 1;",
        "    var h2 = t3 - 2*t2 + t;",
        "    var h3 = -2*t3 + 3*t2;",
        "    var h4 = t3 - t2;",
        "    // 计算曲线点",
        "    var xC = h1*p1[0] + h2*s*(p2[0]-p0[0]) + h3*p2[0] + h4*s*(p3[0]-p1[0]);",
        "    var yC = h1*p1[1] + h2*s*(p2[1]-p0[1]) + h3*p2[1] + h4*s*(p3[1]-p1[1]);",
        "    _pushVertexPoint([xC,yC]);",
        "  }",
        "}",
        "",
        "function endShape(mode){",
        "  if(!_render || !_currentPolygon){ return; }",
        "  // 将最后一个轮廓推入 contours，保证所有顶点被收集",
        "  if(_currentPolygon._currentContour && _currentPolygon._currentContour.length){",
        "    // 如果 contours 为空，说明这是主轮廓",
        "    if(_currentPolygon.contours.length === 0){",
        "      _currentPolygon.contours.push(_currentPolygon._currentContour);",
        "    } else {",
        "      // 否则是最后一个子轮廓",
        "      _currentPolygon.contours.push(_currentPolygon._currentContour);",
        "    }",
        "  }",
        "  if (!_currentPolygon.points || _currentPolygon.points.length === 0) {",
        "    _currentPolygon = null;",
        "    return;",
        "  }",
        "  var c2 = _encodeColorState();",
        "  var hasFill = !(c2[0][0] < 0);",
        "  var hasStroke = !(c2[2][0] < 0);",
        "  var fillColor = hasFill ? [c2[0][0],c2[0][1],c2[1][0],c2[1][1]] : null;",
        "  var strokeColor = hasStroke ? [c2[2][0],c2[2][1],c2[3][0],c2[3][1]] : null;",
        "  var fillOp = hasFill ? c2[4][0] : 0;",
        "  var strokeOp = hasStroke ? c2[4][1] : 0;",
        "  var sw = c2[5][0];",
        "  _polygonCount++;",
        "  var m = _polygonCount;",
        "  var closed = false;",
        "  if (mode !== undefined) {",
        "    closed = (mode === true || mode === CLOSE);",
        "  }",
        "  _currentPolygon.id = m;",
        "  _currentPolygon.marker = [m,1009];",
        "  _currentPolygon.markerType = 1009;",
        "  _currentPolygon.fillColor = fillColor;",
        "  _currentPolygon.strokeColor = strokeColor;",
        "  _currentPolygon.fillOpacity = fillOp;",
        "  _currentPolygon.strokeOpacity = strokeOp;",
        "  _currentPolygon.strokeWeight = sw;",
        "  _currentPolygon.closed = closed;",
        "  _shapes.push(_currentPolygon);",
        "  _currentPolygon = null;",
        "}",
      ].join("\n"),
    );
  }
  if (deps.background) {
    funcs.push("var _backgroundCount = 0;");
    funcs.push(getBackgroundLib());
  }

  return funcs.join("\n");
}

/**
 * arc 数据结构 (slots=10):
 * [pos, size, angles, mode, fill1, fill2, stroke1, stroke2, opacity, strokeWeight, marker]
 * 偏移:
 *   pos       = -10
 *   size      = -9
 *   angles    = -8  // [start, stop] 弧度
 *   mode      = -7  // [mode, 0]  0=OPEN, 1=CHORD, 2=PIE
 *   fill1     = -6
 *   fill2     = -5
 *   stroke1   = -4
 *   stroke2   = -3
 *   opacity   = -2
 *   strokeWeight = -1
 */
function createArcFromContext(index, shapeIndex, mainCompName) {
  var base = _createBaseShapeLayer(index);
  var shapeGroup = base.shapeGroup;
  var markerFind = _getMarkerFindExpr(1006, shapeIndex, mainCompName);

  // Stroke 子 group（用于描边，仅画 OPEN 弧线）——先添加 Stroke，让其渲染在 Fill 之上
  var strokeGroup = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Group");
  strokeGroup.name = "Stroke_Arc";
  var strokePath = strokeGroup
    .property("Contents")
    .addProperty("ADBE Vector Shape - Group");

  // Path for Stroke (默认使用 OPEN 弧线)
  strokePath.property("Path").expression = _getArcPathExpr(markerFind, 0);

  // Stroke
  var stroke = strokeGroup
    .property("Contents")
    .addProperty("ADBE Vector Graphic - Stroke");
  stroke.property("Color").expression = [
    markerFind,
    "if (!shape || !shape.strokeColor) [0,0,0,1];",
    "var sc = shape.strokeColor;",
    "[sc[0], sc[1], sc[2], 1]",
  ].join("\n");
  stroke.property("Opacity").expression = _getStrokeOpacityExpr(markerFind);
  stroke.property("Stroke Width").expression = _getStrokeWidthExpr(markerFind, 1);

  // Fill 子 group（用于扇形填充）
  var fillGroup = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Group");
  fillGroup.name = "Fill_Arc";
  var fillPath = fillGroup
    .property("Contents")
    .addProperty("ADBE Vector Shape - Group");

  // Path for Fill (默认使用 PIE 形状)
  fillPath.property("Path").expression = _getArcPathExpr(markerFind, 2);

  // Fill（与 ellipse/rect 一致，支持 fill()/noFill() 状态）
  var fill = fillGroup
    .property("Contents")
    .addProperty("ADBE Vector Graphic - Fill");
  fill.property("Color").expression = _getFillColorExpr(markerFind);
  fill.property("Opacity").expression = _getFillOpacityExpr(markerFind);
}
