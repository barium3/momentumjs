// Frontend execution pipeline:
// preprocess code, run analyzer passes, then invoke AE with parsed arguments.
window.codeExecutor = (function () {
  const ERROR_PREFIX = "ERROR:";
  const BITMAP_CONTROLLER_CALLSITE_PREFIX = "__mcc_";

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
    return window.momentumPluginBridge.loadMomentumLibrary();
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

  function absolutizeLoadFontCalls(code) {
    return window.momentumPluginAsset.absolutizeLoadFontCalls(code);
  }

  function absolutizeLoadImageCalls(code) {
    return window.momentumPluginAsset.absolutizeLoadImageCalls(code);
  }

  function absolutizeIoAssetCalls(code) {
    return window.momentumPluginAsset.absolutizeIoAssetCalls(code);
  }

  function absolutizeBitmapAssetCalls(code) {
    return window.momentumPluginAsset.absolutizeBitmapAssetCalls(code);
  }

  function absolutizeAeFontPaths(plan) {
    return window.momentumPluginAsset.absolutizeAeFontPaths(plan);
  }

  function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function toExtendScriptStringExpr(value) {
    return window.momentumPluginBridge.toExtendScriptStringExpr(value);
  }

  function getP5Analyzer() {
    if (!p5Analyzer && typeof window.P5Analyzer !== "undefined") {
      p5Analyzer = new window.P5Analyzer({
        timeout: 2000,
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
    executionOptions,
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
        executionOptions,
      );
    } catch (error) {
      return null;
    }
  }

  function getP5RuntimeFunction(p, funcName) {
    const p5Proto =
      p && p.constructor && p.constructor.prototype
        ? p.constructor.prototype
        : typeof p5 !== "undefined" && p5.prototype
          ? p5.prototype
          : null;

    let original = p5Proto && typeof p5Proto[funcName] === "function"
      ? p5Proto[funcName]
      : null;

    if (!original && p && typeof p[funcName] === "function") {
      original = p[funcName];
    }

    return typeof original === "function" ? original : null;
  }

  function createWindowBindingSession(targetWindow) {
    const descriptors = {};

    function remember(name) {
      if (Object.prototype.hasOwnProperty.call(descriptors, name)) {
        return;
      }

      descriptors[name] = Object.prototype.hasOwnProperty.call(targetWindow, name)
        ? Object.getOwnPropertyDescriptor(targetWindow, name)
        : null;
    }

    function setValue(name, value) {
      remember(name);
      Object.defineProperty(targetWindow, name, {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
      });
    }

    function setAccessor(name, getter, setter) {
      remember(name);
      Object.defineProperty(targetWindow, name, {
        configurable: true,
        enumerable: true,
        get: getter,
        set: setter,
      });
    }

    function restore() {
      const names = Object.keys(descriptors);
      for (let i = names.length - 1; i >= 0; i -= 1) {
        const name = names[i];
        const descriptor = descriptors[name];
        try {
          if (descriptor) {
            Object.defineProperty(targetWindow, name, descriptor);
          } else {
            delete targetWindow[name];
          }
        } catch (_restoreError) {
          if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")) {
            try {
              targetWindow[name] = descriptor.value;
            } catch (_valueRestoreError) {}
          } else if (!descriptor) {
            try {
              delete targetWindow[name];
            } catch (_deleteRestoreError) {
              targetWindow[name] = undefined;
            }
          }
        }
      }
    }

    return {
      setAccessor,
      setValue,
      restore,
    };
  }

  function bindP5RuntimeVariables(targetWindow, session, p) {
    const allVariables =
      typeof functionRegistry !== "undefined" && functionRegistry.getAllVariables
        ? functionRegistry.getAllVariables()
        : [];

    for (let i = 0; i < allVariables.length; i += 1) {
      const varName = allVariables[i];

      if (p && varName in p) {
        session.setAccessor(
          varName,
          () => p[varName],
          (value) => {
            try {
              p[varName] = value;
            } catch (_assignError) {}
          },
        );
        continue;
      }

      if (typeof p5 !== "undefined" && Object.prototype.hasOwnProperty.call(p5, varName)) {
        session.setValue(varName, p5[varName]);
        continue;
      }

      if (
        typeof p5 !== "undefined" &&
        p5.prototype &&
        Object.prototype.hasOwnProperty.call(p5.prototype, varName) &&
        p5.prototype[varName] !== undefined
      ) {
        session.setValue(varName, p5.prototype[varName]);
        continue;
      }

      if (typeof Math !== "undefined" && Object.prototype.hasOwnProperty.call(Math, varName)) {
        session.setValue(varName, Math[varName]);
      }
    }

    if (p && p.constructor && p.constructor.Vector) {
      session.setValue("createVector", function (x, y, z) {
        return new p.constructor.Vector(x, y, z);
      });
    }
  }

  function bindP5RuntimeFunctions(session, p) {
    const allFunctions =
      typeof functionRegistry !== "undefined" && functionRegistry.getAllFunctions
        ? functionRegistry.getAllFunctions()
        : [];

    for (let i = 0; i < allFunctions.length; i += 1) {
      const funcName = allFunctions[i];

      if (funcName === "print") {
        session.setValue(funcName, function () {
          return console.log.apply(console, arguments);
        });
        continue;
      }

      const original = getP5RuntimeFunction(p, funcName);
      if (!original) {
        continue;
      }

      session.setValue(funcName, function () {
        return original.apply(p, arguments);
      });
    }
  }

  function buildBitmapControllerCallsiteId(node, calleeName) {
    const safeName = String(calleeName || "controller").replace(/[^\w$]/g, "_");
    const loc =
      node &&
      node.loc &&
      node.loc.start &&
      typeof node.loc.start.line === "number" &&
      typeof node.loc.start.column === "number"
        ? node.loc.start
        : null;

    if (loc) {
      return `${BITMAP_CONTROLLER_CALLSITE_PREFIX}${safeName}_${loc.line}_${loc.column}`;
    }

    return `${BITMAP_CONTROLLER_CALLSITE_PREFIX}${safeName}`;
  }

  function instrumentBitmapControllerCallsites(sourceCode) {
    const source = String(sourceCode || "");
    if (!source.trim() || !window.compilerAst) {
      return source;
    }

    const controllerNames = {
      createSlider: true,
      createAngle: true,
      createColorPicker: true,
      createCheckbox: true,
      createSelect: true,
      createPoint: true,
    };

    let program = null;
    try {
      program = window.compilerAst.parse(source);
    } catch (_parseError) {
      return source;
    }

    const inserts = [];
    window.compilerAst.walk(program, function (node) {
      if (!node || node.type !== "CallExpression" || !node.callee) {
        return;
      }
      if (node.callee.type !== "Identifier" || !controllerNames[node.callee.name]) {
        return;
      }

      const openParen = source.indexOf("(", node.callee.end);
      if (openParen === -1 || openParen > node.end) {
        return;
      }

      inserts.push({
        start: openParen + 1,
        end: openParen + 1,
        text:
          JSON.stringify(buildBitmapControllerCallsiteId(node, node.callee.name)) +
          (node.arguments.length > 0 ? ", " : ""),
      });
    });

    return window.compilerAst.applyTextReplacements(source, inserts);
  }

  function bindControllerBootstrapStubs(session, controllerCollector) {
    const controllerTypeCounts = {};

    function extractControllerBootstrapArgs(argsLike) {
      const args = Array.prototype.slice.call(argsLike || []);
      let id = null;

      if (
        args.length > 0 &&
        typeof args[0] === "string" &&
        args[0].indexOf(BITMAP_CONTROLLER_CALLSITE_PREFIX) === 0
      ) {
        id = args.shift();
      }

      return {
        id,
        args,
      };
    }

    function pushControllerConfig(type, callInfo, payload) {
      const typeKey = String(type || "controller");
      const ordinal = controllerTypeCounts[typeKey] || 0;
      controllerTypeCounts[typeKey] = ordinal + 1;

      const config = Object.assign(
        {
          type: typeKey,
          id: callInfo && callInfo.id ? callInfo.id : `${BITMAP_CONTROLLER_CALLSITE_PREFIX}${typeKey}_${ordinal}`,
        },
        payload || {},
      );
      controllerCollector.push(config);
      return config;
    }

    function normalizeSliderValue(value, fallbackValue) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
      const fallback = Number(fallbackValue);
      return Number.isFinite(fallback) ? fallback : 0;
    }

    function normalizeColorArray(input) {
      if (typeof input === "string") {
        let text = input.replace(/^#/, "");
        if (text.length === 3 || text.length === 4) {
          const expanded = [];
          for (let i = 0; i < text.length; i += 1) {
            expanded.push(text.charAt(i), text.charAt(i));
          }
          text = expanded.join("");
        }
        if (text.length === 6 || text.length === 8) {
          const red = parseInt(text.slice(0, 2), 16);
          const green = parseInt(text.slice(2, 4), 16);
          const blue = parseInt(text.slice(4, 6), 16);
          const alpha = text.length === 8 ? parseInt(text.slice(6, 8), 16) : 255;
          return [red / 255, green / 255, blue / 255, alpha / 255];
        }
      }

      if (Array.isArray(input) && input.length >= 3) {
        const raw = [
          Number(input[0]),
          Number(input[1]),
          Number(input[2]),
          input.length >= 4 ? Number(input[3]) : 1,
        ];
        const use255Scale = raw.some((value, index) => Number.isFinite(value) && value > (index === 3 ? 1 : 1));
        const divisor = use255Scale ? 255 : 1;
        return raw.map((value, index) => {
          const fallback = index === 3 ? 1 : 1;
          const numeric = Number.isFinite(value) ? value : fallback;
          const normalized = numeric / divisor;
          if (normalized < 0) return 0;
          if (normalized > 1) return 1;
          return normalized;
        });
      }

      return [1, 1, 1, 1];
    }

    function colorArrayToHex(colorArray) {
      const rgba = normalizeColorArray(colorArray);
      const parts = [];
      for (let i = 0; i < 3; i += 1) {
        const channel = Math.round(Math.max(0, Math.min(1, rgba[i])) * 255);
        parts.push((channel < 16 ? "0" : "") + channel.toString(16));
      }
      const alpha = Math.round(Math.max(0, Math.min(1, rgba[3])) * 255);
      let hex = `#${parts.join("")}`;
      if (alpha < 255) {
        hex += (alpha < 16 ? "0" : "") + alpha.toString(16);
      }
      return hex;
    }

    session.setValue("duration", function () {});
    session.setValue("createSlider", function (min, max, value, step) {
      const callInfo = extractControllerBootstrapArgs(arguments);
      const args = callInfo.args;
      const sliderMin = normalizeSliderValue(args[0], 0);
      const sliderMax = normalizeSliderValue(args[1], 100);
      const sliderValue =
        args[2] === undefined ? sliderMin : normalizeSliderValue(args[2], sliderMin);
      const sliderStep = Number.isFinite(Number(args[3])) ? Number(args[3]) : 0;

      function clampAndSnap(nextValue) {
        let mapped = normalizeSliderValue(nextValue, sliderValue);
        if (mapped < sliderMin) mapped = sliderMin;
        if (mapped > sliderMax) mapped = sliderMax;
        if (sliderStep > 0) {
          mapped = Math.floor((mapped - sliderMin) / sliderStep) * sliderStep + sliderMin;
          if (mapped < sliderMin) mapped = sliderMin;
          if (mapped > sliderMax) mapped = sliderMax;
        }
        return mapped;
      }

      const mappedValue = clampAndSnap(sliderValue);
      pushControllerConfig("slider", callInfo, {
        min: sliderMin,
        max: sliderMax,
        value: mappedValue,
        step: sliderStep,
      });

      return {
        value() {
          return mappedValue;
        },
      };
    });
    session.setValue("createAngle", function (defaultDegrees) {
      const callInfo = extractControllerBootstrapArgs(arguments);
      const args = callInfo.args;
      const degrees = normalizeSliderValue(args[0], 0);

      pushControllerConfig("angle", callInfo, {
        value: degrees,
      });

      return {
        value() {
          return degrees;
        },
        degrees() {
          return degrees;
        },
        radians() {
          return (degrees * Math.PI) / 180;
        },
      };
    });
    session.setValue("createColorPicker", function (r, g, b, a) {
      const callInfo = extractControllerBootstrapArgs(arguments);
      const args = callInfo.args;
      let colorValue = [1, 1, 1, 1];
      if (args.length === 1) {
        colorValue = normalizeColorArray(args[0]);
      } else if (args.length >= 3) {
        colorValue = normalizeColorArray([args[0], args[1], args[2], args[3] === undefined ? 255 : args[3]]);
      }

      pushControllerConfig("color", callInfo, {
        value: colorValue.slice(),
      });

      return {
        color() {
          if (typeof color === "function") {
            return color(colorArrayToHex(colorValue));
          }
          return colorValue.slice();
        },
        value() {
          return colorArrayToHex(colorValue);
        },
      };
    });
    session.setValue("createCheckbox", function (label, checked) {
      const callInfo = extractControllerBootstrapArgs(arguments);
      const args = callInfo.args;
      const config = pushControllerConfig("checkbox", callInfo, {
        value: !!args[1],
      });
      if (typeof args[0] === "string" && args[0]) {
        config.label = args[0];
      }

      return {
        value() {
          return config.value;
        },
        checked() {
          return config.value;
        },
      };
    });
    session.setValue("createSelect", function () {
      const callInfo = extractControllerBootstrapArgs(arguments);
      const config = pushControllerConfig("select", callInfo, {
        options: [],
        value: 0,
      });
      const optionValues = [];

      function clampIndex(value) {
        const length = optionValues.length > 0 ? optionValues.length : 1;
        let index = Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
        if (index < 0) index = 0;
        if (index > length - 1) index = length - 1;
        return index;
      }

      return {
        option(label, value) {
          const optionLabel = label === undefined || label === null ? "" : String(label);
          config.options.push({ label: optionLabel });
          optionValues.push(arguments.length >= 2 ? value : label);
          config.value = clampIndex(config.value);
          return this;
        },
        index() {
          config.value = clampIndex(config.value);
          return config.value;
        },
        value() {
          const index = this.index();
          if (index < 0 || index >= optionValues.length) {
            return null;
          }
          return optionValues[index];
        },
        selected(value) {
          if (arguments.length === 0) {
            return this.value();
          }
          let nextIndex = -1;
          if (typeof value === "number" && isFinite(value)) {
            nextIndex = Math.floor(value);
          } else {
            for (let i = 0; i < optionValues.length; i += 1) {
              if (optionValues[i] === value || config.options[i].label === String(value)) {
                nextIndex = i;
                break;
              }
            }
          }
          if (nextIndex < 0) {
            nextIndex = 0;
          }
          config.value = clampIndex(nextIndex);
          return this;
        },
      };
    });
    session.setValue("createPoint", function (defaultX, defaultY) {
      const callInfo = extractControllerBootstrapArgs(arguments);
      const args = callInfo.args;
      const x = normalizeSliderValue(args[0], 0);
      const y = normalizeSliderValue(args[1], 0);

      pushControllerConfig("point", callInfo, {
        value: [x, y],
      });

      return {
        value() {
          return [x, y];
        },
        x() {
          return x;
        },
        y() {
          return y;
        },
      };
    });
  }

  function buildControllerBootstrapEntrypoints(sourceCode, targetWindow) {
    const factory = new Function(
      "window",
      `with (window) {\n${sourceCode}\nreturn {\npreload: (typeof preload === "function") ? preload : null,\nsetup: (typeof setup === "function") ? setup : null,\ndraw: (typeof draw === "function") ? draw : null\n};\n}`,
    );

    return factory(targetWindow);
  }

  async function createBitmapBootstrapRuntime(initialWidth, initialHeight) {
    if (typeof p5 === "undefined") {
      throw new Error("p5.js is not loaded");
    }

    return new Promise((resolve, reject) => {
      const container = document.createElement("div");
      container.style.cssText =
        "position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;";
      document.body.appendChild(container);

      let instance = null;

      try {
        instance = new p5((p) => {
          p.setup = function () {
            p.createCanvas(initialWidth, initialHeight);
            p.noLoop();
          };
        }, container);
      } catch (error) {
        if (container.parentNode) {
          container.parentNode.removeChild(container);
        }
        reject(error);
        return;
      }

      window.setTimeout(() => {
        resolve({
          p: instance,
          destroy() {
            try {
              if (instance && typeof instance.remove === "function") {
                instance.remove();
              }
            } catch (_removeError) {}
            if (container.parentNode) {
              container.parentNode.removeChild(container);
            }
          },
        });
      }, 0);
    });
  }

  async function runBitmapControllerBootstrap(code, compiled) {
    const source = absolutizeBitmapAssetCalls(typeof code === "string" ? code : "");
    const effectiveCompiled =
      compiled && compiled.ok ? compiled : getCompiler().compile(source);

    if (!effectiveCompiled || !effectiveCompiled.ok) {
      return [];
    }

    const plan = buildExecutionPlan(effectiveCompiled);
    const runtime = await createBitmapBootstrapRuntime(
      plan.globalVars.width || 100,
      plan.globalVars.height || 100,
    );
    const controllerCollector = [];
    const session = createWindowBindingSession(window);
    const controllerSource = instrumentBitmapControllerCallsites(source);

    try {
      bindP5RuntimeVariables(window, session, runtime.p);
      bindP5RuntimeFunctions(session, runtime.p);
      bindControllerBootstrapStubs(session, controllerCollector);

      const entrypoints = buildControllerBootstrapEntrypoints(controllerSource, window);

      if (entrypoints && typeof entrypoints.preload === "function") {
        entrypoints.preload.call(window);
      }

      if (entrypoints && typeof entrypoints.setup === "function") {
        entrypoints.setup.call(window);
      }

      if (entrypoints && typeof entrypoints.draw === "function") {
        entrypoints.draw.call(window);
      }

      return controllerCollector.slice();
    } finally {
      session.restore();
      runtime.destroy();
    }
  }

  async function discoverBitmapControllers(code, compiled) {
    try {
      return await runBitmapControllerBootstrap(code, compiled);
    } catch (_bootstrapError) {
      return [];
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

  function getCompiler() {
    if (typeof window.sketchCompiler === "undefined" || !window.sketchCompiler) {
      throw new Error("Compiler is not available");
    }
    return window.sketchCompiler;
  }

  function detectBitmapRequirements(code) {
    if (
      !window.momentumRuntimeCapabilities ||
      typeof window.momentumRuntimeCapabilities.detectBitmapRequirements !== "function"
    ) {
      return {
        requiresBitmap: false,
        functions: [],
      };
    }

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

  function evalExtendScript(script) {
    return window.momentumPluginBridge.evalExtendScript(script);
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
        if (window.codePreprocessor && window.codePreprocessor.stripComments) {
          code = window.codePreprocessor.stripComments(code);
        }

        code = await translateFontNames(code);
        const compiled = getCompiler().compile(code);
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
    absolutizeBitmapAssetCalls,
    absolutizeIoAssetCalls,
    absolutizeLoadFontCalls,
    absolutizeLoadImageCalls,
    discoverBitmapControllers,
    executeUserCode,
  };
})();
