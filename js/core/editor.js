// Editor management module
window.editorManager = (function () {
  let editor;
  let validationMarkers = [];
  let validationTimer = null;
  const MARKER_OWNER = "momentum-compiler";
  const VALIDATION_DELAY = 250;

  function getCompiler() {
    return typeof window.sketchCompiler !== "undefined"
      ? window.sketchCompiler
      : null;
  }

  function getMarkerSeverity(severity) {
    if (typeof monaco === "undefined" || !monaco.MarkerSeverity) {
      return 8;
    }

    if (!severity) {
      return monaco.MarkerSeverity.Error;
    }

    if (severity === "warning") {
      return monaco.MarkerSeverity.Warning;
    }

    if (severity === "info") {
      return monaco.MarkerSeverity.Info;
    }

    return monaco.MarkerSeverity.Error;
  }

  function getDiagnosticPosition(diagnostic) {
    const loc = diagnostic && diagnostic.loc ? diagnostic.loc : null;
    const line = loc && typeof loc.line === "number" ? loc.line : 1;
    const column = loc && typeof loc.column === "number" ? loc.column + 1 : 1;

    return {
      startLineNumber: line,
      startColumn: column,
      endLineNumber: line,
      endColumn: column + 1,
    };
  }

  function formatDiagnosticMessage(diagnostic) {
    if (!diagnostic) {
      return "Unknown compiler error";
    }

    const phase = diagnostic.phase ? `[${diagnostic.phase}] ` : "";
    return `${phase}${diagnostic.message || "Unknown compiler error"}`;
  }

  function toMarker(diagnostic) {
    const position = getDiagnosticPosition(diagnostic);

    return {
      startLineNumber: position.startLineNumber,
      startColumn: position.startColumn,
      endLineNumber: position.endLineNumber,
      endColumn: position.endColumn,
      message: formatDiagnosticMessage(diagnostic),
      severity: getMarkerSeverity(diagnostic && diagnostic.severity),
      source: "compiler",
      code: diagnostic && diagnostic.code ? String(diagnostic.code) : undefined,
    };
  }

  function applyValidationMarkers(diagnostics) {
    if (!editor || typeof monaco === "undefined") {
      return [];
    }

    const model = editor.getModel();
    if (!model) {
      return [];
    }

    validationMarkers = (Array.isArray(diagnostics) ? diagnostics : []).map(toMarker);
    monaco.editor.setModelMarkers(model, MARKER_OWNER, validationMarkers);
    return validationMarkers;
  }

  function diagnoseCode(code) {
    const compiler = getCompiler();
    if (!compiler || typeof compiler.diagnose !== "function") {
      applyValidationMarkers([]);
      return {
        ok: true,
        diagnostics: [],
      };
    }

    try {
      const result = compiler.diagnose(code);
      applyValidationMarkers(result && result.diagnostics ? result.diagnostics : []);
      return result;
    } catch (error) {
      const fallbackDiagnostic = {
        code: "COMPILER_INTERNAL_ERROR",
        message: error && error.message ? error.message : "Compiler validation failed",
        severity: "error",
        phase: "diagnose",
        fatal: true,
        loc: { line: 1, column: 0 },
      };
      applyValidationMarkers([fallbackDiagnostic]);
      return {
        ok: false,
        diagnostics: [fallbackDiagnostic],
      };
    }
  }

  function validateCurrentModel() {
    if (!editor) {
      return null;
    }

    return diagnoseCode(editor.getValue());
  }

  function scheduleValidation() {
    if (validationTimer) {
      clearTimeout(validationTimer);
    }

    validationTimer = setTimeout(() => {
      validationTimer = null;
      validateCurrentModel();
    }, VALIDATION_DELAY);
  }

  function hasFatalDiagnostics(result) {
    if (!result || !Array.isArray(result.diagnostics)) {
      return false;
    }

    return result.diagnostics.some((diagnostic) => {
      return diagnostic && diagnostic.fatal !== false && diagnostic.severity !== "warning";
    });
  }

  function formatDiagnosticForConsole(diagnostic) {
    if (!diagnostic) {
      return "Unknown compiler error";
    }

    const loc =
      diagnostic.loc && typeof diagnostic.loc.line === "number"
        ? ` (${diagnostic.loc.line}:${(diagnostic.loc.column || 0) + 1})`
        : "";
    const phase = diagnostic.phase ? `[${diagnostic.phase}] ` : "";
    return `${phase}${diagnostic.message || "Unknown compiler error"}${loc}`;
  }

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

      editor.onDidChangeModelContent(() => {
        scheduleValidation();
      });

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
          validateCurrentModel();
        }
      }, 100);
    });
  }

  // Run script in the editor
  function runScript() {
    const code = editor.getValue();
    const fileName = window.fileManager.getCurrentFileName && window.fileManager.getCurrentFileName();
    const validationResult = diagnoseCode(code);

    document.getElementById("console-output").innerHTML = ""; // Clear previous output
    if (hasFatalDiagnostics(validationResult)) {
      const primaryDiagnostic = (validationResult.diagnostics || []).find(
        (diagnostic) => diagnostic && diagnostic.severity !== "warning",
      );
      if (primaryDiagnostic) {
        console.error(
          "Compile error:",
          formatDiagnosticForConsole(primaryDiagnostic),
        );
      }
      return;
    }

    window.codeExecutor
      .executeUserCode(code, fileName)
      .catch((error) =>
        console.error(
          "Execution error:",
          error && error.message ? error.message : String(error),
        ),
      );
  }

  return {
    diagnoseCode,
    initEditor,
    runScript,
    editor: null,
  };
})();
