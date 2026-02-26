// Code execution module - Processing style only
window.codeExecutor = (function () {
  const ERROR_PREFIX = "ERROR:";

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
      console.log("[CodeExecutor] 依赖分析结果:", result);
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
      console.log("[CodeExecutor] 完整分析结果:", result);
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
      const result = await analyzer.analyzeSetupAndDraw(setupCode, drawCode, globalCode);
      console.log("[CodeExecutor] 分别分析结果:", result);
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
            parsed.globalCode || ""
          );
        } catch (e) {
          console.warn("[CodeExecutor] 分别分析失败，使用默认结果");
          separatedResult = null;
        }

        // 构建调用参数
        const drawArg = JSON.stringify(parsed.drawCode || "");
        const setupArg = JSON.stringify(parsed.setupCode || "");
        const globalArg = JSON.stringify(parsed.globalCode || "");
        const nameArg = JSON.stringify(compName);

        // 分别传递setup和draw的renderLayers
        const setupRenderLayersArg =
          separatedResult &&
          separatedResult.setupRenderLayers &&
          separatedResult.setupRenderLayers.length > 0
            ? JSON.stringify(separatedResult.setupRenderLayers)
            : "null";

        const drawRenderLayersArg =
          separatedResult &&
          separatedResult.drawRenderLayers &&
          separatedResult.drawRenderLayers.length > 0
            ? JSON.stringify(separatedResult.drawRenderLayers)
            : "null";

        // 是否在 draw 中使用了带 alpha 参数的 background（由运行时统计）
        const drawBackgroundHasAlpha =
          separatedResult && separatedResult.drawBackgroundHasAlpha === true;

        // 调试日志
        console.log(`[CodeExecutor] setupRenderLayersArg:`, setupRenderLayersArg);
        console.log(`[CodeExecutor] drawRenderLayersArg:`, drawRenderLayersArg);

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
          drawBackgroundHasAlpha +
          ")";

        const scriptToRun = `try { ${finalCode}; "SUCCESS"; } catch(e) { "ERROR: " + e.message + " at line " + e.line; }`;

        // 重新加载 momentum.js 并执行
        loadMomentumLibrary()
          .then(() => {
            csInterface.evalScript(scriptToRun, (result) => {
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
