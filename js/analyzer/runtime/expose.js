// Shape/runtime wrappers used by P5Runtime execution and analysis.

function createShapeStateManager() {
  var states = {};

  return {
    getState: function (shapeName) {
      if (!states[shapeName]) {
        states[shapeName] = { hasVertexInCurrentShape: false };
      }
      return states[shapeName];
    },
    reset: function (shapeName) {
      if (states[shapeName]) {
        states[shapeName].hasVertexInCurrentShape = false;
      }
    },
    clear: function () {
      states = {};
    },
  };
}

function extractShapeCallsiteArgs(argsLike) {
  var args = Array.prototype.slice.call(argsLike || []);
  var callsiteId = null;

  if (
    args.length > 0 &&
    typeof args[0] === "string" &&
    args[0].indexOf("__mcs_") === 0
  ) {
    callsiteId = args.shift();
  }

  return {
    callsiteId: callsiteId,
    args: args,
  };
}

function getRuntimePhase() {
  return window.__momentumRuntimePhase || "global";
}

function requireCallsiteId(baseType, callsiteId) {
  if (callsiteId) {
    return callsiteId;
  }

  throw new Error(
    "[Runtime] Missing callsiteId for render function: " +
      String(baseType || "shape") +
      ". Please ensure codePreprocessor.instrumentShapeCallsites ran before execution.",
  );
}

function buildRenderSlotEntry(context, baseType, callsiteId, extra) {
  var phase = getRuntimePhase();
  var callsiteKey = requireCallsiteId(baseType, callsiteId);
  var counterKey = phase + ":" + callsiteKey;
  var counters = context.slotCounters || {};
  var ordinal = (counters[counterKey] || 0) + 1;
  counters[counterKey] = ordinal;
  context.slotCounters = counters;

  var entry = {
    type: baseType,
    phase: phase,
    callsiteId: callsiteId,
    slotKey: counterKey + ":" + ordinal,
  };

  if (extra) {
    for (var key in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, key)) {
        entry[key] = extra[key];
      }
    }
  }

  return entry;
}

function recordShapeExecution(context, baseType, funcName, callsiteId, extra) {
  if (typeof context.collectShape === "function") {
    context.collectShape(baseType);
  }
  if (typeof context.collectDeps === "function") {
    context.collectDeps("shapes", funcName || baseType);
  }

  if (context.loopExecutions) {
    context.loopExecutions.value++;
    if (context.loopExecutions.value > context.maxLoopCount) {
      throw new Error("循环次数超过上限");
    }
  }
  if (context.renderOrder) {
    context.renderOrder.push(
      buildRenderSlotEntry(context, baseType, callsiteId, extra),
    );
  }
}

function createShapeBuilderWrapper(options) {
  var original = options.original;
  var p = options.p;
  var funcName = options.funcName;
  var shapeName = options.shapeName;
  var baseType = options.baseType;
  var role = options.role;
  var stateManager = options.stateManager;
  var context = options.context || {};

  var state = stateManager.getState(shapeName);

  if (role === "begin") {
    return function () {
      state.hasVertexInCurrentShape = false;
      var callInfo = extractShapeCallsiteArgs(arguments);
      return original.apply(p, callInfo.args);
    };
  }

  if (role === "add") {
    return function () {
      var callInfo = extractShapeCallsiteArgs(arguments);
      state.hasVertexInCurrentShape = true;
      if (typeof context.collectDeps === "function") {
        context.collectDeps("shapes", funcName);
      }
      return original.apply(p, callInfo.args);
    };
  }

  if (role === "end") {
    return function () {
      var callInfo = extractShapeCallsiteArgs(arguments);
      if (state.hasVertexInCurrentShape) {
        recordShapeExecution(
          context,
          baseType,
          baseType,
          callInfo.callsiteId,
          null,
        );
        state.hasVertexInCurrentShape = false;
      }
      return original.apply(p, callInfo.args);
    };
  }

  return function () {
    var callInfo = extractShapeCallsiteArgs(arguments);
    return original.apply(p, callInfo.args);
  };
}

function createShapeWrapper(options) {
  var original = options.original;
  var p = options.p;
  var funcName = options.funcName;
  var baseType = options.baseType;
  var context = options.context || {};
  var backgroundInfo = options.backgroundInfo;

  return function () {
    var callInfo = extractShapeCallsiteArgs(arguments);
    var shapeArgs = callInfo.args;

    if (baseType === "background" && backgroundInfo) {
      var hasAlpha = false;
      var len = shapeArgs.length;

      if (len === 2 || len === 4) {
        hasAlpha = true;
      } else if (len === 1) {
        var arg0 = shapeArgs[0];
        if (arg0 && typeof arg0 === "object") {
          if (arg0.levels && arg0.levels.length >= 4) {
            hasAlpha = true;
          } else if (typeof arg0.length === "number" && arg0.length >= 4) {
            hasAlpha = true;
          }
        }
      }

      if (hasAlpha) {
        backgroundInfo.hasAlpha = true;
      }
    }

    if (context.loopExecutions) {
      context.loopExecutions.value++;
      if (context.loopExecutions.value > context.maxLoopCount) {
        throw new Error("循环次数超过上限");
      }
    }

    if (context.renderOrder) {
      var renderExtra = null;
      if (funcName === "image") {
        var imgArg = shapeArgs[0];
        var srcPath =
          imgArg && imgArg._momentumPath ? imgArg._momentumPath : null;
        if (srcPath) {
          renderExtra = { src: srcPath };
        }
      }
      context.renderOrder.push(
        buildRenderSlotEntry(
          context,
          baseType,
          callInfo.callsiteId,
          renderExtra,
        ),
      );
    }

    if (funcName === "image") {
      var imgObj = shapeArgs[0];
      if (!imgObj) return;
      return original.apply(p, shapeArgs);
    }

    return original.apply(p, shapeArgs);
  };
}

