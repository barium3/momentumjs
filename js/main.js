document.addEventListener("DOMContentLoaded", function () {
  window.consoleManager.initConsole();
  window.editorManager.initEditor();

  document
    .getElementById("newFile")
    .addEventListener("click", window.fileManager.createNewFile);

  document
    .getElementById("runEditorScript")
    .addEventListener("click", window.editorManager.runScript);

  // CSInterface already initialized in init.js
});
