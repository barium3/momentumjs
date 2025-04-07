// Console output redirection module
window.consoleManager = (function () {
  function initConsole() {
    const consoleOutput = document.getElementById("console-output");

    const oldLog = console.log;
    console.log = function (...args) {
      consoleOutput.innerHTML += args.join(" ") + "<br>";
      oldLog.apply(console, args);
    };

    const oldError = console.error;
    console.error = function (...args) {
      consoleOutput.innerHTML +=
        '<span style="color: #ff1500;">Error: ' +
        args.join(" ") +
        "</span><br>";
      oldError.apply(console, args);
    };
  }

  function clearConsole() {
    const consoleOutput = document.getElementById("console-output");
    consoleOutput.innerHTML = "";
  }

  return {
    initConsole,
    clearConsole,
  };
})();
