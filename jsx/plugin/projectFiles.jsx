function _momentumDecodeFileSystemName(fileSystemName) {
  var encodedName = String(fileSystemName || "");
  try {
    return File.decode(encodedName);
  } catch (_fileNameDecodeError) {
    try {
      return decodeURIComponent(encodedName);
    } catch (_uriNameDecodeError) {
      return encodedName;
    }
  }
}

function _momentumValidateFileName(fileName) {
  if (!fileName) {
    return "File name cannot be empty.";
  }
  if (
    fileName.indexOf("/") !== -1 ||
    fileName.indexOf("\\") !== -1 ||
    fileName === "." ||
    fileName === ".."
  ) {
    return "Invalid file name: " + fileName;
  }
  return "";
}

function _momentumEntryExists(entryPath) {
  return new File(entryPath).exists || new Folder(entryPath).exists;
}

function _momentumNormalizePathKey(entryPath) {
  return String(entryPath || "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function _momentumCommandSuccess(data) {
  return JSON.stringify({
    ok: true,
    data: data === undefined ? null : data,
    error: null
  });
}

function _momentumCommandFailure(errorMessage, data, errorCode, stage) {
  return JSON.stringify({
    ok: false,
    data: data === undefined ? null : data,
    error: String(errorMessage || "After Effects file operation failed."),
    code: String(errorCode || "PROJECT_FILE_OPERATION_FAILED"),
    stage: String(stage || "project-file")
  });
}

function _momentumCreateCommandEntry(kind, name, entryPath, children) {
  var entry = {
    kind: kind,
    name: String(name || ""),
    path: String(entryPath || "").replace(/\\/g, "/")
  };
  if (kind === "folder") {
    entry.children = children || [];
  }
  return entry;
}

function _momentumRequireCommandEntry(entry) {
  if (
    !entry ||
    (entry.kind !== "file" && entry.kind !== "folder") ||
    typeof entry.name !== "string" ||
    typeof entry.path !== "string" ||
    !entry.path
  ) {
    throw new Error("Invalid project file entry.");
  }
  return entry;
}

function _momentumReadTextFileData(filePath) {
  var file = new File(filePath);
  if (!file.exists) {
    throw new Error("File does not exist: " + filePath);
  }
  file.encoding = "UTF-8";
  if (!file.open("r")) {
    throw new Error("Cannot open file for reading: " + file.fsName);
  }
  try {
    var content = file.read() || "";
    file.close();
    return { content: content, path: file.fsName.replace(/\\/g, "/") };
  } catch (readError) {
    try {
      file.close();
    } catch (_closeError) {}
    throw readError;
  }
}

function projectFileCommand(encodedAction, encodedPayload) {
  try {
    var action = decodeURIComponent(String(encodedAction || ""));
    var payloadText = decodeURIComponent(String(encodedPayload || ""));
    var payload = payloadText ? JSON.parse(payloadText) : {};

    if (action === "listEntries") {
      return _momentumCommandSuccess(
        _momentumListProjectEntries(payload.folderPath)
      );
    }

    if (action === "createFile") {
      return _momentumCommandSuccess(
        _momentumCreateProjectFile(
          payload.folderPath,
          payload.name,
          String(payload.content || "")
        )
      );
    }

    if (action === "createFolder") {
      return _momentumCommandSuccess(
        _momentumCreateProjectFolder(payload.folderPath, payload.name)
      );
    }

    if (action === "renameEntry") {
      return _momentumCommandSuccess(
        _momentumRenameProjectEntry(
          _momentumRequireCommandEntry(payload.entry),
          payload.name
        )
      );
    }

    if (action === "deleteEntry") {
      return _momentumCommandSuccess(
        _momentumDeleteProjectEntry(
          _momentumRequireCommandEntry(payload.entry)
        )
      );
    }

    if (action === "moveEntry") {
      return _momentumCommandSuccess(
        _momentumMoveProjectEntry(
          _momentumRequireCommandEntry(payload.entry),
          payload.targetFolderPath
        )
      );
    }

    if (action === "copyExternalEntries") {
      return _momentumCommandSuccess(
        _momentumCopyExternalProjectEntries(
          payload.entries || [],
          payload.targetFolderPath
        )
      );
    }

    if (action === "readTextFile") {
      return _momentumCommandSuccess(_momentumReadTextFileData(payload.path));
    }

    return _momentumCommandFailure(
      "Unknown project file command: " + action,
      null,
      "PROJECT_FILE_COMMAND_UNKNOWN",
      action
    );
  } catch (error) {
    return _momentumCommandFailure(
      error.toString(),
      error.data,
      "PROJECT_FILE_OPERATION_FAILED",
      typeof action === "string" ? action : "project-file"
    );
  }
}

function _momentumResolveUniqueFile(folder, preferredFileName, exemptFilePath) {
  var requestedName = String(preferredFileName || "").replace(/^\s+|\s+$/g, "");
  var validationError = _momentumValidateFileName(requestedName);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  var extensionIndex = requestedName.lastIndexOf(".");
  var baseName = extensionIndex > 0
    ? requestedName.substring(0, extensionIndex)
    : requestedName;
  var extension = extensionIndex > 0
    ? requestedName.substring(extensionIndex)
    : "";
  var exemptPathKey = String(exemptFilePath || "").toLowerCase();

  for (var suffix = 0; suffix < 10000; suffix++) {
    var targetName = suffix === 0
      ? baseName + extension
      : baseName + " " + String(suffix + 1) + extension;
    var targetFile = new File(folder.fsName + "/" + targetName);
    var isExemptFile =
      exemptPathKey && targetFile.fsName.toLowerCase() === exemptPathKey;
    if (!_momentumEntryExists(targetFile.fsName) || isExemptFile) {
      return {
        ok: true,
        file: targetFile,
        name: targetName,
      };
    }
  }

  return {
    ok: false,
    error: "Could not allocate a unique file name in: " + folder.fsName,
  };
}

function _momentumResolveUniqueFolder(
  folder,
  preferredFolderName,
  exemptFolderPath
) {
  var requestedName = String(preferredFolderName || "").replace(
    /^\s+|\s+$/g,
    ""
  );
  var validationError = _momentumValidateFileName(requestedName);
  if (validationError) {
    return { ok: false, error: validationError };
  }
  var exemptPathKey = String(exemptFolderPath || "").toLowerCase();

  for (var suffix = 0; suffix < 10000; suffix++) {
    var targetName = suffix === 0
      ? requestedName
      : requestedName + " " + String(suffix + 1);
    var targetFolder = new Folder(folder.fsName + "/" + targetName);
    var isExemptFolder =
      exemptPathKey && targetFolder.fsName.toLowerCase() === exemptPathKey;
    if (!_momentumEntryExists(targetFolder.fsName) || isExemptFolder) {
      return {
        ok: true,
        folder: targetFolder,
        name: targetName,
      };
    }
  }

  return {
    ok: false,
    error: "Could not allocate a unique folder name in: " + folder.fsName,
  };
}

function _momentumListProjectEntries(folderPath) {
  var folder = new Folder(folderPath);
  if (!folder.exists && !folder.create()) {
    throw new Error("Cannot create project folder: " + folderPath);
  }

  function listFolder(currentFolder) {
    var items = currentFolder.getFiles();
    var entries = [];
    for (var i = 0; items && i < items.length; i++) {
      var item = items[i];
      var kind = item instanceof Folder ? "folder" : "file";
      entries.push(
        _momentumCreateCommandEntry(
          kind,
          _momentumDecodeFileSystemName(item.name),
          item.fsName,
          kind === "folder" ? listFolder(item) : null
        )
      );
    }
    return entries;
  }

  return {
    entries: listFolder(folder),
    folderPath: folder.fsName.replace(/\\/g, "/")
  };
}

function _momentumCreateProjectFile(folderPath, preferredFileName, content) {
  var folder = new Folder(folderPath);
  if (!folder.exists && !folder.create()) {
    throw new Error("Cannot create folder: " + folderPath);
  }

  var target = _momentumResolveUniqueFile(
    folder,
    preferredFileName || "Untitled.js",
    ""
  );
  if (!target.ok) {
    throw new Error(target.error);
  }

  var targetFile = target.file;
  targetFile.encoding = "UTF-8";
  if (!targetFile.open("w")) {
    throw new Error("Cannot create file: " + targetFile.fsName);
  }
  try {
    targetFile.write(String(content || ""));
    targetFile.close();
  } catch (writeError) {
    try {
      targetFile.close();
      targetFile.remove();
    } catch (_closeError) {}
    throw new Error(
      "Cannot write file: " +
        targetFile.fsName +
        " (" +
        writeError.toString() +
        ")"
    );
  }

  return _momentumCreateCommandEntry(
    "file",
    target.name,
    targetFile.fsName
  );
}

function _momentumCreateProjectFolder(folderPath, preferredFolderName) {
  var parentFolder = new Folder(folderPath);
  if (!parentFolder.exists && !parentFolder.create()) {
    throw new Error("Cannot create folder: " + folderPath);
  }

  var target = _momentumResolveUniqueFolder(
    parentFolder,
    preferredFolderName || "New Folder",
    ""
  );
  if (!target.ok) {
    throw new Error(target.error);
  }
  if (!target.folder.create()) {
    throw new Error("Cannot create folder: " + target.folder.fsName);
  }
  return _momentumCreateCommandEntry(
    "folder",
    target.name,
    target.folder.fsName,
    []
  );
}

function _momentumRenameProjectEntry(entry, requestedName) {
  var entryIsFolder = entry.kind === "folder";
  var entryType = entry.kind;
  var sourceEntry = entryIsFolder
    ? new Folder(entry.path)
    : new File(entry.path);
  if (!sourceEntry.exists) {
    throw new Error(entryType + " does not exist: " + entry.path);
  }

  var currentName = _momentumDecodeFileSystemName(sourceEntry.name);
  var nextName = String(requestedName || "").replace(/^\s+|\s+$/g, "");
  if (nextName === currentName) {
    return _momentumCreateCommandEntry(
      entry.kind,
      currentName,
      sourceEntry.fsName,
      entryIsFolder ? [] : null
    );
  }

  var parentFolder = sourceEntry.parent;
  var target = entryIsFolder
    ? _momentumResolveUniqueFolder(parentFolder, nextName, sourceEntry.fsName)
    : _momentumResolveUniqueFile(parentFolder, nextName, sourceEntry.fsName);
  if (!target.ok) {
    throw new Error(target.error);
  }
  if (!sourceEntry.rename(target.name)) {
    throw new Error("Cannot rename " + entryType + " to: " + target.name);
  }

  var renamedEntry = entryIsFolder
    ? new Folder(parentFolder.fsName + "/" + target.name)
    : new File(parentFolder.fsName + "/" + target.name);
  return _momentumCreateCommandEntry(
    entry.kind,
    target.name,
    renamedEntry.fsName,
    entryIsFolder ? [] : null
  );
}

function _momentumRemoveFolderRecursively(folder) {
  var items = folder.getFiles();
  if (items) {
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var removed = item instanceof Folder
        ? _momentumRemoveFolderRecursively(item)
        : item.remove();
      if (!removed) {
        return false;
      }
    }
  }
  return folder.remove();
}

