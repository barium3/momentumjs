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
    error("m.text(), 参数数量不正确！使用: str, x, y 或 str, x, y, z");
  }

  var result = pub.checkCompAndLayer("文本图层", "text");
  var textLayer = result.layer;

  // 设置文本内容
  var textProp = textLayer.property("Source Text");
  var textDocument = textProp.value;
  textDocument.text = str;
  textProp.setValue(textDocument);

  // 使用 textStyle 函数构建表达式
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
  // 应用当前的图层属性
  m.setLayerProperties(textLayer, { position: textPosition });

  return textLayer;
};

// 添加一些辅助函数来设置文本样式
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
        "m.textAlign(), 不支持的对齐方式。请使用：'left', 'center', 或 'right'"
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
    error("m.textBox(), 参数数量不正确！使用: width, height 或 null");
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

  // 处理 fillColor
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

  // 处理 strokeColor
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

  // 处理 strokeWeight
  if (strokeWeight !== null) {
    expression += ".setStrokeWidth(" + strokeWeight.toString() + ")";
  }

  expression += ";";

  return expression;
};
