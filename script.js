// 初始化全局变量
let csInterface, editor, fileTree, currentFilePath;

// 全局变量存储已暴露的momentum方法名
window.exposedMomentumMethods = [];

// DOM 加载完成后的初始化
document.addEventListener("DOMContentLoaded", () => {
  csInterface = new CSInterface();
  setupEditor();
  setupEventListeners();
  initBridge();
  setupFileActions();
});

// 设置 Monaco 编辑器
function setupEditor() {
  require.config({
    paths: {
      vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.30.1/min/vs",
    },
  });

  require(["vs/editor/editor.main"], () => {
    editor = monaco.editor.create(document.getElementById("editor"), {
      value: "// 选择左侧文件以编辑",
      language: "javascript",
      theme: "vs-dark",
      minimap: { enabled: false },
      fontSize: 14,
      lineHeight: 22,
      fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
      scrollBeyondLastLine: false,
      automaticLayout: true,
      renderLineHighlight: "all",
      cursorBlinking: "smooth",
    });

    // 设置自定义主题
    setupMonacoTheme();

    window.addEventListener("resize", () => editor && editor.layout());
    loadFileList();
  });
}

// 设置事件监听器
function setupEventListeners() {
  document
    .getElementById("runEditorScript")
    .addEventListener("click", async function () {
      // 新增：每次执行脚本前重置private vars
      if (typeof m.resetPrivateVars === "function") {
        m.resetPrivateVars();
      }

      const code = editor.getValue();
      document.getElementById("console-output").innerHTML = "";

      try {
        // 检查代码是否包含async/await关键字
        const isAsync = code.includes("async ") || code.includes("await ");

        // 添加全局变量存储对象
        if (!window.momentumVars) {
          window.momentumVars = {};
        }

        // 构建执行函数，将变量对象作为参数传入
        let wrappedCode;
        if (isAsync) {
          wrappedCode = `
            (async function(vars) {
              try {
                // 允许代码访问持久化变量
                const persistentVars = vars;
                // 执行用户代码
                ${code}
                // 代码成功完成
                console.log("代码执行成功");
              } catch(e) {
                console.error("执行错误:", e);
              }
            })(window.momentumVars)
          `;
        } else {
          // 自动将代码包装在async函数中
          wrappedCode = `
            (async function(vars) {
              try {
                // 允许代码访问持久化变量
                const persistentVars = vars;
                // 执行用户代码，自动等待所有Promise
                ${addAwaitToPromises(code)}
                // 代码成功完成
                console.log("代码执行成功");
              } catch(e) {
                console.error("执行错误:", e);
              }
            })(window.momentumVars)
          `;
        }

        // 执行包装后的代码
        (0, eval)(wrappedCode);
      } catch (error) {
        console.error("执行错误:", error);
      }
    });
  document.getElementById("saveFile").addEventListener("click", saveFile);

  // 控制台输出重定向
  const consoleOutput = document.getElementById("console-output");
  ["log", "error", "warn"].forEach((method) => {
    const original = console[method];
    console[method] = function () {
      const output = Array.from(arguments).join(" ");
      const style = method === "error" ? 'style="color: #f44747;"' : "";
      consoleOutput.innerHTML += `<div ${style}>${output}</div>`;
      original.apply(console, arguments);
    };
  });

  // 添加键盘监听器，支持删除键删除文件
  document.addEventListener("keydown", (e) => {
    // 确保编辑器没有焦点时才处理删除操作
    if ((e.key === "Delete" || e.key === "Backspace") && !isEditorFocused()) {
      // 如果当前有选中的文件
      if (currentFilePath) {
        // 阻止默认行为（如浏览器的后退）
        e.preventDefault();
        e.stopPropagation();

        // 查找选中的文件或文件夹对象
        const selectedItem = findItemByPath(fileTree, currentFilePath);
        if (selectedItem) {
          deleteFileOrFolder(selectedItem);
        } else {
          console.warn("未找到对应项目:", currentFilePath);
        }
      } else {
        console.log("没有选中文件");
      }
    }
  });
}

// 检查编辑器是否有焦点
function isEditorFocused() {
  // 检查Monaco编辑器是否有焦点
  if (editor && editor.hasTextFocus()) {
    return true;
  }

  // 检查其他可能有焦点的输入元素
  const activeElement = document.activeElement;
  return (
    activeElement.tagName === "INPUT" ||
    activeElement.tagName === "TEXTAREA" ||
    activeElement.isContentEditable
  );
}

