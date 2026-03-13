/**
 * Code preprocessor used before analysis and execution.
 */
window.codePreprocessor = (function () {
  /**
   * Strip comments while preserving string literals such as "http://" or '// not comment'.
   * This keeps Acorn away from stray Unicode characters inside comments.
   * @param {string} code - Raw source code.
   * @returns {string} Source code with comments removed.
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
