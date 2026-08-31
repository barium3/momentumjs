function _momentumAppendCodeEditorDiagnostic(stage, detail) {
  try {
    var runtimeFolder = _momentumGetRuntimeFolder();
    if (!runtimeFolder) {
      return;
    }
    var file = new File(runtimeFolder.fsName + "/code_editor.log");
    if (file.exists && Number(file.length || 0) > (512 * 1024)) {
      file.encoding = "UTF-8";
      if (file.open("w")) {
        file.write("");
        file.close();
      }
    }
    file.encoding = "UTF-8";
    if (!file.open("a")) {
      return;
    }
    file.writeln(
      "timeMs=" + String(new Date().getTime()) +
      " stage=" + String(stage || "unknown").replace(/\s+/g, "-") +
      " detail=" + String(detail == null ? "" : detail).replace(/[\r\n]+/g, " ")
    );
    file.close();
  } catch (_codeEditorDiagnosticError) {}
}

function momentumAppendCodeEditorLog(encodedMessage) {
  try {
    _momentumAppendCodeEditorDiagnostic(
      "frontend",
      _momentumDecodeURIComponent(encodedMessage)
    );
    return "ok";
  } catch (error) {
    return "Error: " + error.toString();
  }
}

function _momentumIsMomentumEffect(effect) {
  if (!effect) {
    return false;
  }
  return String(effect.matchName || "") === "Momentum" ||
    String(effect.name || "") === "Momentum";
}

function _momentumPushUniqueEffectTarget(targets, comp, layer, effect) {
  if (!layer || !_momentumIsMomentumEffect(effect)) {
    return;
  }
  for (var index = 0; index < targets.length; index++) {
    if (targets[index].layer === layer && targets[index].effect === effect) {
      return;
    }
  }
  targets.push({ comp: comp, layer: layer, effect: effect });
}

function _momentumFindLayerContainingEffect(comp, effect) {
  if (!comp || !effect) {
    return null;
  }
  for (var layerIndex = 1; layerIndex <= comp.numLayers; layerIndex++) {
    var layer = comp.layer(layerIndex);
    var parade = layer.property("ADBE Effect Parade");
    if (!parade) {
      continue;
    }
    for (var effectIndex = 1; effectIndex <= parade.numProperties; effectIndex++) {
      if (parade.property(effectIndex) === effect) {
        return layer;
      }
    }
  }
  return null;
}

function _momentumFindSelectedMomentumEffect() {
  if (!app.project || !(app.project.activeItem instanceof CompItem)) {
    return null;
  }
  var comp = app.project.activeItem;
  var targets = [];
  var selectedProperties = comp.selectedProperties || [];
  for (var propertyIndex = 0; propertyIndex < selectedProperties.length; propertyIndex++) {
    var property = selectedProperties[propertyIndex];
    while (property && property.parentProperty) {
      var parent = property.parentProperty;
      if (parent && String(parent.matchName || "") === "ADBE Effect Parade") {
        var layer = _momentumFindLayerContainingEffect(comp, property);
        _momentumPushUniqueEffectTarget(targets, comp, layer, property);
        break;
      }
      property = parent;
    }
  }
  if (targets.length === 1) {
    return targets[0];
  }
  if (targets.length > 1) {
    return null;
  }

  var selectedLayers = comp.selectedLayers || [];
  for (var layerIndex = 0; layerIndex < selectedLayers.length; layerIndex++) {
    var selectedLayer = selectedLayers[layerIndex];
    var parade = selectedLayer.property("ADBE Effect Parade");
    if (!parade) {
      continue;
    }
    for (var effectIndex = 1; effectIndex <= parade.numProperties; effectIndex++) {
      _momentumPushUniqueEffectTarget(
        targets,
        comp,
        selectedLayer,
        parade.property(effectIndex)
      );
    }
  }
  return targets.length === 1 ? targets[0] : null;
}

function _momentumReadCodeEditorText(file) {
  if (!file || !file.exists) {
    return null;
  }
  file.encoding = "UTF-8";
  try {
    if (!file.open("r")) {
      return null;
    }
    var text = file.read();
    file.close();
    return String(text == null ? "" : text);
  } catch (_readCodeEditorTextError) {
    try { file.close(); } catch (_closeCodeEditorTextError) {}
    return null;
  }
}

function _momentumIsSafeCodeEditSessionToken(sessionToken) {
  return /^[A-Fa-f0-9]{32}$/.test(String(sessionToken || ""));
}

function _momentumGetCodeEditSessionFolder(sessionToken) {
  var runtimeFolder = _momentumGetRuntimeFolder();
  if (!runtimeFolder || !_momentumIsSafeCodeEditSessionToken(sessionToken)) {
    return null;
  }
  return new Folder(
    runtimeFolder.fsName + "/code-edit-sessions/" + String(sessionToken)
  );
}

