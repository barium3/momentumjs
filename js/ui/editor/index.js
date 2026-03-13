// Public editor entry point that exposes the singleton manager.
if (
  !window.editorManager &&
  window.momentumEditorManagerFactory &&
  typeof window.momentumEditorManagerFactory.createManager === "function"
) {
  window.editorManager = window.momentumEditorManagerFactory.createManager();
}
