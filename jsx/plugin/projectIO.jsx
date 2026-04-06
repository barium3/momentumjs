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

function readFileSegment(filePath, startOffset) {
  var file = new File(filePath);
  var offset = Math.max(0, Math.floor(Number(startOffset) || 0));
  if (!file.exists) {
    return JSON.stringify({
      ok: true,
      exists: false,
      text: "",
      startOffset: 0,
      nextOffset: 0,
      length: 0,
      modified: "",
    });
  }

  file.encoding = "UTF-8";
  if (!file.open("r")) {
    return JSON.stringify({
      ok: false,
      error: "Cannot open file for reading: " + file.fsName,
    });
  }

  try {
    var length = Math.max(0, Math.floor(Number(file.length) || 0));
    if (offset > length) {
      offset = 0;
    }
    if (offset > 0 && typeof file.seek === "function") {
      try {
        file.seek(offset, 0);
      } catch (_seekError) {
        offset = 0;
        try {
          file.seek(0, 0);
        } catch (_seekResetError) {}
      }
    }

    var text = file.read() || "";
    var modified = "";
    try {
      modified = String(file.modified || "");
    } catch (_modifiedError) {}
    file.close();

    return JSON.stringify({
      ok: true,
      exists: true,
      text: text,
      startOffset: offset,
      nextOffset: offset + text.length,
      length: length,
      modified: modified,
    });
  } catch (readError) {
    try {
      file.close();
    } catch (_closeError) {}
    return JSON.stringify({
      ok: false,
      error: "Cannot read file segment: " + readError.toString(),
    });
  }
}

function getActiveCompTimeInfo() {
  try {
    if (!app.project || !app.project.activeItem || !(app.project.activeItem instanceof CompItem)) {
      return JSON.stringify({
        ok: true,
        active: false,
      });
    }

    var comp = app.project.activeItem;
    var timeSeconds = Number(comp.time || 0);
    var frameDuration = Number(comp.frameDuration || 0);
    var frameRate = frameDuration > 0 ? (1 / frameDuration) : 0;
    var currentFrame = frameRate > 0
      ? Math.max(1, Math.floor(timeSeconds * frameRate) + 1)
      : 1;

    return JSON.stringify({
      ok: true,
      active: true,
      compName: String(comp.name || ""),
      timeSeconds: timeSeconds,
      frameDuration: frameDuration,
      frameRate: frameRate,
      currentFrame: currentFrame,
    });
  } catch (error) {
    return JSON.stringify({
      ok: false,
      error: "Cannot read active comp time: " + error.toString(),
    });
  }
}

function executeUserCode(userCode) {
  try {
    var result = eval(userCode);
    return result;
  } catch (error) {
    return "Execution error: " + error.message;
  }
}

function getAvailableFontCatalog() {
  try {
    if (!app.fonts || !app.fonts.allFonts) {
      return JSON.stringify([]);
    }

    var entries = [];
    var seen = {};
    var groups = app.fonts.allFonts;

    function remember(entry) {
      var key = [
        entry.family || "",
        entry.style || "",
        entry.displayName || "",
        entry.postScriptName || "",
      ].join("|");

      if (!entry.displayName || !entry.postScriptName || seen[key]) {
        return;
      }

      seen[key] = true;
      entries.push(entry);
    }

    for (var i = 0; i < groups.length; i++) {
      var group = groups[i];
      if (!group || !group.length) {
        continue;
      }

      for (var j = 0; j < group.length; j++) {
        var font = group[j];
        if (!font) {
          continue;
        }

        var familyName = font.familyName || "";
        var styleName = font.styleName || "";
        var postScriptName = font.postScriptName || "";
        var displayName = familyName;

        if (familyName && styleName) {
          displayName = familyName + " " + styleName;
        } else if (!displayName) {
          displayName = postScriptName;
        }

        remember({
          family: familyName,
          style: styleName,
          displayName: displayName,
          postScriptName: postScriptName,
        });
      }
    }

    return JSON.stringify(entries);
  } catch (e) {
    return JSON.stringify([]);
  }
}

function testExtendScript() {
  return "ExtendScript environment is working";
}

function writeFile(filePath, content) {
  $.writeln("Attempting to write file: " + filePath);
  $.writeln("Content length: " + content.length);
  var file = new File(filePath);
  file.encoding = "UTF-8";
  if (file.open("w")) {
    file.write(decodeURIComponent(content));
    file.close();
  } else {
    return "Error: Cannot open file for writing: " + filePath;
  }
}

function receiveDataFromJS(jsonData) {
  try {
    var data = JSON.parse(jsonData);
    $.writeln("Received data: " + JSON.stringify(data));

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
