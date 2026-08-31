import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(
  new URL("../js/ui/timelineClock.js", import.meta.url),
  "utf8",
);

const context = {
  Math,
  Number,
  Object,
  Promise,
  clearTimeout,
  setTimeout,
};
context.window = context;
context.globalThis = context;
vm.runInNewContext(source, context, { filename: "timelineClock.js" });

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
      setTimeout(poll, 2);
    }
    poll();
  });
}

let readCalls = 0;
let concurrentReads = 0;
let maximumConcurrentReads = 0;
let releaseRead = null;
const samples = [];
const clock = context.momentumTimelineClock.createClock({
  isActive() { return true; },
  isPaused() { return false; },
  onSample(sample) { samples.push(sample); },
  readSample() {
    readCalls += 1;
    concurrentReads += 1;
    maximumConcurrentReads = Math.max(maximumConcurrentReads, concurrentReads);
    return new Promise((resolve) => {
      releaseRead = function (sample) {
        concurrentReads -= 1;
        releaseRead = null;
        resolve(sample);
      };
    });
  },
  sampleDelayMs: 1,
});

clock.start();
await waitUntil(
  () => readCalls === 1 && typeof releaseRead === "function",
  "the timeline reader did not start",
);
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(readCalls, 1, "an unresolved timeline read must never overlap");
releaseRead({ active: true, timeSeconds: 0.25, previewing: true });
await waitUntil(
  () => samples.length === 1 && readCalls === 2,
  "the next serialized timeline read did not start",
);
assert.equal(samples[0].timeSeconds, 0.25);
assert.equal(samples[0].previewing, true);
assert.equal(maximumConcurrentReads, 1);

clock.stop();
const sampleCountAfterStop = samples.length;
if (releaseRead) {
  releaseRead({ active: true, timeSeconds: 0.5 });
}
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(
  samples.length,
  sampleCountAfterStop,
  "stopping the clock must ignore an obsolete reader result",
);

assert.doesNotMatch(
  source,
  /stall|predict|requestAnimationFrame/,
  "the retired request-stall playback inference must not return",
);

console.log("Timeline playback reader: OK");
