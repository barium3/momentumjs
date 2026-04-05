window.momentumPluginBitmap = (function () {
  const RUNTIME_TARGET = "momentum-plugin-js-runtime";
  const DEFAULT_COMP = {
    width: 100,
    height: 100,
    frameRate: 30,
    duration: 10,
  };

  function getCompConfig(compiled, fileName) {
    const config = compiled && compiled.config ? compiled.config : {};
    const safeName = fileName ? String(fileName).replace(/\.[^.]+$/, "") : "Momentum";

    return {
      width: Math.max(1, Math.floor(Number(config.width) || DEFAULT_COMP.width)),
      height: Math.max(1, Math.floor(Number(config.height) || DEFAULT_COMP.height)),
      frameRate: Math.max(1, Number(config.frameRate) || DEFAULT_COMP.frameRate),
      duration: Math.max(0.1, Number(config.duration) || DEFAULT_COMP.duration),
      name: safeName,
    };
  }

  function parseApplyMomentumResult(rawValue) {
    const text = typeof rawValue === "string" ? rawValue : String(rawValue == null ? "" : rawValue);
    if (!text || text.charAt(0) !== "{") {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (_ignore) {
      return null;
    }
  }

  function expectExtendScriptOk(rawValue, stepName) {
    const parsed = parseApplyMomentumResult(rawValue);
    if (!parsed || parsed.ok !== true) {
      throw new Error(`Unexpected ${stepName} result: ${String(rawValue == null ? "" : rawValue)}`);
    }
    return parsed;
  }

  function reportApplyMomentumWarnings(result) {
    if (!result || typeof result !== "object") {
      return;
    }
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    for (let i = 0; i < warnings.length; i += 1) {
      if (warnings[i]) {
        console.warn(String(warnings[i]));
      }
    }
  }

  function applyRuntimeBundle(bundle, runtimeSource) {
    const encodedSource = encodeURIComponent(runtimeSource);
    const bundleText = JSON.stringify(bundle, null, 2);
    const encodedBundleText = encodeURIComponent(bundleText);
    const payload = {
      ...bundle,
      runtimeSource: runtimeSource,
    };
    const encodedPayload = encodeURIComponent(JSON.stringify(payload));

    return window.momentumPluginBridge
      .callExtendScript("writeMomentumSketch", [encodedSource])
      .then((writeSketchResultText) => {
        expectExtendScriptOk(writeSketchResultText, "writeMomentumSketch");
        return window.momentumPluginBridge.callExtendScript("writeMomentumBundle", [encodedBundleText]);
      })
      .then((writeBundleResultText) => {
        expectExtendScriptOk(writeBundleResultText, "writeMomentumBundle");
        return window.momentumPluginBridge.callExtendScript("applyMomentum", [encodedPayload]);
      });
  }

  return {
    DEFAULT_COMP,
    RUNTIME_TARGET,
    applyRuntimeBundle,
    expectExtendScriptOk,
    getCompConfig,
    parseApplyMomentumResult,
    reportApplyMomentumWarnings,
  };
})();
