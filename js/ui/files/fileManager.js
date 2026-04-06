// File panel state, file I/O, and editor/preview switching.
window.fileManager = (function () {
  const DRAFT_FILE_NAME = "Untitled.js";
  const DEFAULT_JS_TEMPLATE = [
    "function setup() {",
    "  createCanvas(400, 400);",
    "}",
    "",
    "function draw() {",
    "  background(220);",
    "}",
    "",
  ].join("\n");
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
  let isFileListManuallyCollapsed = false;
  let isResponsiveFileListForcedOpen = false;
  let isResponsiveNarrowViewport = false;
  let responsiveLayoutInitialized = false;
  let responsiveResizeFrame = 0;
  const FILE_LIST_RETRY_LIMIT = 6;
  const FILE_LIST_RETRY_DELAY_MS = 250;
  const FILE_LIST_COLLAPSED_CLASS = "file-list-collapsed";
  const RESPONSIVE_FILE_LIST_BREAKPOINT = 500;

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

  function getMainContentElement() {
    return document.getElementById("main-content");
  }

  function getFileListToggleButton() {
    return document.getElementById("toggleFileList");
  }

  function requestEditorLayout() {
    window.requestAnimationFrame(function () {
      if (
        window.editorManager &&
        window.editorManager.editor &&
        typeof window.editorManager.editor.layout === "function"
      ) {
        window.editorManager.editor.layout();
      }
    });
  }

  function getViewportWidth() {
    return Math.max(
      window.innerWidth || 0,
      document.documentElement ? document.documentElement.clientWidth : 0,
    );
  }

  function isFileListEffectivelyCollapsed() {
    if (isFileListManuallyCollapsed) {
      return true;
    }
    if (isResponsiveNarrowViewport && !isResponsiveFileListForcedOpen) {
      return true;
    }
    return false;
  }

  function syncFileListCollapsedUI() {
    const isCollapsed = isFileListEffectivelyCollapsed();
    const mainContent = getMainContentElement();
    if (mainContent) {
      mainContent.classList.toggle(FILE_LIST_COLLAPSED_CLASS, isCollapsed);
    }

    const toggleButton = getFileListToggleButton();
    if (toggleButton) {
      const nextLabel = isCollapsed ? "Expand file list" : "Collapse file list";

      toggleButton.title = nextLabel;
      toggleButton.setAttribute("aria-label", nextLabel);
      toggleButton.setAttribute("aria-pressed", String(!isCollapsed));
    }

    requestEditorLayout();
  }

  function toggleFileListCollapsed() {
    if (isResponsiveNarrowViewport) {
      const isCollapsed = isFileListEffectivelyCollapsed();
      isFileListManuallyCollapsed = false;
      isResponsiveFileListForcedOpen = isCollapsed;
      syncFileListCollapsedUI();
      return;
    }

    isResponsiveFileListForcedOpen = false;
    isFileListManuallyCollapsed = !isFileListManuallyCollapsed;
    syncFileListCollapsedUI();
  }

  function expandFileList() {
    isFileListManuallyCollapsed = false;
    if (isResponsiveNarrowViewport) {
      isResponsiveFileListForcedOpen = true;
    }
    syncFileListCollapsedUI();
  }

  function syncResponsiveLayout() {
    const nextResponsiveNarrowViewport =
      getViewportWidth() <= RESPONSIVE_FILE_LIST_BREAKPOINT;

    if (isResponsiveNarrowViewport !== nextResponsiveNarrowViewport) {
      isResponsiveNarrowViewport = nextResponsiveNarrowViewport;
      if (!isResponsiveNarrowViewport) {
        isResponsiveFileListForcedOpen = false;
      }
      syncFileListCollapsedUI();
      return;
    }

    requestEditorLayout();
  }

  function scheduleResponsiveLayoutSync() {
    if (responsiveResizeFrame) {
      window.cancelAnimationFrame(responsiveResizeFrame);
    }

    responsiveResizeFrame = window.requestAnimationFrame(function () {
      responsiveResizeFrame = 0;
      syncResponsiveLayout();
    });
  }

  function initResponsiveLayout() {
    if (responsiveLayoutInitialized) {
      return;
    }

    responsiveLayoutInitialized = true;
    syncResponsiveLayout();
    window.addEventListener("resize", scheduleResponsiveLayoutSync);
  }

  function isEmptyEvalScriptResult(result) {
    return result === undefined || result === null || result === "";
  }

  function isEvalScriptFailure(result) {
    return (
      typeof result === "string" &&
      (/^EvalScript error\./i.test(result) || /^Error:/i.test(result))
    );
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

  function stopDebugTraceSession() {
    if (
      window.debugTraceManager &&
      typeof window.debugTraceManager.stop === "function"
    ) {
      window.debugTraceManager.stop();
    }
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

    function renderFileListResult(result) {
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
      } catch (_error) {
        setFileListMessage("<div>Error loading file list</div>");
      }
    }

    function requestFileList(attempt) {
      csInterface.evalScript(
        'getFileList("' + escapedPath + '")',
        function (result) {
          if (isEmptyEvalScriptResult(result)) {
            if (attempt < FILE_LIST_RETRY_LIMIT) {
              window.setTimeout(function () {
                requestFileList(attempt + 1);
              }, FILE_LIST_RETRY_DELAY_MS);
              return;
            }

            csInterface.evalScript("typeof getFileList === 'function'", function (availability) {
              const detail =
                availability === "true"
                  ? "empty result after retries"
                  : "ExtendScript bridge not ready";
              setFileListMessage("<div>Failed to get file list: " + detail + "</div>");
            });
            return;
          }

          if (isEvalScriptFailure(result)) {
            setFileListMessage("<div>Failed to get file list: " + result + "</div>");
            return;
          }

          renderFileListResult(result);
        },
      );
    }

    requestFileList(0);
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

  function getDefaultFileContent(fileName) {
    const fileExtension = getFileExtension(fileName || "");
    if (fileExtension === "js") {
      return DEFAULT_JS_TEMPLATE;
    }
    return "";
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
    const content =
      sessionOptions.content !== undefined
        ? sessionOptions.content
        : getDefaultFileContent(fileName);

    setDraftSessionState(fileName);
    stopDebugTraceSession();
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
    stopDebugTraceSession();
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
    expandFileList();
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
    expandFileList();
    window.fileTreeUI.showNewFileInput(function (fileName) {
      if (!fileName) {
        return;
      }

      stopDebugTraceSession();
      clearConsole();

      if (!fileName.includes(".")) {
        fileName += ".js";
      }

      const newFilePath = getUserFolderPath() + "/" + fileName;
      const content = getDefaultFileContent(fileName);

      recentlyCreatedFile = newFilePath;

      writeEncodedFile(newFilePath, content, function (result) {
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
    expandFileList: expandFileList,
    initResponsiveLayout: initResponsiveLayout,
    toggleFileListCollapsed: toggleFileListCollapsed,
  };
})();
