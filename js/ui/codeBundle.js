window.momentumCodeBundle = (function () {
  "use strict";

  const CONTROLLER_SLOT_LIMIT = 16;
  const FIXED_CODE_CUE_APIS = {
    createCanvas: "canvas size",
    frameRate: "frame rate",
    duration: "duration",
  };

  function normalizeSource(input) {
    let source = String(input == null ? "" : input);
    if (source.charCodeAt(0) === 0xfeff) {
      source = source.slice(1);
    }
    return source.replace(/\r\n?/g, "\n").replace(/\n+$/g, "");
  }

  function hashString(input) {
    const source = String(input == null ? "" : input);
    let hash = 2166136261;

    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(16);
  }

  function buildTargetMetadata(source) {
    return window.compilerCodeCueSafety.buildTargetMetadata(source);
  }

  function collectFixedCodeCueCalls(compiled) {
    const signatures = Object.create(null);
    const names = Object.keys(FIXED_CODE_CUE_APIS);
    for (let index = 0; index < names.length; index += 1) {
      signatures[names[index]] = [];
    }

    const program = compiled && (compiled.rawAst || compiled.ast);
    if (!program) {
      return signatures;
    }

    const canonicalValue = window.compilerAst.canonicalValue;
    window.compilerAst.walk(program, (node) => {
      if (
        !node ||
        node.type !== "CallExpression" ||
        !node.callee ||
        node.callee.type !== "Identifier" ||
        !Object.prototype.hasOwnProperty.call(FIXED_CODE_CUE_APIS, node.callee.name)
      ) {
        return;
      }
      signatures[node.callee.name].push(canonicalValue(node.arguments || []));
    });
    return signatures;
  }

  function validateCodeCueContract(
    previousBundle,
    nextBundle,
    previousCompiled,
    nextCompiled,
  ) {
    const previousComp = previousBundle && previousBundle.comp || {};
    const nextComp = nextBundle && nextBundle.comp || {};
    const checks = [
      { key: "width", label: "canvas width", previous: previousComp.width, next: nextComp.width },
      { key: "height", label: "canvas height", previous: previousComp.height, next: nextComp.height },
      { key: "frameRate", label: "frame rate", previous: previousComp.frameRate, next: nextComp.frameRate },
      { key: "duration", label: "duration", previous: previousComp.duration, next: nextComp.duration },
    ];
    for (let index = 0; index < checks.length; index += 1) {
      const check = checks[index];
      const previousValue = Number(check.previous);
      const nextValue = Number(check.next);
      const tolerance = check.key === "width" || check.key === "height"
        ? 0
        : 1e-9 * Math.max(1, Math.abs(previousValue), Math.abs(nextValue));
      if (
        !isFinite(previousValue) ||
        !isFinite(nextValue) ||
        Math.abs(previousValue - nextValue) > tolerance
      ) {
        return {
          ok: false,
          code: `fixed-${check.key}-changed`,
          message:
            `Code keyframes cannot change the composition ${check.label}. ` +
            "Update it from the main Momentum editor instead.",
        };
      }
    }

    const previousCalls = collectFixedCodeCueCalls(previousCompiled);
    const nextCalls = collectFixedCodeCueCalls(nextCompiled);
    const fixedApiNames = Object.keys(FIXED_CODE_CUE_APIS);
    for (let index = 0; index < fixedApiNames.length; index += 1) {
      const name = fixedApiNames[index];
      if (JSON.stringify(previousCalls[name]) !== JSON.stringify(nextCalls[name])) {
        return {
          ok: false,
          code: `fixed-${name}-changed`,
          message:
            `Code keyframes cannot add, remove, or change ${name}(). ` +
            "Update it from the main Momentum editor instead.",
        };
      }
    }

    if (previousCompiled || nextCompiled) {
      const previousControllerContract = previousCompiled && previousCompiled.controllers;
      const nextControllerContract = nextCompiled && nextCompiled.controllers;
      if (
        !previousControllerContract ||
        !nextControllerContract ||
        previousControllerContract.fingerprint !== nextControllerContract.fingerprint
      ) {
        return {
          ok: false,
          code: "controller-contract-changed",
          message: "不支持二次修改控件",
        };
      }
    }
    return { ok: true, code: "", message: "" };
  }

  function mergeControllerConfigs(staticConfigs, runtimeConfigs) {
    const fallbackConfigs = Array.isArray(staticConfigs) ? staticConfigs : [];
    if (!Array.isArray(runtimeConfigs) || runtimeConfigs.length === 0) {
      return fallbackConfigs;
    }

    const mergedConfigs = [];
    const usedStaticIndices = {};
    const staticById = {};
    const staticByLabel = {};
    const staticTypeBuckets = {};
    const runtimeTypeCounts = {};

    function addIndexBucket(target, key, index) {
      if (!target[key]) {
        target[key] = [];
      }
      target[key].push(index);
    }

    function claimFirstUnused(bucket) {
      if (!Array.isArray(bucket)) {
        return -1;
      }
      for (let index = 0; index < bucket.length; index += 1) {
        const candidate = bucket[index];
        if (!usedStaticIndices[candidate]) {
          usedStaticIndices[candidate] = true;
          return candidate;
        }
      }
      return -1;
    }

    fallbackConfigs.forEach((config, index) => {
      if (!config || typeof config !== "object") {
        return;
      }
      if (config.id) {
        addIndexBucket(staticById, String(config.id), index);
      }
      if (config.type && config.label) {
        addIndexBucket(staticByLabel, `${config.type}::${config.label}`, index);
      }
      if (config.type) {
        addIndexBucket(staticTypeBuckets, String(config.type), index);
      }
    });

    for (let index = 0; index < runtimeConfigs.length; index += 1) {
      const runtimeConfig = runtimeConfigs[index];
      if (!runtimeConfig || typeof runtimeConfig !== "object") {
        continue;
      }

      const nextConfig = { ...runtimeConfig };
      const typeKey = String(nextConfig.type || "");
      const typeOrdinal = runtimeTypeCounts[typeKey] || 0;
      runtimeTypeCounts[typeKey] = typeOrdinal + 1;

      let staticIndex = -1;
      if (nextConfig.id) {
        staticIndex = claimFirstUnused(staticById[String(nextConfig.id)]);
      }
      if (staticIndex < 0 && nextConfig.label && typeKey) {
        staticIndex = claimFirstUnused(staticByLabel[`${typeKey}::${nextConfig.label}`]);
      }
      if (staticIndex < 0 && typeKey) {
        const typeBucket = staticTypeBuckets[typeKey];
        if (Array.isArray(typeBucket) && typeOrdinal < typeBucket.length) {
          const candidate = typeBucket[typeOrdinal];
          if (!usedStaticIndices[candidate]) {
            usedStaticIndices[candidate] = true;
            staticIndex = candidate;
          } else {
            staticIndex = claimFirstUnused(typeBucket);
          }
        }
      }

      const staticConfig = staticIndex >= 0 && staticIndex < fallbackConfigs.length
        ? fallbackConfigs[staticIndex]
        : null;
      if (staticConfig) {
        if (staticConfig.id && !nextConfig.id) {
          nextConfig.id = staticConfig.id;
        }
        if (staticConfig.label && !nextConfig.label) {
          nextConfig.label = staticConfig.label;
        }
      }
      mergedConfigs.push(nextConfig);
    }

    return mergedConfigs.length > 0 ? mergedConfigs : fallbackConfigs;
  }

  function stableSerialize(value) {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map(stableSerialize).join(",")}]`;
    }
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) =>
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`
    ).join(",")}}`;
  }

  function cloneControllerContract(controller) {
    const source = controller && typeof controller === "object" ? controller : {};
    let cloned = {};
    try {
      cloned = JSON.parse(JSON.stringify(source));
    } catch (_cloneError) {
      cloned = {};
    }
    cloned.configs = Array.isArray(cloned.configs)
      ? cloned.configs.slice(0, CONTROLLER_SLOT_LIMIT)
      : [];
    if (!cloned.hash) {
      cloned.hash = cloned.configs.length > 0
        ? hashString(stableSerialize(cloned.configs))
        : "none";
    }
    return cloned;
  }

  function buildBundleWithController(
    code,
    compiled,
    fileName,
    controller,
    runtimeMetadata,
  ) {
    const source = normalizeSource(code);
    const sourceHash = hashString(source);
    const comp = window.momentumPluginBitmap.getCompConfig(compiled, fileName);
    const frozenController = cloneControllerContract(controller);
    const metadata = runtimeMetadata && typeof runtimeMetadata === "object"
      ? runtimeMetadata
      : {};

    const bundle = {
      bundleVersion: 1,
      runtimeTarget: window.momentumPluginBitmap.RUNTIME_TARGET,
      sourcePath: String(metadata.sourcePath || "sketch.js"),
      sourceHash,
      momentumCodeCue: buildTargetMetadata(source),
      pixelDensity: Math.max(
        1,
        Number(compiled && compiled.config && compiled.config.pixelDensity) ||
          Number(window.devicePixelRatio) ||
          1,
      ),
      comp,
      controller: frozenController,
      cache: {
        recentFrameBudgetMB: 512,
        checkpointInterval: 12,
      },
    };
    if (metadata.debugTracePath) {
      bundle.debugTracePath = String(metadata.debugTracePath);
    }
    return bundle;
  }

  function buildRuntimeBundle(code, compiled, fileName, runtimeControllerConfigs) {
    const source = normalizeSource(code);
    const staticControllerConfigs = compiled &&
      compiled.controllers &&
      Array.isArray(compiled.controllers.configs)
      ? compiled.controllers.configs
      : [];
    const controllerConfigs = mergeControllerConfigs(
      staticControllerConfigs,
      runtimeControllerConfigs,
    ).slice(0, CONTROLLER_SLOT_LIMIT);
    const controllerHash = controllerConfigs.length > 0
      ? hashString(stableSerialize(controllerConfigs))
      : "none";
    return buildBundleWithController(source, compiled, fileName, {
      hash: controllerHash,
      configs: controllerConfigs,
    });
  }

  function buildCodeCueBundle(
    code,
    compiled,
    fileName,
    baseController,
    runtimeMetadata,
  ) {
    return buildBundleWithController(
      code,
      compiled,
      fileName,
      baseController,
      runtimeMetadata,
    );
  }

  function getPrimaryDiagnostic(result) {
    const diagnostics = result && Array.isArray(result.diagnostics)
      ? result.diagnostics
      : [];
    return diagnostics.find((diagnostic) => {
      return diagnostic && diagnostic.severity !== "warning";
    }) || null;
  }

  function hasFatalDiagnostics(result) {
    if (!result || !Array.isArray(result.diagnostics)) {
      return false;
    }
    return result.diagnostics.some((diagnostic) => {
      return diagnostic &&
        diagnostic.fatal !== false &&
        diagnostic.severity !== "warning";
    });
  }

  function formatDiagnostic(diagnostic) {
    if (!diagnostic) {
      return "Unknown compiler error";
    }

    const loc = diagnostic.loc && typeof diagnostic.loc.line === "number"
      ? ` (${diagnostic.loc.line}:${(diagnostic.loc.column || 0) + 1})`
      : "";
    const phase = diagnostic.phase ? `[${diagnostic.phase}] ` : "";
    return `${phase}${diagnostic.message || "Unknown compiler error"}${loc}`;
  }

  return {
    buildCodeCueBundle,
    buildRuntimeBundle,
    formatDiagnostic,
    getPrimaryDiagnostic,
    hasFatalDiagnostics,
    normalizeSource,
    validateCodeCueContract,
  };
})();
