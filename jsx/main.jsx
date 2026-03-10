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

function getFileList(folderPath) {
  try {
    $.writeln("getFileList called with path: " + folderPath);
    var folder = new Folder(folderPath);
    if (!folder.exists) {
      $.writeln("Folder does not exist, attempting to create: " + folderPath);
      if (!folder.create()) {
        return JSON.stringify({
          error: "Folder does not exist and could not create: " + folderPath
        });
      }
    }

    function getItemsRecursively(currentFolder) {
      try {
        var items = currentFolder.getFiles();
        if (!items || items.length === 0) {
          return [];
        }
        var list = [];
        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          var result = {
            name: item.name,
            path: item.fsName.replace(/\\/g, "/"),
            isFolder: item instanceof Folder
          };
          if (result.isFolder) {
            result.children = getItemsRecursively(item);
          }
          list.push(result);
        }
        return list;
      } catch (e) {
        $.writeln("Error in getItemsRecursively: " + e.toString());
        throw e;
      }
    }

    var fileList = getItemsRecursively(folder);
    $.writeln("Found " + fileList.length + " items");
    return JSON.stringify({ files: fileList, folderPath: folderPath });
  } catch (e) {
    $.writeln("Error in getFileList: " + e.toString());
    return JSON.stringify({
      error: "Error getting file list: " + e.toString(),
      folderPath: folderPath
    });
  }
}

function readFile(filePath) {
  var file = new File(filePath);
  if (!file.exists) {
    return "Error: File does not exist: " + filePath;
  }
  file.open("r");
  var content = file.read();
  file.close();
  return content;
}

function executeUserCode(userCode) {
  try {
    var result = eval(userCode);
    return result;
  } catch (error) {
    return "Execution error: " + error.message;
  }
}

function testExtendScript() {
  return "ExtendScript environment is working";
}

function writeFile(filePath, content) {
  $.writeln("Attempting to write file: " + filePath);
  $.writeln("Content length: " + content.length);
  var file = new File(filePath);
  file.encoding = "UTF-8"; // UTF-8 encoding
  if (file.open("w")) {
    // Open in write mode
    file.write(decodeURIComponent(content)); // Decode content
    file.close();
  } else {
    return "Error: Cannot open file for writing: " + filePath;
  }
}

// Function to receive data from JS
function receiveDataFromJS(jsonData) {
  try {
    var data = JSON.parse(jsonData);
    $.writeln("Received data: " + JSON.stringify(data));

    // Process the received data, e.g., create layers, apply effects, etc.
    if (app.project.activeItem && app.project.activeItem instanceof CompItem) {
      var comp = app.project.activeItem;
      var textLayer = comp.layers.addText(
        "Classification result: " + data[0].label
      );
      textLayer
        .property("Source Text")
        .setValue("Classification result: " + data[0].label);
    } else {
      alert("Please select a composition first.");
    }
  } catch (e) {
    $.writeln("Error parsing data: " + e.toString());
  }
}
