window.momentumPluginBridge = (function () {
  const ERROR_PREFIX = "ERROR:";
  const CEP_KEYBOARD_EVENT = "com.adobe.csxs.events.KeyboardEvent";
  const CODE_EDITOR_OPEN_EVENT = "com.example.momentum.codeEditor.open";
  const HOST_PROTOCOL_VERSION = "2";
  const HOST_RETRY_INITIAL_MS = 250;
  const HOST_RETRY_MAX_MS = 5000;
  const HOST_BOOTSTRAP_TIMEOUT_MS = 5000;
  const HOST_STATE = Object.freeze({
    IDLE: "idle",
    WAITING: "waiting",
    BOOTSTRAPPING: "bootstrapping",
    READY: "ready",
    DEGRADED: "degraded",
  });

  let csInterfaceInstance = null;
  let extendScriptReady = false;
  let extendScriptReadyCallbacks = [];
  let initialized = false;
  let hostState = HOST_STATE.IDLE;
  let hostSession = null;
  let hostBootstrapInFlight = false;
  let hostBootstrapTimer = 0;
  let hostBootstrapWatchdogTimer = 0;
  let hostBootstrapAttemptId = 0;
  let hostBootstrapFailureCount = 0;
  let hostWakeHooksInstalled = false;
  const clientSessionId =
    `cep-${Date.now()}-${Math.floor(Math.random() * 1000000000)}`;
  let codeEditorOpenQueue = Promise.resolve();
  let codeEditorOpenDrainPromise = null;
  const queuedCodeEditorOpenTokens = Object.create(null);

  function getCsInterface() {
    if (!csInterfaceInstance) {
      csInterfaceInstance = window.csInterface instanceof CSInterface
        ? window.csInterface
        : new CSInterface();
      window.csInterface = csInterfaceInstance;
    }
    return csInterfaceInstance;
  }

  function flushExtendScriptReady() {
    extendScriptReady = true;
    const callbacks = extendScriptReadyCallbacks.slice();
    extendScriptReadyCallbacks = [];
    callbacks.forEach((callback) => {
      try {
        callback();
      } catch (error) {
        console.warn("Failed to run ExtendScript ready callback:", error);
      }
    });
  }

  function onExtendScriptReady(callback) {
    if (extendScriptReady) {
      callback();
      return;
    }
    extendScriptReadyCallbacks.push(callback);
  }

  function whenReady() {
    if (extendScriptReady) {
      return Promise.resolve(hostSession);
    }
    return new Promise((resolve) => {
      onExtendScriptReady(() => resolve(hostSession));
    });
  }

  function revealInitialPanel() {
    if (document.body && document.body.classList) {
      document.body.classList.remove("panel-launch-pending");
    }
  }

  function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = String(value == null ? "" : value);
    return element.innerHTML;
  }

  function renderHostState(message, detail) {
    const target = document.getElementById("file-list");
    if (!target) {
      return;
    }
    const details = detail
      ? "<br><small>" + escapeHtml(detail) + "</small>"
      : "";
    target.innerHTML = "<div>" + escapeHtml(message) + details + "</div>";
  }

  function dispatchHostState(detail) {
    if (typeof window.dispatchEvent !== "function" ||
        typeof window.CustomEvent !== "function") {
      return;
    }
    window.dispatchEvent(new CustomEvent("momentum:host-state", {
      detail: {
        state: hostState,
        session: hostSession,
        error: detail || null,
      },
    }));
  }

  function setHostState(nextState, detail) {
    hostState = nextState;
    if (nextState !== HOST_STATE.READY) {
      extendScriptReady = false;
    }
    dispatchHostState(detail);
  }

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
      getCsInterface().registerKeyEventsInterest(JSON.stringify(shortcutInterest));
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

  function deliverEffectCodeSession(sessionToken) {
    if (
      !window.effectCodeManager ||
      typeof window.effectCodeManager.open !== "function"
    ) {
      return Promise.reject(new Error("The shared Effect Code manager is unavailable."));
    }
    return Promise.resolve(window.effectCodeManager.open(sessionToken))
      .then((opened) => {
        if (!opened) {
          return false;
        }
        return callExtendScript(
          "momentumAcknowledgeCodeEditorOpenIntent",
          [encodeURIComponent(sessionToken)],
        ).then(() => {
          setTimeout(drainPendingCodeEditorOpen, 0);
          return true;
        });
      });
  }

  function queueEffectCodeSession(sessionToken) {
    const token = String(sessionToken || "");
    if (!token) {
      return Promise.resolve(false);
    }
    if (queuedCodeEditorOpenTokens[token]) {
      return queuedCodeEditorOpenTokens[token];
    }
    const delivery = new Promise((resolve) => {
      onExtendScriptReady(() => {
        const run = codeEditorOpenQueue
          .then(() => deliverEffectCodeSession(token))
          .catch((error) => {
            console.warn("Failed to deliver Effect Code session:", error);
            return false;
          });
        codeEditorOpenQueue = run.then(() => undefined);
        run.then((opened) => {
          delete queuedCodeEditorOpenTokens[token];
          resolve(opened);
        });
      });
    });
    queuedCodeEditorOpenTokens[token] = delivery;
    return delivery;
  }

  function drainPendingCodeEditorOpen() {
    if (codeEditorOpenDrainPromise) {
      return codeEditorOpenDrainPromise;
    }
    const drainPromise = callExtendScript(
      "momentumPeekCodeEditorOpenIntent",
      [],
    )
      .then((sessionToken) => {
        return sessionToken
          ? queueEffectCodeSession(sessionToken)
          : false;
      })
      .catch((error) => {
        console.warn("Failed to read Effect Code open intent:", error);
        return false;
      })
      .finally(() => {
        if (codeEditorOpenDrainPromise === drainPromise) {
          codeEditorOpenDrainPromise = null;
        }
      });
    codeEditorOpenDrainPromise = drainPromise;
    return drainPromise;
  }

  function claimOpenEffectCodePanel(sessionToken) {
    const token = String(sessionToken || "");
    if (!token) {
      return;
    }
    onExtendScriptReady(() => {
      callExtendScript(
        "momentumClaimCodeEditorPanel",
        [encodeURIComponent(token)],
      ).catch((error) => {
        console.warn("Failed to claim the open Effect Code panel:", error);
      });
    });
  }

  function openEffectCodeSession(event) {
    const sessionToken = String(event && event.data || "");
    claimOpenEffectCodePanel(sessionToken);
    queueEffectCodeSession(sessionToken);
  }

  function ensurePersistentStorage() {
    if (window.persistentStorage) {
      return;
    }

    window.persistentStorage = {};
    window.persistentStorage.get = function (key, defaultValue) {
      return this[key] !== undefined ? this[key] : defaultValue;
    };
    window.persistentStorage.set = function (key, value) {
      this[key] = value;
    };
  }

  function parseHostHandshake(result) {
    const value = typeof result === "string"
      ? result
      : String(result == null ? "" : result);
    if (!value ||
        (window.momentumErrors &&
          window.momentumErrors.isHostUnavailableResult(value))) {
      throw window.momentumErrors
        ? window.momentumErrors.create(
            "HOST_ENGINE_UNAVAILABLE",
            value || "After Effects returned no bootstrap response.",
            { stage: "bootstrap", retryable: true },
          )
        : new Error(value || "After Effects returned no bootstrap response.");
    }
    if (value.indexOf(ERROR_PREFIX) === 0) {
      throw window.momentumErrors
        ? window.momentumErrors.create(
            "HOST_BOOTSTRAP_FAILED",
            value.substring(ERROR_PREFIX.length).trim(),
            { stage: "bootstrap", retryable: true },
          )
        : new Error(value);
    }

    let response = null;
    try {
      response = JSON.parse(value);
    } catch (_parseError) {
      throw window.momentumErrors
        ? window.momentumErrors.create(
            "HOST_HANDSHAKE_INVALID",
            "After Effects returned an invalid startup handshake.",
            { stage: "handshake", retryable: true, details: value },
          )
        : new Error("After Effects returned an invalid startup handshake.");
    }
    if (!response || response.ok !== true) {
      throw window.momentumErrors
        ? window.momentumErrors.create(
            response && response.code
              ? response.code
              : "HOST_HANDSHAKE_FAILED",
            response && response.message
              ? response.message
              : "After Effects startup handshake failed.",
            {
              stage: "handshake",
              retryable: !response || response.retryable !== false,
              path: response && response.path,
              details: response,
            },
          )
        : new Error("After Effects startup handshake failed.");
    }
    if (String(response.protocolVersion || "") !== HOST_PROTOCOL_VERSION) {
      throw window.momentumErrors
        ? window.momentumErrors.create(
            "HOST_PROTOCOL_MISMATCH",
            "Momentum CEP and host scripts use different protocol versions.",
            { stage: "handshake", retryable: false, details: response },
          )
        : new Error("Momentum host protocol mismatch.");
    }
    return response;
  }

  function buildHostBootstrapScript(extensionPath) {
    const handshakeRequest = encodeURIComponent(JSON.stringify({
      protocolVersion: HOST_PROTOCOL_VERSION,
      clientSessionId,
    }));
    const extensionExpr = toExtendScriptStringExpr(extensionPath);
    const requestExpr = toExtendScriptStringExpr(handshakeRequest);
    return (
      // Keep evalFile at the ExtendScript engine's top level. Loading it from
      // an IIFE makes its declarations disappear after the bootstrap call.
      "var __momentumHostBootstrapResult = '';" +
      "try {" +
        "var __momentumHostExtensionPath = " + extensionExpr + ";" +
        "var __momentumHostMarker = $.global.__momentumHostBootstrapMarker || null;" +
        "var __momentumHostReusable = __momentumHostMarker && " +
          "String(__momentumHostMarker.protocolVersion || '') === '" + HOST_PROTOCOL_VERSION + "' && " +
          "String(__momentumHostMarker.extensionPath || '') === __momentumHostExtensionPath && " +
          "typeof momentumHostHandshake === 'function';" +
        "if (!__momentumHostReusable) {" +
          "$.global.__momentumExtensionPath = __momentumHostExtensionPath;" +
          "$.evalFile(__momentumHostExtensionPath + '/jsx/main.jsx');" +
          "if (typeof momentumHostHandshake !== 'function') {" +
            "throw new Error('Momentum host handshake module is unavailable.');" +
          "}" +
          "$.global.__momentumHostBootstrapMarker = {" +
            "protocolVersion: '" + HOST_PROTOCOL_VERSION + "'," +
            "extensionPath: __momentumHostExtensionPath" +
          "};" +
        "}" +
        "__momentumHostBootstrapResult = momentumHostHandshake(" + requestExpr + ");" +
      "} catch (__momentumHostBootstrapError) {" +
        "__momentumHostBootstrapResult = 'ERROR: ' + " +
          "(__momentumHostBootstrapError && __momentumHostBootstrapError.toString " +
            "? __momentumHostBootstrapError.toString() " +
            ": String(__momentumHostBootstrapError));" +
      "}" +
      "__momentumHostBootstrapResult;"
    );
  }

  function clearHostBootstrapTimer() {
    if (hostBootstrapTimer) {
      window.clearTimeout(hostBootstrapTimer);
      hostBootstrapTimer = 0;
    }
  }

  function clearHostBootstrapWatchdog() {
    if (hostBootstrapWatchdogTimer) {
      window.clearTimeout(hostBootstrapWatchdogTimer);
      hostBootstrapWatchdogTimer = 0;
    }
  }

  function nextHostRetryDelay() {
    const exponent = Math.min(hostBootstrapFailureCount, 5);
    return Math.min(
      HOST_RETRY_MAX_MS,
      HOST_RETRY_INITIAL_MS * Math.pow(2, exponent),
    );
  }

  function scheduleHostBootstrap(immediate) {
    if (!initialized || extendScriptReady || hostBootstrapInFlight ||
        hostBootstrapTimer) {
      return;
    }
    if (document.hidden && !immediate) {
      return;
    }
    const delay = immediate ? 0 : nextHostRetryDelay();
    hostBootstrapTimer = window.setTimeout(() => {
      hostBootstrapTimer = 0;
      bootstrapExtendScript();
    }, delay);
  }

  function handleHostBootstrapFailure(error) {
    hostSession = null;
    hostBootstrapFailureCount += 1;
    const normalized = window.momentumErrors
      ? window.momentumErrors.normalize(error, {
          code: "HOST_ENGINE_UNAVAILABLE",
          message: "After Effects is not ready yet.",
          retryable: true,
        })
      : { message: error && error.message ? error.message : String(error) };
    window.__momentumExtendScriptBootstrapError = normalized;
    setHostState(
      normalized.retryable === false
        ? HOST_STATE.DEGRADED
        : HOST_STATE.WAITING,
      normalized,
    );
    if (normalized.retryable === false) {
      renderHostState(
        "Momentum host scripts are incompatible",
        normalized.message +
          " Reload the extension after installing matching files.",
      );
      revealInitialPanel();
      return;
    }
    scheduleHostBootstrap(false);
  }

  function bootstrapExtendScript() {
    if (hostBootstrapInFlight || extendScriptReady) {
      return;
    }
    clearHostBootstrapTimer();
    hostBootstrapInFlight = true;
    const attemptId = ++hostBootstrapAttemptId;
    setHostState(HOST_STATE.BOOTSTRAPPING);
    clearHostBootstrapWatchdog();
    hostBootstrapWatchdogTimer = window.setTimeout(() => {
      if (!hostBootstrapInFlight || attemptId !== hostBootstrapAttemptId) {
        return;
      }
      hostBootstrapWatchdogTimer = 0;
      hostBootstrapInFlight = false;
      handleHostBootstrapFailure(window.momentumErrors
        ? window.momentumErrors.create(
            "HOST_BOOTSTRAP_TIMEOUT",
            "After Effects did not answer the startup handshake.",
            { stage: "bootstrap", retryable: true },
          )
        : new Error("After Effects did not answer the startup handshake."));
    }, HOST_BOOTSTRAP_TIMEOUT_MS);

    try {
      const csInterface = getCsInterface();
      const extensionPath = csInterface.getSystemPath(SystemPath.EXTENSION);
      window.extensionPath = extensionPath;
      csInterface.evalScript(buildHostBootstrapScript(extensionPath), (result) => {
        if (!hostBootstrapInFlight || attemptId !== hostBootstrapAttemptId) {
          return;
        }
        clearHostBootstrapWatchdog();
        hostBootstrapInFlight = false;
        try {
          hostSession = parseHostHandshake(result);
          hostBootstrapFailureCount = 0;
          window.__momentumExtendScriptBootstrapError = null;
          setHostState(HOST_STATE.READY);
          flushExtendScriptReady();
        } catch (error) {
          handleHostBootstrapFailure(error);
        }
      });
    } catch (error) {
      clearHostBootstrapWatchdog();
      hostBootstrapInFlight = false;
      handleHostBootstrapFailure(error);
    }
  }

  function reportHostUnavailable(reason) {
    if (!initialized) {
      return;
    }
    const error = window.momentumErrors
      ? window.momentumErrors.create(
          "HOST_ENGINE_UNAVAILABLE",
          String(reason || "After Effects scripting is temporarily unavailable."),
          { stage: "evalScript", retryable: true },
        )
      : new Error(String(reason || "After Effects scripting is temporarily unavailable."));
    handleHostBootstrapFailure(error);
  }

  function installHostWakeHooks() {
    if (hostWakeHooksInstalled) {
      return;
    }
    hostWakeHooksInstalled = true;
    const wake = () => {
      if (!extendScriptReady) {
        clearHostBootstrapTimer();
        scheduleHostBootstrap(true);
      }
    };
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        wake();
      }
    });
    if (typeof window.addEventListener === "function") {
      window.addEventListener("focus", wake);
    }
  }

  function installDomReadyHook() {
    function onDomReady() {
      onExtendScriptReady(() => {
        if (window.fileManager &&
            typeof window.fileManager.loadFileList === "function") {
          window.fileManager.loadFileList();
        }
      });
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", onDomReady);
    } else {
      onDomReady();
    }
  }

  function toExtendScriptCall(functionName, args) {
    const safeName = String(functionName || "").replace(/[^\w$]/g, "");
    const serializedArgs = Array.isArray(args)
      ? args.map((arg) => JSON.stringify(String(arg == null ? "" : arg))).join(", ")
      : "";
    return `${safeName}(${serializedArgs})`;
  }

  function evaluateHostScript(script) {
    return whenReady().then(() => new Promise((resolve, reject) => {
      const csInterface = getCsInterface();
      if (!csInterface || typeof csInterface.evalScript !== "function") {
        reject(window.momentumErrors
          ? window.momentumErrors.create(
              "CEP_BRIDGE_UNAVAILABLE",
              "CEP bridge is unavailable.",
              { stage: "evalScript", retryable: true },
            )
          : new Error("CEP bridge is unavailable."));
        return;
      }

      csInterface.evalScript(script, (result) => {
        const value = typeof result === "string" ? result : String(result == null ? "" : result);
        if (window.momentumErrors &&
            window.momentumErrors.isHostUnavailableResult(value)) {
          reportHostUnavailable(value);
          reject(window.momentumErrors.create(
            "HOST_ENGINE_UNAVAILABLE",
            value || "After Effects scripting is temporarily unavailable.",
            { stage: "evalScript", retryable: true },
          ));
          return;
        }
        resolve(value);
      });
    }));
  }

  function callExtendScript(functionName, args) {
    return evaluateHostScript(toExtendScriptCall(functionName, args))
      .then((value) => {
        if (/^Error:/i.test(value)) {
          throw window.momentumErrors
            ? window.momentumErrors.create(
                "EXTENDSCRIPT_OPERATION_FAILED",
                value.substring(ERROR_PREFIX.length).trim(),
                { stage: functionName, retryable: false },
              )
            : new Error(value);
        }
        return value;
      });
  }

  function toExtendScriptStringExpr(value) {
    const source = String(value == null ? "" : value);
    const encoded = encodeURIComponent(source)
      .replace(/'/g, "%27")
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29");
    return `decodeURIComponent('${encoded}')`;
  }

  function evalExtendScript(script) {
    return evaluateHostScript(script);
  }

  function debugMomentumLibraryLoad(extensionRoot) {
    const rootExpr = toExtendScriptStringExpr(extensionRoot);
    return evaluateHostScript(
        "(function() {" +
          "var root = " +
          rootExpr +
          ";" +
          "var report = [];" +
          "function readSummary(relativePath) {" +
          "var file = new File(root + '/' + relativePath);" +
          "if (!file.exists) { report.push('summary ' + relativePath + ' | missing'); return; }" +
          "var text = '';" +
          "try { if (file.open('r')) { text = String(file.read() || ''); file.close(); } } catch (e) { try { file.close(); } catch (_e) {} }" +
          "var lines = text ? text.split('\\n') : [];" +
          "report.push('summary ' + relativePath + ' | fsName=' + file.fsName + ' | modified=' + file.modified + ' | lines=' + lines.length + ' | line133=' + (lines[132] || '') + ' | line134=' + (lines[133] || ''));" +
          "}" +
          "readSummary('bundle/includes/core.js');" +
          "readSummary('bundle/momentum.js');" +
          "return report.join('\\n');" +
        "})();",
      ).then((result) => result || "");
  }

  function loadMomentumLibrary() {
    const extensionRoot = getCsInterface().getSystemPath(SystemPath.EXTENSION);
    const bundlePath = extensionRoot + "/bundle/momentum.js";
    const bundlePathExpr = toExtendScriptStringExpr(bundlePath);
    const loadScript =
      "(function() {" +
      "var file = new File(" +
      bundlePathExpr +
      ");" +
      "if (!file.exists) return 'ERROR: Cannot find momentum.js file at ' + file.fsName;" +
      "try {" +
      "$.evalFile(file.fsName);" +
      "return 'SUCCESS';" +
      "} catch(e) {" +
      "return 'ERROR: ' + e.message + ' | line=' + e.line + ' | file=' + e.fileName;" +
      "}" +
      "})();";

    return evaluateHostScript(loadScript).then((result) => {
      if (!result.startsWith(ERROR_PREFIX)) {
        return;
      }
      const baseError = result.substring(ERROR_PREFIX.length).trim();
      return debugMomentumLibraryLoad(extensionRoot)
        .catch(() => "")
        .then((debugResult) => {
          const message = debugResult
            ? `${baseError}\n[Momentum debug] ${debugResult}`
            : baseError;
          throw window.momentumErrors
            ? window.momentumErrors.create(
                "MOMENTUM_LIBRARY_LOAD_FAILED",
                message,
                { stage: "library-load", path: bundlePath },
              )
            : new Error(message);
        });
    });
  }

  async function sendPayload(payload) {
    const payloadId = `momentum_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const payloadJson = JSON.stringify(payload);
    const chunkSize = 1200;

    let result = await evalExtendScript(
      `startMomentumPayloadBuffer(${toExtendScriptStringExpr(payloadId)})`,
    );
    if (result && result.startsWith && result.startsWith(ERROR_PREFIX)) {
      throw new Error(result.substring(ERROR_PREFIX.length + 1));
    }

    for (let i = 0; i < payloadJson.length; i += chunkSize) {
      const chunk = payloadJson.slice(i, i + chunkSize);
      result = await evalExtendScript(
        `appendMomentumPayloadChunk(${toExtendScriptStringExpr(payloadId)}, ${toExtendScriptStringExpr(chunk)})`,
      );
      if (result && result.startsWith && result.startsWith(ERROR_PREFIX)) {
        throw new Error(result.substring(ERROR_PREFIX.length + 1));
      }
    }

    result = await evalExtendScript(
      `executeMomentumPayloadBuffer(${toExtendScriptStringExpr(payloadId)})`,
    );

    return result;
  }

  function init() {
    if (initialized) {
      return;
    }
    initialized = true;

    ensurePersistentStorage();
    getCsInterface();
    registerMomentumShortcutInterest();
    getCsInterface().addEventListener(CEP_KEYBOARD_EVENT, forwardCepKeyboardEvent);
    getCsInterface().addEventListener(CODE_EDITOR_OPEN_EVENT, openEffectCodeSession);
    onExtendScriptReady(() => {
      drainPendingCodeEditorOpen().finally(revealInitialPanel);
    });
    installHostWakeHooks();
    installDomReadyHook();
    scheduleHostBootstrap(true);
  }

  return {
    callExtendScript,
    evaluateHostScript,
    getHostSession: function () { return hostSession; },
    getHostState: function () { return hostState; },
    init,
    loadMomentumLibrary,
    reportHostUnavailable,
    sendPayload,
    whenReady,
  };
})();
