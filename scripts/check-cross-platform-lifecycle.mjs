import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const bridgeSource = read("js/plugin/bridge.js");
const errorProtocolSource = read("js/ui/console/errorProtocol.js");
const fileSystemSource = read("js/ui/files/fileSystem.js");
const fileManagerSource = read("js/ui/files/fileManager.js");
const fontAnalyzerSource = read("js/analyzer/assets/fonts.js");
const projectFilesSource = read("jsx/plugin/projectFiles.jsx");
const manifestSource = read("CSXS/manifest.xml");
const jsxMainSource = read("jsx/main.jsx");
const hostSessionSource = read("jsx/plugin/hostSession.jsx");

assert.doesNotMatch(
  manifestSource,
  /<ScriptPath>/,
  "CEP and the manifest must not race to load the same ExtendScript entrypoint",
);
assert.match(
  manifestSource,
  /<AutoVisible>true<\/AutoVisible>/,
  "automatic panel restore must remain supported",
);
assert.match(
  jsxMainSource,
  /hostSession\.jsx/,
  "the host handshake must be an explicit JSX module",
);
assert.match(
  hostSessionSource,
  /HOST_PROTOCOL_MISMATCH[\s\S]*hostSessionId[\s\S]*userRoot[\s\S]*runtimeRoot/,
  "the handshake must validate protocol identity and canonical storage roots",
);
assert.match(
  projectFilesSource + fileSystemSource,
  /PROJECT_FILE_OPERATION_FAILED[\s\S]*momentumErrors\.create/,
  "file errors must keep a structured code across the JSX-to-CEP boundary",
);
assert.match(
  fontAnalyzerSource,
  /momentumPluginBridge\.evaluateHostScript/,
  "font catalog calls must participate in the shared host lifecycle",
);
assert.doesNotMatch(
  bridgeSource,
  /Connecting to After Effects|Waiting for After Effects/,
  "recoverable startup progress must stay out of the visible UI",
);
assert.match(
  fileManagerSource,
  /error\.retryable === true[\s\S]*reportHostUnavailable[\s\S]*whenReady\(\)[\s\S]*loadFileList/,
  "recoverable file-list failures must reconnect silently",
);

const scheduledTasks = [];
let nextTimerId = 1;
const retryDelays = [];
const eventListeners = new Map();
const bodyClasses = new Set(["panel-launch-pending"]);
const fileListElement = { innerHTML: "" };
let bootstrapAttempts = 0;
let fileListLoads = 0;
let failNextProjectRead = false;
let hostModulesPersisted = false;
let earlyPanelReveals = 0;

function setFakeTimeout(callback, delay) {
  const task = {
    callback,
    delay: Number(delay) || 0,
    id: nextTimerId++,
  };
  scheduledTasks.push(task);
  retryDelays.push(task.delay);
  return task.id;
}

function clearFakeTimeout(timerId) {
  const index = scheduledTasks.findIndex((task) => task.id === timerId);
  if (index >= 0) {
    scheduledTasks.splice(index, 1);
  }
}

class MockCSInterface {
  registerKeyEventsInterest() {}
  getSystemPath() { return "C:/mock/momentumjs"; }
  addEventListener(name, listener) { eventListeners.set(name, listener); }
  evalScript(script, callback) {
    if (script.indexOf("__momentumHostBootstrapMarker") >= 0) {
      bootstrapAttempts += 1;
      hostModulesPersisted =
        script.indexOf("var __momentumHostBootstrapResult") === 0 &&
        script.indexOf("(function() {") !== 0;
      if (bootstrapAttempts === 1) {
        return;
      }
      if (bootstrapAttempts <= 8) {
        callback("EvalScript error.");
        return;
      }
      callback(JSON.stringify({
        ok: true,
        protocolVersion: "2",
        hostSessionId: "host-session-after-modal-dialog",
        clientSessionId: "client-session",
        platform: "windows",
        extensionRoot: "C:/mock/momentumjs",
        userRoot: "C:/mock/momentumjs/user",
        runtimeRoot: "C:/Users/Test/AppData/Local/Momentum/runtime",
      }));
      return;
    }
    if (script.indexOf("momentumPeekCodeEditorOpenIntent") === 0) {
      callback("");
      return;
    }
    if (script.indexOf("projectFileCommand") === 0) {
      if (!hostModulesPersisted) {
        callback("");
        return;
      }
      if (failNextProjectRead) {
        failNextProjectRead = false;
        callback("EvalScript error.");
        return;
      }
      callback(JSON.stringify({
        ok: true,
        data: { content: "recovered file contents" },
      }));
      return;
    }
    callback("ok");
  }
}

