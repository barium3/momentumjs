// 初始化全局变量
let csInterface, editor, fileTree, currentFilePath;

// DOM 加载完成后的初始化
document.addEventListener("DOMContentLoaded", () => {
  csInterface = new CSInterface();
  setupEditor();
  setupEventListeners();
  initBridge();
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
    .addEventListener("click", runEditorScript);
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
}

// 初始化momentum桥接
function initBridge() {
  initMomentumEnvironment()
    .then(() => {
      // 无需显示提示信息
    })
    .catch((error) => {
      console.error("初始化失败:", error);
      // 尝试显示更多诊断信息
      const csInterface = new CSInterface();
      csInterface.evalScript(
        `"ExtendScript版本: " + $.version + "\\n" + "应用程序: " + app.name + " " + app.version`,
        (info) => console.log("诊断信息:", info)
      );
    });
}

// 加载文件列表
function loadFileList() {
  const folderPath = csInterface.getSystemPath(SystemPath.EXTENSION) + "/user";
  csInterface.evalScript(`getFileList("${folderPath}")`, (result) => {
    try {
      const response = JSON.parse(result);
      if (response.files && response.files.length > 0) {
        fileTree = response.files;
        renderFileTree(fileTree, document.getElementById("file-list"));
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
function renderFileTree(items, container, level = 0) {
  items.forEach((item) => {
    const div = document.createElement("div");
    div.className = item.isFolder ? "folder" : "file";
    div.style.paddingLeft = level * 20 + "px";

    if (item.isFolder) {
      div.innerHTML = '<span class="toggle">▶</span> ' + item.name;
      const childContainer = document.createElement("div");
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
      div.setAttribute("data-path", item.path);
      div.onclick = () => {
        loadFile(item.path);
        highlightSelectedFile(item.path);
      };
    }

    container.appendChild(div);
  });
}

// 加载文件
function loadFile(filePath) {
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

// 运行编辑器脚本
function runEditorScript() {
  const code = editor.getValue();
  document.getElementById("console-output").innerHTML = "";

  try {
    const execute = (0, eval)(`
      (function() {
        try {
          ${code}
        } catch(e) {
          console.error("执行错误:", e);
        }
      })
    `);
    execute();
    console.log("代码执行成功");
  } catch (error) {
    console.error("执行错误:", error);
  }
}

// 更新当前文件标签
function updateCurrentFileTab(filePath) {
  const fileName = filePath ? filePath.split("/").pop() : "未命名";
  document.getElementById("current-file-tab").textContent = fileName;
}

// 清除控制台
document.getElementById("clear-console").addEventListener("click", function () {
  document.getElementById("console-output").innerHTML = "";
});

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

// 高亮当前选中的文件
function highlightSelectedFile(filePath) {
  // 移除所有文件的active类
  const fileElements = document.querySelectorAll("#file-list .file");
  fileElements.forEach((el) => el.classList.remove("active"));

  // 为当前选中的文件添加active类
  fileElements.forEach((el) => {
    if (el.getAttribute("data-path") === filePath) {
      el.classList.add("active");
    }
  });
}