function _momentumReadCodeEditorOpenIntent() {
  var runtimeFolder = _momentumGetRuntimeFolder();
  if (!runtimeFolder) {
    return "";
  }
  var intentFile = new File(
    runtimeFolder.fsName + "/code-editor-open.pending"
  );
  var intentText = _momentumReadCodeEditorText(intentFile);
  if (intentText === null) {
    return "";
  }
  var lines = intentText.replace(/\r/g, "").split("\n");
  var sessionToken = String(lines[1] || "");
  if (String(lines[0] || "") !== "open-v1" ||
      !_momentumIsSafeCodeEditSessionToken(sessionToken)) {
    return "";
  }
  var sessionFolder = _momentumGetCodeEditSessionFolder(sessionToken);
  var contextFile = sessionFolder
    ? new File(sessionFolder.fsName + "/context.txt")
    : null;
  return sessionFolder && sessionFolder.exists &&
    contextFile && contextFile.exists
    ? sessionToken
    : "";
}

function momentumPeekCodeEditorOpenIntent() {
  try {
    return _momentumReadCodeEditorOpenIntent();
  } catch (error) {
    return "Error: " + error.toString();
  }
}

function momentumClaimCodeEditorPanel(encodedSessionToken) {
  try {
    var sessionToken = _momentumDecodeURIComponent(encodedSessionToken);
    if (!_momentumIsSafeCodeEditSessionToken(sessionToken)) {
      return "Error: Invalid Momentum code edit session.";
    }
    var runtimeFolder = _momentumGetRuntimeFolder();
    if (!runtimeFolder) {
      return "Error: The Momentum runtime directory is unavailable.";
    }
    var writeError = _momentumWriteTextFileRaw(
      new File(runtimeFolder.fsName + "/code-editor-open.claimed"),
      sessionToken + "\n"
    );
    return writeError ? "Error: " + String(writeError) : "ok";
  } catch (error) {
    return "Error: " + error.toString();
  }
}

function momentumAcknowledgeCodeEditorOpenIntent(encodedSessionToken) {
  try {
    var sessionToken = _momentumDecodeURIComponent(encodedSessionToken);
    if (!_momentumIsSafeCodeEditSessionToken(sessionToken)) {
      return "Error: Invalid Momentum code edit session.";
    }
    var pendingSessionToken = _momentumReadCodeEditorOpenIntent();
    if (!pendingSessionToken) {
      return "missing";
    }
    if (pendingSessionToken !== sessionToken) {
      return "stale";
    }
    var runtimeFolder = _momentumGetRuntimeFolder();
    var intentFile = runtimeFolder
      ? new File(runtimeFolder.fsName + "/code-editor-open.pending")
      : null;
    if (!intentFile || (intentFile.exists && !intentFile.remove())) {
      return "Error: The Momentum code editor open intent could not be acknowledged.";
    }
    try {
      var claimFile = new File(
        runtimeFolder.fsName + "/code-editor-open.claimed"
      );
      if (claimFile.exists) {
        claimFile.remove();
      }
    } catch (_removeCodeEditorPanelClaimError) {}
    return "ok";
  } catch (error) {
    return "Error: " + error.toString();
  }
}

function _momentumReadCodeEditSession(explicitSessionToken) {
  var sessionToken = String(explicitSessionToken || "");
  if (!_momentumIsSafeCodeEditSessionToken(sessionToken)) {
    return null;
  }
  if (!$.global.__momentumCodeEditSessionCache) {
    $.global.__momentumCodeEditSessionCache = {};
  }
  var cachedSession =
    $.global.__momentumCodeEditSessionCache[sessionToken] || null;
  if (cachedSession && cachedSession.sessionFolder &&
      cachedSession.sessionFolder.exists) {
    return cachedSession;
  }
  delete $.global.__momentumCodeEditSessionCache[sessionToken];
  var sessionFolder = _momentumGetCodeEditSessionFolder(sessionToken);
  var contextText = _momentumReadCodeEditorText(
    sessionFolder ? new File(sessionFolder.fsName + "/context.txt") : null
  );
  if (contextText === null) {
    return null;
  }
  var contextLines = contextText.replace(/\r/g, "").split("\n");
  if (Math.floor(Number(contextLines[0]) || 0) !== 3) {
    return null;
  }
  var baseFields = String(contextLines[1] || "").split("\t");
  var targetFields = String(contextLines[2] || "").split("\t");
  var cueCount = Math.floor(Number(contextLines[3]));
  if (baseFields.length !== 4 || !baseFields[0] || !baseFields[1] ||
      targetFields.length !== 6 ||
      !isFinite(Number(targetFields[0])) ||
      !isFinite(Number(targetFields[1])) || Number(targetFields[1]) <= 0 ||
      (targetFields[2] !== "existing-cue" && targetFields[2] !== "new-cue") ||
      !targetFields[3] || !targetFields[4] || !targetFields[5] ||
      !isFinite(cueCount) || cueCount < 0 || cueCount > 100000) {
    return null;
  }
  var baseEntry = {
    timeSeconds: null,
    sourceHash: String(baseFields[0]),
    controllerHash: String(baseFields[1]),
    sourcePath: String(baseFields[2]),
    bundlePath: String(baseFields[3])
  };
  var cues = [];
  for (var cueIndex = 0; cueIndex < cueCount; cueIndex++) {
    var cueFields = String(contextLines[4 + cueIndex] || "").split("\t");
    if (cueFields.length !== 6 || !isFinite(Number(cueFields[0])) ||
        !isFinite(Number(cueFields[1])) || Number(cueFields[1]) <= 0 ||
        !cueFields[2] || String(cueFields[3]) !== baseEntry.controllerHash) {
      return null;
    }
    cues.push({
      timeValue: Number(cueFields[0]),
      timeScale: Number(cueFields[1]),
      sourceHash: String(cueFields[2]),
      controllerHash: String(cueFields[3]),
      sourcePath: String(cueFields[4]),
      bundlePath: String(cueFields[5])
    });
  }
  var parsedSession = {
    sessionToken: sessionToken,
    sessionFolder: sessionFolder,
    controllerHash: baseEntry.controllerHash,
    baseEntry: baseEntry,
    target: {
      timeValue: Number(targetFields[0]),
      timeScale: Number(targetFields[1]),
      mode: String(targetFields[2]),
      sourceHash: String(targetFields[3]),
      sourcePath: String(targetFields[4]),
      bundlePath: String(targetFields[5])
    },
    cues: cues,
    frozenCues: cues.slice(0)
  };
  $.global.__momentumCodeEditSessionCache[sessionToken] = parsedSession;
  return parsedSession;
}

