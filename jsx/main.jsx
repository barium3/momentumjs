var __momentumJsxRoot = null;

try {
  if ($.global.__momentumExtensionPath) {
    __momentumJsxRoot = new Folder(
      String($.global.__momentumExtensionPath).replace(/[\\\/]+$/, "") + "/jsx"
    );
  }
} catch (_momentumRootError) {}

if (!__momentumJsxRoot || !__momentumJsxRoot.exists) {
  __momentumJsxRoot = new Folder(File($.fileName).parent.fsName);
}

function __momentumResolve(relativePath) {
  var file = new File(__momentumJsxRoot.fsName + "/" + relativePath);
  if (!file.exists) {
    throw new Error("Missing JSX module: " + file.fsName);
  }
  return file;
}

$.evalFile(__momentumResolve("polyfills/json.jsx"));
$.evalFile(__momentumResolve("plugin/payloadBuffer.jsx"));
$.evalFile(__momentumResolve("plugin/runtimeFiles.jsx"));
$.evalFile(__momentumResolve("plugin/bitmapApply.jsx"));
$.evalFile(__momentumResolve("plugin/projectIO.jsx"));