const hostSandbox = {
  CSInterface: MockCSInterface,
  Error,
  JSON,
  Math,
  Promise,
  String,
  SystemPath: { EXTENSION: "extension" },
  clearTimeout: clearFakeTimeout,
  console: { error() {}, info() {}, log() {}, warn() {} },
  document: {
    hidden: false,
    readyState: "complete",
    body: {
      classList: {
        remove(name) {
          if (name === "panel-launch-pending" && bootstrapAttempts < 9) {
            earlyPanelReveals += 1;
          }
          bodyClasses.delete(name);
        },
      },
    },
    addEventListener(name, listener) { eventListeners.set(name, listener); },
    createElement() {
      return {
        _text: "",
        get innerHTML() { return this._text; },
        set textContent(value) { this._text = String(value); },
      };
    },
    getElementById(id) { return id === "file-list" ? fileListElement : null; },
  },
  effectCodeManager: { open() { return Promise.resolve(false); } },
  encodeURIComponent,
  fileManager: {
    loadFileList() {
      fileListLoads += 1;
      return Promise.resolve(true);
    },
  },
  setTimeout: setFakeTimeout,
  addEventListener(name, listener) { eventListeners.set(`window:${name}`, listener); },
};
hostSandbox.window = hostSandbox;
hostSandbox.globalThis = hostSandbox;
vm.runInNewContext(errorProtocolSource, hostSandbox, {
  filename: "errorProtocol.js",
});
assert.equal(
  hostSandbox.momentumErrors.normalize(
    hostSandbox.momentumErrors.create(
      "HOST_PROTOCOL_MISMATCH",
      "incompatible",
      { retryable: false },
    ),
    { retryable: true },
  ).retryable,
  false,
  "an explicit terminal error must not be converted into a retry loop",
);
const resourceEvent = hostSandbox.momentumErrors.normalize({
  type: "error",
  target: { src: "file:///C:/mock/user/asset.png" },
});
assert.match(resourceEvent.message, /asset\.png/);
assert.equal(resourceEvent.path, "file:///C:/mock/user/asset.png");
vm.runInNewContext(bridgeSource, hostSandbox, {
  filename: "bridge.js",
});

hostSandbox.momentumPluginBridge.init();
hostSandbox.momentumPluginBridge.init();
for (let guard = 0; guard < 50 && scheduledTasks.length > 0; guard += 1) {
  const task = scheduledTasks.shift();
  task.callback();
  await Promise.resolve();
  await Promise.resolve();
}
for (let flushIndex = 0; flushIndex < 8; flushIndex += 1) {
  await Promise.resolve();
}

assert.equal(bootstrapAttempts, 9);
assert.equal(
  hostModulesPersisted,
  true,
  "JSX modules must be loaded at engine scope and survive the bootstrap eval",
);
assert.equal(hostSandbox.momentumPluginBridge.getHostState(), "ready");
assert.equal(
  hostSandbox.momentumPluginBridge.getHostSession().hostSessionId,
  "host-session-after-modal-dialog",
);
assert.equal(fileListLoads, 1, "recovery must initialize the file tree exactly once");
assert.equal(scheduledTasks.length, 0, "successful recovery must stop polling");
assert.ok(
  retryDelays.some((delay) => delay >= 5000),
  "transient host failures must back off instead of flooding evalScript",
);
assert.equal(
  retryDelays.every((delay) => delay <= 5000),
  true,
  "host retry delay must remain bounded",
);
assert.equal(
  bodyClasses.has("panel-launch-pending"),
  false,
  "the panel must reveal after the host becomes ready",
);
assert.equal(
  earlyPanelReveals,
  0,
  "recoverable startup states must remain silent and hidden",
);
assert.equal(
  fileListElement.innerHTML,
  "",
  "normal startup must not put progress text in the file tree",
);

