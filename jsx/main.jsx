$.global.testFunction = function () {
  return "testFunction called";
};

function getFileList(folderPath) {
  try {
    $.writeln("getFileList called with path: " + folderPath);
    var folder = new Folder(folderPath);
    if (!folder.exists) {
      $.writeln("Folder does not exist, attempting to create: " + folderPath);
      if (!folder.create()) {
        return JSON.stringify({
          error: "Folder does not exist and could not create: " + folderPath,
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
            isFolder: item instanceof Folder,
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
      folderPath: folderPath,
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
        "Classification result: " + data[0].label,
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
