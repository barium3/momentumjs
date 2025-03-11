// momentum-bridge.js - Web端到ExtendScript的桥接

// 创建全局momentum代理对象
window.m = new Proxy(
  {},
  {
    get(_, prop) {
      return (...args) =>
        new Promise((resolve, reject) => {
          // 序列化参数
          const serializedArgs = args.map((arg) =>
            arg instanceof HTMLImageElement
              ? { type: "image", src: arg.src }
              : arg
          );

          // 构建函数调用并发送到ExtendScript环境
          const call = JSON.stringify({
            function: prop,
            arguments: serializedArgs,
          }).replace(/'/g, "\\'");

          // 执行ExtendScript调用
          new CSInterface().evalScript(
            `executeMomentumFunction('${call}')`,
            (result) => {
              // 处理ExtendScript返回的结果
              if (
                result === undefined ||
                result === "undefined" ||
                result === ""
              ) {
                // 如果返回undefined或空字符串，视为成功但无返回值
                resolve(null);
                return;
              }

              try {
                // 尝试解析JSON结果
                const parsedResult = JSON.parse(result);

                // 智能识别表达式并自动格式化
                if (typeof parsedResult === "string") {
                  // 检查字符串是否为AE表达式
                  if (isExpressionString(parsedResult)) {
                    resolve(formatExpression(parsedResult));
                  } else {
                    // 不是表达式字符串
                    resolve(parsedResult);
                  }
                } else if (
                  Array.isArray(parsedResult) &&
                  parsedResult.some(
                    (item) =>
                      typeof item === "string" && isExpressionString(item)
                  )
                ) {
                  // 如果数组中至少有一个元素是表达式字符串，处理整个数组
                  resolve(
                    parsedResult.map((item) =>
                      typeof item === "string" && isExpressionString(item)
                        ? formatExpression(item)
                        : item
                    )
                  );
                } else {
                  // 其他类型结果保持不变
                  resolve(parsedResult);
                }
              } catch (error) {
                // 如果不是有效JSON但以"Error:"开头，则视为错误
                if (typeof result === "string" && result.startsWith("Error:")) {
                  reject(new Error(result.substring(6)));
                } else {
                  // 如果不是有效JSON但不是错误格式，则返回原始字符串
                  resolve(result);
                }
              }
            }
          );
        });
    },
  }
);

// 修改exposeMomentumGlobally函数，自动添加await并处理表达式

function exposeMomentumGlobally() {
  const csInterface = new CSInterface();

  // 从ExtendScript获取所有momentum方法名
  csInterface.evalScript(
    `(function() {
       var methodNames = [];
       var controllerMethods = []; // 存储控制器相关方法
       
       // 检查所有方法
       for (var prop in m) {
         if (typeof m[prop] === 'function') {
           methodNames.push(prop);
           // 识别控制器方法
           if (prop.indexOf('Controller') > -1) {
             controllerMethods.push(prop);
           }
         }
       }
       
       return JSON.stringify({
         methods: methodNames,
         controllers: controllerMethods
       });
     })()`,
    function (result) {
      try {
        // 解析获取到的方法信息
        const data = JSON.parse(result);
        const methodsToExpose = data.methods;
        const controllerMethods = data.controllers || [];

        // 记录暴露的方法名，用于自动添加await
        window.exposedMomentumMethods = methodsToExpose;

        // 为每个方法创建全局函数
        methodsToExpose.forEach((methodName) => {
          // 创建async包装函数
          window[methodName] = async function (...args) {
            // 调用m对象上的同名方法并等待结果
            const result = await window.m[methodName](...args);
            return result;
          };
        });

        // 静默成功，不再打印消息
      } catch (e) {
        console.error("暴露Momentum函数失败:", e);
      }
    }
  );
}

// 初始化momentum环境和桥接
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
                  // 移除初始化成功的日志
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
    .then(() => {
      // 移除成功信息的打印
    })
    .catch((error) => console.error("初始化Momentum环境失败:", error));
});

/**
 * 智能检测字符串是否为AE表达式 - 基于结构特征自动识别
 * @param {string} str - 要检查的字符串
 * @returns {boolean} - 是否为表达式
 */
function isExpressionString(str) {
  if (typeof str !== "string") return false;
  if (str.length < 2) return false; // 仅排除极短字符串

  // 1. 直接识别AE常量和特殊表达式

  // 直接匹配常量表达式
  if (window.aeConstants.includes(str)) return true;

  // 2. 结构特征检测 - 更通用的方法

  // 检查是否含有AE表达式常见的引用模式（放宽匹配范围）
  const hasAEReferences =
    /comp\s*\(|layer\s*\(|effect\s*\(|thisComp|thisLayer|thisProperty|time\b|value\b|width\b|height\b/.test(
      str
    );

  // 检查是否是带括号的表达式调用结构，但排除普通文本
  const hasFunctionCall =
    /\w+\s*\([^)]*\)/.test(str) && !/^["'][^"']*["']$/.test(str);

  // 检查是否有表达式属性访问
  const hasPropertyAccess = /\.\w+\s*\(|\)\s*\.\w+|\.\w+\b/.test(str);

  // 检查是否有数组索引访问
  const hasArrayAccess = /\[\d+\]/.test(str);

  // 检查是否有表达式数学运算
  const hasMathExpr =
    /[+\-*\/]\s*\(|\)\s*[+\-*\/]|\(\s*[^)]+\s*[+\-*\/]\s*[^)]+\s*\)/.test(str);

  // 检查是否包含表达式创建函数
  const hasCreationFunction = /create\w+\s*\(/.test(str);

  // 3. 排除明显不是表达式的情况

  // 纯数字不是表达式
  const isJustNumber = /^-?\d+(\.\d+)?$/.test(str);

  // 简单的普通英文短句不是表达式（但允许thisComp等特殊词）
  const isSimpleSentence =
    /^[A-Za-z\s,.!?]+$/.test(str) &&
    !hasFunctionCall &&
    !hasAEReferences &&
    !/this\w+/.test(str);

  // 如果同时满足多个表达式特征，或满足单个强特征，则认为是表达式
  return (
    !isJustNumber &&
    !isSimpleSentence &&
    (hasAEReferences ||
      hasCreationFunction ||
      (hasFunctionCall &&
        (hasPropertyAccess || hasArrayAccess || hasMathExpr)) ||
      (hasArrayAccess && hasMathExpr) ||
      hasPropertyAccess) // 添加简单属性访问作为表达式标志
  );
}
