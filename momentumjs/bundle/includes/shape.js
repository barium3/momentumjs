pub.ellipse = function (x, y, w, h) {
  var shapeLayer;
  var fillColor = currFillColor;
  var strokeColor = currStrokeColor;
  var strokeWeight = currStrokeWeight;
  var opacity = currOpacity;
  var rotation = currRotation;
  var scale = currScale;
  var anchor = currAnchor;

  if (arguments.length !== 4)
    error("m.ellipse(), incorrect number of arguments! Usage: x, y, w, h ");

  var result = pub.checkCompAndLayer("Ellipse", "shape");
  var shapeLayer = result.layer;

  var shapeGroup = shapeLayer
    .property("Contents")
    .addProperty("ADBE Vector Group");
  var ellipse = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Shape - Ellipse");

  // Add transform properties to the shape group
  var groupTransform = shapeGroup.property("Transform");

  var isExpression =
    typeof x === "string" ||
    typeof y === "string" ||
    typeof w === "string" ||
    typeof h === "string";
  var calc = function (expr, num) {
    return isExpression ? expr : num;
  };

  var adjustedX, adjustedY, adjustedW, adjustedH;

  switch (currEllipseMode) {
    case pub.CENTER:
      adjustedX = x;
      adjustedY = y;
      adjustedW = w;
      adjustedH = h;
      break;
    case pub.RADIUS:
      adjustedX = x;
      adjustedY = y;
      adjustedW = calc(w + " * 2", w * 2);
      adjustedH = calc(h + " * 2", h * 2);
      break;
    case pub.CORNER:
      adjustedX = calc(x + " + " + w + " / 2", x + w / 2);
      adjustedY = calc(y + " + " + h + " / 2", y + h / 2);
      adjustedW = w;
      adjustedH = h;
      break;
    case pub.CORNERS:
      adjustedX = calc("(" + x + " + " + w + ") / 2", (x + w) / 2);
      adjustedY = calc("(" + y + " + " + h + ") / 2", (y + h) / 2);
      adjustedW = calc(w + " - " + x, w - x);
      adjustedH = calc(h + " - " + y, h - y);
      break;
  }

  setShapeProperties(shapeGroup, {
    anchor: anchor,
    position: [adjustedX, adjustedY],
    rotation: rotation,
    scale: scale,
    fillColor: fillColor,
    strokeColor: strokeColor,
    strokeWeight: strokeWeight,
    opacity: opacity,
    size: [adjustedW, adjustedH],
  });

  return shapeGroup;
};

pub.rect = function (x, y, w, h) {
  var shapeLayer;
  var fillColor = currFillColor;
  var strokeColor = currStrokeColor;
  var strokeWeight = currStrokeWeight;
  var opacity = currOpacity;

  var rotation = currRotation;
  var scale = currScale;
  var opacity = currOpacity;
  var anchor = currAnchor;

  if (arguments.length !== 4)
    error("m.rect(), incorrect number of arguments! Usage: x, y, w, h ");

  var result = pub.checkCompAndLayer("Rectangle", "shape");
  var shapeLayer = result.layer;

  var shapeGroup = shapeLayer
    .property("Contents")
    .addProperty("ADBE Vector Group");
  var rect = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Shape - Rect");

  var groupTransform = shapeGroup.property("Transform");

  var isExpression =
    typeof x === "string" ||
    typeof y === "string" ||
    typeof w === "string" ||
    typeof h === "string";
  var calc = function (expr, num) {
    return isExpression ? expr : num;
  };

  var adjustedX, adjustedY, adjustedW, adjustedH;
  switch (currRectMode) {
    case pub.CENTER:
      adjustedX = x;
      adjustedY = y;
      adjustedW = w;
      adjustedH = h;
      break;
    case pub.CORNER:
      adjustedX = calc(x + " + " + w + " / 2", x + w / 2);
      adjustedY = calc(y + " + " + h + " / 2", y + h / 2);
      adjustedW = w;
      adjustedH = h;
      break;
    case pub.CORNERS:
      adjustedX = calc("(" + x + " + " + w + ") / 2", (x + w) / 2);
      adjustedY = calc("(" + y + " + " + h + ") / 2", (y + h) / 2);
      adjustedW = calc(w + " - " + x, w - x);
      adjustedH = calc(h + " - " + y, h - y);
      break;
    case pub.RADIUS:
      adjustedX = x;
      adjustedY = y;
      adjustedW = calc(w + " * 2", w * 2);
      adjustedH = calc(h + " * 2", h * 2);
      break;
  }

  setShapeProperties(shapeGroup, {
    anchor: anchor,
    position: [adjustedX, adjustedY],
    rotation: rotation,
    scale: scale,
    fillColor: fillColor,
    strokeColor: strokeColor,
    strokeWeight: strokeWeight,
    opacity: opacity,
    size: [adjustedW, adjustedH],
  });

  return shapeGroup;
};

