// 假设我们要使用 ml5.js 的图像分类功能
callML5Function("imageClassifier", ["MobileNet"])
  .then((classifier) => {
    // 使用分类器
    return callML5Function("classify", [classifier, "path/to/image.jpg"]);
  })
  .then((results) => {
    alert("Classification results: " + JSON.stringify(results));
  })
  .catch((error) => {
    alert("Error: " + error);
  });
