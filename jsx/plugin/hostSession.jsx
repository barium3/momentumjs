var __momentumHostProtocolVersion = "2";

function _momentumHostSessionId() {
  var sessionId = "";
  try {
    sessionId = String($.global.__momentumHostSessionId || "");
  } catch (_hostSessionReadError) {}
  if (!sessionId) {
    sessionId =
      String(new Date().getTime()) +
      "-" +
      String(Math.floor(Math.random() * 1000000000));
    try {
      $.global.__momentumHostSessionId = sessionId;
    } catch (_hostSessionWriteError) {}
  }
  return sessionId;
}

function _momentumHostExtensionRoot() {
  var extensionPath = "";
  try {
    extensionPath = String($.global.__momentumExtensionPath || "");
  } catch (_hostExtensionPathError) {}
  if (extensionPath) {
    return new Folder(extensionPath);
  }
  try {
    if (__momentumJsxRoot && __momentumJsxRoot.exists) {
      return __momentumJsxRoot.parent;
    }
  } catch (_hostJsxRootError) {}
  return null;
}

function _momentumHostPlatformName() {
  try {
    return String($.os || "").toLowerCase().indexOf("windows") >= 0
      ? "windows"
      : "macos";
  } catch (_hostPlatformError) {
    return "unknown";
  }
}

function momentumHostHandshake(encodedRequest) {
  try {
    var requestText = decodeURIComponent(String(encodedRequest || ""));
    var request = requestText ? JSON.parse(requestText) : {};
    var requestedProtocol = String(request.protocolVersion || "");
    if (requestedProtocol !== __momentumHostProtocolVersion) {
      return JSON.stringify({
        ok: false,
        code: "HOST_PROTOCOL_MISMATCH",
        message:
          "CEP protocol " +
          requestedProtocol +
          " does not match host protocol " +
          __momentumHostProtocolVersion +
          ".",
        retryable: false
      });
    }

    if (typeof projectFileCommand !== "function") {
      return JSON.stringify({
        ok: false,
        code: "HOST_MODULES_INCOMPLETE",
        message: "The project file service is unavailable.",
        retryable: true
      });
    }

    var extensionRoot = _momentumHostExtensionRoot();
    if (!extensionRoot || !extensionRoot.exists) {
      return JSON.stringify({
        ok: false,
        code: "EXTENSION_ROOT_UNAVAILABLE",
        message: "The Momentum extension directory is unavailable.",
        retryable: true
      });
    }

    var userFolder = new Folder(extensionRoot.fsName + "/user");
    if (!userFolder.exists && !userFolder.create()) {
      return JSON.stringify({
        ok: false,
        code: "USER_DIRECTORY_UNAVAILABLE",
        message: "The Momentum user directory cannot be created.",
        path: userFolder.fsName,
        retryable: true
      });
    }

    var runtimeFolder =
      typeof _momentumGetRuntimeFolder === "function"
        ? _momentumGetRuntimeFolder()
        : null;

    return JSON.stringify({
      ok: true,
      protocolVersion: __momentumHostProtocolVersion,
      hostSessionId: _momentumHostSessionId(),
      clientSessionId: String(request.clientSessionId || ""),
      platform: _momentumHostPlatformName(),
      extensionRoot: extensionRoot.fsName.replace(/\\/g, "/"),
      userRoot: userFolder.fsName.replace(/\\/g, "/"),
      runtimeRoot: runtimeFolder
        ? runtimeFolder.fsName.replace(/\\/g, "/")
        : ""
    });
  } catch (error) {
    return JSON.stringify({
      ok: false,
      code: "HOST_HANDSHAKE_FAILED",
      message: error && error.toString ? error.toString() : String(error),
      retryable: true
    });
  }
}
