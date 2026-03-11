window.compilerContext = (function () {
  function create(source) {
    return {
      source: String(source || ""),
      transformedSource: String(source || ""),
      ast: null,
      transformedAst: null,
      diagnostics: [],
      entries: null,
      output: null,
      globals: null,
      config: null,
      assets: null,
      analysis: null,
      ae: null,
      metadata: {},
      ok: true,
    };
  }

  function createDiagnostic(input) {
    var info = input || {};
    return {
      code: info.code || "COMPILER_UNKNOWN",
      message: info.message || "Unknown compiler error",
      severity: info.severity || "error",
      phase: info.phase || "compile",
      fatal: info.fatal !== false,
      loc: info.loc || null,
    };
  }

  function addDiagnostic(ctx, diagnostic) {
    if (!ctx || !diagnostic) return;
    ctx.diagnostics.push(createDiagnostic(diagnostic));
    if (diagnostic.fatal !== false && diagnostic.severity !== "warning") {
      ctx.ok = false;
    }
  }

  function hasFatalDiagnostics(ctx) {
    if (!ctx || !Array.isArray(ctx.diagnostics)) return false;
    for (var i = 0; i < ctx.diagnostics.length; i++) {
      var diagnostic = ctx.diagnostics[i];
      if (diagnostic && diagnostic.fatal !== false && diagnostic.severity !== "warning") {
        return true;
      }
    }
    return false;
  }

  function fromParseError(error, phase) {
    if (!error) {
      return createDiagnostic({
        code: "COMPILER_PARSE_ERROR",
        message: "Parse failed",
        phase: phase || "parse",
      });
    }

    return createDiagnostic({
      code: "COMPILER_PARSE_ERROR",
      message: error.message || "Parse failed",
      phase: phase || "parse",
      loc: error.loc
        ? {
            line: error.loc.line,
            column: error.loc.column,
          }
        : null,
    });
  }

  return {
    addDiagnostic: addDiagnostic,
    create: create,
    createDiagnostic: createDiagnostic,
    fromParseError: fromParseError,
    hasFatalDiagnostics: hasFatalDiagnostics,
  };
})();
