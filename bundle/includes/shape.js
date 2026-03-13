// Shape helpers.


// AE layer creation.
function createShapeLayers(mainCompName, compFolder) {
  if (shapeQueue.length === 0) return;

  var shapeCreators = {
    text: createTextFromContext,
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
    curve: createCurveFromContext,
    image: createImageFromContext
  };

  var batchItems = [];

  function flushBatch() {
    if (!batchItems.length) return;

    var batchLayer = _createShapeBatchLayer(batchItems[0].index);
    for (var j = batchItems.length - 1; j >= 0; j--) {
      var item = batchItems[j];
      var batchCreator = shapeCreators[item.shape.type];
      if (batchCreator) {
        batchCreator(item.index, item.shape.slotKey, mainCompName, batchLayer);
      }
    }
    batchItems = [];
  }

  for (var i = 0; i < shapeQueue.length; i++) {
    var shape = shapeQueue[i];
    var slotKey = shape.slotKey;
    var creator = shapeCreators[shape.type];
    if (creator) {
      if (
        shape.type !== "text" &&
        shape.type !== "image" &&
        shape.type !== "background"
      ) {
        batchItems.push({
          index: i,
          shape: shape
        });
        continue;
      }

      flushBatch();
      if (shape.type === "image") {
        creator(i, slotKey, mainCompName, shape, compFolder);
      } else if (shape.type === "background") {
        creator(i, slotKey, mainCompName);
      } else {
        creator(i, slotKey, mainCompName);
      }
    }
  }

  flushBatch();
}

