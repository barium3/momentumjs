window.momentumEditorManagerFactory = (function () {
  const INDENT_CORRECTION_TRIGGER_CHARS = {
    ";": true,
    "}": true,
  };
  const DEFAULT_INDENT_SIZE = 2;

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

  function defineTheme() {
    monaco.editor.defineTheme("rsms-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "#888888" },
        { token: "meta.keyword", foreground: "#85ad99" },
        { token: "meta.variable", foreground: "#6c9380" },
        { token: "meta.annotation", foreground: "#6c9380" },
        { token: "delimiter", foreground: "#ffffff66" },
        { token: "delimiter.bracket", foreground: "#ffffff66" },
        { token: "type", foreground: "#f7ac6e" },
        { token: "type.identifier", foreground: "#ffab66" },
        { token: "keyword", foreground: "#94b3d1" },
        { token: "keyword.operator", foreground: "#ffc799" },
        {
          token: "identifier.function",
          foreground: "#ffffff",
          fontStyle: "bold",
        },
        { token: "string", foreground: "#94d1b3" },
        { token: "constant", foreground: "#94d1b3" },
        { token: "number", foreground: "#94d1b3" },
        { token: "regexp", foreground: "#3399ff" },
        { token: "tag", foreground: "#ffffff66" },
        { token: "tag.attribute.name", foreground: "#ffab66" },
        { token: "invalid", foreground: "#ff1500" },
      ],
      colors: {
        "editor.foreground": "#ffffffcc",
        "editor.background": "#1a1a19",
        "editorCursor.foreground": "#e8e3da",
        "editor.selectionBackground": "#66c2ff4c",
        "editor.inactiveSelectionBackground": "#b3b3b333",
        "diffEditor.insertedLineBackground": "#00db6e80",
        "diffEditor.removedLineBackground": "#ff150080",
        "editorIndentGuide.background": "#ffffff0f",
        "editorIndentGuide.activeBackground": "#ffffff0f",
        "editor.findMatchHighlightBackground": "#66c2ff66",
        "editor.findMatchBackground": "#ffff00",
        "editorError.foreground": "#ff5b4d",
        "editorWarning.foreground": "#ffff00",
        "editorBracketMatch.background": "#f76ec9",
        "editorBracketMatch.border": "#00000000",
        "scrollbar.shadow": "#f76ec977",
      },
    });
  }

  function createManager() {
    let editor = null;
    let isAutoFormatting = false;
    let isApplyingIndentCorrection = false;
    let isRunEnabled = false;
    const validation = window.momentumEditorValidation.createController({
      getEditor: () => editor,
      validationDelay: 250,
    });
    const autocomplete = window.momentumEditorAutocomplete.createController();
    const interactions = window.momentumEditorInteractions.createController({
      getEditor: () => editor,
      canRunScript: () => isRunEnabled,
      runScript: () => runScript(),
    });

    function getRunButton() {
      return document.getElementById("runEditorScript");
    }

    function setRunEnabled(enabled) {
      isRunEnabled = !!enabled;

      const runButton = getRunButton();
      if (!runButton) {
        return;
      }

      runButton.hidden = !isRunEnabled;
      runButton.disabled = !isRunEnabled;
    }

    function getIndentUnit() {
      const model = editor && typeof editor.getModel === "function" ? editor.getModel() : null;
      const options = model && typeof model.getOptions === "function" ? model.getOptions() : null;
      const tabSize = options && typeof options.tabSize === "number" ? options.tabSize : 2;
      const insertSpaces =
        !options || typeof options.insertSpaces !== "boolean" ? true : options.insertSpaces;
      return insertSpaces ? " ".repeat(Math.max(1, tabSize)) : "\t";
    }

    function buildIndentString(level) {
      if (!level || level < 0) {
        return "";
      }

      return getIndentUnit().repeat(level);
    }

    function countBraceDepthBeforeLine(model, lineNumber) {
      let depth = 0;
      let inBlockComment = false;
      let inString = null;
      let escaping = false;

      for (let currentLine = 1; currentLine < lineNumber; currentLine += 1) {
        const content = model.getLineContent(currentLine);
        for (let index = 0; index < content.length; index += 1) {
          const char = content.charAt(index);
          const nextChar = content.charAt(index + 1);

          if (inBlockComment) {
            if (char === "*" && nextChar === "/") {
              inBlockComment = false;
              index += 1;
            }
            continue;
          }

          if (inString) {
            if (escaping) {
              escaping = false;
              continue;
            }

            if (char === "\\") {
              escaping = true;
              continue;
            }

            if (char === inString) {
              inString = null;
            }
            continue;
          }

          if (char === "/" && nextChar === "/") {
            break;
          }

          if (char === "/" && nextChar === "*") {
            inBlockComment = true;
            index += 1;
            continue;
          }

          if (char === "'" || char === '"' || char === "`") {
            inString = char;
            continue;
          }

          if (char === "{") {
            depth += 1;
            continue;
          }

          if (char === "}") {
            depth = Math.max(0, depth - 1);
          }
        }
      }

      return depth;
    }

    function getPreviousSignificantLine(model, lineNumber) {
      for (let currentLine = lineNumber - 1; currentLine >= 1; currentLine -= 1) {
        const trimmed = model.getLineContent(currentLine).trim();
        if (trimmed) {
          return {
            lineNumber: currentLine,
            trimmed,
          };
        }
      }

      return null;
    }

    function isSingleLineControlHeader(trimmed) {
      if (!trimmed) {
        return false;
      }

      if (/[{;}]$/.test(trimmed)) {
        return false;
      }

      return /^(if\b.*|else\b(?:\s+if\b.*)?|for\b.*|while\b.*|do\b|catch\b.*|finally\b)$/.test(
        trimmed,
      );
    }

    function getExpectedIndentLevel(model, lineNumber) {
      const content = model.getLineContent(lineNumber);
      const trimmed = content.trim();
      const isBlankLine = trimmed.length === 0;

      let depth = countBraceDepthBeforeLine(model, lineNumber);

      if (!isBlankLine && /^[}\])]/.test(trimmed)) {
        depth = Math.max(0, depth - 1);
      }

      if (!isBlankLine && /^(case\b|default\b)/.test(trimmed)) {
        depth = Math.max(0, depth - 1);
      }

      const previousLine = getPreviousSignificantLine(model, lineNumber);
      if (previousLine) {
        if (/^(case\b|default\b)/.test(previousLine.trimmed) && /:\s*$/.test(previousLine.trimmed)) {
          depth += 1;
        } else if (isSingleLineControlHeader(previousLine.trimmed)) {
          depth += 1;
        }
      }

      return depth;
    }

    function correctCurrentLineIndentation() {
      if (isApplyingIndentCorrection || isAutoFormatting || !editor) {
        return;
      }

      const model = editor.getModel();
      const selection =
        typeof editor.getSelection === "function" ? editor.getSelection() : null;
      if (!model || !selection || !selection.isEmpty()) {
        return;
      }

      const lineNumber = selection.positionLineNumber;
      const content = model.getLineContent(lineNumber);

      const expectedIndentLevel = getExpectedIndentLevel(model, lineNumber);
      if (expectedIndentLevel === null) {
        return;
      }

      const currentIndentMatch = content.match(/^(\s*)/);
      const currentIndent = currentIndentMatch ? currentIndentMatch[1] : "";
      const expectedIndent = buildIndentString(expectedIndentLevel);

      if (currentIndent === expectedIndent) {
        return;
      }

      const indentDelta = expectedIndent.length - currentIndent.length;
      const nextColumn = Math.max(1, selection.positionColumn + indentDelta);

      isApplyingIndentCorrection = true;
      editor.executeEdits(
        "auto-indent-correction",
        [
          {
            range: new monaco.Range(lineNumber, 1, lineNumber, currentIndent.length + 1),
            text: expectedIndent,
          },
        ],
        [
          new monaco.Selection(
            lineNumber,
            nextColumn,
            lineNumber,
            nextColumn,
          ),
        ],
      );
      isApplyingIndentCorrection = false;
    }

    function scheduleIndentCorrection() {
      setTimeout(() => {
        correctCurrentLineIndentation();
      }, 0);
    }

    function changeTextContainsIndentTrigger(text) {
      if (!text) {
        return false;
      }

      return text.indexOf("}") !== -1 || text.indexOf(";") !== -1 || text.indexOf("\n") !== -1;
    }

    function shouldCorrectIndentFromChangeEvent(event) {
      if (!event || event.isFlush || event.isUndoing || event.isRedoing) {
        return false;
      }

      if (!Array.isArray(event.changes) || !event.changes.length) {
        return false;
      }

      return event.changes.some((change) => {
        if (!change) {
          return false;
        }

        return changeTextContainsIndentTrigger(change.text);
      });
    }

    function canAutoFormatCurrentModel() {
      if (!editor || typeof editor.getAction !== "function") {
        return false;
      }

      const model = typeof editor.getModel === "function" ? editor.getModel() : null;
      if (!model || typeof model.getLanguageId !== "function") {
        return false;
      }

      if (model.getLanguageId() !== "javascript") {
        return false;
      }

      const formatAction = editor.getAction("editor.action.formatDocument");
      return !!(formatAction && typeof formatAction.run === "function");
    }

    function formatDocument(options) {
      const formatOptions = options || {};
      if (isAutoFormatting || !canAutoFormatCurrentModel()) {
        return Promise.resolve(false);
      }

      const formatAction = editor.getAction("editor.action.formatDocument");
      isAutoFormatting = true;
      return Promise.resolve(formatAction.run())
        .then(() => true)
        .catch(() => {})
        .finally(() => {
          isAutoFormatting = false;
          if (formatOptions.restoreFocus !== false && editor && typeof editor.focus === "function") {
            editor.focus();
          }
        });
    }

    function initEditor() {
      require.config({
        paths: {
          vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.30.1/min/vs",
        },
      });

      require(["vs/editor/editor.main"], function () {
        autocomplete.configure();
        defineTheme();

        editor = monaco.editor.create(document.getElementById("editor"), {
          value: "",
          language: "javascript",
          theme: "rsms-dark",
          autoIndent: "full",
          detectIndentation: false,
          formatOnPaste: true,
          formatOnType: true,
          insertSpaces: true,
          minimap: { enabled: false },
          tabSize: DEFAULT_INDENT_SIZE,
          wordBasedSuggestions: false,
          scrollbar: {
            vertical: "visible",
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
        });

        manager.editor = editor;
        window.dispatchEvent(new CustomEvent("momentum:editor-ready"));

        editor.onDidChangeModelContent((event) => {
          validation.scheduleValidation();
          if (shouldCorrectIndentFromChangeEvent(event)) {
            scheduleIndentCorrection();
          }
        });

        editor.onDidType((text) => {
          if (
            !text ||
            (!INDENT_CORRECTION_TRIGGER_CHARS[text] && !changeTextContainsIndentTrigger(text))
          ) {
            return;
          }

          scheduleIndentCorrection();
        });

        editor.onDidChangeCursorSelection(() => {
          interactions.rememberNonEmptySelections(editor.getSelections() || []);
        });

        editor.onDidFocusEditorWidget(() => {
          setTimeout(() => {
            interactions.attachInputAreaSelectHandler();
          }, 0);
        });

        interactions.bindWindowShortcuts();
        window.addEventListener("resize", () => editor && editor.layout());

        setTimeout(() => {
          if (editor) {
            interactions.attachInputAreaSelectHandler();
            editor.layout();
            validation.validateCurrentModel();
          }
        }, 100);
      });
    }

    function runScript() {
      if (!isRunEnabled) {
        return Promise.resolve(false);
      }

      return formatDocument()
        .catch(() => false)
        .then(() => {
          const code = editor.getValue();
          const fileName = window.fileManager.getCurrentFileName && window.fileManager.getCurrentFileName();
          const validationResult = validation.diagnoseCode(code);

          document.getElementById("console-output").innerHTML = "";
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

          return window.codeExecutor
            .executeUserCode(code, fileName)
            .catch((error) =>
              console.error(
                "Execution error:",
                error && error.message ? error.message : String(error),
              ),
            );
        });
    }

    const manager = {
      diagnoseCode: validation.diagnoseCode,
      formatDocument,
      initEditor,
      isRunEnabled: () => isRunEnabled,
      runScript,
      setRunEnabled,
      toggleLineComments: interactions.toggleLineComments,
      editor: null,
    };

    return manager;
  }

  return {
    createManager,
  };
})();
