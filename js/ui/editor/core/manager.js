window.momentumEditorManagerFactory = (function () {
  const INDENT_CORRECTION_TRIGGER_CHARS = {
    ";": true,
    "}": true,
  };
  const DEFAULT_INDENT_SIZE = 2;
  const RENDER_MODE_STORAGE_KEY = "momentum.renderMode";
  const DEFAULT_RENDER_MODE = "vector";
  const BITMAP_CONTROLLER_SLOT_LIMIT = 16;
  const BITMAP_CONTROLLER_CALLSITE_PREFIX = "__mcc_";

  function hashString(input) {
    const source = String(input == null ? "" : input);
    let hash = 2166136261;

    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(16);
  }

  function normalizeBackgroundMode(compiled, code) {
    if (compiled && compiled.analysis && compiled.analysis.backgroundMode) {
      return compiled.analysis.backgroundMode;
    }

    if (!code) {
      return "unknown";
    }

    const match = code.match(/background\s*\(([^)]*)\)/);
    if (!match) {
      return "transparent-likely";
    }

    const args = match[1]
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    if (args.length >= 2) {
      const alpha = Number(args[args.length - 1]);
      if (Number.isFinite(alpha) && alpha < 255) {
        return "accumulation-likely";
      }
    }

    return "opaque-likely";
  }

  function inferStateProfile(compiled, code) {
    return "stateful-timeline-js";
  }

  function getBitmapCompConfig(compiled, fileName) {
    return window.momentumPluginBitmap.getCompConfig(compiled, fileName);
  }

  function literalValueFromNode(node) {
    if (!node) {
      return undefined;
    }

    if (node.type === "Literal") {
      return node.value;
    }

    if (node.type === "Identifier") {
      if (node.name === "undefined") return undefined;
      if (node.name === "true") return true;
      if (node.name === "false") return false;
      return undefined;
    }

    if (node.type === "UnaryExpression") {
      const value = literalValueFromNode(node.argument);
      if (typeof value !== "number") {
        return undefined;
      }
      if (node.operator === "+") return +value;
      if (node.operator === "-") return -value;
    }

    if (node.type === "ArrayExpression") {
      const values = [];
      for (let i = 0; i < node.elements.length; i += 1) {
        values.push(literalValueFromNode(node.elements[i]));
      }
      return values;
    }

    return undefined;
  }

  function readNumberArg(args, index, fallbackValue) {
    const value = literalValueFromNode(args[index]);
    return typeof value === "number" && isFinite(value) ? value : fallbackValue;
  }

  function readStringArg(args, index, fallbackValue) {
    const value = literalValueFromNode(args[index]);
    return typeof value === "string" ? value : fallbackValue;
  }

  function readBooleanArg(args, index, fallbackValue) {
    const value = literalValueFromNode(args[index]);
    return typeof value === "boolean" ? value : fallbackValue;
  }

  function readArrayArg(args, index, fallbackValue) {
    const value = literalValueFromNode(args[index]);
    return Array.isArray(value) ? value : fallbackValue;
  }

  function buildColorControllerConfig(args) {
    if (!args || args.length <= 0) {
      return { type: "color", value: [255, 255, 255, 255] };
    }

    if (args.length === 1) {
      const singleValue = literalValueFromNode(args[0]);
      if (typeof singleValue === "string") {
        return { type: "color", value: singleValue };
      }
      if (Array.isArray(singleValue)) {
        return { type: "color", value: singleValue };
      }
    }

    return {
      type: "color",
      value: [
        readNumberArg(args, 0, 255),
        readNumberArg(args, 1, 255),
        readNumberArg(args, 2, 255),
        readNumberArg(args, 3, 255),
      ],
    };
  }

  function buildBitmapControllerCallsiteId(node, calleeName) {
    const safeName = String(calleeName || "controller").replace(/[^\w$]/g, "_");
    const loc =
      node &&
      node.loc &&
      node.loc.start &&
      typeof node.loc.start.line === "number" &&
      typeof node.loc.start.column === "number"
        ? node.loc.start
        : null;

    if (loc) {
      return `${BITMAP_CONTROLLER_CALLSITE_PREFIX}${safeName}_${loc.line}_${loc.column}`;
    }

    return `${BITMAP_CONTROLLER_CALLSITE_PREFIX}${safeName}`;
  }

  function parseSelectControllerChain(expression) {
    let current = expression;
    const steps = [];

    while (
      current &&
      current.type === "CallExpression" &&
      current.callee &&
      current.callee.type === "MemberExpression" &&
      !current.callee.computed &&
      current.callee.property &&
      current.callee.property.type === "Identifier"
    ) {
      steps.unshift({
        method: current.callee.property.name,
        args: current.arguments || [],
      });
      current = current.callee.object;
    }

    if (
      !current ||
      current.type !== "CallExpression" ||
      !current.callee ||
      current.callee.type !== "Identifier" ||
      current.callee.name !== "createSelect"
    ) {
      return null;
    }

    const config = {
      type: "select",
      options: [],
      value: 0,
    };

    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      if (step.method === "option") {
        const label = readStringArg(step.args, 0, "");
        const explicitValue = literalValueFromNode(step.args[1]);
        config.options.push({
          label,
          value: explicitValue !== undefined ? explicitValue : label,
        });
        continue;
      }
      if (step.method === "selected") {
        const selectedValue = literalValueFromNode(step.args[0]);
        if (typeof selectedValue === "number" && isFinite(selectedValue)) {
          config.value = Math.max(0, Math.floor(selectedValue));
        } else {
          for (let optionIndex = 0; optionIndex < config.options.length; optionIndex += 1) {
            const option = config.options[optionIndex];
            if (option && (option.value === selectedValue || option.label === selectedValue)) {
              config.value = optionIndex;
              break;
            }
          }
        }
      }
    }

    return {
      config,
      callNode: current,
      factoryName: "createSelect",
    };
  }

  function extractBitmapControllerConfigs(source) {
    if (typeof acorn === "undefined" || !source) {
      return [];
    }

    let program = null;
    try {
      program = acorn.parse(String(source), { ecmaVersion: 2020, sourceType: "script" });
    } catch (_parseError) {
      return [];
    }

    const configs = [];

    function pushConfig(config, sourceNode, factoryName) {
      if (!config) {
        return;
      }
      const nextConfig = { ...config };
      const typeKey = String(nextConfig.type || "controller");

      if (!nextConfig.id) {
        nextConfig.id = buildBitmapControllerCallsiteId(
          sourceNode,
          factoryName || typeKey,
        );
      }
      configs.push(nextConfig);
    }

    function describeControllerBinding(node) {
      if (!node || typeof node !== "object") {
        return "";
      }
      if (node.type === "Identifier") {
        return node.name || "";
      }
      if (
        node.type === "MemberExpression" &&
        !node.computed &&
        node.property &&
        node.property.type === "Identifier"
      ) {
        const objectLabel = describeControllerBinding(node.object);
        return objectLabel ? `${objectLabel}.${node.property.name}` : node.property.name;
      }
      return "";
    }

    function parseDirectControllerCall(expression) {
      if (!expression || expression.type !== "CallExpression" || !expression.callee) {
        return null;
      }
      if (expression.callee.type !== "Identifier") {
        return null;
      }

      const args = expression.arguments || [];
      switch (expression.callee.name) {
        case "createSlider":
          return {
            config: {
              type: "slider",
              min: readNumberArg(args, 0, 0),
              max: readNumberArg(args, 1, 100),
              value: readNumberArg(args, 2, readNumberArg(args, 0, 0)),
              step: readNumberArg(args, 3, 0),
            },
            callNode: expression,
            factoryName: expression.callee.name,
          };
        case "createAngle":
          return {
            config: {
              type: "angle",
              value: readNumberArg(args, 0, 0),
            },
            callNode: expression,
            factoryName: expression.callee.name,
          };
        case "createColorPicker":
          return {
            config: buildColorControllerConfig(args),
            callNode: expression,
            factoryName: expression.callee.name,
          };
        case "createCheckbox": {
          const config = {
            type: "checkbox",
            value: readBooleanArg(args, 1, false),
          };
          const label = readStringArg(args, 0, "");
          if (label) {
            config.label = label;
          }
          return {
            config,
            callNode: expression,
            factoryName: expression.callee.name,
          };
        }
        case "createSelect":
          return {
            config: {
              type: "select",
              options: [],
              value: 0,
            },
            callNode: expression,
            factoryName: expression.callee.name,
          };
        case "createPoint":
          return {
            config: {
              type: "point",
              value: [
                readNumberArg(args, 0, 0),
                readNumberArg(args, 1, 0),
              ],
            },
            callNode: expression,
            factoryName: expression.callee.name,
          };
        default:
          return null;
      }
    }

    function visitNode(node) {
      if (!node || typeof node !== "object") {
        return;
      }

      if (node.type === "VariableDeclarator" && node.init) {
        const selectResult = parseSelectControllerChain(node.init);
        if (selectResult) {
          const bindingLabel = describeControllerBinding(node.id);
          if (bindingLabel && !selectResult.config.label) {
            selectResult.config.label = bindingLabel;
          }
          pushConfig(selectResult.config, selectResult.callNode, selectResult.factoryName);
          return;
        }
        const directResult = parseDirectControllerCall(node.init);
        if (directResult) {
          const bindingLabel = describeControllerBinding(node.id);
          if (bindingLabel) {
            directResult.config.label = bindingLabel;
          }
          pushConfig(directResult.config, directResult.callNode, directResult.factoryName);
          return;
        }
      }

      if (node.type === "AssignmentExpression" && node.right) {
        const selectResult = parseSelectControllerChain(node.right);
        if (selectResult) {
          const bindingLabel = describeControllerBinding(node.left);
          if (bindingLabel && !selectResult.config.label) {
            selectResult.config.label = bindingLabel;
          }
          pushConfig(selectResult.config, selectResult.callNode, selectResult.factoryName);
          return;
        }
        const directResult = parseDirectControllerCall(node.right);
        if (directResult) {
          const bindingLabel = describeControllerBinding(node.left);
          if (bindingLabel) {
            directResult.config.label = bindingLabel;
          }
          pushConfig(directResult.config, directResult.callNode, directResult.factoryName);
          return;
        }
      }

      if (node.type === "ExpressionStatement" && node.expression) {
        const selectResult = parseSelectControllerChain(node.expression);
        if (selectResult) {
          pushConfig(selectResult.config, selectResult.callNode, selectResult.factoryName);
          return;
        }
        const directResult = parseDirectControllerCall(node.expression);
        if (directResult) {
          pushConfig(directResult.config, directResult.callNode, directResult.factoryName);
          return;
        }
      }

      for (const key in node) {
        if (!Object.prototype.hasOwnProperty.call(node, key)) {
          continue;
        }
        if (key === "loc" || key === "range" || key === "start" || key === "end") {
          continue;
        }
        const value = node[key];
        if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i += 1) {
            visitNode(value[i]);
          }
        } else if (value && typeof value === "object") {
          visitNode(value);
        }
      }
    }

    visitNode(program);
    return configs;
  }

  function mergeBitmapControllerConfigs(staticConfigs, runtimeConfigs) {
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

      const staticConfig =
        staticIndex >= 0 && staticIndex < fallbackConfigs.length
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

  function buildBitmapBundle(code, compiled, fileName, runtimeControllerConfigs) {
    const source = String(code || "");
    const sourceHash = hashString(source);
    const comp = getBitmapCompConfig(compiled, fileName);
    const backgroundMode = normalizeBackgroundMode(compiled, source);
    const profile = inferStateProfile(compiled, source);
    const staticControllerConfigs = extractBitmapControllerConfigs(source);
    const controllerConfigs = mergeBitmapControllerConfigs(
      staticControllerConfigs,
      runtimeControllerConfigs,
    ).slice(0, BITMAP_CONTROLLER_SLOT_LIMIT);
    const controllerHash =
      controllerConfigs.length > 0 ? hashString(JSON.stringify(controllerConfigs)) : "none";

    return {
      bundleVersion: 1,
      runtimeTarget: window.momentumPluginBitmap.RUNTIME_TARGET,
      revision: parseInt(sourceHash.slice(0, 4), 16) % 32768,
      sourcePath: "sketch.js",
      sourceHash,
      pixelDensity: Math.max(1, Number(window.devicePixelRatio) || 1),
      comp,
      analysis: {
        profile,
        backgroundMode,
      },
      controller: {
        hash: controllerHash,
        configs: controllerConfigs,
      },
      cache: {
        recentFrameBudgetMB: 512,
        checkpointInterval: 12,
        denseWindowBacktrack: 8,
        denseWindowForward: 24,
      },
    };
  }

  function extractRunTargetName(code, fallbackName) {
    const fileNameRegex = /\/\/\s*@filename[:\s]*([^\n]+)/;
    const match = String(code || "").match(fileNameRegex);
    if (match && match[1]) {
      return match[1].trim();
    }
    return fallbackName || "New Composition";
  }

  function hasFatalDiagnostics(result) {
    if (!result || !Array.isArray(result.diagnostics)) {
      return false;
    }

    return result.diagnostics.some((diagnostic) => {
      return diagnostic && diagnostic.fatal !== false && diagnostic.severity !== "warning";
    });
  }

  function formatDiagnosticForConsole(diagnostic) {
    if (!diagnostic) {
      return "Unknown compiler error";
    }

    const loc =
      diagnostic.loc && typeof diagnostic.loc.line === "number"
        ? ` (${diagnostic.loc.line}:${(diagnostic.loc.column || 0) + 1})`
        : "";
    const phase = diagnostic.phase ? `[${diagnostic.phase}] ` : "";
    return `${phase}${diagnostic.message || "Unknown compiler error"}${loc}`;
  }

  function defineTheme() {
    monaco.editor.defineTheme("rsms-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "#888888" },
        { token: "meta.keyword", foreground: "#85ad99" },
        { token: "meta.variable", foreground: "#6c9380" },
        { token: "meta.annotation", foreground: "#6c9380" },
        { token: "delimiter", foreground: "#ffffff66" },
        { token: "delimiter.bracket", foreground: "#ffffff66" },
        { token: "type", foreground: "#f7ac6e" },
        { token: "type.identifier", foreground: "#ffab66" },
        { token: "keyword", foreground: "#94b3d1" },
        { token: "keyword.operator", foreground: "#ffc799" },
        {
          token: "identifier.function",
          foreground: "#ffffff",
          fontStyle: "bold",
        },
        { token: "string", foreground: "#94d1b3" },
        { token: "constant", foreground: "#94d1b3" },
        { token: "number", foreground: "#94d1b3" },
        { token: "regexp", foreground: "#3399ff" },
        { token: "tag", foreground: "#ffffff66" },
        { token: "tag.attribute.name", foreground: "#ffab66" },
        { token: "invalid", foreground: "#ff1500" },
      ],
      colors: {
        "editor.foreground": "#ffffffcc",
        "editor.background": "#1a1a19",
        "editorCursor.foreground": "#e8e3da",
        "editor.selectionBackground": "#66c2ff4c",
        "editor.inactiveSelectionBackground": "#b3b3b333",
        "diffEditor.insertedLineBackground": "#00db6e80",
        "diffEditor.removedLineBackground": "#ff150080",
        "editorIndentGuide.background": "#ffffff0f",
        "editorIndentGuide.activeBackground": "#ffffff0f",
        "editor.findMatchHighlightBackground": "#66c2ff66",
        "editor.findMatchBackground": "#ffff00",
        "editorError.foreground": "#ff5b4d",
        "editorWarning.foreground": "#ffff00",
        "editorBracketMatch.background": "#f76ec9",
        "editorBracketMatch.border": "#00000000",
        "scrollbar.shadow": "#f76ec977",
      },
    });
  }

  function createManager() {
    let editor = null;
    let isAutoFormatting = false;
    let isApplyingIndentCorrection = false;
    let isRunEnabled = false;
    let renderMode = "vector";
    const validation = window.momentumEditorValidation.createController({
      getEditor: () => editor,
      validationDelay: 250,
    });
    const autocomplete = window.momentumEditorAutocomplete.createController();
    const interactions = window.momentumEditorInteractions.createController({
      getEditor: () => editor,
      canRunScript: () => isRunEnabled,
      runScript: () => runScript(),
    });

    function getRunButton() {
      return document.getElementById("runEditorScript");
    }

    function getRenderModeSelect() {
      return document.getElementById("renderModeSelect");
    }

    function syncRenderModeSelect() {
      const select = getRenderModeSelect();
      if (!select) {
        return;
      }

      select.value = renderMode;
    }

    function syncEffectiveRenderModeSelect(mode) {
      const select = getRenderModeSelect();
      if (!select) {
        return;
      }

      select.value = normalizeRenderMode(mode);
    }

    function normalizeRenderMode(mode) {
      if (mode === "bitmap") {
        return "bitmap";
      }
      if (mode === "vector") {
        return "vector";
      }
      return "vector";
    }

    function setRenderMode(mode) {
      renderMode = normalizeRenderMode(mode);

      if (
        renderMode !== "bitmap" &&
        window.debugTraceManager &&
        typeof window.debugTraceManager.stop === "function"
      ) {
        window.debugTraceManager.stop();
      }

      try {
        window.localStorage.setItem(RENDER_MODE_STORAGE_KEY, renderMode);
      } catch (_ignore) {}

      syncRenderModeSelect();
    }

    function getRenderMode() {
      return renderMode;
    }

    function initRenderMode() {
      let savedMode = DEFAULT_RENDER_MODE;

      try {
        savedMode =
          window.localStorage.getItem(RENDER_MODE_STORAGE_KEY) ||
          DEFAULT_RENDER_MODE;
      } catch (_ignore) {}

      setRenderMode(savedMode);

      const select = getRenderModeSelect();
      if (!select) {
        return;
      }

      select.addEventListener("change", (event) => {
        setRenderMode(event && event.target ? event.target.value : "vector");
      });
    }

    function detectBitmapRequirements(code) {
      if (
        !window.momentumRuntimeCapabilities ||
        typeof window.momentumRuntimeCapabilities.detectBitmapRequirements !== "function"
      ) {
        return {
          requiresBitmap: false,
          functions: [],
        };
      }

      try {
        return window.momentumRuntimeCapabilities.detectBitmapRequirements(code);
      } catch (_ignore) {
        return {
          requiresBitmap: false,
          functions: [],
        };
      }
    }

    function getEffectiveRenderModeInfo(code) {
      const requirements = detectBitmapRequirements(code);
      const requiredMode =
        requirements && requirements.requiresBitmap ? "bitmap" : null;
      const effectiveMode = normalizeRenderMode(requiredMode || renderMode);

      return {
        requirements,
        requiredMode,
        effectiveMode,
      };
    }

    function syncRuntimeModeUI(code) {
      const info = getEffectiveRenderModeInfo(code);
      syncEffectiveRenderModeSelect(info.effectiveMode);
      return info;
    }

    function reportRuntimeModeSwitch(info, selectedMode) {
      const normalizedSelectedMode = normalizeRenderMode(selectedMode);
      if (
        !info ||
        info.effectiveMode !== "bitmap" ||
        !info.requiredMode ||
        normalizedSelectedMode === info.effectiveMode
      ) {
        return;
      }

      const functions =
        info.requirements && Array.isArray(info.requirements.functions)
          ? info.requirements.functions
          : [];
      const detail = functions.length ? ` ${functions.join(", ")}` : "";
      console.warn(
        `Render mode switched to Bitmap because Vector mode does not support${detail}.`,
      );
    }

    function setRunEnabled(enabled) {
      isRunEnabled = !!enabled;

      const runButton = getRunButton();
      if (!runButton) {
        return;
      }

      runButton.hidden = !isRunEnabled;
      runButton.disabled = !isRunEnabled;
    }

    function getIndentUnit() {
      const model = editor && typeof editor.getModel === "function" ? editor.getModel() : null;
      const options = model && typeof model.getOptions === "function" ? model.getOptions() : null;
      const tabSize = options && typeof options.tabSize === "number" ? options.tabSize : 2;
      const insertSpaces =
        !options || typeof options.insertSpaces !== "boolean" ? true : options.insertSpaces;
      return insertSpaces ? " ".repeat(Math.max(1, tabSize)) : "\t";
    }

    function buildIndentString(level) {
      if (!level || level < 0) {
        return "";
      }

      return getIndentUnit().repeat(level);
    }

    function countBraceDepthBeforeLine(model, lineNumber) {
      let depth = 0;
      let inBlockComment = false;
      let inString = null;
      let escaping = false;

      for (let currentLine = 1; currentLine < lineNumber; currentLine += 1) {
        const content = model.getLineContent(currentLine);
        for (let index = 0; index < content.length; index += 1) {
          const char = content.charAt(index);
          const nextChar = content.charAt(index + 1);

          if (inBlockComment) {
            if (char === "*" && nextChar === "/") {
              inBlockComment = false;
              index += 1;
            }
            continue;
          }

          if (inString) {
            if (escaping) {
              escaping = false;
              continue;
            }

            if (char === "\\") {
              escaping = true;
              continue;
            }

            if (char === inString) {
              inString = null;
            }
            continue;
          }

          if (char === "/" && nextChar === "/") {
            break;
          }

          if (char === "/" && nextChar === "*") {
            inBlockComment = true;
            index += 1;
            continue;
          }

          if (char === "'" || char === '"' || char === "`") {
            inString = char;
            continue;
          }

          if (char === "{") {
            depth += 1;
            continue;
          }

          if (char === "}") {
            depth = Math.max(0, depth - 1);
          }
        }
      }

      return depth;
    }

    function getPreviousSignificantLine(model, lineNumber) {
      for (let currentLine = lineNumber - 1; currentLine >= 1; currentLine -= 1) {
        const trimmed = model.getLineContent(currentLine).trim();
        if (trimmed) {
          return {
            lineNumber: currentLine,
            trimmed,
          };
        }
      }

      return null;
    }

    function isSingleLineControlHeader(trimmed) {
      if (!trimmed) {
        return false;
      }

      if (/[{;}]$/.test(trimmed)) {
        return false;
      }

      return /^(if\b.*|else\b(?:\s+if\b.*)?|for\b.*|while\b.*|do\b|catch\b.*|finally\b)$/.test(
        trimmed,
      );
    }

    function getExpectedIndentLevel(model, lineNumber) {
      const content = model.getLineContent(lineNumber);
      const trimmed = content.trim();
      const isBlankLine = trimmed.length === 0;

      let depth = countBraceDepthBeforeLine(model, lineNumber);

      if (!isBlankLine && /^[}\])]/.test(trimmed)) {
        depth = Math.max(0, depth - 1);
      }

      if (!isBlankLine && /^(case\b|default\b)/.test(trimmed)) {
        depth = Math.max(0, depth - 1);
      }

      const previousLine = getPreviousSignificantLine(model, lineNumber);
      if (previousLine) {
        if (/^(case\b|default\b)/.test(previousLine.trimmed) && /:\s*$/.test(previousLine.trimmed)) {
          depth += 1;
        } else if (isSingleLineControlHeader(previousLine.trimmed)) {
          depth += 1;
        }
      }

      return depth;
    }

    function correctCurrentLineIndentation() {
      if (isApplyingIndentCorrection || isAutoFormatting || !editor) {
        return;
      }

      const model = editor.getModel();
      const selection =
        typeof editor.getSelection === "function" ? editor.getSelection() : null;
      if (!model || !selection || !selection.isEmpty()) {
        return;
      }

      const lineNumber = selection.positionLineNumber;
      const content = model.getLineContent(lineNumber);

      const expectedIndentLevel = getExpectedIndentLevel(model, lineNumber);
      if (expectedIndentLevel === null) {
        return;
      }

      const currentIndentMatch = content.match(/^(\s*)/);
      const currentIndent = currentIndentMatch ? currentIndentMatch[1] : "";
      const expectedIndent = buildIndentString(expectedIndentLevel);

      if (currentIndent === expectedIndent) {
        return;
      }

      const indentDelta = expectedIndent.length - currentIndent.length;
      const nextColumn = Math.max(1, selection.positionColumn + indentDelta);

      isApplyingIndentCorrection = true;
      editor.executeEdits(
        "auto-indent-correction",
        [
          {
            range: new monaco.Range(lineNumber, 1, lineNumber, currentIndent.length + 1),
            text: expectedIndent,
          },
        ],
        [
          new monaco.Selection(
            lineNumber,
            nextColumn,
            lineNumber,
            nextColumn,
          ),
        ],
      );
      isApplyingIndentCorrection = false;
    }

    function scheduleIndentCorrection() {
      setTimeout(() => {
        correctCurrentLineIndentation();
      }, 0);
    }

    function changeTextContainsIndentTrigger(text) {
      if (!text) {
        return false;
      }

      return text.indexOf("}") !== -1 || text.indexOf(";") !== -1 || text.indexOf("\n") !== -1;
    }

    function shouldCorrectIndentFromChangeEvent(event) {
      if (!event || event.isFlush || event.isUndoing || event.isRedoing) {
        return false;
      }

      if (!Array.isArray(event.changes) || !event.changes.length) {
        return false;
      }

      return event.changes.some((change) => {
        if (!change) {
          return false;
        }

        return changeTextContainsIndentTrigger(change.text);
      });
    }

    function canAutoFormatCurrentModel() {
      if (!editor || typeof editor.getAction !== "function") {
        return false;
      }

      const model = typeof editor.getModel === "function" ? editor.getModel() : null;
      if (!model || typeof model.getLanguageId !== "function") {
        return false;
      }

      if (model.getLanguageId() !== "javascript") {
        return false;
      }

      const formatAction = editor.getAction("editor.action.formatDocument");
      return !!(formatAction && typeof formatAction.run === "function");
    }

    function formatDocument(options) {
      const formatOptions = options || {};
      if (isAutoFormatting || !canAutoFormatCurrentModel()) {
        return Promise.resolve(false);
      }

      const formatAction = editor.getAction("editor.action.formatDocument");
      isAutoFormatting = true;
      return Promise.resolve(formatAction.run())
        .then(() => true)
        .catch(() => {})
        .finally(() => {
          isAutoFormatting = false;
          if (formatOptions.restoreFocus !== false && editor && typeof editor.focus === "function") {
            editor.focus();
          }
        });
    }

    function initEditor() {
      require.config({
        paths: {
          vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.30.1/min/vs",
        },
      });

      require(["vs/editor/editor.main"], function () {
        autocomplete.configure();
        defineTheme();

        editor = monaco.editor.create(document.getElementById("editor"), {
          value: "",
          language: "javascript",
          theme: "rsms-dark",
          autoIndent: "full",
          detectIndentation: false,
          formatOnPaste: true,
          formatOnType: true,
          insertSpaces: true,
          minimap: { enabled: false },
          tabSize: DEFAULT_INDENT_SIZE,
          wordBasedSuggestions: false,
          scrollbar: {
            vertical: "visible",
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
        });

        manager.editor = editor;
        window.dispatchEvent(new CustomEvent("momentum:editor-ready"));

        editor.onDidChangeModelContent((event) => {
          validation.scheduleValidation();
          if (shouldCorrectIndentFromChangeEvent(event)) {
            scheduleIndentCorrection();
          }
        });

        editor.onDidType((text) => {
          if (
            !text ||
            (!INDENT_CORRECTION_TRIGGER_CHARS[text] && !changeTextContainsIndentTrigger(text))
          ) {
            return;
          }

          scheduleIndentCorrection();
        });

        editor.onDidChangeCursorSelection(() => {
          interactions.rememberNonEmptySelections(editor.getSelections() || []);
        });

        editor.onDidFocusEditorWidget(() => {
          setTimeout(() => {
            interactions.attachInputAreaSelectHandler();
          }, 0);
        });

        interactions.bindWindowShortcuts();
        window.addEventListener("resize", () => editor && editor.layout());

        setTimeout(() => {
          if (editor) {
            interactions.attachInputAreaSelectHandler();
            editor.layout();
            validation.validateCurrentModel();
          }
        }, 100);
      });
    }

    function runVectorScript(code, fileName) {
      return window.codeExecutor.executeUserCode(code, fileName).catch((error) =>
        console.error(
          "Execution error:",
          error && error.message ? error.message : String(error),
        ),
      );
    }

  function parseApplyMomentumResult(rawValue) {
    return window.momentumPluginBitmap.parseApplyMomentumResult(rawValue);
  }

  function expectExtendScriptOk(rawValue, stepName) {
    return window.momentumPluginBitmap.expectExtendScriptOk(rawValue, stepName);
  }

  function reportApplyMomentumWarnings(result) {
    return window.momentumPluginBitmap.reportApplyMomentumWarnings(result);
  }

  function runBitmapScript(code, fileName) {
    const bitmapRuntimeCode =
      window.codeExecutor &&
      typeof window.codeExecutor.absolutizeBitmapAssetCalls === "function"
        ? window.codeExecutor.absolutizeBitmapAssetCalls(code)
        : code;
    const compiled = window.sketchCompiler.compile(code);

    if (!compiled || !compiled.ok) {
      const primaryDiagnostic = (compiled && compiled.diagnostics || []).find(
        (diagnostic) => diagnostic && diagnostic.severity !== "warning",
      );
      if (primaryDiagnostic) {
        console.error(
          "Compile error:",
          formatDiagnosticForConsole(primaryDiagnostic),
        );
      }
      return Promise.resolve(false);
    }

    const runtimeControllerPromise =
      window.codeExecutor &&
      typeof window.codeExecutor.discoverBitmapControllers === "function"
        ? window.codeExecutor.discoverBitmapControllers(code, compiled)
        : Promise.resolve([]);

    return Promise.resolve(runtimeControllerPromise)
      .catch(() => [])
      .then((runtimeControllerConfigs) => {
        const bundle = buildBitmapBundle(
          code,
          compiled,
          extractRunTargetName(code, fileName || "New Composition"),
          runtimeControllerConfigs,
        );
        return window.momentumPluginBitmap.applyRuntimeBundle(
          bundle,
          bitmapRuntimeCode,
        );
      })
      .then((applyResultText) => {
        const applyResult = parseApplyMomentumResult(applyResultText);
        reportApplyMomentumWarnings(applyResult);
        if (
          applyResult &&
          applyResult.debugTracePath &&
          window.debugTraceManager &&
          typeof window.debugTraceManager.startSession === "function"
        ) {
          window.debugTraceManager.startSession({
            compName: applyResult.comp || "",
            filePath: applyResult.debugTracePath,
            sessionId: applyResult.debugSessionId || applyResult.instanceId || "",
          });
        }
        return true;
      })
      .catch((error) => {
        console.error(
          "Bitmap execution error:",
          error && error.message ? error.message : String(error),
        );
        return false;
      });
  }

    function runScript() {
      if (!isRunEnabled) {
        return Promise.resolve(false);
      }

      return formatDocument()
        .catch(() => false)
        .then(() => {
          const code = editor.getValue();
          const fileName = window.fileManager.getCurrentFileName && window.fileManager.getCurrentFileName();
          const selectedRenderMode = renderMode;
          if (
            window.debugTraceManager &&
            typeof window.debugTraceManager.stop === "function"
          ) {
            window.debugTraceManager.stop();
          }
          if (
            window.consoleManager &&
            typeof window.consoleManager.clearConsole === "function"
          ) {
            window.consoleManager.clearConsole();
          } else {
            document.getElementById("console-output").innerHTML = "";
          }
          const runtimeModeInfo = syncRuntimeModeUI(code);
          const effectiveRenderMode = runtimeModeInfo.effectiveMode;
          if (effectiveRenderMode !== normalizeRenderMode(renderMode)) {
            setRenderMode(effectiveRenderMode);
          }
          const validationResult = validation.diagnoseCode(code);
          if (hasFatalDiagnostics(validationResult)) {
            const primaryDiagnostic = (validationResult.diagnostics || []).find(
              (diagnostic) => diagnostic && diagnostic.severity !== "warning",
            );
            if (primaryDiagnostic) {
              console.error(
                "Compile error:",
                formatDiagnosticForConsole(primaryDiagnostic),
              );
            }
            return;
          }

          reportRuntimeModeSwitch(runtimeModeInfo, selectedRenderMode);

          if (effectiveRenderMode === "bitmap") {
            return runBitmapScript(code, fileName);
          }

          return runVectorScript(code, fileName);
        });
    }

    const manager = {
      diagnoseCode: validation.diagnoseCode,
      formatDocument,
      initEditor,
      initRenderMode,
      isRunEnabled: () => isRunEnabled,
      getRenderMode,
      runScript,
      setRenderMode,
      setRunEnabled,
      toggleLineComments: interactions.toggleLineComments,
      editor: null,
    };

    return manager;
  }

  return {
    createManager,
  };
})();