function _getSlotFindExpr(slotKey, mainCompName) {
  var engineLayerExpr;
  if (mainCompName) {
    var escapedName = mainCompName.replace(/"/g, '\\"');
    engineLayerExpr =
      'comp("' + escapedName + '").layer("__engine__").text.sourceText';
  } else {
    engineLayerExpr = 'thisComp.layer("__engine__").text.sourceText';
  }

  return [
    "var raw = " + engineLayerExpr + ";",
    "var json = (raw && raw.text !== undefined) ? raw.text : (raw && raw.toString ? raw.toString() : raw);",
    "var data = JSON.parse(json);",
    "var shapes = data.shapes || [];",
    "var idx = data.slotIndex || {};",
    "var targetKey = " + JSON.stringify(slotKey) + ";",
    "var shape = (idx && idx[targetKey] !== undefined) ? shapes[idx[targetKey]] : null;"
  ].join("\n");
}

function _createBaseShapeLayer(index) {
  var layer = engineComp.layers.addShape();
  layer.name = "Shape_" + index;
  layer.property("Transform").property("Anchor Point").setValue([0, 0]);
  layer.property("Transform").property("Position").setValue([0, 0]);
  var shapeGroup = layer.property("Contents").addProperty("ADBE Vector Group");
  return { layer: layer, shapeGroup: shapeGroup };
}

function _createShapeBatchLayer(index) {
  var layer = engineComp.layers.addShape();
  layer.name = "Shapes_" + index;
  layer.property("Transform").property("Anchor Point").setValue([0, 0]);
  layer.property("Transform").property("Position").setValue([0, 0]);
  return layer;
}

function _createBaseShapeTarget(index, targetLayer) {
  if (targetLayer) {
    var group = targetLayer.property("Contents").addProperty("ADBE Vector Group");
    try {
      group.name = "Shape_" + index;
    } catch (e) {}
    return { layer: targetLayer, shapeGroup: group };
  }
  return _createBaseShapeLayer(index);
}

function _contents(group) {
  return group.property("Contents");
}

function _addPathGroup(shapeGroup) {
  return _contents(shapeGroup).addProperty("ADBE Vector Shape - Group");
}

function _bindBasicTransform(transform, indexFind) {
  transform.property("Position").expression = _getPositionExpr(indexFind);
  transform.property("Rotation").expression = _getRotationExpr(indexFind);
}

function _getFillColorExpr(indexFind) {
  return [
    indexFind,
    "var fc = shape && shape.fillColor;",
    "!fc ? [0,0,0,0] : [fc[0], fc[1], fc[2], 1]"
  ].join("\n");
}

function _getFillOpacityExpr(indexFind) {
  return [
    indexFind,
    "var o = shape && shape.fillOpacity;",
    "o === undefined ? 100 : o"
  ].join("\n");
}

function _getStrokeColorExpr(indexFind) {
  return [
    indexFind,
    "var sc = shape && shape.strokeColor;",
    "!sc ? [0,0,0,0] : [sc[0], sc[1], sc[2], 1]"
  ].join("\n");
}

function _getStrokeOpacityExpr(indexFind) {
  return [
    indexFind,
    "var o = shape && shape.strokeOpacity;",
    "o === undefined ? 100 : o"
  ].join("\n");
}

function _getStrokeWidthExpr(indexFind, defaultValue) {
  defaultValue = defaultValue !== undefined ? defaultValue : 1;
  return [
    indexFind,
    "var w = shape && shape.strokeWeight;",
    "w === undefined ? " + defaultValue + " : w"
  ].join("\n");
}

function _getPositionExpr(indexFind) {
  return [
    indexFind,
    "var p = shape && shape.pos;",
    "!p ? [-9999, -9999] : [p[0], p[1]]"
  ].join("\n");
}

function _getRotationExpr(indexFind) {
  return [
    indexFind,
    "var r = shape && shape.rot;",
    "r === undefined ? 0 : r"
  ].join("\n");
}

function _addFillProperties(shapeGroup, indexFind) {
  var fill = _contents(shapeGroup).addProperty("ADBE Vector Graphic - Fill");
  fill.property("Color").expression = _getFillColorExpr(indexFind);
  fill.property("Opacity").expression = _getFillOpacityExpr(indexFind);
  return fill;
}

function _addStrokeProperties(shapeGroup, indexFind, defaultWidth) {
  var stroke = _contents(shapeGroup).addProperty(
    "ADBE Vector Graphic - Stroke"
  );
  stroke.property("Color").expression = _getStrokeColorExpr(indexFind);
  stroke.property("Opacity").expression = _getStrokeOpacityExpr(indexFind);
  stroke.property("Stroke Width").expression = _getStrokeWidthExpr(
    indexFind,
    defaultWidth
  );
  return stroke;
}

// Arc path.
function _getArcPathExpr(indexFind, defaultMode) {
  var modeCode = defaultMode || 0;
  return [
    indexFind,
    "if (!shape) {",
    "  createPath([[-9999,-9999]], [], [], false);",
    "} else {",
    "  var pos = shape.pos;",
    "  var size = shape.size;",
    "  var angs = shape.angles;",
    "  var mode = shape.mode;",
    "  if (!pos || !size || !angs) {",
    "    createPath([[-9999,-9999]], [], [], false);",
    "  } else {",
    "    var cx = pos[0];",
    "    var cy = pos[1];",
    "    var w = size[0];",
    "    var h = size[1];",
    "    var rx = w * 0.5;",
    "    var ry = h * 0.5;",
    "    var start = angs[0];",
    "    var stop = angs[1];",
    "    if (!(start===start) || !(stop===stop) || start === stop) {",
    "      createPath([[-9999,-9999]], [], [], false);",
    "    } else {",
    "      var twoPi = Math.PI * 2;",
    "      if (stop < start) {",
    "        stop += twoPi * Math.ceil((start - stop) / twoPi);",
    "      }",
    "      var total = stop - start;",
    "      if (total <= 0) {",
    "        createPath([[-9999,-9999]], [], [], false);",
    "      } else {",
    "        var segs = Math.ceil(total / (Math.PI/2));",
    "        if (segs < 1) segs = 1;",
    "        if (segs > 4) segs = 4;",
    "        var step = total / segs;",
    "        var verts = [];",
    "        var ins = [];",
    "        var outs = [];",
    "        var i;",
    "        for (i = 0; i <= segs; i++) {",
    "          var a = start + step * i;",
    "          var cosA = Math.cos(a);",
    "          var sinA = Math.sin(a);",
    "          verts.push([cx + rx * cosA, cy + ry * sinA]);",
    "          ins.push([0,0]);",
    "          outs.push([0,0]);",
    "        }",
    "        for (i = 0; i < segs; i++) {",
    "          var a0 = start + step * i;",
    "          var a1 = start + step * (i+1);",
    "          var delta = a1 - a0;",
    "          var k = (4/3) * Math.tan(delta/4);",
    "          var c0 = Math.cos(a0);",
    "          var s0 = Math.sin(a0);",
    "          var c1 = Math.cos(a1);",
    "          var s1 = Math.sin(a1);",
    "          outs[i] = [k * -rx * s0, k * ry * c0];",
    "          ins[i+1] = [k * rx * s1, k * -ry * c1];",
    "        }",
    "        var auto = (mode && mode.length > 1) ? mode[1] : 0;",
    "        var mcode = (mode && mode.length > 0) ? mode[0] : " + modeCode + ";",
    "        if (auto === 1) {",
    "          mcode = " + modeCode + ";",
    "        }",
    "        mcode = Math.floor(mcode + 0.5);",
    "        if (mcode < 0) mcode = 0;",
    "        if (mcode > 2) mcode = 2;",
    "        var closed = false;",
    "        if (mcode === 2) {",
    "          verts.unshift([cx, cy]);",
    "          ins.unshift([0,0]);",
    "          outs.unshift([0,0]);",
    "          closed = true;",
    "        } else if (mcode === 1) {",
    "          closed = true;",
    "        } else {",
    "          closed = false;",
    "        }",
    "        createPath(verts, ins, outs, closed);",
    "      }",
    "    }",
    "  }",
    "}"
  ].join("\n");
}

function createEllipseFromContext(index, slotKey, mainCompName, targetLayer) {
  var base = _createBaseShapeTarget(index, targetLayer);
  var shapeGroup = base.shapeGroup;
  var ellipse = _contents(shapeGroup).addProperty(
    "ADBE Vector Shape - Ellipse"
  );
  var transform = shapeGroup.property("Transform");
  var indexFind = _getSlotFindExpr(slotKey, mainCompName);
  _bindBasicTransform(transform, indexFind);
  ellipse.property("Size").expression = [
    indexFind,
    "var s = shape && shape.size;",
    "!s ? [0, 0] : [s[0], s[1]]"
  ].join("\n");
  _addFillProperties(shapeGroup, indexFind);
  _addStrokeProperties(shapeGroup, indexFind, 1);
}

// Polygon layer.
function createPolygonFromContext(index, slotKey, mainCompName, targetLayer) {
  var base = _createBaseShapeTarget(index, targetLayer);
  var shapeGroup = base.shapeGroup;
  var indexFind = _getSlotFindExpr(slotKey, mainCompName);
  var mainPathGroup = _addPathGroup(shapeGroup);

  mainPathGroup.property("Path").expression = [
    indexFind,
    "if (!shape) {",
    "  createPath([[-9999,-9999]], [], [], false);",
    "} else {",
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
    "}"
  ].join("\n");

  var hasBeginContour = false;
  if (typeof globalDeps !== "undefined" && globalDeps !== null) {
    if (globalDeps.shapes && globalDeps.shapes.beginContour) {
      hasBeginContour = true;
    }
  }

  if (hasBeginContour) {
    var contourPathGroup = _addPathGroup(shapeGroup);
    var reversePropSet = false;

    try {
      var reverseProp = contourPathGroup.property("ADBE Vector Reversed");
      if (reverseProp) {
        reverseProp.setValue(true);
        reversePropSet = true;
      }
    } catch (e) {
    }

    contourPathGroup.property("Path").expression = [
      indexFind,
      "var contour = shape.contours[1];",
      "if (!contour || contour.length < 2) {",
      "  createPath([[-9999,-9999]], [], [], false);",
      "} else {",
      "  var verts = [];",
      "  var ins = [];",
      "  var outs = [];",
      "  var n = contour.length;",
      "  for (var j = 0; j < n; j++) {",
      "    var p = contour[j] || [-9999,-9999];",
      "    verts.push(p);",
      "    ins.push([0,0]);",
      "    outs.push([0,0]);",
      "  }",
      "  createPath(verts, ins, outs, true);",
      "}"
    ].join("\n");

    if (!reversePropSet) {
      try {
        var reverseProp = contourPathGroup.property("ADBE Vector Reversed");
        if (reverseProp) {
          reverseProp.setValue(true);
          reversePropSet = true;
        }
      } catch (e) {
      }
    }
  }

  _addFillProperties(shapeGroup, indexFind);
  _addStrokeProperties(shapeGroup, indexFind, 1);
}

function createRectFromContext(index, slotKey, mainCompName, targetLayer) {
  var base = _createBaseShapeTarget(index, targetLayer);
  var shapeGroup = base.shapeGroup;
  var rect = _contents(shapeGroup).addProperty("ADBE Vector Shape - Rect");
  var transform = shapeGroup.property("Transform");
  var indexFind = _getSlotFindExpr(slotKey, mainCompName);
  _bindBasicTransform(transform, indexFind);
  rect.property("Size").expression = [
    indexFind,
    "var s = shape && shape.size;",
    "!s ? [0, 0] : [s[0], s[1]]"
  ].join("\n");
  _addFillProperties(shapeGroup, indexFind);
  _addStrokeProperties(shapeGroup, indexFind, 1);
}

// Quad layer.
function createQuadFromContext(index, slotKey, mainCompName, targetLayer) {
  var base = _createBaseShapeTarget(index, targetLayer);
  var shapeGroup = base.shapeGroup;
  var path = _addPathGroup(shapeGroup);
  var indexFind = _getSlotFindExpr(slotKey, mainCompName);
  path.property("Path").expression = [
    indexFind,
    "if (!shape || !shape.points || shape.points.length < 4) {",
    "  createPath([[-9999,-9999]], [], [], false);",
    "} else {",
    "  var p1 = shape.points[0];",
    "  var p2 = shape.points[1];",
    "  var p3 = shape.points[2];",
    "  var p4 = shape.points[3];",
    "  if (!p1 || !p2 || !p3 || !p4) {",
    "    createPath([[-9999,-9999]], [], [], false);",
    "  } else {",
    "    var verts = [p1, p2, p3, p4];",
    "    var ins = [[0,0],[0,0],[0,0],[0,0]];",
    "    var outs = [[0,0],[0,0],[0,0],[0,0]];",
    "    createPath(verts, ins, outs, true);",
    "  }",
    "}"
  ].join("\n");
  _addFillProperties(shapeGroup, indexFind);
  _addStrokeProperties(shapeGroup, indexFind, 1);
}

// Triangle layer.
function createTriangleFromContext(index, slotKey, mainCompName, targetLayer) {
  var base = _createBaseShapeTarget(index, targetLayer);
  var shapeGroup = base.shapeGroup;
  var path = _addPathGroup(shapeGroup);
  var indexFind = _getSlotFindExpr(slotKey, mainCompName);
  path.property("Path").expression = [
    indexFind,
    "if (!shape || !shape.points || shape.points.length < 3) {",
    "  createPath([[-9999,-9999]], [], [], false);",
    "} else {",
    "  var p1 = shape.points[0];",
    "  var p2 = shape.points[1];",
    "  var p3 = shape.points[2];",
    "  if (!p1 || !p2 || !p3) {",
    "    createPath([[-9999,-9999]], [], [], false);",
    "  } else {",
    "    var verts = [p1, p2, p3];",
    "    var ins = [[0,0],[0,0],[0,0]];",
    "    var outs = [[0,0],[0,0],[0,0]];",
    "    createPath(verts, ins, outs, true);",
    "  }",
    "}"
  ].join("\n");
  _addFillProperties(shapeGroup, indexFind);
  _addStrokeProperties(shapeGroup, indexFind, 1);
}

// Line layer.
function createLineFromContext(index, slotKey, mainCompName, targetLayer) {
  var base = _createBaseShapeTarget(index, targetLayer);
  var shapeGroup = base.shapeGroup;
  var path = _addPathGroup(shapeGroup);
  var indexFind = _getSlotFindExpr(slotKey, mainCompName);
  path.property("Path").expression = [
    indexFind,
    "if (!shape || !shape.points || shape.points.length < 2) {",
    "  createPath([[-9999,-9999],[-9999,-9999]], [], [], false);",
    "} else {",
    "  var p1 = shape.points[0];",
    "  var p2 = shape.points[1];",
    "  createPath([p1||[-9999,-9999], p2||[-9999,-9999]], [], [], false);",
    "}"
  ].join("\n");
  _addStrokeProperties(shapeGroup, indexFind, 2);
}

// Point layer.
function createPointFromContext(index, slotKey, mainCompName, targetLayer) {
  var base = _createBaseShapeTarget(index, targetLayer);
  var shapeGroup = base.shapeGroup;
  var ellipse = _contents(shapeGroup).addProperty(
    "ADBE Vector Shape - Ellipse"
  );
  var transform = shapeGroup.property("Transform");
  var indexFind = _getSlotFindExpr(slotKey, mainCompName);
  transform.property("Position").expression = _getPositionExpr(indexFind);
  ellipse.property("Size").expression = [
    indexFind,
    "if (!shape) [2,2];",
    "var d = shape.size;",
    "d ? [d[0], d[1]] : [2,2]"
  ].join("\n");
  var fill = _contents(shapeGroup).addProperty("ADBE Vector Graphic - Fill");
  fill.property("Color").expression = [
    indexFind,
    "if (!shape || !shape.fillColor) [0,0,0,1];",
    "var fc = shape.fillColor;",
    "[fc[0], fc[1], fc[2], 1]"
  ].join("\n");
  fill.property("Opacity").expression = [
    indexFind,
    "if (!shape) 100;",
    "shape.strokeOpacity !== undefined ? shape.strokeOpacity : 100"
  ].join("\n");
}

// Bezier layer.
function createBezierFromContext(index, slotKey, mainCompName, targetLayer) {
  var base = _createBaseShapeTarget(index, targetLayer);
  var shapeGroup = base.shapeGroup;
  var path = _addPathGroup(shapeGroup);
  var indexFind = _getSlotFindExpr(slotKey, mainCompName);
  path.property("Path").expression = [
    indexFind,
    "if (!shape || !shape.points || shape.points.length < 4) {",
    "  createPath([[-9999,-9999]], [], [], false);",
    "} else {",
    "  var p1 = shape.points[0] || [-9999,-9999];",
    "  var p2 = shape.points[1] || [-9999,-9999];",
    "  var p3 = shape.points[2] || [-9999,-9999];",
    "  var p4 = shape.points[3] || [-9999,-9999];",
    "  var out1 = [p2[0]-p1[0], p2[1]-p1[1]];",
    "  var in4 = [p3[0]-p4[0], p3[1]-p4[1]];",
    "  createPath([p1, p4], [[0,0], in4], [out1, [0,0]], false);",
    "}"
  ].join("\n");
  _addStrokeProperties(shapeGroup, indexFind, 2);
}

// Curve layer.
function createCurveFromContext(index, slotKey, mainCompName, targetLayer) {
  var base = _createBaseShapeTarget(index, targetLayer);
  var shapeGroup = base.shapeGroup;
  var path = _addPathGroup(shapeGroup);
  var indexFind = _getSlotFindExpr(slotKey, mainCompName);

  path.property("Path").expression = [
    indexFind,
    "if (!shape || !shape.points || shape.points.length < 4) {",
    "  createPath([[-9999,-9999]], [], [], false);",
    "} else {",
    "  var p0 = shape.points[0] || [-9999,-9999];",
    "  var p1 = shape.points[1] || [-9999,-9999];",
    "  var p2 = shape.points[2] || [-9999,-9999];",
    "  var p3 = shape.points[3] || [-9999,-9999];",
    "  var s = shape.tightness !== undefined ? shape.tightness : 0.5;",
    "  var numSamples = 50;",
    "  var vertices = [];",
    "  for (var i = 0; i <= numSamples; i++) {",
    "    var t = i / numSamples;",
    "    var t2 = t * t;",
    "    var t3 = t2 * t;",
    "    var h1 = 2*t3 - 3*t2 + 1;",
    "    var h2 = t3 - 2*t2 + t;",
    "    var h3 = -2*t3 + 3*t2;",
    "    var h4 = t3 - t2;",
    "    var x = h1*p1[0] + h2*s*(p2[0]-p0[0]) + h3*p2[0] + h4*s*(p3[0]-p1[0]);",
    "    var y = h1*p1[1] + h2*s*(p2[1]-p0[1]) + h3*p2[1] + h4*s*(p3[1]-p1[1]);",
    "    vertices.push([x, y]);",
    "  }",
    "  var numVerts = vertices.length;",
    "  var inTangents = [];",
    "  var outTangents = [];",
    "  for (var j = 0; j < numVerts; j++) {",
    "    inTangents.push([0, 0]);",
    "    outTangents.push([0, 0]);",
    "  }",
    "  createPath(vertices, inTangents, outTangents, false);",
    "}"
  ].join("\n");
  _addStrokeProperties(shapeGroup, indexFind, 2);
}

function getShapeModeLib(deps) {
  if (!deps.arc) return "";
  return [
    "const OPEN = 0;",
    "const CHORD = 1;",
    "const PIE = 2;"
  ].join("\n");
}

function getShapeCoreLib() {
  return [
    "var _render = true;",
    "var _callsiteCounters = {};",
    "function _consumeShapeArgs(argsLike) {",
    "  var args = [].slice.call(argsLike || []);",
    "  var callsiteId = null;",
    "  if (args.length > 0 && typeof args[0] === 'string' && args[0].indexOf('__mcs_') === 0) {",
    "    callsiteId = args.shift();",
    "  }",
    "  return { callsiteId: callsiteId, values: args };",
    "}",
    "function _requireShapeCallsiteId(typeName, callsiteId) {",
    "  if (callsiteId) return callsiteId;",
    "  throw new Error('[ShapeLib] Missing callsiteId for shape type: ' + String(typeName || 'shape'));",
    "}",
    "function _nextShapeRef(typeName, callsiteId) {",
    "  var phase = __momentumPhase || 'global';",
    "  var callsiteKey = _requireShapeCallsiteId(typeName, callsiteId);",
    "  var counterKey = phase + ':' + callsiteKey;",
    "  var ordinal = (_callsiteCounters[counterKey] || 0) + 1;",
    "  _callsiteCounters[counterKey] = ordinal;",
    "  return { slotKey: counterKey + ':' + ordinal, callsiteId: callsiteId };",
    "}",
    "function _shapeStyle() {",
    "  var c2 = _encodeColorState();",
    "  var hasFill = !(c2[0][0] < 0);",
    "  var hasStroke = !(c2[2][0] < 0);",
    "  return {",
    "    fillColor: hasFill ? [c2[0][0], c2[0][1], c2[1][0], c2[1][1]] : null,",
    "    strokeColor: hasStroke ? [c2[2][0], c2[2][1], c2[3][0], c2[3][1]] : null,",
    "    fillOpacity: hasFill ? c2[4][0] : 0,",
    "    strokeOpacity: hasStroke ? c2[4][1] : 0,",
    "    strokeWeight: c2[5][0]",
    "  };",
    "}"
  ].join("\n");
}

function getShapeEllipseLib(deps) {
  if (!(deps.ellipse || deps.circle)) return "";
  return [
    [
        "function _ellipse(){",
        "  if(!_render){return;}",
        "  var __shapeArgs = _consumeShapeArgs(arguments);",
        "  var __vals = __shapeArgs.values;",
        "  var callsiteId = __shapeArgs.callsiteId;",
        "  var ref = _nextShapeRef('ellipse', callsiteId);",
        "  var slotKey = ref.slotKey;",
        "  var mode = (typeof _ellipseMode !== 'undefined') ? _ellipseMode : 0;",
        "  var x = __vals[0];",
        "  var y = __vals[1];",
        "  var w = __vals[2];",
        "  var h = (__vals[3] !== undefined) ? __vals[3] : __vals[2];",
        "  if (!(w===w)) w = 0;",
        "  if (!(h===h)) h = 0;",
        "  var cx, cy, ww, hh;",
        "  if (mode === 1) {",
        "    cx = x;",
        "    cy = y;",
        "    ww = w * 2;",
        "    hh = h * 2;",
        "  } else if (mode === 2) {",
        "    cx = x + w * 0.5;",
        "    cy = y + h * 0.5;",
        "    ww = w;",
        "    hh = h;",
        "  } else if (mode === 3) {",
        "    var x2 = __vals[2];",
        "    var y2 = (__vals[3] !== undefined) ? __vals[3] : __vals[1];",
        "    var dx = x2 - x;",
        "    var dy = y2 - y;",
        "    cx = x + dx * 0.5;",
        "    cy = y + dy * 0.5;",
        "    ww = Math.abs(dx);",
        "    hh = Math.abs(dy);",
        "  } else {",
        "    cx = x;",
        "    cy = y;",
        "    ww = w;",
        "    hh = h;",
        "  }",
        "  var p=_applyTransform(cx,cy);",
        "  var s=[ww*_scaleX,hh*_scaleY];",
        "  var r=_rotation*180/Math.PI;",
        "  var style=_shapeStyle();",
        "  _shapes.push({",
        '    slotKey:slotKey, type:"ellipse",',
        "    pos:p, size:s, rot:r,",
        "    fillColor:style.fillColor, strokeColor:style.strokeColor,",
        "    fillOpacity:style.fillOpacity, strokeOpacity:style.strokeOpacity,",
        "    strokeWeight:style.strokeWeight",
        "  });",
        "}"
      ].join("\n"),
    "function ellipse(){ return _ellipse.apply(this, arguments); }",
    "function circle(x, y, d){ return _ellipse.apply(this, arguments.length > 0 ? arguments : [x, y, d, d]); }"
  ].join("\n");
}

function getShapeArcLib(deps) {
  if (!deps.arc) return "";
  return [
    [
        "function _arc(){",
        "  if(!_render){return;}",
        "  var __shapeArgs = _consumeShapeArgs(arguments);",
        "  var __vals = __shapeArgs.values;",
        "  var callsiteId = __shapeArgs.callsiteId;",
        "  var ref = _nextShapeRef('arc', callsiteId);",
        "  var slotKey = ref.slotKey;",
        "  var x = __vals[0];",
        "  var y = __vals[1];",
        "  var w = __vals[2];",
        "  var h = __vals[3];",
        "  var start = __vals[4];",
        "  var stop = __vals[5];",
        "  var mode = __vals[6];",
        "  var p = _applyTransform(x,y);",
        "  var ww = w * _scaleX;",
        "  var hh = (h || w) * _scaleY;",
        "  if (typeof _toAngleRadians === 'function') {",
        "    start = _toAngleRadians(start);",
        "    stop = _toAngleRadians(stop);",
        "  }",
        "  var ang = [start, stop];",
        "  var md;",
        "  if (mode === undefined) {",
        "    md = [0, 1];",
        "  } else {",
        "    md = [mode, 0];",
        "  }",
        "  var style = _shapeStyle();",
        "  _shapes.push({",
        '    slotKey:slotKey, type:"arc",',
        "    pos:p, size:[ww,hh], angles:ang, mode:md,",
        "    fillColor:style.fillColor, strokeColor:style.strokeColor,",
        "    fillOpacity:style.fillOpacity, strokeOpacity:style.strokeOpacity,",
        "    strokeWeight:style.strokeWeight",
        "  });",
        "}"
      ].join("\n"),
    "function arc(){ return _arc.apply(this, arguments); }"
  ].join("\n");
}

function getShapeQuadLib(deps) {
  if (!deps.quad) return "";
  return [
    [
        "function _quad(){",
        "  if(!_render){return;}",
        "  var __shapeArgs = _consumeShapeArgs(arguments);",
        "  var __vals = __shapeArgs.values;",
        "  var callsiteId = __shapeArgs.callsiteId;",
        "  var ref = _nextShapeRef('quad', callsiteId);",
        "  var slotKey = ref.slotKey;",
        "  var x1 = __vals[0], y1 = __vals[1], x2 = __vals[2], y2 = __vals[3], x3 = __vals[4], y3 = __vals[5], x4 = __vals[6], y4 = __vals[7];",
        "  var p1=_applyTransform(x1,y1);",
        "  var p2=_applyTransform(x2,y2);",
        "  var p3=_applyTransform(x3,y3);",
        "  var p4=_applyTransform(x4,y4);",
        "  var style=_shapeStyle();",
        "  _shapes.push({",
        '    slotKey:slotKey, type:"quad",',
        "    points:[p1,p2,p3,p4],",
        "    fillColor:style.fillColor, strokeColor:style.strokeColor,",
        "    fillOpacity:style.fillOpacity, strokeOpacity:style.strokeOpacity,",
        "    strokeWeight:style.strokeWeight",
        "  });",
        "}"
      ].join("\n"),
    "function quad(){ return _quad.apply(this, arguments); }"
  ].join("\n");
}

function getShapeTriangleLib(deps) {
  if (!deps.triangle) return "";
  return [
    [
        "function _triangle(){",
        "  if(!_render){return;}",
        "  var __shapeArgs = _consumeShapeArgs(arguments);",
        "  var __vals = __shapeArgs.values;",
        "  var callsiteId = __shapeArgs.callsiteId;",
        "  var ref = _nextShapeRef('triangle', callsiteId);",
        "  var slotKey = ref.slotKey;",
        "  var x1 = __vals[0], y1 = __vals[1], x2 = __vals[2], y2 = __vals[3], x3 = __vals[4], y3 = __vals[5];",
        "  var p1=_applyTransform(x1,y1);",
        "  var p2=_applyTransform(x2,y2);",
        "  var p3=_applyTransform(x3,y3);",
        "  var style=_shapeStyle();",
        "  _shapes.push({",
        '    slotKey:slotKey, type:"triangle",',
        "    points:[p1,p2,p3],",
        "    fillColor:style.fillColor, strokeColor:style.strokeColor,",
        "    fillOpacity:style.fillOpacity, strokeOpacity:style.strokeOpacity,",
        "    strokeWeight:style.strokeWeight",
        "  });",
        "}"
      ].join("\n"),
    "function triangle(){ return _triangle.apply(this, arguments); }"
  ].join("\n");
}

function getShapeRectLib(deps) {
  if (!(deps.rect || deps.square)) return "";
  return [
    [
        "function _rect(){",
        "  if(!_render){return;}",
        "  var __shapeArgs = _consumeShapeArgs(arguments);",
        "  var __vals = __shapeArgs.values;",
        "  var callsiteId = __shapeArgs.callsiteId;",
        "  var ref = _nextShapeRef('rect', callsiteId);",
        "  var slotKey = ref.slotKey;",
        "  var mode = (typeof _rectMode !== 'undefined') ? _rectMode : 2;",
        "  var x = __vals[0];",
        "  var y = __vals[1];",
        "  var w = __vals[2];",
        "  var h = (__vals[3] !== undefined) ? __vals[3] : __vals[2];",
        "  if (!(w===w)) w = 0;",
        "  if (!(h===h)) h = 0;",
        "  var cx, cy, ww, hh;",
        "  if (mode === 0) {",
        "    cx = x;",
        "    cy = y;",
        "    ww = w;",
        "    hh = h;",
        "  } else if (mode === 1) {",
        "    cx = x;",
        "    cy = y;",
        "    ww = w * 2;",
        "    hh = h * 2;",
        "  } else if (mode === 3) {",
        "    var x2 = __vals[2];",
        "    var y2 = (__vals[3] !== undefined) ? __vals[3] : __vals[1];",
        "    var dx = x2 - x;",
        "    var dy = y2 - y;",
        "    cx = x + dx * 0.5;",
        "    cy = y + dy * 0.5;",
        "    ww = Math.abs(dx);",
        "    hh = Math.abs(dy);",
        "  } else {",
        "    cx = x + w * 0.5;",
        "    cy = y + h * 0.5;",
        "    ww = w;",
        "    hh = h;",
        "  }",
        "  var p=_applyTransform(cx,cy);",
        "  var s=[ww*_scaleX,hh*_scaleY];",
        "  var r=_rotation*180/Math.PI;",
        "  var style=_shapeStyle();",
        "  _shapes.push({",
        '    slotKey:slotKey, type:"rect",',
        "    pos:p, size:s, rot:r,",
        "    fillColor:style.fillColor, strokeColor:style.strokeColor,",
        "    fillOpacity:style.fillOpacity, strokeOpacity:style.strokeOpacity,",
        "    strokeWeight:style.strokeWeight",
        "  });",
        "}"
      ].join("\n"),
    "function rect(){ return _rect.apply(this, arguments); }",
    "function square(x, y, s){ return _rect.apply(this, arguments.length > 0 ? arguments : [x, y, s, s]); }"
  ].join("\n");
}

function getShapeLineLib(deps) {
  if (!deps.line) return "";
  return [
    [
        "function _line(){",
        "  if(!_render){return;}",
        "  var __shapeArgs = _consumeShapeArgs(arguments);",
        "  var __vals = __shapeArgs.values;",
        "  var callsiteId = __shapeArgs.callsiteId;",
        "  var ref = _nextShapeRef('line', callsiteId);",
        "  var slotKey = ref.slotKey;",
        "  var x1 = __vals[0], y1 = __vals[1], x2 = __vals[2], y2 = __vals[3];",
        "  var p1=_applyTransform(x1,y1);",
        "  var p2=_applyTransform(x2,y2);",
        "  var style=_shapeStyle();",
        "  _shapes.push({",
        '    slotKey:slotKey, type:"line",',
        "    points:[p1,p2],",
        "    fillColor:null, strokeColor:style.strokeColor,",
        "    fillOpacity:0, strokeOpacity:style.strokeOpacity,",
        "    strokeWeight:style.strokeWeight",
        "  });",
        "}"
      ].join("\n"),
    "function line(){ return _line.apply(this, arguments); }"
  ].join("\n");
}

function getShapePointLib(deps) {
  if (!deps.point) return "";
  return [
    [
        "function _point(){",
        "  if(!_render){return;}",
        "  var __shapeArgs = _consumeShapeArgs(arguments);",
        "  var __vals = __shapeArgs.values;",
        "  var callsiteId = __shapeArgs.callsiteId;",
        "  var ref = _nextShapeRef('point', callsiteId);",
        "  var slotKey = ref.slotKey;",
        "  var x = __vals[0], y = __vals[1];",
        "  if (x && typeof x === 'object') {",
        "    if (x.x !== undefined || x.y !== undefined) {",
        "      y = x.y !== undefined ? x.y : 0;",
        "      x = x.x !== undefined ? x.x : 0;",
        "    } else if (x.length !== undefined) {",
        "      y = x[1] !== undefined ? x[1] : 0;",
        "      x = x[0] !== undefined ? x[0] : 0;",
        "    }",
        "  }",
        "  var p=_applyTransform(x,y);",
        "  var style=_shapeStyle();",
        "  _shapes.push({",
        '    slotKey:slotKey, type:"point",',
        "    pos:p, size:[style.strokeWeight,style.strokeWeight],",
        "    fillColor:style.strokeColor, strokeColor:style.strokeColor,",
        "    fillOpacity:style.strokeOpacity, strokeOpacity:style.strokeOpacity,",
        "    strokeWeight:style.strokeWeight",
        "  });",
        "}"
      ].join("\n"),
    "function point(){ return _point.apply(this, arguments); }"
  ].join("\n");
}

function getShapeBezierLib(deps) {
  if (!deps.bezier) return "";
  return [
    [
        "function _bezier(){",
        "  if(!_render){return;}",
        "  var __shapeArgs = _consumeShapeArgs(arguments);",
        "  var __vals = __shapeArgs.values;",
        "  var callsiteId = __shapeArgs.callsiteId;",
        "  var ref = _nextShapeRef('bezier', callsiteId);",
        "  var slotKey = ref.slotKey;",
        "  var x1 = __vals[0], y1 = __vals[1], x2 = __vals[2], y2 = __vals[3], x3 = __vals[4], y3 = __vals[5], x4 = __vals[6], y4 = __vals[7];",
        "  var p1=_applyTransform(x1,y1);",
        "  var p2=_applyTransform(x2,y2);",
        "  var p3=_applyTransform(x3,y3);",
        "  var p4=_applyTransform(x4,y4);",
        "  var style=_shapeStyle();",
        "  _shapes.push({",
        '    slotKey:slotKey, type:"bezier",',
        "    points:[p1,p2,p3,p4],",
        "    fillColor:null, strokeColor:style.strokeColor,",
        "    fillOpacity:0, strokeOpacity:style.strokeOpacity,",
        "    strokeWeight:style.strokeWeight",
        "  });",
        "}"
      ].join("\n"),
    "function bezier(){ return _bezier.apply(this, arguments); }"
  ].join("\n");
}

function getShapeCurveLib(deps) {
  if (!deps.curve) return "";
  return [
    [
        "function _curve(){",
        "  if(!_render){return;}",
        "  var __shapeArgs = _consumeShapeArgs(arguments);",
        "  var __vals = __shapeArgs.values;",
        "  var callsiteId = __shapeArgs.callsiteId;",
        "  var ref = _nextShapeRef('curve', callsiteId);",
        "  var slotKey = ref.slotKey;",
        "  var x1 = __vals[0], y1 = __vals[1], x2 = __vals[2], y2 = __vals[3], x3 = __vals[4], y3 = __vals[5], x4 = __vals[6], y4 = __vals[7];",
        "  var p1=_applyTransform(x1,y1);",
        "  var p2=_applyTransform(x2,y2);",
        "  var p3=_applyTransform(x3,y3);",
        "  var p4=_applyTransform(x4,y4);",
        "  var style=_shapeStyle();",
        "  var tightness = typeof _curveTightness !== 'undefined' ? _curveTightness : 0.5;",
        "  _shapes.push({",
        '    slotKey:slotKey, type:"curve",',
        "    points:[p1,p2,p3,p4],",
        "    tightness:tightness,",
        "    fillColor:null, strokeColor:style.strokeColor,",
        "    fillOpacity:0, strokeOpacity:style.strokeOpacity,",
        "    strokeWeight:style.strokeWeight",
        "  });",
        "}"
      ].join("\n"),
    "function curve(){ return _curve.apply(this, arguments); }"
  ].join("\n");
}

function getShapePolygonLib(deps) {
  if (!deps.polygon) return "";
  return [
        "// ===== Polygon Runtime =====",
        "var _currentPolygon = null;",
        "var CLOSE = typeof CLOSE !== 'undefined' ? CLOSE : 'CLOSE';",
        "",
        "var _VERTEX_SUBDIV = 16;",
        "",
        "function beginShape(){",
        "  if(!_render){ _currentPolygon = null; return; }",
        "  var __shapeArgs = _consumeShapeArgs(arguments);",
        "  _currentPolygon = {",
        "    slotKey: null,",
        '    type: "polygon",',
        "    points: [],",
        "    closed: false,",
        "    fillColor: null,",
        "    strokeColor: null,",
        "    fillOpacity: 0,",
        "    strokeOpacity: 0,",
        "    strokeWeight: 0,",
        "    contours: [],",
        "    _currentContour: [],",
        "    _curveBuffer: [],",
        "    _inContour: false",
        "  };",
        "}",
        "",
        "function _pushVertexPoint(p){",
        "  if(!_currentPolygon){ return; }",
        "  _currentPolygon._currentContour.push(p);",
        "  if(!_currentPolygon._inContour){",
        "    _currentPolygon.points.push(p);",
        "  }",
        "}",
        "",
        "function vertex(){",
        "  if(!_render || !_currentPolygon){ return; }",
        "  var __shapeArgs = _consumeShapeArgs(arguments);",
        "  var x = __shapeArgs.values[0];",
        "  var y = __shapeArgs.values[1];",
        "  if(!_currentPolygon._currentContour){",
        "    _currentPolygon._currentContour = [];",
        "  }",
        "  var p = _applyTransform(x,y);",
        "  _pushVertexPoint(p);",
        "  _currentPolygon._curveBuffer.push(p);",
        "}",
        "",
        "function beginContour(){",
        "  if(!_render || !_currentPolygon){ return; }",
        "  _consumeShapeArgs(arguments);",
        "  if(_currentPolygon._currentContour && _currentPolygon._currentContour.length){",
        "    _currentPolygon.contours.push(_currentPolygon._currentContour);",
        "  }",
        "  _currentPolygon._currentContour = [];",
        "  _currentPolygon._curveBuffer = [];",
        "  _currentPolygon._inContour = true;",
        "}",
        "",
        "function endContour(){",
        "  if(!_render || !_currentPolygon){ return; }",
        "  _consumeShapeArgs(arguments);",
        "  if(_currentPolygon._currentContour && _currentPolygon._currentContour.length){",
        "    _currentPolygon.contours.push(_currentPolygon._currentContour);",
        "  }",
        "  _currentPolygon._currentContour = [];",
        "  _currentPolygon._curveBuffer = [];",
        "  _currentPolygon._inContour = false;",
        "}",
        "",
        "function bezierVertex(){",
        "  if(!_render || !_currentPolygon){ return; }",
        "  var __shapeArgs = _consumeShapeArgs(arguments);",
        "  var cx1 = __shapeArgs.values[0], cy1 = __shapeArgs.values[1], cx2 = __shapeArgs.values[2], cy2 = __shapeArgs.values[3], x = __shapeArgs.values[4], y = __shapeArgs.values[5];",
        "  var contour = _currentPolygon._currentContour;",
        "  if(!contour || contour.length === 0) return;",
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
        "function quadraticVertex(){",
        "  if(!_render || !_currentPolygon){ return; }",
        "  var __shapeArgs = _consumeShapeArgs(arguments);",
        "  var cpx = __shapeArgs.values[0], cpy = __shapeArgs.values[1], x = __shapeArgs.values[2], y = __shapeArgs.values[3];",
        "  var contour = _currentPolygon._currentContour;",
        "  if(!contour || contour.length === 0) return;",
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
        "function curveVertex(){",
        "  if(!_render || !_currentPolygon){ return; }",
        "  var __shapeArgs = _consumeShapeArgs(arguments);",
        "  var x = __shapeArgs.values[0], y = __shapeArgs.values[1];",
        "  if(!_currentPolygon._currentContour){",
        "    _currentPolygon._currentContour = [];",
        "  }",
        "  var p = _applyTransform(x,y);",
        "  var buf = _currentPolygon._curveBuffer;",
        "  buf.push(p);",
        "  if(buf.length < 4){",
        "    if(buf.length === 1) _pushVertexPoint(p);",
        "    return;",
        "  }",
        "  var p0 = buf[buf.length-4];",
        "  var p1 = buf[buf.length-3];",
        "  var p2 = buf[buf.length-2];",
        "  var p3 = buf[buf.length-1];",
        "  var s = typeof _curveTightness !== 'undefined' ? _curveTightness : 0;",
        "  var n = _VERTEX_SUBDIV;",
        "  for(var i=1;i<=n;i++){",
        "    var t = i/n;",
        "    var t2 = t*t;",
        "    var t3 = t2*t;",
        "    var h1 = 2*t3 - 3*t2 + 1;",
        "    var h2 = t3 - 2*t2 + t;",
        "    var h3 = -2*t3 + 3*t2;",
        "    var h4 = t3 - t2;",
        "    var xC = h1*p1[0] + h2*s*(p2[0]-p0[0]) + h3*p2[0] + h4*s*(p3[0]-p1[0]);",
        "    var yC = h1*p1[1] + h2*s*(p2[1]-p0[1]) + h3*p2[1] + h4*s*(p3[1]-p1[1]);",
        "    _pushVertexPoint([xC,yC]);",
        "  }",
        "}",
        "",
        "function endShape(){",
        "  if(!_render || !_currentPolygon){ return; }",
        "  var __shapeArgs = _consumeShapeArgs(arguments);",
        "  var mode = __shapeArgs.values[0];",
        "  if(_currentPolygon._currentContour && _currentPolygon._currentContour.length){",
        "    _currentPolygon.contours.push(_currentPolygon._currentContour);",
        "  }",
        "  if (!_currentPolygon.points || _currentPolygon.points.length === 0) {",
        "    _currentPolygon = null;",
        "    return;",
        "  }",
        "  var style = _shapeStyle();",
        "  var ref = _nextShapeRef('polygon', __shapeArgs.callsiteId);",
        "  var closed = false;",
        "  if (mode !== undefined) {",
          "    closed = (mode === true || mode === CLOSE);",
        "  }",
        "  _currentPolygon.slotKey = ref.slotKey;",
        "  _currentPolygon.fillColor = style.fillColor;",
        "  _currentPolygon.strokeColor = style.strokeColor;",
        "  _currentPolygon.fillOpacity = style.fillOpacity;",
        "  _currentPolygon.strokeOpacity = style.strokeOpacity;",
        "  _currentPolygon.strokeWeight = style.strokeWeight;",
        "  _currentPolygon.closed = closed;",
        "  _shapes.push(_currentPolygon);",
        "  _currentPolygon = null;",
        "}"
      ].join("\n");
}

// Expression runtime.
function getShapeLib(deps) {
  if (!deps) deps = {};

  return [
    getShapeModeLib(deps),
    getShapeCoreLib(),
    getShapeEllipseLib(deps),
    getShapeArcLib(deps),
    getShapeQuadLib(deps),
    getShapeTriangleLib(deps),
    getShapeRectLib(deps),
    getShapeLineLib(deps),
    getShapePointLib(deps),
    getShapeBezierLib(deps),
    getShapeCurveLib(deps),
    getShapePolygonLib(deps),
    deps.background ? getBackgroundLib() : ""
  ].filter(Boolean).join("\n");
}

function createArcFromContext(index, slotKey, mainCompName, targetLayer) {
  var base = _createBaseShapeTarget(index, targetLayer);
  var shapeGroup = base.shapeGroup;
  var indexFind = _getSlotFindExpr(slotKey, mainCompName);

  var strokeGroup = _contents(shapeGroup).addProperty("ADBE Vector Group");
  strokeGroup.name = "Stroke_Arc";
  var strokePath = _addPathGroup(strokeGroup);
  strokePath.property("Path").expression = _getArcPathExpr(indexFind, 0);

  var stroke = _contents(strokeGroup).addProperty(
    "ADBE Vector Graphic - Stroke"
  );
  stroke.property("Color").expression = [
    indexFind,
    "if (!shape || !shape.strokeColor) [0,0,0,1];",
    "var sc = shape.strokeColor;",
    "[sc[0], sc[1], sc[2], 1]"
  ].join("\n");
  stroke.property("Opacity").expression = _getStrokeOpacityExpr(indexFind);
  stroke.property("Stroke Width").expression = _getStrokeWidthExpr(indexFind, 1);

  var fillGroup = _contents(shapeGroup).addProperty("ADBE Vector Group");
  fillGroup.name = "Fill_Arc";
  var fillPath = _addPathGroup(fillGroup);
  fillPath.property("Path").expression = _getArcPathExpr(indexFind, 2);

  var fill = _contents(fillGroup).addProperty("ADBE Vector Graphic - Fill");
  fill.property("Color").expression = _getFillColorExpr(indexFind);
  fill.property("Opacity").expression = _getFillOpacityExpr(indexFind);
}
