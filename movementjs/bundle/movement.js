#target "aftereffects";
var m = {};

(function(pub, app, undef) {

  pub.VERSION = "0.0.1";

  #include "includes/constants.js"; // 添加分号
  #include "includes/private-vars.js"; // 添加分号

  #include "includes/core.js"; // 添加分号

  #include "includes/shape.js"; // 添加分号
  #include "includes/typography.js"; // 添加分号
  #include "includes/color.js"; // 添加分号
  #include "includes/transformation.js"; // 添加分号
  #include "includes/math.js"; // 添加分号
  #include "includes/controller.js"; // 添加分号
  #include "includes/image.js"; // 添加分号
  #include "includes/environment.js"; // 添加分号
  #include "includes/data.js"; // 添加分号
  #include "includes/keyframe.js"; // 添加分号

//lib
  #include "lib/ImageClassifier.js"; // 添加分号

  $.global.m = pub;
})(m, app);


