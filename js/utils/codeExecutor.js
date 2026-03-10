// Frontend code executor:
// preprocess code, run analyzer passes, then invoke AE with parsed arguments.
window.codeExecutor = (function () {
  const ERROR_PREFIX = "ERROR:";

  let imageAnalyzer = null;
  let p5Analyzer = null;
  let fontAnalyzer = null;
  const AE_RESERVED_DATA_HELPERS = {
    boolean: "_data_boolean",
    byte: "_data_byte",
    char: "_data_char",
    float: "_data_float",
    hex: "_data_hex",
    int: "_data_int",
    unchar: "_data_unchar",
    unhex: "_data_unhex",
  };

  function getImageAnalyzer() {
    if (!imageAnalyzer && typeof window.ImageAnalyzer !== "undefined") {
      imageAnalyzer = new window.ImageAnalyzer();
    }
    return imageAnalyzer;
  }

  async function collectAndLoadImages(code) {
    const analyzer = getImageAnalyzer();
    if (!analyzer) {
      console.warn("[CodeExecutor] ImageAnalyzer not available");
      return {};
    }

    const imagePaths = analyzer.collectImagesFromCode(code);
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

  async function collectFontMetrics(code) {
    const analyzer = getFontAnalyzer();
    if (!analyzer) {
      return {};
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

  // ----------------------------------------
  // Code splitting
  // ----------------------------------------
  function parseTopLevelProgram(code) {
    if (typeof acorn === "undefined") {
      throw new Error("Acorn is not available");
    }
    return acorn.parse(code, {
      ecmaVersion: 2020,
      sourceType: "script",
      ranges: false,
    });
  }

  function isFunctionLikeNode(node) {
    return (
      node &&
      (node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression")
    );
  }

  function getEntryDefinition(program, code, funcName) {
    if (!program || !program.body) return null;

    for (const node of program.body) {
      if (
        node &&
        node.type === "FunctionDeclaration" &&
        node.id &&
        node.id.name === funcName
      ) {
        return {
          kind: "function",
          name: funcName,
          body:
            node.body && node.body.type === "BlockStatement"
              ? code.slice(node.body.start + 1, node.body.end - 1).trim()
              : "",
          full: code.slice(node.start, node.end),
          start: node.start,
          end: node.end,
        };
      }

      if (node && node.type === "VariableDeclaration") {
        for (const decl of node.declarations || []) {
          if (
            decl &&
            decl.id &&
            decl.id.type === "Identifier" &&
            decl.id.name === funcName &&
            isFunctionLikeNode(decl.init)
          ) {
            const fnNode = decl.init;
            let body = "";
            if (fnNode.body && fnNode.body.type === "BlockStatement") {
              body = code
                .slice(fnNode.body.start + 1, fnNode.body.end - 1)
                .trim();
            } else if (fnNode.body) {
              body =
                "return " +
                code.slice(fnNode.body.start, fnNode.body.end).trim() +
                ";";
            }

            return {
              kind: "variable",
              name: funcName,
              body: body,
              full: code.slice(node.start, node.end),
              start: node.start,
              end: node.end,
            };
          }
        }
      }
    }

    return null;
  }

  function collectNamesFromPattern(pattern, outNames) {
    if (!pattern || !outNames) {
      return;
    }

    switch (pattern.type) {
      case "Identifier":
        outNames.push(pattern.name);
        return;
      case "ObjectPattern":
        for (const prop of pattern.properties || []) {
          if (!prop) continue;
          if (prop.type === "Property") {
            collectNamesFromPattern(prop.value, outNames);
          } else if (prop.type === "RestElement") {
            collectNamesFromPattern(prop.argument, outNames);
          }
        }
        return;
      case "ArrayPattern":
        for (const item of pattern.elements || []) {
          if (item) collectNamesFromPattern(item, outNames);
        }
        return;
      case "AssignmentPattern":
        collectNamesFromPattern(pattern.left, outNames);
        return;
      case "RestElement":
        collectNamesFromPattern(pattern.argument, outNames);
        return;
      default:
        return;
    }
  }

  function getGlobalVarNames(program) {
    const names = [];
    const seen = Object.create(null);
    const excluded = {
      setup: true,
      draw: true,
      preload: true,
    };

    if (!program || !Array.isArray(program.body)) {
      return names;
    }

    for (const node of program.body) {
      if (!node || node.type !== "VariableDeclaration") {
        continue;
      }

      if (node.kind === "const") {
        continue;
      }

      for (const decl of node.declarations || []) {
        const bindingNames = [];
        collectNamesFromPattern(decl && decl.id, bindingNames);

        for (const name of bindingNames) {
          if (!name || seen[name] || excluded[name]) continue;
          seen[name] = true;
          names.push(name);
        }
      }
    }

    return names;
  }

  // Remove only top-level setup()/draw() definitions and leave helper code intact.
  function removeRangesFromCode(code, ranges) {
    if (!ranges || ranges.length === 0) return code;

    const sorted = ranges
      .filter(
        (r) => r && typeof r.start === "number" && typeof r.end === "number",
      )
      .sort((a, b) => b.start - a.start);

    let out = code;
    for (const range of sorted) {
      out = out.slice(0, range.start) + out.slice(range.end);
    }
    return out;
  }

  function parseGlobalVars(globalCode) {
    const vars = {};
    const regex = /var\s+(\w+)\s*=\s*([^;,\n]+)/g;
    let match;
    while ((match = regex.exec(globalCode)) !== null) {
      const name = match[1];
      const valueStr = match[2].trim();
      const num = parseFloat(valueStr);
      if (!isNaN(num)) {
        vars[name] = num;
      }
    }
    return vars;
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

  function rewriteReservedDataHelperCalls(code) {
    const source = String(code || "");
    let out = "";
    let i = 0;
    let inStr = false;
    let strChar = "";

    while (i < source.length) {
      const ch = source[i];

      if (inStr) {
        out += ch;
        if (ch === "\\" && i + 1 < source.length) {
          out += source[i + 1];
          i += 2;
          continue;
        }
        if (ch === strChar) {
          inStr = false;
        }
        i++;
        continue;
      }

      if (ch === '"' || ch === "'" || ch === "`") {
        inStr = true;
        strChar = ch;
        out += ch;
        i++;
        continue;
      }

      if (/[A-Za-z_$]/.test(ch)) {
        let j = i + 1;
        while (j < source.length && /[A-Za-z0-9_$]/.test(source[j])) {
          j++;
        }

        const word = source.slice(i, j);
        const alias = Object.prototype.hasOwnProperty.call(
          AE_RESERVED_DATA_HELPERS,
          word,
        )
          ? AE_RESERVED_DATA_HELPERS[word]
          : null;
        const prev = i > 0 ? source[i - 1] : "";

        if (alias && prev !== "." && !/[A-Za-z0-9_$]/.test(prev)) {
          let k = j;
          while (k < source.length && /\s/.test(source[k])) {
            k++;
          }
          if (source[k] === "(") {
            out += alias;
            i = j;
            continue;
          }
        }

        out += word;
        i = j;
        continue;
      }

      out += ch;
      i++;
    }

    return out;
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

  // ----------------------------------------
  // Analyzer passes
  // ----------------------------------------
  async function analyzeDependenciesAsync(code) {
    const analyzer = getP5Analyzer();
    if (!analyzer) {
      console.warn("[CodeExecutor] P5Analyzer not loaded");
      return null;
    }

    try {
      return await analyzer.analyzeDependencies(code);
    } catch (error) {
      console.warn("[CodeExecutor] 依赖分析失败:", error.message);
      return null;
    }
  }

  async function fullAnalyzeAsync(code) {
    const analyzer = getP5Analyzer();
    if (!analyzer) {
      console.warn("[CodeExecutor] P5Analyzer not loaded");
      return null;
    }

    try {
      return await analyzer.fullAnalyze(code);
    } catch (error) {
      console.warn("[CodeExecutor] 完整分析失败:", error.message);
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
  ) {
    const analyzer = getP5Analyzer();
    if (!analyzer) {
      console.warn("[CodeExecutor] P5Analyzer not loaded");
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
      );
    } catch (error) {
      console.warn("[CodeExecutor] 分别分析失败:", error.message);
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

  // Split source into:
  // - globalCode: top-level helpers and globals
  // - setupCode/drawCode: entry bodies
  // - setupFullCode/drawFullCode/preloadFullCode: original entry definitions
  function parseProcessingCode(code) {
    let drawCode = "";
    let setupCode = "";
    let drawFullCode = "";
    let setupFullCode = "";
    let preloadFullCode = "";
    let globalCode = code || "";
    let globalVarNames = [];

    try {
      const program = parseTopLevelProgram(code || "");
      const drawEntry = getEntryDefinition(program, code || "", "draw");
      const setupEntry = getEntryDefinition(program, code || "", "setup");
      const preloadEntry = getEntryDefinition(program, code || "", "preload");

      if (drawEntry) {
        drawCode = drawEntry.body || "";
        drawFullCode = drawEntry.full || "";
      }
      if (setupEntry) {
        setupCode = setupEntry.body || "";
        setupFullCode = setupEntry.full || "";
      }
      if (preloadEntry) {
        preloadFullCode = preloadEntry.full || "";
      }

      globalCode = removeRangesFromCode(code || "", [
        drawEntry ? { start: drawEntry.start, end: drawEntry.end } : null,
        setupEntry ? { start: setupEntry.start, end: setupEntry.end } : null,
        preloadEntry ? { start: preloadEntry.start, end: preloadEntry.end } : null,
      ]).trim();
      globalVarNames = getGlobalVarNames(program);
    } catch (e) {
      console.warn(
        "[CodeExecutor] AST 提取 setup/draw 失败，回退为空拆分:",
        e.message,
      );
      globalCode = (code || "").trim();
    }

    const globalVars = parseGlobalVars(globalCode);

    return {
      drawCode,
      setupCode,
      drawFullCode,
      setupFullCode,
      preloadFullCode,
      globalCode,
      globalVars,
      globalVarNames,
    };
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
    parsed,
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

    const hasSetup = !!(parsed.setupCode && parsed.setupCode.length > 0);
    const hasDraw = !!(parsed.drawCode && parsed.drawCode.length > 0);
    const hasSetupOrDraw = hasSetup || hasDraw;

    return {
      args: [
        rewriteReservedDataHelperCalls(parsed.drawCode || ""),
        rewriteReservedDataHelperCalls(parsed.setupCode || ""),
        rewriteReservedDataHelperCalls(parsed.globalCode || ""),
        compName,
        parsed.globalVars.width || 100,
        parsed.globalVars.height || 100,
        parsed.globalVars.frameRate || 30,
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
        rewriteReservedDataHelperCalls(parsed.setupFullCode || ""),
        rewriteReservedDataHelperCalls(parsed.drawFullCode || ""),
        rewriteReservedDataHelperCalls(parsed.preloadFullCode || ""),
        parsed.globalVarNames || [],
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

        if (
          window.codePreprocessor &&
          window.codePreprocessor.instrumentShapeCallsites
        ) {
          code = window.codePreprocessor.instrumentShapeCallsites(code);
        }

        const parsed = parseProcessingCode(code);
        const analysisCode =
          (parsed.globalCode || "") +
          "\n" +
          (parsed.preloadFullCode || "") +
          "\n" +
          (parsed.setupFullCode || "") +
          "\n" +
          (parsed.drawFullCode || "");

        // Images must be ready before runtime analysis so preload() can resolve them.
        const loadedImagesMap = await collectAndLoadImages(code);

        let fullResult = null;
        try {
          fullResult = await fullAnalyzeAsync(analysisCode);
        } catch (e) {
          console.warn("[CodeExecutor] P5Analyzer 分析失败，使用默认结果");
          fullResult = null;
        }

        let separatedResult = null;
        try {
          separatedResult = await analyzeSeparatedAsync(
            parsed.setupCode || "",
            parsed.drawCode || "",
            parsed.globalCode || "",
            parsed.setupFullCode || "",
            parsed.drawFullCode || "",
            parsed.preloadFullCode || "",
          );
        } catch (e) {
          console.warn("[CodeExecutor] 分别分析失败，使用默认结果");
          separatedResult = null;
        }

        const fontMetricsMap = await collectFontMetrics(code);

        if (separatedResult) {
          if (separatedResult.setupRenderLayers) {
            separatedResult.setupRenderLayers = injectFontFamilyToLayers(
              separatedResult.setupRenderLayers,
              fontMetricsMap,
              parsed.setupCode || "",
            );
          }
          if (separatedResult.drawRenderLayers) {
            separatedResult.drawRenderLayers = injectFontFamilyToLayers(
              separatedResult.drawRenderLayers,
              fontMetricsMap,
              parsed.drawCode || "",
            );
          }
        }

        const payload = makePayload(
          parsed,
          fullResult,
          separatedResult,
          fontMetricsMap,
          loadedImagesMap,
          compName,
        );

        loadMomentumLibrary()
          .then(() => {
            sendPayload(payload).then((result) => {
              if (result && result.startsWith && result.startsWith("ERROR:")) {
                console.error("[CodeExecutor] AE script error:", result);
              }
              if (
                result &&
                result.startsWith &&
                result.indexOf("__DEBUG__") === 0
              ) {
                try {
                  const logs = JSON.parse(result.substring("__DEBUG__".length));
                  if (Array.isArray(logs)) {
                    for (let i = 0; i < logs.length; i++) {
                      console.log(logs[i]);
                    }
                  }
                } catch (e) {
                  console.warn(
                    "[CodeExecutor] 解析 AE debug 日志失败:",
                    e.message,
                  );
                }
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