function _momentumFindCodeEditSourceEntry(session, sourceHash) {
  var hash = String(sourceHash || "");
  if (!session || !hash) {
    return null;
  }
  if (session.baseEntry && session.baseEntry.sourceHash === hash) {
    return session.baseEntry;
  }
  var cues = session.cues || [];
  for (var cueIndex = 0; cueIndex < cues.length; cueIndex++) {
    if (String(cues[cueIndex].sourceHash) === hash) {
      return cues[cueIndex];
    }
  }
  return null;
}

function _momentumReadLiveCodeEditTimeline(session) {
  if (!session || !session.sessionFolder) {
    return null;
  }
  var markerText = _momentumReadCodeEditorText(
    new File(session.sessionFolder.fsName + "/timeline.changed")
  );
  if (markerText === null) {
    return {
      fingerprint: "",
      cues: session.cues || []
    };
  }
  if (String(markerText) === String(session.timelineFingerprint || "")) {
    return {
      fingerprint: String(markerText),
      cues: session.cues || []
    };
  }
  var lines = String(markerText).replace(/\r/g, "").split("\n");
  if (String(lines[0] || "") !== "timeline-v1") {
    return null;
  }
  var liveCues = [];
  for (var lineIndex = 1; lineIndex < lines.length; lineIndex++) {
    var line = String(lines[lineIndex] || "");
    if (!line) {
      continue;
    }
    var fields = line.split("\t");
    var timeFields = String(fields[0] || "").split("/");
    var timeValue = Number(timeFields[0]);
    var timeScale = Number(timeFields[1]);
    var sourceHash = String(fields[1] || "");
    var sourceEntry = _momentumFindCodeEditSourceEntry(
      session,
      sourceHash
    );
    if (fields.length !== 2 || timeFields.length !== 2 ||
        !isFinite(timeValue) || !isFinite(timeScale) || timeScale <= 0 ||
        !sourceEntry) {
      return null;
    }
    liveCues.push({
      timeValue: timeValue,
      timeScale: timeScale,
      sourceHash: sourceHash,
      controllerHash: sourceEntry.controllerHash,
      sourcePath: sourceEntry.sourcePath,
      bundlePath: sourceEntry.bundlePath
    });
  }
  return {
    fingerprint: String(markerText),
    cues: liveCues
  };
}

function _momentumResolveLiveCodeEditSession(session, target) {
  var liveTimeline = _momentumReadLiveCodeEditTimeline(session);
  if (!session || !target || !target.comp || !liveTimeline) {
    return null;
  }
  var targetScale = Math.max(1, Number(session.target.timeScale) || 1);
  var playheadSeconds = Number(target.comp.time || 0);
  var targetTime = {
    timeValue: Math.round(playheadSeconds * targetScale),
    timeScale: targetScale
  };
  var targetEntry = session.baseEntry;
  var targetMode = "new-cue";
  var liveCues = liveTimeline.cues || [];
  for (var cueIndex = 0; cueIndex < liveCues.length; cueIndex++) {
    var cue = liveCues[cueIndex];
    var cueSeconds = Number(cue.timeValue) / Number(cue.timeScale);
    if (cueSeconds > playheadSeconds + 0.000001) {
      break;
    }
    targetEntry = cue;
    if (Math.abs(cueSeconds - playheadSeconds) <= 0.000001) {
      targetMode = "existing-cue";
      targetTime.timeValue = cue.timeValue;
      targetTime.timeScale = cue.timeScale;
      break;
    }
  }
  if (!targetEntry) {
    return null;
  }
  session.cues = liveCues;
  session.target = {
    timeValue: targetTime.timeValue,
    timeScale: targetTime.timeScale,
    mode: targetMode,
    sourceHash: targetEntry.sourceHash,
    sourcePath: targetEntry.sourcePath,
    bundlePath: targetEntry.bundlePath
  };
  session.timelineFingerprint = liveTimeline.fingerprint;
  return session;
}