// 修改根据路径查找文件树中的项目的函数
function findItemByPath(items, path) {
  if (!items || !path) return null;

  // 规范化路径，处理不同操作系统的路径格式差异
  const normalizePath = (p) => {
    return p.replace(/\\/g, "/").replace(/\/\//g, "/");
  };

  const normalizedSearchPath = normalizePath(path);

  for (const item of items) {
    const normalizedItemPath = normalizePath(item.path);

    if (normalizedItemPath === normalizedSearchPath) {
      return item;
    }

    // 如果是文件夹，递归查找子项
    if (item.isFolder && item.children && item.children.length > 0) {
      const found = findItemByPath(item.children, path);
      if (found) return found;
    }
  }

  return null;
}

// 初始化momentum桥接
function initBridge() {
  initMomentumEnvironment()
    .then(() => {
      // 显式调用exposeMomentumGlobally确保其执行
      exposeMomentumGlobally();
    })
    .catch((error) => {
      console.error("初始化失败:", error);
    });
}

// 添加滚动位置保存功能
function saveScrollPosition() {
  const fileListContainer = document.querySelector(".file-list-container");
  window.lastScrollPosition = fileListContainer.scrollTop;
}

// 恢复滚动位置
function restoreScrollPosition() {
  if (window.lastScrollPosition !== undefined) {
    const fileListContainer = document.querySelector(".file-list-container");
    setTimeout(() => {
      fileListContainer.scrollTop = window.lastScrollPosition;
    }, 10);
  }
}

// 修改loadFileList函数以保持滚动位置和当前展开状态
function loadFileList() {
  // 保存滚动位置
  saveScrollPosition();

  // 保存展开状态
  saveExpandedFolderState();

  const folderPath = csInterface.getSystemPath(SystemPath.EXTENSION) + "/user";
  csInterface.evalScript(`getFileList("${folderPath}")`, (result) => {
    try {
      const response = JSON.parse(result);
      if (response.files && response.files.length > 0) {
        fileTree = response.files;
        renderFileTree(fileTree, document.getElementById("file-list"));

        // 恢复展开的文件夹状态
        restoreExpandedFolderState();

        // 恢复滚动位置
        restoreScrollPosition();
      } else {
        document.getElementById("file-list").innerHTML =
          "<div>没有找到文件</div>";
      }
    } catch (error) {
      document.getElementById("file-list").innerHTML =
        "<div>加载文件列表时出错</div>";
    }
  });
}

// 渲染文件树
function renderFileTree(items, container, level = 0, parentPath = "") {
  // 先清空容器
  container.innerHTML = "";

  items.forEach((item) => {
    const div = document.createElement("div");
    div.className = item.isFolder ? "folder" : "file";
    div.setAttribute("draggable", "true");

    // 对于所有项目，都设置path属性以便于查找
    div.setAttribute("data-path", item.path);

    // 记录原始位置
    div.setAttribute("data-original-index", items.indexOf(item));

    // 创建内容容器
    const contentDiv = document.createElement("div");
    contentDiv.className = "file-item-content";

    // 使用内联CSS来设置缩进，但只应用到最顶层
    if (level === 0) {
      contentDiv.style.paddingLeft = "4px";
    } else {
      // 子项不需要额外缩进，因为children div已有缩进
      contentDiv.style.paddingLeft = "0px";
    }

    // 创建文件操作按钮
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "file-actions-menu";

    // 删除按钮
    const deleteBtn = document.createElement("span");
    deleteBtn.className = "file-action delete";
    deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
    deleteBtn.title = "删除";
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      // 直接删除，不显示确认对话框
      deleteFileOrFolder(item);
    };
    actionsDiv.appendChild(deleteBtn);

    // 确保操作菜单添加到contentDiv内部
    contentDiv.appendChild(actionsDiv);
    div.appendChild(contentDiv);

    if (item.isFolder) {
      // 创建内容元素
      const nameSpan = document.createElement("span");
      nameSpan.className = "item-name";
      nameSpan.textContent = item.name;

      // 为展开/折叠图标添加点击事件
      const toggle = document.createElement("span");
      toggle.className = "toggle";
      toggle.textContent = "▶";
      toggle.onclick = (e) => {
        e.stopPropagation(); // 阻止冒泡，避免触发文件夹选择
        toggleFolder(div, toggle);
      };

      // 创建文件夹图标
      const folderIcon = document.createElement("span");
      folderIcon.className = "folder-icon";
      folderIcon.innerHTML = '<i class="fas fa-folder"></i>';

      // 组装内容
      contentDiv.appendChild(toggle);
      contentDiv.appendChild(folderIcon);
      contentDiv.appendChild(nameSpan);
      contentDiv.appendChild(actionsDiv);

      // 添加文件夹选择功能 - 点击文件夹名称部分时选中文件夹
      contentDiv.addEventListener("click", (e) => {
        // 如果点击的不是展开/折叠图标，则选中文件夹
        if (!e.target.classList.contains("toggle")) {
          currentFilePath = item.path;
          // 高亮显示选中的文件夹
          highlightSelectedFolder(item.path);
        }
      });

      // 创建子项容器但默认隐藏
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "children";
      childrenContainer.style.display = "none";

      // 向父容器添加元素
      div.appendChild(contentDiv);
      div.appendChild(childrenContainer);

      // 渲染子项
      if (item.children && item.children.length > 0) {
        renderFileTree(item.children, childrenContainer, level + 1, item.path);
      }

      // 添加拖放区域事件 - 恢复原有功能
      div.addEventListener("dragover", (e) => handleDragOver(e, div));
      div.addEventListener("dragleave", (e) => handleDragLeave(e, div));
      div.addEventListener("drop", (e) => handleDrop(e, item));

      // 为文件夹名称添加双击事件
      nameSpan.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        startRename(item, nameSpan);
      });
    } else {
      // 根据文件扩展名设置不同图标，但使用单色
      const fileExtension = item.name.split(".").pop().toLowerCase();
      let iconClass = "fa-file-alt";

      // 根据文件类型设置不同图标，但统一颜色
      if (/^(js|jsx)$/.test(fileExtension)) {
        iconClass = "fa-file-code";
      } else if (/^(html|xml)$/.test(fileExtension)) {
        iconClass = "fa-file-code";
      } else if (/^(css)$/.test(fileExtension)) {
        iconClass = "fa-file-code";
      } else if (/^(json)$/.test(fileExtension)) {
        iconClass = "fa-file-code";
      } else if (/^(jpg|jpeg|png|gif|bmp)$/.test(fileExtension)) {
        iconClass = "fa-file-image";
      } else if (/^(csv|tsv)$/.test(fileExtension)) {
        iconClass = "fa-file-csv";
      }

      // 使用span包装文件名以便于溢出处理和双击编辑
      contentDiv.innerHTML =
        `<i class="fas ${iconClass} file-icon"></i>` +
        `<span class="item-name">${item.name}</span>`;

      div.setAttribute("data-path", item.path);

      contentDiv.onclick = () => {
        loadFile(item.path);
        currentFilePath = item.path;
      };

      // 为文件名称添加双击事件
      const itemNameEl = contentDiv.querySelector(".item-name");
      itemNameEl.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        startRename(item, itemNameEl);
      });
    }

    // 添加拖动开始事件
    div.addEventListener("dragstart", (e) => handleDragStart(e, item, div));
    div.addEventListener("dragend", (e) => handleDragEnd(e, div));

    container.appendChild(div);
  });
}

