// File tree rendering and inline "new file" input.
window.fileTreeUI = (function () {
  const FILE_ICON_BY_EXTENSION = {
    js: "fa-file-code",
    jsx: "fa-file-code",
    html: "fa-file-code",
    css: "fa-file-code",
    json: "fa-file-code",
    jpg: "fa-file-image",
    jpeg: "fa-file-image",
    png: "fa-file-image",
    gif: "fa-file-image",
    bmp: "fa-file-image",
    svg: "fa-file-image",
    md: "fa-file-alt",
  };

  function clearSelectedFiles() {
    const selectedItems = document.querySelectorAll(".file.selected");
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
  }

  function getFileIconClass(fileName) {
    const fileExt = fileName.split(".").pop().toLowerCase();
    return FILE_ICON_BY_EXTENSION[fileExt] || "fa-file-alt";
  }

  function selectFile(filePath, options) {
    const selectOptions = options || {};
    const fileItems = document.querySelectorAll(".file[data-path]");
    const fileItem = Array.prototype.find.call(fileItems, function (item) {
      return item.getAttribute("data-path") === filePath;
    });
    if (!fileItem) {
      return false;
    }

    clearSelectedFiles();
    fileItem.classList.add("selected");

    if (selectOptions.scrollIntoView) {
      fileItem.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    return true;
  }

  function renderFileTree(items, container, level = 0) {
    if (level === 0) {
      container.innerHTML = "";
    }

    items.forEach(function (item) {
      const div = document.createElement("div");
      div.className = item.isFolder ? "folder" : "file";
      div.setAttribute("data-path", item.path || "");

      const contentDiv = document.createElement("div");
      contentDiv.className = "file-item-content";
      contentDiv.style.paddingLeft = level * 16 + "px";
      div.appendChild(contentDiv);

      if (item.isFolder) {
        contentDiv.innerHTML = `
          <span class="toggle"><i class="fas fa-caret-right"></i></span>
          <span class="icon"><i class="fas fa-folder"></i></span>
          <span class="name">${item.name}</span>
        `;

        const childContainer = document.createElement("div");
        childContainer.className = "children";
        childContainer.style.display = "none";
        div.appendChild(childContainer);

        contentDiv.querySelector(".toggle").onclick = function (e) {
          e.stopPropagation();
          setFolderExpandedState(
            contentDiv,
            childContainer,
            childContainer.style.display === "none",
          );
        };

        renderFileTree(item.children, childContainer, level + 1);
      } else {
        contentDiv.innerHTML = `
          <span class="toggle empty"></span>
          <span class="icon"><i class="fas ${getFileIconClass(item.name)}"></i></span>
          <span class="name">${item.name}</span>
        `;

        contentDiv.onclick = function (e) {
          e.stopPropagation();
          selectFile(item.path);
          window.fileManager.openFile(item.path);
        };
      }

      container.appendChild(div);
    });
  }

  function showNewFileInput(callback, options) {
    const inputOptions = options || {};
    const defaultExtension = inputOptions.defaultExtension || ".js";
    const defaultBaseName = inputOptions.defaultBaseName || "sketch";
    const initialValue = inputOptions.initialValue || (defaultBaseName + defaultExtension);

    removeNewFileInput();

    const inputContainer = document.createElement("div");
    inputContainer.className = "new-file-input-container";

    const inputWrapper = document.createElement("div");
    inputWrapper.className = "file-item-content";
    inputWrapper.innerHTML = `
      <span class="toggle empty"></span>
      <span class="icon"><i class="fas fa-file-code"></i></span>
      <input
        type="text"
        class="file-name-input"
        placeholder="Enter file name..."
        autofocus
        spellcheck="false"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
      >
    `;

    inputContainer.appendChild(inputWrapper);

    const fileList = document.getElementById("file-list");
    fileList.insertBefore(inputContainer, fileList.firstChild);

    const input = inputWrapper.querySelector(".file-name-input");
    input.value = initialValue;
    input.focus();
    setTimeout(function () {
      const suffixIndex = initialValue.endsWith(defaultExtension)
        ? initialValue.length - defaultExtension.length
        : initialValue.length;
      input.setSelectionRange(0, Math.max(0, suffixIndex));
    }, 0);

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        const fileName = input.value.trim();
        if (fileName) {
          callback(fileName);
        }
        removeNewFileInput();
      } else if (e.key === "Escape") {
        removeNewFileInput();
        callback(null);
      }
    });

    input.addEventListener("blur", function () {
      setTimeout(function () {
        removeNewFileInput();
      }, 200);
    });
  }

  function removeNewFileInput() {
    const container = document.querySelector(".new-file-input-container");
    if (container) {
      container.remove();
    }
  }

  return {
    clearSelectedFiles: clearSelectedFiles,
    renderFileTree: renderFileTree,
    selectFile: selectFile,
    showNewFileInput: showNewFileInput,
  };
})();