function _momentumSerializeCodeEditorTimeline(cues) {
  var timeline = ["timeline-v1"];
  var entries = cues || [];
  for (var cueIndex = 0; cueIndex < entries.length; cueIndex++) {
    var cue = entries[cueIndex];
    var timeValue = Number(cue && cue.timeValue);
    var timeScale = Number(cue && cue.timeScale);
    var sourceHash = String(cue && cue.sourceHash || "");
    if (!isFinite(timeValue) || !isFinite(timeScale) || timeScale <= 0 ||
        !sourceHash) {
      return null;
    }
    timeline.push(
      String(timeValue) + "/" + String(timeScale) + "\t" + sourceHash
    );
  }
  timeline.push("");
  return timeline.join("\n");
}

function _momentumCodeEditorTimelineStamp(file) {
  if (!file || !file.exists) {
    return "missing";
  }
  var modifiedTime = 0;
  try {
    modifiedTime = file.modified ? file.modified.getTime() : 0;
  } catch (_codeEditorTimelineModifiedError) {}
  return String(modifiedTime) + ":" + String(Number(file.length) || 0);
}

function _momentumReadCodeEditorTimelineUpdate(record) {
  if (!record || !record.sessionFolderPath) {
    throw new Error("The live Code Cue session is unavailable.");
  }
  var marker = new File(
    record.sessionFolderPath + "/timeline.changed"
  );
  var nextStamp = _momentumCodeEditorTimelineStamp(marker);
  if (nextStamp === record.timelineStamp) {
    return "";
  }
  var nextTimeline = record.frozenTimeline;
  if (marker.exists) {
    nextTimeline = _momentumReadCodeEditorText(marker);
    if (nextTimeline === null) {
      throw new Error("The live Code Cue timeline could not be read.");
    }
  }
  record.timelineStamp = nextStamp;
  if (String(nextTimeline) === String(record.currentTimeline)) {
    return "";
  }
  record.currentTimeline = String(nextTimeline);
  return record.currentTimeline;
}

function momentumReadCodeEditorTimeline(encodedSessionToken) {
  try {
    var sessionToken = _momentumDecodeURIComponent(encodedSessionToken);
    var records = $.global.__momentumCodeEditorTargets || {};
    var record = records[sessionToken] || null;
    if (!record) {
      return "2\tThe Code timeline session is unavailable.";
    }
    var timelineUpdate = _momentumReadCodeEditorTimelineUpdate(record);
    return timelineUpdate
      ? "1\t" + encodeURIComponent(timelineUpdate)
      : "0";
  } catch (error) {
    return "2\t" + String(error).replace(/[\r\n\t]+/g, " ");
  }
}

function _momentumReadFrozenCodeEditFile(session, relativePath) {
  var path = String(relativePath || "");
  if (!session || !session.sessionFolder || !path ||
      path.indexOf("..") >= 0 || !/^[A-Za-z0-9._\/-]+$/.test(path)) {
    return null;
  }
  if (!$.global.__momentumFrozenCodeFileCache) {
    $.global.__momentumFrozenCodeFileCache = {};
  }
  var sessionToken = String(session.sessionToken || "");
  var sessionCache =
    $.global.__momentumFrozenCodeFileCache[sessionToken] || null;
  if (!sessionCache) {
    sessionCache = {};
    $.global.__momentumFrozenCodeFileCache[sessionToken] = sessionCache;
  }
  if (sessionCache.hasOwnProperty(path)) {
    return sessionCache[path];
  }
  var text = _momentumReadCodeEditorText(
    new File(session.sessionFolder.fsName + "/" + path)
  );
  if (text !== null) {
    sessionCache[path] = text;
  }
  return text;
}

function _momentumReadCodeEditSources(session) {
  if (!session || !session.baseEntry) {
    return null;
  }
  var entries = [session.baseEntry].concat(session.cues || []);
  var seenHashes = {};
  var sources = [];
  for (var entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    var entry = entries[entryIndex];
    var sourceHash = String(entry && entry.sourceHash || "");
    if (!sourceHash || seenHashes[sourceHash]) {
      continue;
    }
    var source = _momentumReadFrozenCodeEditFile(
      session,
      entry.sourcePath
    );
    if (source === null) {
      return null;
    }
    seenHashes[sourceHash] = true;
    sources.push({
      sourceHash: sourceHash,
      source: source
    });
  }
  return sources;
}

function _momentumReadFrozenBaseBundle(session) {
  if (!session || !session.baseEntry) {
    return null;
  }
  var bundleText = _momentumReadFrozenCodeEditFile(
    session,
    session.baseEntry.bundlePath
  );
  if (bundleText === null) {
    return null;
  }
  var bundle = null;
  try {
    bundle = JSON.parse(bundleText);
  } catch (_baseBundleParseError) {
    return null;
  }
  if (!bundle ||
      String(bundle.sourceHash || "") !== session.baseEntry.sourceHash) {
    return null;
  }
  return bundle;
}

