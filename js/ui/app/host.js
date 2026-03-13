// Initialize CSInterface and ExtendScript environment for the panel shell.
const csInterface = new CSInterface();
const CEP_KEYBOARD_EVENT = "com.adobe.csxs.events.KeyboardEvent";

window.csInterface = csInterface;

// Expose the extension root for modules that need to resolve bundled assets.
window.extensionPath = csInterface.getSystemPath(SystemPath.EXTENSION);
const extensionPath = window.extensionPath;

csInterface.evalScript(`$.evalFile("${extensionPath}/jsx/main.jsx")`);

function registerMomentumShortcutInterest() {
  const shortcutInterest = [
    { keyCode: 191, metaKey: true },
    { keyCode: 191, ctrlKey: true },
    { keyCode: 65, metaKey: true },
    { keyCode: 65, ctrlKey: true },
    { keyCode: 82, metaKey: true },
    { keyCode: 82, ctrlKey: true },
    { keyCode: 90, metaKey: true },
    { keyCode: 90, metaKey: true, shiftKey: true },
    { keyCode: 90, ctrlKey: true },
    { keyCode: 90, ctrlKey: true, shiftKey: true },
    { keyCode: 89, ctrlKey: true },
  ];

  try {
    csInterface.registerKeyEventsInterest(JSON.stringify(shortcutInterest));
  } catch (error) {
    console.warn("Failed to register CEP key interest:", error);
  }
}

function forwardCepKeyboardEvent(event) {
  if (!event || !event.data) {
    return;
  }

  let payload = null;
  try {
    payload = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
  } catch (error) {
    console.warn("Failed to parse CEP keyboard event:", error, event.data);
    return;
  }

  window.dispatchEvent(
    new CustomEvent("momentum:cep-keydown", {
      detail: payload,
    }),
  );
}

registerMomentumShortcutInterest();
csInterface.addEventListener(CEP_KEYBOARD_EVENT, forwardCepKeyboardEvent);

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
