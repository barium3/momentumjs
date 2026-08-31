import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(
  new URL("../js/ui/effectCode.js", import.meta.url),
  "utf8",
);
const clockSource = readFileSync(
  new URL("../js/ui/effectCodeClock.js", import.meta.url),
  "utf8",
);
const timelineClockSource = readFileSync(
  new URL("../js/ui/timelineClock.js", import.meta.url),
  "utf8",
);
const diffSource = readFileSync(
  new URL("../js/ui/effectCodeDiff.js", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../js/ui/effectCode.css", import.meta.url),
  "utf8",
);

assert.match(
  styles,
  /#container\.effect-code-active #file-list[\s\S]*width: 0/,
  "Effect Code must hide the file list without changing file-manager state",
);
assert.match(
  styles,
  /\.effect-code-action[\s\S]*display: none[\s\S]*#container\.effect-code-active \.effect-code-action[\s\S]*display: flex/,
  "one mode class must own the Effect toolbar switch",
);
assert.match(
  styles,
  /#container\.effect-code-active \.effect-code-action:disabled[\s\S]*opacity: 1/,
  "Edit Code transaction locks must not dim the toolbar",
);
assert.doesNotMatch(
  styles + source,
  /effect-code-draft-committed|momentum-draft-commit/,
  "a successful Edit Code commit must remove the pending frame immediately",
);

function createElement(hidden = false) {
  const attributes = new Map();
  const listeners = new Map();
  const classes = new Set();
  return {
    children: [],
    className: "",
    hidden,
    disabled: false,
    style: {},
    textContent: "",
    title: "",
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
      toggle(name, force) {
        if (force === true) {
          classes.add(name);
          return true;
        }
        if (force === false) {
          classes.delete(name);
          return false;
        }
        if (classes.has(name)) {
          classes.delete(name);
          return false;
        }
        classes.add(name);
        return true;
      },
    },
    addEventListener(name, listener) { listeners.set(name, listener); },
    appendChild(child) { this.children.push(child); return child; },
    contains(candidate) {
      return candidate === this || this.children.some((child) =>
        child === candidate ||
        (child && typeof child.contains === "function" && child.contains(candidate))
      );
    },
    dispatch(name, event) {
      const listener = listeners.get(name);
      return listener ? listener(event || { type: name }) : undefined;
    },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    removeAttribute(name) { attributes.delete(name); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
  };
}

class MockModel {
  constructor(value, language) {
    this.value = value;
    this.language = language;
    this.disposed = false;
    this.decorations = [];
    this.nextDecorationId = 1;
  }

  ensureActive() {
    if (this.disposed) {
      throw new Error("Model is disposed!");
    }
  }
  dispose() { this.disposed = true; }
  isDisposed() { return this.disposed; }
  getLanguageId() { this.ensureActive(); return this.language; }
  getValue() { this.ensureActive(); return this.value; }
  setValue(value) {
    this.ensureActive();
    this.value = value;
    if (this === currentModel) {
      editorModelChangeListeners.slice().forEach((listener) => listener({}));
    }
  }
  getLineCount() { return this.value ? this.value.split("\n").length : 1; }
  getLineMaxColumn(lineNumber) {
    return this.value.split("\n")[lineNumber - 1].length + 1;
  }
  forceTokenization(lineNumber) {
    this.ensureActive();
    assert.equal(lineNumber, this.getLineCount());
    tokenizedModelCount += 1;
  }
  deltaDecorations(_oldIds, decorations) {
    this.decorations = decorations.slice();
    return decorations.map(() => `decoration-${this.nextDecorationId++}`);
  }
}

const elements = {
  container: createElement(),
  editor: createElement(),
  "editor-container": createElement(),
  "image-container": createElement(),
  "file-list": createElement(),
  "main-content": createElement(),
  "console-title": createElement(),
  "current-filename": createElement(),
  toggleFileList: createElement(),
  newFile: createElement(),
  newFolder: createElement(),
  renderModeSelect: createElement(),
  runEditorScript: createElement(false),
  commitCodeCue: createElement(),
  modifyBaseCode: createElement(),
  cancelEffectCode: createElement(),
};
const editorInput = createElement();
editorInput.tagName = "TEXTAREA";
let editorInputBlurCalls = 0;
editorInput.blur = function () {
  editorInputBlurCalls += 1;
  if (context.document.activeElement === editorInput) {
    context.document.activeElement = null;
  }
};
elements.editor.appendChild(editorInput);
elements["console-title"].textContent = "Console";
elements["current-filename"].textContent = "workspace.js";

const workspaceModel = new MockModel("workspace source", "javascript");
let currentModel = workspaceModel;
let editorModelChangeListeners = [];
let nextViewZoneId = 1;
const viewZones = new Map();
let readOnly = false;
let restoredViewState = null;
let suspended = 0;
let resumed = 0;
let activeConsoleChannel = "workspace";
let confirmCalls = 0;
let refreshCalls = 0;
let closeCalls = 0;
let contextMode = "new-cue";
let createdModelCount = 0;
let disposedModelCount = 0;
let fileTrackingSuspended = false;
let playheadTime = 0.5;
let contextSourceHash = "base-hash";
let contextBaseSourceHash = "base-hash";
let contextSources = [
  { sourceHash: "base-hash", source: "effect source" },
  { sourceHash: "cue-hash", source: "cue effect source" },
];
let contextReadCalls = 0;
let focusCalls = 0;
let editorPointerTargetCalls = [];
let editorPointerPosition = null;
let editorSetValueCalls = 0;
let consoleClearCalls = 0;
let lastConfirmPayload = null;
let viewClockCalls = 0;
let pendingClockTimeline = "";
let queuedViewClockTimes = [];
let viewClockPreviewing = true;
let viewClockTimeOverride = null;
let activeViewClockSessionToken = "";
let viewClockSessionTokenOverride = null;
let tokenizedModelCount = 0;
let editorLayoutCalls = 0;
let deferNextContextRead = false;
let releaseDeferredContextRead = null;
const modelSwitchValues = [];
let activeEditorLease = null;
let acquiredEditorLeases = 0;
let releasedEditorLeases = 0;
let failNextContextRead = false;
let throwNextWorkspaceLeave = false;
const capturedConsoleErrors = [];
const codeEditorDiagnosticLogs = [];

const testConsole = {
  error() { capturedConsoleErrors.push(Array.from(arguments)); },
  log: console.log.bind(console),
  warn: console.warn.bind(console),
};

function waitUntil(predicate, message) {
  const deadline = Date.now() + 1000;
  return new Promise((resolve, reject) => {
    function poll() {
      try {
        if (predicate()) {
          resolve();
          return;
        }
      } catch (_error) {}
      if (Date.now() >= deadline) {
        reject(new Error(message || "Timed out waiting for Effect Code state."));
        return;
      }
      setTimeout(poll, 5);
    }
    poll();
  });
}

function waitForCodeClock() {
  const initialCallCount = viewClockCalls;
  return waitUntil(
    () => viewClockCalls > initialCallCount,
    "Timed out waiting for the live Code clock.",
  );
}

function waitForModelValue(value) {
  return waitUntil(
    () => currentModel && currentModel.getValue() === value,
    `Timed out waiting for the model value: ${value}`,
  );
}

function waitForTimelineSync() {
  return waitUntil(
    () => pendingClockTimeline === "",
    "Timed out waiting for the Code timeline update.",
  ).then(() => new Promise((resolve) => setTimeout(resolve, 10)));
}

function waitForClockSilence() {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

const editor = {
  addAction() { return { dispose() {} }; },
  changeViewZones(callback) {
    callback({
      addZone(zone) {
        const zoneId = `zone-${nextViewZoneId++}`;
        viewZones.set(zoneId, zone);
        return zoneId;
      },
      removeZone(zoneId) { viewZones.delete(zoneId); },
    });
  },
  focus() {
    focusCalls += 1;
    context.document.activeElement = editorInput;
  },
  getTargetAtClientPoint(clientX, clientY) {
    editorPointerTargetCalls.push({ clientX, clientY });
    return { position: { lineNumber: 7, column: 4 } };
  },
  hasTextFocus() { return context.document.activeElement === editorInput; },
  hasWidgetFocus() { return elements.editor.contains(context.document.activeElement); },
  getModel() { return currentModel; },
  getRawOptions() { return { readOnly }; },
  getValue() { return currentModel.getValue(); },
  getScrollLeft() { return 0; },
  getScrollTop() { return 0; },
  layout() { editorLayoutCalls += 1; },
  onDidChangeModelContent(listener) {
    editorModelChangeListeners.push(listener);
    return {
      dispose() {
        editorModelChangeListeners = editorModelChangeListeners.filter(
          (candidate) => candidate !== listener,
        );
      },
    };
  },
  restoreViewState(state) { restoredViewState = state; },
  saveViewState() { return { lineNumber: 3, scrollTop: 96 }; },
  setModel(model) {
    if (model && model.disposed) {
      throw new Error("Model is disposed!");
    }
    currentModel = model;
    modelSwitchValues.push(model ? model.getValue() : "");
  },
  setValue(value) {
    editorSetValueCalls += 1;
    currentModel.setValue(value);
  },
  setScrollLeft() {},
  setScrollTop() {},
  setPosition(position) { editorPointerPosition = position; },
  updateOptions(options) { readOnly = !!options.readOnly; },
};

const eventListeners = new Map();
let documentFocused = false;
const context = {
  CustomEvent: class CustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options && options.detail;
    }
  },
  Date,
  Promise,
  console: testConsole,
  document: {
    activeElement: null,
    createElement() { return createElement(); },
    getElementById(id) { return elements[id] || null; },
    hasFocus() { return documentFocused; },
  },
  cep: {
    fs: {
      readFile(filePath) {
        assert.equal(filePath, "/runtime/code-editor-view-clock.txt");
        viewClockCalls += 1;
        const sampleTime = queuedViewClockTimes.length > 0
          ? queuedViewClockTimes.shift()
          : viewClockTimeOverride == null
            ? playheadTime
            : viewClockTimeOverride;
        return {
          err: 0,
          data: `view-clock-v2\t${
            viewClockSessionTokenOverride || activeViewClockSessionToken
          }\t1\t${viewClockPreviewing ? 1 : 0}\t${
            Math.round(sampleTime * 24000)
          }\t24000\n`,
        };
      },
    },
  },
  requestAnimationFrame(callback) {
    callback();
    return 1;
  },
  cancelAnimationFrame() {},
  setTimeout,
  clearTimeout,
  addEventListener(name, listener) {
    if (!eventListeners.has(name)) {
      eventListeners.set(name, []);
    }
    eventListeners.get(name).push(listener);
  },
  removeEventListener() {},
  dispatchEvent(event) {
    (eventListeners.get(event.type) || []).forEach((listener) => listener(event));
  },
  activeFile: {
    suspendEditorTracking() {
      suspended += 1;
      fileTrackingSuspended = true;
      return Promise.resolve(true);
    },
    resumeEditorTracking() {
      resumed += 1;
      fileTrackingSuspended = false;
    },
    openForTest(source) {
      if (fileTrackingSuspended || currentModel !== workspaceModel) {
        return false;
      }
      currentModel.setValue(source);
      return true;
    },
  },
  consoleManager: {
    appendExternalLine() {},
    activateChannel(channelName) { activeConsoleChannel = channelName; },
    clearConsole() { consoleClearCalls += 1; },
  },
  workspaceManager: {
    enterEffectCode() {
      elements.container.classList.add("effect-code-active");
      elements["file-list"].setAttribute("aria-disabled", "true");
      activeConsoleChannel = "effect-code";
    },
    leaveEffectCode() {
      if (throwNextWorkspaceLeave) {
        throwNextWorkspaceLeave = false;
        throw new Error("forced Workspace restore failure");
      }
      elements.container.classList.remove("effect-code-active");
      elements["file-list"].removeAttribute("aria-disabled");
      activeConsoleChannel = "workspace";
    },
  },
  debugTraceManager: {
    ensureSession() {},
    stopAndClear() { consoleClearCalls += 1; },
    updateTimelineSample() {},
    useExternalClock() {},
  },
  editorManager: {
    acquireTemporaryMode(owner) {
      if (activeEditorLease) {
        throw new Error("Editor mode already leased");
      }
      const leasedModel = currentModel;
      const leasedReadOnly = readOnly;
      const leasedViewState = editor.saveViewState();
      const lease = {
        owner,
        released: false,
        attach(model) {
          assert.equal(activeEditorLease, lease);
          assert.equal(lease.released, false);
          editor.setModel(model);
        },
        release() {
          if (lease.released) {
            return true;
          }
          editor.setModel(leasedModel);
          editor.restoreViewState(leasedViewState);
          editor.updateOptions({ readOnly: leasedReadOnly });
          lease.released = true;
          activeEditorLease = null;
          releasedEditorLeases += 1;
          return true;
        },
      };
      activeEditorLease = lease;
      acquiredEditorLeases += 1;
      return lease;
    },
    editor,
    isRunEnabled() { return true; },
    layout() {},
    setRunEnabled() {},
  },
  momentumCodeBundle: {
    buildCodeCueBundle(source, _compiled, _fileName, _controller, runtimeMetadata) {
      const sourceHashes = {
        "effect source": "base-hash",
        "modified base source": "modified-base-hash",
        "cue effect source": "cue-hash",
        "first cue source": "first-hash",
        "second cue source": "second-hash",
      };
      return {
        sourceHash: sourceHashes[source] || "unknown-hash",
        sourcePath: runtimeMetadata && runtimeMetadata.sourcePath,
        debugTracePath: runtimeMetadata && runtimeMetadata.debugTracePath,
        comp: { width: 100, height: 100, frameRate: 30, duration: 10 },
        controller: { hash: "none", configs: [] },
        momentumCodeCue: { mode: "restart" },
      };
    },
    formatDiagnostic(diagnostic) {
      return diagnostic && diagnostic.message || "Unknown compiler error";
    },
    getPrimaryDiagnostic(compiled) {
      return compiled && compiled.diagnostics && compiled.diagnostics[0] || null;
    },
    normalizeSource(value) { return String(value).replace(/\n+$/g, ""); },
    validateCodeCueContract() { return { ok: true }; },
  },
  momentumPluginBridge: {
    callExtendScript(functionName, args) {
      if (functionName === "momentumAppendCodeEditorLog") {
        codeEditorDiagnosticLogs.push(decodeURIComponent(String(args[0] || "")));
        return Promise.resolve("ok");
      }
      if (functionName === "momentumReadCodeEditorTimeline") {
        const timeline = pendingClockTimeline;
        pendingClockTimeline = "";
        return new Promise((resolve) => {
          setTimeout(function () {
            resolve(
              timeline ? `1\t${encodeURIComponent(timeline)}` : "0",
            );
          }, 0);
        });
      }
      if (functionName === "momentumGetCodeEditorContext") {
        contextReadCalls += 1;
        activeViewClockSessionToken = String(args[0] || "");
        if (failNextContextRead) {
          failNextContextRead = false;
          return Promise.resolve("Error: forced context failure");
        }
        const result = JSON.stringify({
          ok: true,
          sessionToken: args[0],
          sourceHash: contextSourceHash,
          controllerHash: "none",
          locator: { compId: 1 },
          compName: "Comp",
          debugTracePath: "/runtime/debug_trace.log",
          viewClockPath: "/runtime/code-editor-view-clock.txt",
          duration: 10,
          frameDuration: 1 / 24,
          workAreaDuration: 10,
          workAreaStart: 0,
          layerName: "Layer",
          targetMode: contextMode,
          targetTimeValue: Math.round(playheadTime * 24),
          targetTimeScale: 24,
          targetTimeSeconds: playheadTime,
          playheadTimeSeconds: playheadTime,
          baseSourceHash: contextBaseSourceHash,
          cues: [
            {
              timeValue: 24,
              timeScale: 24,
              sourceHash: "cue-hash",
            },
          ],
          sources: contextSources,
          sourceCount: contextSources.length,
          controller: { hash: "none", configs: [] },
          runtimeMetadata: {
            debugTracePath: "creation-transports/7/debug_trace.log",
            sourcePath: "creation-transports/7/sketch.js",
          },
        });
        if (deferNextContextRead) {
          deferNextContextRead = false;
          return new Promise((resolve) => {
            releaseDeferredContextRead = function () {
              releaseDeferredContextRead = null;
              resolve(result);
            };
          });
        }
        return Promise.resolve(result);
      }
      if (functionName === "momentumConfirmCodeSnapshot") {
        confirmCalls += 1;
        lastConfirmPayload = JSON.parse(decodeURIComponent(args[0]));
        return Promise.resolve(JSON.stringify({
          ok: true,
          queued: true,
          sessionToken: "session-two",
        }));
      }
      if (functionName === "momentumGetCodeEditCommitResult") {
        return Promise.resolve(JSON.stringify({
          ok: true,
          done: true,
          succeeded: true,
          message: "ok",
        }));
      }
      if (functionName === "momentumRequestCodeEditorRefresh") {
        refreshCalls += 1;
        return Promise.resolve(JSON.stringify({
          ok: true,
          queued: true,
          sessionToken: args[0],
          command: "refresh",
        }));
      }
      if (functionName === "momentumCloseCodeEditorSession") {
        closeCalls += 1;
        return Promise.resolve(JSON.stringify({
          ok: true,
          queued: true,
          sessionToken: args[0],
          command: "close",
        }));
      }
      return Promise.reject(new Error(`Unexpected host call: ${functionName}`));
    },
  },
  monaco: {
    Range: class Range {
      constructor(startLineNumber, startColumn, endLineNumber, endColumn) {
        this.startLineNumber = startLineNumber;
        this.startColumn = startColumn;
        this.endLineNumber = endLineNumber;
        this.endColumn = endColumn;
      }
    },
    Uri: { parse(value) { return value; } },
    KeyCode: { Enter: 3, Escape: 9 },
    KeyMod: { CtrlCmd: 2048 },
    editor: {
      createModel(value, language) {
        createdModelCount += 1;
        const model = new MockModel(value, language);
        const originalDispose = model.dispose.bind(model);
        model.dispose = function () {
          if (!model.disposed) {
            disposedModelCount += 1;
          }
          originalDispose();
        };
        return model;
      },
      setModelLanguage(model, language) {
        model.ensureActive();
        model.language = language;
      },
    },
  },
  sketchCompiler: {
    compile() {
      return { ok: true, rawAst: {}, config: {}, controllers: { fingerprint: "none" } };
    },
  },
};
context.window = context;
context.globalThis = context;

