// Owns editor input, shortcut, history, and CEP interaction routing.
window.momentumEditorInteractions = (function () {
  const SHORTCUT_FALLBACK_WINDOW_MS = 500;
  const SHORTCUT_INPUT_SUPPRESS_MS = 250;

  function createController(options) {
    const getEditor = options.getEditor;
    const canRunScript =
      typeof options.canRunScript === "function" ? options.canRunScript : null;
    const runScript =
      typeof options.runScript === "function" ? options.runScript : null;
    let inputAreaBeforeInputHandler = null;
    let inputAreaSelectHandler = null;
    let inputAreaKeydownHandler = null;
    let inputAreaKeyupHandler = null;
    let windowKeydownHandler = null;
    let windowModifierKeyupHandler = null;
    let windowCepKeydownHandler = null;
    let lastNonEmptySelections = null;
    let pendingImeMutation = null;
    let pendingCommandSnapshot = null;
    let suppressCommentInputUntil = 0;
    let suppressHistoryInputUntil = 0;
    let commandModifierActiveUntil = 0;
    let commandModifierPressed = false;
    let currentInputArea = null;
    let inputAreaWasReadOnly = false;
    let lastHandledShortcut = null;
    let lastNativeSelectAllFallbackTs = 0;

    function triggerEditorSelectAll(source) {
      const editor = getEditor();
      if (!editor) {
        return;
      }

      editor.focus();
      editor.trigger(source || "keyboard", "editor.action.selectAll");
    }

    function isEditorFocused() {
      const editor = getEditor();
      if (!editor) {
        return false;
      }

      // Monaco can keep reporting text/widget focus after keyboard ownership
      // has moved from the CEP panel back to an After Effects panel. CEP also
      // forwards the registered shortcuts globally, so trusting Monaco alone
      // can steal commands such as Select All from AE's timeline.
      if (
        typeof document.hasFocus === "function" &&
        !document.hasFocus()
      ) {
        return false;
      }

      if (typeof editor.hasTextFocus === "function" && editor.hasTextFocus()) {
        return true;
      }

      if (typeof editor.hasWidgetFocus === "function" && editor.hasWidgetFocus()) {
        return true;
      }

      const editorNode =
        typeof editor.getDomNode === "function" ? editor.getDomNode() : null;
      return !!(
        editorNode &&
        document.activeElement &&
        editorNode.contains(document.activeElement)
      );
    }

    function isCommentToggleShortcut(event) {
      if (!event || event.altKey) {
        return false;
      }

      if (!(event.metaKey || event.ctrlKey)) {
        return false;
      }

      return (
        event.key === "/" ||
        event.code === "Slash" ||
        event.keyCode === 191 ||
        event.which === 191
      );
    }

    function isSelectAllShortcut(event) {
      if (!event || event.altKey || event.shiftKey) {
        return false;
      }

      if (!(event.metaKey || event.ctrlKey)) {
        return false;
      }

      return (
        event.key === "a" ||
        event.key === "A" ||
        event.code === "KeyA" ||
        event.keyCode === 65 ||
        event.which === 65
      );
    }

    function shouldTreatInputAreaSelectAsSelectAll(inputArea) {
      if (!inputArea || !isEditorFocused()) {
        return false;
      }

      const withinCommandWindow =
        commandModifierPressed || Date.now() <= commandModifierActiveUntil;
      if (!withinCommandWindow) {
        return false;
      }

      const valueLength =
        typeof inputArea.value === "string" ? inputArea.value.length : 0;
      if (valueLength <= 0) {
        return false;
      }

      return (
        inputArea.selectionStart === 0 &&
        inputArea.selectionEnd === valueLength
      );
    }

    function createEditorSnapshot() {
      const editor = getEditor();
      return {
        timestamp: Date.now(),
        value: editor && typeof editor.getValue === "function" ? editor.getValue() : "",
        selections: cloneSelections(getCurrentSelections()),
      };
    }

    function normalizeKeyboardLikeEvent(input) {
      if (!input) {
        return null;
      }

      return {
        key: typeof input.key === "string" ? input.key : "",
        code: typeof input.code === "string" ? input.code : "",
        keyCode: typeof input.keyCode === "number" ? input.keyCode : 0,
        which: typeof input.which === "number" ? input.which : 0,
        metaKey: !!input.metaKey,
        ctrlKey: !!input.ctrlKey,
        shiftKey: !!input.shiftKey,
        altKey: !!input.altKey,
        defaultPrevented: !!input.defaultPrevented,
        isComposing: !!input.isComposing,
      };
    }

    function getShortcutSignature(event) {
      const normalized = normalizeKeyboardLikeEvent(event);
      if (!normalized) {
        return "";
      }

      return [
        normalized.metaKey ? "M" : "",
        normalized.ctrlKey ? "C" : "",
        normalized.shiftKey ? "S" : "",
        normalized.altKey ? "A" : "",
        normalized.code || normalized.key || normalized.keyCode,
      ].join(":");
    }

    function rememberHandledShortcut(event) {
      lastHandledShortcut = {
        signature: getShortcutSignature(event),
        ts: Date.now(),
      };
    }

    function wasRecentlyHandled(event, windowMs) {
      if (!lastHandledShortcut) {
        return false;
      }

      const maxAge = typeof windowMs === "number" ? windowMs : 80;
      return (
        lastHandledShortcut.signature === getShortcutSignature(event) &&
        Date.now() - lastHandledShortcut.ts <= maxAge
      );
    }

    function markCommentInputSuppressed() {
      suppressCommentInputUntil = Date.now() + SHORTCUT_INPUT_SUPPRESS_MS;
    }

    function shouldSuppressCommentInput() {
      return Date.now() <= suppressCommentInputUntil;
    }

    function markHistoryInputSuppressed() {
      suppressHistoryInputUntil = Date.now() + SHORTCUT_INPUT_SUPPRESS_MS;
    }

    function shouldSuppressHistoryInput() {
      return Date.now() <= suppressHistoryInputUntil;
    }

    function lockInputAreaForCommandShortcut() {
      if (!currentInputArea) {
        return;
      }

      if (currentInputArea.readOnly) {
        return;
      }

      inputAreaWasReadOnly = !!currentInputArea.readOnly;
      currentInputArea.readOnly = true;
    }

    function unlockInputAreaForCommandShortcut() {
      if (!currentInputArea) {
        return;
      }

      if (currentInputArea.readOnly === !!inputAreaWasReadOnly) {
        return;
      }

      currentInputArea.readOnly = inputAreaWasReadOnly;
    }

    function setCommandModifierPressed(isPressed) {
      const nextPressed = !!isPressed;
      if (commandModifierPressed === nextPressed) {
        return;
      }

      commandModifierPressed = nextPressed;

      if (commandModifierPressed) {
        lockInputAreaForCommandShortcut();
      } else {
        unlockInputAreaForCommandShortcut();
      }
    }

    function rememberCommandModifier(event) {
      if (!event) {
        return;
      }

      const key = typeof event.key === "string" ? event.key : "";
      const code = typeof event.code === "string" ? event.code : "";
      const isModifierKey =
        key === "Meta" ||
        key === "Control" ||
        code === "MetaLeft" ||
        code === "MetaRight" ||
        code === "ControlLeft" ||
        code === "ControlRight";

      if (event.metaKey || event.ctrlKey || isModifierKey) {
        setCommandModifierPressed(true);

        if (
          !pendingCommandSnapshot ||
          Date.now() - pendingCommandSnapshot.timestamp > SHORTCUT_INPUT_SUPPRESS_MS
        ) {
          pendingCommandSnapshot = createEditorSnapshot();
        }

        commandModifierActiveUntil = Date.now() + SHORTCUT_INPUT_SUPPRESS_MS;
      }
    }

    function shouldSuppressCommandModifierInput(event) {
      return !!event && (commandModifierPressed || Date.now() <= commandModifierActiveUntil);
    }

    function releaseCommandModifierIfNeeded(event) {
      if (!event) {
        return;
      }

      const key = typeof event.key === "string" ? event.key : "";
      const code = typeof event.code === "string" ? event.code : "";
      const isModifierKey =
        key === "Meta" ||
        key === "Control" ||
        code === "MetaLeft" ||
        code === "MetaRight" ||
        code === "ControlLeft" ||
        code === "ControlRight";

      if (!isModifierKey && (event.metaKey || event.ctrlKey)) {
        return;
      }

      if (!event.metaKey && !event.ctrlKey) {
        setCommandModifierPressed(false);
      }
    }

    function consumeCommandSnapshot() {
      if (!pendingCommandSnapshot) {
        return null;
      }

      if (Date.now() - pendingCommandSnapshot.timestamp > SHORTCUT_INPUT_SUPPRESS_MS) {
        pendingCommandSnapshot = null;
        return null;
      }

      const snapshot = pendingCommandSnapshot;
      pendingCommandSnapshot = null;
      return snapshot;
    }

    function isSnapshotDifferentFromCurrent(snapshot) {
      if (!snapshot) {
        return false;
      }

      const editor = getEditor();
      const currentValue = editor && typeof editor.getValue === "function" ? editor.getValue() : "";
      return currentValue !== (snapshot.value || "");
    }

    function restoreSnapshotSelections(snapshot) {
      const editor = getEditor();
      if (
        !editor ||
        !snapshot ||
        !Array.isArray(snapshot.selections) ||
        !snapshot.selections.length ||
        typeof editor.setSelections !== "function"
      ) {
        return;
      }

      editor.focus();
      editor.setSelections(snapshot.selections);
    }

    function unwindUnexpectedMutation(snapshot, callback, attemptsLeft) {
      const remainingAttempts = typeof attemptsLeft === "number" ? attemptsLeft : 4;

      if (!snapshot || !isSnapshotDifferentFromCurrent(snapshot)) {
        restoreSnapshotSelections(snapshot);
        callback();
        return;
      }

      if (remainingAttempts <= 0) {
        restoreSnapshotSelections(snapshot);
        callback();
        return;
      }

      runEditorHistoryAction("undo");
      setTimeout(() => {
        unwindUnexpectedMutation(snapshot, callback, remainingAttempts - 1);
      }, 0);
    }

    function cloneSelections(selections) {
      if (!Array.isArray(selections) || !selections.length || typeof monaco === "undefined") {
        return [];
      }

      return selections.map((selection) => {
        return new monaco.Selection(
          selection.selectionStartLineNumber || selection.startLineNumber,
          selection.selectionStartColumn || selection.startColumn,
          selection.positionLineNumber || selection.endLineNumber,
          selection.positionColumn || selection.endColumn,
        );
      });
    }

    function hasNonEmptySelection(selections) {
      return Array.isArray(selections) && selections.some((selection) => selection && !selection.isEmpty());
    }

    function getCurrentSelections() {
      const editor = getEditor();
      if (!editor || typeof editor.getSelections !== "function") {
        return [];
      }

      return editor.getSelections() || [];
    }

    function rememberNonEmptySelections(selections) {
      if (!hasNonEmptySelection(selections)) {
        return;
      }

      lastNonEmptySelections = cloneSelections(selections);
    }

    function shouldCaptureImeMutation(event) {
      const editor = getEditor();
      return !!(
        editor &&
        event &&
        isEditorFocused() &&
        (event.inputType === "insertCompositionText" || event.inputType === "insertText")
      );
    }

    function captureImeMutation() {
      const editor = getEditor();
      if (!editor) {
        return;
      }

      const currentSelections = getCurrentSelections();
      let snapshotSelections = hasNonEmptySelection(currentSelections)
        ? currentSelections
        : lastNonEmptySelections;

      if (!Array.isArray(snapshotSelections) || !snapshotSelections.length) {
        snapshotSelections = getCurrentSelections();
      }

      pendingImeMutation = {
        timestamp: Date.now(),
        selections: cloneSelections(snapshotSelections),
      };
    }

    function consumeImeMutation() {
      if (!pendingImeMutation) {
        return null;
      }

      if (Date.now() - pendingImeMutation.timestamp > SHORTCUT_FALLBACK_WINDOW_MS) {
        pendingImeMutation = null;
        return null;
      }

      const fallback = pendingImeMutation;
      pendingImeMutation = null;
      return fallback;
    }

    function isUndoShortcut(event) {
      if (!event || event.altKey || event.shiftKey) {
        return false;
      }

      return !!(event.metaKey || event.ctrlKey) && (
        event.key === "z" ||
        event.key === "Z" ||
        event.code === "KeyZ" ||
        event.keyCode === 90 ||
        event.which === 90
      );
    }

    function isRedoShortcut(event) {
      if (!event || event.altKey) {
        return false;
      }

      const hasCommandModifier = !!(event.metaKey || event.ctrlKey);
      if (!hasCommandModifier) {
        return false;
      }

      const isShiftRedo = !!event.shiftKey && (
        event.key === "z" ||
        event.key === "Z" ||
        event.code === "KeyZ" ||
        event.keyCode === 90 ||
        event.which === 90
      );
      const isCtrlYRedo = !event.metaKey && !event.shiftKey && (
        event.key === "y" ||
        event.key === "Y" ||
        event.code === "KeyY" ||
        event.keyCode === 89 ||
        event.which === 89
      );

      return isShiftRedo || isCtrlYRedo;
    }

    function isRunShortcut(event) {
      if (!event || event.altKey || event.shiftKey) {
        return false;
      }

      return !!(event.metaKey || event.ctrlKey) && (
        event.key === "r" ||
        event.key === "R" ||
        event.code === "KeyR" ||
        event.keyCode === 82 ||
        event.which === 82
      );
    }

    function runEditorHistoryAction(actionId) {
      const editor = getEditor();
      if (!editor) {
        return;
      }

      editor.focus();
      editor.trigger("keyboard", actionId, null);
    }

    function runHistoryShortcut(actionId) {
      const editor = getEditor();
      if (!editor || !actionId) {
        return;
      }

      const commandSnapshot = consumeCommandSnapshot();
      const imeFallback = consumeImeMutation();
      const fallback = commandSnapshot || imeFallback;
      const shouldUndoImeMutation = isSnapshotDifferentFromCurrent(fallback);

      if (!shouldUndoImeMutation) {
        runEditorHistoryAction(actionId);
        return;
      }

      unwindUnexpectedMutation(fallback, function () {
        markHistoryInputSuppressed();
        runEditorHistoryAction(actionId);
      });
    }

    function handleHistoryShortcut(event) {
      if (wasRecentlyHandled(event)) {
        return true;
      }

      if (!isEditorFocused()) {
        return false;
      }

      let actionId = null;
      if (isUndoShortcut(event)) {
        actionId = "undo";
      } else if (isRedoShortcut(event)) {
        actionId = "redo";
      }

      if (!actionId) {
        return false;
      }

      event.preventDefault();
      event.stopPropagation();
      rememberHandledShortcut(event);
      markHistoryInputSuppressed();
      runHistoryShortcut(actionId);
      return true;
    }

    function runShortcut() {
      if (!runScript || (canRunScript && !canRunScript())) {
        return false;
      }

      runScript();
      return true;
    }

    function handleRunShortcut(event) {
      if (wasRecentlyHandled(event)) {
        return true;
      }

      if (!isRunShortcut(event)) {
        return false;
      }

      if (canRunScript && !canRunScript()) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }

      if (!isEditorFocused()) {
        return false;
      }

      event.preventDefault();
      event.stopPropagation();

      rememberHandledShortcut(event);
      runShortcut();
      return true;
    }

    function handleSelectAllShortcut(event, source) {
      if (wasRecentlyHandled(event)) {
        return true;
      }

      if (!isSelectAllShortcut(event) || !isEditorFocused()) {
        return false;
      }

      event.preventDefault();
      event.stopPropagation();
      rememberHandledShortcut(event);
      triggerEditorSelectAll(source || "keyboard");
      return true;
    }

    function getCommentTargetLineRange(selection) {
      if (!selection) {
        return null;
      }

      let startLineNumber = selection.startLineNumber;
      let endLineNumber = selection.endLineNumber;

      if (
        !selection.isEmpty() &&
        selection.endColumn === 1 &&
        endLineNumber > startLineNumber
      ) {
        endLineNumber -= 1;
      }

      return {
        startLineNumber,
        endLineNumber,
      };
    }

    function toggleLineComments(selectionsOverride) {
      const editor = getEditor();
      if (!editor || typeof monaco === "undefined") {
        return;
      }

      const model = editor.getModel();
      const selections = Array.isArray(selectionsOverride) && selectionsOverride.length
        ? selectionsOverride
        : getCurrentSelections();
      if (!model || !selections || !selections.length) {
        return;
      }

      const edits = [];

      selections.forEach((selection) => {
        const lineRange = getCommentTargetLineRange(selection);
        if (!lineRange) {
          return;
        }

        const lines = [];
        let shouldUncomment = true;

        for (let lineNumber = lineRange.startLineNumber; lineNumber <= lineRange.endLineNumber; lineNumber += 1) {
          const content = model.getLineContent(lineNumber);
          const indentMatch = content.match(/^(\s*)/);
          const indent = indentMatch ? indentMatch[1] : "";
          const trimmed = content.slice(indent.length);
          const isCommented = trimmed.startsWith("//");
          const isBlank = trimmed.length === 0;

          lines.push({
            lineNumber,
            indentLength: indent.length,
            isCommented,
            isBlank,
          });

          if (!isBlank && !isCommented) {
            shouldUncomment = false;
          }
        }

        lines.forEach((line) => {
          if (line.isBlank) {
            return;
          }

          if (shouldUncomment) {
            edits.push({
              range: new monaco.Range(
                line.lineNumber,
                line.indentLength + 1,
                line.lineNumber,
                line.indentLength + 3
              ),
              text: "",
            });
            return;
          }

          edits.push({
            range: new monaco.Range(
              line.lineNumber,
              line.indentLength + 1,
              line.lineNumber,
              line.indentLength + 1
            ),
            text: "//",
          });
        });
      });

      if (!edits.length) {
        return;
      }

      editor.pushUndoStop();
      editor.executeEdits("keyboard", edits);
      editor.pushUndoStop();
    }

    function runCommentToggle() {
      const editor = getEditor();
      if (!editor) {
        return;
      }

      const commandSnapshot = consumeCommandSnapshot();
      const imeFallback = consumeImeMutation();
      const fallback = commandSnapshot || imeFallback;
      if (!fallback || !hasNonEmptySelection(fallback.selections)) {
        toggleLineComments();
        return;
      }

      const applyFallbackSelection = function () {
        const currentEditor = getEditor();
        if (!currentEditor) {
          return;
        }

        currentEditor.focus();
        if (typeof currentEditor.setSelections === "function") {
          currentEditor.setSelections(fallback.selections);
        }
        toggleLineComments(fallback.selections);
      };

      if (isSnapshotDifferentFromCurrent(fallback)) {
        unwindUnexpectedMutation(fallback, applyFallbackSelection);
        return;
      }

      applyFallbackSelection();
    }

    function handleCommentToggleShortcut(event) {
      if (wasRecentlyHandled(event)) {
        return true;
      }

      if (!isCommentToggleShortcut(event) || !isEditorFocused()) {
        return false;
      }

      event.preventDefault();
      event.stopPropagation();
      rememberHandledShortcut(event);
      // Some non-ABC IMEs still emit a delayed text mutation for Cmd+/.
      // Snapshot first so a rapid second shortcut can safely undo that mutation.
      captureImeMutation();
      markCommentInputSuppressed();
      runCommentToggle();
      return true;
    }

    function handleShortcutEvent(event, selectAllSource) {
      rememberCommandModifier(event);
      return handleCommentToggleShortcut(event) ||
        handleSelectAllShortcut(event, selectAllSource) ||
        handleHistoryShortcut(event) ||
        handleRunShortcut(event);
    }

    function createCepShortcutEvent(detail) {
      return {
        ...detail,
        preventDefault() {},
        stopPropagation() {},
      };
    }

    function attachInputAreaHandlers() {
      const editor = getEditor();
      const editorNode =
        editor && typeof editor.getDomNode === "function"
          ? editor.getDomNode()
          : null;
      if (!editorNode) {
        return;
      }

      const inputArea = editorNode.querySelector("textarea.inputarea");
      if (!inputArea) {
        return;
      }

      if (inputAreaBeforeInputHandler) {
        inputArea.removeEventListener("beforeinput", inputAreaBeforeInputHandler, true);
      }

      if (inputAreaSelectHandler) {
        inputArea.removeEventListener("select", inputAreaSelectHandler, true);
      }

      if (inputAreaKeydownHandler) {
        inputArea.removeEventListener("keydown", inputAreaKeydownHandler, true);
      }

      if (inputAreaKeyupHandler) {
        inputArea.removeEventListener("keyup", inputAreaKeyupHandler, true);
      }

      currentInputArea = inputArea;

      inputAreaSelectHandler = function () {
        if (!shouldTreatInputAreaSelectAsSelectAll(inputArea)) {
          return;
        }

        if (Date.now() - lastNativeSelectAllFallbackTs <= 80) {
          return;
        }

        lastNativeSelectAllFallbackTs = Date.now();
        setTimeout(() => {
          triggerEditorSelectAll("inputarea-native-selectall-fallback");
        }, 0);
      };

      inputArea.addEventListener("select", inputAreaSelectHandler, true);

      inputAreaBeforeInputHandler = function (event) {
        if (shouldSuppressCommandModifierInput(event)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        if (shouldSuppressHistoryInput() && event) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        if (shouldSuppressCommentInput() && event) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        if (shouldCaptureImeMutation(event)) {
          captureImeMutation();
        }
      };

      inputArea.addEventListener("beforeinput", inputAreaBeforeInputHandler, true);

      inputAreaKeydownHandler = function (event) {
        handleShortcutEvent(event, "inputarea-select-all");
      };

      inputAreaKeyupHandler = function (event) {
        releaseCommandModifierIfNeeded(event);
      };

      inputArea.addEventListener("keydown", inputAreaKeydownHandler, true);
      inputArea.addEventListener("keyup", inputAreaKeyupHandler, true);
    }

    function bindWindowShortcuts() {
      if (windowKeydownHandler) {
        window.removeEventListener("keydown", windowKeydownHandler, true);
      }

      if (windowCepKeydownHandler) {
        window.removeEventListener("momentum:cep-keydown", windowCepKeydownHandler, true);
      }

      if (windowModifierKeyupHandler) {
        window.removeEventListener("keyup", windowModifierKeyupHandler, true);
      }

      windowKeydownHandler = function (event) {
        handleShortcutEvent(event, "dom-select-all");
      };

      windowCepKeydownHandler = function (event) {
        const detail = normalizeKeyboardLikeEvent(event && event.detail);
        if (!detail) {
          return;
        }

        handleShortcutEvent(createCepShortcutEvent(detail), "cep-select-all");
      };

      windowModifierKeyupHandler = function (event) {
        releaseCommandModifierIfNeeded(event);
      };

      window.addEventListener("keydown", windowKeydownHandler, true);
      window.addEventListener("momentum:cep-keydown", windowCepKeydownHandler, true);
      window.addEventListener("keyup", windowModifierKeyupHandler, true);
    }

    return {
      attachInputAreaHandlers,
      bindWindowShortcuts,
      rememberNonEmptySelections,
      toggleLineComments: runCommentToggle,
    };
  }

  return {
    createController,
  };
})();
