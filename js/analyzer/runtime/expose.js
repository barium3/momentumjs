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

function recordShapeExecution(context, baseType, funcName) {
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
    context.renderOrder.push(baseType);
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
      return original.apply(p, arguments);
    };
  }

  if (role === "add") {
    return function () {
      state.hasVertexInCurrentShape = true;
      if (typeof context.collectDeps === "function") {
        context.collectDeps("shapes", funcName);
      }
      return original.apply(p, arguments);
    };
  }

  if (role === "end") {
    return function () {
      if (state.hasVertexInCurrentShape) {
        recordShapeExecution(context, baseType, baseType);
        state.hasVertexInCurrentShape = false;
      }
      return original.apply(p, arguments);
    };
  }

  return function () {
    return original.apply(p, arguments);
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
    if (baseType === "background" && backgroundInfo) {
      var hasAlpha = false;
      var len = arguments.length;

      if (len === 2 || len === 4) {
        hasAlpha = true;
      } else if (len === 1) {
        var arg0 = arguments[0];
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
      if (funcName === "image") {
        var imgArg = arguments[0];
        var srcPath =
          imgArg && imgArg._momentumPath ? imgArg._momentumPath : null;
        context.renderOrder.push(
          srcPath ? { type: "image", src: srcPath } : baseType,
        );
      } else {
        context.renderOrder.push(baseType);
      }
    }

    if (funcName === "image") {
      var imgObj = arguments[0];
      if (!imgObj) return;
      return original.apply(p, arguments);
    }

    return original.apply(p, arguments);
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
          },
          backgroundInfo: backgroundInfo,
        });
      } else {
        window[funcName] = function () {
          var baseType = shapeTypeMap[funcName] || funcName;
          if (typeof collectShape === "function") {
            collectShape(baseType);
          }
          if (typeof collectDeps === "function") {
            collectDeps("shapes", funcName);
          }
          return original.apply(p, arguments);
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
