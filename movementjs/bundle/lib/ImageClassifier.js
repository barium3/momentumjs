// 添加 imageClassifier 对象
pub.imageClassifier = {
  // 初始化分类器
  init: function (modelName) {
    var script =
      'ml5.imageClassifier("' +
      modelName +
      '").then(classifier => { window.classifier = classifier; });';
    return $.global.executeUserCode(script);
  },

  // 分类图片
  classify: function (imagePath, callback) {
    var script =
      'window.classifier.classify("' +
      imagePath +
      '").then(results => { window.classifyResults = results; });';
    $.global.executeUserCode(script);

    // 轮询检查结果
    var checkResults = function () {
      var resultsScript =
        '(window.classifyResults ? JSON.stringify(window.classifyResults) : "")';
      var results = $.global.executeUserCode(resultsScript);

      if (results) {
        // 清除结果,为下次分类做准备
        $.global.executeUserCode("window.classifyResults = null;");

        // 解析结果并执行回调
        var parsedResults = JSON.parse(results);
        callback(parsedResults);
      } else {
        // 如果还没有结果,继续轮询
        $.sleep(100);
        checkResults();
      }
    };

    checkResults();
  },
};
