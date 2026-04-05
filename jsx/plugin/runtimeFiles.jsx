var __momentumBitmapInstanceIdCounter =
  $.global.__momentumBitmapInstanceIdCounter || 1000;
$.global.__momentumBitmapInstanceIdCounter = __momentumBitmapInstanceIdCounter;

function _momentumNextBitmapInstanceId() {
  __momentumBitmapInstanceIdCounter += 1;
  if (__momentumBitmapInstanceIdCounter > 2000000000) {
    __momentumBitmapInstanceIdCounter = 1000;
  }
  $.global.__momentumBitmapInstanceIdCounter = __momentumBitmapInstanceIdCounter;
  return __momentumBitmapInstanceIdCounter;
}

function _momentumGetRuntimeFolder() {
  var overridePath = "";
  try {
    if ($.global.__momentumRuntimePath) {
      overridePath = String($.global.__momentumRuntimePath);
    }
  } catch (_momentumRuntimeOverrideError) {}
  if (overridePath) {
    return new Folder(overridePath);
  }

  var pluginInstallFolder = _momentumFindInstalledPluginFolder();
  if (pluginInstallFolder) {
    return new Folder(pluginInstallFolder.fsName + "/runtime");
  }

  return null;
}

function _momentumFindInstalledPluginFolder() {
  var homeFolder = Folder("~");
  var commonPluginsFolder = new Folder(
    homeFolder.fsName + "/Library/Application Support/Adobe/Common/Plug-ins"
  );
  if (!commonPluginsFolder.exists) {
    return null;
  }

  var directMomentumFolder = new Folder(commonPluginsFolder.fsName + "/Momentum");
  if (new Folder(directMomentumFolder.fsName + "/Momentum.plugin").exists) {
    return directMomentumFolder;
  }

  var versionEntries = [];
  try {
    versionEntries = commonPluginsFolder.getFiles(function (entry) {
      return entry instanceof Folder;
    });
  } catch (_momentumPluginSearchError) {
    versionEntries = [];
  }

  for (var i = 0; i < versionEntries.length; i += 1) {
    var versionFolder = versionEntries[i];
    if (!(versionFolder instanceof Folder)) {
      continue;
    }
    var mediaCoreFolder = new Folder(versionFolder.fsName + "/MediaCore");
    if (!mediaCoreFolder.exists) {
      continue;
    }
    var momentumFolder = new Folder(mediaCoreFolder.fsName + "/Momentum");
    if (new Folder(momentumFolder.fsName + "/Momentum.plugin").exists) {
      return momentumFolder;
    }
  }

  return null;
}

function _momentumAppendApplyTrace(message) {
  var runtimeFolder = _momentumGetRuntimeFolder();
  if (!_momentumEnsureFolder(runtimeFolder)) {
    return;
  }

  var traceFile = new File(runtimeFolder.fsName + "/apply_trace.log");
  traceFile.encoding = "UTF-8";
  var line =
    "ts_ms=" +
    String(new Date().getTime()) +
    " " +
    String(message == null ? "" : message).replace(/[\r\n]+/g, " ");

  try {
    if (!traceFile.open("a")) {
      return;
    }
    traceFile.writeln(line);
    traceFile.close();
  } catch (_traceWriteError) {
    try {
      traceFile.close();
    } catch (_traceCloseError) {}
  }
}

function _momentumEnsureFolder(folder) {
  if (!folder) {
    return false;
  }
  if (folder.exists) {
    return true;
  }
  var parent = folder.parent;
  if (parent && !parent.exists) {
    if (!_momentumEnsureFolder(parent)) {
      return false;
    }
  }
  try {
    if (!folder.create() && !folder.exists) {
      return false;
    }
  } catch (_folderError) {
    return false;
  }
  return folder.exists;
}

function _momentumDecodeURIComponent(encodedText) {
  if (encodedText === undefined || encodedText === null) {
    return "";
  }
  try {
    return decodeURIComponent(String(encodedText));
  } catch (_decodeError) {
    return String(encodedText);
  }
}

function _momentumWriteRuntimeFile(fileName, encodedContent) {
  var runtimeFolder = _momentumGetRuntimeFolder();
  if (!_momentumEnsureFolder(runtimeFolder)) {
    return "Error: Cannot create Momentum runtime directory: " + runtimeFolder.fsName;
  }

  var targetFile = new File(runtimeFolder.fsName + "/" + fileName);
  targetFile.encoding = "UTF-8";
  var content = _momentumDecodeURIComponent(encodedContent);

  try {
    if (!targetFile.open("w")) {
      return "Error: Cannot open file for writing: " + targetFile.fsName;
    }
    targetFile.write(content);
    targetFile.close();
  } catch (writeError) {
    try {
      targetFile.close();
    } catch (_closeError) {}
    return "Error: Cannot write file: " + targetFile.fsName + " (" + writeError.toString() + ")";
  }

  _momentumAppendApplyTrace(
    "phase=write_runtime_file" +
    " file=" + fileName +
    " bytes=" + content.length +
    " path=" + targetFile.fsName
  );

  return JSON.stringify({
    ok: true,
    file: targetFile.fsName,
    bytes: content.length
  });
}

