window.momentumPluginBridge = (function () {
  const ERROR_PREFIX = "ERROR:";
  const CEP_KEYBOARD_EVENT = "com.adobe.csxs.events.KeyboardEvent";

  let csInterfaceInstance = null;
  let extendScriptReady = false;
  let extendScriptBootstrapCompleted = false;
  let extendScriptReadyCallbacks = [];
  let initialized = false;
  let domReadyHookInstalled = false;

  function getCsInterface() {
    if (!csInterfaceInstance) {
      csInterfaceInstance = window.csInterface instanceof CSInterface
        ? window.csInterface
        : new CSInterface();
      window.csInterface = csInterfaceInstance;
    }
    return csInterfaceInstance;
  }

  function escapeForEvalScript(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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

  function renderExtendScriptFailure(message) {
    const target = document.getElementById("file-list");
    if (!target) {
      return;
    }
    const details = message ? "<br><small>" + String(message) + "</small>" : "";
    target.innerHTML =
      "<div>ExtendScript environment initialization failed" + details + "</div>";
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

  function bootstrapExtendScript() {
    const csInterface = getCsInterface();
    const extensionPath = csInterface.getSystemPath(SystemPath.EXTENSION);
    window.extensionPath = extensionPath;

    csInterface.evalScript(
      `var __momentumBootstrapResult = "ok";
       try {
         $.global.__momentumExtensionPath = "${escapeForEvalScript(extensionPath)}";
         $.evalFile("${escapeForEvalScript(extensionPath)}/jsx/main.jsx");
         if (typeof getFileList !== "function") {
           __momentumBootstrapResult = "missing:getFileList";
         }
       } catch (error) {
         __momentumBootstrapResult = "error:" + error.toString();
       }
       __momentumBootstrapResult;`,
      (result) => {
        extendScriptBootstrapCompleted = true;
        if (result === "ok") {
          flushExtendScriptReady();
          return;
        }
        window.__momentumExtendScriptBootstrapError = result || "unknown";
        console.error("ExtendScript bootstrap failed:", result);
      },
    );
  }

  function installDomReadyHook() {
    if (domReadyHookInstalled) {
      return;
    }
    domReadyHookInstalled = true;

    function onDomReady() {
      onExtendScriptReady(() => {
        getCsInterface().evalScript("typeof getFileList === 'function'", (result) => {
          if (result === "true") {
            window.fileManager.loadFileList();
          } else {
            renderExtendScriptFailure(window.__momentumExtendScriptBootstrapError);
          }
        });
      });

      let bootstrapPollCount = 0;
      const bootstrapPollMax = 20;

      function pollExtendScriptReady() {
        if (extendScriptReady) {
          return;
        }

        getCsInterface().evalScript("typeof getFileList === 'function'", (result) => {
          if (result === "true") {
            flushExtendScriptReady();
            return;
          }

          bootstrapPollCount += 1;
          if (extendScriptReady) {
            return;
          }

          if (bootstrapPollCount >= bootstrapPollMax) {
            const timeoutReason = extendScriptBootstrapCompleted
              ? window.__momentumExtendScriptBootstrapError
              : "timeout:bootstrap";
            renderExtendScriptFailure(timeoutReason);
            return;
          }

          setTimeout(pollExtendScriptReady, 500);
        });
      }

      pollExtendScriptReady();
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

  function callExtendScript(functionName, args) {
    return new Promise((resolve, reject) => {
      const csInterface = getCsInterface();
      if (!csInterface || typeof csInterface.evalScript !== "function") {
        reject(new Error("CEP bridge is unavailable."));
        return;
      }

      csInterface.evalScript(toExtendScriptCall(functionName, args), (result) => {
        const value = typeof result === "string" ? result : String(result == null ? "" : result);
        if (/^EvalScript error\./i.test(value) || /^Error:/i.test(value)) {
          reject(new Error(value));
          return;
        }
        resolve(value);
      });
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
    return new Promise((resolve) => {
      getCsInterface().evalScript(script, (result) => {
        resolve(result);
      });
    });
  }

  function debugMomentumLibraryLoad(extensionRoot) {
    return new Promise((resolve) => {
      const rootExpr = toExtendScriptStringExpr(extensionRoot);
      getCsInterface().evalScript(
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
        function (result) {
          resolve(result || "");
        },
      );
    });
  }

  function loadMomentumLibrary() {
    return new Promise((resolve, reject) => {
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

      getCsInterface().evalScript(
        loadScript,
        (result) => {
          if (result.startsWith(ERROR_PREFIX)) {
            debugMomentumLibraryLoad(extensionRoot)
              .then((debugResult) => {
                const baseError = result.substring(ERROR_PREFIX.length + 1);
                reject(
                  debugResult
                    ? `${baseError}\n[Momentum debug] ${debugResult}`
                    : baseError,
                );
              })
              .catch(() => {
                reject(result.substring(ERROR_PREFIX.length + 1));
              });
          } else {
            resolve();
          }
        },
      );
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
    bootstrapExtendScript();
    installDomReadyHook();
  }

  return {
    init,
    onExtendScriptReady,
    renderExtendScriptFailure,
    callExtendScript,
    toExtendScriptStringExpr,
    evalExtendScript,
    loadMomentumLibrary,
    sendPayload,
  };
})();
