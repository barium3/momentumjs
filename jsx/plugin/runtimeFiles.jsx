var __momentumBitmapCreationTokenCounter =
  $.global.__momentumBitmapCreationTokenCounter || 1000;
$.global.__momentumBitmapCreationTokenCounter = __momentumBitmapCreationTokenCounter;
var __momentumBitmapCreationTokenSeeded = false;

function _momentumSeedBitmapCreationTokenCounter() {
  if (__momentumBitmapCreationTokenSeeded) {
    return;
  }
  __momentumBitmapCreationTokenSeeded = true;

  var runtimeFolder = _momentumGetRuntimeFolder();
  var creationTransportsFolder = runtimeFolder
    ? new Folder(runtimeFolder.fsName + "/creation-transports")
    : null;
  if (!creationTransportsFolder || !creationTransportsFolder.exists) {
    return;
  }

  var entries = [];
  try {
    entries = creationTransportsFolder.getFiles(function (entry) {
      return entry instanceof Folder;
    });
  } catch (_creationTransportSeedListError) {
    entries = [];
  }

  for (var index = 0; index < entries.length; index++) {
    var parsedId = Math.floor(Number(entries[index].name));
    if (
      isFinite(parsedId) &&
      parsedId > __momentumBitmapCreationTokenCounter &&
      parsedId < 2000000000
    ) {
      __momentumBitmapCreationTokenCounter = parsedId;
    }
  }
  $.global.__momentumBitmapCreationTokenCounter = __momentumBitmapCreationTokenCounter;
}

function _momentumNextBitmapCreationToken() {
  _momentumSeedBitmapCreationTokenCounter();
  var runtimeFolder = _momentumGetRuntimeFolder();

  for (var attempt = 0; attempt < 100000; attempt++) {
    __momentumBitmapCreationTokenCounter += 1;
    if (__momentumBitmapCreationTokenCounter > 2000000000) {
      __momentumBitmapCreationTokenCounter = 1001;
    }

    var candidateFolder = runtimeFolder
      ? new Folder(
          runtimeFolder.fsName +
          "/creation-transports/" +
          String(__momentumBitmapCreationTokenCounter)
        )
      : null;
    if (!candidateFolder || !candidateFolder.exists) {
      $.global.__momentumBitmapCreationTokenCounter = __momentumBitmapCreationTokenCounter;
      return __momentumBitmapCreationTokenCounter;
    }
  }

  throw new Error("Unable to allocate a unique Momentum runtime creation token.");
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

  return JSON.stringify({
    ok: true,
    file: targetFile.fsName,
    bytes: content.length
  });
}

function _momentumGetCreationTransportFolder(creationToken) {
  var safeCreationToken = Math.max(1, Math.floor(Number(creationToken) || 0));
  var runtimeFolder = _momentumGetRuntimeFolder();
  if (!runtimeFolder) {
    return null;
  }
  return new Folder(runtimeFolder.fsName + "/creation-transports/" + String(safeCreationToken));
}

function _momentumGetCreationDebugTraceFile(creationToken) {
  var creationFolder = _momentumGetCreationTransportFolder(creationToken);
  if (!creationFolder) {
    return null;
  }
  return new File(creationFolder.fsName + "/debug_trace.log");
}

function _momentumWriteTextFileRaw(targetFile, content) {
  if (!targetFile) {
    return "Error: Missing target file.";
  }

  targetFile.encoding = "UTF-8";
  targetFile.lineFeed = "Unix";
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

function _momentumNormalizeCodeSourceText(sourceText) {
  var source = String(sourceText == null ? "" : sourceText);
  if (source.length > 0 && source.charCodeAt(0) === 0xFEFF) {
    source = source.substring(1);
  }
  return source.replace(/\r\n?/g, "\n").replace(/\n+$/g, "");
}

function _momentumWriteCreationTransportFilesRaw(creationToken, sourceText, bundleText) {
  var runtimeFolder = _momentumGetRuntimeFolder();
  if (!_momentumEnsureFolder(runtimeFolder)) {
    return "Error: Cannot create Momentum runtime directory: " + runtimeFolder.fsName;
  }

  var creationFolder = _momentumGetCreationTransportFolder(creationToken);
  if (!_momentumEnsureFolder(creationFolder)) {
    return "Error: Cannot create Momentum creation transport directory: " + (creationFolder ? creationFolder.fsName : "<unresolved>");
  }

  var sourceFile = new File(creationFolder.fsName + "/sketch.js");
  var bundleFile = new File(creationFolder.fsName + "/sketch_bundle.json");
  var debugTraceFile = _momentumGetCreationDebugTraceFile(creationToken);
  var sourceWriteError = _momentumWriteTextFileRaw(
    sourceFile,
    _momentumNormalizeCodeSourceText(sourceText)
  );
  if (sourceWriteError) {
    return sourceWriteError;
  }
  var bundleWriteError = _momentumWriteTextFileRaw(bundleFile, bundleText);
  if (bundleWriteError) {
    return bundleWriteError;
  }
  var debugTraceWriteError = _momentumWriteTextFileRaw(debugTraceFile, "");
  if (debugTraceWriteError) {
    return debugTraceWriteError;
  }

  return "";
}

function writeMomentumSketch(encodedSource) {
  return _momentumWriteRuntimeFile("sketch.js", encodedSource);
}

function writeMomentumBundle(encodedBundle) {
  return _momentumWriteRuntimeFile("sketch_bundle.json", encodedBundle);
}