function _momentumReadFrozenBaseController(session, bundle) {
  if (!session || !bundle) {
    return null;
  }
  var controller = bundle.controller || { hash: "none", configs: [] };
  return String(controller.hash || "none") === session.controllerHash
    ? controller
    : null;
}

function _momentumResolveCodeEditorRuntimePath(relativePath, fallbackName) {
  var normalizedPath = String(relativePath || "").replace(/\\/g, "/");
  if (/^(?:\/|[A-Za-z]:\/)/.test(normalizedPath)) {
    return normalizedPath;
  }
  var runtimeFolder = _momentumGetRuntimeFolder();
  if (!runtimeFolder) {
    return "";
  }
  var suffix = normalizedPath || String(fallbackName || "");
  return suffix
    ? String(runtimeFolder.fsName || "").replace(/\\/g, "/") + "/" + suffix
    : "";
}

function _momentumReadObjectId(object, fallback) {
  try {
    var id = Number(object.id);
    if (isFinite(id) && id > 0) {
      return Math.floor(id);
    }
  } catch (_readObjectIdError) {}
  return fallback;
}

function _momentumBuildEffectLocator(target) {
  return {
    compId: _momentumReadObjectId(target.comp, 0),
    compName: String(target.comp.name || ""),
    layerId: _momentumReadObjectId(target.layer, 0),
    layerIndex: Number(target.layer.index) || 0,
    effectIndex: Number(target.effect.propertyIndex) || 0,
    effectMatchName: String(target.effect.matchName || "Momentum")
  };
}

function _momentumFindCompByLocator(locator) {
  if (!app.project || !locator) {
    return null;
  }
  for (var itemIndex = 1; itemIndex <= app.project.numItems; itemIndex++) {
    var item = app.project.item(itemIndex);
    if (!(item instanceof CompItem)) {
      continue;
    }
    var itemId = _momentumReadObjectId(item, 0);
    if ((locator.compId > 0 && itemId === locator.compId) ||
        (locator.compId <= 0 && String(item.name) === String(locator.compName))) {
      return item;
    }
  }
  return null;
}

function _momentumResolveCodeSnapshotTarget(locator) {
  var comp = _momentumFindCompByLocator(locator);
  if (!comp) {
    return null;
  }
  var layer = null;
  for (var layerIndex = 1; layerIndex <= comp.numLayers; layerIndex++) {
    var candidateLayer = comp.layer(layerIndex);
    var candidateId = _momentumReadObjectId(candidateLayer, 0);
    if ((locator.layerId > 0 && candidateId === locator.layerId) ||
        (locator.layerId <= 0 && layerIndex === Number(locator.layerIndex))) {
      layer = candidateLayer;
      break;
    }
  }
  if (!layer) {
    return null;
  }
  var parade = layer.property("ADBE Effect Parade");
  var effect = parade && locator.effectIndex > 0
    ? parade.property(Number(locator.effectIndex))
    : null;
  if (!_momentumIsMomentumEffect(effect) ||
      (locator.effectMatchName &&
       String(effect.matchName || "") !== String(locator.effectMatchName))) {
    return null;
  }
  return { comp: comp, layer: layer, effect: effect };
}

