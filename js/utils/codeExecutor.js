// Code execution module
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
        }
      );
    });
  }

  function executeUserCode(code) {
    return new Promise((resolve, reject) => {
      csInterface.evalScript(
        "typeof($.global.m) !== 'undefined'",
        (mExists) => {
          const runCode = () => {
            csInterface.evalScript(
              `try { ${code}; "SUCCESS"; } catch(e) { "ERROR: " + e.message; }`,
              (result) => {
                if (result.startsWith(ERROR_PREFIX)) {
                  reject(result.substring(ERROR_PREFIX.length + 1));
                } else {
                  resolve("Code executed successfully");
                }
              }
            );
          };

          if (mExists === "true") {
            runCode();
          } else {
            loadMomentumLibrary().then(runCode).catch(reject);
          }
        }
      );
    });
  }

  return {
    executeUserCode,
  };
})();