vm.runInNewContext(diffSource, context, { filename: "effectCodeDiff.js" });
vm.runInNewContext(timelineClockSource, context, { filename: "timelineClock.js" });
vm.runInNewContext(clockSource, context, { filename: "effectCodeClock.js" });
vm.runInNewContext(source, context, { filename: "effectCode.js" });
context.effectCodeManager.init();
context.effectCodeManager.init();
assert.equal((eventListeners.get("keydown") || []).length, 1);
assert.equal((eventListeners.get("keyup") || []).length, 1);
assert.equal((eventListeners.get("focusin") || []).length, 1);
assert.equal((eventListeners.get("focus") || []).length, 1);
assert.equal((eventListeners.get("blur") || []).length, 1);
assert.equal((eventListeners.get("momentum:cep-keydown") || []).length, 1);
assert.equal((eventListeners.get("beforeunload") || []).length, 1);

context.document.activeElement = editorInput;
deferNextContextRead = true;
const initialOpen = context.effectCodeManager.open("session-one");
await waitUntil(
  () => typeof releaseDeferredContextRead === "function",
  "Timed out waiting for the deferred Effect Code context read.",
);
assert.equal(
  elements.container.classList.contains("effect-code-active"),
  false,
  "the Effect Code surface must stay hidden until its model is ready",
);
assert.equal(
  currentModel,
  workspaceModel,
  "the workspace model must remain visible during the host context read",
);
assert.equal(elements["current-filename"].textContent, "workspace.js");
assert.equal(activeConsoleChannel, "workspace");
assert.equal(consoleClearCalls, 0);
releaseDeferredContextRead();
assert.equal(await initialOpen, true);
assert.equal(context.effectCodeManager.isActive(), true);
assert.equal(
  editorInputBlurCalls,
  1,
  "entering Edit Code must release the shared Monaco textarea focus",
);
assert.equal(
  context.document.activeElement,
  null,
  "Edit Code must not insert an intermediate DOM focus target",
);
assert.equal(focusCalls, 0, "opening Edit Code must not refocus Monaco");
await waitForCodeClock();
assert.ok(viewClockCalls > 0, "the live Code clock must start in Edit Code");
assert.equal(suspended, 1);
assert.equal(acquiredEditorLeases, 1);
assert.notEqual(currentModel, workspaceModel);
assert.equal(currentModel.getValue(), "effect source");
assert.equal(workspaceModel.disposed, false);
assert.equal(createdModelCount, 2, "both Effect source models must be created before the editor switches");
assert.equal(tokenizedModelCount, 2, "Effect source models must be tokenized before they become visible");
assert.equal(editorLayoutCalls, 1, "the editor must synchronously layout during the atomic mode switch");
assert.equal(disposedModelCount, 0, "active Effect source models must remain available for live switching");
assert.equal(elements.newFile.hidden, false);
assert.equal(elements.toggleFileList.hidden, false);
assert.equal(elements["current-filename"].textContent, "");
assert.equal(elements["console-title"].textContent, "Console");
assert.equal(elements.container.classList.contains("effect-code-active"), true);
assert.equal(
  elements.commitCodeCue.classList.contains("effect-code-keyframe-present"),
  false,
  "a timeline position without a Code keyframe must show a hollow diamond",
);
assert.equal(elements.commitCodeCue.getAttribute("aria-pressed"), "false");
assert.equal(
  elements.commitCodeCue.getAttribute("data-tooltip"),
  "Add Code keyframe",
);
assert.equal(elements["main-content"].classList.contains("effect-code-active"), false);
assert.equal(elements["file-list"].getAttribute("aria-disabled"), "true");
assert.equal(activeConsoleChannel, "effect-code");
assert.equal(
  consoleClearCalls,
  2,
  "entering Edit Code must clear both the workspace and Effect Console channels",
);
assert.equal(
  elements["editor-container"].classList.contains("effect-code-draft-dirty"),
  false,
  "a clean Effect source must not show the pending-draft frame",
);

