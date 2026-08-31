import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(
  new URL("../js/ui/editor/bitmapControllerBootstrap.js", import.meta.url),
  "utf8",
);
const executorSource = readFileSync(
  new URL("../js/ui/editor/codeExecutor.js", import.meta.url),
  "utf8",
);

const context = {
  Promise,
  compilerControllerCollectionPass: {
    callsitePrefix: "__momentum_controller__",
    callsiteId() {
      return "__momentum_controller__test";
    },
    isFactoryName() {
      return true;
    },
  },
};
context.window = context;
context.globalThis = context;
vm.runInNewContext(source, context, {
  filename: "bitmapControllerBootstrap.js",
});

let absolutizeCount = 0;
let planCount = 0;
let compilerCount = 0;
const service = context.momentumBitmapControllerBootstrap.createService({
  absolutizeBitmapAssetCalls(code) {
    absolutizeCount += 1;
    return code;
  },
  buildExecutionPlan() {
    planCount += 1;
    return {
      globalVars: {
        width: 100,
        height: 100,
      },
    };
  },
  getCompiler() {
    compilerCount += 1;
    return {
      compile() {
        return { ok: true };
      },
    };
  },
});

assert.deepEqual(Object.keys(service), ["discoverBitmapControllers"]);
const controllers = await service.discoverBitmapControllers("draw();", {
  ok: true,
});
assert.deepEqual(Array.from(controllers), []);
assert.equal(absolutizeCount, 1);
assert.equal(planCount, 1);
assert.equal(compilerCount, 0);

let executorBootstrapOptions = null;
const executorCompiler = { compile() {} };
const executorContext = {
  Promise,
  momentumBitmapControllerBootstrap: {
    createService(options) {
      executorBootstrapOptions = options;
      return { discoverBitmapControllers() { return Promise.resolve([]); } };
    },
  },
  momentumPluginAsset: { absolutizeBitmapAssetCalls() {} },
  sketchCompiler: executorCompiler,
};
executorContext.window = executorContext;
executorContext.globalThis = executorContext;
vm.runInNewContext(executorSource, executorContext, {
  filename: "codeExecutor.js",
});
assert.ok(
  executorContext.codeExecutor,
  "Code Executor must finish loading without undeclared dependencies",
);
assert.equal(
  executorBootstrapOptions.getCompiler(),
  executorCompiler,
  "Bitmap Controller bootstrap must receive the fixed compiler contract",
);

console.log("Code Executor bootstrap workflow: OK");
