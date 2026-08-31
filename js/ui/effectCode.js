// Effect Code sessions hosted by the main Momentum editor and Console.
window.effectCodeManager = (function () {
  "use strict";

  const CodeBundle = window.momentumCodeBundle;
  const COMMIT_POLL_LIMIT = 300;
  const COMMIT_POLL_DELAY_MS = 50;
  const SESSION_REFRESH_TIMEOUT_MS = 4000;

  let initialized = false;
  let editor = null;
  let editorModeLease = null;
  let context = null;
  let originalSource = "";
  let active = false;
  let isSubmitting = false;
  let contextLoadGeneration = 0;
  let editorActions = [];
  let sessionModels = Object.create(null);
  let activeModelHash = "";
  let sessionViewState = null;
  let diffController = null;
  let diffRenderFrame = 0;
  let refreshRequested = false;
  let refreshTimeout = 0;
  let lastContextLoadError = "";
  let lastFocusDiagnostic = "";
  let nextEffectModelId = 0;
  let editorPointerInside = false;
  let editorPointerPoint = null;
  const logSession = String(Date.now());
  const codeClock = window.momentumEffectCodeClock.createClock({
    callHost,
    diagnose: logStage,
    getActiveModelHash: function () {
      return activeModelHash;
    },
    getContext: function () {
      return context;
    },
    hasSourceModel: function (sourceHash) {
      return !!sessionModels[sourceHash];
    },
    isActive: function () {
      return active;
    },
    getPauseReason: getClockPauseReason,
    isPaused: function () {
      return getClockPauseReason() !== "";
    },
    syncDiff: syncEffectCodeDiff,
    timelineChanged: precomputeEffectCodeDiffs,
    timelineSampled: function (sample) {
      window.debugTraceManager.updateTimelineSample(sample);
    },
    showError,
    switchToSourceModel,
    updateHeader,
  });

  function getElement(id) {
    return document.getElementById(id);
  }

  function callHost(functionName, args) {
    return window.momentumPluginBridge.callExtendScript(functionName, args);
  }

  function parseHostJson(value) {
    const text = typeof value === "string"
      ? value
      : String(value == null ? "" : value);
    if (!text || /^EvalScript error\./i.test(text) || /^Error:/i.test(text)) {
      throw new Error(text || "After Effects did not return an editor context.");
    }
    return JSON.parse(text);
  }

  function delay(milliseconds) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, milliseconds);
    });
  }

  function waitForEditor() {
    if (window.editorManager.editor) {
      return Promise.resolve(window.editorManager.editor);
    }
    return new Promise(function (resolve) {
      function handleReady() {
        window.removeEventListener("momentum:editor-ready", handleReady);
        resolve(window.editorManager.editor);
      }
      window.addEventListener("momentum:editor-ready", handleReady);
    });
  }

  function waitForCommitResult(sessionToken, attempt) {
    const pollAttempt = Number(attempt) || 0;
    if (pollAttempt >= COMMIT_POLL_LIMIT) {
      return Promise.reject(new Error(
        "After Effects did not finish the Code edit transaction.",
      ));
    }
    return delay(COMMIT_POLL_DELAY_MS)
      .then(function () {
        return callHost("momentumGetCodeEditCommitResult", [sessionToken]);
      })
      .then(parseHostJson)
      .then(function (result) {
        if (!result || result.ok !== true) {
          throw new Error("Could not read the Code edit transaction result.");
        }
        if (!result.done) {
          return waitForCommitResult(sessionToken, pollAttempt + 1);
        }
        if (!result.succeeded) {
          throw new Error(
            result.message ||
              `After Effects rejected the Code edit (error ${result.errorCode || 0}).`,
          );
        }
        return result;
      });
  }

  function logStage(stage, detail) {
    const message = [
      `session=${logSession}`,
      `stage=${String(stage || "unknown")}`,
      String(detail == null ? "" : detail),
    ].join(" ");
    return callHost("momentumAppendCodeEditorLog", [encodeURIComponent(message)])
      .catch(function () {});
  }

  function clearEffectConsole() {
    window.consoleManager.clearConsole();
  }

  function isSameTraceTarget(left, right) {
    return !!(
      left &&
      right &&
      Number(left.locator && left.locator.compId) ===
        Number(right.locator && right.locator.compId) &&
      String(left.debugTracePath || "") === String(right.debugTracePath || "")
    );
  }

  function appendError(message) {
    const text = String(message || "Unknown error");
    window.consoleManager.appendExternalLine(text, "error");
  }

  function showError(message) {
    if (active) {
      appendError(message);
    }
  }

  function isDraftDirty() {
    const entry = sessionModels[activeModelHash] || null;
    return !!(
      active &&
      context &&
      editor &&
      entry &&
      typeof editor.getValue === "function" &&
      editor.getValue() !== entry.originalSource
    );
  }

  function getClockPauseReason() {
    if (isSubmitting) {
      return "submitting";
    }
    if (refreshRequested) {
      return "refreshing";
    }
    if (isDraftDirty()) {
      return "draft-dirty";
    }
    return "";
  }

  function isSpaceKeyboardEvent(event) {
    if (!event) {
      return false;
    }
    return event.key === " " ||
      event.key === "Spacebar" ||
      event.code === "Space" ||
      Number(event.keyCode || event.which) === 32;
  }

  function editorHasTextFocus() {
    return !!(
      editor &&
      typeof editor.hasTextFocus === "function" &&
      editor.hasTextFocus()
    );
  }

  function editorHasWidgetFocus() {
    return !!(
      editor &&
      typeof editor.hasWidgetFocus === "function" &&
      editor.hasWidgetFocus()
    );
  }

  function describeFocusElement(element) {
    if (!element) {
      return "none";
    }
    const tagName = String(element.tagName || element.nodeName || "unknown")
      .toLowerCase();
    const id = String(element.id || "");
    return id ? `${tagName}#${id}` : tagName;
  }

  function resolveFocusZone(element) {
    if (!element) {
      return "none";
    }
    const editorElement = getElement("editor");
    if (
      element === editorElement ||
      (editorElement && typeof editorElement.contains === "function" &&
        editorElement.contains(element))
    ) {
      return "editor";
    }
    const toolbarElement = getElement("toolbar");
    if (
      element === toolbarElement ||
      (toolbarElement && typeof toolbarElement.contains === "function" &&
        toolbarElement.contains(element))
    ) {
      return "toolbar";
    }
    return "document";
  }

  function describeKeyboardFocus(event, source) {
    const activeElement = document && document.activeElement || null;
    const eventTarget = event && event.target || activeElement;
    return [
      `source=${source}`,
      `target=${describeFocusElement(eventTarget)}`,
      `active=${describeFocusElement(activeElement)}`,
      `zone=${resolveFocusZone(eventTarget)}`,
      `editorText=${editorHasTextFocus() ? "yes" : "no"}`,
      `editorWidget=${editorHasWidgetFocus() ? "yes" : "no"}`,
      `defaultPrevented=${event && event.defaultPrevented ? "yes" : "no"}`,
    ].join(" ");
  }

  function syncDraftIndicator() {
    const editorContainer = getElement("editor-container");
    if (editorContainer) {
      editorContainer.classList.toggle(
        "effect-code-draft-dirty",
        isDraftDirty(),
      );
    }
  }

  function cancelScheduledEffectCodeDiff() {
    if (
      diffRenderFrame > 0 &&
      typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(diffRenderFrame);
    }
    diffRenderFrame = 0;
  }

  function precomputeEffectCodeDiffs() {
    if (diffController && context) {
      diffController.precomputeTimeline(context);
    }
  }

  function syncEffectCodeDiff(flashTimelineChange) {
    syncDraftIndicator();
    if (!active || !editor || !context || !diffController) {
      return false;
    }
    const entry = sessionModels[activeModelHash] || null;
    if (!entry || editor.getModel() !== entry.model) {
      diffController.clear();
      return false;
    }
    const source = editor.getValue();
    if (source !== entry.originalSource) {
      return diffController.showDraft(entry.originalSource, source);
    }
    return diffController.showTimeline(
      context,
      activeModelHash,
      flashTimelineChange === true,
    );
  }

  function scheduleEffectCodeDiff() {
    if (!active || diffRenderFrame) {
      return;
    }
    diffRenderFrame = -1;
    const frameId = window.requestAnimationFrame(function () {
      diffRenderFrame = 0;
      syncEffectCodeDiff();
    });
    if (diffRenderFrame === -1) {
      diffRenderFrame = Number(frameId) || 1;
    }
  }

  function encodeLocator(locator) {
    return encodeURIComponent(JSON.stringify(locator || {}));
  }

  function clearRefreshTimeout() {
    if (refreshTimeout) {
      window.clearTimeout(refreshTimeout);
      refreshTimeout = 0;
    }
  }

  function requestSessionRefresh(reason) {
    if (
      !active ||
      !context ||
      isSubmitting ||
      refreshRequested ||
      isDraftDirty()
    ) {
      return Promise.resolve(false);
    }
    const requestedSessionToken = context.sessionToken;
    const locator = encodeLocator(context.locator);
    setRefreshPending(true);
    logStage(
      "refresh-dispatch",
      `session=${requestedSessionToken} reason=${reason || "follow"}`,
    );
    return callHost(
      "momentumRequestCodeEditorRefresh",
      [requestedSessionToken, locator],
    )
      .then(parseHostJson)
      .then(function (result) {
        if (!result || result.ok !== true || result.queued !== true) {
          throw new Error("After Effects did not queue the editor refresh.");
        }
        if (
          active &&
          context &&
          context.sessionToken === requestedSessionToken
        ) {
          clearRefreshTimeout();
          refreshTimeout = window.setTimeout(function () {
            refreshTimeout = 0;
            if (
              !active ||
              !context ||
              context.sessionToken !== requestedSessionToken
            ) {
              return;
            }
            setRefreshPending(false);
            showError("Edit Code could not refresh from the After Effects timeline.");
          }, SESSION_REFRESH_TIMEOUT_MS);
        }
        return true;
      })
      .catch(function (error) {
        const message = error && error.message ? error.message : String(error);
        setRefreshPending(false);
        clearRefreshTimeout();
        logStage("refresh-rejected", message);
        showError(`Edit Code could not refresh: ${message}`);
        return false;
      });
  }

  function disposeModelRegistry(registry, retainedRegistry) {
    const retainedModels = new Set();
    Object.keys(retainedRegistry || {}).forEach(function (sourceHash) {
      const entry = retainedRegistry[sourceHash];
      if (entry && entry.model) {
        retainedModels.add(entry.model);
      }
    });
    Object.keys(registry || {}).forEach(function (sourceHash) {
      const entry = registry[sourceHash];
      if (entry && entry.model && !retainedModels.has(entry.model) &&
          typeof entry.model.dispose === "function") {
        entry.model.dispose();
      }
    });
  }

  function createEffectSourceModel(source, sourceHash) {
    nextEffectModelId += 1;
    const uri = monaco.Uri && typeof monaco.Uri.parse === "function"
      ? monaco.Uri.parse(
        `inmemory://momentum/effect-code/model-${nextEffectModelId}/${sourceHash}.js`,
      )
      : undefined;
    const model = monaco.editor.createModel(source, "javascript", uri);
    if (
      model &&
      typeof model.forceTokenization === "function" &&
      typeof model.getLineCount === "function"
    ) {
      model.forceTokenization(model.getLineCount());
    }
    return model;
  }

  function createSessionModelRegistry(nextContext, previousRegistry) {
    if (
      typeof monaco === "undefined" ||
      !monaco.editor ||
      typeof monaco.editor.createModel !== "function" ||
      !Array.isArray(nextContext && nextContext.sources)
    ) {
      throw new Error("The Effect Code models are unavailable.");
    }
    const registry = Object.create(null);
    const createdRegistry = Object.create(null);
    try {
      nextContext.sources.forEach(function (sourceEntry) {
        const sourceHash = String(sourceEntry && sourceEntry.sourceHash || "");
        if (!sourceHash || registry[sourceHash]) {
          return;
        }
        const source = CodeBundle.normalizeSource(sourceEntry.source);
        const previousEntry = previousRegistry &&
          previousRegistry[sourceHash] || null;
        if (previousEntry && previousEntry.model &&
            typeof previousEntry.model.isDisposed === "function" &&
            !previousEntry.model.isDisposed()) {
          previousEntry.originalSource = source;
          registry[sourceHash] = previousEntry;
          return;
        }
        const entry = {
          model: createEffectSourceModel(source, sourceHash),
          originalSource: source,
        };
        registry[sourceHash] = entry;
        createdRegistry[sourceHash] = entry;
      });
      if (!registry[String(nextContext.sourceHash || "")]) {
        throw new Error("The active Effect Code model is missing.");
      }
      return registry;
    } catch (error) {
      disposeModelRegistry(createdRegistry);
      throw error;
    }
  }

  function captureSessionViewState() {
    const entry = sessionModels[activeModelHash] || null;
    if (
      entry &&
      editor &&
      typeof editor.saveViewState === "function" &&
      editor.getModel() === entry.model
    ) {
      sessionViewState = editor.saveViewState();
    }
  }

  function restoreSessionViewState() {
    if (
      sessionViewState &&
      editor &&
      typeof editor.restoreViewState === "function"
    ) {
      editor.restoreViewState(sessionViewState);
    }
  }

  function switchToSourceModel(sourceHash) {
    const nextHash = String(sourceHash || "");
    const entry = sessionModels[nextHash] || null;
    if (!editor || !entry || !entry.model) {
      return false;
    }
    if (activeModelHash === nextHash && editor.getModel() === entry.model) {
      originalSource = entry.originalSource;
      return true;
    }
    captureSessionViewState();
    if (diffController) {
      diffController.clear();
    }
    attachEffectModel(entry.model);
    activeModelHash = nextHash;
    originalSource = entry.originalSource;
    restoreSessionViewState();
    return true;
  }

  function installCommittedSourceModel(sourceHash, source) {
    const nextHash = String(sourceHash || "");
    const nextSource = CodeBundle.normalizeSource(source);
    const currentEntry = sessionModels[activeModelHash] || null;
    if (!nextHash || !currentEntry || !context) {
      return false;
    }
    if (nextHash === activeModelHash) {
      currentEntry.originalSource = nextSource;
      originalSource = nextSource;
      return true;
    }
    const previousHash = activeModelHash;
    const previousSource = currentEntry.originalSource;
    const existingNextEntry = sessionModels[nextHash] || null;
    sessionModels[previousHash] = {
      model: createEffectSourceModel(previousSource, previousHash),
      originalSource: previousSource,
    };
    if (existingNextEntry && existingNextEntry !== currentEntry &&
        existingNextEntry.model &&
        typeof existingNextEntry.model.dispose === "function") {
      existingNextEntry.model.dispose();
    }
    currentEntry.originalSource = nextSource;
    sessionModels[nextHash] = currentEntry;
    activeModelHash = nextHash;
    originalSource = nextSource;
    return true;
  }

  function attachEffectModel(model) {
    if (!editorModeLease || typeof editorModeLease.attach !== "function") {
      throw new Error("The Edit Code editor mode is unavailable.");
    }
    editorModeLease.attach(model);
  }

  function requestEditorFocus() {
    window.requestAnimationFrame(function () {
      if (editor && typeof editor.focus === "function") {
        editor.focus();
      }
    });
  }

  function focusEffectCodeSurface() {
    const editorContainer = getElement("editor-container");
    if (!editorContainer || typeof editorContainer.focus !== "function") {
      return false;
    }
    editorContainer.focus();
    return true;
  }

  function releaseEditorTextFocus() {
    const activeElement = document && document.activeElement || null;
    const editorElement = getElement("editor");
    if (
      !activeElement ||
      !editorElement ||
      typeof editorElement.contains !== "function" ||
      !editorElement.contains(activeElement)
    ) {
      return false;
    }
    if (typeof activeElement.blur !== "function") {
      return false;
    }
    activeElement.blur();
    return true;
  }

  function updateEditorPointerPoint(event) {
    if (
      event &&
      Number.isFinite(Number(event.clientX)) &&
      Number.isFinite(Number(event.clientY))
    ) {
      editorPointerPoint = {
        clientX: Number(event.clientX),
        clientY: Number(event.clientY),
      };
    }
  }

  function restoreEditorFocusFromPointer() {
    if (!active || !editor || !editorPointerInside) {
      return false;
    }
    if (typeof editor.focus === "function") {
      editor.focus();
    }
    if (
      editorPointerPoint &&
      typeof editor.getTargetAtClientPoint === "function" &&
      typeof editor.setPosition === "function"
    ) {
      const target = editor.getTargetAtClientPoint(
        editorPointerPoint.clientX,
        editorPointerPoint.clientY,
      );
      if (target && target.position) {
        editor.setPosition(target.position);
      }
    }
    return true;
  }

  function handleEditorMouseEnter(event) {
    editorPointerInside = true;
    updateEditorPointerPoint(event);
  }

  function handleEditorMouseMove(event) {
    editorPointerInside = true;
    updateEditorPointerPoint(event);
  }

  function handleEditorMouseLeave() {
    editorPointerInside = false;
    editorPointerPoint = null;
  }

  function handleEditorMouseDown(event) {
    if (!active) {
      return;
    }
    editorPointerInside = true;
    updateEditorPointerPoint(event);
    if (!editorHasTextFocus()) {
      restoreEditorFocusFromPointer();
    }
  }

  function isPointerOverEditor() {
    if (editorPointerInside) {
      return true;
    }
    const editorElement = getElement("editor");
    if (!editorElement || typeof editorElement.matches !== "function") {
      return false;
    }
    try {
      return editorElement.matches(":hover");
    } catch (_error) {
      return false;
    }
  }

  function layoutEditorNow() {
    if (editor && typeof editor.layout === "function") {
      editor.layout();
    }
  }

  function updateHeader() {
    const label = getElement("current-filename");
    if (label) {
      label.textContent = "";
      label.title = "";
    }

    const commitButton = getElement("commitCodeCue");
    if (commitButton) {
      const hasCodeKeyframe = !!context &&
        context.targetMode === "existing-cue";
      const commitTitle = hasCodeKeyframe
        ? "Update Code keyframe"
        : "Add Code keyframe";
      commitButton.classList.toggle(
        "effect-code-keyframe-present",
        hasCodeKeyframe,
      );
      commitButton.setAttribute("data-tooltip", commitTitle);
      commitButton.setAttribute("aria-label", commitTitle);
      commitButton.setAttribute("aria-pressed", String(hasCodeKeyframe));
    }

  }

  function releaseWorkspace() {
    let releaseError = null;

    if (editorModeLease) {
      const lease = editorModeLease;
      editorModeLease = null;
      try {
        lease.release();
      } catch (error) {
        releaseError = error;
      }
    }
    window.workspaceManager.leaveEffectCode();
    if (releaseError) {
      throw releaseError;
    }
  }

  function disposeEditorActions() {
    editorActions.forEach(function (action) {
      if (action && typeof action.dispose === "function") {
        action.dispose();
      }
    });
    editorActions = [];
  }

  function installEditorActions() {
    disposeEditorActions();
    if (!editor || typeof editor.addAction !== "function") {
      return;
    }
    editorActions.push(editor.addAction({
      id: "momentum.commitEffectCode",
      label: "Commit Momentum Effect Code",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: function () {
        if (active) {
          return submit("cue");
        }
        return null;
      },
    }));
    if (typeof editor.onDidChangeModelContent === "function") {
      editorActions.push(editor.onDidChangeModelContent(function () {
        syncDraftIndicator();
        scheduleEffectCodeDiff();
      }));
    }
    editorActions.push(editor.addAction({
      id: "momentum.cancelEffectCode",
      label: "Cancel Momentum Effect Code",
      keybindings: [monaco.KeyCode.Escape],
      run: function () {
        if (active && !isSubmitting && !refreshRequested) {
          closeSession("cancel");
        }
        return null;
      },
    }));
  }

  function updateInteractionState() {
    const interactionLocked = isSubmitting || refreshRequested;
    const commitButton = getElement("commitCodeCue");
    const baseButton = getElement("modifyBaseCode");
    const cancelButton = getElement("cancelEffectCode");
    if (commitButton) {
      commitButton.disabled = interactionLocked || !context;
    }
    if (baseButton) {
      baseButton.disabled = interactionLocked || !context;
    }
    if (cancelButton) {
      cancelButton.disabled = interactionLocked;
    }
    if (editor && typeof editor.updateOptions === "function") {
      editor.updateOptions({ readOnly: interactionLocked || !context });
    }
    const container = getElement("container");
    if (container) {
      container.classList.toggle("effect-code-refreshing", refreshRequested);
    }
  }

  function setBusy(busy) {
    isSubmitting = !!busy;
    updateInteractionState();
  }

  function setRefreshPending(pending) {
    refreshRequested = !!pending;
    updateInteractionState();
  }

  function teardownSession(reason, notifyHost) {
    const closeReason = String(reason || "cleanup");
    const sessionToken = context && context.sessionToken || "pending";
    const locator = context ? encodeLocator(context.locator) : "";
    let cleanupError = null;
    function runCleanup(step) {
      try {
        step();
      } catch (error) {
        cleanupError = cleanupError || error;
      }
    }

    codeClock.stop();
    contextLoadGeneration += 1;
    clearRefreshTimeout();
    cancelScheduledEffectCodeDiff();
    isSubmitting = false;
    refreshRequested = false;
    active = false;
    editorPointerInside = false;
    editorPointerPoint = null;
    context = null;
    lastFocusDiagnostic = "";
    originalSource = "";
    syncDraftIndicator();
    runCleanup(disposeEditorActions);
    runCleanup(function () {
      if (diffController) {
        diffController.dispose();
        diffController = null;
      }
    });
    runCleanup(function () {
      window.debugTraceManager.stopAndClear();
    });
    runCleanup(function () {
      window.debugTraceManager.useExternalClock(false);
    });
    runCleanup(releaseWorkspace);
    runCleanup(function () {
      window.consoleManager.clearConsole();
    });
    runCleanup(function () {
      disposeModelRegistry(sessionModels);
    });
    sessionModels = Object.create(null);
    activeModelHash = "";
    sessionViewState = null;
    runCleanup(function () {
      window.activeFile.resumeEditorTracking();
    });
    requestEditorFocus();
    if (notifyHost && sessionToken !== "pending" && locator) {
      callHost(
        "momentumCloseCodeEditorSession",
        [sessionToken, locator],
      ).catch(function () {});
    }
    logStage(
      cleanupError ? "close-cleanup-failed" : "close-complete",
      `session=${sessionToken} reason=${closeReason}${
        cleanupError
          ? ` error=${cleanupError.message || String(cleanupError)}`
          : ""
      }`,
    );
    if (cleanupError) {
      console.error("Edit Code cleanup failed:", cleanupError);
      return false;
    }
    return true;
  }

  function closeSession(reason) {
    if (!active || isSubmitting || refreshRequested) {
      return false;
    }
    const closeReason = typeof reason === "string" ? reason : "cancel";
    const sessionToken = context && context.sessionToken || "pending";
    logStage(
      "close-enter",
      `session=${sessionToken} reason=${closeReason}`,
    );
    return teardownSession(closeReason, true);
  }

  function loadContext(sessionToken, options) {
    const loadOptions = options || {};
    const seamless = loadOptions.seamless === true;
    const generation = ++contextLoadGeneration;
    lastContextLoadError = "";
    clearRefreshTimeout();
    if (seamless) {
      setRefreshPending(true);
    } else {
      setRefreshPending(false);
      context = null;
      setBusy(true);
    }
    logStage(
      "load-context",
      `session=${sessionToken} seamless=${seamless ? "yes" : "no"}`,
    );

    return callHost("momentumGetCodeEditorContext", [sessionToken])
      .then(parseHostJson)
      .then(function (nextContext) {
        if (!active || generation !== contextLoadGeneration) {
          return false;
        }
        const previousContext = context;
        const traceTargetChanged = seamless &&
          !isSameTraceTarget(previousContext, nextContext);
        const previousModels = sessionModels;
        const previousActiveModelHash = activeModelHash;
        nextContext.cues = codeClock.normalizeTimeline(nextContext.cues || []);
        nextContext.clockTimeScale = Math.max(
          1,
          Number(nextContext.targetTimeScale) || 1,
        );
        captureSessionViewState();
        const nextModels = createSessionModelRegistry(
          nextContext,
          previousModels,
        );
        context = nextContext;
        sessionModels = nextModels;
        activeModelHash = nextModels[previousActiveModelHash] &&
          editor.getModel() === nextModels[previousActiveModelHash].model
          ? previousActiveModelHash
          : "";
        diffController.setSources(nextContext.sources);
        precomputeEffectCodeDiffs();
        if (!switchToSourceModel(nextContext.sourceHash)) {
          sessionModels = previousModels;
          activeModelHash = previousActiveModelHash;
          context = previousContext;
          disposeModelRegistry(nextModels, previousModels);
          throw new Error("The active Effect Code model could not be selected.");
        }
        syncEffectCodeDiff();
        disposeModelRegistry(previousModels, nextModels);
        if (seamless) {
          if (traceTargetChanged) {
            window.debugTraceManager.stopAndClear();
          }
          setRefreshPending(false);
        } else {
          updateHeader();
          window.debugTraceManager.stopAndClear();
          window.workspaceManager.enterEffectCode();
          clearEffectConsole();
          window.debugTraceManager.useExternalClock(true);
          layoutEditorNow();
          setBusy(false);
          releaseEditorTextFocus();
          focusEffectCodeSurface();
        }
        window.debugTraceManager.ensureSession({
          compId: Number(nextContext.locator && nextContext.locator.compId),
          filePath: nextContext.debugTracePath || "",
        });
        if (seamless) {
          updateHeader();
        } else if (
          typeof document.hasFocus !== "function" ||
          !document.hasFocus()
        ) {
          releaseEditorTextFocus();
        }
        logStage(
          "context-ready",
          `session=${nextContext.sessionToken} target=${nextContext.targetMode} time=${nextContext.targetTimeSeconds}`,
        );
        return true;
      })
      .catch(function (error) {
        if (!active || generation !== contextLoadGeneration) {
          return false;
        }
        const message = error && error.message ? error.message : String(error);
        lastContextLoadError = message;
        logStage("context-rejected", message);
        showError(`Edit Code could not open: ${message}`);
        if (seamless) {
          setRefreshPending(false);
        } else {
          setBusy(false);
        }
        return false;
      });
  }

  // Bridge serializes session delivery before it reaches this manager.
  function activateSession(sessionToken) {
    if (active) {
      if (context && context.sessionToken === sessionToken) {
        return Promise.resolve(true);
      }
      if (context && editor.getValue() !== originalSource) {
        logStage(
          "refresh-deferred-dirty",
          `current=${context.sessionToken} requested=${sessionToken}`,
        );
        return Promise.resolve(false);
      }
      return loadContext(sessionToken, { seamless: true });
    }
    return waitForEditor()
      .then(function (nextEditor) {
        if (!nextEditor) {
          throw new Error("The shared Momentum editor is unavailable.");
        }
        editor = nextEditor;
        return window.activeFile.suspendEditorTracking();
      })
      .then(function (succeeded) {
        if (!succeeded) {
          throw new Error("The current file could not be saved before Edit Code opened.");
        }
        editorModeLease = window.editorManager.acquireTemporaryMode(
          "Edit Code",
        );
        diffController = window.momentumEffectCodeDiff.createController({
          editor: editor,
        });
        sessionViewState = null;
        active = true;
        return loadContext(sessionToken).then(function (loaded) {
          if (loaded) {
            installEditorActions();
            codeClock.start();
            return true;
          }
          teardownSession("open-failed", true);
          appendError(
            `Edit Code could not open: ${
              lastContextLoadError || "The Effect context is unavailable."
            }`,
          );
          return false;
        });
      })
      .catch(function (error) {
        const message = error && error.message ? error.message : String(error);
        teardownSession("open-exception", true);
        appendError(`Edit Code could not open: ${message}`);
        return false;
      });
  }

  function submit(editTarget) {
    if (!active || !editor || !context || isSubmitting || refreshRequested) {
      return Promise.resolve(false);
    }
    if (editTarget !== "cue" && editTarget !== "base") {
      return Promise.resolve(false);
    }

    clearEffectConsole();
    let source = "";
    let bundle = null;
    try {
      source = CodeBundle.normalizeSource(editor.getValue());
      const activeEntry = sessionModels[activeModelHash] || null;
      if (activeEntry && activeEntry.model.getValue() !== source) {
        activeEntry.model.setValue(source);
      }
      logStage(
        "submit-enter",
        `target=${editTarget} sourceBytes=${source.length}`,
      );
      if (
        editTarget === "base" &&
        activeModelHash === context.baseSourceHash &&
        source === originalSource
      ) {
        logStage("submit-base-unchanged", "");
        return Promise.resolve(true);
      }
      if (
        editTarget === "cue" &&
        source === originalSource &&
        context.targetMode === "existing-cue"
      ) {
        logStage("submit-unchanged", "");
        return Promise.resolve(true);
      }
      if (source === originalSource) {
        logStage("submit-new-cue-unchanged", "creating explicit Cue");
      }

      const compiled = window.sketchCompiler.compile(source);
      if (!compiled || !compiled.ok) {
        const message = CodeBundle.formatDiagnostic(
          CodeBundle.getPrimaryDiagnostic(compiled),
        );
        logStage("compile-failed", message);
        showError(message);
        return Promise.resolve(false);
      }
      logStage("compile-complete", "");

      const previousCompiled = window.sketchCompiler.compile(originalSource);
      if (!previousCompiled || !previousCompiled.rawAst) {
        const message = "The stored Momentum source can no longer be parsed.";
        logStage("stored-source-invalid", message);
        showError(message);
        return Promise.resolve(false);
      }

      bundle = CodeBundle.buildCodeCueBundle(
        source,
        compiled,
        context.compName || "Momentum",
        context.controller,
        context.runtimeMetadata,
      );
      const previousBundle = CodeBundle.buildCodeCueBundle(
        originalSource,
        previousCompiled,
        context.compName || "Momentum",
        context.controller,
        context.runtimeMetadata,
      );
      const contractResult = CodeBundle.validateCodeCueContract(
        previousBundle,
        bundle,
        previousCompiled,
        compiled,
      );
      if (!contractResult || contractResult.ok !== true) {
        const message = contractResult && contractResult.message
          ? contractResult.message
          : "Code keyframes cannot change the composition contract.";
        logStage(
          "code-cue-contract-rejected",
          contractResult && contractResult.code || "unknown",
        );
        showError(message);
        return Promise.resolve(false);
      }
      logStage(
        "bundle-ready",
        `controllerHash=${String(context.controllerHash || "none")} transition=${
          bundle && bundle.momentumCodeCue && bundle.momentumCodeCue.mode || "restart"
        }`,
      );
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      logStage("prepare-exception", message);
      showError(`Edit Code preparation failed: ${message}`);
      return Promise.resolve(false);
    }

    const payload = encodeURIComponent(JSON.stringify({
      sessionToken: context.sessionToken,
      editTarget: editTarget,
      controllerHash: context.controllerHash,
      locator: context.locator,
      source: source,
      bundle: bundle,
    }));

    setBusy(true);
    logStage(
      "confirm-dispatch",
      `session=${context.sessionToken} target=${
        editTarget === "base" ? "base" : context.targetMode
      } time=${context.targetTimeSeconds}`,
    );
    return callHost("momentumConfirmCodeSnapshot", [payload])
      .then(function (rawResult) {
        logStage("confirm-result", String(rawResult).slice(0, 500));
        return parseHostJson(rawResult);
      })
      .then(function (result) {
        if (!result || result.ok !== true || result.queued !== true) {
          throw new Error(result && result.error
            ? result.error
            : "Could not queue the Code keyframe transaction.");
        }
        logStage("confirm-queued", `session=${result.sessionToken}`);
        return waitForCommitResult(result.sessionToken, 0);
      })
      .then(function (result) {
        logStage(
          "confirm-success",
          `session=${context.sessionToken} message=${result.message || "ok"}`,
        );
        isSubmitting = false;
        originalSource = source;
        const committedSourceHash = String(
          bundle && bundle.sourceHash || context.sourceHash,
        );
        const timelineSourceHash = context.sourceHash;
        installCommittedSourceModel(committedSourceHash, source);
        diffController.setSource(committedSourceHash, source);
        if (editTarget === "base") {
          const previousBaseSourceHash = context.baseSourceHash;
          context.baseSourceHash = committedSourceHash;
          if (timelineSourceHash === previousBaseSourceHash) {
            context.sourceHash = committedSourceHash;
          } else {
            switchToSourceModel(timelineSourceHash);
          }
        } else {
          context.sourceHash = committedSourceHash;
          context.targetMode = "existing-cue";
        }
        updateHeader();
        syncDraftIndicator();
        setBusy(false);
        return requestSessionRefresh(
          editTarget === "base" ? "base-commit" : "commit",
        ).then(function () {
          return true;
        });
      })
      .catch(function (error) {
        const message = error && error.message ? error.message : String(error);
        logStage("confirm-rejected", message);
        showError(`Edit Code failed: ${message}`);
        setBusy(false);
        return false;
      });
  }

  function handleWindowKeydown(event) {
    if (!active || !event) {
      return;
    }
    if (isSpaceKeyboardEvent(event)) {
      logStage("space-keydown", describeKeyboardFocus(event, "dom"));
    }
    if (event.key === "Escape" && !isSubmitting && !refreshRequested) {
      event.preventDefault();
      closeSession("cancel");
    } else if (
      (event.metaKey || event.ctrlKey) &&
      event.key === "Enter"
    ) {
      event.preventDefault();
      submit("cue");
    }
  }

  function handleWindowKeyup(event) {
    if (active && isSpaceKeyboardEvent(event)) {
      logStage("space-keyup", describeKeyboardFocus(event, "dom"));
    }
  }

  function handleWindowFocusIn(event) {
    if (!active) {
      return;
    }
    const detail = describeKeyboardFocus(event, "dom");
    if (detail !== lastFocusDiagnostic) {
      lastFocusDiagnostic = detail;
      logStage("focus-change", detail);
    }
  }

  function handleCepKeydown(event) {
    const detail = event && event.detail;
    if (active && isSpaceKeyboardEvent(detail)) {
      logStage("space-keydown", describeKeyboardFocus(detail, "cep"));
    }
  }

  function handleWindowBlur() {
    if (active) {
      releaseEditorTextFocus();
    }
  }

  function handleWindowFocus() {
    if (active && isPointerOverEditor()) {
      editorPointerInside = true;
      restoreEditorFocusFromPointer();
    }
  }

  function handleBeforeUnload() {
    if (active || editorModeLease) {
      teardownSession("unload", false);
      return;
    }
    disposeEditorActions();
    disposeModelRegistry(sessionModels);
  }

  function init() {
    if (initialized) {
      return;
    }
    initialized = true;
    const commitButton = getElement("commitCodeCue");
    const baseButton = getElement("modifyBaseCode");
    const cancelButton = getElement("cancelEffectCode");
    const editorElement = getElement("editor");
    if (commitButton) {
      commitButton.addEventListener("click", function () {
        return submit("cue");
      });
    }
    if (cancelButton) {
      cancelButton.addEventListener("click", function () {
        return closeSession("cancel");
      });
    }
    if (baseButton) {
      baseButton.addEventListener("click", function () {
        return submit("base");
      });
    }
    if (editorElement) {
      editorElement.addEventListener("mouseenter", handleEditorMouseEnter);
      editorElement.addEventListener("mousemove", handleEditorMouseMove);
      editorElement.addEventListener("mouseleave", handleEditorMouseLeave);
      editorElement.addEventListener("mousedown", handleEditorMouseDown, true);
    }
    window.addEventListener("keydown", handleWindowKeydown, true);
    window.addEventListener("keyup", handleWindowKeyup, true);
    window.addEventListener("focusin", handleWindowFocusIn, true);
    window.addEventListener("focus", handleWindowFocus, true);
    window.addEventListener("blur", handleWindowBlur, true);
    window.addEventListener("momentum:cep-keydown", handleCepKeydown, true);
    window.addEventListener("beforeunload", handleBeforeUnload);
  }

  return {
    init: init,
    isActive: function () { return active; },
    open: activateSession,
  };
})();
