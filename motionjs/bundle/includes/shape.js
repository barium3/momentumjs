pub.ellipse = function (x, y, w, h) {
  if (arguments.length !== 4)
    error(
      "b.ellipse(), not enough parameters to draw an ellipse! Use: x, y, w, h"
    );
  var ellipseBounds = [];
  if (currEllipseMode === pub.CORNER) {
    ellipseBounds[0] = y;
    ellipseBounds[1] = x;
    ellipseBounds[2] = y + h;
    ellipseBounds[3] = x + w;
  } else if (currEllipseMode === pub.CORNERS) {
    ellipseBounds[0] = y;
    ellipseBounds[1] = x;
    ellipseBounds[2] = h;
    ellipseBounds[3] = w;
  } else if (currEllipseMode === pub.CENTER) {
    ellipseBounds[0] = y - h / 2;
    ellipseBounds[1] = x - w / 2;
    ellipseBounds[2] = y + h - h / 2;
    ellipseBounds[3] = x + w - w / 2;
  } else if (currEllipseMode === pub.RADIUS) {
    ellipseBounds[0] = y - h;
    ellipseBounds[1] = x - w;
    ellipseBounds[2] = y + h;
    ellipseBounds[3] = x + w;
  }

  if (w === 0 || h === 0) return false;

  var ovals = currentPage().ovals;
  var newOval = ovals.add(currentLayer());
  with (newOval) {
    strokeWeight = currStrokeWeight;
    strokeTint = currStrokeTint;
    fillColor = currFillColor;
    fillTint = currFillTint;
    strokeColor = currStrokeColor;
    geometricBounds = ellipseBounds;
  }

  //   if (currEllipseMode === pub.CENTER || currEllipseMode === pub.RADIUS) {
  //     newOval.transform(
  //       CoordinateSpaces.PASTEBOARD_COORDINATES,
  //       AnchorPoint.CENTER_ANCHOR,
  //       currMatrix.adobeMatrix()
  //     );
  //   } else {
  //     newOval.transform(
  //       CoordinateSpaces.PASTEBOARD_COORDINATES,
  //       AnchorPoint.TOP_LEFT_ANCHOR,
  //       currMatrix.adobeMatrix()
  //     );
  //   }
  //   return newOval;
};

pub.ellipseMode = function (mode) {
  if (arguments.length === 0) return currEllipseMode;
  if (
    mode === pub.CORNER ||
    mode === pub.CORNERS ||
    mode === pub.CENTER ||
    mode === pub.RADIUS
  ) {
    currEllipseMode = mode;
    return currEllipseMode;
  } else {
    error(
      "b.ellipseMode(), Unsupported ellipseMode. Use: CENTER, RADIUS, CORNER, CORNERS."
    );
  }
};