function _momentumCopyFolderRecursively(sourceFolder, targetFolder) {
  if (!targetFolder.exists && !targetFolder.create()) {
    return false;
  }

  var items = sourceFolder.getFiles();
  if (!items) {
    return true;
  }

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var itemName = _momentumDecodeFileSystemName(item.name);
    if (item instanceof Folder) {
      if (
        !_momentumCopyFolderRecursively(
          item,
          new Folder(targetFolder.fsName + "/" + itemName)
        )
      ) {
        return false;
      }
    } else {
      var targetFile = new File(targetFolder.fsName + "/" + itemName);
      if (!item.copy(targetFile)) {
        return false;
      }
    }
  }
  return true;
}

function _momentumFindFirstFile(folder) {
  var items = folder.getFiles();
  if (!items) {
    return "";
  }

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item instanceof Folder) {
      var nestedFilePath = _momentumFindFirstFile(item);
      if (nestedFilePath) {
        return nestedFilePath;
      }
    } else if (_momentumDecodeFileSystemName(item.name) !== ".DS_Store") {
      return item.fsName.replace(/\\/g, "/");
    }
  }
  return "";
}

function _momentumCopyExternalProjectEntries(sourceEntries, targetFolderPath) {
  var response = { entries: [], errors: [], firstFilePath: "" };
  if (!sourceEntries || sourceEntries.length === 0) {
    throw new Error("No external files or folders were provided.");
  }

  var targetFolder = new Folder(targetFolderPath);
  if (!targetFolder.exists && !targetFolder.create()) {
    throw new Error("Cannot create target folder: " + targetFolderPath);
  }

  var targetFolderKey = _momentumNormalizePathKey(targetFolder.fsName);
  for (var i = 0; i < sourceEntries.length; i++) {
    var sourceDescriptor;
    try {
      sourceDescriptor = _momentumRequireCommandEntry(sourceEntries[i]);
    } catch (entryError) {
      response.errors.push(entryError.toString());
      continue;
    }
    var sourceIsFolder = sourceDescriptor.kind === "folder";
    var sourceEntry = sourceIsFolder
      ? new Folder(sourceDescriptor.path)
      : new File(sourceDescriptor.path);

    if (!sourceEntry.exists) {
      response.errors.push(
        "Dropped " +
          sourceDescriptor.kind +
          " does not exist: " +
          sourceDescriptor.path
      );
      continue;
    }

    var sourcePathKey = _momentumNormalizePathKey(sourceEntry.fsName);
    if (
      sourceIsFolder &&
      (targetFolderKey === sourcePathKey ||
        targetFolderKey.indexOf(sourcePathKey + "/") === 0)
    ) {
      response.errors.push(
        "Cannot copy a folder into itself or one of its descendants: " +
          sourceEntry.fsName
      );
      continue;
    }

    var sourceName = _momentumDecodeFileSystemName(sourceEntry.name);
    var target = sourceIsFolder
      ? _momentumResolveUniqueFolder(targetFolder, sourceName, "")
      : _momentumResolveUniqueFile(targetFolder, sourceName, "");
    if (!target.ok) {
      response.errors.push(target.error);
      continue;
    }

    var targetEntry = sourceIsFolder ? target.folder : target.file;
    var copied = sourceIsFolder
      ? _momentumCopyFolderRecursively(sourceEntry, target.folder)
      : sourceEntry.copy(target.file);
    if (!copied) {
      if (sourceIsFolder && target.folder.exists) {
        _momentumRemoveFolderRecursively(target.folder);
      }
      response.errors.push(
        "Cannot copy dropped " +
          sourceDescriptor.kind +
          ": " +
          sourceEntry.fsName
      );
      continue;
    }

    var importedPath = targetEntry.fsName.replace(/\\/g, "/");
    var firstFilePath = sourceIsFolder
      ? _momentumFindFirstFile(target.folder)
      : importedPath;
    response.entries.push(
      _momentumCreateCommandEntry(
        sourceDescriptor.kind,
        target.name,
        importedPath,
        sourceIsFolder ? [] : null
      )
    );
    if (!response.firstFilePath && firstFilePath) {
      response.firstFilePath = firstFilePath;
    }
  }

  if (response.entries.length === 0) {
    throw new Error(
      response.errors.length > 0
        ? response.errors.join("\n")
        : "Cannot copy external entries."
    );
  }
  return response;
}