elements.editor.dispatch("mouseenter", { clientX: 120, clientY: 80 });
elements.editor.dispatch("mousemove", { clientX: 128, clientY: 96 });
documentFocused = true;
context.dispatchEvent({ type: "focus", target: context });
assert.equal(
  focusCalls,
  1,
  "the first host activation over the editor must restore Monaco focus",
);
assert.equal(context.document.activeElement, editorInput);
assert.deepEqual(editorPointerTargetCalls, [{ clientX: 128, clientY: 96 }]);
assert.deepEqual(
  editorPointerPosition,
  { lineNumber: 7, column: 4 },
  "the activation click must restore the caret at the hovered code position",
);

context.document.activeElement = editorInput;
documentFocused = false;
context.dispatchEvent({ type: "blur", target: context });
assert.equal(
  editorInputBlurCalls,
  2,
  "leaving the CEP panel must clear Monaco's stale text-input focus",
);
assert.equal(context.document.activeElement, null);

elements.commitCodeCue.tagName = "BUTTON";
elements.commitCodeCue.id = "commitCodeCue";
context.document.activeElement = elements.commitCodeCue;
context.dispatchEvent({
  type: "focusin",
  target: elements.commitCodeCue,
  defaultPrevented: false,
});
context.dispatchEvent({
  type: "keydown",
  key: " ",
  code: "Space",
  keyCode: 32,
  target: elements.commitCodeCue,
  defaultPrevented: false,
  preventDefault() { this.defaultPrevented = true; },
});
await waitUntil(
  () => codeEditorDiagnosticLogs.some((entry) =>
    entry.includes("stage=space-keydown") &&
    entry.includes("target=button#commitCodeCue")
  ),
  "Space focus diagnostics were not recorded.",
);
assert.equal(
  context.effectCodeManager.isActive(),
  true,
  "Space diagnostics must not alter the active Edit Code session",
);

