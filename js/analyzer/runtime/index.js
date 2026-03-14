// Hidden-canvas runtime used for render-count and dependency analysis.
var functionRegistry;
if (typeof window !== "undefined" && window.functionRegistry) {
  functionRegistry = window.functionRegistry;
} else {
  throw new Error(
    "[Runtime] functionRegistry not found! " +
      "Please ensure bundle/includes/registry.js is loaded before this script.",
  );
}

initRegistryUtils(functionRegistry);
initDependencyAnalyzer(functionRegistry);

function ensureP5Vector(p) {
  if (p && p.constructor && p.constructor.Vector) {
    var P5Vector = p.constructor.Vector;
    window.createVector = function (x, y, z) {
      return new P5Vector(x, y, z);
    };
    if (typeof window.p5 === "undefined") {
      window.p5 = p.constructor;
    }
    return;
  }
}

function exposeVariables(variables, p) {
  if (!p) {
    return;
  }

  ensureP5Vector(p);

  variables.forEach(function (varName) {
    if (window.hasOwnProperty(varName) && window[varName] !== undefined) {
      return;
    }

    if (varName in p && p[varName] !== undefined) {
      window[varName] = p[varName];
      return;
    }

    if (typeof p5 !== "undefined") {
      if (
        p5.hasOwnProperty &&
        p5.hasOwnProperty(varName) &&
        p5[varName] !== undefined
      ) {
        window[varName] = p5[varName];
        return;
      }
      if (
        p5.prototype &&
        varName in p5.prototype &&
        p5.prototype[varName] !== undefined
      ) {
        window[varName] = p5.prototype[varName];
        return;
      }
    }

    if (typeof Math !== "undefined" && Math.hasOwnProperty(varName)) {
      window[varName] = Math[varName];
      return;
    }

    if (typeof functionRegistry !== "undefined" && functionRegistry) {
      var cats = ["typography", "math", "environment", "colors", "transforms"];
      for (var i = 0; i < cats.length; i++) {
        var cat = cats[i];
        var group = functionRegistry[cat];
        if (!group || !group.hasOwnProperty || !group.hasOwnProperty(varName))
          continue;
        var item = group[varName];
        if (item && (item.type === "constant" || item.type === "variable")) {
          window[varName] =
            item.internal !== undefined ? item.internal : varName;
          return;
        }
      }
    }
  });
}

function clearUserEntryPoints() {
  if (typeof window.setup !== "undefined") delete window.setup;
  if (typeof window.draw !== "undefined") delete window.draw;
}

function cleanupGlobals(allFunctions, allVariables) {
  allFunctions.forEach(function (funcName) {
    if (funcName === "print" && window.__momentumOriginalPrint !== undefined) {
      try {
        window.print = window.__momentumOriginalPrint;
      } catch (e0) {}
      try {
        delete window.__momentumOriginalPrint;
      } catch (e00) {
        window.__momentumOriginalPrint = undefined;
      }
      return;
    }
    if (window[funcName]) {
      delete window[funcName];
    }
  });
  allVariables.forEach(function (varName) {
    if (window.hasOwnProperty(varName)) {
      delete window[varName];
    }
  });

  if (window.__momentumStubs) {
    for (var k in window.__momentumStubs) {
      if (
        window.__momentumStubs.hasOwnProperty(k) &&
        window.__momentumStubs[k]
      ) {
        try {
          delete window[k];
        } catch (e) {
          window[k] = undefined;
        }
      }
    }
    try {
      delete window.__momentumStubs;
    } catch (e2) {
      window.__momentumStubs = undefined;
    }
  }
}

function getP5Function(p, funcName) {
  var p5Proto =
    p.constructor && p.constructor.prototype
      ? p.constructor.prototype
      : p5.prototype;
  var original = p5Proto ? p5Proto[funcName] : null;
  if (!original && p[funcName]) {
    original = p[funcName];
  }
  return original && typeof original === "function" ? original : null;
}

function shouldUseLoopAnalyzer(code) {
  if (!code || typeof code !== "string") return false;
  var hasLoop =
    code.indexOf("for") !== -1 ||
    code.indexOf("while") !== -1 ||
    code.indexOf("do {") !== -1 ||
    code.indexOf("do{") !== -1;
  if (!hasLoop) return false;
  return (
    code.indexOf("random(") !== -1 ||
    code.indexOf("frameCount") !== -1 ||
    code.indexOf(".value(") !== -1 ||
    code.indexOf(".degrees(") !== -1 ||
    code.indexOf(".radians(") !== -1
  );
}