// 加载文件
function loadFile(filePath) {
  // 设置当前文件路径
  currentFilePath = filePath;

  updateCurrentFileTab(filePath);

  // 获取文件扩展名
  const fileExtension = filePath.split(".").pop().toLowerCase();

  csInterface.evalScript(`readFile("${filePath}")`, (content) => {
    if (content.startsWith("Error:")) {
      showErrorMessage("无法读取文件: " + content);
      return;
    }

    // 检查是否为二进制文件（返回的是JSON对象）
    try {
      const jsonData = JSON.parse(content);
      if (jsonData && jsonData.type && jsonData.content) {
        // 处理二进制文件
        handleBinaryFile(jsonData);
        return;
      }
    } catch (e) {
      // 不是JSON，继续当作文本处理
    }

    // 处理文本文件
    handleTextFile(content, fileExtension);
  });

  // 高亮选中的文件
  highlightSelectedFile(filePath);
}

// 处理二进制文件
function handleBinaryFile(fileData) {
  const { type, content, path } = fileData;

  // 隐藏编辑器，显示图片容器
  document.getElementById("editor").style.display = "none";
  const imageContainer = document.getElementById("image-container");
  imageContainer.style.display = "flex";
  imageContainer.innerHTML = "";

  // 处理图片文件
  if (/^(jpg|jpeg|png|gif|bmp)$/i.test(type)) {
    const img = document.createElement("img");
    img.src = `data:image/${type};base64,${content}`;
    img.style.maxWidth = "100%";
    img.style.maxHeight = "100%";
    img.style.objectFit = "contain";
    imageContainer.appendChild(img);

    // 添加文件信息
    const infoDiv = document.createElement("div");
    infoDiv.className = "image-info";
    infoDiv.innerHTML = `<div>图片: ${path.split("/").pop()}</div>`;
    imageContainer.appendChild(infoDiv);
  }
  // 处理其他二进制文件类型 (PDF, PSD等)
  else {
    const fileIcon = document.createElement("div");
    fileIcon.className = "file-icon";
    fileIcon.innerHTML = `<i class="fas fa-file-alt"></i><div>无法预览此类型文件: ${type.toUpperCase()}</div>`;
    imageContainer.appendChild(fileIcon);
  }
}

// 处理文本文件
function handleTextFile(content, fileExtension) {
  // 显示编辑器，隐藏图片容器
  document.getElementById("editor").style.display = "block";
  document.getElementById("image-container").style.display = "none";

  const languageMap = {
    js: "javascript",
    jsx: "javascript",
    html: "html",
    css: "css",
    json: "json",
    xml: "xml",
    csv: "plaintext", // CSV特殊处理
  };

  // 为CSV文件提供特殊处理
  if (fileExtension === "csv") {
    // 如果想用编辑器查看CSV原始内容
    editor.getModel().setValue(content);
    monaco.editor.setModelLanguage(editor.getModel(), "plaintext");

    // 可选：显示CSV表格预览
    showCsvPreview(content);
  } else {
    // 普通文本文件
    editor.getModel().setValue(content);
    monaco.editor.setModelLanguage(
      editor.getModel(),
      languageMap[fileExtension] || "plaintext"
    );
  }
}

