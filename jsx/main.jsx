$.global.testFunction = function () {
  return "testFunction 被调用";
};

function getFileList(folderPath) {
  var folder = new Folder(folderPath);
  if (!folder.exists) {
    return JSON.stringify({ error: "文件夹不存在: " + folderPath });
  }

  function getItemsRecursively(currentFolder) {
    var items = currentFolder.getFiles();
    return items.map(function (item) {
      var result = {
        name: item.name,
        path: item.fsName.replace(/\\/g, "/"),
        isFolder: item instanceof Folder,
      };
      if (result.isFolder) {
        result.children = getItemsRecursively(item);
      }
      return result;
    });
  }

  var fileList = getItemsRecursively(folder);
  return JSON.stringify({ files: fileList });
}

function readFile(filePath) {
  var file = new File(filePath);
  if (!file.exists) {
    return "Error: 文件不存在: " + filePath;
  }
  file.open("r");
  var content = file.read();
  file.close();
  return content;
}

function executeUserCode(userCode) {
  try {
    var result = eval(userCode);
    return result;
  } catch (error) {
    return "执行错" + error.message;
  }
}

function testExtendScript() {
  return "ExtendScript 环境正常工作";
}

function writeFile(filePath, content) {
  $.writeln("Attempting to write file: " + filePath);
  $.writeln("Content length: " + content.length);
  var file = new File(filePath);
  file.encoding = "UTF-8"; // 确保使用UTF-8编码
  if (file.open("w")) {
    // 以写入模式打开文件
    file.write(decodeURIComponent(content)); // 解码内容
    file.close();
    return "文件保存成功";
    QA;
  } else {
    return "Error: 无法打开文件进行写入: " + filePath;
  }
}

// 定义接收数据的函数
function receiveDataFromJS(jsonData) {
  try {
    var data = JSON.parse(jsonData);
    $.writeln("接收到的数据: " + JSON.stringify(data));

    // 处理接收到的数据，例如创建图层、应用效果等
    if (app.project.activeItem && app.project.activeItem instanceof CompItem) {
      var comp = app.project.activeItem;
      var textLayer = comp.layers.addText("分类结果: " + data[0].label);
      textLayer.property("Source Text").setValue("分类结果: " + data[0].label);
    } else {
      alert("请先选择一个合成。");
    }
  } catch (e) {
    $.writeln("解析数据时出错: " + e.toString());
  }
}