function momentumGetCodeEditorContext(encodedSessionToken) {
  try {
    var explicitSessionToken = _momentumDecodeURIComponent(encodedSessionToken);
    var session = _momentumReadCodeEditSession(explicitSessionToken);
    var target = null;
    try {
      var pendingTarget = $.global.__momentumPendingCodeEditorTarget || null;
      if (pendingTarget && _momentumIsMomentumEffect(pendingTarget.effect)) {
        target = pendingTarget;
      }
    } catch (_pendingCodeEditorTargetError) {}
    if (!target) {
      try {
        var storedTargets = $.global.__momentumCodeEditorTargets || {};
        var storedTarget = storedTargets[explicitSessionToken];
        if (storedTarget && storedTarget.target &&
            _momentumIsMomentumEffect(storedTarget.target.effect)) {
          target = storedTarget.target;
        }
      } catch (_storedCodeEditorTargetError) {}
    }
    if (!target) {
      target = _momentumFindSelectedMomentumEffect();
    }
    if (!session) {
      return "Error: No Momentum code edit session is available.";
    }
    if (!target) {
      return "Error: Select exactly one Momentum effect and click its Edit Code button again.";
    }
    session = _momentumResolveLiveCodeEditSession(session, target);
    if (!session || !session.target) {
      return "Error: The Momentum code edit target could not be resolved.";
    }
    var sources = _momentumReadCodeEditSources(session);
    var bundleText = _momentumReadFrozenCodeEditFile(
      session,
      session.target.bundlePath
    );
    var baseBundle = _momentumReadFrozenBaseBundle(session);
    var baseController = _momentumReadFrozenBaseController(
      session,
      baseBundle
    );
    if (!sources || bundleText === null || !baseBundle || !baseController) {
      return "Error: The code edit session could not be read.";
    }
    var bundle = {};
    try {
      bundle = JSON.parse(bundleText);
    } catch (bundleParseError) {
      return "Error: The stored Momentum bundle is invalid: " + bundleParseError.toString();
    }
    var bundleSourceHash = String(bundle.sourceHash || "");
    var bundleControllerHash = String(
      bundle && bundle.controller && bundle.controller.hash || "none"
    );
    if (bundleSourceHash !== session.target.sourceHash) {
      return "Error: The Momentum source changed before the editor opened.";
    }
    if (session.controllerHash !== bundleControllerHash) {
      return "Error: The Momentum controller schema changed before the editor opened.";
    }
    var locator = _momentumBuildEffectLocator(target);
    var frozenTimeline = _momentumSerializeCodeEditorTimeline(
      session.frozenCues || []
    );
    var currentTimeline = _momentumSerializeCodeEditorTimeline(
      session.cues || []
    );
    if (frozenTimeline === null || currentTimeline === null) {
      return "Error: The Momentum Code Cue timeline is invalid.";
    }
    $.global.__momentumCodeEditorLocator = locator;
    if (!$.global.__momentumCodeEditorTargets) {
      $.global.__momentumCodeEditorTargets = {};
    }
    for (var storedToken in $.global.__momentumCodeEditorTargets) {
      if (!$.global.__momentumCodeEditorTargets.hasOwnProperty(storedToken)) {
        continue;
      }
      var storedRecord = $.global.__momentumCodeEditorTargets[storedToken];
      if (storedToken !== session.sessionToken && storedRecord &&
          storedRecord.target === target) {
        delete $.global.__momentumCodeEditorTargets[storedToken];
      }
    }
    $.global.__momentumCodeEditorTargets[session.sessionToken] = {
      target: target,
      locator: locator,
      sessionFolderPath: session.sessionFolder.fsName,
      frozenTimeline: frozenTimeline,
      currentTimeline: currentTimeline,
      timelineStamp: _momentumCodeEditorTimelineStamp(
        new File(session.sessionFolder.fsName + "/timeline.changed")
      )
    };
    $.global.__momentumPendingCodeEditorTarget = null;
    var targetTimeSeconds =
      Number(session.target.timeValue) / Number(session.target.timeScale);
    return JSON.stringify({
      ok: true,
      sessionToken: session.sessionToken,
      sourceHash: session.target.sourceHash,
      controllerHash: session.controllerHash,
      locator: locator,
      compName: target.comp.name,
      debugTracePath: _momentumResolveCodeEditorRuntimePath(
        baseBundle.debugTracePath,
        "debug_trace.log"
      ),
      viewClockPath: _momentumResolveCodeEditorRuntimePath(
        "",
        "code-editor-view-clock.txt"
      ),
      layerName: target.layer.name,
      targetMode: session.target.mode,
      targetTimeValue: session.target.timeValue,
      targetTimeScale: session.target.timeScale,
      targetTimeSeconds: targetTimeSeconds,
      playheadTimeSeconds: Number(target.comp.time || 0),
      duration: Number(target.comp.duration || 0),
      frameDuration: Number(target.comp.frameDuration || 0),
      workAreaDuration: Number(target.comp.workAreaDuration || 0),
      workAreaStart: Number(target.comp.workAreaStart || 0),
      baseSourceHash: session.baseEntry.sourceHash,
      cues: session.cues,
      sources: sources,
      controller: baseController,
      runtimeMetadata: {
        debugTracePath: String(baseBundle.debugTracePath || ""),
        sourcePath: String(baseBundle.sourcePath || "sketch.js")
      },
      sourceCount: sources.length
    });
  } catch (error) {
    _momentumAppendCodeEditorDiagnostic("context-exception", error.toString());
    return "Error: " + error.toString();
  }
}

function _momentumParseCodeEditorLocator(encodedLocator) {
  try {
    var locatorText = _momentumDecodeURIComponent(encodedLocator);
    return locatorText ? JSON.parse(locatorText) : null;
  } catch (_parseCodeEditorLocatorError) {
    return null;
  }
}

function _momentumResolveCodeEditorCommandTarget(sessionToken, encodedLocator) {
  var locator = _momentumParseCodeEditorLocator(encodedLocator);
  return _momentumResolveStoredCodeEditTarget(sessionToken, locator);
}

function _momentumToggleCodeEditorSignal(target) {
  var signal = target && target.effect
    ? target.effect.property("Code Edit Signal") ||
      target.effect.property(_MOMENTUM_NATIVE_CODE_COMMIT_PARAM_INDEX)
    : null;
  if (!signal) {
    return "The Momentum code edit signal is unavailable.";
  }
  var currentSignal = Number(signal.value) >= 0.5 ? 1 : 0;
  signal.setValue(currentSignal ? 0 : 1);
  return "";
}

