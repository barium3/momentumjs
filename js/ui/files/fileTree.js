// File tree rendering, selection, drag/drop, and inline entry input.
window.fileTreeUI = (function () {
  const Entry = window.fileEntry;
  const FileTypes = window.fileTypes;
  let draggedEntry = null;
  let draggedEntryElement = null;
  let activeDropTarget = null;
  const expandedFolderPaths = Object.create(null);
  let initialized = false;

  function clearSelectedFiles() {
    const selectedItems = document.querySelectorAll(
      ".file.selected, .folder.selected",
    );
    selectedItems.forEach((item) => item.classList.remove("selected"));
  }

  function setFolderExpandedState(contentDiv, childContainer, isExpanded) {
    const caretIcon = contentDiv.querySelector(".toggle i");
    const folderIcon = contentDiv.querySelector(".icon i");

    caretIcon.classList.toggle("fa-caret-right", !isExpanded);
    caretIcon.classList.toggle("fa-caret-down", isExpanded);
    folderIcon.classList.toggle("fa-folder", !isExpanded);
    folderIcon.classList.toggle("fa-folder-open", isExpanded);
    childContainer.style.display = isExpanded ? "block" : "none";
    contentDiv.setAttribute("aria-expanded", String(isExpanded));
    const folderElement = contentDiv.parentNode;
    const folderPath = Entry.normalizePath(
      folderElement && folderElement.getAttribute("data-path"),
    );
    if (folderPath) {
      if (isExpanded) {
        expandedFolderPaths[folderPath] = true;
      } else {
        delete expandedFolderPaths[folderPath];
      }
    }
  }

  function remapExpandedEntry(previousPath, nextPath) {
    const sourcePath = Entry.normalizePath(previousPath);
    const targetPath = Entry.normalizePath(nextPath);
    if (!sourcePath || !targetPath || sourcePath === targetPath) {
      return;
    }
    Object.keys(expandedFolderPaths).forEach(function (folderPath) {
      if (folderPath === sourcePath || Entry.isPathInside(folderPath, sourcePath)) {
        const suffix = folderPath.substring(sourcePath.length);
        delete expandedFolderPaths[folderPath];
        expandedFolderPaths[targetPath + suffix] = true;
      }
    });
  }

  function removeExpandedEntry(entryPath) {
    const normalizedPath = Entry.normalizePath(entryPath);
    Object.keys(expandedFolderPaths).forEach(function (folderPath) {
      if (
        folderPath === normalizedPath ||
        Entry.isPathInside(folderPath, normalizedPath)
      ) {
        delete expandedFolderPaths[folderPath];
      }
    });
  }

  function findEntryElement(entryPath, selector) {
    const entryElements = document.querySelectorAll(
      selector || ".file[data-path], .folder[data-path]",
    );
    return Array.prototype.find.call(entryElements, function (item) {
      return item.getAttribute("data-path") === entryPath;
    });
  }

  function expandEntryAncestors(entryElement) {
    let ancestor = entryElement ? entryElement.parentNode : null;
    while (ancestor && ancestor.id !== "file-list") {
      if (ancestor.classList && ancestor.classList.contains("children")) {
        const folderElement = ancestor.parentNode;
        const folderContent = folderElement && folderElement.__momentumContentDiv;
        if (folderContent) {
          setFolderExpandedState(folderContent, ancestor, true);
        }
      }
      ancestor = ancestor.parentNode;
    }
  }

  function selectFile(filePath, options) {
    const selectOptions = options || {};
    const fileItem = findEntryElement(filePath);
    if (!fileItem) {
      return false;
    }

    expandEntryAncestors(fileItem);
    clearSelectedFiles();
    fileItem.classList.add("selected");

    if (selectOptions.scrollIntoView) {
      fileItem.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    return true;
  }

  function getSelectedTargetFolderPath() {
    const selectedEntry = document.querySelector(
      "#file-list .folder.selected[data-path], " +
        "#file-list .file.selected[data-path]",
    );
    if (!selectedEntry) {
      return null;
    }

    const selectedPath = selectedEntry.getAttribute("data-path");
    return selectedEntry.classList.contains("folder")
      ? selectedPath
      : Entry.getParentPath(selectedPath);
  }

  function isExternalEntryDrag(event) {
    return Boolean(
      !draggedEntry &&
        window.fileDrop.hasExternalEntries(event && event.dataTransfer),
    );
  }

  function importExternalDrop(
    dataTransfer,
    targetFolderPath,
    referencePath,
    position,
  ) {
    window.fileManager.importExternalDrop(
      dataTransfer,
      targetFolderPath,
      referencePath,
      position,
    );
  }

  function bindFileNameInput(input, initialValue, options) {
    const inputOptions = options || {};
    const row = inputOptions.row || null;
    let completed = false;
    let submitting = false;

    input.type = "text";
    input.className = "file-name-input inline-file-name-input";
    input.value = initialValue || "";
    input.placeholder = inputOptions.placeholder || "Enter file name...";
    input.setAttribute("spellcheck", "false");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");

    function cancelInput() {
      if (completed || submitting) {
        return;
      }
      completed = true;
      if (typeof inputOptions.onCancel === "function") {
        inputOptions.onCancel();
      }
    }

    function restoreAfterFailure(restoreFocus) {
      submitting = false;
      input.disabled = false;
      if (row) {
        row.classList.remove("pending");
      }
      if (restoreFocus) {
        input.focus();
        input.select();
      }
    }

    function commitInput(restoreFocusOnFailure) {
      if (completed || submitting) {
        return;
      }

      const fileName = input.value.trim();
      if (!fileName || fileName === inputOptions.originalValue) {
        cancelInput();
        return;
      }

      submitting = true;
      input.disabled = true;
      if (row) {
        row.classList.add("pending");
      }

      Promise.resolve(inputOptions.onCommit(fileName)).then(
        function (succeeded) {
          if (succeeded) {
            completed = true;
          } else {
            restoreAfterFailure(restoreFocusOnFailure);
          }
        },
        function () {
          restoreAfterFailure(restoreFocusOnFailure);
        },
      );
    }

    input.addEventListener("click", function (event) {
      event.stopPropagation();
    });
    input.addEventListener("dblclick", function (event) {
      event.stopPropagation();
    });
    input.addEventListener("keydown", function (event) {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        commitInput(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelInput();
      }
    });
    input.addEventListener("blur", function () {
      commitInput(false);
    });

    input.focus();
    window.setTimeout(function () {
      const extensionIndex = inputOptions.selectBeforeExtension === false
        ? -1
        : input.value.lastIndexOf(".");
      input.setSelectionRange(
        0,
        extensionIndex > 0 ? extensionIndex : input.value.length,
      );
    }, 0);
  }

  function beginRenameEntry(item, contentDiv) {
    if (!item || !contentDiv) {
      return false;
    }

    const existingInput = contentDiv.querySelector(".inline-file-name-input");
    if (existingInput) {
      existingInput.focus();
      return true;
    }

    const nameSpan = contentDiv.querySelector(".name");
    if (!nameSpan) {
      return false;
    }

    const input = document.createElement("input");
    nameSpan.parentNode.replaceChild(input, nameSpan);
    contentDiv.classList.add("renaming");
    bindFileNameInput(input, item.name, {
      originalValue: item.name,
      row: contentDiv.parentNode,
      placeholder: Entry.isFolder(item)
        ? "Enter folder name..."
        : "Enter file name...",
      selectBeforeExtension: !Entry.isFolder(item),
      onCancel: function () {
        if (input.parentNode) {
          input.parentNode.replaceChild(nameSpan, input);
        }
        contentDiv.classList.remove("renaming");
        contentDiv.focus();
      },
      onCommit: function (nextName) {
        return window.fileManager.renameEntry(item, nextName);
      },
    });
    return true;
  }

  function beginRenameSelectedEntry() {
    const fileList = document.getElementById("file-list");
    const activeElement = document.activeElement;
    if (!fileList || !activeElement || !fileList.contains(activeElement)) {
      return false;
    }

    const selectedEntry = fileList.querySelector(
      ".file.selected[data-path], .folder.selected[data-path]",
    );
    if (!selectedEntry || !selectedEntry.__momentumFileItem) {
      return false;
    }

    return beginRenameEntry(
      selectedEntry.__momentumFileItem,
      selectedEntry.querySelector(".file-item-content"),
    );
  }

  function clearDropIndicator() {
    if (activeDropTarget) {
      activeDropTarget.classList.remove(
        "drop-before",
        "drop-after",
        "drop-into",
        "external-drop-root",
      );
      activeDropTarget = null;
    }
  }

  function clearDragState() {
    clearDropIndicator();
    if (draggedEntryElement) {
      draggedEntryElement.classList.remove("dragging");
    }
    draggedEntry = null;
    draggedEntryElement = null;
  }

  function setDropIndicator(target, className) {
    clearDropIndicator();
    activeDropTarget = target;
    target.classList.add(className);
  }

  function canDropIntoFolder(folderPath) {
    return Boolean(
      draggedEntry &&
        draggedEntry.path !== folderPath &&
        (!Entry.isFolder(draggedEntry) ||
          !Entry.isPathInside(folderPath, draggedEntry.path)),
    );
  }

  function getEntryDropIntent(item, contentDiv, event) {
    const bounds = contentDiv.getBoundingClientRect();
    const offsetRatio = bounds.height > 0
      ? (event.clientY - bounds.top) / bounds.height
      : 0.5;
    if (Entry.isFolder(item) && offsetRatio >= 0.25 && offsetRatio <= 0.75) {
      return "into";
    }
    return offsetRatio < 0.5 ? "before" : "after";
  }

  function canInsertAroundEntry(event, item) {
    if (isExternalEntryDrag(event)) {
      return true;
    }
    if (!draggedEntry || draggedEntry.path === item.path) {
      return false;
    }
    const targetFolderPath = Entry.getParentPath(item.path);
    return !(
      Entry.isFolder(draggedEntry) &&
      Entry.isPathInside(targetFolderPath, draggedEntry.path)
    );
  }

  function wireEntryInteractions(item, entryElement, contentDiv) {
    const deleteButton = contentDiv.querySelector(".delete-entry-button");
    const fallbackName = Entry.isFolder(item) ? "folder" : "file";
    const deleteLabel = "Delete " + (item.name || fallbackName);

    contentDiv.tabIndex = 0;
    deleteButton.setAttribute("aria-label", deleteLabel);

    deleteButton.onmousedown = function (event) {
      event.preventDefault();
      event.stopPropagation();
    };
    deleteButton.onclick = function (event) {
      event.preventDefault();
      event.stopPropagation();
      deleteButton.disabled = true;
      Promise.resolve(
        window.fileManager.deleteEntry(item),
      ).then(function (deleted) {
        if (!deleted && deleteButton.parentNode) {
          deleteButton.disabled = false;
        }
      });
    };
    deleteButton.ondblclick = function (event) {
      event.preventDefault();
      event.stopPropagation();
    };

    contentDiv.onclick = function (event) {
      event.stopPropagation();
      if (
        event.target &&
        event.target.classList &&
        event.target.classList.contains("inline-file-name-input")
      ) {
        return;
      }

      selectFile(item.path);
      contentDiv.focus();
      if (Entry.isFolder(item)) {
        if (event.detail < 2 && entryElement.__momentumChildContainer) {
          setFolderExpandedState(
            contentDiv,
            entryElement.__momentumChildContainer,
            entryElement.__momentumChildContainer.style.display === "none",
          );
        }
      } else {
        window.fileManager.openFile(item.path, item.name);
      }
    };
    contentDiv.ondblclick = function (event) {
      event.preventDefault();
      event.stopPropagation();
      selectFile(item.path);
      beginRenameEntry(item, contentDiv);
    };

    contentDiv.draggable = true;
    contentDiv.ondragstart = function (event) {
      if (
        event.target === deleteButton ||
        (deleteButton.contains && deleteButton.contains(event.target)) ||
        (event.target && event.target.tagName === "INPUT")
      ) {
        event.preventDefault();
        return;
      }

      draggedEntry = Entry.create(item);
      draggedEntryElement = entryElement;
      entryElement.classList.add("dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.path);
      }
    };
    contentDiv.ondragend = clearDragState;
    contentDiv.ondragover = function (event) {
      const isExternalDrop = isExternalEntryDrag(event);
      const dropIntent = getEntryDropIntent(item, contentDiv, event);
      if (dropIntent !== "into") {
        if (!canInsertAroundEntry(event, item)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setDropIndicator(
          contentDiv,
          dropIntent === "before" ? "drop-before" : "drop-after",
        );
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = isExternalDrop ? "copy" : "move";
        }
        return;
      }
      if (
        !Entry.isFolder(item) ||
        (!isExternalDrop && !canDropIntoFolder(item.path))
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setDropIndicator(contentDiv, "drop-into");
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = isExternalDrop ? "copy" : "move";
      }
    };
    contentDiv.ondragleave = function (event) {
      if (!contentDiv.contains(event.relatedTarget)) {
        clearDropIndicator();
      }
    };
    contentDiv.ondrop = function (event) {
      const isExternalDrop = isExternalEntryDrag(event);
      const dropIntent = getEntryDropIntent(item, contentDiv, event);
      if (dropIntent !== "into") {
        if (!canInsertAroundEntry(event, item)) {
          return;
        }
        const dataTransfer = event.dataTransfer;
        const sourceEntry = draggedEntry;
        event.preventDefault();
        event.stopPropagation();
        clearDragState();
        if (isExternalDrop) {
          importExternalDrop(
            dataTransfer,
            Entry.getParentPath(item.path),
            item.path,
            dropIntent,
          );
        } else if (sourceEntry) {
          window.fileManager.moveEntry(
            sourceEntry,
            Entry.getParentPath(item.path),
            item.path,
            dropIntent,
          );
        }
        return;
      }
      if (
        !Entry.isFolder(item) ||
        (!isExternalDrop && !canDropIntoFolder(item.path))
      ) {
        return;
      }
      const dataTransfer = event.dataTransfer;
      event.preventDefault();
      event.stopPropagation();
      const sourceEntry = draggedEntry;
      clearDragState();
      if (isExternalDrop) {
        importExternalDrop(dataTransfer, item.path, null, "top");
        return;
      }
      if (sourceEntry) {
        window.fileManager.moveEntry(sourceEntry, item.path, null, "top");
      }
    };
  }

  function wireExternalContainerDropTarget(container, targetFolderPath) {
    container.ondragover = function (event) {
      if (!targetFolderPath || !isExternalEntryDrag(event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setDropIndicator(container, "external-drop-root");
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    };
    container.ondragleave = function (event) {
      if (!container.contains(event.relatedTarget)) {
        clearDropIndicator();
      }
    };
    container.ondrop = function (event) {
      if (!targetFolderPath || !isExternalEntryDrag(event)) {
        return;
      }
      const dataTransfer = event.dataTransfer;
      event.preventDefault();
      event.stopPropagation();
      clearDragState();
      importExternalDrop(dataTransfer, targetFolderPath, null, "top");
    };
  }

  function appendFileTree(items, container, level, parentFolderPath) {
    const resolvedParentFolderPath = parentFolderPath || "";
    if (container.nodeType === 1) {
      wireExternalContainerDropTarget(container, resolvedParentFolderPath);
    }

    items.forEach(function (item) {
      const div = document.createElement("div");
      div.className = Entry.isFolder(item) ? "folder" : "file";
      div.setAttribute("data-path", item.path || "");
      div.__momentumFileItem = item;
      div.__momentumLevel = level;

      const contentDiv = document.createElement("div");
      contentDiv.className = "file-item-content";
      contentDiv.style.paddingLeft = level * 16 + "px";
      div.appendChild(contentDiv);
      div.__momentumContentDiv = contentDiv;

      const toggleMarkup = Entry.isFolder(item)
        ? '<span class="toggle"><i class="fas fa-caret-right"></i></span>'
        : '<span class="toggle empty"></span>';
      const iconClass = Entry.isFolder(item)
        ? "fa-folder"
        : FileTypes.getIconClass(item.name);
      contentDiv.innerHTML = `
        ${toggleMarkup}
        <span class="icon"><i class="fas ${iconClass}"></i></span>
        <span class="name"></span>
        <button type="button" class="delete-entry-button">
          <i class="fas fa-times"></i>
        </button>
      `;
      contentDiv.querySelector(".name").textContent = item.name || "";

      if (Entry.isFolder(item)) {
        const childContainer = document.createElement("div");
        childContainer.className = "children";
        div.appendChild(childContainer);
        div.__momentumChildContainer = childContainer;

        const toggle = contentDiv.querySelector(".toggle");
        toggle.onclick = function (event) {
          event.stopPropagation();
          setFolderExpandedState(
            contentDiv,
            childContainer,
            childContainer.style.display === "none",
          );
        };
        toggle.ondblclick = function (event) {
          event.preventDefault();
          event.stopPropagation();
        };

        appendFileTree(
          item.children || [],
          childContainer,
          level + 1,
          item.path,
        );
        setFolderExpandedState(
          contentDiv,
          childContainer,
          expandedFolderPaths[Entry.normalizePath(item.path)] === true,
        );
      }

      wireEntryInteractions(item, div, contentDiv);
      container.appendChild(div);
    });

  }

  function renderFileTree(items, container) {
    const rootFolderPath = container.getAttribute("data-root-path") || "";
    const previousScrollTop = container.scrollTop;
    const fragment = document.createDocumentFragment();
    appendFileTree(items, fragment, 0, rootFolderPath);
    container.replaceChildren(fragment);
    wireExternalContainerDropTarget(container, rootFolderPath);
    container.scrollTop = previousScrollTop;
  }

  function handleDocumentKeydown(event) {
    if (event.key !== "F2") {
      return;
    }
    if (beginRenameSelectedEntry()) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleDocumentDragover(event) {
    if (!isExternalEntryDrag(event)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDocumentDrop(event) {
    if (!isExternalEntryDrag(event)) {
      return;
    }
    const fileList = document.getElementById("file-list");
    const targetFolderPath = getSelectedTargetFolderPath() ||
      (fileList && fileList.getAttribute("data-root-path")) ||
      "";
    const dataTransfer = event.dataTransfer;
    event.preventDefault();
    clearDragState();
    importExternalDrop(dataTransfer, targetFolderPath, null, "top");
  }

  function init() {
    if (initialized) {
      return;
    }
    initialized = true;
    document.addEventListener("keydown", handleDocumentKeydown);
    document.addEventListener("dragover", handleDocumentDragover);
    document.addEventListener("drop", handleDocumentDrop);
  }

  function showNewItemInput(callback, options) {
    const inputOptions = options || {};
    const isFolder = inputOptions.kind === "folder";
    const defaultExtension = typeof inputOptions.defaultExtension === "string"
      ? inputOptions.defaultExtension
      : isFolder
        ? ""
        : ".js";
    const defaultBaseName = inputOptions.defaultBaseName ||
      (isFolder ? "New Folder" : "sketch");
    const initialValue = inputOptions.initialValue ||
      (defaultBaseName + defaultExtension);

    removeNewItemInput();

    const fileList = document.getElementById("file-list");
    const parentFolder = inputOptions.parentFolderPath
      ? findEntryElement(
          inputOptions.parentFolderPath,
          "#file-list .folder[data-path]",
        )
      : null;
    const inputParent = parentFolder && parentFolder.__momentumChildContainer
      ? parentFolder.__momentumChildContainer
      : fileList;
    const inputLevel = parentFolder
      ? Number(parentFolder.__momentumLevel || 0) + 1
      : 0;

    if (parentFolder) {
      expandEntryAncestors(parentFolder);
      setFolderExpandedState(
        parentFolder.__momentumContentDiv,
        parentFolder.__momentumChildContainer,
        true,
      );
    }

    const inputContainer = document.createElement("div");
    inputContainer.className =
      (isFolder ? "folder" : "file") +
      " new-item-input-container selected";

    const inputWrapper = document.createElement("div");
    inputWrapper.className = "file-item-content";
    inputWrapper.style.paddingLeft = inputLevel * 16 + "px";
    inputWrapper.innerHTML = `
      <span class="toggle empty"></span>
      <span class="icon"><i class="fas ${isFolder ? "fa-folder" : FileTypes.getIconClass(initialValue)}"></i></span>
    `;

    inputContainer.appendChild(inputWrapper);

    inputParent.insertBefore(inputContainer, inputParent.firstChild);

    const input = document.createElement("input");
    inputWrapper.appendChild(input);
    bindFileNameInput(input, initialValue, {
      row: inputContainer,
      placeholder: isFolder ? "Enter folder name..." : "Enter file name...",
      selectBeforeExtension: !isFolder,
      onCancel: function () {
        if (inputContainer.parentNode) {
          inputContainer.parentNode.removeChild(inputContainer);
        }
        callback(null);
      },
      onCommit: function (fileName) {
        return callback(fileName);
      },
    });
  }

  function removeNewItemInput() {
    const container = document.querySelector(".new-item-input-container");
    if (container) {
      container.remove();
    }
  }

  return {
    clearSelectedFiles: clearSelectedFiles,
    remapExpandedEntry: remapExpandedEntry,
    removeExpandedEntry: removeExpandedEntry,
    init: init,
    renderFileTree: renderFileTree,
    selectFile: selectFile,
    getSelectedTargetFolderPath: getSelectedTargetFolderPath,
    showNewItemInput: showNewItemInput,
  };
})();
