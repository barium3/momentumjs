// File panel state, file I/O, and editor/preview switching.
window.fileManager = (function () {
  const DRAFT_FILE_NAME = "Untitled.js";
  const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "bmp"];
  const LANGUAGE_BY_EXTENSION = {
    js: "javascript",
    jsx: "javascript",
    html: "html",
    css: "css",
    json: "json",
    xml: "xml",
    csv: "csv",
  };
  let currentFilePath = null;
  let currentSessionName = DRAFT_FILE_NAME;
  let isDraftSession = false;
  let recentlyCreatedFile = null;
  let pendingEditorState = null;

  function escapeFilePathForEval(filePath) {
    return filePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function getUserFolderPath() {
    return csInterface.getSystemPath(SystemPath.EXTENSION) + "/user";
  }

  function getFileExtension(filePath) {
    const parts = String(filePath || "").split(".");
    return parts.length > 1 ? parts.pop().toLowerCase() : "";
  }

  function setFileListMessage(html) {
    document.getElementById("file-list").innerHTML = html;
  }

  function writeEncodedFile(filePath, content, callback) {
    const escapedFilePath = escapeFilePathForEval(filePath);
    csInterface.evalScript(
      'writeFile("' + escapedFilePath + '", "' + encodeURIComponent(content) + '")',
      callback,
    );
  }

  function clearConsole() {
    window.consoleManager.clearConsole();
  }

  function flushPendingEditorState() {
    if (!pendingEditorState || !window.editorManager || !window.editorManager.editor) {
      return false;
    }

    const editor = window.editorManager.editor;
    const model = editor.getModel();
    if (!model) {
      return false;
    }

    const nextContent = pendingEditorState.content || "";
    const nextLanguage = pendingEditorState.language || "plaintext";
    const currentContent =
      typeof model.getValue === "function" ? model.getValue() : "";
    const currentLanguage =
      typeof model.getLanguageId === "function"
        ? model.getLanguageId()
        : "plaintext";
    const contentChanged = currentContent !== nextContent;
    const languageChanged = currentLanguage !== nextLanguage;

    if (contentChanged) {
      model.setValue(nextContent);
    }

    if (languageChanged) {
      monaco.editor.setModelLanguage(model, nextLanguage);
    }

    if (
      (contentChanged || languageChanged) &&
      nextLanguage === "javascript" &&
      typeof window.editorManager.formatDocument === "function"
    ) {
      Promise.resolve(
        window.editorManager.formatDocument({
          restoreFocus: false,
        }),
      ).catch(() => false);
    }

    pendingEditorState = null;
    return true;
  }

  window.addEventListener("momentum:editor-ready", flushPendingEditorState);

  function loadFileList() {
    const folderPath = getUserFolderPath();

    const escapedPath = escapeFilePathForEval(folderPath);
    csInterface.evalScript(
      'getFileList("' + escapedPath + '")',
      function (result) {
        if (!result) {
          setFileListMessage("<div>Failed to get file list: empty result</div>");
          return;
        }
        try {
          const response = JSON.parse(result);
          if (response.error) {
            setFileListMessage("<div>Error: " + response.error + "</div>");
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
            } else if (!isDraftSession && currentFilePath) {
              window.fileTreeUI.selectFile(currentFilePath);
            }
          } else {
            const pathHint = response.folderPath
              ? " (Path: " + response.folderPath + ")"
              : "";
            setFileListMessage(
              "<div class='no-files-hint'>No files found" +
              pathHint +
              "<br><small>Click the New button above to create your first file</small></div>",
            );
          }
        } catch (error) {
          setFileListMessage("<div>Error loading file list</div>");
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

  // Keep files above folders and bubble the newest file to the top.
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
      window.fileTreeUI.selectFile(filePath, { scrollIntoView: true });
    }, 600);
  }

  function resolveEditorLanguage(fileExtension) {
    return LANGUAGE_BY_EXTENSION[fileExtension] || "plaintext";
  }

  function applyEditorContent(content, language) {
    pendingEditorState = {
      content: content || "",
      language: language || "plaintext",
    };
    flushPendingEditorState();
  }

  function isImageExtension(fileExtension) {
    return IMAGE_EXTENSIONS.indexOf(fileExtension) !== -1;
  }

  function isRunnableExtension(fileExtension) {
    return fileExtension === "js";
  }

  function syncRunAvailability(fileExtension) {
    if (
      window.editorManager &&
      typeof window.editorManager.setRunEnabled === "function"
    ) {
      window.editorManager.setRunEnabled(isRunnableExtension(fileExtension));
    }
  }

  function ensureImageContainer() {
    let imageContainer = document.getElementById("image-container");
    if (!imageContainer) {
      imageContainer = document.createElement("div");
      imageContainer.id = "image-container";
      imageContainer.style.display = "flex";
      imageContainer.style.justifyContent = "center";
      imageContainer.style.alignItems = "center";
      imageContainer.style.height = "100%";
      document.getElementById("editor-container").appendChild(imageContainer);
    }

    return imageContainer;
  }

  function showImagePreview(filePath) {
    document.getElementById("editor").style.display = "none";
    const imageContainer = ensureImageContainer();
    imageContainer.style.display = "flex";
    imageContainer.innerHTML =
      '<img src="file://' +
      filePath +
      '" alt="Image" style="max-width: 100%; max-height: 100%;">';
  }

  function showCodeEditor() {
    document.getElementById("editor").style.display = "block";
    const imageContainer = document.getElementById("image-container");
    if (imageContainer) {
      imageContainer.style.display = "none";
    }
  }

  function loadTextFileIntoEditor(filePath, fileExtension) {
    const escapedFilePath = escapeFilePathForEval(filePath);

    csInterface.evalScript(
      'readFile("' + escapedFilePath + '")',
      function (content) {
        if (content && content.startsWith("Error:")) {
          applyEditorContent("// Unable to read file: " + content, "javascript");
          return;
        }

        const language = resolveEditorLanguage(fileExtension);
        applyEditorContent(content, language);
      },
    );
  }

  function setCurrentFilenameLabel(fileName) {
    document.getElementById("current-filename").textContent = fileName || "";
  }

  function clearSelectedFiles() {
    if (
      window.fileTreeUI &&
      typeof window.fileTreeUI.clearSelectedFiles === "function"
    ) {
      window.fileTreeUI.clearSelectedFiles();
    }
  }

  function setDraftSessionState(fileName) {
    currentFilePath = null;
    currentSessionName = fileName || DRAFT_FILE_NAME;
    isDraftSession = true;
  }

  function setPersistedSessionState(filePath) {
    currentFilePath = filePath;
    currentSessionName = filePath.split("/").pop();
    isDraftSession = false;
  }

  function initializeDraftSession(options) {
    const sessionOptions = options || {};
    const fileName = sessionOptions.fileName || DRAFT_FILE_NAME;
    const content = sessionOptions.content || "";

    setDraftSessionState(fileName);
    clearSelectedFiles();
    showCodeEditor();
    applyEditorContent(content, "javascript");
    syncRunAvailability("js");
    setCurrentFilenameLabel(fileName);

    if (
      window.editorManager &&
      window.editorManager.editor &&
      typeof window.editorManager.editor.focus === "function"
    ) {
      window.editorManager.editor.focus();
    }
  }

  function openPathInEditor(filePath) {
    setPersistedSessionState(filePath);
    const fileExtension = getFileExtension(filePath);
    syncRunAvailability(fileExtension);

    if (isImageExtension(fileExtension)) {
      showImagePreview(filePath);
    } else {
      showCodeEditor();
      loadTextFileIntoEditor(filePath, fileExtension);
    }

    setCurrentFilenameLabel(currentSessionName);
  }

  function openFile(filePath) {
    clearConsole();
    openPathInEditor(filePath);
  }

  function saveFile() {
    if (isDraftSession || !currentFilePath) {
      saveDraftAsFile();
      return;
    }

    const fileExtension = getFileExtension(currentFilePath);
    if (isImageExtension(fileExtension)) {
      return;
    }

    Promise.resolve(
      window.editorManager &&
        typeof window.editorManager.formatDocument === "function"
        ? window.editorManager.formatDocument()
        : false,
    )
      .catch(() => false)
      .then(function () {
        const content = window.editorManager.editor.getValue();
        writeEncodedFile(currentFilePath, content, function (result) {
          if (result.startsWith("Error:")) {
            console.error("Error saving file:", result);
          }
        });
      });
  }

  function saveDraftAsFile() {
    window.fileTreeUI.showNewFileInput(function (fileName) {
      if (!fileName) {
        return;
      }

      if (!fileName.includes(".")) {
        fileName += ".js";
      }

      const newFilePath = getUserFolderPath() + "/" + fileName;

      Promise.resolve(
        window.editorManager &&
          typeof window.editorManager.formatDocument === "function"
          ? window.editorManager.formatDocument()
          : false,
      )
        .catch(() => false)
        .then(function () {
          const content =
            window.editorManager &&
            window.editorManager.editor &&
            typeof window.editorManager.editor.getValue === "function"
              ? window.editorManager.editor.getValue()
              : "";

          recentlyCreatedFile = newFilePath;

          writeEncodedFile(newFilePath, content, function (result) {
            if (result.startsWith("Error:")) {
              console.error("Error saving draft file:", result);
              recentlyCreatedFile = null;
              return;
            }

            loadFileList();

            setTimeout(function () {
              openFile(newFilePath);
            }, 700);
          });
        });
    });
  }

  function createNewFile() {
    window.fileTreeUI.showNewFileInput(function (fileName) {
      if (!fileName) {
        return;
      }

      clearConsole();

      if (!fileName.includes(".")) {
        fileName += ".js";
      }

      const newFilePath = getUserFolderPath() + "/" + fileName;

      recentlyCreatedFile = newFilePath;

      writeEncodedFile(newFilePath, "", function (result) {
        if (result.startsWith("Error:")) {
          console.error("Error creating file:", result);
          recentlyCreatedFile = null;
        } else {
          loadFileList();

          setTimeout(function () {
            openFile(newFilePath);
          }, 700);
        }
      });
    });
  }

  function getCurrentFileName() {
    if (currentSessionName) {
      return currentSessionName.replace(/\.[^/.]+$/, "");
    }
    return null;
  }

  return {
    initializeDraftSession: initializeDraftSession,
    loadFileList: loadFileList,
    loadFile: openFile,
    saveFile: saveFile,
    createNewFile: createNewFile,
    openFile: openFile,
    getCurrentFileName: getCurrentFileName,
  };
})();