function _momentumQueueCodeEditorCommand(
  commandName,
  sessionToken,
  encodedLocator
) {
  var token = String(sessionToken || "");
  if (!_momentumIsSafeCodeEditSessionToken(token)) {
    return "Error: Invalid Momentum code edit session.";
  }
  var target = _momentumResolveCodeEditorCommandTarget(
    token,
    encodedLocator
  );
  if (!target) {
    return "Error: The Momentum effect moved or was removed while the editor was open.";
  }
  var runtimeFolder = _momentumGetRuntimeFolder();
  if (!runtimeFolder) {
    return "Error: The Momentum runtime directory is unavailable.";
  }
  var commandFile = new File(
    runtimeFolder.fsName + "/code-edit-" + commandName + ".pending"
  );
  var conflictingFiles = [
    new File(runtimeFolder.fsName + "/code-edit-commit.pending"),
    new File(runtimeFolder.fsName + "/code-edit-refresh.pending"),
    new File(runtimeFolder.fsName + "/code-edit-close.pending")
  ];
  for (var index = 0; index < conflictingFiles.length; index++) {
    if (conflictingFiles[index].exists) {
      return "Error: Another Momentum code editor command is still pending.";
    }
  }
  var writeError = _momentumWriteTextFileRaw(
    commandFile,
    ["1", token, ""].join("\n")
  );
  if (writeError) {
    return "Error: " + String(writeError);
  }
  if (commandName === "refresh") {
    $.global.__momentumPendingCodeEditorTarget = target;
  }
  var signalError = _momentumToggleCodeEditorSignal(target);
  if (signalError) {
    try { commandFile.remove(); } catch (_removeCodeEditorCommandError) {}
    if (commandName === "refresh") {
      $.global.__momentumPendingCodeEditorTarget = null;
    }
    return "Error: " + signalError;
  }
  return JSON.stringify({
    ok: true,
    queued: true,
    sessionToken: token,
    command: commandName
  });
}

function momentumRequestCodeEditorRefresh(encodedSessionToken, encodedLocator) {
  try {
    return _momentumQueueCodeEditorCommand(
      "refresh",
      _momentumDecodeURIComponent(encodedSessionToken),
      encodedLocator
    );
  } catch (error) {
    return "Error: " + error.toString();
  }
}

function momentumCloseCodeEditorSession(encodedSessionToken, encodedLocator) {
  try {
    var sessionToken = _momentumDecodeURIComponent(encodedSessionToken);
    var result = _momentumQueueCodeEditorCommand(
      "close",
      sessionToken,
      encodedLocator
    );
    if (String(result).indexOf("Error:") !== 0) {
      if ($.global.__momentumCodeEditorTargets) {
        delete $.global.__momentumCodeEditorTargets[sessionToken];
      }
      if ($.global.__momentumCodeEditSessionCache) {
        delete $.global.__momentumCodeEditSessionCache[sessionToken];
      }
      if ($.global.__momentumFrozenCodeFileCache) {
        delete $.global.__momentumFrozenCodeFileCache[sessionToken];
      }
      $.global.__momentumPendingCodeEditorTarget = null;
    }
    return result;
  } catch (error) {
    return "Error: " + error.toString();
  }
}

function _momentumResolveStoredCodeEditTarget(sessionToken, locator) {
  try {
    var records = $.global.__momentumCodeEditorTargets || {};
    var record = records[String(sessionToken)] || null;
    if (record && record.target &&
        _momentumIsMomentumEffect(record.target.effect)) {
      return record.target;
    }
  } catch (_storedCodeEditTargetError) {}
  return _momentumResolveCodeSnapshotTarget(locator);
}

