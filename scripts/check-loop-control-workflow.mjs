#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function loadInclude(relativePath, context) {
  const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
  vm.runInContext(source, context, { filename: relativePath });
}

const generatorContext = vm.createContext({ console, pub: {} });
loadInclude("bundle/includes/core.js", generatorContext);
loadInclude("bundle/includes/environment.js", generatorContext);
loadInclude("bundle/includes/structure.js", generatorContext);

function buildVectorExpression({
  setupBody = "",
  drawBody = "",
  eventBody = "",
} = {}) {
  const dependencies = {
    frameCount: true,
    isLooping: true,
    loop: true,
    noLoop: true,
    redraw: true,
  };

  return [
    generatorContext.getCorePreludeLib(),
    generatorContext.getEngineStateLib({}, {}, {}, {}),
    generatorContext.getEnvironmentLib(dependencies),
    "var __user__ = {",
    "  preload: null,",
    `  setup: function () { ${setupBody} },`,
    `  draw: function () { ${drawBody} }`,
    "};",
    generatorContext.getFrameCachePreludeLib(),
    generatorContext.getPreloadRunLib(" or timeline rewind"),
    generatorContext.getSetupLib("// Run setup on first execution or timeline rewind", false),
    eventBody,
    generatorContext.getDrawLoopLib(false, dependencies),
    "JSON.stringify(_ctx);",
  ].join("\n");
}

function evaluateVectorFrame(source, frame, previousState = "") {
  const fps = 30;
  const sandbox = {
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    parseInt,
    isFinite,
    time: frame / fps,
    currentTime: frame / fps,
    currentFrame: frame,
    fps,
    thisComp: {
      frameDuration: 1 / fps,
      width: 1920,
      height: 1080,
    },
    thisProperty: {
      valueAtTime() {
        return previousState;
      },
    },
    timeToFrames(value) {
      return Math.round(value * fps);
    },
  };

  return JSON.parse(vm.runInNewContext(source, sandbox, {
    filename: "generated-loop-control-expression.js",
  }));
}

{
  const expression = buildVectorExpression({
    setupBody: "noLoop(); redraw(5);",
    drawBody: "(_ctx.observedFrames || (_ctx.observedFrames = [])).push(frameCount);",
  });
  const state = evaluateVectorFrame(expression, 0);

  assert.equal(state._looping, false, "noLoop() in setup must stop subsequent frames");
  assert.equal(state._drawCount, 1, "setup must still be followed by one mandatory draw");
  assert.deepEqual(state.observedFrames, [1], "the first user draw must observe frameCount 1");
  assert.equal(state._redrawRequested, 0, "redraw() in setup must be ignored");
}

{
  const expression = buildVectorExpression({
    drawBody: [
      "(_ctx.observedFrames || (_ctx.observedFrames = [])).push(frameCount);",
      "redraw(4);",
      "noLoop();",
    ].join(" "),
  });
  const first = evaluateVectorFrame(expression, 0);
  const second = evaluateVectorFrame(expression, 1, JSON.stringify(first));

  assert.equal(first._drawCount, 1);
  assert.equal(second._drawCount, 1, "redraw() in draw must not schedule extra draws");
  assert.equal(second._looping, false);
}

{
  const initialExpression = buildVectorExpression({
    setupBody: "noLoop();",
    drawBody: "(_ctx.observedFrames || (_ctx.observedFrames = [])).push(frameCount);",
  });
  const initial = evaluateVectorFrame(initialExpression, 0);
  const redrawExpression = buildVectorExpression({
    setupBody: "noLoop();",
    drawBody: "(_ctx.observedFrames || (_ctx.observedFrames = [])).push(frameCount);",
    eventBody: "__momentumPhase = 'event'; redraw(3); __momentumPhase = 'idle';",
  });
  const redrawn = evaluateVectorFrame(redrawExpression, 1, JSON.stringify(initial));

  assert.equal(redrawn._looping, false);
  assert.equal(redrawn._drawCount, 4, "redraw(3) must execute exactly three user draws");
  assert.deepEqual(redrawn.observedFrames, [1, 2, 3, 4]);
}

{
  const initialExpression = buildVectorExpression({
    setupBody: "noLoop();",
    drawBody: "(_ctx.observedFrames || (_ctx.observedFrames = [])).push(frameCount);",
  });
  const initial = evaluateVectorFrame(initialExpression, 0);
  const resumedExpression = buildVectorExpression({
    setupBody: "noLoop();",
    drawBody: "(_ctx.observedFrames || (_ctx.observedFrames = [])).push(frameCount);",
    eventBody: "__momentumPhase = 'event'; loop(); __momentumPhase = 'idle';",
  });
  const resumed = evaluateVectorFrame(resumedExpression, 1, JSON.stringify(initial));

  assert.equal(resumed._looping, true);
  assert.equal(resumed._drawCount, 2, "loop() must resume drawing on the current host evaluation");
  assert.deepEqual(resumed.observedFrames, [1, 2]);
}

const controllerSource = fs.readFileSync(
  path.join(repoRoot, "src/plugin/scripting/api/controller.cpp"),
  "utf8",
);
const controllerChunks = Array.from(
  controllerSource.matchAll(/R"MOMENTUM_BOOT\(([\s\S]*?)\)MOMENTUM_BOOT"/g),
  (match) => match[1],
);
assert.ok(controllerChunks.length > 0, "controller bootstrap source was not found");

const controllerContext = vm.createContext({
  __momentumBaselineGlobals: Object.create(null),
  __momentumReviveValue(value) {
    return value;
  },
  __momentumSanitize(value) {
    return value;
  },
});
vm.runInContext(controllerChunks.join("\n"), controllerContext, {
  filename: "controller-bootstrap.js",
});
vm.runInContext(
  [
    "var __changeCount = 0;",
    "var __requestedRedraws = 0;",
    "function redraw(count) { __requestedRedraws += count; }",
    "var __slider = createSlider(0, 100, 10, 1);",
    "var __returnedSlider = __slider.changed(function () {",
    "  __changeCount += 1;",
    "  redraw(2);",
    "});",
  ].join("\n"),
  controllerContext,
);

const emptyControllerState = {
  sliders: [10],
  angles: [],
  colors: [],
  checkboxes: [],
  selects: [],
  points: [],
};
controllerContext.__momentumApplyControllerState(emptyControllerState, false);
controllerContext.__momentumApplyControllerState(emptyControllerState, true);
controllerContext.__momentumApplyControllerState(
  { ...emptyControllerState, sliders: [25] },
  true,
);

assert.equal(controllerContext.__returnedSlider, controllerContext.__slider);
assert.equal(controllerContext.__changeCount, 1, "changed() must only fire for a real value change");
assert.equal(controllerContext.__requestedRedraws, 2);

console.log("Loop-control workflow checks passed.");