function createExecutionState(overrides) {
  return Object.assign(
    {
      renderOrder: [],
      loopExecutions: { value: 0 },
      backgroundInfo: { hasAlpha: false },
      slotCounters: {},
      imageLoadTracker: { pending: [] },
      tableLoadTracker: { pending: [] },
      jsonLoadTracker: { pending: [] },
      suppressPrint: false,
      suppressConsole: false,
    },
    overrides || {},
  );
}

function collectLoadPromises(state) {
  return Promise.all([
    waitForMomentumImageLoads(state.imageLoadTracker),
    waitForMomentumTableLoads(state.tableLoadTracker),
    waitForMomentumJSONLoads(state.jsonLoadTracker),
  ]);
}

function suppressRuntimeConsole(state) {
  if (!state || !state.suppressConsole || state._consoleRestore) {
    return;
  }

  var originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  var noop = function () {};
  console.log = noop;
  console.info = noop;
  console.warn = noop;
  console.error = noop;

  state._consoleRestore = function () {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    state._consoleRestore = null;
  };
}

function restoreRuntimeConsole(state) {
  if (state && typeof state._consoleRestore === "function") {
    state._consoleRestore();
  }
}

function createTimeoutTask(timeout, message, executor) {
  return new Promise(function (resolve, reject) {
    var timeoutId = setTimeout(function () {
      reject(new Error(message));
    }, timeout);

    function finish(handler, value) {
      clearTimeout(timeoutId);
      handler(value);
    }

    try {
      executor(
        function (value) {
          finish(resolve, value);
        },
        function (err) {
          finish(reject, err);
        },
      );
    } catch (err) {
      finish(reject, err);
    }
  });
}

class P5Runtime {
  constructor(options = {}) {
    this.options = {
      timeout: options.timeout || 2000,
      maxLoopCount: options.maxLoopCount || 1000,
      canvasContainer: options.canvasContainer || document.body,
    };

    this.renderFunctions = functionRegistry.getRenderFunctions();
    this.p5Functions = functionRegistry.getP5Functions();
    this.allFunctions = functionRegistry.getAllFunctions();
    this.allVariables = functionRegistry.getAllVariables
      ? functionRegistry.getAllVariables()
      : [];

    this.p5Instance = null;
    this.initialized = false;
    this.container = null;
    this.initPromise = null;

    var ConditionalCtor =
      typeof CompilerConditionAnalysis !== "undefined"
        ? CompilerConditionAnalysis
        : typeof ConditionalAnalyzer !== "undefined"
          ? ConditionalAnalyzer
          : null;
    var LoopCtor =
      typeof CompilerLoopAnalysis !== "undefined"
        ? CompilerLoopAnalysis
        : typeof LoopAnalyzer !== "undefined"
          ? LoopAnalyzer
          : null;

    this.conditionalAnalyzer = ConditionalCtor ? new ConditionalCtor() : null;
    this.loopAnalyzer = LoopCtor ? new LoopCtor() : null;

    this._shapeTypeMapCache = null;
  }

  _buildAnalysisCode(fullCode) {
    const conditions = this.conditionalAnalyzer
      ? this.conditionalAnalyzer.findBranchesWithRender(fullCode)
      : [];
    let analysisCode = fullCode;

    if (this.conditionalAnalyzer && conditions.length > 0) {
      try {
        analysisCode = this.conditionalAnalyzer.convertElseToIndependentIf(
          fullCode,
          conditions,
        );
      } catch (e) {
        analysisCode = fullCode;
      }
    }

    if (this.loopAnalyzer && shouldUseLoopAnalyzer(analysisCode)) {
      try {
        analysisCode = this.loopAnalyzer.buildMaxCode(analysisCode);
      } catch (loopErr) {}
    }

    return analysisCode;
  }

  _installExecutionEnvironment(state) {
    var p = this.p5Instance;
    exposeVariables(this.allVariables, p);
    exposeP5Functions(
      {
        p: p,
        allFunctions: this.allFunctions,
        renderFunctions: this.renderFunctions,
        renderOrder: state.renderOrder,
        backgroundInfo: state.backgroundInfo,
        slotCounters: state.slotCounters,
        getShapeTypeMap: getShapeTypeMap,
        cache: this,
        loopExecutions: state.loopExecutions,
        maxLoopCount: this.options.maxLoopCount,
        imageLoadTracker: state.imageLoadTracker,
        tableLoadTracker: state.tableLoadTracker,
        jsonLoadTracker: state.jsonLoadTracker,
        suppressPrint: state.suppressPrint,
      },
      "execution",
    );
  }

  _evalUserCode(fullCode) {
    installMomentumStubs({ mode: "execution" });
    clearUserEntryPoints();
    if (!fullCode.trim()) {
      return;
    }
    window.eval(fullCode);
  }