playheadTime = 1;
await waitForModelValue("cue effect source");
assert.equal(
  currentModel.getValue(),
  "cue effect source",
  "the live Code clock must switch directly to the preloaded Cue model",
);
assert.deepEqual(
  restoredViewState,
  { lineNumber: 3, scrollTop: 96 },
  "timeline model switches must retain one shared Edit Code viewport",
);
assert.equal(currentModel.decorations.length, 1);
assert.equal(
  currentModel.decorations[0].options.inlineClassName,
  "effect-code-diff-green-line effect-code-diff-flash-added",
  "a timeline Cue switch must flash its green diff highlight",
);
playheadTime = 0.5;
await waitForModelValue("effect source");
assert.equal(
  currentModel.getValue(),
  "effect source",
  "clean source models must continue following the live timeline",
);
const switchesBeforeFastCrossing = modelSwitchValues.length;
queuedViewClockTimes = [1, 0.5];
await waitUntil(
  () => modelSwitchValues.length >= switchesBeforeFastCrossing + 2,
  "Timed out waiting for the fast Cue cross-and-return.",
);
assert.deepEqual(
  modelSwitchValues.slice(switchesBeforeFastCrossing),
  ["cue effect source", "effect source"],
  "a fast Cue cross-and-return must apply both completed clock samples instead of coalescing them",
);
assert.equal(currentModel.getValue(), "effect source");
viewClockPreviewing = false;
viewClockTimeOverride = null;
const clockCallsBeforeDrag = viewClockCalls;
playheadTime = 1;
await waitForModelValue("cue effect source");
assert.ok(
  viewClockCalls > clockCallsBeforeDrag,
  "manual timeline dragging must use the native item-view clock",
);
assert.equal(
  currentModel.getValue(),
  "cue effect source",
  "the native item-view clock must apply samples when previewing is false",
);
playheadTime = 0.5;
await waitForModelValue("effect source");
viewClockSessionTokenOverride = "stale-session";
playheadTime = 1;
await waitForClockSilence();
assert.equal(
  currentModel.getValue(),
  "effect source",
  "a clock sample from another Edit Code session must be ignored",
);
viewClockSessionTokenOverride = null;
await waitForModelValue("cue effect source");
playheadTime = 0.5;
await waitForModelValue("effect source");
viewClockPreviewing = false;
viewClockTimeOverride = null;
pendingClockTimeline = "timeline-v1\n2/1\tcue-hash\n";
playheadTime = 1;
await waitForTimelineSync();
assert.equal(
  currentModel.getValue(),
  "effect source",
  "a moved Cue boundary must update locally without switching too early",
);
playheadTime = 2;
await waitForModelValue("cue effect source");
assert.equal(
  currentModel.getValue(),
  "cue effect source",
  "the live clock must use the updated Cue boundary",
);
playheadTime = 0.5;
await waitForModelValue("effect source");
currentModel.setValue("temporary effect edit");
assert.equal(
  elements["editor-container"].classList.contains("effect-code-draft-dirty"),
  true,
);
currentModel.setValue("effect source");
assert.equal(
  elements["editor-container"].classList.contains("effect-code-draft-dirty"),
  false,
  "returning to the original source must immediately remove the draft frame",
);
currentModel.setValue("discarded effect edit");
assert.equal(
  elements["editor-container"].classList.contains("effect-code-draft-dirty"),
  true,
  "the first draft edit must immediately show the pending-draft frame",
);
assert.equal(currentModel.decorations.length, 1);
assert.equal(
  currentModel.decorations[0].options.inlineClassName,
  "effect-code-diff-green-line",
  "a dirty replacement must use the same green treatment as a timeline change",
);
playheadTime = 2;
await waitForClockSilence();
assert.equal(
  currentModel.getValue(),
  "discarded effect edit",
  "a dirty draft must pin the editor instead of following the timeline",
);
assert.equal(contextReadCalls, 1, "clock samples must not reload context");
assert.equal(refreshCalls, 0, "clock samples must not write the Effect signal");
elements.cancelEffectCode.dispatch("click");
assert.equal(context.effectCodeManager.isActive(), false);
assert.equal(
  consoleClearCalls,
  4,
  "leaving Edit Code must clear both the Effect and restored workspace channels",
);
const viewClockCallsAfterClose = viewClockCalls;
await waitForClockSilence();
assert.equal(
  viewClockCalls,
  viewClockCallsAfterClose,
  "the live Code clock must stop when Edit Code closes",
);
assert.equal(currentModel, workspaceModel);
assert.equal(workspaceModel.getValue(), "workspace source");
assert.deepEqual(restoredViewState, { lineNumber: 3, scrollTop: 96 });
assert.equal(activeConsoleChannel, "workspace");
assert.equal(resumed, 1);
assert.equal(releasedEditorLeases, 1);
assert.equal(activeEditorLease, null);
assert.equal(elements.newFile.hidden, false);
assert.equal(elements.toggleFileList.hidden, false);
assert.equal(elements.container.classList.contains("effect-code-active"), false);
assert.equal(
  elements["editor-container"].classList.contains("effect-code-draft-dirty"),
  false,
  "leaving Effect Code must remove the pending-draft frame",
);
assert.equal(elements["main-content"].classList.contains("effect-code-active"), false);
assert.equal(elements["file-list"].getAttribute("aria-disabled"), null);
assert.equal(disposedModelCount, 2, "all temporary Effect Code models must be released");
assert.equal(closeCalls, 1);
assert.equal(
  context.activeFile.openForTest("opened file source"),
  true,
  "files must remain openable after cancelling Effect Code",
);
assert.equal(workspaceModel.getValue(), "opened file source");

