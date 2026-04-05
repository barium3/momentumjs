$.global.testFunction = function () {
  return "testFunction called";
};

var __momentumPayloadBuffers = $.global.__momentumPayloadBuffers || {};
$.global.__momentumPayloadBuffers = __momentumPayloadBuffers;

function _momentumGetPayloadFile(payloadId) {
  var safeId = String(payloadId || "payload").replace(/[^a-zA-Z0-9_-]/g, "_");
  return new File(Folder.temp.fsName + "/momentum_payload_" + safeId + ".json");
}

function startMomentumPayloadBuffer(payloadId) {
  __momentumPayloadBuffers[String(payloadId || "payload")] = "";
  return "OK";
}

function appendMomentumPayloadChunk(payloadId, encodedChunk) {
  var key = String(payloadId || "payload");
  var chunk = "";

  if (encodedChunk !== undefined && encodedChunk !== null) {
    chunk = String(encodedChunk);
  }

  if (!__momentumPayloadBuffers.hasOwnProperty(key)) {
    __momentumPayloadBuffers[key] = "";
  }

  __momentumPayloadBuffers[key] += chunk;
  return "OK";
}

function executeMomentumPayloadBuffer(payloadId) {
  var key = String(payloadId || "payload");
  var payloadText = __momentumPayloadBuffers.hasOwnProperty(key)
    ? __momentumPayloadBuffers[key]
    : null;

  if (payloadText === null) {
    return "ERROR: Momentum payload buffer not found: " + key;
  }

  var payloadFile = _momentumGetPayloadFile(key);

  try {
    payloadFile.encoding = "UTF-8";
    if (!payloadFile.open("w")) {
      return "ERROR: Cannot open payload file for writing: " + payloadFile.fsName;
    }
    payloadFile.write(payloadText);
    payloadFile.close();
  } catch (writeError) {
    try {
      payloadFile.close();
    } catch (_closeWriteError) {}
    return "ERROR: Cannot write payload file: " + writeError.toString();
  }

  try {
    payloadFile.encoding = "UTF-8";
    if (!payloadFile.open("r")) {
      return "ERROR: Cannot open payload file for reading: " + payloadFile.fsName;
    }

    var raw = payloadFile.read();
    payloadFile.close();
    var payload = JSON.parse(raw);
    var args = payload && payload.args ? payload.args : null;

    if (!args || !(args instanceof Array)) {
      return "ERROR: Invalid Momentum payload";
    }

    if (typeof m === "undefined" || !m || typeof m.runParsed !== "function") {
      return "ERROR: Momentum library is not loaded";
    }

    m._debugLogs = [];
    m.runParsed.apply(m, args);
    return "__DEBUG__" + JSON.stringify(m._debugLogs || []);
  } catch (execError) {
    return (
      "ERROR: " +
      execError.message +
      " at line " +
      execError.line +
      " stack: " +
      execError.stack
    );
  } finally {
    try {
      delete __momentumPayloadBuffers[key];
    } catch (_deleteBufferError) {
      __momentumPayloadBuffers[key] = undefined;
    }
    try {
      if (payloadFile.exists) {
        payloadFile.remove();
      }
    } catch (_removeFileError) {}
  }
}
