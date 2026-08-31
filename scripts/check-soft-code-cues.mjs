import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const context = {
  console,
  devicePixelRatio: 1,
  momentumPluginBitmap: {
    RUNTIME_TARGET: "momentum-plugin-js-runtime",
    getCompConfig() {
      return { width: 100, height: 100, duration: 1, frameRate: 30 };
    },
  },
};
context.window = context;
context.globalThis = context;

vm.runInNewContext(read("js/vendor/acorn.min.js"), context, {
  filename: "acorn.min.js",
});
for (const compilerFile of [
  "bundle/includes/registry.js",
  "js/compiler/core/ast.js",
  "js/compiler/core/context.js",
  "js/compiler/core/symbols.js",
  "js/compiler/core/semantics.js",
  "js/compiler/core/typeInference.js",
  "js/compiler/core/callValidation.js",
  "js/compiler/collectors/entryPoints.js",
  "js/compiler/collectors/globalBindings.js",
  "js/compiler/collectors/environmentConfig.js",
  "js/compiler/collectors/controllerCollection.js",
  "js/compiler/collectors/assetCollection.js",
  "js/compiler/validators/undeclaredIdentifiers.js",
  "js/compiler/validators/assetValidationPass.js",
  "js/compiler/validators/callValidationPass.js",
  "js/compiler/analyzers/conditionAnalysis.js",
  "js/compiler/analyzers/loopAnalysis.js",
  "js/compiler/analyzers/backgroundAnalysis.js",
  "js/compiler/analyzers/dependencyAnalysis.js",
  "js/compiler/analyzers/runtimeAnalysis.js",
  "js/compiler/rewriters/callsiteInstrumentation.js",
  "js/compiler/rewriters/reservedData.js",
  "js/compiler/compilerPipeline.js",
]) {
  vm.runInNewContext(read(compilerFile), context, { filename: compilerFile });
}
vm.runInNewContext(read("js/compiler/analyzers/codeCueSafety.js"), context, {
  filename: "codeCueSafety.js",
});
vm.runInNewContext(read("js/ui/codeBundle.js"), context, {
  filename: "codeBundle.js",
});

const codeBundle = context.momentumCodeBundle;
const analyzer = context.compilerCodeCueSafety;
assert.ok(codeBundle);
assert.ok(analyzer);
assert.equal(analyzer.SAFETY_VERSION, 7);
assert.equal(codeBundle.analyzeBasicSoftCodeTransition, undefined);
assert.equal(
  codeBundle.normalizeSource("\ufefflet x = 0;\r\n\r\n"),
  "let x = 0;",
);

function bundleFor(source) {
  const compiled = context.sketchCompiler.compile(source);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics || []));
  return codeBundle.buildCodeCueBundle(
    source,
    compiled,
    "Code Cue Test",
    { hash: "none", configs: [] },
  );
}

function canApplyTarget(previousBundle, nextBundle) {
  const previous = previousBundle.momentumCodeCue;
  const next = nextBundle.momentumCodeCue;
  return previous.safetyVersion === 7 &&
    next.safetyVersion === 7 &&
    next.mode === "soft" &&
    next.hasDraw === true &&
    next.contextHash !== "" &&
    next.contextHash === previous.contextHash &&
    next.targetPatchSource !== "";
}

const base = `
let counter = 0;
function setup() {
  createCanvas(100, 100);
}
function advance(value) {
  return value + 1;
}
function draw() {
  counter += advance(1);
  return counter;
}
`;
const cueB = base.replace("value + 1", "value + 5");
const cueC = base.replace("value + 1", "value + 9");
const baseBundle = bundleFor(base);
const bundleB = bundleFor(cueB);
const bundleC = bundleFor(cueC);

for (const bundle of [baseBundle, bundleB, bundleC]) {
  const metadata = bundle.momentumCodeCue;
  assert.equal(metadata.safetyVersion, 7);
  assert.equal(metadata.mode, "soft");
  assert.equal(metadata.reason, "ast-target-patch");
  assert.equal(metadata.hasDraw, true);
  assert.match(metadata.targetPatchSource, /__momentumNextBinding/);
  assert.match(metadata.targetPatchSource, /\["draw"\]/);
  assert.match(metadata.targetPatchSource, /\["advance"\]/);
  assert.equal("previousSourceHash" in metadata, false);
  assert.equal("patchSource" in metadata, false);
  assert.equal("drawBody" in metadata, false);
}