contextMode = "new-cue";
playheadTime = 0.5;
contextSourceHash = "base-hash";
assert.equal(await context.effectCodeManager.open("session-two"), true);
assert.equal(createdModelCount, 4, "reopening must rebuild models from persisted Cue sources");
const modelsBeforeCueCommit = createdModelCount;
const switchesBeforeCueCommit = modelSwitchValues.length;
const modelBeforeCueCommit = currentModel;
assert.equal(await elements.commitCodeCue.dispatch("click"), true);
assert.equal(confirmCalls, 1);
assert.equal(lastConfirmPayload.editTarget, "cue");
assert.equal(
  lastConfirmPayload.bundle.debugTracePath,
  "creation-transports/7/debug_trace.log",
  "Code Cue commits must preserve the runtime Console path",
);
assert.equal(
  lastConfirmPayload.bundle.sourcePath,
  "creation-transports/7/sketch.js",
  "Code Cue commits must preserve the runtime source identity",
);
assert.equal(
  Object.prototype.hasOwnProperty.call(lastConfirmPayload, "sourceHash"),
  false,
  "CEP must not submit a stale source target",
);
assert.equal(
  Object.prototype.hasOwnProperty.call(lastConfirmPayload, "targetTimeValue"),
  false,
  "CEP must not submit a potentially stale playhead time",
);
assert.equal(refreshCalls, 1);
assert.equal(
  elements.commitCodeCue.classList.contains("effect-code-keyframe-present"),
  true,
  "committing a Code keyframe must immediately fill the diamond",
);
assert.equal(elements.commitCodeCue.getAttribute("aria-pressed"), "true");
assert.equal(
  elements.commitCodeCue.getAttribute("data-tooltip"),
  "Update Code keyframe",
);
assert.equal(context.effectCodeManager.isActive(), true);
assert.equal(resumed, 1);
assert.equal(
  elements.container.classList.contains("effect-code-refreshing"),
  true,
  "a pending background refresh must use the visually stable refresh state",
);
const focusCallsBeforeSeamlessRefresh = focusCalls;
const setValueCallsBeforeSeamlessRefresh = editorSetValueCalls;
const consoleClearsBeforeSeamlessRefresh = consoleClearCalls;
contextMode = "existing-cue";
assert.equal(await context.effectCodeManager.open("session-three"), true);
assert.equal(context.effectCodeManager.isActive(), true);
assert.equal(
  elements.container.classList.contains("effect-code-refreshing"),
  false,
  "the background refresh state must end when the new session is ready",
);
assert.equal(currentModel.getValue(), "effect source");
assert.equal(
  currentModel,
  modelBeforeCueCommit,
  "a Cue commit refresh must retain the visible Monaco model",
);
assert.equal(
  createdModelCount,
  modelsBeforeCueCommit,
  "a Cue commit refresh must reuse its preloaded source models",
);
assert.equal(
  modelSwitchValues.length,
  switchesBeforeCueCommit,
  "a Cue commit refresh must not remount the code editor model",
);
assert.equal(
  editorSetValueCalls,
  setValueCallsBeforeSeamlessRefresh,
  "session refresh must switch models without editor.setValue",
);
assert.equal(
  consoleClearCalls,
  consoleClearsBeforeSeamlessRefresh,
  "session refresh must not clear the shared Console",
);
assert.equal(
  focusCalls,
  focusCallsBeforeSeamlessRefresh,
  "session refresh must not steal focus from the AE timeline",
);
currentModel.setValue("modified base source");
playheadTime = 1;
await waitForClockSilence();
assert.equal(
  currentModel.getValue(),
  "modified base source",
  "editing the displayed code must pin the draft before a destination is chosen",
);
assert.equal(elements.commitCodeCue.disabled, false);
assert.equal(elements.modifyBaseCode.disabled, false);
const switchesBeforeBaseCommit = modelSwitchValues.length;
const modelBeforeBaseCommit = currentModel;
const decorationsBeforeBaseCommit = currentModel.decorations.slice();
assert.equal(await elements.modifyBaseCode.dispatch("click"), true);
assert.equal(
  elements["editor-container"].classList.contains("effect-code-draft-dirty"),
  false,
  "a committed draft must leave the persistent pending state",
);
assert.equal(
  elements["editor-container"].classList.contains("effect-code-draft-committed"),
  false,
  "a successful Modify Base Code action must not retain commit feedback",
);
assert.equal(
  currentModel,
  modelBeforeBaseCommit,
  "Modify Base Code must retain the edited Monaco model until timeline state changes",
);
assert.equal(
  modelSwitchValues.length,
  switchesBeforeBaseCommit,
  "Modify Base Code must not remount an equivalent editor surface",
);
assert.deepEqual(
  currentModel.decorations,
  decorationsBeforeBaseCommit,
  "Modify Base Code must retain its Diff visuals until the authoritative refresh",
);
assert.equal(confirmCalls, 2);
assert.equal(lastConfirmPayload.editTarget, "base");
assert.equal(
  Object.prototype.hasOwnProperty.call(lastConfirmPayload, "sourceHash"),
  false,
);
assert.equal(lastConfirmPayload.source, "modified base source");
assert.equal(refreshCalls, 2);
assert.equal(context.effectCodeManager.isActive(), true);
contextBaseSourceHash = "modified-base-hash";
contextSourceHash = "cue-hash";
contextSources = [
  { sourceHash: "modified-base-hash", source: "modified base source" },
  { sourceHash: "cue-hash", source: "cue effect source" },
];
assert.equal(await context.effectCodeManager.open("session-base-refresh"), true);
assert.equal(currentModel.getValue(), "cue effect source");
assert.equal(elements.commitCodeCue.disabled, false);
const contextReadsBeforePlayheadMove = contextReadCalls;
playheadTime = 1;
await waitForModelValue("cue effect source");
assert.equal(
  refreshCalls,
  2,
  "the live Code clock must not write the hidden Effect signal",
);
assert.equal(
  contextReadCalls,
  contextReadsBeforePlayheadMove,
  "crossing a Code Cue must not reload the editor context",
);
assert.equal(currentModel.getValue(), "cue effect source");
currentModel.setValue("preserved cue draft");
playheadTime = 0.5;
await waitForClockSilence();
assert.equal(
  currentModel.getValue(),
  "preserved cue draft",
  "an uncommitted Cue draft must remain pinned across playhead movement",
);
elements.cancelEffectCode.dispatch("click");
assert.equal(context.effectCodeManager.isActive(), false);
assert.equal(currentModel, workspaceModel);
assert.equal(resumed, 2);
assert.equal(acquiredEditorLeases, 2);
assert.equal(releasedEditorLeases, 2);
assert.equal(activeEditorLease, null);
assert.equal(closeCalls, 2);
assert.equal(
  disposedModelCount,
  createdModelCount,
  "every temporary model created across reopen and refresh must be disposed",
);

