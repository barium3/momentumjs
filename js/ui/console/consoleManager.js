// Console output and retained-channel manager.
window.consoleManager = (function () {
  const COLLAPSED_ICON = "▶";
  const EXPANDED_ICON = "▼";
  let consoleOutput = null;
  let expandableValues = Object.create(null);
  let nextExpandableValueId = 0;
  let activeChannelName = "workspace";
  const channelStates = Object.create(null);
  let initialized = false;

  function createChannelState() {
    return {
      expandableValues: Object.create(null),
      nextExpandableValueId: 0,
      nodes: [],
      scrollTop: 0,
    };
  }

  function getChannelState(channelName) {
    const normalizedName = String(channelName || "workspace");
    if (!channelStates[normalizedName]) {
      channelStates[normalizedName] = createChannelState();
    }
    return channelStates[normalizedName];
  }

  // Treat plain objects separately from arrays so they can render with different previews.
  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
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
      return `<span class="console-function">ƒ ${escapeHtml(value.name || "anonymous")}()</span>`;
    }
    if (isObject(value)) {
      return `<span class="console-object-ref">Object</span>`;
    }

    return `<span class="console-string">${escapeHtml(String(value))}</span>`;
  }

  function appendLine(lineDiv) {
    consoleOutput.appendChild(lineDiv);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  }

  function setExpandedState(toggle, contentEl, isExpanded) {
    toggle.classList.toggle("expanded", isExpanded);
    toggle.textContent = isExpanded ? EXPANDED_ICON : COLLAPSED_ICON;
    contentEl.style.display = isExpanded ? "block" : "none";
    const header = toggle.closest(".console-details-header");
    if (header) {
      header.setAttribute("aria-expanded", String(isExpanded));
    }
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

  function registerExpandableValue(value) {
    nextExpandableValueId += 1;
    const valueId = `console-value-${nextExpandableValueId}`;
    expandableValues[valueId] = value;
    return valueId;
  }

  function resetExpandableValues() {
    expandableValues = Object.create(null);
    nextExpandableValueId = 0;
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
          <button type="button" class="console-details-header" data-target="${id}" aria-controls="${id}-content" aria-expanded="true">
            <span class="console-details-toggle expanded" aria-hidden="true">▼</span>
            <span class="console-details-type">Array(${obj.length})</span>
          </button>
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
          <button type="button" class="console-details-header" data-target="${id}" aria-controls="${id}-content" aria-expanded="true">
            <span class="console-details-toggle expanded" aria-hidden="true">▼</span>
            <span class="console-details-type">Object</span>
          </button>
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
      return `<span class="console-function">ƒ ${escapeHtml(value.name || "anonymous")}()</span>`;
    }
    if (isObject(value) || Array.isArray(value)) {
      const typeLabel = Array.isArray(value) ? `Array(${value.length})` : "Object";
      const valueId = registerExpandableValue(value);
      return `<span class="console-expandable" data-value-id="${valueId}">${typeLabel}</span>`;
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

  function init() {
    if (initialized) {
      return;
    }
    consoleOutput = document.getElementById("console-output");
    if (!consoleOutput) {
      return;
    }
    initialized = true;

    consoleOutput.addEventListener("click", function (e) {
      const detailsHeader = e.target.closest(".console-details-header");
      if (detailsHeader) {
        e.stopPropagation();
        const targetId = detailsHeader.getAttribute("data-target");
        const contentEl = document.getElementById(`${targetId}-content`);
        const toggle = detailsHeader.querySelector(".console-details-toggle");

        if (contentEl && toggle) {
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
            const valueId = nestedExpandable.getAttribute("data-value-id");
            if (!Object.prototype.hasOwnProperty.call(expandableValues, valueId)) {
              return;
            }
            const dataValue = expandableValues[valueId];
            const nestedDetails = createObjectDetails(dataValue);
            if (nestedDetails) {
              const container = document.createElement("div");
              container.className = "console-nested-details";
              container.innerHTML = nestedDetails;
              parentRow.appendChild(container);
              nestedExpandable.classList.add("expanded");
            }
          } catch (err) {
            console.warn("Failed to expand object:", err);
          }
        }
        return;
      }
    });

    function overrideConsoleMethod(methodName, render) {
      console[methodName] = function (...args) {
        render(args);
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
    resetExpandableValues();
    if (consoleOutput) {
      consoleOutput.replaceChildren();
    }
  }

  function saveActiveChannel() {
    const state = getChannelState(activeChannelName);
    state.expandableValues = expandableValues;
    state.nextExpandableValueId = nextExpandableValueId;
    state.scrollTop = consoleOutput.scrollTop;
    state.nodes = [];
    while (consoleOutput.firstChild) {
      state.nodes.push(consoleOutput.removeChild(consoleOutput.firstChild));
    }
  }

  function activateChannel(channelName) {
    const normalizedName = String(channelName || "workspace");
    if (!consoleOutput || normalizedName === activeChannelName) {
      return;
    }

    saveActiveChannel();
    activeChannelName = normalizedName;
    const state = getChannelState(activeChannelName);
    expandableValues = state.expandableValues;
    nextExpandableValueId = state.nextExpandableValueId;
    state.nodes.forEach(function (node) {
      consoleOutput.appendChild(node);
    });
    state.nodes = [];
    consoleOutput.scrollTop = state.scrollTop;
  }

  function appendExternalLine(text, level) {
    if (!consoleOutput) {
      return;
    }

    const safeText = escapeHtml(text == null ? "" : String(text)).replace(/\r?\n/g, "<br>");
    const lineDiv = document.createElement("div");
    const normalizedLevel = level === "error" ? "error" : level === "warn" ? "warn" : "log";
    let className = "console-line";
    if (normalizedLevel === "error") {
      className += " console-error-line";
    } else if (normalizedLevel === "warn") {
      className += " console-warn-line";
    }
    lineDiv.className = className;
    lineDiv.innerHTML = `<span class="console-message">${safeText}</span>`;
    appendLine(lineDiv);
  }

  return {
    activateChannel,
    appendExternalLine,
    init,
    clearConsole,
  };
})();
