// File panel coordination, mutations, refresh, and responsive layout.
window.fileManager = (function () {
  const Entry = window.fileEntry;
  const ActiveFile = window.activeFile;
  const FileSystem = window.fileSystem;
  const FileOrder = window.fileOrder;
  const FileTypes = window.fileTypes;
  let pendingEntryHighlightPath = null;
  let isFileListManuallyCollapsed = false;
  let isResponsiveFileListForcedOpen = false;
  let isResponsiveNarrowViewport = false;
  let responsiveResizeFrame = 0;
  let fileMutationChain = Promise.resolve(true);
  let pendingNewItemType = null;
  let fileListRequestGeneration = 0;
  let activeSessionResolutionPromise = null;
  let fileListRecoveryPending = false;
  let startupSessionInitialized = false;
  let initialized = false;
  const FILE_LIST_RETRY_LIMIT = 6;
  const FILE_LIST_RETRY_DELAY_MS = 250;
  const FILE_LIST_COLLAPSED_CLASS = "file-list-collapsed";
  const RESPONSIVE_FILE_LIST_BREAKPOINT = 500;

  function getUserFolderPath() {
    return csInterface.getSystemPath(SystemPath.EXTENSION) + "/user";
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

      toggleButton.setAttribute("aria-label", nextLabel);
      toggleButton.setAttribute("aria-pressed", String(!isCollapsed));
    }
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

    if (isResponsiveNarrowViewport === nextResponsiveNarrowViewport) {
      return;
    }

    isResponsiveNarrowViewport = nextResponsiveNarrowViewport;
    if (!isResponsiveNarrowViewport) {
      isResponsiveFileListForcedOpen = false;
    }
    syncFileListCollapsedUI();
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
    syncResponsiveLayout();
    window.addEventListener("resize", scheduleResponsiveLayoutSync);
  }

  function getMutationHighlightPath(options, result) {
    if (typeof options.getHighlightPath === "function") {
      return options.getHighlightPath(result);
    }
    if (Object.prototype.hasOwnProperty.call(options, "highlightPath")) {
      return options.highlightPath;
    }
    return undefined;
  }

  function refreshAfterFileMutation(options, result) {
    const highlightPath = getMutationHighlightPath(options, result);
    if (highlightPath !== undefined) {
      pendingEntryHighlightPath = Entry.normalizePath(highlightPath) || null;
    }

    return loadFileList(options.loadOptions).then(function (refreshed) {
      if (!refreshed) {
        console.error(
          (options.errorMessage || "File operation failed") +
            ": the file tree could not be refreshed.",
        );
      }
      if (typeof options.afterRefresh !== "function") {
        return true;
      }
      return Promise.resolve(options.afterRefresh(result, refreshed)).then(
        function () {
          return true;
        },
      );
    });
  }

  function executeFileMutation(mutationOptions) {
    const persistPromise = mutationOptions.persistEditor === false
      ? Promise.resolve(true)
      : ActiveFile.persist();

    return persistPromise.then(function (persisted) {
      if (!persisted) {
        return false;
      }

      return Promise.resolve().then(function () {
        return mutationOptions.mutate();
      }).then(function (result) {
        if (
          typeof mutationOptions.isSuccessful === "function" &&
          !mutationOptions.isSuccessful(result)
        ) {
          return false;
        }

        const successResult = typeof mutationOptions.onSuccess === "function"
          ? mutationOptions.onSuccess(result)
          : null;
        return Promise.resolve(successResult).then(function () {
          return refreshAfterFileMutation(mutationOptions, result);
        });
      });
    }).catch(function (error) {
      console.error(
        mutationOptions.errorMessage || "File operation failed:",
        error,
      );
      if (error && error.data && error.data.changed === true) {
        return loadFileList().then(function () {
          return false;
        });
      }
      return false;
    });
  }

  function runFileMutation(options) {
    const mutationOptions = options || {};
    const queuedMutation = fileMutationChain.then(
      function () {
        return executeFileMutation(mutationOptions);
      },
      function () {
        return executeFileMutation(mutationOptions);
      },
    );
    fileMutationChain = queuedMutation.then(
      function () {
        return true;
      },
      function () {
        return true;
      },
    );
    return queuedMutation;
  }

  function findEntryByPath(items, entryPath) {
    const normalizedPath = Entry.normalizePath(entryPath);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (Entry.normalizePath(item.path) === normalizedPath) {
        return item;
      }
      if (Entry.isFolder(item)) {
        const nestedMatch = findEntryByPath(item.children || [], normalizedPath);
        if (nestedMatch) {
          return nestedMatch;
        }
      }
    }
    return null;
  }

  function findFirstOpenableEntry(items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!Entry.isFolder(item) && canAutoOpenImportedPath(item.path)) {
        return item;
      }
      if (Entry.isFolder(item)) {
        const nestedEntry = findFirstOpenableEntry(item.children || []);
        if (nestedEntry) {
          return nestedEntry;
        }
      }
    }
    return null;
  }

  function openStartupEntry(entry) {
    return ActiveFile.open(entry.path, entry.name).then(function (succeeded) {
      if (succeeded) {
        highlightFile(entry.path);
      }
      return succeeded;
    });
  }

  function createDefaultStartupFile(folderPath) {
    const fileName = "sketch.js";
    return FileSystem.createFile(
      folderPath,
      fileName,
      ActiveFile.getDefaultContent(fileName),
    ).then(
      function (entry) {
        FileOrder.promote(entry.path, folderPath);
        pendingEntryHighlightPath = entry.path;
        return ActiveFile.open(entry.path, entry.name).then(function (succeeded) {
          if (!succeeded) {
            return false;
          }
          return loadFileList({ skipActiveSessionResolution: true });
        });
      },
      function (error) {
        console.error("Could not create the default sketch file:", error);
        return false;
      },
    );
  }

  function ensureActiveFileSession(entries, folderPath, createDefaultIfEmpty) {
    if (ActiveFile.isDraft()) {
      return Promise.resolve(true);
    }

    const currentFilePath = ActiveFile.getCurrentPath();
    if (currentFilePath) {
      const currentEntry = findEntryByPath(entries, currentFilePath);
      if (currentEntry && !Entry.isFolder(currentEntry)) {
        return Promise.resolve(true);
      }
      ActiveFile.forgetLastOpened();
      ActiveFile.reset();
    }

    if (activeSessionResolutionPromise) {
      return activeSessionResolutionPromise;
    }

    const lastOpenedPath = ActiveFile.getLastOpenedPath();
    const lastOpenedEntry = lastOpenedPath
      ? findEntryByPath(entries, lastOpenedPath)
      : null;
    if (lastOpenedPath && (!lastOpenedEntry || Entry.isFolder(lastOpenedEntry))) {
      ActiveFile.forgetLastOpened();
    }

    const startupEntry = lastOpenedEntry && !Entry.isFolder(lastOpenedEntry)
      ? lastOpenedEntry
      : findFirstOpenableEntry(entries);
    if (!startupEntry && !createDefaultIfEmpty) {
      return Promise.resolve(true);
    }

    const resolution = startupEntry
      ? openStartupEntry(startupEntry)
      : createDefaultStartupFile(folderPath);

    activeSessionResolutionPromise = Promise.resolve(resolution).then(
      function (succeeded) {
        activeSessionResolutionPromise = null;
        return succeeded;
      },
      function (error) {
        activeSessionResolutionPromise = null;
        throw error;
      },
    );
    return activeSessionResolutionPromise;
  }

  function loadFileList(options) {
    const loadOptions = options || {};
    const folderPath = getUserFolderPath();
    const requestGeneration = ++fileListRequestGeneration;
    return FileSystem.listEntries(folderPath, {
      retries: FILE_LIST_RETRY_LIMIT,
      retryDelayMs: FILE_LIST_RETRY_DELAY_MS,
    }).then(
      function (response) {
        if (requestGeneration !== fileListRequestGeneration) {
          return true;
        }
        window.fileTree = response.entries;
        filterDSStoreFiles(window.fileTree);
        FileOrder.applyTree(window.fileTree, response.folderPath || folderPath);

        const fileListElement = document.getElementById("file-list");
        fileListElement.setAttribute(
          "data-root-path",
          response.folderPath || folderPath,
        );
        window.fileTreeUI.renderFileTree(window.fileTree, fileListElement);

        if (window.fileTree.length === 0) {
          const emptyHint = document.createElement("div");
          emptyHint.className = "no-files-hint";
          emptyHint.innerHTML =
            "No files found<br><small>Drop files or folders here, or create a new item above</small>";
          fileListElement.appendChild(emptyHint);
        }

        if (pendingEntryHighlightPath) {
          highlightFile(pendingEntryHighlightPath);
          pendingEntryHighlightPath = null;
        } else if (ActiveFile.getSelectionPath()) {
          window.fileTreeUI.selectFile(ActiveFile.getSelectionPath());
        }
        if (loadOptions.skipActiveSessionResolution) {
          return true;
        }
        const isInitializingStartupSession = !startupSessionInitialized;
        return ensureActiveFileSession(
          window.fileTree,
          response.folderPath || folderPath,
          isInitializingStartupSession,
        ).then(function (succeeded) {
          if (isInitializingStartupSession && succeeded) {
            startupSessionInitialized = true;
          }
          return succeeded;
        });
      },
      function (error) {
        if (requestGeneration !== fileListRequestGeneration) {
          return false;
        }
        const bridge = window.momentumPluginBridge;
        if (
          error &&
          error.retryable === true &&
          bridge &&
          typeof bridge.reportHostUnavailable === "function" &&
          typeof bridge.whenReady === "function"
        ) {
          if (!fileListRecoveryPending) {
            fileListRecoveryPending = true;
            bridge.reportHostUnavailable(error.message);
            bridge.whenReady().then(function () {
              fileListRecoveryPending = false;
              return loadFileList(loadOptions);
            });
          }
          return false;
        }
        console.error("Failed to get file list:", error);
        setFileListMessage("<div>Failed to get file list</div>");
        return false;
      },
    );
  }

  function filterDSStoreFiles(items) {
    for (let i = items.length - 1; i >= 0; i--) {
      if (!Entry.isFolder(items[i]) && items[i].name === ".DS_Store") {
        items.splice(i, 1);
      } else if (
        Entry.isFolder(items[i]) &&
        items[i].children &&
        items[i].children.length > 0
      ) {
        filterDSStoreFiles(items[i].children);
      }
    }
  }

  function highlightFile(filePath) {
    window.fileTreeUI.selectFile(filePath, { scrollIntoView: true });
  }

  function getNewEntryTargetFolderPath() {
    return window.fileTreeUI.getSelectedTargetFolderPath() ||
      getUserFolderPath();
  }

  function createNewFile() {
    if (pendingNewItemType) {
      return;
    }

    const targetFolderPath = getNewEntryTargetFolderPath();
    pendingNewItemType = "preparing-file";
    expandFileList();
    ActiveFile.persist().then(function (succeeded) {
      if (!succeeded) {
        pendingNewItemType = null;
        return;
      }

      ActiveFile.beginDraft({
        fileName: "sketch.js",
        folderPath: targetFolderPath,
      });
      pendingNewItemType = "file";

      window.fileTreeUI.showNewItemInput(function (fileName) {
        if (!fileName) {
          pendingNewItemType = null;
          return ActiveFile.cancelDraft();
        }

        if (!fileName.includes(".")) {
          fileName += ".js";
        }

        const creationTask = ActiveFile.prepareCreation(fileName);

        return runFileMutation({
          errorMessage: "Error creating file:",
          persistEditor: false,
          mutate: function () {
            return FileSystem.createFile(
              targetFolderPath,
              fileName,
              creationTask.content,
            );
          },
          onSuccess: function (entry) {
            pendingNewItemType = null;
            FileOrder.promote(entry.path, targetFolderPath);
            ActiveFile.acceptCreation(entry, creationTask);
          },
          getHighlightPath: function (entry) {
            return entry.path;
          },
        });
      }, {
        parentFolderPath: targetFolderPath,
      });
    }, function () {
      pendingNewItemType = null;
    });
  }

  function createNewFolder() {
    if (pendingNewItemType) {
      return;
    }

    const targetFolderPath = getNewEntryTargetFolderPath();
    pendingNewItemType = "preparing-folder";
    expandFileList();
    ActiveFile.persist().then(function (succeeded) {
      if (!succeeded) {
        pendingNewItemType = null;
        return;
      }

      pendingNewItemType = "folder";
      window.fileTreeUI.showNewItemInput(function (folderName) {
        if (!folderName) {
          pendingNewItemType = null;
          return Promise.resolve(true);
        }

        return runFileMutation({
          errorMessage: "Error creating folder:",
          persistEditor: false,
          mutate: function () {
            return FileSystem.createFolder(targetFolderPath, folderName);
          },
          onSuccess: function (entry) {
            pendingNewItemType = null;
            FileOrder.promote(entry.path, targetFolderPath);
          },
          getHighlightPath: function (entry) {
            return entry.path;
          },
        });
      }, {
        kind: "folder",
        initialValue: "New Folder",
        parentFolderPath: targetFolderPath,
      });
    }, function () {
      pendingNewItemType = null;
    });
  }

  function renameEntry(rawEntry, nextName) {
    const entry = Entry.create(rawEntry);
    const requestedName = String(nextName || "").trim();
    if (!entry.path || !requestedName) {
      return Promise.resolve(false);
    }

    return runFileMutation({
      errorMessage: "Error renaming entry:",
      mutate: function () {
        return FileSystem.renameEntry(entry, requestedName);
      },
      onSuccess: function (renamedEntry) {
        ActiveFile.handleRelocation(entry, renamedEntry);
        FileOrder.replacePath(entry.path, renamedEntry.path);
        window.fileTreeUI.remapExpandedEntry(entry.path, renamedEntry.path);
      },
      getHighlightPath: function (renamedEntry) {
        return renamedEntry.path;
      },
    });
  }

  function deleteEntry(rawEntry) {
    const entry = Entry.create(rawEntry);
    if (!entry.path) {
      return Promise.resolve(false);
    }

    return runFileMutation({
      errorMessage: "Error deleting entry:",
      mutate: function () {
        return FileSystem.deleteEntry(entry);
      },
      isSuccessful: function (response) {
        return Boolean(response && response.deleted === true);
      },
      onSuccess: function () {
        ActiveFile.handleDeletion(entry);
        FileOrder.remove(entry);
        window.fileTreeUI.removeExpandedEntry(entry.path);
      },
      highlightPath: null,
    });
  }

  function moveEntry(
    rawEntry,
    targetFolderPath,
    referencePath,
    position,
  ) {
    const entry = Entry.create(rawEntry);
    const normalizedTargetFolderPath = Entry.normalizePath(targetFolderPath);
    if (!entry.path || !normalizedTargetFolderPath) {
      return Promise.resolve(false);
    }
    if (
      Entry.isFolder(entry) &&
      Entry.isPathInside(normalizedTargetFolderPath, entry.path)
    ) {
      return Promise.resolve(false);
    }

    const sourceFolderPath = Entry.getParentPath(entry.path);
    const isOrderOnlyMutation = sourceFolderPath === normalizedTargetFolderPath;
    return runFileMutation({
      errorMessage: "Error moving entry:",
      mutate: function () {
        return isOrderOnlyMutation
          ? Promise.resolve(entry)
          : FileSystem.moveEntry(entry, normalizedTargetFolderPath);
      },
      onSuccess: function (movedEntry) {
        if (isOrderOnlyMutation) {
          FileOrder.place(
            entry.path,
            normalizedTargetFolderPath,
            referencePath,
            position,
          );
          return;
        }

        ActiveFile.handleRelocation(entry, movedEntry);
        const movedPath = Entry.normalizePath(movedEntry.path);
        window.fileTreeUI.remapExpandedEntry(entry.path, movedPath);
        FileOrder.move(
          entry.path,
          movedPath,
          sourceFolderPath,
          normalizedTargetFolderPath,
          referencePath,
          position,
        );
      },
      getHighlightPath: function (movedEntry) {
        return movedEntry.path;
      },
    });
  }

  function placeImportedEntries(
    importedEntries,
    targetFolderPath,
    referencePath,
    position,
  ) {
    const entriesToPlace = importedEntries.slice();
    if (position === "top" || position === "after") {
      entriesToPlace.reverse();
    }
    entriesToPlace.forEach(function (entry) {
      if (entry && entry.path) {
        FileOrder.place(
          entry.path,
          targetFolderPath,
          referencePath,
          position,
        );
      }
    });
  }

  function canAutoOpenImportedPath(filePath) {
    return FileTypes.canAutoOpen(filePath);
  }

  function importExternalDrop(
    dataTransfer,
    targetFolderPath,
    referencePath,
    position,
  ) {
    const capturedDrop = window.fileDrop.captureDrop(dataTransfer);
    const resolvedTargetFolderPath = Entry.normalizePath(targetFolderPath) ||
      getUserFolderPath();
    const resolvedPosition = position || "top";
    if (
      !capturedDrop ||
      (capturedDrop.files.length === 0 && capturedDrop.entries.length === 0)
    ) {
      return Promise.resolve(false);
    }

    expandFileList();
    return runFileMutation({
      errorMessage: "Could not import dropped entries:",
      mutate: function () {
        return window.fileDrop.importCapturedDrop(
          capturedDrop,
          resolvedTargetFolderPath,
        );
      },
      isSuccessful: function (response) {
        const importedEntries = response && Array.isArray(response.entries)
          ? response.entries
          : [];
        if (response && response.errors && response.errors.length > 0) {
          console.error(
            "Some dropped entries could not be imported:",
            response.errors.join("\n"),
          );
        }
        return Boolean(
          response && response.ok === true && importedEntries.length > 0,
        );
      },
      onSuccess: function (response) {
        const importedEntries = response.entries;
        placeImportedEntries(
          importedEntries,
          resolvedTargetFolderPath,
          referencePath,
          resolvedPosition,
        );
      },
      getHighlightPath: function (response) {
        const firstFilePath = Entry.normalizePath(response.firstFilePath);
        const firstImportedPath = Entry.normalizePath(response.entries[0].path);
        return firstFilePath || firstImportedPath;
      },
      afterRefresh: function (response) {
        const firstFilePath = Entry.normalizePath(response.firstFilePath);
        if (firstFilePath && canAutoOpenImportedPath(firstFilePath)) {
          return ActiveFile.open(
            firstFilePath,
            firstFilePath.split("/").pop(),
          );
        }
        return true;
      },
    });
  }

  function init() {
    if (initialized) {
      return;
    }
    initialized = true;
    ActiveFile.setRefreshHandler(function (highlightPath, options) {
      pendingEntryHighlightPath = Entry.normalizePath(highlightPath) || null;
      return loadFileList(options);
    });
    initResponsiveLayout();
  }

  return {
    loadFileList: loadFileList,
    createNewFile: createNewFile,
    createNewFolder: createNewFolder,
    deleteEntry: deleteEntry,
    moveEntry: moveEntry,
    importExternalDrop: importExternalDrop,
    renameEntry: renameEntry,
    openFile: ActiveFile.open,
    getCurrentFileName: ActiveFile.getCurrentFileName,
    init: init,
    toggleFileListCollapsed: toggleFileListCollapsed,
  };
})();