function momentumConfirmCodeSnapshot(encodedPayload) {
  var payloadText = _momentumDecodeURIComponent(encodedPayload);
  var payload = null;
  try {
    payload = payloadText ? JSON.parse(payloadText) : {};
  } catch (parseError) {
    return "Error: Invalid code snapshot payload: " + parseError.toString();
  }

  var sessionToken = String(payload.sessionToken || "");
  var editTarget = String(payload.editTarget || "");
  if (editTarget !== "cue" && editTarget !== "base") {
    return "Error: The Momentum code edit target is invalid.";
  }
  var session = _momentumReadCodeEditSession(sessionToken);
  if (!session || session.sessionToken !== sessionToken) {
    return "Error: This code edit session is unavailable.";
  }
  var target = _momentumResolveStoredCodeEditTarget(
    sessionToken,
    payload.locator
  );
  if (!target) {
    return "Error: The Momentum effect moved or was removed while the editor was open.";
  }
  session = _momentumResolveLiveCodeEditSession(session, target);
  if (!session || !session.target) {
    return "Error: The live Momentum Code timeline could not be resolved.";
  }
  if (String(payload.controllerHash || "none") !== session.controllerHash) {
    return "Error: The Momentum effect changed while the editor was open.";
  }

  var targetMode = editTarget === "base"
    ? "base"
    : String(session.target.mode || "");
  var targetTimeValue = editTarget === "base"
    ? 0
    : Number(session.target.timeValue);
  var targetTimeScale = editTarget === "base"
    ? 1
    : Number(session.target.timeScale);
  var originalSourceHash = editTarget === "base"
    ? String(session.baseEntry && session.baseEntry.sourceHash || "")
    : String(session.target.sourceHash || "");
  if ((targetMode !== "base" &&
       targetMode !== "existing-cue" &&
       targetMode !== "new-cue") ||
      !isFinite(targetTimeValue) || !isFinite(targetTimeScale) ||
      targetTimeScale <= 0 ||
      !originalSourceHash) {
    return "Error: The Momentum code edit target is invalid.";
  }
  var targetTimeSeconds = targetTimeValue / targetTimeScale;

  var source = String(payload.source || "");
  if (typeof _momentumNormalizeCodeSourceText === "function") {
    source = _momentumNormalizeCodeSourceText(source);
  }
  var bundle = payload.bundle || {};
  var sessionFolder = session.sessionFolder;
  if (!sessionFolder || !_momentumEnsureFolder(sessionFolder)) {
    return "Error: The Momentum code edit session is unavailable.";
  }
  bundle.sourcePath =
    "code-edit-sessions/" + sessionToken + "/source.js";
  if (editTarget === "cue") {
    bundle.momentumCueTimeSeconds = targetTimeSeconds;
  }

  try {
    var commitProp = target.effect.property("Code Edit Signal") ||
      target.effect.property(_MOMENTUM_NATIVE_CODE_COMMIT_PARAM_INDEX);
    if (!commitProp) {
      return "Error: The Momentum code edit signal is unavailable.";
    }
    var writeError = _momentumWriteTextFileRaw(
      new File(sessionFolder.fsName + "/source.js"),
      source
    );
    if (!writeError) {
      writeError = _momentumWriteTextFileRaw(
        new File(sessionFolder.fsName + "/bundle.json"),
        JSON.stringify(bundle, null, 2)
      );
    }
    if (writeError) {
      throw new Error(String(writeError));
    }

    var runtimeFolder = _momentumGetRuntimeFolder();
    if (!runtimeFolder) {
      throw new Error("The Momentum runtime directory is unavailable.");
    }
    var pendingFile = new File(
      runtimeFolder.fsName + "/code-edit-commit.pending"
    );
    var resultFolder = new Folder(
      runtimeFolder.fsName + "/code-edit-results"
    );
    if (!_momentumEnsureFolder(resultFolder)) {
      throw new Error("The Momentum code edit result directory is unavailable.");
    }
    var resultFile = new File(
      resultFolder.fsName + "/" + sessionToken + ".result"
    );
    if (resultFile.exists) {
      try { resultFile.remove(); } catch (_staleCodeEditResultError) {}
    }
    if (pendingFile.exists) {
      throw new Error("Another Momentum code edit is still being submitted.");
    }

    var requestText = [
      "2",
      sessionToken,
      targetMode,
      String(targetTimeValue),
      String(targetTimeScale),
      originalSourceHash,
      ""
    ].join("\n");
    writeError = _momentumWriteTextFileRaw(
      new File(sessionFolder.fsName + "/commit.request"),
      requestText
    );
    if (!writeError) {
      writeError = _momentumWriteTextFileRaw(
        pendingFile,
        ["1", sessionToken, ""].join("\n")
      );
    }
    if (writeError) {
      throw new Error(String(writeError));
    }

    var currentSignal = Number(commitProp.value) >= 0.5 ? 1 : 0;
    commitProp.setValue(currentSignal ? 0 : 1);
    return JSON.stringify({
      ok: true,
      queued: true,
      sessionToken: sessionToken,
      targetMode: targetMode,
      targetTimeValue: targetTimeValue,
      targetTimeScale: targetTimeScale
    });
  } catch (error) {
    return "Error: Failed to queue the Code edit: " + error.toString();
  }
}

function momentumGetCodeEditCommitResult(encodedSessionToken) {
  try {
    var sessionToken = _momentumDecodeURIComponent(encodedSessionToken);
    if (!_momentumIsSafeCodeEditSessionToken(sessionToken)) {
      return "Error: Invalid Momentum code edit session.";
    }
    var runtimeFolder = _momentumGetRuntimeFolder();
    var resultFile = runtimeFolder
      ? new File(
          runtimeFolder.fsName +
          "/code-edit-results/" + sessionToken + ".result"
        )
      : null;
    if (!resultFile || !resultFile.exists) {
      return JSON.stringify({ ok: true, done: false });
    }
    var resultText = _momentumReadCodeEditorText(resultFile);
    try { resultFile.remove(); } catch (_codeEditResultCleanupError) {}
    var resultLines = String(resultText || "").replace(/\r/g, "").split("\n");
    var succeeded = resultLines[0] === "ok";
    return JSON.stringify({
      ok: true,
      done: true,
      succeeded: succeeded,
      errorCode: Number(resultLines[1]) || 0,
      message: String(resultLines[2] || "")
    });
  } catch (error) {
    return "Error: " + error.toString();
  }
}