failNextContextRead = true;
assert.equal(
  await context.effectCodeManager.open("session-five"),
  false,
  "a failed context load must roll the temporary editor mode back",
);
assert.equal(context.effectCodeManager.isActive(), false);
assert.equal(currentModel, workspaceModel);
assert.equal(fileTrackingSuspended, false);
assert.equal(acquiredEditorLeases, 3);
assert.equal(releasedEditorLeases, 3);
assert.equal(resumed, 3);
assert.equal(disposedModelCount, createdModelCount);
assert.equal(
  context.activeFile.openForTest("after failed Edit Code open"),
  true,
  "files must remain usable after Edit Code fails to open",
);

assert.equal(await context.effectCodeManager.open("session-six"), true);
throwNextWorkspaceLeave = true;
assert.equal(
  elements.cancelEffectCode.dispatch("click"),
  false,
  "cleanup must report a secondary workspace UI restore failure",
);
assert.equal(context.effectCodeManager.isActive(), false);
assert.equal(currentModel, workspaceModel);
assert.equal(fileTrackingSuspended, false);
assert.equal(acquiredEditorLeases, 4);
assert.equal(releasedEditorLeases, 4);
assert.equal(resumed, 4);
assert.equal(activeEditorLease, null);
assert.equal(disposedModelCount, createdModelCount);
assert.match(
  String(capturedConsoleErrors.at(-1)?.[1]?.message || ""),
  /forced Workspace restore failure/,
);
assert.equal(
  context.activeFile.openForTest("after guarded Edit Code close"),
  true,
  "file tracking must resume even when a secondary cleanup step throws",
);

console.log("Unified Effect Code workflow: OK");