// 显示CSV表格预览
function showCsvPreview(csvContent) {
  // 创建CSV预览区域
  const previewContainer = document.createElement("div");
  previewContainer.id = "csv-preview";
  previewContainer.className = "csv-preview";

  // 解析CSV数据
  const rows = csvContent.split(/\r?\n/);
  const table = document.createElement("table");
  table.className = "csv-table";

  // 创建表格
  rows.forEach((row, rowIndex) => {
    if (!row.trim()) return; // 跳过空行

    const cells = row.split(",");
    const tr = document.createElement("tr");

    cells.forEach((cell, cellIndex) => {
      const td = document.createElement(rowIndex === 0 ? "th" : "td");
      td.textContent = cell.trim();
      tr.appendChild(td);
    });

    table.appendChild(tr);
  });

  previewContainer.appendChild(table);

  // 添加预览切换按钮
  const toggleBtn = document.createElement("button");
  toggleBtn.className = "btn csv-toggle";
  toggleBtn.innerHTML = '<i class="fas fa-table"></i> 切换CSV预览';
  toggleBtn.onclick = function () {
    const isVisible = previewContainer.style.display !== "none";
    previewContainer.style.display = isVisible ? "none" : "block";
    document.getElementById("editor").style.height = isVisible ? "100%" : "50%";
    editor.layout();
  };

  // 在编辑器上方添加切换按钮
  const editorHeader = document.querySelector(".editor-header");
  if (!document.querySelector(".csv-toggle")) {
    editorHeader.appendChild(toggleBtn);
  }

  // 插入表格到DOM
  const editorContainer = document.querySelector(".editor-container");
  if (!document.getElementById("csv-preview")) {
    previewContainer.style.display = "none"; // 默认隐藏
    editorContainer.insertBefore(
      previewContainer,
      document.getElementById("editor")
    );
  } else {
    document.getElementById("csv-preview").innerHTML = "";
    document.getElementById("csv-preview").appendChild(table);
  }
}

// 显示错误消息
function showErrorMessage(message) {
  editor.setValue("// " + message);
  document.getElementById("editor").style.display = "block";
  document.getElementById("image-container").style.display = "none";
  console.error(message);
}

// 保存文件
function saveFile() {
  if (currentFilePath) {
    const content = editor.getValue();
    csInterface.evalScript(
      `writeFile("${currentFilePath}", "${encodeURIComponent(content)}")`,
      (result) =>
        console.log(
          result.startsWith("Error:")
            ? console.error("保存失败:", result)
            : result
        )
    );
  } else {
    console.log("没有打开的文件可以保存");
  }
}

// 修改辅助函数：智能地为m对象调用添加await
function addAwaitToPromises(code) {
  // 解析代码以识别和排除普通函数定义内部
  let parsedCode = processCodeWithFunctionAwareness(code);
  return parsedCode;
}

// 新增：处理代码时识别函数定义范围
function processCodeWithFunctionAwareness(code) {
  // 将代码分割成函数定义和非函数定义区域
  const lines = code.split("\n");
  let inFunctionBody = false;
  let functionIsAsync = false;
  let braceCount = 0;
  let result = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // 检测函数定义开始
    if (!inFunctionBody && line.match(/function\s+\w+\s*\([^)]*\)\s*{/)) {
      inFunctionBody = true;
      functionIsAsync = line.includes("async function");
      braceCount = countChars(line, "{") - countChars(line, "}");

      // 添加原始函数声明行
      result.push(line);
      continue;
    }

    // 如果在函数体内
    if (inFunctionBody) {
      // 更新大括号计数
      braceCount += countChars(line, "{") - countChars(line, "}");

      // 如果函数结束
      if (braceCount <= 0) {
        inFunctionBody = false;
        functionIsAsync = false;
      }

      // 在async函数内部添加await或保持原样
      if (functionIsAsync) {
        result.push(addAwaitToLine(line));
      } else {
        // 在非async函数内部不添加await
        result.push(line);
      }
    } else {
      // 不在函数体内部时正常添加await
      result.push(addAwaitToLine(line));
    }
  }

  return result.join("\n");
}

// 辅助函数：计算字符串中特定字符的出现次数
function countChars(str, char) {
  return (str.match(new RegExp("\\" + char, "g")) || []).length;
}

// 辅助函数：处理单行代码添加await
function addAwaitToLine(line) {
  // 首先处理m.xxx()格式的调用
  let processedLine = line.replace(/(?<![.\w])m\.\w+\([^)]*\)/g, "await $&");

  // 如果有暴露的全局方法，为它们添加await
  if (
    window.exposedMomentumMethods &&
    window.exposedMomentumMethods.length > 0
  ) {
    const methodPattern = window.exposedMomentumMethods.join("|");
    const globalMethodRegex = new RegExp(
      `(?<![.\\w])(${methodPattern})\\([^)]*\\)`,
      "g"
    );

    // 为全局方法调用添加await
    processedLine = processedLine.replace(globalMethodRegex, "await $&");
  }

  return processedLine;
}

// 添加一个辅助函数用于清除持久化变量
function clearPersistentVars() {
  window.momentumVars = {};
  console.log("已清除所有持久化变量");
}

