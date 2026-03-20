window.compilerPipeline = (function () {
  function compile(code) {
    var ctx = window.compilerContext.create(code);

    if (!parseSource(ctx)) {
      return finalize(ctx);
    }

    collectPreTransformData(ctx);
    instrumentSource(ctx);

    if (!parseTransformedSource(ctx)) {
      return finalize(ctx);
    }

    collectEntries(ctx);
    buildOutput(ctx);
    collectCompilerData(ctx);
    collectDiagnostics(ctx);
    buildAnalysisArtifacts(ctx);

    return finalize(ctx);
  }

  function diagnose(code) {
    return compile(code);
  }

  function parseSource(ctx) {
    try {
      ctx.ast = window.compilerAst.parse(ctx.source);
      window.compilerAst.addParentLinks(ctx.ast, null);
      return true;
    } catch (error) {
      window.compilerContext.addDiagnostic(
        ctx,
        window.compilerContext.fromParseError(error, "parse"),
      );
      return false;
    }
  }

  function collectPreTransformData(ctx) {
    ctx.assets = window.compilerAssetCollectionPass.collect(ctx.ast);
  }

  function instrumentSource(ctx) {
    ctx.transformedSource = window.compilerCallsiteInstrumentationPass.instrument(
      ctx.source,
      ctx.ast,
    );
  }

  function parseTransformedSource(ctx) {
    try {
      ctx.transformedAst =
        ctx.transformedSource === ctx.source
          ? ctx.ast
          : window.compilerAst.parse(ctx.transformedSource);

      if (ctx.transformedAst !== ctx.ast) {
        window.compilerAst.addParentLinks(ctx.transformedAst, null);
      }

      return true;
    } catch (error) {
      window.compilerContext.addDiagnostic(
        ctx,
        window.compilerContext.fromParseError(error, "transform"),
      );
      return false;
    }
  }

  function collectEntries(ctx) {
    ctx.entries = window.compilerEntryPointsPass.collect(
      ctx.transformedAst,
      ctx.transformedSource,
    );
  }

  function buildOutput(ctx) {
    var entryRanges = [
      getEntryRange(ctx.entries && ctx.entries.draw),
      getEntryRange(ctx.entries && ctx.entries.setup),
      getEntryRange(ctx.entries && ctx.entries.preload),
    ];

    ctx.output = {
      drawCode: getEntryBody(ctx.entries && ctx.entries.draw),
      setupCode: getEntryBody(ctx.entries && ctx.entries.setup),
      drawFullCode: getEntryFull(ctx.entries && ctx.entries.draw),
      setupFullCode: getEntryFull(ctx.entries && ctx.entries.setup),
      preloadFullCode: getEntryFull(ctx.entries && ctx.entries.preload),
      globalCode: window.compilerAst.removeRanges(ctx.transformedSource, entryRanges).trim(),
    };
  }

  function collectCompilerData(ctx) {
    ctx.globals = window.compilerGlobalBindingsPass.analyze(ctx.transformedAst);
    ctx.config = window.compilerEnvironmentConfigPass.analyze(
      ctx.transformedAst,
      ctx.entries,
      ctx.globals,
    );
    ctx.dependencies = window.compilerDependencyAnalysisPass.analyze(ctx.transformedAst);
  }

  function collectDiagnostics(ctx) {
    addPassDiagnostics(
      ctx,
      runPass(window.compilerUndeclaredIdentifiersPass, "analyze", [ctx.transformedAst]),
    );
    addPassDiagnostics(
      ctx,
      runPass(window.compilerAssetValidationPass, "analyze", [ctx.ast]),
    );
    addPassDiagnostics(
      ctx,
      runPass(window.compilerCallValidationPass, "analyze", [ctx.ast]),
    );
  }

  function buildAnalysisArtifacts(ctx) {
    ctx.analysis = Object.assign(
      {},
      window.compilerBackgroundAnalysisPass.analyze(ctx.entries.draw),
      window.compilerRuntimeAnalysisPass.analyze(ctx.transformedSource),
    );
    ctx.ae = window.compilerReservedDataPass.rewriteCodeSet(ctx.output);
  }

  function runPass(target, methodName, args) {
    if (!target || typeof target[methodName] !== "function") {
      return [];
    }
    return target[methodName].apply(target, args || []);
  }

  function addPassDiagnostics(ctx, diagnostics) {
    if (!ctx || !Array.isArray(diagnostics)) return;

    for (var i = 0; i < diagnostics.length; i++) {
      window.compilerContext.addDiagnostic(ctx, diagnostics[i]);
    }
  }

  function getEntryRange(entry) {
    return entry ? { start: entry.start, end: entry.end } : null;
  }

  function getEntryBody(entry) {
    return entry ? entry.body || "" : "";
  }

  function getEntryFull(entry) {
    return entry ? entry.full || "" : "";
  }

  function finalize(ctx) {
    return {
      ok: !window.compilerContext.hasFatalDiagnostics(ctx),
      diagnostics: ctx.diagnostics.slice(),
      source: ctx.source,
      transformedSource: ctx.transformedSource,
      rawAst: ctx.ast,
      ast: ctx.transformedAst || ctx.ast,
      code: ctx.transformedSource,
      entries: {
        draw: sanitizeEntry(ctx.entries && ctx.entries.draw),
        setup: sanitizeEntry(ctx.entries && ctx.entries.setup),
        preload: sanitizeEntry(ctx.entries && ctx.entries.preload),
      },
      output: ctx.output || createEmptyOutput(),
      globals: ctx.globals || createEmptyGlobals(),
      config: ctx.config || createEmptyConfig(),
      assets: ctx.assets || createEmptyAssets(),
      dependencies: ctx.dependencies || null,
      analysis: ctx.analysis || createEmptyAnalysis(ctx.transformedSource),
      ae: ctx.ae,
    };
  }

  function createEmptyOutput() {
    return {
      drawCode: "",
      setupCode: "",
      drawFullCode: "",
      setupFullCode: "",
      preloadFullCode: "",
      globalCode: "",
    };
  }

  function createEmptyGlobals() {
    return {
      numeric: {},
      mutableNames: [],
    };
  }

  function createEmptyConfig() {
    return {
      width: null,
      height: null,
      frameRate: null,
      duration: null,
    };
  }

  function createEmptyAssets() {
    return {
      images: [],
      fonts: [],
      tables: [],
      json: [],
      hasText: false,
    };
  }

  function createEmptyAnalysis(runtimeCode) {
    return {
      backgroundInDrawCondition: false,
      runtimeCode: runtimeCode,
      runtimeCodePrepared: false,
    };
  }

  function sanitizeEntry(entry) {
    if (!entry) return null;

    return {
      kind: entry.kind,
      name: entry.name,
      body: entry.body,
      full: entry.full,
      start: entry.start,
      end: entry.end,
    };
  }

  return {
    compile: compile,
    diagnose: diagnose,
  };
})();

window.sketchCompiler = window.compilerPipeline;
