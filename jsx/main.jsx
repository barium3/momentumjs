// 全局函数定义
$.global.testFunction = function () {
  return "testFunction 被调用";
};

// 文件操作相关函数
/**
 * 获取文件列表，并按名称排序
 * @param {string} folderPath - 要扫描的文件夹路径
 * @returns {string} - JSON格式的文件列表
 */
function getFileList(folderPath) {
  var folder = new Folder(folderPath);
  var files = [];

  try {
    if (folder.exists) {
      var contents = folder.getFiles();

      for (var i = 0; i < contents.length; i++) {
        var item = contents[i];
        var itemName = item.name;

        // 跳过隐藏文件和系统文件
        if (itemName.charAt(0) === "." || itemName.charAt(0) === "~") {
          continue;
        }

        var isFolder = item instanceof Folder;
        var fileObj = {
          name: itemName,
          path: item.fsName,
          isFolder: isFolder,
          children: [],
        };

        // 递归获取子文件夹
        if (isFolder) {
          var childFolder = new Folder(item.fsName);
          var childContents = childFolder.getFiles();

          // 如果文件夹不为空，递归获取子项
          if (childContents && childContents.length > 0) {
            var childResult = JSON.parse(getFileList(item.fsName));
            if (childResult.files) {
              fileObj.children = childResult.files;
            }
          }
        }

        files.push(fileObj);
      }

      // 对文件进行排序：先按类型排序（文件夹在前），然后按名称字母排序
      files.sort(function (a, b) {
        // 如果一个是文件夹一个是文件，文件夹优先
        if (a.isFolder !== b.isFolder) {
          return a.isFolder ? -1 : 1;
        }

        // 同类型按名称自然排序（考虑数字顺序）
        return a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });

      return JSON.stringify({ files: files });
    } else {
      return JSON.stringify({ error: "Folder does not exist: " + folderPath });
    }
  } catch (e) {
    return JSON.stringify({ error: e.toString() });
  }
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
      return JSON.stringify({
        error: true,
        message: "momentum." + call.function + " 函数不存在",
      });
    }

    // 执行函数并处理结果
    var result = m[call.function].apply(m, call.arguments);

    // 返回JSON字符串
    return JSON.stringify(result);
  } catch (e) {
    return JSON.stringify({
      error: true,
      message: e.message,
      stack: e.stack || "无堆栈信息",
    });
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

/**
 * 创建文件夹
 * @param {string} folderPath - 文件夹路径
 * @returns {string} - 操作结果信息
 */
function createFolder(folderPath) {
  $.writeln("创建文件夹: " + folderPath);

  try {
    // 检查文件夹是否已存在
    var folder = Folder(folderPath);
    if (folder.exists) {
      return "Error: 文件夹已存在";
    }

    // 创建文件夹
    if (folder.create()) {
      return "文件夹创建成功";
    } else {
      return "Error: 无法创建文件夹";
    }
  } catch (e) {
    return "Error: 创建文件夹时发生异常: " + e.toString();
  }
}

/**
 * 重命名文件或文件夹
 * @param {string} oldPath - 原路径
 * @param {string} newPath - 新路径
 * @returns {string} - 操作结果信息
 */
function renameFileOrFolder(oldPath, newPath) {
  // 添加调试日志
  $.writeln("重命名: 从 " + oldPath + " 到 " + newPath);

  try {
    var item = File(oldPath);
    if (!item.exists) {
      item = Folder(oldPath);
      if (!item.exists) {
        return "Error: 文件或文件夹不存在: " + oldPath;
      }
    }

    if (File(newPath).exists || Folder(newPath).exists) {
      return "Error: 目标名称已存在: " + newPath;
    }

    // 在重命名之前尝试关闭文件，如果它是打开的
    if (item instanceof File && item.open("r")) {
      item.close();
    }

    // 执行重命名
    var renameResult = item.rename(newPath);
    if (renameResult) {
      return "重命名成功";
    } else {
      // 尝试获取更详细的错误信息
      var errorMessage = "";
      if (typeof $.error === "object" && $.error.description) {
        errorMessage = $.error.description;
      }
      return "Error: 重命名失败 - " + (errorMessage || "未知原因");
    }
  } catch (e) {
    return "Error: 重命名过程中发生异常: " + e.toString();
  }
}

/**
 * 删除文件或文件夹
 * @param {string} path - 文件或文件夹路径
 * @returns {string} - 操作结果信息
 */
function deleteFileOrFolder(path) {
  var item = File(path);
  if (item.exists) {
    // 是文件
    if (item.remove()) {
      return "文件删除成功";
    } else {
      return "Error: 无法删除文件";
    }
  } else {
    // 可能是文件夹
    item = Folder(path);
    if (item.exists) {
      if (item.remove()) {
        return "文件夹删除成功";
      } else {
        return "Error: 无法删除文件夹，可能不为空";
      }
    } else {
      return "Error: 文件或文件夹不存在";
    }
  }
}

/**
 * 重命名文件的替代方法（使用复制和删除）
 */
function renameFileAlternative(oldPath, newPath) {
  try {
    var sourceFile = File(oldPath);
    if (sourceFile.exists) {
      // 对于文件，使用复制和删除的方式
      sourceFile.copy(newPath);
      if (File(newPath).exists) {
        sourceFile.remove();
        return "重命名成功 (使用复制和删除方法)";
      }
      return "Error: 复制文件失败";
    }

    // 文件夹无法简单复制，继续尝试普通重命名
    var sourceFolder = Folder(oldPath);
    if (sourceFolder.exists) {
      if (sourceFolder.rename(newPath)) {
        return "重命名成功";
      }
      return "Error: 文件夹重命名失败";
    }

    return "Error: 文件或文件夹不存在";
  } catch (e) {
    return "Error: 重命名替代方法失败: " + e.toString();
  }
}

/**
 * 移动文件或文件夹
 * @param {string} sourcePath - 源路径
 * @param {string} targetPath - 目标路径
 * @returns {string} - 操作结果信息
 */
function moveFileOrFolder(sourcePath, targetPath) {
  $.writeln("移动: 从 " + sourcePath + " 到 " + targetPath);

  try {
    // 检查源文件或文件夹是否存在
    var sourceItem = File(sourcePath);
    var isFile = sourceItem.exists;

    if (!isFile) {
      sourceItem = Folder(sourcePath);
      if (!sourceItem.exists) {
        return "Error: 源文件或文件夹不存在: " + sourcePath;
      }
    }

    // 检查目标路径是否已经存在
    if (File(targetPath).exists || Folder(targetPath).exists) {
      return "Error: 目标路径已存在: " + targetPath;
    }

    // 确保目标父文件夹存在
    var targetParent = targetPath.substring(0, targetPath.lastIndexOf("/"));
    var targetParentFolder = Folder(targetParent);
    if (!targetParentFolder.exists) {
      return "Error: 目标文件夹不存在: " + targetParent;
    }

    // 执行移动操作（通过复制+删除实现）
    if (isFile) {
      // 对于文件，使用复制和删除的方式
      if (!sourceItem.copy(targetPath)) {
        return "Error: 无法复制文件到目标位置";
      }

      if (!sourceItem.remove()) {
        // 尝试删除已复制的目标文件
        var targetFile = File(targetPath);
        if (targetFile.exists) {
          targetFile.remove();
        }
        return "Error: 复制成功但无法删除源文件";
      }

      return "文件移动成功";
    } else {
      // 对于文件夹，使用原生重命名（移动）方法
      if (sourceItem.rename(targetPath)) {
        return "文件夹移动成功";
      } else {
        // 如果原生方法失败，尝试递归复制文件夹内容
        return "Error: 无法移动文件夹，请尝试单独移动文件";
      }
    }
  } catch (e) {
    return "Error: 移动过程中发生异常: " + e.toString();
  }
}

/**
 * 创建新文件
 * @param {string} filePath - 文件路径
 * @returns {string} - 操作结果信息
 */
function createNewFile(filePath) {
  $.writeln("创建新文件: " + filePath);

  try {
    // 检查文件是否已经存在
    var newFile = File(filePath);
    if (newFile.exists) {
      return "Error: 文件已存在";
    }

    // 确保父文件夹存在
    var parentPath = filePath.substring(0, filePath.lastIndexOf("/"));
    var parentFolder = Folder(parentPath);
    if (!parentFolder.exists) {
      if (!parentFolder.create()) {
        return "Error: 无法创建父文件夹";
      }
    }

    // 创建并写入空文件
    if (newFile.open("w")) {
      newFile.write("// 新建脚本文件\n");
      newFile.close();
      return "文件创建成功";
    } else {
      return "Error: 无法创建文件";
    }
  } catch (e) {
    return "Error: 创建文件时发生异常: " + e.toString();
  }
}

/**
 * 创建新文档
 * @param {string} filePath - 文件路径
 * @param {string} content - 文档内容
 * @returns {string} - 操作结果信息
 */
function createNewDocument(filePath, content) {
  $.writeln("创建新文档: " + filePath);

  try {
    // 检查文件是否已经存在
    var newFile = File(filePath);
    if (newFile.exists) {
      return "Error: 文件已存在";
    }

    // 确保父文件夹存在
    var parentPath = filePath.substring(0, filePath.lastIndexOf("/"));
    var parentFolder = Folder(parentPath);
    if (!parentFolder.exists) {
      if (!parentFolder.create()) {
        return "Error: 无法创建父文件夹";
      }
    }

    // 创建并写入文件内容
    if (newFile.open("w")) {
      newFile.write(content || ""); // 如果没有内容，则创建空文件
      newFile.close();
      return "文档创建成功";
    } else {
      return "Error: 无法创建文档";
    }
  } catch (e) {
    return "Error: 创建文档时发生异常: " + e.toString();
  }
}

// 重命名文件或文件夹（使用移动方式实现）
function moveFile(oldPath, newPath) {
  try {
    var oldFile = new File(oldPath);

    if (!oldFile.exists) {
      return "Error: 源文件不存在: " + oldPath;
    }

    // 检查目标文件是否已存在
    var newFile = new File(newPath);
    if (newFile.exists) {
      return "Error: 目标文件已存在: " + newPath;
    }

    // 直接使用rename方法
    if (oldFile.rename(newPath)) {
      return "成功";
    } else {
      // 如果直接重命名失败，尝试复制后删除
      var success = oldFile.copy(newPath);
      if (success) {
        oldFile.remove();
        return "成功";
      } else {
        return "Error: 重命名失败";
      }
    }
  } catch (e) {
    return "Error: " + e.toString();
  }
}
