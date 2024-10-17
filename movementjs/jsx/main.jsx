// 全局函数定义
$.global.testFunction = function () {
  return "testFunction 被调用";
};

// 文件操作相关函数
/**
 * 获取指定文件夹下的文件列表
 * @param {string} folderPath - 文件夹路径
 * @returns {string} - JSON 格式的文件列表或错误信息
 */
function getFileList(folderPath) {
  var folder = new Folder(folderPath);
  if (!folder.exists) {
    return JSON.stringify({ error: "文件夹不存在: " + folderPath });
  }

  /**
   * 递归获取文件夹中的所有文件和子文件夹
   * @param {Folder} currentFolder - 当前文件夹对象
   * @returns {Array} - 文件和文件夹的详细信息数组
   */
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

/**
 * 读取指定文件的内容
 * @param {string} filePath - 文件路径
 * @returns {string} - 文件内容或错误信息
 */
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

/**
 * 写入内容到指定文件
 * @param {string} filePath - 文件路径
 * @param {string} content - 要写入的内容
 * @returns {string} - 写入结果信息
 */
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
  } else {
    return "Error: 无法打开文件进行写入: " + filePath;
  }
}

// ExtendScript 环境测试函数
/**
 * 测试 ExtendScript 环境是否正常工作
 * @returns {string} - 测试结果信息
 */
function testExtendScript() {
  return "ExtendScript 环境正常工作";
}

// 添加全局函数
$.global.executeUserCode = function (code) {
  try {
    var result = eval(code);
    return JSON.stringify(result);
  } catch (error) {
    return "错误: " + error.message;
  }
};