// 在现有的清空控制台功能中添加清除变量选项
document.getElementById("clear-console").addEventListener("click", function () {
  document.getElementById("console-output").innerHTML = "";
  clearPersistentVars();
});

// 更新当前文件标签
function updateCurrentFileTab(filePath) {
  const fileName = filePath ? filePath.split("/").pop() : "未命名";
  document.getElementById("current-file-tab").textContent = fileName;
}

// 设置Monaco编辑器主题
function setupMonacoTheme() {
  monaco.editor.defineTheme("momentum-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6A9955" },
      { token: "keyword", foreground: "C586C0" },
      { token: "string", foreground: "CE9178" },
      { token: "number", foreground: "B5CEA8" },
      { token: "function", foreground: "DCDCAA" },
    ],
    colors: {
      "editor.background": "#1e1e1e",
      "editor.foreground": "#d4d4d4",
      "editorCursor.foreground": "#ff6b35",
      "editor.lineHighlightBackground": "#2a2d2e",
      "editorLineNumber.foreground": "#858585",
      "editor.selectionBackground": "#264f78",
      "editor.inactiveSelectionBackground": "#3a3d41",
    },
  });

  // 应用自定义主题
  monaco.editor.setTheme("momentum-dark");
}

// 更新高亮选中的文件函数
function highlightSelectedFile(filePath) {
  // 移除所有文件和文件夹的高亮状态
  document
    .querySelectorAll("#file-list .file.active, #file-list .folder.active")
    .forEach((el) => {
      el.classList.remove("active");
    });

  // 获取删除按钮元素
  const deleteButton = document.getElementById("delete-selected");

  // 高亮当前选中的文件
  if (filePath) {
    const fileElement = document.querySelector(
      `#file-list .file[data-path="${filePath}"]`
    );
    if (fileElement) {
      fileElement.classList.add("active");

      // 确保更新全局变量存储当前选中的文件路径
      currentFilePath = filePath;

      // 启用删除按钮
      if (deleteButton) {
        deleteButton.classList.remove("disabled");
      }
    }
  } else {
    // 没有选中文件时禁用删除按钮
    if (deleteButton) {
      deleteButton.classList.add("disabled");
    }
  }
}

/**
 * 处理表达式字符串，确保转义正确并在AE中可用
 * @param {string} expressionPath - 表达式路径字符串
 * @param {boolean} withParens - 是否添加括号包裹表达式（默认true）
 * @returns {string} 格式化后的表达式字符串
 */
