pub.text = function (str, x, y, z) {
  var fontSize = currFontSize;
  var font = currFont;
  var tracking = currTracking;
  var leading = currLeading;
  var fillColor = currFillColor;
  var strokeColor = currStrokeColor;
  var strokeWeight = currStrokeWeight;
  var justification = currJustification;

  if (arguments.length !== 3 && arguments.length !== 4) {
    error(
      "m.text(), incorrect number of arguments! Usage: str, x, y or str, x, y, z"
    );
  }

  var result = pub.checkCompAndLayer("Text Layer", "text");
  var textLayer = result.layer;

  // Set text content
  var textProp = textLayer.property("Source Text");
  var textDocument = textProp.value;
  textDocument.text = str;
  textProp.setValue(textDocument);

  // Use textStyle function to build expression
  var expression = m.textStyle(
    fontSize,
    font,
    tracking,
    leading,
    fillColor,
    strokeColor,
    strokeWeight
  );
  textProp.expression = expression;

  textDocument.justification = justification;
  textProp.setValue(textDocument);

  if (arguments.length === 3) {
    textPosition = [x, y];
  } else {
    textPosition = [x, y, z];
  }
  // Apply current layer properties
  m.setLayerProperties(textLayer, { position: textPosition });

  return textLayer;
};

// Add some helper functions to set text style
pub.textSize = function (size) {
  currFontSize = size;
};

pub.textFont = function (font) {
  currFont = font;
};

pub.textAlign = function (align) {
  switch (align.toLowerCase()) {
    case "left":
      currJustification = ParagraphJustification.LEFT_JUSTIFY;
      break;
    case "center":
      currJustification = ParagraphJustification.CENTER_JUSTIFY;
      break;
    case "right":
      currJustification = ParagraphJustification.RIGHT_JUSTIFY;
      break;
    default:
      error(
        "m.textAlign(), unsupported alignment. Please use: 'left', 'center', or 'right'"
      );
  }
};

pub.textLeading = function (leading) {
  currLeading = leading;
};

pub.textTracking = function (tracking) {
  currTracking = tracking;
};

pub.textBox = function () {
  if (arguments == null) {
    currBoxSize = arguments;
  } else if (arguments.length == 2) {
    currBoxSize = [arguments[0], arguments[1]];
  } else {
    error(
      "m.textBox(), incorrect number of arguments! Usage: width, height or null"
    );
  }
};

pub.textStyle = function (
  fontSize,
  font,
  tracking,
  leading,
  fillColor,
  strokeColor,
  strokeWeight
) {
  var expression = "text.sourceText.style";
  expression += ".setFontSize(" + fontSize + ")";
  expression += ".setFont('" + font + "')";
  expression += ".setTracking(" + tracking + ")";
  if (leading == "auto") {
    expression += ".setAutoLeading(true)";
  } else {
    expression += ".setLeading(" + leading + ")";
  }

  // Handle fillColor
  if (fillColor !== null) {
    if (Array.isArray(fillColor)) {
      expression +=
        ".setFillColor([" + fillColor.join(", ") + "]).setApplyFill(true)";
    } else if (typeof fillColor === "string") {
      expression += ".setFillColor(" + fillColor + ").setApplyFill(true)";
    }
  } else {
    expression += ".setApplyFill(false)";
  }

  // Handle strokeColor
  if (strokeColor !== null) {
    if (Array.isArray(strokeColor)) {
      expression +=
        ".setStrokeColor([" +
        strokeColor.join(", ") +
        "]).setApplyStroke(true)";
    } else if (typeof strokeColor === "string") {
      expression += ".setStrokeColor(" + strokeColor + ").setApplyStroke(true)";
    }
  } else {
    expression += ".setApplyStroke(false)";
  }

  // Handle strokeWeight
  if (strokeWeight !== null) {
    expression += ".setStrokeWidth(" + strokeWeight.toString() + ")";
  }

  expression += ";";

  return expression;
};
