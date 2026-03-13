window.momentumEditorInteractions = (function () {
  const SHORTCUT_FALLBACK_WINDOW_MS = 500;
  const SHORTCUT_INPUT_SUPPRESS_MS = 250;
  const DEBUG_HISTORY_SHORTCUTS = false;
  const DEBUG_LABEL_ALLOWLIST = {
    rememberCommandModifier: true,
    "window:keydown": true,
    "cep:keydown": true,
    "inputArea:keydown": true,
    "inputArea:beforeinput": true,
    "inputArea:beforeinput:suppressedCommandModifier": true,
    "inputArea:beforeinput:suppressedHistory": true,
    "inputArea:beforeinput:suppressedComment": true,
    "inputArea:compositionstart": true,
    "inputArea:compositionend": true,
    captureImeMutation: true,
    "consumeImeMutation:none": true,
    "consumeImeMutation:expired": true,
    "consumeImeMutation:hit": true,
    "handleHistoryShortcut:skip:notFocused": true,
    "handleHistoryShortcut:skip:noAction": true,
    "handleHistoryShortcut:skip:deduped": true,
    "handleHistoryShortcut:matched": true,
    runHistoryShortcut: true,
    runEditorHistoryAction: true,
    "handleCommentToggleShortcut:skip:deduped": true,
    "handleCommentToggleShortcut:matched": true,
    "handleRunShortcut:skip:deduped": true,
    "handleRunShortcut:matched": true,
    "handleSelectAllShortcut:skip:deduped": true,
    "handleSelectAllShortcut:matched": true,
    runShortcut: true,
    runCommentToggle: true,
    toggleLineComments: true,
  };

  function createController(options) {
    const getEditor = options.getEditor;
    const canRunScript =
      typeof options.canRunScript === "function" ? options.canRunScript : null;
    const runScript = typeof options.runScript === "function" ? options.runScript : null;
    let inputAreaBeforeInputHandler = null;
    let inputAreaSelectHandler = null;
    let inputAreaCompositionStartHandler = null;
    let inputAreaCompositionEndHandler = null;
    let inputAreaKeydownHandler = null;
    let inputAreaKeyupHandler = null;
    let windowCommentKeydownHandler = null;
    let windowHistoryKeydownHandler = null;
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

      if (typeof editor.hasTextFocus === "function" && editor.hasTextFocus()) {
        return true;
      }

      if (typeof editor.hasWidgetFocus === "function" && editor.hasWidgetFocus()) {
        return true;
      }

      const editorNode = typeof editor.getDomNode === "function" ? editor.getDomNode() : null;
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

    function shouldDebugLabel(label, payload) {
      if (!DEBUG_LABEL_ALLOWLIST[label]) {
        return false;
      }

      if ((label === "window:keydown" || label === "inputArea:keydown") && payload) {
        return !!(
          payload.metaKey ||
          payload.ctrlKey ||
          payload.key === "Meta" ||
          payload.key === "Control" ||
          payload.key === "/" ||
          payload.key === "z" ||
          payload.key === "Z" ||
          payload.key === "y" ||
          payload.key === "Y" ||
          payload.key === "a" ||
          payload.key === "A" ||
          payload.code === "MetaLeft" ||
          payload.code === "MetaRight" ||
          payload.code === "ControlLeft" ||
          payload.code === "ControlRight" ||
          payload.code === "Slash" ||
          payload.code === "KeyZ" ||
          payload.code === "KeyY" ||
          payload.code === "KeyA"
        );
      }

      if (label === "inputArea:beforeinput" && payload) {
        return !!payload.inputType;
      }

      return true;
    }

    function debugLog(label, payload) {
      if (!DEBUG_HISTORY_SHORTCUTS) {
        return;
      }

      if (!shouldDebugLabel(label, payload)) {
        return;
      }

      const entry = Object.assign(
        {
          tag: "editor-debug",
          event: label,
          ts: Date.now(),
          modelVersionId: getModelVersionId(),
        },
        payload || {},
      );

      console.log(JSON.stringify(entry));
    }

    function getModelVersionId() {
      const editor = getEditor();
      const model = editor && typeof editor.getModel === "function" ? editor.getModel() : null;
      return model && typeof model.getVersionId === "function" ? model.getVersionId() : null;
    }

    function getModelAlternativeVersionId() {
      const editor = getEditor();
      const model = editor && typeof editor.getModel === "function" ? editor.getModel() : null;
      return model && typeof model.getAlternativeVersionId === "function"
        ? model.getAlternativeVersionId()
        : null;
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
        modelVersionId: getModelVersionId(),
        alternativeVersionId: getModelAlternativeVersionId(),
        value: editor && typeof editor.getValue === "function" ? editor.getValue() : "",
        selections: cloneSelections(getCurrentSelections()),
      };
    }

    function describeKeyboardEvent(event) {
      if (!event) {
        return null;
      }

      return {
        key: event.key,
        code: event.code,
        keyCode: event.keyCode,
        which: event.which,
        metaKey: !!event.metaKey,
        ctrlKey: !!event.ctrlKey,
        shiftKey: !!event.shiftKey,
        altKey: !!event.altKey,
        defaultPrevented: !!event.defaultPrevented,
        isComposing: !!event.isComposing,
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

    function rememberHandledShortcut(event, source) {
      lastHandledShortcut = {
        signature: getShortcutSignature(event),
        source: source || "unknown",
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

    function describeInputEvent(event) {
      if (!event) {
        return null;
      }

      return {
        inputType: event.inputType,
        data: event.data,
        isComposing: !!event.isComposing,
        defaultPrevented: !!event.defaultPrevented,
      };
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
      debugLog("lockInputAreaForCommandShortcut", {
        readOnly: true,
      });
    }

    function unlockInputAreaForCommandShortcut() {
      if (!currentInputArea) {
        return;
      }

      if (currentInputArea.readOnly === !!inputAreaWasReadOnly) {
        return;
      }

      currentInputArea.readOnly = inputAreaWasReadOnly;
      debugLog("unlockInputAreaForCommandShortcut", {
        readOnly: !!currentInputArea.readOnly,
      });
    }

    function setCommandModifierPressed(isPressed, event) {
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

      debugLog("setCommandModifierPressed", Object.assign(
        {
          pressed: commandModifierPressed,
        },
        event ? describeKeyboardEvent(event) : {},
      ));
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
        if (event.metaKey || event.ctrlKey || isModifierKey) {
          setCommandModifierPressed(true, event);
        }

        if (
          !pendingCommandSnapshot ||
          Date.now() - pendingCommandSnapshot.timestamp > SHORTCUT_INPUT_SUPPRESS_MS
        ) {
          pendingCommandSnapshot = createEditorSnapshot();
          debugLog("captureCommandSnapshot", {
            modelVersionId: pendingCommandSnapshot.modelVersionId,
            alternativeVersionId: pendingCommandSnapshot.alternativeVersionId,
            selectionCount: pendingCommandSnapshot.selections.length,
          });
        }

        commandModifierActiveUntil = Date.now() + SHORTCUT_INPUT_SUPPRESS_MS;
        debugLog(
          "rememberCommandModifier",
          Object.assign(
            {
              activeUntilInMs: SHORTCUT_INPUT_SUPPRESS_MS,
            },
            describeKeyboardEvent(event),
          ),
        );
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
        setCommandModifierPressed(false, event);
      }
    }

    function consumeCommandSnapshot() {
      if (!pendingCommandSnapshot) {
        debugLog("consumeCommandSnapshot:none");
        return null;
      }

      if (Date.now() - pendingCommandSnapshot.timestamp > SHORTCUT_INPUT_SUPPRESS_MS) {
        debugLog("consumeCommandSnapshot:expired", {
          ageMs: Date.now() - pendingCommandSnapshot.timestamp,
        });
        pendingCommandSnapshot = null;
        return null;
      }

      const snapshot = pendingCommandSnapshot;
      pendingCommandSnapshot = null;
      debugLog("consumeCommandSnapshot:hit", {
        modelVersionId: snapshot.modelVersionId,
        alternativeVersionId: snapshot.alternativeVersionId,
        valueLength: snapshot.value ? snapshot.value.length : 0,
        ageMs: Date.now() - snapshot.timestamp,
        selectionCount: Array.isArray(snapshot.selections) ? snapshot.selections.length : 0,
      });
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
        debugLog("unwindUnexpectedMutation:giveUp", {
          snapshotVersionId: snapshot ? snapshot.modelVersionId : null,
          snapshotAlternativeVersionId: snapshot ? snapshot.alternativeVersionId : null,
          snapshotValueLength: snapshot && snapshot.value ? snapshot.value.length : 0,
          currentVersionId: getModelVersionId(),
          currentAlternativeVersionId: getModelAlternativeVersionId(),
          currentValueLength: (() => {
            const editor = getEditor();
            return editor && typeof editor.getValue === "function" ? editor.getValue().length : 0;
          })(),
        });
        restoreSnapshotSelections(snapshot);
        callback();
        return;
      }

      debugLog("unwindUnexpectedMutation:undo", {
        attemptsLeft: remainingAttempts,
        snapshotVersionId: snapshot.modelVersionId,
        snapshotAlternativeVersionId: snapshot.alternativeVersionId,
        snapshotValueLength: snapshot.value ? snapshot.value.length : 0,
        currentVersionId: getModelVersionId(),
        currentAlternativeVersionId: getModelAlternativeVersionId(),
        currentValueLength: (() => {
          const editor = getEditor();
          return editor && typeof editor.getValue === "function" ? editor.getValue().length : 0;
        })(),
      });
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

      const model = editor.getModel();
      const currentSelections = getCurrentSelections();
      let snapshotSelections = hasNonEmptySelection(currentSelections)
        ? currentSelections
        : lastNonEmptySelections;

      if (!Array.isArray(snapshotSelections) || !snapshotSelections.length) {
        snapshotSelections = getCurrentSelections();
      }

      pendingImeMutation = {
        timestamp: Date.now(),
        modelVersionId:
          model && typeof model.getVersionId === "function"
            ? model.getVersionId()
            : null,
        selections: cloneSelections(snapshotSelections),
      };

      debugLog("captureImeMutation", {
        modelVersionId: pendingImeMutation.modelVersionId,
        selectionCount: pendingImeMutation.selections.length,
      });
    }

    function consumeImeMutation() {
      if (!pendingImeMutation) {
        debugLog("consumeImeMutation:none");
        return null;
      }

      if (Date.now() - pendingImeMutation.timestamp > SHORTCUT_FALLBACK_WINDOW_MS) {
        debugLog("consumeImeMutation:expired", {
          ageMs: Date.now() - pendingImeMutation.timestamp,
        });
        pendingImeMutation = null;
        return null;
      }

      const fallback = pendingImeMutation;
      pendingImeMutation = null;
      debugLog("consumeImeMutation:hit", {
        modelVersionId: fallback.modelVersionId,
        ageMs: Date.now() - fallback.timestamp,
        selectionCount: Array.isArray(fallback.selections) ? fallback.selections.length : 0,
      });
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

      debugLog("runEditorHistoryAction", {
        actionId,
        modelVersionId: getModelVersionId(),
      });
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
      const model = editor.getModel();
      const currentVersionId =
        model && typeof model.getVersionId === "function"
          ? model.getVersionId()
          : null;
      const shouldUndoImeMutation = isSnapshotDifferentFromCurrent(fallback);

      debugLog("runHistoryShortcut", {
        actionId,
        fallbackSource: commandSnapshot ? "commandSnapshot" : imeFallback ? "imeFallback" : null,
        fallbackVersionId: fallback ? fallback.modelVersionId : null,
        fallbackAlternativeVersionId: fallback ? fallback.alternativeVersionId : null,
        currentVersionId,
        shouldUndoImeMutation,
      });

      if (!shouldUndoImeMutation) {
        runEditorHistoryAction(actionId);
        return;
      }

      unwindUnexpectedMutation(fallback, function () {
        markHistoryInputSuppressed();
        runEditorHistoryAction(actionId);
      });
    }

    function handleHistoryShortcut(event, source) {
      if (wasRecentlyHandled(event)) {
        debugLog("handleHistoryShortcut:skip:deduped", Object.assign(
          {
            dedupedFrom: lastHandledShortcut ? lastHandledShortcut.source : null,
          },
          describeKeyboardEvent(event),
        ));
        return true;
      }

      if (!isEditorFocused()) {
        debugLog("handleHistoryShortcut:skip:notFocused", describeKeyboardEvent(event));
        return false;
      }

      let actionId = null;
      if (isUndoShortcut(event)) {
        actionId = "undo";
      } else if (isRedoShortcut(event)) {
        actionId = "redo";
      }

      if (!actionId) {
        debugLog("handleHistoryShortcut:skip:noAction", describeKeyboardEvent(event));
        return false;
      }

      event.preventDefault();
      event.stopPropagation();
      rememberHandledShortcut(event, source || "dom-history");
      debugLog(
        "handleHistoryShortcut:matched",
        Object.assign(
          {
            actionId,
          },
          describeKeyboardEvent(event),
        ),
      );
      markHistoryInputSuppressed();
      runHistoryShortcut(actionId);
      return true;
    }

    function runShortcut() {
      if (!runScript || (canRunScript && !canRunScript())) {
        return false;
      }

      debugLog("runShortcut", {
        modelVersionId: getModelVersionId(),
      });
      runScript();
      return true;
    }

    function handleRunShortcut(event, source) {
      if (wasRecentlyHandled(event)) {
        debugLog("handleRunShortcut:skip:deduped", Object.assign(
          {
            dedupedFrom: lastHandledShortcut ? lastHandledShortcut.source : null,
          },
          describeKeyboardEvent(event),
        ));
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

      rememberHandledShortcut(event, source || "dom-run");
      debugLog("handleRunShortcut:matched", describeKeyboardEvent(event));
      runShortcut();
      return true;
    }

    function handleSelectAllShortcut(event, source) {
      if (wasRecentlyHandled(event)) {
        debugLog("handleSelectAllShortcut:skip:deduped", Object.assign(
          {
            dedupedFrom: lastHandledShortcut ? lastHandledShortcut.source : null,
          },
          describeKeyboardEvent(event),
        ));
        return true;
      }

      if (!isSelectAllShortcut(event) || !isEditorFocused()) {
        return false;
      }

      event.preventDefault();
      event.stopPropagation();
      rememberHandledShortcut(event, source || "dom-select-all");
      debugLog("handleSelectAllShortcut:matched", describeKeyboardEvent(event));
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

      debugLog("toggleLineComments", {
        selectionCount: selections.length,
        editCount: edits.length,
      });

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
      debugLog("runCommentToggle", {
        fallbackSource: commandSnapshot ? "commandSnapshot" : imeFallback ? "imeFallback" : null,
        hasFallback: !!fallback,
        fallbackSelectionCount:
          fallback && Array.isArray(fallback.selections) ? fallback.selections.length : 0,
      });
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

    function handleCommentToggleShortcut(event, source) {
      if (wasRecentlyHandled(event)) {
        debugLog("handleCommentToggleShortcut:skip:deduped", Object.assign(
          {
            dedupedFrom: lastHandledShortcut ? lastHandledShortcut.source : null,
          },
          describeKeyboardEvent(event),
        ));
        return true;
      }

      if (!isCommentToggleShortcut(event) || !isEditorFocused()) {
        return false;
      }

      event.preventDefault();
      event.stopPropagation();
      rememberHandledShortcut(event, source || "dom-comment");
      debugLog("handleCommentToggleShortcut:matched", describeKeyboardEvent(event));
      // Some non-ABC IMEs still emit a delayed text mutation for Cmd+/.
      // Snapshot first so a rapid second shortcut can safely undo that mutation.
      captureImeMutation();
      markCommentInputSuppressed();
      runCommentToggle();
      return true;
    }

    function attachInputAreaSelectHandler() {
      const editor = getEditor();
      const editorNode = editor && typeof editor.getDomNode === "function" ? editor.getDomNode() : null;
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

      if (inputAreaCompositionStartHandler) {
        inputArea.removeEventListener("compositionstart", inputAreaCompositionStartHandler, true);
      }

      if (inputAreaCompositionEndHandler) {
        inputArea.removeEventListener("compositionend", inputAreaCompositionEndHandler, true);
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
        debugLog("inputArea:beforeinput", describeInputEvent(event));

        if (shouldSuppressCommandModifierInput(event)) {
          debugLog(
            "inputArea:beforeinput:suppressedCommandModifier",
            describeInputEvent(event),
          );
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        if (shouldSuppressHistoryInput() && event) {
          debugLog("inputArea:beforeinput:suppressedHistory", describeInputEvent(event));
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        if (shouldSuppressCommentInput() && event) {
          debugLog("inputArea:beforeinput:suppressedComment", describeInputEvent(event));
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        if (shouldCaptureImeMutation(event)) {
          captureImeMutation();
        }
      };

      inputArea.addEventListener("beforeinput", inputAreaBeforeInputHandler, true);

      inputAreaCompositionStartHandler = function (event) {
        debugLog("inputArea:compositionstart", describeInputEvent(event));
      };

      inputAreaCompositionEndHandler = function (event) {
        debugLog("inputArea:compositionend", describeInputEvent(event));
      };

      inputAreaKeydownHandler = function (event) {
        rememberCommandModifier(event);
        debugLog("inputArea:keydown", describeKeyboardEvent(event));

        if (handleSelectAllShortcut(event, "inputarea-select-all")) {
          return;
        }

        if (handleHistoryShortcut(event, "inputarea-history")) {
          return;
        }

        if (handleCommentToggleShortcut(event, "inputarea-comment")) {
          return;
        }

        handleRunShortcut(event, "inputarea-run");
      };

      inputAreaKeyupHandler = function (event) {
        releaseCommandModifierIfNeeded(event);
        debugLog("inputArea:keyup", describeKeyboardEvent(event));
      };

      inputArea.addEventListener("compositionstart", inputAreaCompositionStartHandler, true);
      inputArea.addEventListener("compositionend", inputAreaCompositionEndHandler, true);
      inputArea.addEventListener("keydown", inputAreaKeydownHandler, true);
      inputArea.addEventListener("keyup", inputAreaKeyupHandler, true);
    }

    function bindWindowShortcuts() {
      if (windowCommentKeydownHandler) {
        window.removeEventListener("keydown", windowCommentKeydownHandler, true);
      }

      if (windowHistoryKeydownHandler) {
        window.removeEventListener("keydown", windowHistoryKeydownHandler, true);
      }

      if (windowCepKeydownHandler) {
        window.removeEventListener("momentum:cep-keydown", windowCepKeydownHandler, true);
      }

      if (windowModifierKeyupHandler) {
        window.removeEventListener("keyup", windowModifierKeyupHandler, true);
      }

      windowCommentKeydownHandler = function (event) {
        rememberCommandModifier(event);
        handleCommentToggleShortcut(event, "dom-comment");
      };

      windowHistoryKeydownHandler = function (event) {
        rememberCommandModifier(event);
        debugLog("window:keydown", describeKeyboardEvent(event));
        if (handleSelectAllShortcut(event, "dom-select-all")) {
          return;
        }

        if (handleHistoryShortcut(event, "dom-history")) {
          return;
        }

        handleRunShortcut(event, "dom-run");
      };

      windowCepKeydownHandler = function (event) {
        const detail = normalizeKeyboardLikeEvent(event && event.detail);
        if (!detail) {
          return;
        }

        rememberCommandModifier(detail);
        debugLog("cep:keydown", Object.assign({ source: "cep" }, detail));

        if (isCommentToggleShortcut(detail)) {
          handleCommentToggleShortcut({
            ...detail,
            preventDefault() {},
            stopPropagation() {},
          }, "cep-comment");
          return;
        }

        if (isSelectAllShortcut(detail)) {
          handleSelectAllShortcut({
            ...detail,
            preventDefault() {},
            stopPropagation() {},
          }, "cep-select-all");
          return;
        }

        if (isUndoShortcut(detail) || isRedoShortcut(detail)) {
          handleHistoryShortcut({
            ...detail,
            preventDefault() {},
            stopPropagation() {},
          }, "cep-history");
          return;
        }

        if (isRunShortcut(detail)) {
          handleRunShortcut({
            ...detail,
            preventDefault() {},
            stopPropagation() {},
          }, "cep-run");
        }
      };

      windowModifierKeyupHandler = function (event) {
        releaseCommandModifierIfNeeded(event);
        debugLog("window:keyup", describeKeyboardEvent(event));
      };

      window.addEventListener("keydown", windowCommentKeydownHandler, true);
      window.addEventListener("keydown", windowHistoryKeydownHandler, true);
      window.addEventListener("momentum:cep-keydown", windowCepKeydownHandler, true);
      window.addEventListener("keyup", windowModifierKeyupHandler, true);
    }

    return {
      attachInputAreaSelectHandler,
      bindWindowShortcuts,
      rememberNonEmptySelections,
      toggleLineComments: runCommentToggle,
    };
  }

  return {
    createController,
  };
})();
