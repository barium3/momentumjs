window.momentumEditorValidation = (function () {
  const MARKER_OWNER = "momentum-compiler";

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

  function createController(options) {
    const getEditor = options.getEditor;
    let validationMarkers = [];
    let validationTimer = null;
    const validationDelay = typeof options.validationDelay === "number" ? options.validationDelay : 250;

    function applyValidationMarkers(diagnostics) {
      const editor = getEditor();
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
      const editor = getEditor();
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
      }, validationDelay);
    }

    return {
      applyValidationMarkers,
      diagnoseCode,
      scheduleValidation,
      validateCurrentModel,
    };
  }

  return {
    createController,
    formatDiagnosticMessage,
  };
})();
