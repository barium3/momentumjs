// Frontend execution pipeline:
// preprocess code, run analyzer passes, then invoke AE with parsed arguments.
window.codeExecutor = (function () {
  const ERROR_PREFIX = "ERROR:";

  let imageAnalyzer = null;
  let p5Analyzer = null;
  let fontAnalyzer = null;
  const bitmapControllerBootstrap =
    window.momentumBitmapControllerBootstrap.createService({
      absolutizeBitmapAssetCalls:
        window.momentumPluginAsset.absolutizeBitmapAssetCalls,
      buildExecutionPlan,
      getCompiler: function () {
        return window.sketchCompiler;
      },
    });

  function getImageAnalyzer() {
    if (!imageAnalyzer) {
      imageAnalyzer = new window.ImageAnalyzer();
    }
    return imageAnalyzer;
  }

  async function collectAndLoadImages(code, compiled) {
    const analyzer = getImageAnalyzer();
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
    return window.momentumPluginBridge.loadMomentumLibrary();
  }

  function getFontAnalyzer() {
    if (!fontAnalyzer) {
      fontAnalyzer = new window.FontAnalyzer();
      fontAnalyzer.init();
    }
    return fontAnalyzer;
  }

  async function translateFontNames(code) {
    const analyzer = getFontAnalyzer();
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

  function absolutizeAeFontPaths(plan) {
    return window.momentumPluginAsset.absolutizeAeFontPaths(plan);
  }

  function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function getP5Analyzer() {
    if (!p5Analyzer) {
      p5Analyzer = new window.P5Analyzer({
        timeout: 2000,
      });
    }
    return p5Analyzer;
  }

  // Runtime analysis runs in two modes: full-program and setup/draw separation.
  async function fullAnalyzeAsync(code, staticAnalysis, compiledDependencies) {
    const analyzer = getP5Analyzer();
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
    executionOptions,
  ) {
    const analyzer = getP5Analyzer();
    try {
      return await analyzer.analyzeSetupAndDraw(
        setupCode,
        drawCode,
        globalCode,
        setupFullCode,
        drawFullCode,
        preloadFullCode,
        staticAnalysis,
        executionOptions,
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

  function isNonEmptyCode(code) {
    return !!(code && String(code).trim());
  }

  function synthesizeSetupFullCode(code) {
    const source = code || "";
    if (!isNonEmptyCode(source)) {
      return "";
    }
    return `function setup() {\n${source}\n}`;
  }

  function normalizeGlobalOnlyPlan(plan) {
    const hasSetup = isNonEmptyCode(plan && plan.setupCode);
    const hasDraw = isNonEmptyCode(plan && plan.drawCode);
    const hasGlobal = isNonEmptyCode(plan && plan.globalCode);

    if (hasSetup || hasDraw || !hasGlobal) {
      return plan;
    }

    const setupCode = plan.globalCode || "";
    const setupFullCode = synthesizeSetupFullCode(setupCode);
    const aeSetupCode = plan.aeGlobalCode || setupCode;
    const aeSetupFullCode = synthesizeSetupFullCode(
      plan.aeGlobalCode || aeSetupCode,
    );

    return {
      ...plan,
      setupCode: setupCode,
      setupFullCode: setupFullCode,
      globalCode: "",
      aeSetupCode: aeSetupCode,
      aeSetupFullCode: aeSetupFullCode,
      aeGlobalCode: "",
      analysisCode: [
        "",
        plan.preloadFullCode || "",
        setupFullCode,
        plan.drawFullCode || "",
      ].join("\n"),
    };
  }

  function buildExecutionPlan(compiled) {
    const output = compiled && compiled.output ? compiled.output : {};
    const ae = compiled && compiled.ae ? compiled.ae : {};
    const config = compiled && compiled.config ? compiled.config : {};
    const globals = compiled && compiled.globals ? compiled.globals : {};

    return absolutizeAeFontPaths(normalizeGlobalOnlyPlan({
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
    }));
  }

  function detectBitmapRequirements(code) {
    try {
      return window.momentumRuntimeCapabilities.detectBitmapRequirements(code);
    } catch (_ignore) {
      return {
        requiresBitmap: false,
        functions: [],
      };
    }
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

  async function sendPayload(payload) {
    return window.momentumPluginBridge.sendPayload(payload);
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

    const hasSetup = isNonEmptyCode(plan.setupCode);
    const hasDraw = isNonEmptyCode(plan.drawCode);
    const hasGlobal = isNonEmptyCode(plan.globalCode);
    const hasSetupOrDraw = hasSetup || hasDraw || hasGlobal;

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

  function hasControllerDependencies(compiled) {
    const controllers =
      compiled && compiled.dependencies ? compiled.dependencies.controllers : null;

    if (!controllers || typeof controllers !== "object") {
      return false;
    }

    for (const key in controllers) {
      if (Object.prototype.hasOwnProperty.call(controllers, key) && controllers[key]) {
        return true;
      }
    }

    return false;
  }

  function shouldSkipComposition(compiled, separatedResult, forceBitmapRuntime) {
    if (forceBitmapRuntime) {
      return false;
    }

    const hasExplicitCanvas = !!(
      compiled &&
      compiled.config &&
      compiled.config.width !== null &&
      compiled.config.height !== null
    );

    if (hasExplicitCanvas) {
      return false;
    }

    if (hasControllerDependencies(compiled)) {
      return false;
    }

    const setupCount =
      separatedResult &&
      Array.isArray(separatedResult.setupRenderLayers)
        ? separatedResult.setupRenderLayers.length
        : 0;
    const drawCount =
      separatedResult &&
      Array.isArray(separatedResult.drawRenderLayers)
        ? separatedResult.drawRenderLayers.length
        : 0;

    return setupCount === 0 && drawCount === 0;
  }

  function executeUserCode(code, fileName) {
    return new Promise(async (resolve, reject) => {
      try {
        const compName = extractFileName(code, fileName || "New Composition");
        code = window.codePreprocessor.stripComments(code);

        code = await translateFontNames(code);
        const compiled = window.sketchCompiler.compile(code);
        if (!compiled.ok) {
          throw new Error(formatCompilerDiagnostics(compiled.diagnostics));
        }
        const runtimeRequirements = detectBitmapRequirements(compiled.code || code);
        const forceBitmapRuntime = !!(
          runtimeRequirements && runtimeRequirements.requiresBitmap
        );
        const plan = buildExecutionPlan(compiled);

        // Images must be loaded before runtime analysis so preload() can resolve them.
        const loadedImagesMap = await collectAndLoadImages(
          compiled.code || code,
          compiled,
        );

        let fullResult = null;
        if (!forceBitmapRuntime) {
          try {
            fullResult = await fullAnalyzeAsync(
              plan.analysisCode,
              compiled.analysis || null,
              compiled.dependencies || null,
            );
          } catch (e) {
            fullResult = null;
          }
        } else {
          fullResult = {
            dependencies: compiled.dependencies || null,
            fallback: false,
            error: null,
          };
        }

        let separatedResult = null;
        if (!forceBitmapRuntime) {
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

        if (shouldSkipComposition(compiled, separatedResult, forceBitmapRuntime)) {
          resolve("No composition created");
          return;
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
    discoverBitmapControllers:
      bitmapControllerBootstrap.discoverBitmapControllers,
    executeUserCode,
  };
})();
