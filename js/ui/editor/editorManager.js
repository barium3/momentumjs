// Coordinates the editor surface, validation, execution, and temporary modes.
window.editorManager = (function () {
  const CodeBundle = window.momentumCodeBundle;
  const INDENT_CORRECTION_TRIGGER_CHARS = {
    ";": true,
    "}": true,
  };
  const RENDER_MODE_STORAGE_KEY = "momentum.renderMode";
  const RENDER_MODE_POINTER_FOCUS_CLASS = "render-mode-pointer-focus";
  const DEFAULT_RENDER_MODE = "vector";

  function extractRunTargetName(code, fallbackName) {
    const fileNameRegex = /\/\/\s*@filename[:\s]*([^\n]+)/;
    const match = String(code || "").match(fileNameRegex);
    if (match && match[1]) {
      return match[1].trim();
    }
    return fallbackName || "New Composition";
  }

    function createManager() {
      let editor = null;
      let validation = null;
    let isAutoFormatting = false;
    let isApplyingIndentCorrection = false;
    let isRunEnabled = false;
    let renderMode = "vector";
    let activeTemporaryModeLease = null;
    let initializationPromise = null;
    const interactions = window.momentumEditorInteractions.createController({
      getEditor: () => editor,
      canRunScript: () => isRunEnabled && !window.effectCodeManager.isActive(),
      runScript: () => runScript(),
    });

    function getRunButton() {
      return document.getElementById("runEditorScript");
    }

    function getRenderModeSelect() {
      return document.getElementById("renderModeSelect");
    }

    function syncRenderModeSelect() {
      const select = getRenderModeSelect();
      if (!select) {
        return;
      }

      select.value = renderMode;
    }

    function syncEffectiveRenderModeSelect(mode) {
      const select = getRenderModeSelect();
      if (!select) {
        return;
      }

      select.value = normalizeRenderMode(mode);
    }

    function normalizeRenderMode(mode) {
      if (mode === "bitmap") {
        return "bitmap";
      }
      if (mode === "vector") {
        return "vector";
      }
      return "vector";
    }

    function setRenderMode(mode) {
      renderMode = normalizeRenderMode(mode);

      if (renderMode !== "bitmap") {
        window.debugTraceManager.stopAndClear();
      }

      try {
        window.localStorage.setItem(RENDER_MODE_STORAGE_KEY, renderMode);
      } catch (_ignore) {}

      syncRenderModeSelect();
    }

    function getRenderMode() {
      return renderMode;
    }

    function initRenderMode() {
      let savedMode = DEFAULT_RENDER_MODE;

      try {
        savedMode =
          window.localStorage.getItem(RENDER_MODE_STORAGE_KEY) ||
          DEFAULT_RENDER_MODE;
      } catch (_ignore) {}

      setRenderMode(savedMode);

      const select = getRenderModeSelect();
      if (!select) {
        return;
      }

      select.addEventListener("change", (event) => {
        setRenderMode(event && event.target ? event.target.value : "vector");
      });
      select.addEventListener("mousedown", () => {
        select.classList.add(RENDER_MODE_POINTER_FOCUS_CLASS);
      });
      select.addEventListener("blur", () => {
        select.classList.remove(RENDER_MODE_POINTER_FOCUS_CLASS);
      });
    }

    function detectBitmapRequirements(code) {
      try {
        return window.momentumRuntimeCapabilities.detectBitmapRequirements(code);
      } catch (_ignore) {
        return {
          requiresBitmap: false,
          functions: [],
        };
      }
    }

    function getEffectiveRenderModeInfo(code) {
      const requirements = detectBitmapRequirements(code);
      const requiredMode =
        requirements && requirements.requiresBitmap ? "bitmap" : null;
      const effectiveMode = normalizeRenderMode(requiredMode || renderMode);

      return {
        requirements,
        requiredMode,
        effectiveMode,
      };
    }

    function syncRuntimeModeUI(code) {
      const info = getEffectiveRenderModeInfo(code);
      syncEffectiveRenderModeSelect(info.effectiveMode);
      return info;
    }

    function reportRuntimeModeSwitch(info, selectedMode) {
      const normalizedSelectedMode = normalizeRenderMode(selectedMode);
      if (
        !info ||
        info.effectiveMode !== "bitmap" ||
        !info.requiredMode ||
        normalizedSelectedMode === info.effectiveMode
      ) {
        return;
      }

      const functions =
        info.requirements && Array.isArray(info.requirements.functions)
          ? info.requirements.functions
          : [];
      const detail = functions.length ? ` ${functions.join(", ")}` : "";
      console.warn(
        `Render mode switched to Bitmap because Vector mode does not support${detail}.`,
      );
    }

    function setRunEnabled(enabled) {
      isRunEnabled = !!enabled;

      const runButton = getRunButton();
      if (!runButton) {
        return;
      }

      runButton.hidden = !isRunEnabled;
      runButton.disabled = !isRunEnabled;
      const renderModeSelect = getRenderModeSelect();
      if (renderModeSelect) {
        renderModeSelect.hidden = !isRunEnabled;
        renderModeSelect.disabled = !isRunEnabled;
      }
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

    function diagnoseCode(code) {
      return validation.diagnoseCode(code);
    }

    function initEditor() {
      const surfaceFactory = window.momentumEditorSurface;
      return surfaceFactory.create({
        container: document.getElementById("editor"),
        modelUri: "inmemory://momentum/workspace/current.js",
        editorOptions: {
          value: "",
          language: "javascript",
        },
        validationDelay: 250,
      }).then((surface) => {
        editor = surface.editor;
        validation = surface.validation;

        manager.editor = editor;
        window.dispatchEvent(new CustomEvent("momentum:editor-ready"));

        editor.onDidChangeModelContent((event) => {
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
            interactions.attachInputAreaHandlers();
          }, 0);
        });

        interactions.bindWindowShortcuts();

        setTimeout(() => {
          if (editor) {
            interactions.attachInputAreaHandlers();
          }
        }, 100);
        return editor;
      }).catch((error) => {
        console.error(
          "Editor initialization error:",
          error && error.message ? error.message : String(error),
        );
        return null;
      });
    }

    function runVectorScript(code, fileName) {
      return window.codeExecutor.executeUserCode(code, fileName).catch((error) =>
        console.error(
          "Execution error:",
          error && error.message ? error.message : String(error),
        ),
      );
    }

    function parseApplyMomentumResult(rawValue) {
      return window.momentumPluginBitmap.parseApplyMomentumResult(rawValue);
    }

    function reportApplyMomentumWarnings(result) {
      return window.momentumPluginBitmap.reportApplyMomentumWarnings(result);
    }

    function runBitmapScript(code, fileName) {
      const canonicalSource = CodeBundle.normalizeSource(code);
      const bitmapRuntimeCode = CodeBundle.normalizeSource(
        window.momentumPluginAsset.absolutizeBitmapAssetCalls(canonicalSource),
      );
      const compiled = window.sketchCompiler.compile(canonicalSource);

      if (!compiled || !compiled.ok) {
        const primaryDiagnostic = CodeBundle.getPrimaryDiagnostic(compiled);
        if (primaryDiagnostic) {
          console.error(
            "Compile error:",
            CodeBundle.formatDiagnostic(primaryDiagnostic),
          );
        }
        return Promise.resolve(false);
      }

      const runtimeControllerPromise =
        window.codeExecutor.discoverBitmapControllers(
          canonicalSource,
          compiled,
        );

      return Promise.resolve(runtimeControllerPromise)
        .catch(() => [])
        .then((runtimeControllerConfigs) => {
          const bundle = CodeBundle.buildRuntimeBundle(
            bitmapRuntimeCode,
            compiled,
            extractRunTargetName(canonicalSource, fileName || "New Composition"),
            runtimeControllerConfigs,
          );
          return window.momentumPluginBitmap.applyRuntimeBundle(
            bundle,
            bitmapRuntimeCode,
          );
        })
        .then((applyResultText) => {
          const applyResult = parseApplyMomentumResult(applyResultText);
          reportApplyMomentumWarnings(applyResult);
          if (
            applyResult &&
            applyResult.debugTracePath
          ) {
            window.debugTraceManager.startSession({
              compId: applyResult.compId,
              filePath: applyResult.debugTracePath,
            });
          }
          return true;
        })
        .catch((error) => {
          console.error(
            "Bitmap execution error:",
            error && error.message ? error.message : String(error),
          );
          return false;
        });
    }

    function runScript() {
      if (
        !isRunEnabled ||
        window.effectCodeManager.isActive()
      ) {
        return Promise.resolve(false);
      }

      return formatDocument()
        .catch(() => false)
        .then(() => {
          const code = editor.getValue();
          const fileName = window.fileManager.getCurrentFileName();
          const selectedRenderMode = renderMode;
          window.debugTraceManager.stopAndClear();
          const runtimeModeInfo = syncRuntimeModeUI(code);
          const effectiveRenderMode = runtimeModeInfo.effectiveMode;
          if (effectiveRenderMode !== normalizeRenderMode(renderMode)) {
            setRenderMode(effectiveRenderMode);
          }
          const validationResult = diagnoseCode(code);
          if (CodeBundle.hasFatalDiagnostics(validationResult)) {
            const primaryDiagnostic = CodeBundle.getPrimaryDiagnostic(validationResult);
            if (primaryDiagnostic) {
              console.error(
                "Compile error:",
                CodeBundle.formatDiagnostic(primaryDiagnostic),
              );
            }
            return;
          }

          reportRuntimeModeSwitch(runtimeModeInfo, selectedRenderMode);

          if (effectiveRenderMode === "bitmap") {
            return runBitmapScript(code, fileName);
          }

          return runVectorScript(code, fileName);
        });
    }

    function acquireTemporaryMode(owner) {
      if (!editor || typeof editor.getModel !== "function") {
        throw new Error("The shared Momentum editor is unavailable.");
      }
      if (activeTemporaryModeLease) {
        throw new Error(
          `The Momentum editor is already assigned to ${activeTemporaryModeLease.owner}.`,
        );
      }

      const workspaceModel = editor.getModel();
      if (
        !workspaceModel ||
        (typeof workspaceModel.isDisposed === "function" &&
          workspaceModel.isDisposed())
      ) {
        throw new Error("The shared Momentum workspace model is unavailable.");
      }

      const rawOptions = typeof editor.getRawOptions === "function"
        ? editor.getRawOptions()
        : {};
      const lease = {
        owner: String(owner || "temporary mode"),
        released: false,
        workspaceModel,
        workspaceReadOnly: !!rawOptions.readOnly,
        workspaceViewState: typeof editor.saveViewState === "function"
          ? editor.saveViewState()
          : null,
        attach(model) {
          if (lease.released || activeTemporaryModeLease !== lease) {
            throw new Error("The temporary editor mode is no longer active.");
          }
          if (
            !model ||
            (typeof model.isDisposed === "function" && model.isDisposed())
          ) {
            throw new Error("The temporary editor model is unavailable.");
          }
          editor.setModel(model);
        },
        release() {
          if (lease.released) {
            return true;
          }
          try {
            if (
              typeof workspaceModel.isDisposed === "function" &&
              workspaceModel.isDisposed()
            ) {
              throw new Error("The Momentum workspace model was disposed.");
            }
            if (editor.getModel() !== workspaceModel) {
              editor.setModel(workspaceModel);
            }
            if (
              lease.workspaceViewState &&
              typeof editor.restoreViewState === "function"
            ) {
              editor.restoreViewState(lease.workspaceViewState);
            }
            if (typeof editor.updateOptions === "function") {
              editor.updateOptions({ readOnly: lease.workspaceReadOnly });
            }
            return true;
          } finally {
            lease.released = true;
            if (activeTemporaryModeLease === lease) {
              activeTemporaryModeLease = null;
            }
          }
        },
      };
      activeTemporaryModeLease = lease;
      return lease;
    }

    function init() {
      if (initializationPromise) {
        return initializationPromise;
      }
      initRenderMode();
      setRunEnabled(false);
      initializationPromise = initEditor();
      return initializationPromise;
    }

    const manager = {
      acquireTemporaryMode,
      init,
      runScript,
      setRunEnabled,
      editor: null,
    };

    return manager;
  }

  return createManager();
})();