function _momentumWritePendingRuntimeBundleRaw(bundleText) {
  var runtimeFolder = _momentumGetRuntimeFolder();
  if (!_momentumEnsureFolder(runtimeFolder)) {
    return "Error: Cannot create Momentum runtime directory: " + runtimeFolder.fsName;
  }

  var pendingFile = new File(runtimeFolder.fsName + "/pending_sketch_bundle.json");
  var writeError = _momentumWriteTextFileRaw(pendingFile, bundleText);
  if (writeError) {
    return writeError;
  }

  _momentumAppendApplyTrace(
    "phase=write_pending_runtime_bundle" +
    " path=" + pendingFile.fsName +
    " bundle_bytes=" + String(String(bundleText || "").length)
  );

  return "";
}

function _momentumClearPendingRuntimeBundle() {
  var runtimeFolder = _momentumGetRuntimeFolder();
  if (!runtimeFolder) {
    return "Error: Cannot resolve Momentum runtime directory.";
  }
  var pendingFile = new File(runtimeFolder.fsName + "/pending_sketch_bundle.json");
  if (!pendingFile.exists) {
    return "";
  }

  try {
    if (!pendingFile.remove() && pendingFile.exists) {
      return "Error: Cannot remove file: " + pendingFile.fsName;
    }
  } catch (removeError) {
    return "Error: Cannot remove file: " + pendingFile.fsName + " (" + removeError.toString() + ")";
  }

  _momentumAppendApplyTrace(
    "phase=clear_pending_runtime_bundle" +
    " path=" + pendingFile.fsName
  );
  return "";
}

function _momentumGetRuntimeInstanceFolder(instanceId) {
  var safeInstanceId = Math.max(1, Math.floor(Number(instanceId) || 0));
  var runtimeFolder = _momentumGetRuntimeFolder();
  if (!runtimeFolder) {
    return null;
  }
  return new Folder(runtimeFolder.fsName + "/instances/" + String(safeInstanceId));
}

function _momentumWriteTextFileRaw(targetFile, content) {
  if (!targetFile) {
    return "Error: Missing target file.";
  }

  targetFile.encoding = "UTF-8";
  try {
    if (!targetFile.open("w")) {
      return "Error: Cannot open file for writing: " + targetFile.fsName;
    }
    targetFile.write(String(content == null ? "" : content));
    targetFile.close();
  } catch (writeError) {
    try {
      targetFile.close();
    } catch (_closeError) {}
    return "Error: Cannot write file: " + targetFile.fsName + " (" + writeError.toString() + ")";
  }

  return "";
}

function _momentumWriteRuntimeInstanceFilesRaw(instanceId, sourceText, bundleText) {
  var runtimeFolder = _momentumGetRuntimeFolder();
  if (!_momentumEnsureFolder(runtimeFolder)) {
    return "Error: Cannot create Momentum runtime directory: " + runtimeFolder.fsName;
  }

  var instanceFolder = _momentumGetRuntimeInstanceFolder(instanceId);
  if (!_momentumEnsureFolder(instanceFolder)) {
    return "Error: Cannot create Momentum instance runtime directory: " + (instanceFolder ? instanceFolder.fsName : "<unresolved>");
  }

  var sourceFile = new File(instanceFolder.fsName + "/sketch.js");
  var bundleFile = new File(instanceFolder.fsName + "/sketch_bundle.json");
  var sourceWriteError = _momentumWriteTextFileRaw(sourceFile, sourceText);
  if (sourceWriteError) {
    return sourceWriteError;
  }
  var bundleWriteError = _momentumWriteTextFileRaw(bundleFile, bundleText);
  if (bundleWriteError) {
    return bundleWriteError;
  }

  _momentumAppendApplyTrace(
    "phase=write_instance_runtime" +
    " instance_id=" + String(Math.floor(Number(instanceId) || 0)) +
    " source=" + sourceFile.fsName +
    " bundle=" + bundleFile.fsName +
    " source_bytes=" + String(String(sourceText || "").length) +
    " bundle_bytes=" + String(String(bundleText || "").length)
  );

  return "";
}

function writeMomentumSketch(encodedSource) {
  return _momentumWriteRuntimeFile("sketch.js", encodedSource);
}

function writeMomentumBundle(encodedBundle) {
  return _momentumWriteRuntimeFile("sketch_bundle.json", encodedBundle);
}
