// momentum-bridge.js - Web端到ExtendScript的桥接

// 创建全局momentum代理对象
window.m = new Proxy(
  {},
  {
    get(_, prop) {
      return (...args) =>
        new Promise((resolve, reject) => {
          // 将参数处理为可序列化格式
          const serializedArgs = args.map((arg) =>
            arg instanceof HTMLImageElement
              ? { type: "image", src: arg.src }
              : arg
          );

          // 构建函数调用
          const call = JSON.stringify({
            function: prop,
            arguments: serializedArgs,
          }).replace(/'/g, "\\'");

          // 执行ExtendScript调用
          new CSInterface().evalScript(
            `executeMomentumFunction('${call}')`,
            (result) => {
              try {
                if (result.startsWith("Error:")) {
                  reject(new Error(result.substring(6)));
                } else {
                  resolve(JSON.parse(result));
                }
              } catch (e) {
                reject(new Error(`解析结果失败: ${e.message}`));
              }
            }
          );
        });
    },
  }
);

// 自动从ExtendScript获取并暴露所有momentum方法
function exposeMomentumGlobally() {
  const csInterface = new CSInterface();

  // 从ExtendScript获取所有momentum方法名
  csInterface.evalScript(
    `(function() {
       var methodNames = [];
       for (var prop in m) {
         if (typeof m[prop] === 'function') {
           methodNames.push(prop);
         }
       }
       return JSON.stringify(methodNames);
     })()`,
    function (result) {
      try {
        // 解析获取到的方法名列表
        const methodsToExpose = JSON.parse(result);

        // 为每个方法创建全局函数
        methodsToExpose.forEach((methodName) => {
          if (window[methodName]) {
          }

          window[methodName] = function (...args) {
            // 调用m对象上的同名方法
            return window.m[methodName](...args);
          };
        });
      } catch (e) {
        console.error("暴露Momentum函数失败:", e);
      }
    }
  );
}

// 初始化momentum环境
function initMomentumEnvironment() {
  const csInterface = new CSInterface();
  return new Promise((resolve, reject) => {
    try {
      // 先确认ExtendScript环境正常
      csInterface.evalScript("typeof($) !== 'undefined'", function (result) {
        if (result !== "true") {
          reject(new Error("ExtendScript环境未就绪"));
          return;
        }

        // 初始化main.jsx
        const extensionPath = csInterface.getSystemPath(SystemPath.EXTENSION);
        csInterface.evalScript(
          `$.evalFile("${extensionPath.replace(/\\/g, "/")}/jsx/main.jsx")`,
          function (mainResult) {
            if (mainResult && mainResult.startsWith("Error:")) {
              reject(new Error("main.jsx加载失败: " + mainResult));
              return;
            }

            // 设置Momentum环境
            csInterface.evalScript(
              `setupUserCodeExecution()`,
              function (setupResult) {
                if (setupResult.startsWith("Error:")) {
                  reject(new Error(setupResult.substring(6)));
                } else {
                  // 初始化成功后，暴露全局方法
                  exposeMomentumGlobally();
                  resolve("Momentum环境初始化成功");
                }
              }
            );
          }
        );
      });
    } catch (error) {
      reject(new Error("初始化失败: " + error.message));
    }
  });
}

// 在文档加载完成后初始化momentum环境
document.addEventListener("DOMContentLoaded", function () {
  initMomentumEnvironment()
    .then(() => {})
    .catch((error) => console.error("初始化Momentum环境失败:", error));
});
