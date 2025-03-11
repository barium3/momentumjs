// ----------------------------------------
// private vars
var customProperty = "thisProperty.value";
var currEllipseMode = pub.CENTER;
var currRectMode = pub.CENTER;
var currControllable = true;

var currColorMode = "RGB"; // 默认颜色模式
var currBlendMode = BlendingMode.NORMAL; // 默认叠加模式

pub.pointControllerCount = 0;
pub.sliderControllerCount = 0;
pub.angleControllerCount = 0;
pub.colorControllerCount = 0;

var currFillColor = [1, 1, 1, 1];
var currStrokeColor = [0, 0, 0, 1];
var currStrokeWeight = [1];
var currOpacity = 100;
var currPosition = [0, 0];
var currRotation = [0];
var currLayerRotation = [0];
var currScale = [100, 100];
var currLayerScale = [100, 100];
var currLayerOpacity = 100;
var currAnchor = [0, 0];
var currLayerAnchor = [0, 0];
var vertices = [];
var bezierVertices = [];

var textPosition = [0, 0];
var currFontSize = 26;
var currFont = "Arial";
var currTracking = 0;
var currLeading = 0;
var currJustification = ParagraphJustification.LEFT_JUSTIFY;
var currBoxSize = null;

// 新增：重设private vars的函数
// 该函数在每次运行前调用，可以将所有private变量恢复到默认值
pub.resetPrivateVars = function () {
  customProperty = "thisProperty.value";
  currEllipseMode = pub.CENTER;
  currRectMode = pub.CENTER;
  currControllable = true;
  currColorMode = "RGB";
  currBlendMode = BlendingMode.NORMAL;
  pub.pointControllerCount = 0;
  pub.sliderControllerCount = 0;
  pub.angleControllerCount = 0;
  pub.colorControllerCount = 0;
  currFillColor = [1, 1, 1, 1];
  currStrokeColor = [0, 0, 0, 1];
  currStrokeWeight = [1];
  currOpacity = 100;
  currPosition = [0, 0];
  currRotation = [0];
  currLayerRotation = [0];
  currScale = [100, 100];
  currLayerScale = [100, 100];
  currLayerOpacity = 100;
  currAnchor = [0, 0];
  currLayerAnchor = [0, 0];
  vertices = [];
  bezierVertices = [];
  textPosition = [0, 0];
  currFontSize = 26;
  currFont = "Arial";
  currTracking = 0;
  currLeading = 0;
  currJustification = ParagraphJustification.LEFT_JUSTIFY;
  currBoxSize = null;
};
