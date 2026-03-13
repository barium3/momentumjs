document.addEventListener("DOMContentLoaded", function () {
  window.consoleManager.initConsole();
  window.editorManager.initEditor();
  window.editorManager.setRunEnabled(false);
  window.fileManager.initializeDraftSession();

  document
    .getElementById("newFile")
    .addEventListener("click", window.fileManager.createNewFile);

  document
    .getElementById("saveFile")
    .addEventListener("click", window.fileManager.saveFile);

  document
    .getElementById("runEditorScript")
    .addEventListener("click", window.editorManager.runScript);
});
