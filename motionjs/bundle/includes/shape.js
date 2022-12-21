pub.ellipse = function (x, y, w, h) {
  if (arguments.length !== 4)
    error(
      "m.ellipse(), not enough parameters to draw an ellipse! Use: x, y, w, h"
    );
  // var ellipseBounds = [];
  // if (currEllipseMode === pub.CORNER) {
  //   ellipseBounds[0] = y;
  //   ellipseBounds[1] = x;
  //   ellipseBounds[2] = y + h;
  //   ellipseBounds[3] = x + w;
  // } else if (currEllipseMode === pub.CORNERS) {
  //   ellipseBounds[0] = y;
  //   ellipseBounds[1] = x;
  //   ellipseBounds[2] = h;
  //   ellipseBounds[3] = w;
  // } else if (currEllipseMode === pub.CENTER) {
  //   ellipseBounds[0] = y - h / 2;
  //   ellipseBounds[1] = x - w / 2;
  //   ellipseBounds[2] = y + h - h / 2;
  //   ellipseBounds[3] = x + w - w / 2;
  // } else if (currEllipseMode === pub.RADIUS) {
  //   ellipseBounds[0] = y - h;
  //   ellipseBounds[1] = x - w;
  //   ellipseBounds[2] = y + h;
  //   ellipseBounds[3] = x + w;
  // } else if (w === 0 || h === 0) return false;

  // var ovals = currentPage().ovals;
  // var newOval = ovals.add(currentLayer());

  // if ((app.project.numItems = 0)) {
  //   app.project.items.addComp("合成1", 1920, 1080, 1, 100, 25);
  //   app.project.item(1).openInViewer();
  // }

  var comp = app.project.activeItem;
  var ShapeLayer = comp.layers.addShape();
  var ShapeLayerContents = ShapeLayer.property("ADBE Root Vectors Group");
  var ShapeGroup = ShapeLayerContents.addProperty("ADBE Vector Group");

  var newEllipse = ShapeGroup.property("ADBE Vectors Group").addProperty(
    "ADBE Vector Shape - Ellipse"
  );
  newEllipse.property("ADBE Vector Ellipse Position").setValue([x, y]);
  newEllipse.property("ADBE Vector Ellipse Size").setValue([w, h]);

  // var newShapeFill = ShapeGroup.property("ADBE Vectors Group").addProperty(
  //   "ADBE Vector Graphic - Fill"
  // );
  // myShapeFill.property("ADBE Vector Fill Color").setValue([0.5, 0.5, 1.0]);

  // var shapeLayer.name = "shape";

  // with (shapeLayer) {
  //   strokeWeight = currStrokeWeight;
  //   strokeTint = currStrokeTint;
  //   fillColor = currFillColor;
  //   fillTint = currFillTint;
  //   strokeColor = currStrokeColor;
  //   geometricBounds = ellipseBounds;
  // }

  return newEllipse;
};

pub.line = function (x1, y1, x2, y2) {
  if (arguments.length !== 4)
    error(
      "b.line(), not enough parameters to draw a line! Use: x1, y1, x2, y2"
    );
  // var lines = currentPage().graphicLines;
  // var newLine = lines.add(currentLayer());

  var comp = app.project.activeItem;
  var ShapeLayer = comp.layers.addShape();
  var ShapeLayerContents = ShapeLayer.property("ADBE Root Vectors Group");
  var ShapeGroup = ShapeLayerContents.addProperty("ADBE Vector Group");

  newLine.vertices = [
    [x1, y1],
    [x2, y2],
  ];

  ShapeGroup.property("ADBE Vectors Group")
    .addProperty("ADBE Vector Shape - Group")
    .setValue(newLine);

  // with (newLine) {
  //   strokeWeight = currStrokeWeight;
  //   strokeTint = currStrokeTint;
  //   fillColor = currFillColor;
  //   fillTint = currFillTint;
  //   strokeColor = currStrokeColor;
  // }
  // newLine.paths.item(0).entirePath = [
  //   [x1, y1],
  //   [x2, y2],
  // ];
  // newLine.transform(
  //   CoordinateSpaces.PASTEBOARD_COORDINATES,
  //   AnchorPoint.CENTER_ANCHOR,
  //   currMatrix.adobeMatrix()
  // );
  // return newLine;
};

// pub.ellipseMode = function (mode) {
//   if (arguments.length === 0) return currEllipseMode;
//   if (
//     mode === pub.CORNER ||
//     mode === pub.CORNERS ||
//     mode === pub.CENTER ||
//     mode === pub.RADIUS
//   ) {
//     currEllipseMode = mode;
//     return currEllipseMode;
//   } else {
//     error(
//       "b.ellipseMode(), Unsupported ellipseMode. Use: CENTER, RADIUS, CORNER, CORNERS."
//     );
//   }
// };
