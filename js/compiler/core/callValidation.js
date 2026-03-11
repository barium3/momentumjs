window.compilerCallValidation = (function () {
  function getRegistry() {
    return window.compilerSymbols.getRegistry();
  }

  function getFunctionSignatures(name) {
    var registry = getRegistry();
    if (!registry || typeof registry.getFunctionSignatures !== "function") {
      return null;
    }
    return registry.getFunctionSignatures(name);
  }

  function getMethodSignatures(receiverType, methodName) {
    var registry = getRegistry();
    if (!registry || typeof registry.getMethodSignatures !== "function") {
      return null;
    }
    return registry.getMethodSignatures(receiverType, methodName);
  }

  function resolveBinding(scope, name) {
    return window.compilerSemantics.resolveBinding(scope, name);
  }

  function resolveCallTarget(scope, globals, name) {
    var binding = resolveBinding(scope, name);
    if (binding) {
      if (binding.callable === true) {
        return { kind: "local", binding: binding };
      }
      if (binding.callable === false) {
        return { kind: "noncallable", binding: binding };
      }
      return { kind: "dynamic", binding: binding };
    }

    var globalInfo = globals[name] || null;
    if (!globalInfo) {
      return { kind: "unknown" };
    }

    if (globalInfo.callable === true) {
      return { kind: "global", globalInfo: globalInfo };
    }

    return { kind: "noncallable", globalInfo: globalInfo };
  }

  function getEffectiveArguments(node) {
    var args = Array.isArray(node.arguments) ? node.arguments.slice() : [];
    if (!args.length) return args;

    var prefix =
      window.compilerCallsiteInstrumentationPass &&
      window.compilerCallsiteInstrumentationPass.callsitePrefix
        ? window.compilerCallsiteInstrumentationPass.callsitePrefix
        : "__mcs_";

    var first = args[0];
    if (
      first &&
      first.type === "Literal" &&
      typeof first.value === "string" &&
      first.value.indexOf(prefix) === 0
    ) {
      return args.slice(1);
    }

    return args;
  }

  function isArgumentCountMatch(count, signatureInfo) {
    return count >= signatureInfo.minArgs && count <= signatureInfo.maxArgs;
  }

  function filterMatchingSignatures(signatures, actualCount) {
    var matches = [];
    for (var i = 0; i < (signatures || []).length; i++) {
      if (isArgumentCountMatch(actualCount, signatures[i])) {
        matches.push(signatures[i]);
      }
    }
    return matches;
  }

  function buildCountErrorMessage(name, signatures, actualCount) {
    var expected = [];

    for (var i = 0; i < signatures.length; i++) {
      expected.push(formatSignatureCount(signatures[i]));
    }

    return (
      'Function "' +
      name +
      '" expects ' +
      expected.join(" or ") +
      ", got " +
      actualCount
    );
  }

  function buildMethodCountErrorMessage(receiverType, methodName, signatures, actualCount) {
    var expected = [];

    for (var i = 0; i < signatures.length; i++) {
      expected.push(formatSignatureCount(signatures[i]));
    }

    return (
      'Method "' +
      receiverType +
      "." +
      methodName +
      '" expects ' +
      expected.join(" or ") +
      ", got " +
      actualCount
    );
  }

  function formatSignatureCount(signatureInfo) {
    if (signatureInfo.minArgs === signatureInfo.maxArgs) {
      return signatureInfo.minArgs + " argument" + (signatureInfo.minArgs === 1 ? "" : "s");
    }

    if (signatureInfo.maxArgs === Infinity) {
      return signatureInfo.minArgs + "+ arguments";
    }

    return signatureInfo.minArgs + "-" + signatureInfo.maxArgs + " arguments";
  }

  function reportDiagnostic(code, message, node, diagnostics, reported) {
    var loc =
      node && node.loc && node.loc.start
        ? {
            line: node.loc.start.line,
            column: node.loc.start.column,
          }
        : null;
    var key =
      code +
      ":" +
      message +
      ":" +
      (loc ? loc.line : 0) +
      ":" +
      (loc ? loc.column : 0);

    if (reported[key]) {
      return;
    }
    reported[key] = true;

    diagnostics.push({
      code: code,
      message: message,
      severity: "error",
      phase: "semantic",
      fatal: true,
      loc: loc,
    });
  }

  return {
    buildCountErrorMessage: buildCountErrorMessage,
    buildMethodCountErrorMessage: buildMethodCountErrorMessage,
    filterMatchingSignatures: filterMatchingSignatures,
    getEffectiveArguments: getEffectiveArguments,
    getFunctionSignatures: getFunctionSignatures,
    getMethodSignatures: getMethodSignatures,
    reportDiagnostic: reportDiagnostic,
    resolveCallTarget: resolveCallTarget,
  };
})();
