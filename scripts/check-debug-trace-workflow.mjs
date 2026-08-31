import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(
  new URL("../js/ui/console/debugTraceManager.js", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  source,
  /callExtendScript\("readFileSegment"/,
  "Console trace files must not be read through the blocked ExtendScript queue",
);
assert.match(
  source,
  /window\.cep\.fs\.readFile/,
  "Console trace files must be read directly by CEP",
);

let traceText = [
  "frame=1 time=0.000 level=log message=first",
  "frame=2 time=0.033 level=warn message=second",
  "",
].join("\n");
const appended = [];
let directReadCalls = 0;
let clockStarts = 0;
let clockStops = 0;
let consoleClears = 0;
let timelineClockOptions = null;

const context = {
  console,
  clearTimeout,
  setTimeout,
  document: {
    hidden: false,
    addEventListener() {},
  },
  cep: {
    fs: {
      readFile(path) {
        directReadCalls += 1;
        assert.equal(path, "/runtime/debug_trace.log");
        return { err: 0, data: traceText };
      },
    },
  },
  consoleManager: {
    appendExternalLine(text, level) {
      appended.push({ level, text });
    },
    clearConsole() {
      consoleClears += 1;
    },
  },
  momentumPluginBridge: {
    callExtendScript() {
      throw new Error("the fake timeline clock must own host reads");
    },
  },
  momentumTimelineClock: {
    createClock(options) {
      timelineClockOptions = options;
      return {
        start() { clockStarts += 1; },
        stop() { clockStops += 1; },
      };
    },
  },
};
context.window = context;
context.globalThis = context;
vm.runInNewContext(source, context, { filename: "debugTraceManager.js" });

function waitUntil(predicate, message) {
  const deadline = Date.now() + 1000;
  return new Promise((resolve, reject) => {
    function poll() {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(message));
        return;
      }
      setTimeout(poll, 5);
    }
    poll();
  });
}

context.debugTraceManager.init();
context.debugTraceManager.startSession({
  compId: 11,
  filePath: "/runtime/debug_trace.log",
});
await waitUntil(
  () => appended.length === 2,
  "direct CEP trace reading did not reach the Console",
);
assert.ok(directReadCalls > 0);
assert.equal(clockStarts, 1);
assert.deepEqual(
  appended.map((entry) => entry.text),
  ["[f1 t0.000] first", "[f2 t0.033] second"],
);

context.debugTraceManager.useExternalClock(true);
assert.ok(clockStops >= 2, "Edit Code must replace the Console host clock");
context.debugTraceManager.updateTimelineSample({
  active: true,
  compId: 11,
  frameDuration: 1 / 30,
  timeSeconds: 1 / 30,
});
assert.equal(appended.length, 3);
assert.equal(
  appended.at(-1).text,
  "[f2 t0.033] second",
  "Edit Code time samples must replay the matching cached frame log",
);

traceText += "frame=3 time=0.067 level=log message=third\n";
await waitUntil(
  () => appended.some((entry) => entry.text === "[f3 t0.067] third"),
  "new render logs must stay live while the host clock is external",
);
context.debugTraceManager.useExternalClock(false);
timelineClockOptions.onSample({
  active: true,
  compId: 12,
  frameDuration: 1 / 30,
  timeSeconds: 0,
});
assert.equal(
  consoleClears,
  1,
  "switching away from the tracked composition must stop and clear Console",
);
context.debugTraceManager.stop();

console.log("Console trace playback workflow: OK");