assert.equal(baseBundle.momentumCodeCue.contextHash, bundleB.momentumCodeCue.contextHash);
assert.equal(bundleB.momentumCodeCue.contextHash, bundleC.momentumCodeCue.contextHash);
assert.notEqual(baseBundle.momentumCodeCue.semanticHash, bundleB.momentumCodeCue.semanticHash);
assert.equal(canApplyTarget(baseBundle, bundleB), true);
assert.equal(canApplyTarget(bundleB, baseBundle), true);
assert.equal(canApplyTarget(bundleC, bundleB), true);

const runtime = vm.createContext({});
vm.runInContext(base, runtime, { filename: "base.js" });
assert.equal(vm.runInContext("draw()", runtime), 2);
vm.runInContext(bundleB.momentumCodeCue.targetPatchSource, runtime, {
  filename: "cue-b-target.js",
});
assert.equal(vm.runInContext("draw()", runtime), 8);
vm.runInContext(baseBundle.momentumCodeCue.targetPatchSource, runtime, {
  filename: "base-target.js",
});
assert.equal(
  vm.runInContext("draw()", runtime),
  10,
  "moving back to an earlier Cue must apply its own target without rebuilding metadata",
);
vm.runInContext(bundleC.momentumCodeCue.targetPatchSource, runtime, {
  filename: "cue-c-target.js",
});
assert.equal(vm.runInContext("draw()", runtime), 20);

const setupEdit = base.replace("createCanvas(100, 100)", "createCanvas(200, 100)");
const globalEdit = base.replace("let counter = 0", "let counter = 10");
const lifecycleEdit = base.replace(
  "counter += advance(1);",
  "createCanvas(100, 100);\n  counter += advance(1);",
);
for (const changedSource of [setupEdit, globalEdit, lifecycleEdit]) {
  const changedBundle = bundleFor(changedSource);
  assert.notEqual(
    changedBundle.momentumCodeCue.contextHash,
    baseBundle.momentumCodeCue.contextHash,
  );
  assert.equal(
    canApplyTarget(baseBundle, changedBundle),
    false,
    "state, lifecycle, and setup changes must become runtime Restart boundaries",
  );
}

const addedHelper = base.replace(
  "function advance(value)",
  "function unused() { return 0; }\nfunction advance(value)",
);
const addedHelperBundle = bundleFor(addedHelper);
assert.notEqual(
  addedHelperBundle.momentumCodeCue.contextHash,
  baseBundle.momentumCodeCue.contextHash,
  "binding additions must change structural compatibility",
);

const escapedHelper = `
let counter = 0;
function setup() { createCanvas(100, 100); }
function advance(value) { return value + 1; }
const callbacks = [advance];
function draw() { counter += callbacks[0](1); }
`;
const escapedMetadata = analyzer.buildTargetMetadata(escapedHelper);
assert.equal(escapedMetadata.mode, "restart");
assert.match(escapedMetadata.reason, /function-reference-escaped/);
assert.equal(escapedMetadata.targetPatchSource, "");

const classSource = `
function setup() { createCanvas(100, 100); }
class Particle { step() { return 1; } }
function draw() { return new Particle().step(); }
`;
const classMetadata = analyzer.buildTargetMetadata(classSource);
assert.equal(classMetadata.mode, "restart");
assert.equal(classMetadata.reason, "unsupported-target-class");

const expressionBase = `
let counter = 0;
function setup() { createCanvas(100, 100); }
let advance = function(value) { return value + 1; };
function draw() { counter += advance(1); return counter; }
`;
const expressionEdit = expressionBase.replace("value + 1", "value + 3");
const expressionBaseBundle = bundleFor(expressionBase);
const expressionEditBundle = bundleFor(expressionEdit);
assert.equal(canApplyTarget(expressionBaseBundle, expressionEditBundle), true);
const expressionRuntime = vm.createContext({});
vm.runInContext(expressionBase, expressionRuntime);
vm.runInContext(expressionEditBundle.momentumCodeCue.targetPatchSource, expressionRuntime);
assert.equal(vm.runInContext("draw()", expressionRuntime), 4);

const normalizedBundle = bundleFor(base);
const transportVariantBundle = bundleFor(base.replace(/\n/g, "\r\n") + "\r\n");
assert.equal(transportVariantBundle.sourceHash, normalizedBundle.sourceHash);
assert.equal(
  transportVariantBundle.momentumCodeCue.semanticHash,
  normalizedBundle.momentumCodeCue.semanticHash,
);

console.log("Order-independent AST Code Cue targets: OK");
