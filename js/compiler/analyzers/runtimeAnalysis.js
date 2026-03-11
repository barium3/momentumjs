window.compilerRuntimeAnalysisPass = (function () {
  function analyze(code) {
    var source = String(code || "");
    var runtimeCode = source;
    var prepared = false;

    if (!source.trim()) {
      return {
        runtimeCode: runtimeCode,
        runtimeCodePrepared: false,
      };
    }

    var ConditionalCtor =
      typeof CompilerConditionAnalysis !== "undefined"
        ? CompilerConditionAnalysis
        : typeof ConditionalAnalyzer !== "undefined"
          ? ConditionalAnalyzer
          : null;
    if (ConditionalCtor) {
      try {
        var conditionalAnalyzer = new ConditionalCtor();
        var conditions = conditionalAnalyzer.findBranchesWithRender(source);
        if (
          conditions &&
          conditions.length > 0 &&
          typeof conditionalAnalyzer.convertElseToIndependentIf === "function"
        ) {
          runtimeCode = conditionalAnalyzer.convertElseToIndependentIf(
            source,
            conditions,
          );
          prepared = true;
        }
      } catch (error) {
        runtimeCode = source;
      }
    }

    var LoopCtor =
      typeof CompilerLoopAnalysis !== "undefined"
        ? CompilerLoopAnalysis
        : typeof LoopAnalyzer !== "undefined"
          ? LoopAnalyzer
          : null;
    if (LoopCtor) {
      try {
        var loopAnalyzer = new LoopCtor();
        var shouldAnalyze =
          typeof shouldUseLoopAnalyzer === "function"
            ? shouldUseLoopAnalyzer(runtimeCode)
            : true;
        if (shouldAnalyze) {
          runtimeCode = loopAnalyzer.buildMaxCode(runtimeCode);
          prepared = true;
        }
      } catch (loopError) {
        runtimeCode = runtimeCode;
      }
    }

    return {
      runtimeCode: runtimeCode,
      runtimeCodePrepared: prepared,
    };
  }

  return {
    analyze: analyze,
  };
})();