  _runPreload() {
    if (typeof window.preload !== "function") {
      return;
    }
    window.preload();
  }

  _setRuntimePhase(phase) {
    window.__momentumRuntimePhase = phase || "global";
  }

  _clearRuntimePhase() {
    try {
      delete window.__momentumRuntimePhase;
    } catch (e) {
      window.__momentumRuntimePhase = "global";
    }
  }

  _snapshotExecutionResult(state) {
    return {
      renderOrder: state.renderOrder,
      loopExecutions: state.loopExecutions.value,
      background: {
        hasAlpha: state.backgroundInfo.hasAlpha,
      },
    };
  }

  _cleanupAfterExecution() {
    cleanupGlobals(this.allFunctions, this.allVariables);
  }

  async init() {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    var self = this;
    this.initPromise = new Promise(function (resolve, reject) {
      if (typeof p5 === "undefined") {
        reject(new Error("p5.js is not loaded"));
        return;
      }

      try {
        self.container = document.createElement("div");
        self.container.id = "p5-analyzer-container";
        self.container.style.cssText =
          "position: absolute; left: -9999px; top: -9999px;";
        self.options.canvasContainer.appendChild(self.container);

        var sketch = function (p) {
          p.setup = function () {
            p.createCanvas(100, 100);
            p.noCanvas();
          };
        };

        self.p5Instance = new p5(sketch, self.container);
        self.initialized = true;

        setTimeout(function () {
          resolve();
        }, 100);
      } catch (err) {
        reject(new Error(err.message || "Failed to initialize p5"));
      }
    });

    return this.initPromise;
  }

  destroy() {
    cleanupGlobals(this.allFunctions, this.allVariables);

    if (this.p5Instance) {
      try {
        this.p5Instance.remove();
      } catch (e) {}
      this.p5Instance = null;
    }

    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
      this.container = null;
    }

