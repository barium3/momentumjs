// File management module
window.fileManager = (function () {
  let currentFilePath;
  let recentlyCreatedFile = null;

  function loadFileList() {
    var scriptPath = csInterface.getSystemPath(SystemPath.EXTENSION);
    var folderPath = scriptPath + "/user";
    // 转义路径中的特殊字符，确保正确传递给 ExtendScript
    var escapedPath = folderPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    csInterface.evalScript(
      'getFileList("' + escapedPath + '")',
      function (result) {
        if (!result) {
          document.getElementById("file-list").innerHTML =
            "<div>Failed to get file list: empty result</div>";
          return;
        }
        try {
          var response = JSON.parse(result);
          if (response.error) {
            document.getElementById("file-list").innerHTML =
              "<div>Error: " + response.error + "</div>";
          } else if (response.files && response.files.length > 0) {
            window.fileTree = response.files;

            filterDSStoreFiles(window.fileTree);

            sortFileTree(window.fileTree);

            window.fileTreeUI.renderFileTree(
              window.fileTree,
              document.getElementById("file-list"),
            );

            if (recentlyCreatedFile) {
              highlightFile(recentlyCreatedFile);
              recentlyCreatedFile = null;
            }
          } else {
            var pathHint = response.folderPath
              ? " (路径: " + response.folderPath + ")"
              : "";
            document.getElementById("file-list").innerHTML =
              "<div class='no-files-hint'>No files found" +
              pathHint +
              "<br><small>点击上方「新建」创建第一个文件</small></div>";
          }
        } catch (error) {
          document.getElementById("file-list").innerHTML =
            "<div>Error loading file list</div>";
        }
      },
    );
  }

  function filterDSStoreFiles(items) {
    for (let i = items.length - 1; i >= 0; i--) {
      if (!items[i].isFolder && items[i].name === ".DS_Store") {
        items.splice(i, 1);
      } else if (
        items[i].isFolder &&
        items[i].children &&
        items[i].children.length > 0
      ) {
        filterDSStoreFiles(items[i].children);
      }
    }
  }

  // Sort file tree with files before folders, recently created files first
  function sortFileTree(items) {
    const files = items.filter((item) => !item.isFolder);
    const folders = items.filter((item) => item.isFolder);

    files.sort((a, b) => {
      if (recentlyCreatedFile) {
        if (a.path === recentlyCreatedFile) return -1;
        if (b.path === recentlyCreatedFile) return 1;
      }
      return a.name.localeCompare(b.name);
    });

    folders.sort((a, b) => a.name.localeCompare(b.name));

    folders.forEach((folder) => {
      if (folder.children && folder.children.length > 0) {
        sortFileTree(folder.children);
      }
    });

    items.length = 0;
    items.push(...files, ...folders);
  }

  function highlightFile(filePath) {
    setTimeout(() => {
      const fileItems = document.querySelectorAll("#file-list .file");

      fileItems.forEach((item) => item.classList.remove("selected"));

      fileItems.forEach((item) => {
        if (item.getAttribute("data-path") === filePath) {
          item.classList.add("selected");
          item.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    }, 600);
  }

  function loadFile(filePath) {
    window.consoleManager.clearConsole();

    currentFilePath = filePath;
    var fileExtension = filePath.split(".").pop().toLowerCase();
    var isImage =
      ["jpg", "jpeg", "png", "gif", "bmp"].indexOf(fileExtension) !== -1;

    if (isImage) {
      document.getElementById("editor").style.display = "none";
      var imageContainer = document.getElementById("image-container");
      imageContainer.style.display = "flex";
      imageContainer.innerHTML =
        '<img src="file://' + filePath + '" alt="Image">';
    } else {
      document.getElementById("editor").style.display = "block";
      document.getElementById("image-container").style.display = "none";

      // 转义路径中的特殊字符
      var escapedFilePath = filePath
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
      csInterface.evalScript(
        'readFile("' + escapedFilePath + '")',
        function (content) {
          if (content.startsWith("Error:")) {
            window.editorManager.editor.setValue(
              "// Unable to read file: " + content,
            );
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

            window.editorManager.editor.getModel().setValue(content);
            monaco.editor.setModelLanguage(
              window.editorManager.editor.getModel(),
              language,
            );
          }
        },
      );
    }

    document.getElementById("current-filename").textContent = filePath
      .split("/")
      .pop();
  }

  function saveFile() {
    if (currentFilePath) {
      var fileExtension = currentFilePath.split(".").pop().toLowerCase();
      var isImage =
        ["jpg", "jpeg", "png", "gif", "bmp"].indexOf(fileExtension) !== -1;

      if (isImage) {
        console.log("Image files do not need to be saved");
      } else {
        var content = window.editorManager.editor.getValue();
        // 转义路径中的特殊字符
        var escapedFilePath = currentFilePath
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"');
        csInterface.evalScript(
          'writeFile("' +
            escapedFilePath +
            '", "' +
            encodeURIComponent(content) +
            '")',
          function (result) {
            if (result.startsWith("Error:")) {
              console.error("Error saving file:", result);
            } else {
              console.log(result);
            }
          },
        );
      }
    } else {
      console.log("No open file to save");
    }
  }

  function createNewFile() {
    window.fileTreeUI.showNewFileInput(function (fileName) {
      if (!fileName) return;

      window.consoleManager.clearConsole();

      if (!fileName.includes(".")) {
        fileName += ".js";
      }

      var scriptPath = csInterface.getSystemPath(SystemPath.EXTENSION);
      var userFolderPath = scriptPath + "/user";
      var newFilePath = userFolderPath + "/" + fileName;

      recentlyCreatedFile = newFilePath;

      // 转义路径中的特殊字符
      var escapedFilePath = newFilePath
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
      csInterface.evalScript(
        'writeFile("' +
          escapedFilePath +
          '", "' +
          encodeURIComponent("") +
          '")',
        function (result) {
          if (result.startsWith("Error:")) {
            console.error("Error creating file:", result);
            recentlyCreatedFile = null;
          } else {
            console.log("File created successfully:", fileName);

            loadFileList();

            setTimeout(function () {
              loadFile(newFilePath);
            }, 700);
          }
        },
      );
    });
  }

  function createNewFileInput(parentElement) {
    const container = document.createElement("div");
    container.className = "new-file-input-container";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "file-name-input";
    input.placeholder = "";

    container.appendChild(input);
    parentElement.appendChild(container);

    input.focus();

    return input;
  }

  function openFile(filename) {
    window.consoleManager.clearConsole();

    currentFilePath = filename;

    var fileExtension = filename.split(".").pop().toLowerCase();
    var isImage =
      ["jpg", "jpeg", "png", "gif", "bmp"].indexOf(fileExtension) !== -1;

    if (isImage) {
      document.getElementById("editor").style.display = "none";
      var imageContainer = document.getElementById("image-container");
      if (!imageContainer) {
        imageContainer = document.createElement("div");
        imageContainer.id = "image-container";
        imageContainer.style.display = "flex";
        imageContainer.style.justifyContent = "center";
        imageContainer.style.alignItems = "center";
        imageContainer.style.height = "100%";
        document.getElementById("editor-container").appendChild(imageContainer);
      } else {
        imageContainer.style.display = "flex";
      }
      imageContainer.innerHTML =
        '<img src="file://' +
        filename +
        '" alt="Image" style="max-width: 100%; max-height: 100%;">';
    } else {
      document.getElementById("editor").style.display = "block";
      const imageContainer = document.getElementById("image-container");
      if (imageContainer) {
        imageContainer.style.display = "none";
      }

      // 转义路径中的特殊字符
      var escapedFilename = filename
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
      csInterface.evalScript(
        'readFile("' + escapedFilename + '")',
        function (content) {
          if (content && content.startsWith("Error:")) {
            window.editorManager.editor.setValue(
              "// Unable to read file: " + content,
            );
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

            window.editorManager.editor.getModel().setValue(content);
            monaco.editor.setModelLanguage(
              window.editorManager.editor.getModel(),
              language,
            );
          }
        },
      );
    }

    document.getElementById("current-filename").textContent = filename
      .split("/")
      .pop();
  }

  function getLanguageFromFilename(filename) {
    const ext = filename.split(".").pop().toLowerCase();
    const languageMap = {
      js: "javascript",
      html: "html",
      css: "css",
      json: "json",
      md: "markdown",
      txt: "plaintext",
    };

    return languageMap[ext] || "plaintext";
  }

  function getCurrentFileName() {
    if (currentFilePath) {
      const fileName = currentFilePath.split("/").pop();
      // 去掉扩展名
      return fileName.replace(/\.[^/.]+$/, "");
    }
    return null;
  }

  return {
    loadFileList: loadFileList,
    loadFile: loadFile,
    saveFile: saveFile,
    createNewFile: createNewFile,
    openFile: openFile,
    getCurrentFileName: getCurrentFileName,
  };
})();
