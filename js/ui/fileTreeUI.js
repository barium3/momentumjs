// File tree UI module
window.fileTreeUI = (function () {
  function renderFileTree(items, container, level = 0) {
    if (level === 0) {
      container.innerHTML = "";
    }

    items.forEach(function (item) {
      var div = document.createElement("div");
      div.className = item.isFolder ? "folder" : "file";
      div.setAttribute("data-path", item.path || "");

      var contentDiv = document.createElement("div");
      contentDiv.className = "file-item-content";
      contentDiv.style.paddingLeft = level * 16 + "px";
      div.appendChild(contentDiv);

      if (item.isFolder) {
        contentDiv.innerHTML = `
          <span class="toggle"><i class="fas fa-caret-right"></i></span>
          <span class="icon"><i class="fas fa-folder"></i></span>
          <span class="name">${item.name}</span>
        `;

        var childContainer = document.createElement("div");
        childContainer.className = "children";
        childContainer.style.display = "none";
        div.appendChild(childContainer);

        contentDiv.querySelector(".toggle").onclick = function (e) {
          e.stopPropagation();

          const caretIcon = this.querySelector("i");
          caretIcon.classList.toggle("fa-caret-right");
          caretIcon.classList.toggle("fa-caret-down");

          const folderIcon = contentDiv.querySelector(".icon i");
          folderIcon.classList.toggle("fa-folder");
          folderIcon.classList.toggle("fa-folder-open");

          childContainer.style.display =
            childContainer.style.display === "none" ? "block" : "none";
        };

        renderFileTree(item.children, childContainer, level + 1);
      } else {
        let fileIcon = "fa-file-alt";
        const fileExt = item.name.split(".").pop().toLowerCase();

        if (/^(js|jsx)$/.test(fileExt)) {
          fileIcon = "fa-file-code";
        } else if (/^(jpg|jpeg|png|gif|bmp|svg)$/.test(fileExt)) {
          fileIcon = "fa-file-image";
        } else if (fileExt === "html") {
          fileIcon = "fa-file-code";
        } else if (fileExt === "css") {
          fileIcon = "fa-file-code";
        } else if (fileExt === "json") {
          fileIcon = "fa-file-code";
        } else if (fileExt === "md") {
          fileIcon = "fa-file-alt";
        }

        contentDiv.innerHTML = `
          <span class="toggle empty"></span>
          <span class="icon"><i class="fas ${fileIcon}"></i></span>
          <span class="name">${item.name}</span>
        `;

        contentDiv.onclick = function (e) {
          e.stopPropagation();

          const selectedItems = document.querySelectorAll(".file.selected");
          selectedItems.forEach((item) => item.classList.remove("selected"));

          div.classList.add("selected");

          window.fileManager.openFile(item.path);
        };
      }

      container.appendChild(div);
    });
  }

  function showNewFileInput(callback) {
    removeNewFileInput();

    const inputContainer = document.createElement("div");
    inputContainer.className = "new-file-input-container";

    const inputWrapper = document.createElement("div");
    inputWrapper.className = "file-item-content";
    inputWrapper.innerHTML = `
      <span class="toggle empty"></span>
      <span class="icon"><i class="fas fa-file-code"></i></span>
      <input type="text" class="file-name-input" placeholder="Enter file name..." autofocus>
    `;

    inputContainer.appendChild(inputWrapper);

    const fileList = document.getElementById("file-list");
    fileList.insertBefore(inputContainer, fileList.firstChild);

    const input = inputWrapper.querySelector(".file-name-input");
    input.focus();

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
      container.parentNode.removeChild(container);
    }
  }

  return {
    renderFileTree: renderFileTree,
    showNewFileInput: showNewFileInput,
  };
})();
