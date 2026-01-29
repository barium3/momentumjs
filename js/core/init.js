// Initialize CSInterface and ExtendScript environment
const csInterface = new CSInterface();

window.csInterface = csInterface;

const extensionPath = csInterface.getSystemPath(SystemPath.EXTENSION);
csInterface.evalScript(`$.evalFile("${extensionPath}/jsx/main.jsx")`);

window.persistentStorage = {};

window.persistentStorage.get = function (key, defaultValue) {
  return this[key] !== undefined ? this[key] : defaultValue;
};

window.persistentStorage.set = function (key, value) {
  this[key] = value;
};

document.addEventListener("DOMContentLoaded", () => {
  csInterface.evalScript("typeof($) !== 'undefined'", (result) => {
    if (result === "true") {
      window.fileManager.loadFileList();
    } else {
      document.getElementById("file-list").innerHTML =
        "<div>ExtendScript environment initialization failed</div>";
    }
  });
});
