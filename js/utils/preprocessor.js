/**
 * 代码预处理器
 * 在分析/执行前对用户代码进行预处理
 */
window.codePreprocessor = (function () {
  /**
   * 移除代码中的注释，避免 Acorn 解析时因注释中的 Unicode 字符报错
   * 正确处理字符串内的 // 和 /*（如 "http://"、'// not comment'）
   * @param {string} code - 原始代码
   * @returns {string} 移除注释后的代码
   */
  function stripComments(code) {
    let result = "";
    let i = 0;
    const len = code.length;
    let inSingle = false;
    let inMulti = false;
    let inStr = false;
    let strChar = "";

    while (i < len) {
      if (inMulti) {
        if (code[i] === "*" && code[i + 1] === "/") {
          inMulti = false;
          i += 2;
          result += " ";
          continue;
        }
        if (code[i] === "\n") result += "\n";
        i++;
        continue;
      }
      if (inSingle) {
        if (code[i] === "\n") {
          inSingle = false;
          result += "\n";
        }
        i++;
        continue;
      }
      if (inStr) {
        if (code[i] === "\\" && i + 1 < len) {
          result += code[i] + code[i + 1];
          i += 2;
          continue;
        }
        if (code[i] === strChar) inStr = false;
        result += code[i];
        i++;
        continue;
      }
      if (code[i] === "/" && code[i + 1] === "/") {
        inSingle = true;
        i += 2;
        continue;
      }
      if (code[i] === "/" && code[i + 1] === "*") {
        inMulti = true;
        i += 2;
        continue;
      }
      if (
        (code[i] === '"' || code[i] === "'" || code[i] === "`") &&
        (i === 0 || code[i - 1] !== "\\")
      ) {
        inStr = true;
        strChar = code[i];
        result += code[i];
        i++;
        continue;
      }
      result += code[i];
      i++;
    }
    return result;
  }

  return {
    stripComments: stripComments,
  };
})();
