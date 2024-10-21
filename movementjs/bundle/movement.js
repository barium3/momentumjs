#target "aftereffects"; // 添加分号
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

// 示例：调用 runCodeInWebPage 函数
var codeToRun = 'var a = 1 + 2; a;';
var result = runCodeInWebPage(codeToRun);
$.writeln("运行结果: " + result);
