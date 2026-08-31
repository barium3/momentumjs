// External operating-system file and folder drops.
window.fileDrop = (function () {
  const Entry = window.fileEntry;

  function toArray(arrayLike) {
    return Array.prototype.slice.call(arrayLike || []);
  }

  function hasExternalEntries(dataTransfer) {
    if (!dataTransfer) {
      return false;
    }

    const items = toArray(dataTransfer.items);
    for (let i = 0; i < items.length; i++) {
      if (items[i] && items[i].kind === "file") {
        return true;
      }
    }
    return Boolean(dataTransfer.files && dataTransfer.files.length > 0);
  }

  function getFileSystemEntry(item) {
    if (!item) {
      return null;
    }
    const entryFactory = item.webkitGetAsEntry || item.getAsEntry;
    if (typeof entryFactory !== "function") {
      return null;
    }
    try {
      return entryFactory.call(item);
    } catch (_error) {
      return null;
    }
  }

  function getNativeFilePath(file) {
    const candidatePath = file && (file.path || file.nativePath);
    if (!candidatePath) {
      return "";
    }
    return String(candidatePath).replace(/\\/g, "/");
  }

  function pathEndsWithEntryName(entryPath, entryName) {
    const normalizedPath = String(entryPath || "").replace(/[\\/]+$/, "");
    const separatorIndex = Math.max(
      normalizedPath.lastIndexOf("/"),
      normalizedPath.lastIndexOf("\\"),
    );
    const pathName = normalizedPath.substring(separatorIndex + 1);
    return pathName.toLowerCase() === String(entryName || "").toLowerCase();
  }

  function readStatFlag(statData, propertyName) {
    if (!statData) {
      return null;
    }
    const flag = statData[propertyName];
    if (typeof flag === "function") {
      try {
        return Boolean(flag.call(statData));
      } catch (_error) {
        return null;
      }
    }
    return typeof flag === "boolean" ? flag : null;
  }

  function getNativePathFolderState(entryPath) {
    if (
      !window.cep ||
      !window.cep.fs ||
      typeof window.cep.fs.stat !== "function"
    ) {
      return null;
    }
    try {
      const result = window.cep.fs.stat(entryPath);
      if (!result || Number(result.err) !== 0) {
        return null;
      }
      const isDirectory = readStatFlag(result.data, "isDirectory");
      if (isDirectory !== null) {
        return isDirectory;
      }
      const isFile = readStatFlag(result.data, "isFile");
      return isFile === null ? null : !isFile;
    } catch (_error) {
      return null;
    }
  }

  function captureDrop(dataTransfer) {
    const files = toArray(dataTransfer && dataTransfer.files);
    const items = toArray(dataTransfer && dataTransfer.items);
    const entries = [];

    items.forEach(function (item) {
      if (item && item.kind === "file") {
        const entry = getFileSystemEntry(item);
        if (entry) {
          entries.push(entry);
        } else if (typeof item.getAsFile === "function") {
          const itemFile = item.getAsFile();
          if (itemFile) {
            entries.push({
              file: itemFile,
              isDirectory: false,
              isFile: true,
              name: itemFile.name,
            });
          }
        }
      }
    });

    const nativePaths = files.map(getNativeFilePath).filter(Boolean);
    const nativePathsMatchFiles = nativePaths.length === files.length &&
      files.every(function (file, index) {
        return pathEndsWithEntryName(nativePaths[index], file && file.name);
      });
    const entriesMatchFiles = entries.length === 0 ||
      (entries.length === nativePaths.length && entries.every(
        function (entry, index) {
          return pathEndsWithEntryName(nativePaths[index], entry && entry.name);
        },
      ));
    const nativeEntries = [];
    if (nativePathsMatchFiles && entriesMatchFiles) {
      nativePaths.forEach(function (entryPath, index) {
        const fileSystemEntry = entries.length === files.length
          ? entries[index]
          : null;
        let isFolder = null;
        if (fileSystemEntry && fileSystemEntry.isDirectory === true) {
          isFolder = true;
        } else if (fileSystemEntry && fileSystemEntry.isFile === true) {
          isFolder = false;
        } else {
          isFolder = getNativePathFolderState(entryPath);
        }
        if (isFolder !== null) {
          nativeEntries.push({
            kind: isFolder ? Entry.FOLDER_KIND : Entry.FILE_KIND,
            name: files[index] && files[index].name
              ? String(files[index].name)
              : "",
            path: entryPath,
          });
        }
      });
    }
    return {
      entries: entries,
      files: files,
      nativeEntries: nativeEntries,
      useNativeEntries:
        files.length > 0 &&
        nativeEntries.length === files.length,
    };
  }

  function importWithNativeEntries(capturedDrop, targetFolderPath) {
    return window.fileSystem.copyExternalEntries(
      capturedDrop.nativeEntries,
      targetFolderPath,
    ).then(function (response) {
      return {
        ok: response.entries.length > 0,
        entries: response.entries,
        errors: response.errors,
        firstFilePath: response.firstFilePath,
      };
    });
  }

  function cepOperationSucceeded(result) {
    return Boolean(result && Number(result.err) === 0);
  }

  function requireCepFileSystem() {
    if (
      !window.cep ||
      !window.cep.fs ||
      typeof window.cep.fs.stat !== "function" ||
      typeof window.cep.fs.makedir !== "function" ||
      typeof window.cep.fs.writeFile !== "function"
    ) {
      throw new Error("CEP file-system APIs are unavailable.");
    }
    return window.cep.fs;
  }

  function joinPath(folderPath, entryName) {
    return String(folderPath || "").replace(/[\\/]+$/, "") +
      "/" +
      String(entryName || "");
  }

  function validateEntryName(entryName) {
    const name = String(entryName || "");
    if (!name || name === "." || name === ".." || /[\\/]/.test(name)) {
      throw new Error("Invalid dropped entry name: " + name);
    }
    return name;
  }

  function entryExists(entryPath) {
    return cepOperationSucceeded(requireCepFileSystem().stat(entryPath));
  }

  function removeCepEntryRecursively(entryPath) {
    const fileSystem = requireCepFileSystem();
    if (typeof fileSystem.deleteFile !== "function") {
      return false;
    }

    const isFolder = getNativePathFolderState(entryPath);
    if (isFolder === true) {
      if (typeof fileSystem.readdir !== "function") {
        return false;
      }
      const listResult = fileSystem.readdir(entryPath);
      if (!cepOperationSucceeded(listResult)) {
        return false;
      }
      const childNames = Array.isArray(listResult.data) ? listResult.data : [];
      for (let index = 0; index < childNames.length; index++) {
        if (!removeCepEntryRecursively(joinPath(entryPath, childNames[index]))) {
          return false;
        }
      }
    }
    return cepOperationSucceeded(fileSystem.deleteFile(entryPath));
  }

  function allocateUniquePath(folderPath, preferredName, isFolder) {
    const requestedName = validateEntryName(preferredName);
    const extensionIndex = isFolder ? -1 : requestedName.lastIndexOf(".");
    const baseName = extensionIndex > 0
      ? requestedName.substring(0, extensionIndex)
      : requestedName;
    const extension = extensionIndex > 0
      ? requestedName.substring(extensionIndex)
      : "";

    for (let suffix = 0; suffix < 10000; suffix++) {
      const nextName = suffix === 0
        ? baseName + extension
        : baseName + " " + String(suffix + 1) + extension;
      const nextPath = joinPath(folderPath, nextName);
      if (!entryExists(nextPath)) {
        return { name: nextName, path: nextPath };
      }
    }
    throw new Error("Could not allocate a unique name in: " + folderPath);
  }

  function readAllDirectoryEntries(directoryEntry) {
    return new Promise(function (resolve, reject) {
      const reader = directoryEntry.createReader();
      const entries = [];

      function readNextBatch() {
        reader.readEntries(function (batch) {
          if (!batch || batch.length === 0) {
            resolve(entries);
            return;
          }
          entries.push.apply(entries, toArray(batch));
          readNextBatch();
        }, reject);
      }

      readNextBatch();
    });
  }

  function getEntryFile(fileEntry) {
    return new Promise(function (resolve, reject) {
      fileEntry.file(resolve, reject);
    });
  }

  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        const result = String(reader.result || "");
        const commaIndex = result.indexOf(",");
        resolve(commaIndex === -1 ? result : result.substring(commaIndex + 1));
      };
      reader.onerror = function () {
        reject(reader.error || new Error("Could not read dropped file."));
      };
      reader.readAsDataURL(file);
    });
  }

  function writeDroppedFile(file, targetPath) {
    return readFileAsBase64(file).then(function (base64Content) {
      const encoding = window.cep && window.cep.encoding
        ? window.cep.encoding.Base64
        : "Base64";
      const result = requireCepFileSystem().writeFile(
        targetPath,
        base64Content,
        encoding,
      );
      if (!cepOperationSucceeded(result)) {
        throw new Error("Could not write dropped file: " + targetPath);
      }
      return targetPath;
    });
  }

  function importBrowserEntry(entry, targetFolderPath, allocateUniqueName) {
    if (entry && entry.isDirectory) {
      const folderTarget = allocateUniqueName
        ? allocateUniquePath(targetFolderPath, entry.name, true)
        : {
            name: validateEntryName(entry.name),
            path: joinPath(targetFolderPath, entry.name),
          };
      const createResult = requireCepFileSystem().makedir(folderTarget.path);
      if (!cepOperationSucceeded(createResult)) {
        return Promise.reject(
          new Error("Could not create dropped folder: " + folderTarget.path),
        );
      }

      return readAllDirectoryEntries(entry).then(function (children) {
        let firstFilePath = "";
        let chain = Promise.resolve();
        children.forEach(function (child) {
          chain = chain.then(function () {
            return importBrowserEntry(child, folderTarget.path, false).then(
              function (result) {
                if (!firstFilePath && result.firstFilePath) {
                  firstFilePath = result.firstFilePath;
                }
              },
            );
          });
        });
        return chain.then(function () {
          return {
            firstFilePath: firstFilePath,
            kind: Entry.FOLDER_KIND,
            name: folderTarget.name,
            path: folderTarget.path,
          };
        });
      }).catch(function (error) {
        if (!removeCepEntryRecursively(folderTarget.path)) {
          error = error instanceof Error ? error : new Error(String(error));
          error.message +=
            " The partially imported folder could not be removed: " +
            folderTarget.path;
        }
        throw error;
      });
    }

    const filePromise = entry && entry.isFile && typeof entry.file === "function"
      ? getEntryFile(entry)
      : Promise.resolve(entry && entry.file ? entry.file : entry);
    return filePromise.then(function (file) {
      if (!file || !file.name) {
        throw new Error("Dropped file data is unavailable.");
      }
      const fileTarget = allocateUniqueName
        ? allocateUniquePath(targetFolderPath, file.name, false)
        : {
            name: validateEntryName(file.name),
            path: joinPath(targetFolderPath, file.name),
          };
      return writeDroppedFile(file, fileTarget.path).then(function () {
        return {
          firstFilePath: fileTarget.path,
          kind: Entry.FILE_KIND,
          name: fileTarget.name,
          path: fileTarget.path,
        };
      });
    });
  }

  function getBrowserDropEntries(capturedDrop) {
    if (capturedDrop.entries.length > 0) {
      return capturedDrop.entries;
    }
    return capturedDrop.files.map(function (file) {
      return { file: file, isFile: true, isDirectory: false, name: file.name };
    });
  }

  function importWithBrowserEntries(capturedDrop, targetFolderPath) {
    const sourceEntries = getBrowserDropEntries(capturedDrop);
    const response = { ok: true, entries: [], errors: [], firstFilePath: "" };
    let chain = Promise.resolve();

    sourceEntries.forEach(function (entry) {
      chain = chain.then(function () {
        return Promise.resolve().then(function () {
          return importBrowserEntry(entry, targetFolderPath, true);
        }).then(
          function (importedEntry) {
            response.entries.push(Entry.create(importedEntry));
            if (!response.firstFilePath && importedEntry.firstFilePath) {
              response.firstFilePath = importedEntry.firstFilePath;
            }
          },
          function (error) {
            response.errors.push(error && error.message
              ? error.message
              : String(error));
          },
        );
      });
    });

    return chain.then(function () {
      response.ok = response.entries.length > 0;
      return response;
    });
  }

  function importCapturedDrop(capturedDrop, targetFolderPath) {
    if (!capturedDrop) {
      return Promise.resolve({ ok: false, entries: [], errors: [] });
    }

    if (capturedDrop.useNativeEntries) {
      return importWithNativeEntries(capturedDrop, targetFolderPath).then(
        function (response) {
          if (response && response.entries && response.entries.length > 0) {
            return response;
          }
          if (capturedDrop.entries.length > 0) {
            return importWithBrowserEntries(capturedDrop, targetFolderPath);
          }
          return response || {
            ok: false,
            entries: [],
            errors: ["After Effects could not copy the dropped entries."],
          };
        },
        function (error) {
          if (capturedDrop.entries.length > 0) {
            return importWithBrowserEntries(capturedDrop, targetFolderPath);
          }
          return {
            ok: false,
            entries: [],
            errors: [error && error.message ? error.message : String(error)],
          };
        },
      );
    }

    return importWithBrowserEntries(capturedDrop, targetFolderPath);
  }

  return {
    captureDrop: captureDrop,
    hasExternalEntries: hasExternalEntries,
    importCapturedDrop: importCapturedDrop,
  };
})();