    this.initialized = false;
    this.initPromise = null;
    this._shapeTypeMapCache = null;
  }
  async execute(code, staticAnalysis, executionOptions) {
    await this.init();
    return await this.executeWithBranches(
      code,
      null,
      null,
      staticAnalysis,
      executionOptions,
    );
  }

  async executeWithBranches(code, globalCode, entryPoint, staticAnalysis, executionOptions) {
    const fullCode = globalCode ? globalCode + "\n" + code : code;
    let analysisCode =
      staticAnalysis &&
      staticAnalysis.runtimeCodePrepared === true &&
      typeof staticAnalysis.runtimeCode === "string"
        ? staticAnalysis.runtimeCode
        : this._buildAnalysisCode(fullCode);
    return await this.executeCodeBlock(analysisCode, entryPoint, executionOptions);
  }

  async executeCodeBlock(fullCode, entryPoint, executionOptions) {
    var self = this;
    var runtimeOptions = executionOptions || {};

    return createTimeoutTask(
      self.options.timeout,
      entryPoint ? `${entryPoint} timed out` : "Execution timed out",
      function (resolve, reject) {
        var state = createExecutionState({
          suppressConsole: !!runtimeOptions.suppressConsole,
        });
        try {
          self._installExecutionEnvironment(state);
          suppressRuntimeConsole(state);
          self._evalUserCode(fullCode);
        } catch (err) {
          restoreRuntimeConsole(state);
          self._cleanupAfterExecution();
          reject(err);
          return;
        }

        const shouldRunSetup = entryPoint === "setup" || entryPoint === null;
        const shouldRunDraw = entryPoint === "draw" || entryPoint === null;
        try {
          self._runPreload();
        } catch (err) {
          restoreRuntimeConsole(state);
          self._cleanupAfterExecution();
          reject(err);
          return;
        }

        collectLoadPromises(state)
          .then(function () {
            if (shouldRunSetup && typeof window.setup === "function") {
              try {
                self._setRuntimePhase("setup");
                window.setup();
              } finally {
                self._clearRuntimePhase();
              }
            }

            if (shouldRunDraw && typeof window.draw === "function") {
              try {
                self._setRuntimePhase("draw");
                window.draw();
              } finally {
                self._clearRuntimePhase();
              }
            }

            const result = self._snapshotExecutionResult(state);
            restoreRuntimeConsole(state);
            self._cleanupAfterExecution();
            resolve(result);
          })
          .catch(function (err) {
            restoreRuntimeConsole(state);
            self._cleanupAfterExecution();
            reject(err);
          });
      },
    ).catch(function (err) {
      self._cleanupAfterExecution();
      var errorMsg = entryPoint ? `${entryPoint} failed` : "Execution failed";
      if (!(err instanceof Error)) {
        err = new Error(errorMsg);
      }
      throw new Error(err.message || errorMsg);
    });
  }

  async executeSetupAndDraw(
    setupCode,
    drawCode,
    globalCode,
    setupFullCode,
    drawFullCode,
    preloadFullCode,
    staticAnalysis,
    executionOptions,
  ) {
    const runtimeOptions = executionOptions || {};
    const fullDefs = [];
    if (preloadFullCode && preloadFullCode.trim()) {
      fullDefs.push(preloadFullCode);
    }
    if (setupFullCode && setupFullCode.trim()) {
      fullDefs.push(setupFullCode);
    } else if (setupCode && setupCode.trim()) {
      fullDefs.push(`function setup() { ${setupCode} }`);
    }
    if (drawFullCode && drawFullCode.trim()) {
      fullDefs.push(drawFullCode);
    } else if (drawCode && drawCode.trim()) {
      fullDefs.push(`function draw() { ${drawCode} }`);
    }

    const fullCode = globalCode
      ? globalCode + "\n" + fullDefs.join("\n")
      : fullDefs.join("\n");
    let analysisCode =
      staticAnalysis &&
      staticAnalysis.runtimeCodePrepared === true &&
      typeof staticAnalysis.runtimeCode === "string"
        ? staticAnalysis.runtimeCode
        : this._buildAnalysisCode(fullCode);

    const { setupResult, drawResult } =
      await this.executeSetupThenDraw(analysisCode, runtimeOptions);
    return { setupResult, drawResult };
  }

  async executeSetupThenDraw(fullCode, executionOptions) {
    var self = this;
    var runtimeOptions = executionOptions || {};

    return createTimeoutTask(
      self.options.timeout * 2,
      "Execution timed out",
      function (resolve, reject) {
        var setupState = createExecutionState({
          suppressPrint: !!runtimeOptions.suppressConsole,
          suppressConsole: !!runtimeOptions.suppressConsole,
        });
        var drawState = createExecutionState({
          imageLoadTracker: setupState.imageLoadTracker,
          tableLoadTracker: setupState.tableLoadTracker,
          jsonLoadTracker: setupState.jsonLoadTracker,
          suppressPrint: !!runtimeOptions.suppressConsole,
          suppressConsole: !!runtimeOptions.suppressConsole,
        });

        try {
          self._installExecutionEnvironment(setupState);
          suppressRuntimeConsole(setupState);
          self._evalUserCode(fullCode);
        } catch (err) {
          restoreRuntimeConsole(drawState);
          restoreRuntimeConsole(setupState);
          self._cleanupAfterExecution();
          reject(err);
          return;
        }
        try {
          self._runPreload();
        } catch (err) {
          restoreRuntimeConsole(drawState);
          restoreRuntimeConsole(setupState);
          self._cleanupAfterExecution();
          reject(err);
          return;
        }

        collectLoadPromises(setupState)
          .then(function () {
            if (typeof window.setup === "function") {
              try {
                self._setRuntimePhase("setup");
                window.setup();
              } finally {
                self._clearRuntimePhase();
              }
            }

            self._installExecutionEnvironment(drawState);
            suppressRuntimeConsole(drawState);
            if (typeof window.draw === "function") {
              try {
                self._setRuntimePhase("draw");
                window.draw();
              } finally {
                self._clearRuntimePhase();
              }
            }

            const setupResult = self._snapshotExecutionResult(setupState);
            const drawResult = self._snapshotExecutionResult(drawState);
            restoreRuntimeConsole(drawState);
            restoreRuntimeConsole(setupState);
            self._cleanupAfterExecution();
            resolve({
              setupResult: setupResult,
              drawResult: drawResult,
            });
          })
          .catch(function (err) {
            restoreRuntimeConsole(drawState);
            restoreRuntimeConsole(setupState);
            self._cleanupAfterExecution();
            reject(err);
          });
      },
    ).catch(function (err) {
      self._cleanupAfterExecution();
      var errorMsg = "Execution failed";
      if (!(err instanceof Error)) {
        err = new Error(errorMsg);
      }
      throw new Error(err.message || errorMsg);
    });
  }

  async analyzeDependencies(code) {
    await this.init();

    if (typeof analyzeDependenciesAST !== "function") {
      throw new Error(
        "[Runtime] analyzeDependenciesAST not found. Please ensure dependencyAnalyzer.js is loaded.",
      );
    }

    return analyzeDependenciesAST(code);
  }
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = P5Runtime;
}

// 全局可用（保持向后兼容）
window.P5Runtime = P5Runtime;
