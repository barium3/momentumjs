// Runtime loaders for image/table/json assets.

function ensureMomentumStore(name, initialValue) {
  if (!window[name]) {
    window[name] = initialValue;
  }
  return window[name];
}

function getMomentumImageMetadataStore() {
  return ensureMomentumStore("__momentumImageMetadata", {});
}

function getMomentumLoadedImageStore() {
  return ensureMomentumStore("__momentumLoadedImages", {});
}

function normalizeMomentumImagePath(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function getMomentumUserDirectory() {
  if (!window.extensionPath) {
    return null;
  }
  return String(window.extensionPath).replace(/[\\\/]+$/, "") + "/user";
}

function pathToFileUrl(fullPath) {
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

function resolveMomentumImageSource(path) {
  var relativePath = normalizeMomentumImagePath(path);
  var metadataStore = getMomentumImageMetadataStore();
  var metadata = metadataStore[relativePath] || null;
  var fullPath =
    metadata && metadata.path
      ? metadata.path
      : (function () {
          var userDir = getMomentumUserDirectory();
          if (!userDir || !relativePath) {
            return null;
          }
          return userDir.replace(/\\/g, "/") + "/" + relativePath;
        })();

  return {
    relativePath: relativePath,
    fullPath: fullPath,
    resolvedUrl: fullPath ? pathToFileUrl(fullPath) : relativePath,
    metadata: metadata,
  };
}

function decorateMomentumImage(img, sourceInfo) {
  if (!img || !sourceInfo) {
    return img;
  }

  img._momentumPath = sourceInfo.relativePath;
  img._momentumResolvedUrl = sourceInfo.resolvedUrl;
  img._momentumFullPath = sourceInfo.fullPath;
  if (img._momentumReady === undefined) {
    img._momentumReady = false;
  }

  if (
    sourceInfo.metadata &&
    typeof img.width !== "number" &&
    sourceInfo.metadata.width !== undefined
  ) {
    img.width = sourceInfo.metadata.width;
  }
  if (
    sourceInfo.metadata &&
    typeof img.height !== "number" &&
    sourceInfo.metadata.height !== undefined
  ) {
    img.height = sourceInfo.metadata.height;
  }

  return img;
}

function createMomentumLoadImageWrapper(p, original, imageLoadTracker) {
  return function (path, successCallback, failureCallback) {
    var sourceInfo = resolveMomentumImageSource(path);
    var relativePath = sourceInfo.relativePath;
    var cache = getMomentumLoadedImageStore();

    if (
      relativePath &&
      cache[relativePath] &&
      cache[relativePath]._momentumResolvedUrl === sourceInfo.resolvedUrl
    ) {
      if (
        imageLoadTracker &&
        imageLoadTracker.pending &&
        cache[relativePath]._momentumLoadPromise
      ) {
        imageLoadTracker.pending.push(cache[relativePath]._momentumLoadPromise);
      }
      return cache[relativePath];
    }

    var onSuccess = function (loadedImage) {
      decorateMomentumImage(loadedImage, sourceInfo);
      loadedImage._momentumReady = true;
      if (relativePath) {
        cache[relativePath] = loadedImage;
      }
      if (typeof successCallback === "function") {
        successCallback(loadedImage);
      }
    };

    var onFailure = function (err) {
      if (typeof failureCallback === "function") {
        failureCallback(err);
      }
    };

    var img;
    var loadPromise = new Promise(function (resolve) {
      img = original.call(
        p,
        sourceInfo.resolvedUrl,
        function (loadedImage) {
          onSuccess(loadedImage);
          resolve(loadedImage);
        },
        function (err) {
          onFailure(err);
          resolve(null);
        },
      );
    });

    decorateMomentumImage(img, sourceInfo);
    img._momentumLoadPromise = loadPromise;
    if (relativePath) {
      cache[relativePath] = img;
    }
    if (imageLoadTracker && imageLoadTracker.pending) {
      imageLoadTracker.pending.push(loadPromise);
    }
    return img;
  };
}

function waitForTracker(tracker) {
  if (!tracker || !tracker.pending || tracker.pending.length === 0) {
    return Promise.resolve();
  }

  var pending = tracker.pending.slice();
  tracker.pending.length = 0;
  return Promise.allSettled(pending).then(function () {});
}

function waitForMomentumImageLoads(imageLoadTracker) {
  return waitForTracker(imageLoadTracker);
}

function waitForMomentumTableLoads(tableLoadTracker) {
  return waitForTracker(tableLoadTracker);
}

function waitForMomentumJSONLoads(jsonLoadTracker) {
  return waitForTracker(jsonLoadTracker);
}
