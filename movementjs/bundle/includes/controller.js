pub.pointController = function (x, y) {
  var result = pub.checkCompAndLayer("PointController", [
    "shape",
    "text",
    "null",
  ]);
  var comp = result.comp;
  var layer = result.layer;

  pub.pointControllerCount++;
  var controllerName = "Position Control " + pub.pointControllerCount;

  var expressionControl = layer.effect.addProperty("ADBE Point Control");
  expressionControl.name = controllerName;

  var language = pub.getAELanguage();
  var pointPropertyName = language === "zh_CN" ? "点" : "Point";

  var pointProperty = expressionControl.property(pointPropertyName);
  m.handlePropertyValue(pointProperty, [x, y]);

  return [
    'comp("' +
      comp.name +
      '").layer("' +
      layer.name +
      '").effect("' +
      controllerName +
      '")("' +
      pointPropertyName +
      '")[0]',
    'comp("' +
      comp.name +
      '").layer("' +
      layer.name +
      '").effect("' +
      controllerName +
      '")("' +
      pointPropertyName +
      '")[1]',
  ];
};

pub.sliderController = function (value) {
  var result = pub.checkCompAndLayer("SliderController", [
    "shape",
    "text",
    "null",
  ]);
  var comp = result.comp;
  var layer = result.layer;

  pub.sliderControllerCount++;
  var controllerName = "Slider Control " + pub.sliderControllerCount;

  var expressionControl = layer.effect.addProperty("ADBE Slider Control");
  expressionControl.name = controllerName;

  var language = pub.getAELanguage();
  var sliderPropertyName = language === "zh_CN" ? "滑块" : "Slider";

  var sliderProperty = expressionControl.property(sliderPropertyName);
  m.handlePropertyValue(sliderProperty, value);

  return (
    'comp("' +
    comp.name +
    '").layer("' +
    layer.name +
    '").effect("' +
    controllerName +
    '")("' +
    sliderPropertyName +
    '")'
  );
};

pub.angleController = function (value) {
  var result = pub.checkCompAndLayer("AngleController", [
    "shape",
    "text",
    "null",
  ]);
  var comp = result.comp;
  var layer = result.layer;

  pub.angleControllerCount++;
  var controllerName = "Angle Control " + pub.angleControllerCount;

  var expressionControl = layer.effect.addProperty("ADBE Angle Control");
  expressionControl.name = controllerName;

  var language = pub.getAELanguage();
  var anglePropertyName = language === "zh_CN" ? "角度" : "Angle";

  var angleProperty = expressionControl.property(anglePropertyName);
  m.handlePropertyValue(angleProperty, value);

  return (
    'comp("' +
    comp.name +
    '").layer("' +
    layer.name +
    '").effect("' +
    controllerName +
    '")("' +
    anglePropertyName +
    '")'
  );
};

pub.colorController = function () {
  var result = pub.checkCompAndLayer("ColorController", [
    "shape",
    "text",
    "null",
  ]);
  var comp = result.comp;
  var layer = result.layer;

  pub.colorControllerCount++;
  var controllerName = "Color Control " + pub.colorControllerCount;

  var expressionControl = layer.effect.addProperty("ADBE Color Control");
  expressionControl.name = controllerName;

  // 使用语言检测函数
  var language = pub.getAELanguage();
  var colorPropertyName = language === "zh_CN" ? "颜色" : "Color";

  // 使用 color 函数处理输入参数
  var colorValue = pub.color.apply(null, arguments);

  // 设置初始颜色值
  expressionControl.property(colorPropertyName).setValue(colorValue);

  // 设置表达式
  var returnExpression =
    'comp("' +
    comp.name +
    '").layer("' +
    layer.name +
    '").effect("' +
    controllerName +
    '")("' +
    colorPropertyName +
    '")';

  // 返回字符串形式的表达式
  return returnExpression;
};

pub.booleanController = function (value) {
  var result = pub.checkCompAndLayer("BooleanController", [
    "shape",
    "text",
    "null",
  ]);
  var comp = result.comp;
  var layer = result.layer;

  pub.booleanControllerCount = pub.booleanControllerCount || 0;
  pub.booleanControllerCount++;
  var controllerName = "Checkbox Control " + pub.booleanControllerCount;

  var expressionControl = layer.effect.addProperty("ADBE Checkbox Control");
  expressionControl.name = controllerName;

  var language = pub.getAELanguage();
  var checkboxPropertyName = language === "zh_CN" ? "复选框" : "Checkbox";

  var checkboxProperty = expressionControl.property(checkboxPropertyName);
  m.handlePropertyValue(checkboxProperty, value ? 1 : 0);

  return (
    'comp("' +
    comp.name +
    '").layer("' +
    layer.name +
    '").effect("' +
    controllerName +
    '")("' +
    checkboxPropertyName +
    '")'
  );
};
