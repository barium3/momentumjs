// Single owner for the visible workspace mode and editor/image surface.
window.workspaceManager = (function () {
  "use strict";

  const WORKSPACE_CHANNEL = "workspace";
  const EFFECT_CODE_CHANNEL = "effect-code";

  let initialized = false;
  let mode = WORKSPACE_CHANNEL;
  let surface = "editor";

  function getElement(id) {
    return document.getElementById(id);
  }

  function syncMode() {
    window.tooltipManager.hide();
    const effectCodeActive = mode === EFFECT_CODE_CHANNEL;
    const editorActive = effectCodeActive || surface === "editor";
    const imageActive = !effectCodeActive && surface === "image";
    const container = getElement("container");
    const fileList = getElement("file-list");
    const editor = getElement("editor");
    const imageContainer = getElement("image-container");

    container.classList.toggle("effect-code-active", effectCodeActive);
    if (effectCodeActive) {
      fileList.setAttribute("aria-disabled", "true");
    } else {
      fileList.removeAttribute("aria-disabled");
    }

    editor.classList.toggle("workspace-editor-inactive", !editorActive);
    editor.setAttribute("aria-hidden", String(!editorActive));
    imageContainer.hidden = !imageActive;
  }

  function showEditor() {
    surface = "editor";
    syncMode();
  }

  function showImage(filePath) {
    const imageContainer = getElement("image-container");
    const image = document.createElement("img");
    const normalizedPath = window.fileEntry.normalizePath(filePath);

    image.src = encodeURI("file://" + normalizedPath)
      .replace(/#/g, "%23")
      .replace(/\?/g, "%3F");
    image.alt = String(normalizedPath.split("/").pop() || "Image");
    imageContainer.replaceChildren(image);
    surface = "image";
    syncMode();
  }

  function enterEffectCode() {
    mode = EFFECT_CODE_CHANNEL;
    window.consoleManager.activateChannel(EFFECT_CODE_CHANNEL);
    syncMode();
  }

  function leaveEffectCode() {
    mode = WORKSPACE_CHANNEL;
    window.consoleManager.activateChannel(WORKSPACE_CHANNEL);
    syncMode();
  }

  function init() {
    if (initialized) {
      return;
    }
    initialized = true;
    window.consoleManager.activateChannel(WORKSPACE_CHANNEL);
    syncMode();
  }

  return {
    enterEffectCode,
    init,
    leaveEffectCode,
    showEditor,
    showImage,
  };
})();