function _momentumMoveProjectEntry(entry, targetFolderPath) {
  var entryIsFolder = entry.kind === "folder";
  var sourceEntry = entryIsFolder
    ? new Folder(entry.path)
    : new File(entry.path);
  var targetFolder = new Folder(targetFolderPath);

  if (!sourceEntry.exists) {
    throw new Error(entry.kind + " does not exist: " + entry.path);
  }
  if (!targetFolder.exists) {
    throw new Error("Target folder does not exist: " + targetFolderPath);
  }

  var sourcePathKey = _momentumNormalizePathKey(sourceEntry.fsName);
  var sourceParentKey = _momentumNormalizePathKey(sourceEntry.parent.fsName);
  var targetFolderKey = _momentumNormalizePathKey(targetFolder.fsName);
  if (sourceParentKey === targetFolderKey) {
    return _momentumCreateCommandEntry(
      entry.kind,
      _momentumDecodeFileSystemName(sourceEntry.name),
      sourceEntry.fsName,
      entryIsFolder ? [] : null
    );
  }
  if (
    entryIsFolder &&
    (targetFolderKey === sourcePathKey ||
      targetFolderKey.indexOf(sourcePathKey + "/") === 0)
  ) {
    throw new Error("Cannot move a folder into itself or one of its descendants.");
  }

  var sourceName = _momentumDecodeFileSystemName(sourceEntry.name);
  var target = entryIsFolder
    ? _momentumResolveUniqueFolder(targetFolder, sourceName, "")
    : _momentumResolveUniqueFile(targetFolder, sourceName, "");
  if (!target.ok) {
    throw new Error(target.error);
  }

  var targetEntry = entryIsFolder ? target.folder : target.file;
  if (entryIsFolder) {
    if (!_momentumCopyFolderRecursively(sourceEntry, targetEntry)) {
      if (targetEntry.exists) {
        _momentumRemoveFolderRecursively(targetEntry);
      }
      throw new Error("Cannot copy folder to: " + targetEntry.fsName);
    }
    if (!_momentumRemoveFolderRecursively(sourceEntry)) {
      var partialMoveError = new Error(
        "Folder was copied but the original could not be fully removed: " +
          sourceEntry.fsName
      );
      partialMoveError.data = {
        changed: true,
        copiedPath: targetEntry.fsName.replace(/\\/g, "/")
      };
      throw partialMoveError;
    }
  } else {
    if (!sourceEntry.copy(targetEntry)) {
      throw new Error("Cannot copy file to: " + targetEntry.fsName);
    }
    if (!sourceEntry.remove()) {
      targetEntry.remove();
      throw new Error("Cannot remove the original file: " + sourceEntry.fsName);
    }
  }

  return _momentumCreateCommandEntry(
    entry.kind,
    target.name,
    targetEntry.fsName,
    entryIsFolder ? [] : null
  );
}

function _momentumDeleteProjectEntry(entry) {
  var entryIsFolder = entry.kind === "folder";
  var targetEntry = entryIsFolder
    ? new Folder(entry.path)
    : new File(entry.path);
  if (!targetEntry.exists) {
    throw new Error(entry.kind + " does not exist: " + entry.path);
  }

  var entryName = String(
    entry.name || _momentumDecodeFileSystemName(targetEntry.name)
  );
  var message = entryIsFolder
    ? "Are you sure you want to delete the folder '" +
      entryName +
      "' and all of its contents?"
    : "Are you sure you want to delete '" + entryName + "'?";
  var confirmed = confirm(
    message + "\n\nThis action cannot be undone.",
    false,
    entryIsFolder ? "Delete Folder" : "Delete File"
  );
  if (!confirmed) {
    return { cancelled: true, deleted: false, entry: entry };
  }

  var removed = entryIsFolder
    ? _momentumRemoveFolderRecursively(targetEntry)
    : targetEntry.remove();
  if (!removed) {
    throw new Error("Cannot delete " + entry.kind + ": " + targetEntry.fsName);
  }
  return { cancelled: false, deleted: true, entry: entry };
}
