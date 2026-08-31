// Coordinates one-time UI startup after the DOM is ready.
(function () {
  let initialized = false;

  function bindClick(elementId, listener) {
    const element = document.getElementById(elementId);
    if (element) {
      element.addEventListener("click", listener);
    }
  }

  function init() {
    if (initialized) {
      return;
    }
    initialized = true;

    window.tooltipManager.init();
    window.consoleManager.init();
    window.workspaceManager.init();
    window.debugTraceManager.init();
    window.activeFile.init();
    window.fileTreeUI.init();
    window.fileManager.init();
    window.effectCodeManager.init();

    bindClick("toggleFileList", window.fileManager.toggleFileListCollapsed);
    bindClick("newFile", window.fileManager.createNewFile);
    bindClick("newFolder", window.fileManager.createNewFolder);
    bindClick("runEditorScript", window.editorManager.runScript);

    window.editorManager.init();
    window.momentumPluginBridge.init();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
