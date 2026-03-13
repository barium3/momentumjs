// Frontend execution pipeline:
// preprocess code, run analyzer passes, then invoke AE with parsed arguments.
window.codeExecutor = (function () {
  const ERROR_PREFIX = "ERROR:";

  let imageAnalyzer = null;
  let p5Analyzer = null;
  let fontAnalyzer = null;

  function getImageAnalyzer() {
    if (!imageAnalyzer && typeof window.ImageAnalyzer !== "undefined") {
      imageAnalyzer = new window.ImageAnalyzer();
    }
    return imageAnalyzer;
  }

  async function collectAndLoadImages(code, compiled) {
    const analyzer = getImageAnalyzer();
    if (!analyzer) {
      return {};
    }

    const imagePaths =
      compiled &&
      compiled.assets &&
      Array.isArray(compiled.assets.images)
        ? new Set(compiled.assets.images)
        : analyzer.collectImagesFromCode(code);
    if (imagePaths.size === 0) {
      return {};
    }

    const loadedImages = await analyzer.loadImagesFromFrontend(imagePaths);

    if (!window.__momentumImageMetadata) {
      window.__momentumImageMetadata = {};
    }
    for (const [path, info] of Object.entries(loadedImages)) {
      if (info.success) {
        window.__momentumImageMetadata[path] = {
          width: info.width,
          height: info.height,
          path: info.path,
        };
      }
    }
    return loadedImages;
  }

  async function collectFontMetrics(code, compiled) {
    const analyzer = getFontAnalyzer();
    if (!analyzer) {
      return {};
    }

    if (
      compiled &&
      compiled.assets &&
      Array.isArray(compiled.assets.fonts)
    ) {
      return await analyzer.collectFontMetricsFromNames(compiled.assets.fonts);
    }

    return await analyzer.collectFontMetricsFromCode(code);
  }

  function injectFontFamilyToLayers(renderLayers, fontMetricsMap, code) {
    if (!renderLayers || !Array.isArray(renderLayers)) {
      return renderLayers;
    }

    let defaultFont = null;
    const fontMatch = code.match(/textFont\s*\(\s*(["'])([^"']+)\1/);
    if (fontMatch) {
      defaultFont = fontMatch[2];
    }

    const availableFonts = Object.keys(fontMetricsMap);
    const fallbackFont = availableFonts.length > 0 ? availableFonts[0] : null;

    return renderLayers.map((layer) => {
      if (layer && layer.type === "text") {
        const fontName = defaultFont || fallbackFont;
        return {
          ...layer,
          fontFamily: fontName || "Arial",
        };
      }

      return layer;
    });
  }

  function loadMomentumLibrary() {
    return new Promise((resolve, reject) => {
      const extensionRoot = csInterface.getSystemPath(SystemPath.EXTENSION);
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

      csInterface.evalScript(
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

  function debugMomentumLibraryLoad(extensionRoot) {
    return new Promise((resolve) => {
      const rootExpr = toExtendScriptStringExpr(extensionRoot);
      csInterface.evalScript(
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

  function getFontAnalyzer() {
    if (!fontAnalyzer && typeof window.FontAnalyzer !== "undefined") {
      fontAnalyzer = new window.FontAnalyzer();
      fontAnalyzer.init();
    }
    return fontAnalyzer;
  }

  async function translateFontNames(code) {
    const analyzer = getFontAnalyzer();
    if (!analyzer) {
      return code;
    }

    const fontCallRegex =
      /textFont\s*\(\s*(["'])([^"']+)\1\s*(?:,\s*[^)]+)?\)/g;

    let translatedCode = code;
    let match;

    const fontsToTranslate = new Set();
    while ((match = fontCallRegex.exec(code)) !== null) {
      fontsToTranslate.add(match[2]);
    }

    const fontTranslations = {};
    for (const fontName of fontsToTranslate) {
      const psName = await analyzer.getPostScriptName(fontName);
      if (psName) {
        fontTranslations[fontName] = psName;
      }
    }

    if (Object.keys(fontTranslations).length > 0) {
      for (const [original, translated] of Object.entries(fontTranslations)) {
        const escapedOriginal = escapeRegex(original);
        const replaceRegex = new RegExp(
          `(textFont\\s*\\(\\s*["'])${escapedOriginal}(["']\\s*(?:,\\s*[^)]+)?\\))`,
          "g",
        );
        translatedCode = translatedCode.replace(
          replaceRegex,
          `$1${translated}$2`,
        );
      }
    }

    return translatedCode;
  }

  function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function toExtendScriptStringExpr(value) {
    const source = String(value == null ? "" : value);
    const encoded = encodeURIComponent(source)
      .replace(/'/g, "%27")
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29");
    return `decodeURIComponent('${encoded}')`;
  }

  function getP5Analyzer() {
    if (!p5Analyzer && typeof window.P5Analyzer !== "undefined") {
      p5Analyzer = new window.P5Analyzer({
        timeout: 2000,
        maxLoopCount: 1000,
      });
    }
    return p5Analyzer;
  }

  // Runtime analysis runs in two modes: full-program and setup/draw separation.
  async function fullAnalyzeAsync(code, staticAnalysis, compiledDependencies) {
    const analyzer = getP5Analyzer();
    if (!analyzer) {
      return null;
    }

    try {
      return await analyzer.fullAnalyze(
        code,
        staticAnalysis,
        compiledDependencies,
      );
    } catch (error) {
      return null;
    }
  }

  async function analyzeSeparatedAsync(
    setupCode,
    drawCode,
    globalCode,
    setupFullCode,
    drawFullCode,
    preloadFullCode,
    staticAnalysis,
  ) {
    const analyzer = getP5Analyzer();
    if (!analyzer) {
      return null;
    }

    try {
      return await analyzer.analyzeSetupAndDraw(
        setupCode,
        drawCode,
        globalCode,
        setupFullCode,
        drawFullCode,
        preloadFullCode,
        staticAnalysis,
      );
    } catch (error) {
      return null;
    }
  }

  function extractFileName(code, defaultName) {
    const fileNameRegex = /\/\/\s*@filename[:\s]*([^\n]+)/;
    const match = code.match(fileNameRegex);
    if (match && match[1]) {
      return match[1].trim();
    }
    return defaultName || "Untitled";
  }

  function buildExecutionPlan(compiled) {
    const output = compiled && compiled.output ? compiled.output : {};
    const ae = compiled && compiled.ae ? compiled.ae : {};
    const config = compiled && compiled.config ? compiled.config : {};
    const globals = compiled && compiled.globals ? compiled.globals : {};

    return {
      drawCode: output.drawCode || "",
      setupCode: output.setupCode || "",
      drawFullCode: output.drawFullCode || "",
      setupFullCode: output.setupFullCode || "",
      preloadFullCode: output.preloadFullCode || "",
      globalCode: output.globalCode || "",
      aeDrawCode: ae.drawCode || "",
      aeSetupCode: ae.setupCode || "",
      aeDrawFullCode: ae.drawFullCode || "",
      aeSetupFullCode: ae.setupFullCode || "",
      aePreloadFullCode: ae.preloadFullCode || "",
      aeGlobalCode: ae.globalCode || "",
      globalVars: {
        width: config.width || null,
        height: config.height || null,
        frameRate: config.frameRate || null,
      },
      globalVarNames: Array.isArray(globals.mutableNames)
        ? globals.mutableNames
        : [],
      analysisCode: [
        output.globalCode || "",
        output.preloadFullCode || "",
        output.setupFullCode || "",
        output.drawFullCode || "",
      ].join("\n"),
    };
  }

  function getCompiler() {
    if (typeof window.sketchCompiler === "undefined" || !window.sketchCompiler) {
      throw new Error("Compiler is not available");
    }
    return window.sketchCompiler;
  }

  function formatCompilerDiagnostics(diagnostics) {
    if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
      return "Compilation failed";
    }

    const primary = diagnostics[0];
    const line =
      primary &&
      primary.loc &&
      typeof primary.loc.line === "number"
        ? `:${primary.loc.line}:${(primary.loc.column || 0) + 1}`
        : "";

    return `${primary.message || "Compilation failed"}${line}`;
  }

  function evalExtendScript(script) {
    return new Promise((resolve) => {
      csInterface.evalScript(script, (result) => {
        resolve(result);
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

  function makePayload(
    plan,
    fullResult,
    separatedResult,
    fontMetricsMap,
    loadedImagesMap,
    compName,
  ) {
    const drawBackgroundCount =
      separatedResult &&
      typeof separatedResult.drawBackgroundCount === "number"
        ? separatedResult.drawBackgroundCount
        : 0;

    const drawNeedsEcho =
      separatedResult && separatedResult.drawNeedsEcho === true;

    const hasSetup = !!(plan.setupCode && plan.setupCode.length > 0);
    const hasDraw = !!(plan.drawCode && plan.drawCode.length > 0);
    const hasSetupOrDraw = hasSetup || hasDraw;

    return {
      args: [
        plan.aeDrawCode || "",
        plan.aeSetupCode || "",
        plan.aeGlobalCode || "",
        compName,
        plan.globalVars.width || 100,
        plan.globalVars.height || 100,
        plan.globalVars.frameRate || 30,
        fullResult && fullResult.dependencies ? fullResult.dependencies : null,
        separatedResult &&
        separatedResult.setupRenderLayers &&
        separatedResult.setupRenderLayers.length > 0
          ? separatedResult.setupRenderLayers
          : null,
        separatedResult &&
        separatedResult.drawRenderLayers &&
        separatedResult.drawRenderLayers.length > 0
          ? separatedResult.drawRenderLayers
          : null,
        hasSetupOrDraw,
        drawBackgroundCount,
        drawNeedsEcho,
        fontMetricsMap,
        loadedImagesMap,
        plan.aeSetupFullCode || "",
        plan.aeDrawFullCode || "",
        plan.aePreloadFullCode || "",
        plan.globalVarNames || [],
      ],
    };
  }

  function executeUserCode(code, fileName) {
    return new Promise(async (resolve, reject) => {
      try {
        const compName = extractFileName(code, fileName || "New Composition");
        if (window.codePreprocessor && window.codePreprocessor.stripComments) {
          code = window.codePreprocessor.stripComments(code);
        }

        code = await translateFontNames(code);
        const compiled = getCompiler().compile(code);
        if (!compiled.ok) {
          throw new Error(formatCompilerDiagnostics(compiled.diagnostics));
        }
        const plan = buildExecutionPlan(compiled);

        // Images must be loaded before runtime analysis so preload() can resolve them.
        const loadedImagesMap = await collectAndLoadImages(
          compiled.code || code,
          compiled,
        );

        let fullResult = null;
        try {
          fullResult = await fullAnalyzeAsync(
            plan.analysisCode,
            compiled.analysis || null,
            compiled.dependencies || null,
          );
        } catch (e) {
          fullResult = null;
        }

        let separatedResult = null;
        try {
          separatedResult = await analyzeSeparatedAsync(
            plan.setupCode || "",
            plan.drawCode || "",
            plan.globalCode || "",
            plan.setupFullCode || "",
            plan.drawFullCode || "",
            plan.preloadFullCode || "",
            compiled.analysis || null,
          );
        } catch (e) {
          separatedResult = null;
        }

        const fontMetricsMap = await collectFontMetrics(
          compiled.code || code,
          compiled,
        );

        if (separatedResult) {
          if (separatedResult.setupRenderLayers) {
            separatedResult.setupRenderLayers = injectFontFamilyToLayers(
              separatedResult.setupRenderLayers,
              fontMetricsMap,
              plan.setupCode || "",
            );
          }
          if (separatedResult.drawRenderLayers) {
            separatedResult.drawRenderLayers = injectFontFamilyToLayers(
              separatedResult.drawRenderLayers,
              fontMetricsMap,
              plan.drawCode || "",
            );
          }
        }

        const payload = makePayload(
          plan,
          fullResult,
          separatedResult,
          fontMetricsMap,
          loadedImagesMap,
          compName,
        );

        loadMomentumLibrary()
          .then(() => {
            sendPayload(payload).then((result) => {
              if (
                result &&
                result.startsWith &&
                result.indexOf("__DEBUG__") === 0
              ) {
                // Ignore AE debug logs in the user-facing console.
              }
              if (
                result &&
                result.startsWith &&
                result.startsWith(ERROR_PREFIX)
              ) {
                reject(result.substring(ERROR_PREFIX.length + 1));
              } else {
                resolve("Code executed successfully");
              }
            }).catch(reject);
          })
          .catch(reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  return {
    executeUserCode,
  };
})();
