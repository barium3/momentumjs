// Code execution module - Processing style only
window.codeExecutor = (function () {
  const ERROR_PREFIX = "ERROR:";

  // ========================================
  // ImageAnalyzer 实例
  // ========================================
  let imageAnalyzer = null;

  function getImageAnalyzer() {
    if (!imageAnalyzer && typeof window.ImageAnalyzer !== "undefined") {
      imageAnalyzer = new window.ImageAnalyzer();
    }
    return imageAnalyzer;
  }

  /**
   * 从代码中收集图片并在前端预读取元数据
   * 内部调用 ImageAnalyzer 的 AST 收集 + 前端图片尺寸读取
   * @param {string} code - 用户代码
   * @returns {Promise<Object>} 图片信息映射 { imagePath: { width, height, path, success } }
   */
  async function collectAndLoadImages(code) {
    const analyzer = getImageAnalyzer();
    if (!analyzer) {
      console.warn("[CodeExecutor] ImageAnalyzer not available");
      return {};
    }

    // 1. 从代码中收集图片路径
    const imagePaths = analyzer.collectImagesFromCode(code);
    if (imagePaths.size === 0) {
      return {};
    }

    console.log("[CodeExecutor] Found images in code:", Array.from(imagePaths));

    // 2. 前端读取图片元数据
    const loadedImages = await analyzer.loadImagesFromFrontend(imagePaths);

    // 预存图片元数据，供 runtime 中的真实 p5.loadImage 包装器解析 user/ 路径
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

    console.log(
      "[CodeExecutor] Image metadata registered to runtime:",
      Object.keys(window.__momentumImageMetadata),
    );

    return loadedImages;
  }

  /**
   * 从代码中收集字体的度量数据
   * 内部调用 FontAnalyzer 的 AST 收集 + AE 度量获取
   * @param {string} code - 用户代码
   * @returns {Promise<Object>} 字体度量数据映射 { fontName: metrics }
   */
  async function collectFontMetrics(code) {
    const analyzer = getFontAnalyzer();
    if (!analyzer) {
      return {};
    }

    // 使用 FontAnalyzer 的 AST 方法收集字体并获取度量
    const metricsMap = await analyzer.collectFontMetricsFromCode(code);
    return metricsMap;
  }

  /**
   * 为 renderLayers 注入 fontFamily（不含 fontMetrics）
   * fontMetrics 由 engine 统一导出，图层通过 fontFamily 名称引用
   * @param {Array} renderLayers - 渲染图层数组
   * @param {Object} fontMetricsMap - 字体度量映射（用于获取可用的字体列表）
   * @param {string} code - 原始代码（用于提取当前字体状态）
   * @returns {Array} 注入了 fontFamily 的 renderLayers
   */
  function injectFontFamilyToLayers(renderLayers, fontMetricsMap, code) {
    if (!renderLayers || !Array.isArray(renderLayers)) {
      return renderLayers;
    }

    // 从代码中提取默认字体设置
    let defaultFont = null;
    const fontMatch = code.match(/textFont\s*\(\s*(["'])([^"']+)\1/);
    if (fontMatch) {
      defaultFont = fontMatch[2];
    }

    // 获取可用字体列表
    const availableFonts = Object.keys(fontMetricsMap);
    const fallbackFont = availableFonts.length > 0 ? availableFonts[0] : null;

    return renderLayers.map((layer) => {
      // 处理字符串形式的 layer（如 "text"）
      if (layer === "text") {
        const fontName = defaultFont || fallbackFont;
        // 只注入 fontFamily，不传 fontMetrics（由 engine 统一导出）
        return {
          type: "text",
          fontFamily: fontName || "Arial",
        };
      }

      // 处理对象形式的 layer
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

      csInterface.evalScript(
        `
        (function() {
          var file = new File("${bundlePath.replace(/\\/g, "\\\\")}");
          if (!file.exists) return "ERROR: Cannot find momentum.js file";

          try {
            $.evalFile(file.fsName);
            return "SUCCESS";
          } catch(e) {
            return "ERROR: " + e.message;
          }
        })();
        `,
        (result) => {
          if (result.startsWith(ERROR_PREFIX)) {
            reject(result.substring(ERROR_PREFIX.length + 1));
          } else {
            resolve();
          }
        },
      );
    });
  }

  /**
   * 提取函数体（处理嵌套花括号）
   */
  function extractFunctionBody(code, funcName) {
    const funcIndex = code.indexOf("function " + funcName);
    if (funcIndex === -1) return "";

    const braceStart = code.indexOf("{", funcIndex);
    if (braceStart === -1) return "";

    let braceCount = 1;
    let i = braceStart + 1;
    while (i < code.length && braceCount > 0) {
      if (code[i] === "{") braceCount++;
      if (code[i] === "}") braceCount--;
      i++;
    }

    return code.substring(braceStart + 1, i - 1).trim();
  }

  /**
   * 移除函数块
   */
  function removeFunctionBlock(code, funcName) {
    const funcIndex = code.indexOf("function " + funcName);
    if (funcIndex === -1) return code;

    const braceStart = code.indexOf("{", funcIndex);
    if (braceStart === -1) return code;

    let braceCount = 1;
    let i = braceStart + 1;
    while (i < code.length && braceCount > 0) {
      if (code[i] === "{") braceCount++;
      if (code[i] === "}") braceCount--;
      i++;
    }

    return code.substring(0, funcIndex) + code.substring(i);
  }

  /**
   * 解析全局变量，提取常量值
   */
  function parseGlobalVars(globalCode) {
    const vars = {};
    // 匹配 var name = value;
    const regex = /var\s+(\w+)\s*=\s*([^;,\n]+)/g;
    let match;
    while ((match = regex.exec(globalCode)) !== null) {
      const name = match[1];
      const valueStr = match[2].trim();
      // 尝试解析为数字
      const num = parseFloat(valueStr);
      if (!isNaN(num)) {
        vars[name] = num;
      }
    }
    return vars;
  }

  // P5Analyzer 实例（用于分析渲染函数调用）
  let p5Analyzer = null;

  // FontAnalyzer 实例（用于字体名称翻译）
  let fontAnalyzer = null;

  function getFontAnalyzer() {
    if (!fontAnalyzer && typeof window.FontAnalyzer !== "undefined") {
      fontAnalyzer = new window.FontAnalyzer();
      // 预加载字体列表
      fontAnalyzer.init();
    }
    return fontAnalyzer;
  }

  /**
   * 预处理代码：翻译 textFont() 调用中的字体名称
   * @param {string} code - 用户代码
   * @returns {Promise<string>} 翻译后的代码
   */
  async function translateFontNames(code) {
    const analyzer = getFontAnalyzer();
    if (!analyzer) {
      return code; // FontAnalyzer 未加载，原样返回
    }

    // 正则匹配 textFont("字体名") 或 textFont('字体名')
    const fontCallRegex =
      /textFont\s*\(\s*(["'])([^"']+)\1\s*(?:,\s*[^)]+)?\)/g;

    let translatedCode = code;
    let match;

    // 收集所有需要翻译的字体
    const fontsToTranslate = new Set();
    while ((match = fontCallRegex.exec(code)) !== null) {
      fontsToTranslate.add(match[2]);
    }

    // 批量翻译
    const fontTranslations = {};
    for (const fontName of fontsToTranslate) {
      const psName = await analyzer.getPostScriptName(fontName);
      if (psName) {
        fontTranslations[fontName] = psName;
      }
    }

    // 替换代码中的字体名称
    if (Object.keys(fontTranslations).length > 0) {
      for (const [original, translated] of Object.entries(fontTranslations)) {
        // 替换 textFont("Original") 或 textFont("Original", size)
        const escapedOriginal = escapeRegex(original);
        // 匹配带或不带第二个参数的情况
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

  /**
   * 转义正则特殊字符
   */
  function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

  /**
   * 使用 P5Analyzer 分析渲染函数调用
   * 返回 { renderLayers, hasBackground }，用于传递给后端
   */
  function analyzeLayersWithAST(code) {
    const analyzer = getP5Analyzer();
    if (!analyzer) {
      console.warn(
        "[CodeExecutor] P5Analyzer not loaded, falling back to basic analysis",
      );
      return null;
    }

    // 同步分析（因为 analyze 是 async，但这里需要同步返回）
    // 我们使用 quickAnalyze 或在 Promise 中处理
    return { pending: true };
  }

  /**
   * 异步分析依赖（运行时分析）
   */
  async function analyzeDependenciesAsync(code) {
    const analyzer = getP5Analyzer();
    if (!analyzer) {
      console.warn("[CodeExecutor] P5Analyzer not loaded");
      return null;
    }

    try {
      // 使用运行时分析（异步执行代码）
      const result = await analyzer.analyzeDependencies(code);
      return result;
    } catch (error) {
      console.warn("[CodeExecutor] 依赖分析失败:", error.message);
      return null;
    }
  }

  /**
   * 完整分析：同时获取 renderLayers 和依赖信息
   */
  async function fullAnalyzeAsync(code) {
    const analyzer = getP5Analyzer();
    if (!analyzer) {
      console.warn("[CodeExecutor] P5Analyzer not loaded");
      return null;
    }

    try {
      const result = await analyzer.fullAnalyze(code);
      return result;
    } catch (error) {
      console.warn("[CodeExecutor] 完整分析失败:", error.message);
      return null;
    }
  }

  /**
   * 分别分析setup和draw中的shape调用
   */
  async function analyzeSeparatedAsync(setupCode, drawCode, globalCode) {
    const analyzer = getP5Analyzer();
    if (!analyzer) {
      console.warn("[CodeExecutor] P5Analyzer not loaded");
      return null;
    }

    try {
      const result = await analyzer.analyzeSetupAndDraw(
        setupCode,
        drawCode,
        globalCode,
      );
      return result;
    } catch (error) {
      console.warn("[CodeExecutor] 分别分析失败:", error.message);
      return null;
    }
  }

  /**
   * 从代码中提取文件名（从注释中）
   */
  function extractFileName(code, defaultName) {
    const fileNameRegex = /\/\/\s*@filename[:\s]*([^\n]+)/;
    const match = code.match(fileNameRegex);
    if (match && match[1]) {
      return match[1].trim();
    }
    return defaultName || "Untitled";
  }

  /**
   * 注：之前此处曾做过前端 font metrics 测量（canvas/DOM），并将结果注入到 renderLayers。
   * 目前已移除该逻辑：前端不再检测 ascent/descent/baseline 等 metrics。
   */

  /**
   * 在前端解析 Processing 代码，提取关键部分
   */
  function parseProcessingCode(code) {
    const drawCode = extractFunctionBody(code, "draw");
    const setupCode = extractFunctionBody(code, "setup");

    let globalCode = removeFunctionBlock(code, "draw");
    globalCode = removeFunctionBlock(globalCode, "setup");
    globalCode = globalCode.trim();

    const globalVars = parseGlobalVars(globalCode);
    const maxShapes = globalVars.maxShapes || 50;

    return { drawCode, setupCode, globalCode, globalVars, maxShapes };
  }

  function executeUserCode(code, fileName) {
    return new Promise(async (resolve, reject) => {
      try {
        // 先提取 @filename（依赖注释），再移除注释避免 Acorn 解析 Unicode 报错
        const compName = extractFileName(code, fileName || "New Composition");
        if (window.codePreprocessor && window.codePreprocessor.stripComments) {
          code = window.codePreprocessor.stripComments(code);
        }

        // 翻译字体名称：displayName → PostScript Name
        code = await translateFontNames(code);

        const parsed = parseProcessingCode(code);

        // 提取完整的函数定义，而不只是函数体
        const drawFuncBody = extractFunctionBody(code, "draw");
        const setupFuncBody = extractFunctionBody(code, "setup");

        // 提取完整的函数声明（包含 function 关键字和大括号）
        const drawFullCode = drawFuncBody
          ? "function draw() {" + drawFuncBody + "}"
          : "";
        const setupFullCode = setupFuncBody
          ? "function setup() {" + setupFuncBody + "}"
          : "";

        // 分析循环中的图形调用和依赖
        const analysisCode =
          (parsed.globalCode || "") +
          "\n" +
          (setupFullCode || "") +
          "\n" +
          (drawFullCode || "");

        // 【提前】收集并加载代码中使用的图片
        // 必须在 runtime 分析（fullAnalyzeAsync）之前完成，
        // 因为 runtime 会执行 preload()，preload 里的 loadImage() 需要从缓存中读取数据
        const loadedImagesMap = await collectAndLoadImages(code);
        console.log("[CodeExecutor] Loaded images:", loadedImagesMap);

        // 使用 P5Analyzer 进行完整分析（包含 dependencies 等信息）
        let fullResult = null;
        try {
          fullResult = await fullAnalyzeAsync(analysisCode);
        } catch (e) {
          console.warn("[CodeExecutor] P5Analyzer 分析失败，使用默认结果");
          fullResult = null;
        }

        // 分别分析setup和draw中的shape调用
        let separatedResult = null;
        try {
          separatedResult = await analyzeSeparatedAsync(
            parsed.setupCode || "",
            parsed.drawCode || "",
            parsed.globalCode || "",
          );
        } catch (e) {
          console.warn("[CodeExecutor] 分别分析失败，使用默认结果");
          separatedResult = null;
        }

        // 收集代码中使用的字体度量数据
        const fontMetricsMap = await collectFontMetrics(code);

        // 图片已在 fullAnalyzeAsync 之前加载完毕（见上方），这里无需重复加载

        // 为 renderLayers 注入 fontFamily（fontMetrics 由 engine 统一导出）
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

        // 构建调用参数
        const drawArg = JSON.stringify(parsed.drawCode || "");
        const setupArg = JSON.stringify(parsed.setupCode || "");
        const globalArg = JSON.stringify(parsed.globalCode || "");
        const nameArg = JSON.stringify(compName);

        // 分别传递setup和draw的renderLayers（已包含字体 metrics）
        const setupRenderLayersArg =
          separatedResult &&
          separatedResult.setupRenderLayers &&
          separatedResult.setupRenderLayers.length > 0
            ? JSON.stringify(separatedResult.setupRenderLayers)
            : "null";

        console.log("[CodeExecutor] setupRenderLayersArg:", setupRenderLayersArg);

        const drawRenderLayersArg =
          separatedResult &&
          separatedResult.drawRenderLayers &&
          separatedResult.drawRenderLayers.length > 0
            ? JSON.stringify(separatedResult.drawRenderLayers)
            : "null";

        // Echo 相关：draw 中每帧 background 调用次数（供 AE 表达式区分是否“每帧都清屏”）
        const drawBackgroundCount =
          separatedResult &&
          typeof separatedResult.drawBackgroundCount === "number"
            ? separatedResult.drawBackgroundCount
            : 0;

        // Echo 相关：是否需要为 draw 挂载 Echo 效果（由前端分析综合判断）
        const drawNeedsEcho =
          separatedResult && separatedResult.drawNeedsEcho === true;

        // 检测是否有 setup 或 draw 函数（前端 AST 判断）
        const hasSetup = !!(parsed.setupCode && parsed.setupCode.length > 0);
        const hasDraw = !!(parsed.drawCode && parsed.drawCode.length > 0);
        const hasSetupOrDraw = hasSetup || hasDraw;

        // 传递依赖信息（用于按需加载库函数）
        const dependenciesArg =
          fullResult && fullResult.dependencies
            ? JSON.stringify(fullResult.dependencies)
            : "null";

        // 构建参数列表
        const widthArg = parsed.globalVars.width || 100;
        const heightArg = parsed.globalVars.height || 100;
        const frameRateArg = parsed.globalVars.frameRate || 30;

        const finalCode =
          "m.runParsed(" +
          drawArg +
          ", " +
          setupArg +
          ", " +
          globalArg +
          ", " +
          nameArg +
          ", " +
          widthArg +
          ", " +
          heightArg +
          ", " +
          frameRateArg +
          ", " +
          dependenciesArg +
          ", " + // deps
          setupRenderLayersArg +
          ", " + // setupRenderLayers
          drawRenderLayersArg +
          ", " + // drawRenderLayers
          hasSetupOrDraw +
          ", " +
          drawBackgroundCount +
          ", " +
          drawNeedsEcho +
          ", " +
          JSON.stringify(fontMetricsMap) +
          ", " +
          JSON.stringify(loadedImagesMap) +
          ")";

        const scriptToRun = `try { ${finalCode}; "SUCCESS"; } catch(e) { "ERROR: " + e.message + " at line " + e.line + " stack: " + e.stack; }`;

        // 重新加载 momentum.js 并执行
        loadMomentumLibrary()
          .then(() => {
            csInterface.evalScript(scriptToRun, (result) => {
              if (result && result.startsWith && result.startsWith("ERROR:")) {
                console.error("[CodeExecutor] AE script error:", result);
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
            });
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