pub.polygon = function (x, y, radius, npoints) {
  var fillColor = currFillColor;
  var strokeColor = currStrokeColor;
  var strokeWeight = currStrokeWeight;
  var opacity = currOpacity;
  var rotation = currRotation;
  var scale = currScale;
  var anchor = currAnchor;

  if (arguments.length !== 4) {
    error(
      "m.polygon(), incorrect number of arguments! Usage: x, y, radius, npoints"
    );
  } else if (npoints < 3) {
    error("m.polygon(), number of points cannot be less than 3");
  }

  var result = pub.checkCompAndLayer("Polygon", "shape");
  var shapeLayer = result.layer;

  var shapeGroup = shapeLayer
    .property("Contents")
    .addProperty("ADBE Vector Group");
  var polygon = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Shape - Star");

  var groupTransform = shapeGroup.property("Transform");

  // Set polygon properties
  polygon.property("Type").setValue(2); // 2 means polygon
  if (typeof npoints === "string") {
    polygon.property("Points").setValue(3);
    var expression = controllable ? customProperty + "+" : "";
    expression += npoints;
    polygon.property("Points").expression = expression;
  } else {
    polygon.property("Points").setValue(npoints);
  }
  // m.handlePropertyValue(polygon.property("Points"), npoints);
  m.handlePropertyValue(polygon.property("Outer Radius"), radius);

  setShapeProperties(shapeGroup, {
    anchor: anchor,
    position: [x, y],
    rotation: rotation,
    scale: scale,
    fillColor: fillColor,
    strokeColor: strokeColor,
    strokeWeight: strokeWeight,
    opacity: opacity,
  });

  return shapeGroup;
};

pub.line = function (x1, y1, x2, y2) {
  var strokeColor = currStrokeColor;
  var strokeWeight = currStrokeWeight;
  var opacity = currOpacity;
  var rotation = currRotation;
  var scale = currScale;
  var anchor = currAnchor;

  if (arguments.length !== 4) {
    error("m.line(), incorrect number of arguments! Usage: x1, y1, x2, y2");
  }

  var result = pub.checkCompAndLayer("Line", "shape");
  var shapeLayer = result.layer;

  var shapeGroup = shapeLayer
    .property("Contents")
    .addProperty("ADBE Vector Group");
  var path = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Shape - Group");

  var groupTransform = shapeGroup.property("Transform");

  // Set path, using expression
  var pathExpression =
    "var x1 = " +
    x1 +
    ";\n" +
    "var y1 = " +
    y1 +
    ";\n" +
    "var x2 = " +
    x2 +
    ";\n" +
    "var y2 = " +
    y2 +
    ";\n" +
    "createPath(points = [[x1, y1], [x2, y2]], inTangents = [], outTangents = [], is_closed = false)";
  path.property("Path").expression = pathExpression;

  setShapeProperties(shapeGroup, {
    anchor: anchor,
    position: [0, 0],
    rotation: rotation,
    scale: scale,
    fillColor: null,
    strokeColor: strokeColor,
    strokeWeight: strokeWeight,
    opacity: opacity,
  });

  return shapeGroup;
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
      "m.ellipseMode(), unsupported ellipse mode. Please use: CENTER, RADIUS, CORNER, CORNERS."
    );
  }
};

pub.rectMode = function (mode) {
  if (arguments.length === 0) return currRectMode;
  if (
    mode === pub.CORNER ||
    mode === pub.CORNERS ||
    mode === pub.CENTER ||
    mode === pub.RADIUS
  ) {
    currRectMode = mode;
    return currRectMode;
  } else {
    error(
      "m.rectMode(), unsupported rectangle mode. Please use: CENTER, RADIUS, CORNER, CORNERS."
    );
  }
};

