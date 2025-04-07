// Editor management module
window.editorManager = (function () {
  let editor;

  function initEditor() {
    require.config({
      paths: {
        vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.30.1/min/vs",
      },
    });

    require(["vs/editor/editor.main"], function () {
      // Custom editor theme - RSMS VSCode Theme Dark
      monaco.editor.defineTheme("rsms-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "comment", foreground: "#888888" },
          { token: "meta.keyword", foreground: "#85ad99" },
          { token: "meta.variable", foreground: "#6c9380" },
          { token: "meta.annotation", foreground: "#6c9380" },

          // Punctuation
          { token: "delimiter", foreground: "#ffffff66" },
          { token: "delimiter.bracket", foreground: "#ffffff66" },

          // Types
          { token: "type", foreground: "#f7ac6e" },
          { token: "type.identifier", foreground: "#ffab66" },

          // Keywords
          { token: "keyword", foreground: "#94b3d1" },
          { token: "keyword.operator", foreground: "#ffc799" },

          // Functions
          {
            token: "identifier.function",
            foreground: "#ffffff",
            fontStyle: "bold",
          },

          // Data
          { token: "string", foreground: "#94d1b3" },
          { token: "constant", foreground: "#94d1b3" },
          { token: "number", foreground: "#94d1b3" },

          // Regular expressions
          { token: "regexp", foreground: "#3399ff" },

          // Tags
          { token: "tag", foreground: "#ffffff66" },
          { token: "tag.attribute.name", foreground: "#ffab66" },

          // Invalid
          { token: "invalid", foreground: "#ff1500" },
        ],
        colors: {
          "editor.foreground": "#ffffffcc",
          "editor.background": "#1a1a19",
          "editorCursor.foreground": "#f76ec9",

          // Selection
          "editor.selectionBackground": "#66c2ff4c",
          "editor.inactiveSelectionBackground": "#b3b3b333",

          // Diff editor
          "diffEditor.insertedLineBackground": "#00db6e80",
          "diffEditor.removedLineBackground": "#ff150080",

          // Indent guides
          "editorIndentGuide.background": "#ffffff0f",
          "editorIndentGuide.activeBackground": "#ffffff0f",

          // Decorations
          "editor.findMatchHighlightBackground": "#66c2ff66",
          "editor.findMatchBackground": "#ffff00",
          "editorWarning.foreground": "#ff5b4d",

          // Bracket matching - pure background color, no border
          "editorBracketMatch.background": "#f76ec9",
          "editorBracketMatch.border": "#00000000",

          "scrollbar.shadow": "#f76ec977",
        },
      });

      // Create editor
      editor = monaco.editor.create(document.getElementById("editor"), {
        value: "",
        language: "javascript",
        theme: "rsms-dark",
        minimap: { enabled: false },
        scrollbar: {
          vertical: "visible",
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
        },
      });

      // Expose editor object to the module
      window.editorManager.editor = editor;

      // Add cmd+/ shortcut functionality
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.US_SLASH,
        function () {
          editor.getAction("editor.action.commentLine").run();
        }
      );

      // Handle window resize
      window.addEventListener("resize", () => editor && editor.layout());

      // Set editor size adjustment
      setTimeout(() => {
        if (editor) {
          editor.layout();
        }
      }, 100);
    });
  }

  // Run script in the editor
  function runScript() {
    const code = editor.getValue();
    document.getElementById("console-output").innerHTML = ""; // Clear previous output
    window.codeExecutor
      .executeUserCode(code)
      .catch((error) => console.error("Error executing script:", error));
  }

  return {
    initEditor,
    runScript,
    editor: null,
  };
})();