function formatExpression(expressionPath, withParens = true) {
  // 处理控制器表达式路径中的引号
  let formattedExpr = expressionPath.replace(/"/g, '\\"');

  // 可选择是否添加括号包裹表达式（帮助解决一些求值问题）
  if (
    withParens &&
    !formattedExpr.startsWith("(") &&
    !formattedExpr.endsWith(")")
  ) {
    formattedExpr = "(" + formattedExpr + ")";
  }

  return formattedExpr;
}

// 在window对象上暴露该函数，使其全局可用
window.formatExpression = formatExpression;

// 修改exposeMomentumGlobally函数，支持数学表达式格式化
function exposeMomentumGlobally() {
  const csInterface = new CSInterface();

  csInterface.evalScript(
    `(function() {
       var methodNames = [];
       var controllerMethods = []; // 存储控制器相关方法
       var mathExprMethods = []; // 存储数学表达式相关方法
       
       // 检查所有方法
       for (var prop in m) {
         if (typeof m[prop] === 'function') {
           methodNames.push(prop);
           
           // 识别控制器和表达式相关函数
           if (prop.indexOf('Controller') > -1) {
             controllerMethods.push(prop);
           }
           // 识别数学表达式函数
           else if (['add', 'mul', 'div', 'expressionPath'].indexOf(prop) > -1) {
             mathExprMethods.push(prop);
           }
         }
       }
       
       return JSON.stringify({
         methods: methodNames,
         controllers: controllerMethods,
         mathExpr: mathExprMethods
       });
     })()`,
    function (result) {
      try {
        const data = JSON.parse(result);
        const methodsToExpose = data.methods;
        const controllerMethods = data.controllers || [];
        const mathExprMethods = data.mathExpr || [];

        // 合并所有需要格式化的方法
        const formattingMethods = [...controllerMethods, ...mathExprMethods];

        // 保存方法名到全局变量
        window.exposedMomentumMethods = methodsToExpose;

        // 添加表达式格式处理函数
        window.m.formatExpression = formatExpression;

        // 为每个方法创建async包装函数
        methodsToExpose.forEach((methodName) => {
          window[methodName] = async function (...args) {
            // 调用m对象上的同名方法并等待结果
            const result = await window.m[methodName](...args);
            return result;
          };
        });
      } catch (e) {
        console.error("暴露Momentum函数失败:", e);
      }
    }
  );
}

// 添加测试代码确认格式化工作正常
function testExpressionFormatting() {
  // 创建一个模拟控制器表达式
  const testExpr =
    'comp("测试").layer("控制器").effect("Slider Control")("滑块")';
  console.log("原始表达式:", testExpr);
  console.log("格式化后:", formatExpression(testExpr));
}

// 在初始化完成后调用测试函数
window.testFormatting = testExpressionFormatting;

// 修改setupFileActions函数
function setupFileActions() {
  document.getElementById("new-file").addEventListener("click", () => {
    createFileInline();
  });

  document.getElementById("new-folder").addEventListener("click", () => {
    createFolderInline();
  });

  // 添加删除按钮事件监听
  document.getElementById("delete-selected").addEventListener("click", () => {
    deleteSelectedItem();
  });
}

// 删除当前选中项目
function deleteSelectedItem() {
  if (!currentFilePath) {
    return;
  }

  // 查找选中的文件或文件夹对象
  const selectedItem = findItemByPath(fileTree, currentFilePath);
  if (selectedItem) {
    deleteFileOrFolder(selectedItem);
  } else {
    console.warn("未找到对应项目:", currentFilePath);
  }
}

// 直接删除文件或文件夹
function deleteFileOrFolder(item) {
  // 为路径添加转义，防止特殊字符问题
  const escapedPath = item.path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  console.log("删除:", item.isFolder ? "文件夹" : "文件", escapedPath);

  // 调用ExtendScript API删除文件或文件夹
  csInterface.evalScript(`deleteFileOrFolder("${escapedPath}")`, (result) => {
    if (result.startsWith("Error:")) {
      console.error("删除失败:", result);
      alert("删除失败: " + result);
    } else {
      console.log("删除成功");

      // 如果当前打开的是被删除的文件，清空编辑器
      if (currentFilePath === item.path) {
        editor.setValue("");
        updateCurrentFileTab("未命名");
        currentFilePath = null;
      }

      // 重新加载文件列表
      loadFileList();
    }
  });
}

// 添加内联创建文件功能
function createFileInline() {
  // 创建一个新的div作为输入容器
  const newItem = document.createElement("div");
  newItem.className = "file new-item";

  // 添加内容容器
  const contentDiv = document.createElement("div");
  contentDiv.className = "file-item-content";
  contentDiv.style.paddingLeft = "4px"; // 基本缩进

  // 添加文件图标
  contentDiv.innerHTML = '<i class="fas fa-file-code file-icon"></i>';

  // 创建输入框
  const input = document.createElement("input");
  input.type = "text";
  input.className = "inline-create-input";
  input.placeholder = "输入文件名 (如: script.js)";
  contentDiv.appendChild(input);

  // 将内容添加到新项目
  newItem.appendChild(contentDiv);

  // 添加到文件列表的顶部
  const fileList = document.getElementById("file-list");
  if (fileList.firstChild) {
    fileList.insertBefore(newItem, fileList.firstChild);
  } else {
    fileList.appendChild(newItem);
  }

  // 立即聚焦输入框
  input.focus();

  // 处理输入事件
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const fileName = input.value.trim();

      if (fileName) {
        // 检查文件名是否有效
        if (/[<>:"/\\|?*]/.test(fileName)) {
          alert('文件名不能包含以下字符: < > : " / \\ | ? *');
          return;
        }

        // 创建文件
        const rootDir =
          csInterface.getSystemPath(SystemPath.EXTENSION) + "/user";
        createNewFile(rootDir + "/" + fileName);
      }

      // 移除输入框
      fileList.removeChild(newItem);
    } else if (e.key === "Escape") {
      // 取消创建
      fileList.removeChild(newItem);
    }
  });

  // 点击其他地方取消
  setTimeout(() => {
    document.addEventListener("click", function handleClickOutside(e) {
      if (!newItem.contains(e.target)) {
        if (fileList.contains(newItem)) {
          fileList.removeChild(newItem);
        }
        document.removeEventListener("click", handleClickOutside);
      }
    });
  }, 10);
}

// 在文件列表中直接创建新文件夹
function createFolderInline() {
  const fileList = document.getElementById("file-list");

  // 创建一个新的临时条目
  const tempItem = document.createElement("div");
  tempItem.className = "folder new-item";

  // 基础缩进
  const basePadding = 4;

  // 创建内容容器
  const contentDiv = document.createElement("div");
  contentDiv.className = "file-item-content";
  contentDiv.style.paddingLeft = basePadding + "px";

  // 添加图标和输入框
  contentDiv.innerHTML =
    '<i class="fas fa-folder folder-icon"></i>' +
    '<input type="text" class="inline-create-input" placeholder="输入文件夹名...">';

  tempItem.appendChild(contentDiv);
  fileList.insertBefore(tempItem, fileList.firstChild);

  // 聚焦输入框
  const input = contentDiv.querySelector(".inline-create-input");
  input.focus();

  // 处理输入框事件
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const folderName = input.value.trim();
      if (folderName) {
        const basePath =
          csInterface.getSystemPath(SystemPath.EXTENSION) + "/user";
        createNewFolder(basePath + "/" + folderName);
      }
      fileList.removeChild(tempItem);
    } else if (e.key === "Escape") {
      fileList.removeChild(tempItem);
    }
  });

  // 点击其他区域取消
  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (fileList.contains(tempItem)) {
        fileList.removeChild(tempItem);
      }
    }, 100);
  });
}

