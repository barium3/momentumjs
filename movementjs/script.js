// 初始化全局变量
let csInterface, editor, fileTree, currentFilePath;

// DOM 加载完成后的初始化
document.addEventListener("DOMContentLoaded", initializeExtension);

// 初始化扩展
function initializeExtension() {
  csInterface = new CSInterface();
  initializeExtendScript();
  setupMonacoEditor();
  setupEventListeners();
  redirectConsoleOutput();
}

// 初始化 ExtendScript
function initializeExtendScript() {
  csInterface.evalScript(
    '$.evalFile("' +
      csInterface.getSystemPath(SystemPath.EXTENSION) +
      '/jsx/main.jsx")'
  );

  csInterface.evalScript("typeof($) !== 'undefined'", function (result) {
    if (result === "true") {
      csInterface.evalScript("testExtendScript()", function (result) {
        console.log("ExtendScript 测试结果:", result);
      });
      loadFileList();
    } else {
      document.getElementById("file-list").innerHTML =
        "<div>ExtendScript 环境初始化失败</div>";
    }
  });
}

// 设置 Monaco 编辑器
function setupMonacoEditor() {
  require.config({
    paths: {
      vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.30.1/min/vs",
    },
  });

  require(["vs/editor/editor.main"], function () {
    editor = monaco.editor.create(document.getElementById("editor"), {
      value: "// 选择左侧文件以编辑",
      language: "javascript",
      theme: "vs-dark",
      minimap: { enabled: false },
    });

    window.addEventListener("resize", function () {
      if (editor) {
        editor.layout();
      }
    });
  });
}

// 设置事件监听器
function setupEventListeners() {
  document
    .getElementById("runEditorScript")
    .addEventListener("click", runEditorScript);
  document.getElementById("saveFile").addEventListener("click", saveFile);
}

// 重定向控制台输出
function redirectConsoleOutput() {
  const consoleOutput = document.getElementById("console-output");
  const oldLog = console.log;
  const oldError = console.error;

  console.log = function () {
    const output = Array.prototype.slice.call(arguments).join(" ");
    consoleOutput.innerHTML += output + "<br>";
    oldLog.apply(console, arguments);
  };

  console.error = function () {
    const output = Array.prototype.slice.call(arguments).join(" ");
    consoleOutput.innerHTML +=
      '<span style="color: #f44747;">错误: ' + output + "</span><br>";
    oldError.apply(console, arguments);
  };
}

// 加载文件列表
function loadFileList() {
  const scriptPath = csInterface.getSystemPath(SystemPath.EXTENSION);
  const folderPath = scriptPath + "/user";

  csInterface.evalScript(
    'getFileList("' + folderPath + '")',
    handleFileListResult
  );
}

// 处理文件列表结果
function handleFileListResult(result) {
  const fileListElement = document.getElementById("file-list");

  if (!result) {
    fileListElement.innerHTML = "<div>获取文件列表失败：空结果</div>";
    return;
  }

  try {
    const response = JSON.parse(result);
    if (response.error) {
      fileListElement.innerHTML = "<div>错误: " + response.error + "</div>";
    } else if (response.files && response.files.length > 0) {
      fileTree = response.files;
      renderFileTree(fileTree, fileListElement);
    } else {
      fileListElement.innerHTML = "<div>没有找到文件</div>";
    }
  } catch (error) {
    fileListElement.innerHTML = "<div>加载文件列表时出错</div>";
  }
}

// 渲染文件树
function renderFileTree(items, container, level = 0) {
  items.forEach(function (item) {
    var div = document.createElement("div");
    div.className = item.isFolder ? "folder" : "file";
    div.style.paddingLeft = level * 20 + "px";

    if (item.isFolder) {
      div.innerHTML = '<span class="toggle">▶</span> ' + item.name;
      var childContainer = document.createElement("div");
      childContainer.className = "children";
      childContainer.style.display = "none";
      renderFileTree(item.children, childContainer, level + 1);
      div.appendChild(childContainer);

      div.querySelector(".toggle").onclick = function (e) {
        e.stopPropagation();
        this.textContent = this.textContent === "▶" ? "▼" : "▶";
        childContainer.style.display =
          childContainer.style.display === "none" ? "block" : "none";
      };
    } else {
      div.textContent = item.name;
      div.onclick = function () {
        loadFile(item.path, csInterface, editor);
      };
    }

    container.appendChild(div);
  });
}

// 加载文件
function loadFile(filePath, csInterface, editor) {
  currentFilePath = filePath;
  var fileExtension = filePath.split(".").pop().toLowerCase();
  var isImage =
    ["jpg", "jpeg", "png", "gif", "bmp"].indexOf(fileExtension) !== -1;

  if (isImage) {
    // 如果是图片，显示图片并隐藏编辑器
    document.getElementById("editor").style.display = "none";
    var imageContainer = document.getElementById("image-container");
    imageContainer.style.display = "flex";
    imageContainer.innerHTML =
      '<img src="file://' + filePath + '" alt="Image">';
  } else {
    // 如果不是图片，显示编辑器并隐藏图片容器
    document.getElementById("editor").style.display = "block";
    document.getElementById("image-container").style.display = "none";

    csInterface.evalScript('readFile("' + filePath + '")', function (content) {
      if (content.startsWith("Error:")) {
        editor.setValue("// 无法读取文件: " + content);
      } else {
        var language = "plaintext";

        if (fileExtension === "js" || fileExtension === "jsx") {
          language = "javascript";
        } else if (fileExtension === "html") {
          language = "html";
        } else if (fileExtension === "css") {
          language = "css";
        } else if (fileExtension === "json") {
          language = "json";
        } else if (fileExtension === "xml") {
          language = "xml";
        } else if (fileExtension === "csv") {
          language = "csv";
        }

        editor.getModel().setValue(content);
        monaco.editor.setModelLanguage(editor.getModel(), language);
      }
    });
  }
}

// 保存文件
function saveFile() {
  if (currentFilePath) {
    var fileExtension = currentFilePath.split(".").pop().toLowerCase();
    var isImage =
      ["jpg", "jpeg", "png", "gif", "bmp"].indexOf(fileExtension) !== -1;

    if (isImage) {
      console.log("图片文件无需保存");
      // 可以这
    } else {
      var content = editor.getValue();
      csInterface.evalScript(
        'writeFile("' +
          currentFilePath +
          '", "' +
          encodeURIComponent(content) +
          '")',
        function (result) {
          if (result.startsWith("Error:")) {
            console.error("保存文件时出错:", result);
            // 可以在这里添加错误提示
          } else {
            console.log(result);
            // 可以在这里添加存成功的提示
          }
        }
      );
    }
  } else {
    console.log("没有打开的文件可以保存");
    // 可以在这里添加错误提示
  }
}

/**
 * 执行来自 AE 脚本环境的代码，并返回结果。
 * @param {string} userCode - 要执行的代码。
 */

// 修改 executeUserCode 函数
function executeUserCode(userCode) {
  return new Promise((resolve, reject) => {
    csInterface.evalScript(
      "executeUserCode(" + JSON.stringify(userCode) + ")",
      function (result) {
        resolve(result);
      },
      function (error) {
        reject("执行错误：" + error);
      }
    );
  });
}

// 修改 runEditorScript 函数
function runEditorScript() {
  const code = editor.getValue();
  document.getElementById("console-output").innerHTML = ""; // 清空之前的输出
  executeUserCode(code)
    .then((result) => console.log("脚本执行结果：", result))
    .catch((error) => console.error(error));
}
