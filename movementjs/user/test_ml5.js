// 测试 ml5.js 图像分类
function testML5ImageClassification() {
  // 检查 ml5 是否已加载
  if (typeof ml5 === "undefined") {
    console.error("ml5.js 未加载。请确保在 HTML 中正确引入了 ml5.js");
    return;
  }

  console.log("ml5.js 版本: " + ml5.version);

  // 确保 classifier 已初始化
  if (typeof window.classifier === "undefined") {
    console.log("正在初始化分类器，请稍候...");
    initClassifier(function (error) {
      if (error) {
        console.error("初始化分类器失败: " + error);
      } else {
        console.log("分类器初始化成功，继续测试...");
        continueTest();
      }
    });
  } else {
    continueTest();
  }
}

function initClassifier(callback) {
  try {
    window.classifier = ml5.imageClassifier("MobileNet", function () {
      console.log("ml5.js 模型已加载");
      callback(null);
    });
  } catch (error) {
    console.error("初始化分类器时发生错误:", error);
    callback(error);
  }
}

function continueTest() {
  console.log("开始加载图像...");

  // 创建一个图像元素
  var img = new Image();
  img.crossOrigin = "anonymous";
  // 修改图像源为本地文件
  img.src = "user/3-640x400(1).jpg";

  img.onload = function () {
    console.log("图像加载完成，开始分类...");

    if (typeof window.classifier === "undefined") {
      console.error("classifier 仍未定义。请检查 movement.js 是否正确加载");
      return;
    }

    window.classifier.classify(img, gotResult);
  };

  img.onerror = function () {
    console.error("图像加载失败");
  };
}

function gotResult(results, error) {
  if (error) {
    let errorMessage = "";
    if (Array.isArray(error)) {
      errorMessage = error
        .map(
          (e, index) =>
            `错误 ${index + 1}: ${JSON.stringify(
              e,
              Object.getOwnPropertyNames(e)
            )}`
        )
        .join("\n");
    } else if (typeof error === "object") {
      errorMessage = JSON.stringify(
        error,
        Object.getOwnPropertyNames(error),
        2
      );
    } else {
      errorMessage = error.toString();
    }
    console.error("分类过程中发生错误:\n" + errorMessage);
    return;
  }

  // 显示分类结果
  console.log("分类完成，结果如下：");
  if (Array.isArray(results)) {
    results.forEach((result, index) => {
      let message = `${index + 1}. ${
        result.label
      } (置信度: ${result.confidence.toFixed(2)})`;
      console.log(message);
    });
  } else {
    console.warn("结果格式不正确：" + JSON.stringify(results));
  }

  // 检查 movement.js 库是否已加载
  if (!checkMovementLibrary()) {
    return;
  }

  // 使用 m.image 添加图片
  try {
    var imageLayer = m.image(img.src, 0, 0, 640, 400);
    console.log("图片已添加到合成中");
  } catch (e) {
    console.error("添加图片时出错: " + e.message);
  }

  // 使用 m.text 添加文本信息
  try {
    m.textSize(24);
    m.textFont("Arial");
    m.textAlign("center");
    var textLayer = m.text(results[0].label, 320, 450);
    console.log("文本已添加到合成中");
  } catch (e) {
    console.error("添加文本时出错: " + e.message);
  }

  // 调用 ExtendScript 函数，将结果传递给 After Effects
  var jsonData = JSON.stringify(results);
  console.log("准备发送数据到 AE：" + jsonData);
  if (typeof csInterface !== "undefined") {
    csInterface.evalScript(
      `receiveDataFromJS(${JSON.stringify(jsonData)})`,
      function (response) {
        console.log("AE 脚本响应: " + response);
      }
    );
  } else {
    console.warn("csInterface 未定义，无法发送数据到 AE");
  }
}

// 检查 m 对象是否已定义
function checkMovementLibrary() {
  if (typeof m === "undefined") {
    console.error("movement.js 库未加载或初始化。请确保正确引入了 movement.js");
    return false;
  }
  return true;
}
// 执行测试
console.log("开始执行 testML5ImageClassification 函数");
testML5ImageClassification();
