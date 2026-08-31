// Promise-based bridge for project file-system operations in After Effects.
window.fileSystem = (function () {
  const DEFAULT_RETRY_DELAY_MS = 250;

  function createHostError(message, action, response, retryable) {
    const error = new Error(message || "After Effects file operation failed.");
    error.action = action;
    error.response = response || null;
    error.retryable = retryable === true;
    return error;
  }

  function parseResponse(result, action) {
    if (result === undefined || result === null || result === "") {
      throw createHostError("After Effects returned no result.", action, null, true);
    }
    if (/^EvalScript error\./i.test(String(result))) {
      throw createHostError(String(result), action, null, true);
    }

    let response = null;
    try {
      response = JSON.parse(result);
    } catch (_error) {
      throw createHostError(
        "After Effects returned an invalid response.",
        action,
        null,
        true,
      );
    }
    if (!response || response.ok !== true) {
      const error = createHostError(
        response && response.error
          ? response.error
          : "After Effects file operation failed.",
        action,
        response,
      );
      error.data = response && response.data ? response.data : null;
      throw error;
    }
    return response.data;
  }

  function callOnce(action, payload) {
    return new Promise(function (resolve, reject) {
      const encodedAction = encodeURIComponent(String(action || ""));
      const encodedPayload = encodeURIComponent(JSON.stringify(payload || {}));
      csInterface.evalScript(
        'projectFileCommand("' +
          encodedAction +
          '", "' +
          encodedPayload +
          '")',
        function (result) {
          try {
            resolve(parseResponse(result, action));
          } catch (error) {
            reject(error);
          }
        },
      );
    });
  }

  function call(action, payload, options) {
    const callOptions = options || {};
    const retryCount = Math.max(0, Number(callOptions.retries) || 0);
    const retryDelay = Math.max(
      0,
      Number(callOptions.retryDelayMs) || DEFAULT_RETRY_DELAY_MS,
    );

    function attempt(remainingRetries) {
      return callOnce(action, payload).catch(function (error) {
        if (remainingRetries <= 0 || error.retryable !== true) {
          throw error;
        }
        return new Promise(function (resolve) {
          window.setTimeout(resolve, retryDelay);
        }).then(function () {
          return attempt(remainingRetries - 1);
        });
      });
    }

    return attempt(retryCount);
  }

  function requireObject(data, action) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw createHostError(
        "After Effects returned invalid data for " + action + ".",
        action,
        data,
      );
    }
    return data;
  }

  function normalizeEntryData(data, action) {
    try {
      return window.fileEntry.create(requireObject(data, action));
    } catch (error) {
      throw createHostError(
        "After Effects returned an invalid file entry for " + action + ".",
        action,
        data,
      );
    }
  }

  function normalizeEntries(data, action) {
    if (!Array.isArray(data)) {
      throw createHostError(
        "After Effects returned an invalid entry list for " + action + ".",
        action,
        data,
      );
    }
    return data.map(function (entry) {
      return normalizeEntryData(entry, action);
    });
  }

  function writeTextFileNow(filePath, content) {
    const cepFileSystem = window.cep && window.cep.fs;
    if (!cepFileSystem || typeof cepFileSystem.writeFile !== "function") {
      throw createHostError(
        "CEP file-system APIs are unavailable.",
        "writeTextFile",
      );
    }
    const encoding = window.cep.encoding && window.cep.encoding.UTF8
      ? window.cep.encoding.UTF8
      : "UTF8";
    const result = cepFileSystem.writeFile(
      filePath,
      typeof content === "string" ? content : "",
      encoding,
    );
    if (!result || Number(result.err) !== 0) {
      throw createHostError(
        "Could not write file: " + filePath,
        "writeTextFile",
        result,
      );
    }
    return { path: window.fileEntry.normalizePath(filePath) };
  }

  return {
    copyExternalEntries: function (entries, targetFolderPath) {
      return call("copyExternalEntries", {
        entries: entries.map(window.fileEntry.toHostDescriptor),
        targetFolderPath: targetFolderPath,
      }).then(function (data) {
        const response = requireObject(data, "copyExternalEntries");
        return {
          entries: normalizeEntries(response.entries, "copyExternalEntries"),
          errors: Array.isArray(response.errors) ? response.errors : [],
          firstFilePath: window.fileEntry.normalizePath(
            response.firstFilePath,
          ),
        };
      });
    },
    createFile: function (folderPath, name, content) {
      return call("createFile", {
        content: content || "",
        folderPath: folderPath,
        name: name,
      }).then(function (data) {
        return normalizeEntryData(data, "createFile");
      });
    },
    createFolder: function (folderPath, name) {
      return call("createFolder", {
        folderPath: folderPath,
        name: name,
      }).then(function (data) {
        return normalizeEntryData(data, "createFolder");
      });
    },
    deleteEntry: function (entry) {
      return call("deleteEntry", {
        entry: window.fileEntry.toHostDescriptor(entry),
      }).then(function (data) {
        const response = requireObject(data, "deleteEntry");
        if (
          typeof response.deleted !== "boolean" ||
          typeof response.cancelled !== "boolean"
        ) {
          throw createHostError(
            "After Effects returned an invalid delete result.",
            "deleteEntry",
            response,
          );
        }
        return response;
      });
    },
    listEntries: function (folderPath, options) {
      return call("listEntries", { folderPath: folderPath }, options).then(
        function (data) {
          const response = requireObject(data, "listEntries");
          return {
            entries: normalizeEntries(response.entries, "listEntries"),
            folderPath: window.fileEntry.normalizePath(
              response.folderPath || folderPath,
            ),
          };
        },
      );
    },
    moveEntry: function (entry, targetFolderPath) {
      return call("moveEntry", {
        entry: window.fileEntry.toHostDescriptor(entry),
        targetFolderPath: targetFolderPath,
      }).then(function (data) {
        return normalizeEntryData(data, "moveEntry");
      });
    },
    readTextFile: function (filePath) {
      return call("readTextFile", { path: filePath }).then(function (data) {
        const response = requireObject(data, "readTextFile");
        if (typeof response.content !== "string") {
          throw createHostError(
            "After Effects returned invalid file contents.",
            "readTextFile",
            response,
          );
        }
        return response.content;
      });
    },
    renameEntry: function (entry, name) {
      return call("renameEntry", {
        entry: window.fileEntry.toHostDescriptor(entry),
        name: name,
      }).then(function (data) {
        return normalizeEntryData(data, "renameEntry");
      });
    },
    writeTextFileNow: writeTextFileNow,
  };
})();
