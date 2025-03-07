// // 创建一个新的合成（如果还没有活动的合成）
// var comp =
//   app.project.activeItem ||
//   app.project.items.addComp("新合成", 1920, 1080, 1, 10, 30);

// // 创建一个新的文本图层，初始大小可以是任意值
// var textLayer = comp.layers.addBoxText([200, 200]);

// // 获取文本图层的文本属性
// var textProp = textLayer.property("Source Text");

// // 创建一个新的文本文档对象
// var textDocument = textProp.value;

// // 设置文本内容
// textDocument.text = "hello world";

// // 将修改后的文本文档应用回文本图层
// textProp.setValue(textDocument);

// // 将文本图层移动到合成的中心
// textLayer.position.setValue([comp.width / 2, comp.height / 2]);