function setShapeProperties(shapeGroup, properties) {
  var groupTransform = shapeGroup.property("Transform");

  // Set anchor point
  m.handlePropertyValue(
    groupTransform.property("Anchor Point"),
    properties.anchor
  );

  // Set position
  m.handlePropertyValue(
    groupTransform.property("Position"),
    properties.position
  );

  // Set rotation
  m.handlePropertyValue(
    groupTransform.property("Rotation"),
    properties.rotation
  );

  // Set scale
  m.handlePropertyValue(groupTransform.property("Scale"), properties.scale);

  // Set fill (if provided)
  if (properties.fillColor !== null) {
    var fill = shapeGroup
      .property("Contents")
      .addProperty("ADBE Vector Graphic - Fill");
    m.handlePropertyValue(fill.property("Color"), properties.fillColor);
  }

  // Set stroke (if provided)
  if (properties.strokeColor !== null && properties.strokeWeight > 0) {
    var stroke = shapeGroup
      .property("Contents")
      .addProperty("ADBE Vector Graphic - Stroke");
    m.handlePropertyValue(stroke.property("Color"), properties.strokeColor);
    m.handlePropertyValue(
      stroke.property("Stroke Width"),
      properties.strokeWeight
    );
  }

  // Set opacity
  m.handlePropertyValue(groupTransform.property("Opacity"), properties.opacity);

  // Set size (for rectangles and ellipses)
  if (properties.size) {
    var shapeSize = shapeGroup
      .property("Contents")
      .property(1)
      .property("Size");
    m.handlePropertyValue(shapeSize, properties.size);
  }
}

pub.beginShape = function () {
  vertices = [];
  bezierVertices = [];
};

pub.vertex = function (
  x,
  y,
  xAnchorLeft,
  yAnchorLeft,
  xAnchorRight,
  yAnchorRight
) {
  if (arguments.length !== 2 && arguments.length !== 6) {
    error(
      "m.vertex(), incorrect number of arguments! Usage: x, y or x, y, xAnchorLeft, yAnchorLeft, xAnchorRight, yAnchorRight"
    );
  }

  var pointController = pub.pointController(x, y);
  vertices.push(pointController);

  if (arguments.length === 6) {
    var leftAnchor = pub.pointController(xAnchorLeft, yAnchorLeft);
    var rightAnchor = pub.pointController(xAnchorRight, yAnchorRight);
    bezierVertices.push([
      leftAnchor[0] + " - " + pointController[0],
      leftAnchor[1] + " - " + pointController[1],
      rightAnchor[0] + " - " + pointController[0],
      rightAnchor[1] + " - " + pointController[1],
    ]);
  } else {
    bezierVertices.push(null);
  }
};

pub.endShape = function (close) {
  if (vertices.length < 2) {
    error("m.endShape(), at least two vertices are needed to create a shape");
  }

  var result = pub.checkCompAndLayer("CustomShape", "shape");
  var shapeLayer = result.layer;

  var shapeGroup = shapeLayer
    .property("Contents")
    .addProperty("ADBE Vector Group");
  var path = shapeGroup
    .property("Contents")
    .addProperty("ADBE Vector Shape - Group");

  var pathExpression = "var points = [\n";
  pathExpression += vertices
    .map(function (v) {
      return "  [" + v[0] + ", " + v[1] + "]";
    })
    .join(",\n");
  pathExpression += "\n];\n";

  pathExpression += "var inTangents = [];\n";
  pathExpression += "var outTangents = [];\n";

  for (var i = 0; i < vertices.length; i++) {
    if (bezierVertices[i]) {
      pathExpression +=
        "inTangents.push([" +
        bezierVertices[i][0] +
        ", " +
        bezierVertices[i][1] +
        "]);\n";
      pathExpression +=
        "outTangents.push([" +
        bezierVertices[i][2] +
        ", " +
        bezierVertices[i][3] +
        "]);\n";
    } else {
      pathExpression += "inTangents.push([0,0]);\n";
      pathExpression += "outTangents.push([0,0]);\n";
    }
  }

  pathExpression +=
    "createPath(points, inTangents, outTangents, " +
    (close ? "true" : "false") +
    ")";

  path.property("Path").expression = pathExpression;

  setShapeProperties(shapeGroup, {
    anchor: currAnchor,
    position: [0, 0],
    rotation: currRotation,
    scale: currScale,
    fillColor: currFillColor,
    strokeColor: currStrokeColor,
    strokeWeight: currStrokeWeight,
    opacity: currOpacity,
  });

  vertices = [];
  bezierVertices = [];

  return shapeGroup;
};

pub.quad = function (x1, y1, x2, y2, x3, y3, x4, y4) {
  if (arguments.length !== 8) {
    error(
      "m.quad(), incorrect number of arguments! Usage: x1, y1, x2, y2, x3, y3, x4, y4"
    );
  }

  pub.beginShape();
  pub.vertex(x1, y1);
  pub.vertex(x2, y2);
  pub.vertex(x3, y3);
  pub.vertex(x4, y4);
  pub.endShape(true);
};

pub.triangle = function (x1, y1, x2, y2, x3, y3) {
  if (arguments.length !== 6) {
    error(
      "m.triangle(), incorrect number of arguments! Usage: x1, y1, x2, y2, x3, y3"
    );
  }

  pub.beginShape();
  pub.vertex(x1, y1);
  pub.vertex(x2, y2);
  pub.vertex(x3, y3);
  pub.endShape(true);
};
