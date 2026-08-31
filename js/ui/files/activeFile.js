// Active document, draft, autosave, editor, and preview state.
window.activeFile = (function () {
  const Entry = window.fileEntry;
  const FileOrder = window.fileOrder;
  const FileSystem = window.fileSystem;
  const FileTypes = window.fileTypes;
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
  const AUTO_SAVE_DELAY_MS = 350;
  const LAST_OPENED_STORAGE_KEY = "momentum.lastOpenedFile.v1";

  let currentPath = null;
  let currentName = "";
  let currentDraftFolderPath = null;
  let draftCreationPending = false;
  let isDraft = false;
  let pendingEditorState = null;
  let autoSaveTimer = 0;
  let autoSaveListenerInstalled = false;
  let isApplyingEditorContent = false;
  let isLoadingEditorContent = false;
  let autoSaveFailed = false;
  let currentSessionId = 0;
  let currentRevision = 0;
  let lastPersistedRevision = 0;
  let draftMaterializationPromise = null;
  let openRequestGeneration = 0;
  let refreshHandler = null;
  let editorTrackingSuspended = false;
  let initialized = false;

  function getUserFolderPath() {
    return csInterface.getSystemPath(SystemPath.EXTENSION) + "/user";
  }

  function setRefreshHandler(handler) {
    refreshHandler = typeof handler === "function" ? handler : null;
  }

  function refreshFileList(highlightPath, options) {
    return refreshHandler
      ? Promise.resolve(refreshHandler(highlightPath, options))
      : Promise.resolve(true);
  }

  function getLastOpenedPath() {
    try {
      return window.localStorage
        ? Entry.normalizePath(
            window.localStorage.getItem(LAST_OPENED_STORAGE_KEY),
          )
        : "";
    } catch (_error) {
      return "";
    }
  }

  function rememberLastOpened(filePath) {
    const normalizedPath = Entry.normalizePath(filePath);
    if (!normalizedPath) {
      return;
    }
    try {
      if (window.localStorage) {
        window.localStorage.setItem(LAST_OPENED_STORAGE_KEY, normalizedPath);
      }
    } catch (_error) {}
  }

  function forgetLastOpened() {
    try {
      if (window.localStorage) {
        window.localStorage.removeItem(LAST_OPENED_STORAGE_KEY);
      }
    } catch (_error) {}
  }

  function resetSaveState() {
    if (autoSaveTimer) {
      window.clearTimeout(autoSaveTimer);
      autoSaveTimer = 0;
    }
    currentSessionId += 1;
    currentRevision = 0;
    lastPersistedRevision = 0;
    draftMaterializationPromise = null;
    autoSaveFailed = false;
  }

  function syncFilenameLabel() {
    if (editorTrackingSuspended) {
      return;
    }
    const label = document.getElementById("current-filename");
    if (!label) {
      return;
    }
    const hasPendingChanges = currentRevision > lastPersistedRevision ||
      autoSaveFailed;
    label.textContent = currentName || "";
    label.classList.toggle("save-error", autoSaveFailed);
    if (autoSaveFailed) {
      label.title = "Momentum could not sync this file with disk.";
      label.setAttribute(
        "aria-label",
        `${currentName || "Current file"}: automatic save failed`,
      );
    } else if (hasPendingChanges) {
      label.title = "Saving changes automatically…";
      label.setAttribute("aria-label", currentName || "Current file");
    } else {
      label.title = currentPath || currentName || "";
      label.setAttribute("aria-label", currentName || "Current file");
    }
  }

  function handleSaveSuccess(revision) {
    lastPersistedRevision = Math.max(lastPersistedRevision, revision);
    autoSaveFailed = false;
    syncFilenameLabel();
    return true;
  }

  function handleSaveFailure(error) {
    autoSaveFailed = true;
    syncFilenameLabel();
    console.error("Automatic save failed:", error);
    return false;
  }

  function writeCurrentFile(content, revision) {
    if (!currentPath) {
      return false;
    }
    try {
      FileSystem.writeTextFileNow(currentPath, content);
      return handleSaveSuccess(revision);
    } catch (error) {
      return handleSaveFailure(error);
    }
  }

  function setPersistedState(filePath, displayName) {
    currentPath = filePath;
    currentName = displayName || filePath.split("/").pop();
    isDraft = false;
    currentDraftFolderPath = null;
    rememberLastOpened(filePath);
  }

  function materializeDraft(content, revision, sessionId) {
    const task = {
      content: content,
      folderPath: currentDraftFolderPath || getUserFolderPath(),
      revision: revision,
      sessionId: sessionId,
    };
    const materialization = FileSystem.createFile(
      task.folderPath,
      currentName || DRAFT_FILE_NAME,
      task.content,
    ).then(
      function (entry) {
        if (task.sessionId !== currentSessionId) {
          return false;
        }
        setPersistedState(entry.path, entry.name);
        lastPersistedRevision = Math.max(
          lastPersistedRevision,
          task.revision,
        );
        autoSaveFailed = false;
        FileOrder.promote(entry.path, task.folderPath);
        syncFilenameLabel();
        return refreshFileList(entry.path).then(function () {
          return true;
        });
      },
      function (error) {
        autoSaveFailed = task.sessionId === currentSessionId;
        syncFilenameLabel();
        console.error("Automatic draft creation failed:", error);
        return false;
      },
    );
    const trackedMaterialization = materialization.then(
      function (succeeded) {
        if (draftMaterializationPromise === trackedMaterialization) {
          draftMaterializationPromise = null;
        }
        return succeeded;
      },
      function (error) {
        if (draftMaterializationPromise === trackedMaterialization) {
          draftMaterializationPromise = null;
        }
        throw error;
      },
    );
    draftMaterializationPromise = trackedMaterialization;
    return draftMaterializationPromise;
  }

  function persist() {
    if (autoSaveTimer) {
      window.clearTimeout(autoSaveTimer);
      autoSaveTimer = 0;
    }
    if (draftMaterializationPromise) {
      return draftMaterializationPromise.then(function (succeeded) {
        return succeeded ? persist() : false;
      });
    }
    if (
      editorTrackingSuspended ||
      isLoadingEditorContent ||
      !window.editorManager.editor ||
      currentRevision <= lastPersistedRevision
    ) {
      return Promise.resolve(true);
    }
    if (draftCreationPending && isDraft) {
      return Promise.resolve(true);
    }

    const content = window.editorManager.editor.getValue();
    if (isDraft || !currentPath) {
      return materializeDraft(content, currentRevision, currentSessionId);
    }
    return Promise.resolve(writeCurrentFile(content, currentRevision));
  }

  function persistImmediately() {
    if (autoSaveTimer) {
      window.clearTimeout(autoSaveTimer);
      autoSaveTimer = 0;
    }
    if (
      editorTrackingSuspended ||
      isLoadingEditorContent ||
      !window.editorManager.editor ||
      currentRevision <= lastPersistedRevision
    ) {
      return true;
    }
    if (draftCreationPending || isDraft || !currentPath) {
      return false;
    }

    return writeCurrentFile(
      window.editorManager.editor.getValue(),
      currentRevision,
    );
  }

  function scheduleAutoSave() {
    if (autoSaveTimer) {
      window.clearTimeout(autoSaveTimer);
    }
    autoSaveTimer = window.setTimeout(function () {
      autoSaveTimer = 0;
      persist();
    }, AUTO_SAVE_DELAY_MS);
  }

  function installAutoSaveListener() {
    if (
      autoSaveListenerInstalled ||
      !window.editorManager.editor
    ) {
      return;
    }
    autoSaveListenerInstalled = true;
    window.editorManager.editor.onDidChangeModelContent(function () {
      if (
        editorTrackingSuspended ||
        isApplyingEditorContent ||
        isLoadingEditorContent
      ) {
        return;
      }
      if (FileTypes.isImage(Entry.getExtension(currentName))) {
        return;
      }
      currentRevision += 1;
      autoSaveFailed = false;
      syncFilenameLabel();
      scheduleAutoSave();
    });
  }

  function resetRuntimeConsole() {
    window.debugTraceManager.stopAndClear();
  }

  function flushPendingEditorState() {
    if (
      editorTrackingSuspended ||
      !pendingEditorState ||
      !window.editorManager.editor
    ) {
      return false;
    }
    const model = window.editorManager.editor.getModel();
    if (!model) {
      return false;
    }

    const nextContent = pendingEditorState.content || "";
    const nextLanguage = pendingEditorState.language || "plaintext";
    const currentContent = typeof model.getValue === "function"
      ? model.getValue()
      : "";
    const currentLanguage = typeof model.getLanguageId === "function"
      ? model.getLanguageId()
      : "plaintext";
    if (currentContent !== nextContent) {
      isApplyingEditorContent = true;
      try {
        model.setValue(nextContent);
      } finally {
        isApplyingEditorContent = false;
      }
    }
    if (currentLanguage !== nextLanguage) {
      monaco.editor.setModelLanguage(model, nextLanguage);
    }
    pendingEditorState = null;
    return true;
  }

  function handleEditorReady() {
    installAutoSaveListener();
    flushPendingEditorState();
  }

  function getDefaultContent(fileName) {
    return Entry.getExtension(fileName || "") === "js"
      ? DEFAULT_JS_TEMPLATE
      : "";
  }

  function applyEditorContent(content, language) {
    pendingEditorState = {
      content: content || "",
      language: language || "plaintext",
    };
    flushPendingEditorState();
  }

  function syncRunAvailability(value) {
    window.editorManager.setRunEnabled(FileTypes.isRunnable(value));
  }

  function showImagePreview(filePath) {
    window.workspaceManager.showImage(filePath);
  }

  function showCodeEditor() {
    window.workspaceManager.showEditor();
  }

  function setEditorReadOnly(readOnly) {
    if (editorTrackingSuspended) {
      return;
    }
    if (window.editorManager.editor) {
      window.editorManager.editor.updateOptions({ readOnly: readOnly });
    }
  }

  function loadTextFile(filePath, extension, requestGeneration) {
    return FileSystem.readTextFile(filePath).then(
      function (content) {
        if (
          requestGeneration !== openRequestGeneration ||
          currentPath !== filePath
        ) {
          return false;
        }
        applyEditorContent(content, FileTypes.getLanguage(extension));
        isLoadingEditorContent = false;
        setEditorReadOnly(false);
        return true;
      },
      function (error) {
        if (
          requestGeneration !== openRequestGeneration ||
          currentPath !== filePath
        ) {
          return false;
        }
        applyEditorContent("// Unable to read file.", "javascript");
        isLoadingEditorContent = false;
        autoSaveFailed = true;
        setEditorReadOnly(true);
        syncFilenameLabel();
        console.error("Unable to read file:", error);
        return false;
      },
    );
  }

  function clearSelection() {
    window.fileTreeUI.clearSelectedFiles();
  }

  function reset() {
    openRequestGeneration += 1;
    resetSaveState();
    currentPath = null;
    currentName = "";
    isDraft = false;
    currentDraftFolderPath = null;
    draftCreationPending = false;
    isLoadingEditorContent = false;
    setEditorReadOnly(false);
    resetRuntimeConsole();
    clearSelection();
    showCodeEditor();
    applyEditorContent("", "plaintext");
    syncRunAvailability("");
    syncFilenameLabel();
  }

  function beginDraft(options) {
    const draftOptions = options || {};
    const fileName = draftOptions.fileName || DRAFT_FILE_NAME;
    const content = draftOptions.content !== undefined
      ? draftOptions.content
      : getDefaultContent(fileName);

    openRequestGeneration += 1;
    resetSaveState();
    currentPath = null;
    currentName = fileName;
    isDraft = true;
    currentDraftFolderPath = Entry.normalizePath(draftOptions.folderPath) ||
      getUserFolderPath();
    draftCreationPending = true;
    isLoadingEditorContent = false;
    setEditorReadOnly(false);
    resetRuntimeConsole();
    clearSelection();
    showCodeEditor();
    applyEditorContent(content, "javascript");
    syncRunAvailability("js");
    syncFilenameLabel();
    if (window.editorManager.editor) {
      window.editorManager.editor.focus();
    }
  }

  function prepareCreation(fileName) {
    const editor = window.editorManager.editor;
    return {
      content: editor ? editor.getValue() : getDefaultContent(fileName),
      fileName: fileName,
      revision: currentRevision,
      sessionId: currentSessionId,
    };
  }

  function acceptCreation(entry, task) {
    draftCreationPending = false;
    if (!task || task.sessionId !== currentSessionId) {
      return false;
    }
    setPersistedState(entry.path, entry.name || task.fileName);
    lastPersistedRevision = Math.max(lastPersistedRevision, task.revision);
    autoSaveFailed = false;
    syncRunAvailability(currentName);
    syncFilenameLabel();
    if (currentRevision > lastPersistedRevision) {
      scheduleAutoSave();
    }
    return true;
  }

  function cancelDraft() {
    draftCreationPending = false;
    if (currentRevision > lastPersistedRevision) {
      return persist();
    }
    reset();
    return refreshFileList(null);
  }

  function openPath(filePath, requestGeneration, displayName) {
    resetSaveState();
    setPersistedState(filePath, displayName);
    const extension = Entry.getExtension(filePath);
    syncRunAvailability(extension);
    if (FileTypes.isImage(extension)) {
      isLoadingEditorContent = false;
      setEditorReadOnly(false);
      showImagePreview(filePath);
      syncFilenameLabel();
      return Promise.resolve(true);
    } else {
      isLoadingEditorContent = true;
      setEditorReadOnly(true);
      showCodeEditor();
      syncFilenameLabel();
      return loadTextFile(filePath, extension, requestGeneration);
    }
  }

  function open(filePath, displayName) {
    const requestGeneration = ++openRequestGeneration;
    return persist().then(function (succeeded) {
      if (!succeeded || requestGeneration !== openRequestGeneration) {
        if (!succeeded && currentPath) {
          window.fileTreeUI.selectFile(currentPath);
        }
        return false;
      }
      resetRuntimeConsole();
      return openPath(filePath, requestGeneration, displayName);
    });
  }

  function handleRelocation(previousEntry, nextEntry) {
    const pathAffected = Entry.isFolder(previousEntry)
      ? Entry.isPathInside(currentPath, previousEntry.path)
      : currentPath === previousEntry.path;
    if (!pathAffected) {
      return false;
    }
    currentPath = Entry.isFolder(previousEntry)
      ? Entry.replacePathPrefix(currentPath, previousEntry.path, nextEntry.path)
      : nextEntry.path;
    if (!Entry.isFolder(previousEntry)) {
      currentName = nextEntry.name || currentName;
      syncRunAvailability(currentName);
    }
    rememberLastOpened(currentPath);
    syncFilenameLabel();
    if (FileTypes.isImage(currentPath)) {
      showImagePreview(currentPath);
    }
    return true;
  }

  function handleDeletion(entry) {
    const pathAffected = Entry.isFolder(entry)
      ? Entry.isPathInside(currentPath, entry.path)
      : currentPath === entry.path;
    if (pathAffected) {
      forgetLastOpened();
      reset();
    }
    return pathAffected;
  }

  function getCurrentFileName() {
    return currentName ? currentName.replace(/\.[^/.]+$/, "") : null;
  }

  function suspendEditorTracking() {
    if (editorTrackingSuspended) {
      return Promise.resolve(true);
    }
    return persist().then(function (succeeded) {
      if (!succeeded) {
        return false;
      }
      editorTrackingSuspended = true;
      return true;
    });
  }

  function resumeEditorTracking() {
    editorTrackingSuspended = false;
    flushPendingEditorState();
    if (!isLoadingEditorContent) {
      setEditorReadOnly(autoSaveFailed);
    }
    syncFilenameLabel();
  }

  function init() {
    if (initialized) {
      return;
    }
    initialized = true;
    window.addEventListener("momentum:editor-ready", handleEditorReady);
    window.addEventListener("blur", persist);
    window.addEventListener("beforeunload", persistImmediately);
    window.addEventListener("pagehide", persistImmediately);
  }

  return {
    acceptCreation: acceptCreation,
    beginDraft: beginDraft,
    cancelDraft: cancelDraft,
    forgetLastOpened: forgetLastOpened,
    getCurrentFileName: getCurrentFileName,
    getCurrentPath: function () { return currentPath; },
    getDefaultContent: getDefaultContent,
    getLastOpenedPath: getLastOpenedPath,
    getSelectionPath: function () { return isDraft ? "" : currentPath; },
    handleDeletion: handleDeletion,
    handleRelocation: handleRelocation,
    init: init,
    isDraft: function () { return isDraft; },
    open: open,
    prepareCreation: prepareCreation,
    persist: persist,
    reset: reset,
    resumeEditorTracking: resumeEditorTracking,
    setRefreshHandler: setRefreshHandler,
    suspendEditorTracking: suspendEditorTracking,
  };
})();
