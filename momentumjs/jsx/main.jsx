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
  if (!folder.exists) return JSON.stringify({ error: "文件夹不存在" });

  function scanFolder(folder) {
    return folder.getFiles().map(function (item) {
      var isFolder = item instanceof Folder;
      return {
        name: item.name,
        path: item.fsName.replace(/\\/g, "/"),
        isFolder: isFolder,
        children: isFolder ? scanFolder(item) : [],
      };
    });
  }

  return JSON.stringify({ files: scanFolder(folder) });
}

/**
 * 读取指定文件的内容
 * @param {string} filePath - 文件路径
 * @returns {string} - 文件内容或错误信息
 */
function readFile(filePath) {
  var file = new File(filePath);
  if (!file.exists) return "Error: 文件不存在";

  var fileExtension = filePath.split(".").pop().toLowerCase();
  var isBinaryFile = /^(jpg|jpeg|png|gif|bmp|tif|tiff|psd|ai|pdf)$/i.test(
    fileExtension
  );

  if (isBinaryFile) {
    // 二进制文件使用二进制模式打开
    file.encoding = "binary";
    file.open("r");
    var binaryContent = file.read();
    file.close();

    // 返回文件类型和Base64编码的内容
    return JSON.stringify({
      type: fileExtension,
      content: binaryToBase64(binaryContent),
      path: filePath,
    });
  } else {
    // 文本文件正常处理
    file.open("r");
    var content = file.read();
    file.close();
    return content;
  }
}

/**
 * 将二进制数据转换为Base64编码
 * @param {string} binaryString - 二进制数据字符串
 * @returns {string} - Base64编码字符串
 */
function binaryToBase64(binaryString) {
  // ExtendScript中的Base64编码实现
  var base64 = "";
  var base64chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  // 每3个字节一组进行编码
  for (var i = 0; i < binaryString.length; i += 3) {
    var chunk = (binaryString.charCodeAt(i) & 0xff) << 16;
    if (i + 1 < binaryString.length) {
      chunk |= (binaryString.charCodeAt(i + 1) & 0xff) << 8;
    }
    if (i + 2 < binaryString.length) {
      chunk |= binaryString.charCodeAt(i + 2) & 0xff;
    }

    // 将24位数据分为4个6位数据，并查表转换为Base64字符
    base64 += base64chars[(chunk >> 18) & 0x3f];
    base64 += base64chars[(chunk >> 12) & 0x3f];

    if (i + 1 < binaryString.length) {
      base64 += base64chars[(chunk >> 6) & 0x3f];
    } else {
      base64 += "=";
    }

    if (i + 2 < binaryString.length) {
      base64 += base64chars[chunk & 0x3f];
    } else {
      base64 += "=";
    }
  }

  return base64;
}

/**
 * 写入内容到指定文件
 * @param {string} filePath - 文件路径
 * @param {string} content - 要写入的内容
 * @returns {string} - 写入结果信息
 */
function writeFile(filePath, content) {
  var file = new File(filePath);

  if (file.open("w")) {
    file.write(decodeURIComponent(content));
    file.close();
    return "文件保存成功";
  }

  return "Error: 无法写入文件";
}

// 添加新的函数来处理包含语句
function addIncludeStatement(code, scriptPath) {
  var extensionRoot = new File($.fileName).parent.parent.fsName;
  var momentumPath = extensionRoot + "/bundle/momentum.js";
  var relativeMomentumPath = File(momentumPath).fsName.replace(/\\/g, "/");
  var includeStatement = '#include "' + relativeMomentumPath + '";\n\n';
  return includeStatement + code;
}

// 修改 executeUserCode 函数
$.global.executeUserCode = function (code, scriptPath) {
  try {
    var codeWithInclude = addIncludeStatement(code, scriptPath);
    var result = eval(codeWithInclude);
    return JSON.stringify(result);
  } catch (error) {
    return "错误: " + error.message;
  }
};

// ExtendScript 环境测试函数
function testExtendScript() {
  return "ExtendScript 环境正常工作";
}

// 执行momentum函数调用
function executeMomentumFunction(jsonCall) {
  try {
    // 解析函数调用
    var call = JSON.parse(jsonCall);

    // 确保momentum库已加载
    if (typeof m === "undefined" || typeof m[call.function] !== "function") {
      return "Error: momentum." + call.function + " 函数不存在";
    }

    // 执行函数并返回结果
    var result = m[call.function].apply(m, call.arguments);
    return JSON.stringify(result);
  } catch (e) {
    return "Error: " + e.message;
  }
}

// 为用户代码执行设置环境
function setupUserCodeExecution() {
  try {
    // 更安全的路径获取方式
    var scriptFile = new File($.fileName);
    if (!scriptFile.exists) {
      return "Error: 无法确定脚本位置";
    }

    var extensionRoot = scriptFile.parent.parent.fsName;
    var momentumPath = extensionRoot + "/bundle/momentum.js";
    var momentumFile = new File(momentumPath);

    if (!momentumFile.exists) {
      return "Error: momentum.js文件不存在于路径: " + momentumPath;
    }

    $.writeln("加载momentum.js: " + momentumPath);
    $.evalFile(momentumPath);

    // 验证momentum对象
    if (typeof m === "undefined") {
      return "Error: momentum库加载失败，m对象未定义";
    }

    return "Setup successful";
  } catch (e) {
    $.writeln("初始化错误: " + e.toString());
    return "Error: " + e.message + " (行号: " + e.line + ")";
  }
}

// 在AE中执行用户代码
function executeUserCodeInAE(encodedCode) {
  try {
    // 解码用户代码
    var userCode = decodeURIComponent(encodedCode);

    // 添加momentum库引用
    // 执行用户代码
    var result = eval(userCode);

    // 返回结果
    return JSON.stringify(result);
  } catch (e) {
    return "Error: 执行代码时出错: " + e.message;
  }
}
