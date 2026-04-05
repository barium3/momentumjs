// Console output redirection module.
window.consoleManager = (function () {
  const MIRROR_TO_NATIVE_CONSOLE = false;
  const COLLAPSED_ICON = "▶";
  const EXPANDED_ICON = "▼";
  let consoleOutput = null;

  // Treat plain objects separately from arrays so they can render with different previews.
  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function buildObjectTree(obj, depth = 0, maxDepth = 5) {
    if (depth > maxDepth) {
      return `<span class="console-string">...</span>`;
    }

    if (!isObject(obj) && !Array.isArray(obj)) {
      return formatValue(obj);
    }

    if (Array.isArray(obj)) {
      if (obj.length === 0) {
        return `<span class="console-array-empty">[]</span>`;
      }
      const items = obj
        .slice(0, 10)
        .map((item) => buildObjectTree(item, depth + 1, maxDepth));
      const more =
        obj.length > 10
          ? `, <span class="console-more">+${obj.length - 10} more</span>`
          : "";
      return `<span class="console-array">[${items.join(', ')}${more}]</span>`;
    }

    const keys = Object.keys(obj);
    if (keys.length === 0) {
      return `<span class="console-object-empty">{}</span>`;
    }

    const previewKeys = keys.slice(0, 5);
    const preview = previewKeys.map((key) => {
      const value = obj[key];
      const formattedValue = isObject(value)
        ? buildObjectTree(value, depth + 1, maxDepth)
        : formatValue(value);
      return `<span class="console-key">${escapeHtml(key)}</span>: ${formattedValue}`;
    });
    const more =
      keys.length > 5 ? `, <span class="console-more">+${keys.length - 5} more</span>` : "";

    return `<span class="console-object">{${
      preview.join(', ')
    }${more}}</span>`;
  }

  function formatValue(value) {
    const type = typeof value;

    if (value === null) {
      return `<span class="console-null">null</span>`;
    }
    if (value === undefined) {
      return `<span class="console-undefined">undefined</span>`;
    }
    if (type === 'string') {
      return `<span class="console-string">"${escapeHtml(value)}"</span>`;
    }
    if (type === 'number') {
      return `<span class="console-number">${value}</span>`;
    }
    if (type === 'boolean') {
      return `<span class="console-boolean">${value}</span>`;
    }
    if (type === 'function') {
      return `<span class="console-function">ƒ ${value.name || 'anonymous'}()</span>`;
    }
    if (isObject(value)) {
      return `<span class="console-object-ref">Object</span>`;
    }

    return `<span class="console-string">${String(value)}</span>`;
  }

  function appendLine(lineDiv) {
    consoleOutput.appendChild(lineDiv);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  }

  function setExpandedState(toggle, contentEl, isExpanded) {
    toggle.classList.toggle("expanded", isExpanded);
    toggle.textContent = isExpanded ? EXPANDED_ICON : COLLAPSED_ICON;
    contentEl.style.display = isExpanded ? "block" : "none";
  }

  function toggleVisibility(element) {
    const isVisible = element.style.display !== "none";
    element.style.display = isVisible ? "none" : "block";
    return !isVisible;
  }

  function toggleDetailBlock(detailsEl, toggleEl) {
    const isExpanded = toggleVisibility(detailsEl);
    if (toggleEl) {
      toggleEl.classList.toggle("expanded", isExpanded);
    }
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function formatWarnText(text) {
    const escaped = escapeHtml(text == null ? "" : String(text));
    return escaped
      .replace(/\[i\](.*?)\[\/i\]/g, "<em>$1</em>")
      .replace(/\[u\](.*?)\[\/u\]/g, "<u>$1</u>")
      .replace(/\r?\n/g, "<br>");
  }

  // Use message and index attributes so an inline reference can toggle its detail block.
  function createObjectDetails(obj, messageId = null, index = null) {
    if (!isObject(obj) && !Array.isArray(obj)) {
      return "";
    }

    const keys = Object.keys(obj);
    const id = "obj-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9);

    const messageAttr = messageId ? `data-message="${messageId}"` : "";
    const indexAttr = index !== null ? `data-index="${index}"` : "";

    let detailsHtml = "";

    if (Array.isArray(obj)) {
      detailsHtml = `
        <div class="console-object-details" ${messageAttr} ${indexAttr} data-id="${id}" style="display: none;">
          <div class="console-details-header">
            <span class="console-details-toggle expanded" data-target="${id}">▼</span>
            <span class="console-details-type">Array(${obj.length})</span>
          </div>
          <div class="console-details-content" id="${id}-content">
            ${obj.map((item, idx) => `
              <div class="console-details-row">
                <span class="console-details-index">${idx}</span>
                <span class="console-details-value">${formatValueForDetails(item)}</span>
              </div>
            `).join("")}
          </div>
        </div>
      `;
    } else {
      const ownProps = keys
        .map((key) => {
          try {
            const descriptor = Object.getOwnPropertyDescriptor(obj, key);
            const value = obj[key];
            const isGetter = descriptor && typeof descriptor.get === "function";
            return {
              key,
              value: isGetter ? "<getter>" : value,
              enumerable: descriptor ? descriptor.enumerable : true,
            };
          } catch (e) {
            return { key, value: "<error>", enumerable: true };
          }
        })
        .filter((prop) => prop.enumerable);

      detailsHtml = `
        <div class="console-object-details" ${messageAttr} ${indexAttr} data-id="${id}" style="display: none;">
          <div class="console-details-header">
            <span class="console-details-toggle expanded" data-target="${id}">▼</span>
            <span class="console-details-type">Object</span>
          </div>
          <div class="console-details-content" id="${id}-content">
            ${ownProps.map((prop) => `
              <div class="console-details-row">
                <span class="console-details-key">${escapeHtml(prop.key)}</span>:
                <span class="console-details-value">${formatValueForDetails(prop.value)}</span>
              </div>
            `).join("")}
          </div>
        </div>
      `;
    }

    return detailsHtml;
  }

  function formatValueForDetails(value) {
    if (value === null) {
      return `<span class="console-null">null</span>`;
    }
    if (value === undefined) {
      return `<span class="console-undefined">undefined</span>`;
    }
    if (typeof value === "function") {
      return `<span class="console-function">ƒ ${value.name || "anonymous"}()</span>`;
    }
    if (isObject(value) || Array.isArray(value)) {
      const typeLabel = Array.isArray(value) ? `Array(${value.length})` : "Object";
      return `<span class="console-expandable" data-value='${JSON.stringify(value, null, 0)}'>${typeLabel}</span>`;
    }
    if (typeof value === "string") {
      return `<span class="console-string">"${escapeHtml(value)}"</span>`;
    }
    if (typeof value === "number") {
      return `<span class="console-number">${value}</span>`;
    }
    if (typeof value === "boolean") {
      return `<span class="console-boolean">${value}</span>`;
    }

    return `<span class="console-string">${escapeHtml(String(value))}</span>`;
  }

  function renderLog(args, isError = false) {
    const messageId = "msg-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9);

    let mainContent = "";
    let detailsHtml = "";

    args.forEach((arg, index) => {
      if (index > 0) {
        mainContent += " ";
      }

      if (isObject(arg) || Array.isArray(arg)) {
        const typeLabel = Array.isArray(arg) ? `Array(${arg.length})` : "Object";
        mainContent += `<span class="console-expandable-ref" data-message="${messageId}" data-index="${index}">${typeLabel}</span>`;
        detailsHtml += createObjectDetails(arg, messageId, index);
      } else {
        mainContent += formatValue(arg);
      }
    });

    const lineDiv = document.createElement("div");
    lineDiv.className = "console-line" + (isError ? " console-error-line" : "");
    lineDiv.innerHTML = `
      <span class="console-message">${mainContent}</span>
      ${detailsHtml}
    `;

    appendLine(lineDiv);
  }

  function initConsole() {
    consoleOutput = document.getElementById("console-output");
    if (!consoleOutput) {
      return;
    }

    consoleOutput.addEventListener("click", function (e) {
      const toggle = e.target.closest(".console-details-toggle");
      if (toggle) {
        e.stopPropagation();
        const targetId = toggle.getAttribute("data-target");
        const contentEl = document.getElementById(`${targetId}-content`);

        if (contentEl) {
          setExpandedState(toggle, contentEl, !toggle.classList.contains("expanded"));
        }
        return;
      }

      const ref = e.target.closest(".console-expandable-ref");
      if (ref) {
        e.stopPropagation();
        const messageId = ref.getAttribute("data-message");
        const index = parseInt(ref.getAttribute("data-index"), 10);
        const detailsEl = document.querySelector(`.console-object-details[data-message="${messageId}"][data-index="${index}"]`);

        if (detailsEl) {
          toggleDetailBlock(detailsEl, ref);
        }
        return;
      }

      const nestedExpandable = e.target.closest(".console-expandable");
      if (nestedExpandable) {
        e.stopPropagation();
        const parentRow = nestedExpandable.closest(".console-details-row");
        const existingDetails = parentRow.querySelector(".console-nested-details");

        if (existingDetails) {
          toggleDetailBlock(existingDetails, nestedExpandable);
        } else {
          try {
            const dataValue = JSON.parse(nestedExpandable.getAttribute("data-value") || "{}");
            const nestedDetails = createObjectDetails(dataValue);
            if (nestedDetails) {
              const container = document.createElement("div");
              container.className = "console-nested-details";
              container.innerHTML = nestedDetails;
              parentRow.appendChild(container);

              const newToggle = container.querySelector(".console-details-toggle");
              if (newToggle) {
                newToggle.addEventListener("click", handleNestedToggle);
              }

              nestedExpandable.classList.add("expanded");
            }
          } catch (err) {
            console.warn("Failed to expand object:", err);
          }
        }
        return;
      }
    });

    function handleNestedToggle(e) {
      e.stopPropagation();
      const toggle = e.target;
      const targetId = toggle.getAttribute("data-target");
      const detailsEl = document.querySelector(`.console-object-details[data-id="${targetId}"]`);
      const contentEl = document.getElementById(`${targetId}-content`);

      if (detailsEl && contentEl) {
        setExpandedState(toggle, contentEl, !toggle.classList.contains("expanded"));
      }
    }

    function mirrorToNativeConsole(nativeMethod, args) {
      if (MIRROR_TO_NATIVE_CONSOLE) {
        nativeMethod.apply(console, args);
      }
    }

    function overrideConsoleMethod(methodName, render) {
      const nativeMethod = console[methodName];
      console[methodName] = function (...args) {
        render(args);
        mirrorToNativeConsole(nativeMethod, args);
      };
    }

    overrideConsoleMethod("log", function (args) {
      renderLog(args, false);
    });

    overrideConsoleMethod("error", function (args) {
      renderLog(args, true);
    });

    overrideConsoleMethod("warn", function (args) {
      const lineDiv = document.createElement("div");
      lineDiv.className = "console-line console-warn-line";
      lineDiv.innerHTML = `<span class="console-warn">${formatWarnText(args.join(' '))}</span><br>`;
      appendLine(lineDiv);
    });

    overrideConsoleMethod("info", function (args) {
      renderLog(args, false);
    });
  }

  function clearConsole() {
    if (consoleOutput) {
      consoleOutput.innerHTML = "";
    }
  }

  return {
    initConsole,
    clearConsole,
  };
})();