// 创建文件夹功能
function createNewFolder(folderPath) {
  // 为路径添加转义，防止特殊字符问题
  const escapedPath = folderPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  console.log("创建新文件夹:", escapedPath);

  csInterface.evalScript(`createFolder("${escapedPath}")`, (result) => {
    if (result.startsWith("Error:")) {
      console.error("创建文件夹失败:", result);
      alert("创建文件夹失败: " + result);
    } else {
      console.log("文件夹创建成功");
      loadFileList();
    }
  });
}

// 开始重命名过程
function startRename(item, nameSpan) {
  // 阻止在重命名过程中处理其他事件
  const originalName = item.name;
  const originalContent = nameSpan.textContent;
  const isFolder = item.isFolder;

  // 标记父元素为正在重命名状态
  const parentElement = nameSpan.closest(".file, .folder");
  if (parentElement) {
    parentElement.classList.add("renaming");
  }

  // 创建输入框
  const input = document.createElement("input");
  input.type = "text";
  input.className = "inline-create-input";
  input.value = originalName;
  input.style.width = "calc(100% - 28px)";

  // 替换原有的名称span
  nameSpan.textContent = "";
  nameSpan.appendChild(input);

  // 聚焦并选中全部文本
  input.focus();
  input.select();

  // 标记正在编辑状态
  let isEditing = true;

  // 完成重命名
  const completeRename = () => {
    if (!isEditing) return;
    isEditing = false;

    // 移除重命名状态
    if (parentElement) {
      parentElement.classList.remove("renaming");
    }

    const newName = input.value.trim();

    // 名称未变化或为空，恢复原名
    if (!newName || newName === originalName) {
      nameSpan.textContent = originalContent;
      return;
    }

    // 检查文件名是否有效
    if (/[<>:"/\\|?*]/.test(newName)) {
      alert('文件名不能包含以下字符: < > : " / \\ | ? *');
      nameSpan.textContent = originalContent;
      return;
    }

    // 获取新路径
    const oldPath = item.path;
    const parentPath = oldPath.substring(0, oldPath.lastIndexOf("/"));
    const newPath = parentPath + "/" + newName;

    // 临时更新UI，提供即时反馈
    nameSpan.textContent = newName;

    // 重命名（移动）文件或文件夹
    renameFileOrFolder(oldPath, newPath, isFolder, (success) => {
      if (success) {
        // 已经在UI中更新了名称，现在重新加载文件列表
        loadFileList();
      } else {
        // 恢复原名
        nameSpan.textContent = originalContent;
      }
    });
  };

  // 取消重命名
  const cancelRename = () => {
    if (!isEditing) return;
    isEditing = false;
    nameSpan.textContent = originalContent;
  };

  // 处理按键事件
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      completeRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelRename();
    }
  });

  // 处理失焦事件
  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (isEditing) {
        completeRename();
      }
    }, 100);
  });
}

// 修改调用后端重命名函数的代码
function renameFileOrFolder(oldPath, newPath, isFolder, callback) {
  // 转义路径中的特殊字符
  const escapedOldPath = oldPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const escapedNewPath = newPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  console.log(`尝试重命名: ${escapedOldPath} -> ${escapedNewPath}`);

  // 先尝试使用moveFile函数
  csInterface.evalScript(
    `moveFile("${escapedOldPath}", "${escapedNewPath}")`,
    (result) => {
      if (result.startsWith("Error:")) {
        console.error("重命名失败:", result);

        // 尝试第二种重命名方法
        csInterface.evalScript(
          `renameFile("${escapedOldPath}", "${escapedNewPath}")`,
          (result2) => {
            if (result2.startsWith("Error:")) {
              console.error("第二种重命名方法也失败:", result2);
              alert("重命名失败: " + result);
              callback(false);
            } else {
              console.log("使用备用方法重命名成功");
              // 如果当前打开的是被重命名的文件，更新当前路径
              if (currentFilePath === oldPath) {
                currentFilePath = newPath;
                updateCurrentFileTab(newPath);
              }
              callback(true);
            }
          }
        );
      } else {
        console.log("重命名成功");

        // 如果当前打开的是被重命名的文件，更新当前路径
        if (currentFilePath === oldPath) {
          currentFilePath = newPath;
          updateCurrentFileTab(newPath);
        }

        callback(true);
      }
    }
  );
}

// 拖动开始处理
function handleDragStart(e, item, element) {
  // 设置拖动数据
  e.dataTransfer.setData(
    "text/plain",
    JSON.stringify({
      path: item.path,
      name: item.name,
      isFolder: item.isFolder,
    })
  );
  e.dataTransfer.effectAllowed = "move";

  // 添加拖动样式
  element.classList.add("dragging");

  // 创建自定义拖动图像
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.textContent = item.name;
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 10, 10);

  // 延迟移除拖动图像
  setTimeout(() => {
    document.body.removeChild(ghost);
  }, 0);
}

// 拖动结束处理
function handleDragEnd(e, element) {
  element.classList.remove("dragging");
}

// 拖动经过文件夹时的处理
function handleDragOver(e, folderElement) {
  // 只有文件夹才能接收拖放
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  folderElement.classList.add("drag-over");
}

