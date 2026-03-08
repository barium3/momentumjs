/**
 * IOAnalyzer helpers
 *
 * 职责：
 * 1. 解析 user/ 下数据文件的真实路径
 * 2. 为 runtime.js 提供 loadTable / loadJSON 包装器
 * 3. 在前端尽量复用真实 p5 的加载实现
 */

function ioState() {
  if (!window.__momentumIO) {
    window.__momentumIO = {
      loadedTables: {},
      loadedJSON: {},
      tableMetadata: {},
    };
  }
  return window.__momentumIO;
}

function tableStore() {
  return ioState().loadedTables;
}

function jsonStore() {
  return ioState().loadedJSON;
}

function metaStore() {
  return ioState().tableMetadata;
}

function normPath(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function userDir() {
  if (!window.extensionPath) {
    return null;
  }
  return String(window.extensionPath).replace(/[\\\/]+$/, "") + "/user";
}

function fileUrl(fullPath) {
  if (!fullPath) {
    return null;
  }
  var normalized = String(fullPath).replace(/\\/g, "/");
  var encoded = encodeURI(normalized);
  if (/^[A-Za-z]:\//.test(normalized)) {
    return "file:///" + encoded;
  }
  if (normalized.charAt(0) !== "/") {
    return "file:///" + encoded;
  }
  return "file://" + encoded;
}

function resolveSource(path, metadata) {
  var relativePath = normPath(path);
  var dir = userDir();
  var fullPath =
    metadata && metadata.path
      ? metadata.path
      : dir && relativePath
        ? dir.replace(/\\/g, "/") + "/" + relativePath
        : null;

  return {
    relativePath: relativePath,
    fullPath: fullPath,
    resolvedUrl: fullPath ? fileUrl(fullPath) : relativePath,
    metadata: metadata || null,
  };
}

function resolveTable(path) {
  var relativePath = normPath(path);
  var metadata = metaStore();
  return resolveSource(path, metadata[relativePath] || null);
}

function resolveJSON(path) {
  return resolveSource(path, null);
}

function tagTable(table, sourceInfo) {
  if (!table || !sourceInfo) {
    return table;
  }

  table._momentumPath = sourceInfo.relativePath;
  table._momentumResolvedUrl = sourceInfo.resolvedUrl;
  table._momentumFullPath = sourceInfo.fullPath;
  if (sourceInfo.metadata) {
    table._momentumMetadata = sourceInfo.metadata;
  }
  return table;
}

function tagJSON(data, sourceInfo) {
  if (!data || !sourceInfo || typeof data !== "object") {
    return data;
  }

  data._momentumPath = sourceInfo.relativePath;
  data._momentumResolvedUrl = sourceInfo.resolvedUrl;
  data._momentumFullPath = sourceInfo.fullPath;
  return data;
}

function pickCallbacks(args) {
  var successCallback = null;
  var errorCallback = null;

  for (var i = args.length - 1; i >= 1; i--) {
    if (typeof args[i] !== "function") continue;
    if (!errorCallback) {
      errorCallback = args[i];
    } else if (!successCallback) {
      successCallback = args[i];
      break;
    }
  }

  return {
    successCallback: successCallback,
    errorCallback: errorCallback,
  };
}

function swapCallback(args, target, replacement) {
  if (typeof target !== "function") {
    return false;
  }
  for (var i = args.length - 1; i >= 1; i--) {
    if (args[i] === target) {
      args[i] = replacement;
      return true;
    }
  }
  return false;
}

function makeLoadWrapper(options) {
  var p = options.p;
  var original = options.original;
  var tracker = options.tracker;
  var resolveSource = options.resolveSource;
  var getCache = options.getCache;
  var decorateLoadedValue = options.decorateLoadedValue;
  var missingMessage = options.missingMessage;

  return function (path) {
    if (typeof original !== "function") {
      throw new Error(missingMessage);
    }

    var args = Array.prototype.slice.call(arguments, 0);
    var sourceInfo = resolveSource(path);
    var relativePath = sourceInfo.relativePath;
    var cache = getCache();
    var callbacks = pickCallbacks(args);
    var successCallback = callbacks.successCallback;
    var errorCallback = callbacks.errorCallback;

    if (
      relativePath &&
      cache[relativePath] &&
      cache[relativePath]._momentumResolvedUrl === sourceInfo.resolvedUrl
    ) {
      if (
        tracker &&
        tracker.pending &&
        cache[relativePath]._momentumLoadPromise
      ) {
        tracker.pending.push(cache[relativePath]._momentumLoadPromise);
      }
      if (typeof successCallback === "function") {
        successCallback(cache[relativePath]);
      }
      return cache[relativePath];
    }

    args[0] = sourceInfo.resolvedUrl;

    var resolveLoad = null;
    var loadPromise = new Promise(function (resolve) {
      resolveLoad = resolve;
    });

    function finalizeLoadedValue(value) {
      decorateLoadedValue(value, sourceInfo);
      if (value && typeof value === "object") {
        value._momentumLoadPromise = loadPromise;
      }
      if (relativePath) {
        cache[relativePath] = value;
      }
      if (resolveLoad) {
        resolveLoad(value);
      }
      return value;
    }

    function finalizeLoadFailure() {
      if (resolveLoad) {
        resolveLoad(null);
      }
    }

    var wrappedSuccess = function (value) {
      finalizeLoadedValue(value);
      if (typeof successCallback === "function") {
        successCallback(value);
      }
    };

    var wrappedError = function (err) {
      finalizeLoadFailure();
      if (typeof errorCallback === "function") {
        errorCallback(err);
      }
    };

    if (!swapCallback(args, successCallback, wrappedSuccess)) {
      args.push(wrappedSuccess);
    }

    if (!swapCallback(args, errorCallback, wrappedError)) {
      args.push(wrappedError);
    }

    var value = original.apply(p, args);
    decorateLoadedValue(value, sourceInfo);
    if (value && typeof value === "object") {
      value._momentumLoadPromise = loadPromise;
    }
    if (relativePath) {
      cache[relativePath] = value;
    }
    if (tracker && tracker.pending) {
      tracker.pending.push(loadPromise);
    }
    return value;
  };
}

function createMomentumLoadTableWrapper(p, original, tableLoadTracker) {
  return makeLoadWrapper({
    p: p,
    original: original,
    tracker: tableLoadTracker,
    resolveSource: resolveTable,
    getCache: tableStore,
    decorateLoadedValue: tagTable,
    missingMessage: "p5.loadTable is not available",
  });
}

function createMomentumLoadJSONWrapper(p, original, jsonLoadTracker) {
  return makeLoadWrapper({
    p: p,
    original: original,
    tracker: jsonLoadTracker,
    resolveSource: resolveJSON,
    getCache: jsonStore,
    decorateLoadedValue: tagJSON,
    missingMessage: "p5.loadJSON is not available",
  });
}

window.createMomentumLoadTableWrapper = createMomentumLoadTableWrapper;
window.createMomentumLoadJSONWrapper = createMomentumLoadJSONWrapper;