function exposeFunctions(context, mode) {
  var p = context.p;
  var allFunctions = context.allFunctions;
  var renderFunctions = context.renderFunctions;
  var getShapeTypeMapFn = context.getShapeTypeMap;

  var renderOrder = context.renderOrder;
  var loopExecutions = context.loopExecutions;
  var maxLoopCount = context.maxLoopCount;

  var getTransformFunctionNamesFn = context.getTransformFunctionNames;
  var getColorFunctionNamesFn = context.getColorFunctionNames;
  var getEnvironmentFunctionNamesFn = context.getEnvironmentFunctionNames;
  var collectDeps = context.collectDeps;
  var collectShape = context.collectShape;

  var backgroundInfo = context.backgroundInfo;
  var imageLoadTracker = context.imageLoadTracker;
  var tableLoadTracker = context.tableLoadTracker;
  var jsonLoadTracker = context.jsonLoadTracker;
  var slotCounters = context.slotCounters;
  var suppressPrint = !!context.suppressPrint;

  var shapeTypeMap = getShapeTypeMapFn ? getShapeTypeMapFn(context.cache) : {};
  var transformFuncs =
    mode === "analysis" && getTransformFunctionNamesFn
      ? getTransformFunctionNamesFn()
      : [];
  var colorFuncs =
    mode === "analysis" && getColorFunctionNamesFn
      ? getColorFunctionNamesFn()
      : [];
  var envFuncs =
    mode === "analysis" && getEnvironmentFunctionNamesFn
      ? getEnvironmentFunctionNamesFn()
      : [];

  var stateManager = createShapeStateManager();

  allFunctions.forEach(function (funcName) {
    if (funcName === "print") {
      if (window.__momentumOriginalPrint === undefined) {
        window.__momentumOriginalPrint = window.print;
      }
      window[funcName] = function () {
        if (suppressPrint) return;
        return console.log.apply(console, arguments);
      };
      return;
    }

    var original = getP5Function(p, funcName);
    var builderInfo = getBuilderInfo(funcName);

    if (funcName === "loadTable" && mode === "execution") {
      window[funcName] = createMomentumLoadTableWrapper(
        p,
        original,
        tableLoadTracker,
      );
      return;
    }

    if (funcName === "loadJSON" && mode === "execution") {
      window[funcName] = createMomentumLoadJSONWrapper(
        p,
        original,
        jsonLoadTracker,
      );
      return;
    }

    if (!original) {
      if (mode === "analysis" && envFuncs.indexOf(funcName) !== -1) {
        window[funcName] = function () {};
      }
      return;
    }

    if (builderInfo) {
      var builderContext =
        mode === "execution"
          ? {
              renderOrder: renderOrder,
              loopExecutions: loopExecutions,
              maxLoopCount: maxLoopCount,
              slotCounters: slotCounters,
            }
          : {
              collectShape: collectShape,
              collectDeps: collectDeps,
            };

      window[funcName] = createShapeBuilderWrapper({
        original: original,
        p: p,
        funcName: funcName,
        shapeName: builderInfo.shapeName,
        baseType: builderInfo.baseType,
        role: builderInfo.role,
        stateManager: stateManager,
        context: builderContext,
      });
      return;
    }

    if (renderFunctions.indexOf(funcName) !== -1) {
      if (mode === "execution") {
        window[funcName] = createShapeWrapper({
          original: original,
          p: p,
          funcName: funcName,
          baseType: shapeTypeMap[funcName] || funcName,
          context: {
            renderOrder: renderOrder,
            loopExecutions: loopExecutions,
            maxLoopCount: maxLoopCount,
            slotCounters: slotCounters,
          },
          backgroundInfo: backgroundInfo,
        });
      } else {
        window[funcName] = function () {
          var callInfo = extractShapeCallsiteArgs(arguments);
          var baseType = shapeTypeMap[funcName] || funcName;
          if (typeof collectShape === "function") {
            collectShape(baseType);
          }
          if (typeof collectDeps === "function") {
            collectDeps("shapes", funcName);
          }
          return original.apply(p, callInfo.args);
        };
      }
      return;
    }

    if (mode === "execution") {
      if (funcName === "loadImage") {
        window[funcName] = createMomentumLoadImageWrapper(
          p,
          original,
          imageLoadTracker,
        );
      } else {
        window[funcName] = function () {
          return original.apply(p, arguments);
        };
      }
      return;
    }

    window[funcName] = function () {
      if (typeof collectDeps === "function") {
        if (transformFuncs.indexOf(funcName) !== -1) {
          collectDeps("transforms", funcName);
        } else if (colorFuncs.indexOf(funcName) !== -1) {
          collectDeps("colors", funcName);
        }
      }
      return original.apply(p, arguments);
    };
  });
}

function exposeP5Functions(context, mode) {
  exposeFunctions(context, mode);
}