// 拖动离开文件夹时的处理
function handleDragLeave(e, folderElement) {
  folderElement.classList.remove("drag-over");
}

// 放置处理
function handleDrop(e, targetFolder) {
  e.preventDefault();
  e.currentTarget.classList.remove("drag-over");

  try {
    const dragData = JSON.parse(e.dataTransfer.getData("text/plain"));
    const sourcePath = dragData.path;
    const targetPath = targetFolder.path + "/" + dragData.name;

    // 防止拖放到自身或子文件夹
    if (
      sourcePath === targetPath ||
      (dragData.isFolder && targetPath.startsWith(sourcePath + "/"))
    ) {
      console.log("无法移动到自身或子文件夹");
      return;
    }

    // 调用移动文件API
    moveFileOrFolder(sourcePath, targetPath);
  } catch (err) {
    console.error("拖放处理错误:", err);
  }
}

// 移动文件或文件夹
function moveFileOrFolder(sourcePath, targetPath) {
  // 为路径添加转义，防止特殊字符问题
  const escapedSourcePath = sourcePath
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  const escapedTargetPath = targetPath
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

  // 调用ExtendScript API移动文件
  csInterface.evalScript(
    `moveFileOrFolder("${escapedSourcePath}", "${escapedTargetPath}")`,
    (result) => {
      if (result.startsWith("Error:")) {
        console.error("移动失败:", result);
        alert("移动失败: " + result);
      } else {
        // 如果当前打开的是被移动的文件，更新当前路径
        if (currentFilePath === sourcePath) {
          currentFilePath = targetPath;
          updateCurrentFileTab(targetPath);
        }

        // 重新加载文件列表
        loadFileList();
      }
    }
  );
}

// 保存当前展开的文件夹状态
function saveExpandedFolderState() {
  window.expandedFolders = [];
  document.querySelectorAll(".folder").forEach((folder) => {
    const childrenContainer = folder.querySelector(".children");
    if (childrenContainer && childrenContainer.style.display === "block") {
      const path = folder.getAttribute("data-path");
      if (path) window.expandedFolders.push(path);
    }
  });
}

// 恢复展开的文件夹状态
function restoreExpandedFolderState() {
  if (!window.expandedFolders) return;

  window.expandedFolders.forEach((path) => {
    const folder = document.querySelector(`.folder[data-path="${path}"]`);
    if (folder) {
      const toggle = folder.querySelector(".toggle");
      if (toggle && toggle.textContent === "▶") {
        toggle.click();
      }
    }
  });
}

// 修改文件夹展开逻辑，确保垃圾桶位置正确
function toggleFolder(folder, toggle) {
  const children = folder.querySelector(".children");
  if (children) {
    const isExpanded = children.style.display === "block";
    if (isExpanded) {
      children.style.display = "none";
      toggle.textContent = "▶";
      folder.classList.remove("expanded");

      // 更新文件夹图标
      const folderIcon = folder.querySelector(".folder-icon i");
      if (folderIcon) {
        folderIcon.className = "fas fa-folder";
      }

      // 恢复垃圾桶位置
      const actionsMenu = folder.querySelector(".file-actions-menu");
      if (actionsMenu) {
        actionsMenu.style.top = "50%";
        actionsMenu.style.transform = "translateY(-50%)";
      }
    } else {
      children.style.display = "block";
      toggle.textContent = "▼";
      folder.classList.add("expanded");

      // 更新文件夹图标为打开状态
      const folderIcon = folder.querySelector(".folder-icon i");
      if (folderIcon) {
        folderIcon.className = "fas fa-folder-open";
      }
    }
  }
}

// 高亮选中的文件夹
function highlightSelectedFolder(folderPath) {
  // 移除所有文件和文件夹的高亮状态
  document
    .querySelectorAll("#file-list .file.active, #file-list .folder.active")
    .forEach((el) => {
      el.classList.remove("active");
    });

  // 高亮当前选中的文件夹
  if (folderPath) {
    const folderElement = document.querySelector(
      `#file-list .folder[data-path="${folderPath}"]`
    );
    if (folderElement) {
      folderElement.classList.add("active");

      // 确保更新全局变量存储当前选中的文件夹路径
      currentFilePath = folderPath;

      // 启用删除按钮
      const deleteButton = document.getElementById("delete-selected");
      if (deleteButton) {
        deleteButton.classList.remove("disabled");
      }
    }
  }
}

// 创建新文件
function createNewFile(filePath) {
  // 为路径添加转义，防止特殊字符问题
  const escapedPath = filePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  // 调用ExtendScript API创建新文件
  csInterface.evalScript(`createNewFile("${escapedPath}")`, (result) => {
    if (result.startsWith("Error:")) {
      console.error("创建文件失败:", result);
      alert("创建文件失败: " + result);
    } else {
      console.log("文件创建成功");

      // 重新加载文件列表
      loadFileList();

      // 自动打开新创建的文件
      setTimeout(() => {
        loadFile(filePath);
        highlightSelectedFile(filePath);
      }, 100);
    }
  });
}