vm.runInNewContext(fileSystemSource, hostSandbox, {
  filename: "fileSystem.js",
});
failNextProjectRead = true;
const recoveredRead = hostSandbox.fileSystem.readTextFile("C:/mock/user/sketch.js");
for (let guard = 0; guard < 20; guard += 1) {
  await Promise.resolve();
  await Promise.resolve();
  if (scheduledTasks.length === 0) {
    continue;
  }
  const task = scheduledTasks.shift();
  task.callback();
}
assert.equal(
  await recoveredRead,
  "recovered file contents",
  "an idempotent file read must wait for host recovery and retry safely",
);
assert.equal(hostSandbox.momentumPluginBridge.getHostState(), "ready");

const bitmapBootstrapSource = read(
  "js/ui/editor/bitmapControllerBootstrap.js",
);
let realImageLoads = 0;
let removedRuntimes = 0;

function FakeP5(sketch) {
  this.width = 100;
  this.height = 100;
  sketch(this);
  if (typeof this.setup === "function") {
    this.setup();
  }
}
FakeP5.prototype.createCanvas = function (width, height) {
  this.width = width;
  this.height = height;
};
FakeP5.prototype.noLoop = function () {};
FakeP5.prototype.loadImage = function () {
  realImageLoads += 1;
  return { width: 99, height: 99 };
};
FakeP5.prototype.image = function () {};
FakeP5.prototype.remove = function () { removedRuntimes += 1; };

const bitmapSandbox = {
  Array,
  JSON,
  Math,
  Number,
  Object,
  Promise,
  String,
  compilerAst: {
    parse() { throw new Error("AST instrumentation is not needed in this fixture"); },
  },
  compilerControllerCollectionPass: {
    callsitePrefix: "controller:",
    isFactoryName(name) { return name === "createSlider"; },
  },
  document: {
    body: {
      appendChild(node) { node.parentNode = this; },
      removeChild(node) { node.parentNode = null; },
    },
    createElement() { return { parentNode: null, style: {} }; },
  },
  functionRegistry: {
    getAllFunctions() { return ["loadImage", "image"]; },
    getAllVariables() { return []; },
  },
  p5: FakeP5,
  setTimeout,
};
bitmapSandbox.window = bitmapSandbox;
bitmapSandbox.globalThis = bitmapSandbox;
vm.runInNewContext(bitmapBootstrapSource, bitmapSandbox, {
  filename: "bitmapControllerBootstrap.js",
});

const bitmapService = bitmapSandbox.momentumBitmapControllerBootstrap.createService({
  absolutizeBitmapAssetCalls(source) { return source; },
  buildExecutionPlan() { return { globalVars: { width: 100, height: 100 } }; },
  getCompiler() { return { compile() { return { ok: true }; } }; },
});
const controllerConfigs = await bitmapService.discoverBitmapControllers(
  [
    "let img;",
    "let data;",
    "function preload() {",
    "  img = loadImage('asset.png');",
    "  loadJSON('data.json', 'json', function (value) { data = value; });",
    "}",
    "function setup() { createSlider(0, 100, img.width); image(img, 0, 0); }",
  ].join("\n"),
  { ok: true },
);

assert.equal(realImageLoads, 0, "controller discovery must never start real image I/O");
assert.equal(removedRuntimes, 1, "the temporary p5 runtime must still be cleaned up");
assert.equal(controllerConfigs.length, 1);
assert.equal(controllerConfigs[0].type, "slider");
assert.equal(controllerConfigs[0].value, 1);

console.log("Cross-platform host lifecycle and asset sandbox: OK");
