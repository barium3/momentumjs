window.momentumEditorAutocomplete = (function () {
  const FUNCTION_BINDING_INFO = {
    callable: true,
    type: "function",
  };
  const CLASS_BINDING_INFO = {
    callable: false,
    type: "function",
  };
  const UNKNOWN_BINDING_INFO = {
    callable: null,
    type: "unknown",
  };
  const ARGUMENTS_BINDING_INFO = {
    callable: false,
    type: "object",
  };
  const MEMBER_COMPLETION_PLACEHOLDER = "__momentumAutocompleteTarget";
  const AST_PARSE_OPTIONS = {
    ecmaVersion: 2020,
    sourceType: "script",
    locations: true,
  };
  let fontAnalyzer = null;
  let fontAnalyzerInitStarted = false;
  const MOMENTUM_ENTRY_SNIPPETS = [
    {
      label: "draw",
      insertText: "function draw() {\n\t$0\n}",
      insertTextRules: 4,
      detail: "Momentum entry point",
      documentation: "Main render loop entry.",
    },
    {
      label: "setup",
      insertText: "function setup() {\n\t$0\n}",
      insertTextRules: 4,
      detail: "Momentum entry point",
      documentation: "Initialization entry.",
    },
    {
      label: "preload",
      insertText: "function preload() {\n\t$0\n}",
      insertTextRules: 4,
      detail: "Momentum entry point",
      documentation: "Asset preload entry.",
    },
  ];

  function getRegistry() {
    return window.compilerSymbols && typeof window.compilerSymbols.getRegistry === "function"
      ? window.compilerSymbols.getRegistry()
      : window.functionRegistry || null;
  }

  function getAstApi() {
    return window.compilerAst || null;
  }

  function getSemantics() {
    return window.compilerSemantics || null;
  }

  function getTypeInference() {
    return window.compilerTypeInference || null;
  }

  function getFontAnalyzer() {
    if (!fontAnalyzer && typeof window.FontAnalyzer !== "undefined") {
      fontAnalyzer = new window.FontAnalyzer();
    }
    return fontAnalyzer;
  }

  function ensureFontAnalyzerReady() {
    const analyzer = getFontAnalyzer();
    if (!analyzer || typeof analyzer.init !== "function") {
      return Promise.resolve(analyzer);
    }

    if (!fontAnalyzerInitStarted) {
      fontAnalyzerInitStarted = true;
    }

    return Promise.resolve(analyzer.init())
      .catch(() => {})
      .then(() => analyzer);
  }

  function getCompletionInsertTextRule() {
    return monaco &&
      monaco.languages &&
      monaco.languages.CompletionItemInsertTextRule &&
      monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
      ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
      : 4;
  }

  function buildArgPlaceholderList(count) {
    const items = [];
    for (let index = 0; index < count; index += 1) {
      items.push(`\${${index + 1}:arg${index + 1}}`);
    }
    return items.join(", ");
  }

  function formatSignatureSummary(signatures) {
    if (!Array.isArray(signatures) || !signatures.length) {
      return "";
    }

    return signatures
      .map((signature) => {
        if (!signature) {
          return "";
        }

        if (signature.minArgs === signature.maxArgs) {
          return `${signature.minArgs} args`;
        }

        if (signature.maxArgs === Infinity) {
          return `${signature.minArgs}+ args`;
        }

        return `${signature.minArgs}-${signature.maxArgs} args`;
      })
      .filter(Boolean)
      .join(" / ");
  }

  function buildFunctionInsertText(name, signatures) {
    if (!Array.isArray(signatures) || !signatures.length) {
      return `${name}($0)`;
    }

    const exactSignature = signatures.find((signature) => {
      return signature && signature.minArgs === signature.maxArgs && signature.maxArgs !== Infinity;
    });

    if (!exactSignature) {
      return `${name}($0)`;
    }

    if (exactSignature.minArgs <= 0) {
      return `${name}()`;
    }

    return `${name}(${buildArgPlaceholderList(exactSignature.minArgs)})`;
  }

  function getCompletionRange(model, position) {
    const word = model.getWordUntilPosition(position);
    return new monaco.Range(
      position.lineNumber,
      word.startColumn,
      position.lineNumber,
      word.endColumn
    );
  }

  function createSuggestion(range, config) {
    const isCallable =
      config.kind === monaco.languages.CompletionItemKind.Function ||
      config.kind === monaco.languages.CompletionItemKind.Method;

    return {
      label: config.label,
      kind: config.kind,
      insertText: config.insertText,
      insertTextRules: isCallable ? getCompletionInsertTextRule() : undefined,
      detail: config.detail,
      documentation: config.documentation,
      range,
      filterText: config.filterText,
      sortText: config.sortText,
    };
  }

  function buildMomentumSuggestions(range) {
    if (typeof monaco === "undefined") {
      return [];
    }

    const registry = getRegistry();
    if (!registry) {
      return [];
    }

    const suggestions = [];
    const seen = Object.create(null);
    const categoryNames = [
      "shapes",
      "transforms",
      "colors",
      "math",
      "environment",
      "typography",
      "controllers",
      "data",
      "images",
      "tables",
    ];

    function pushSuggestion(name, item, categoryName) {
      if (!name || seen[name]) {
        return;
      }

      const type = item && item.type ? item.type : "function";
      let kind = monaco.languages.CompletionItemKind.Function;
      const signatures = item && item.signatures;
      let insertText = name;

      if (type === "constant") {
        kind = monaco.languages.CompletionItemKind.Constant;
      } else if (type === "variable") {
        kind = monaco.languages.CompletionItemKind.Variable;
      } else if (type === "namespace") {
        kind = monaco.languages.CompletionItemKind.Module;
      } else if (type === "instance_method") {
        kind = monaco.languages.CompletionItemKind.Method;
      } else {
        insertText = buildFunctionInsertText(name, item && item.signatures);
      }

      seen[name] = true;
      suggestions.push(
        createSuggestion(range, {
          label: name,
          kind,
          insertText,
          detail: categoryName ? `Momentum ${categoryName}` : "Momentum",
          documentation: formatSignatureSummary(signatures),
          sortText: `0_${name}`,
        }),
      );
    }

    categoryNames.forEach((categoryName) => {
      const category = registry[categoryName];
      if (!category) {
        return;
      }

      Object.keys(category).forEach((name) => {
        pushSuggestion(name, category[name], categoryName);
      });
    });

    MOMENTUM_ENTRY_SNIPPETS.forEach((entry) => {
      if (seen[entry.label]) {
        return;
      }

      seen[entry.label] = true;
      suggestions.push({
        ...createSuggestion(range, {
          label: entry.label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: entry.insertText,
          detail: entry.detail,
          documentation: entry.documentation,
          sortText: `1_${entry.label}`,
        }),
        insertTextRules: entry.insertTextRules,
      });
    });

    return suggestions;
  }

  function getTextFontFirstArgumentContext(model, position) {
    if (typeof monaco === "undefined") {
      return null;
    }

    const line = model.getLineContent(position.lineNumber);
    const linePrefix = model
      .getLineContent(position.lineNumber)
      .slice(0, Math.max(0, position.column - 1));
    const match = linePrefix.match(/\btextFont\s*\(([\s\S]*)$/);
    if (!match) {
      return null;
    }

    const argPrefix = match[1];
    const argsStartIndex = linePrefix.length - argPrefix.length;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let quote = null;
    let escaped = false;

    for (let i = 0; i < argPrefix.length; i += 1) {
      const ch = argPrefix.charAt(i);

      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === quote) {
          quote = null;
        }
        continue;
      }

      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        continue;
      }

      if (ch === "(") {
        parenDepth += 1;
        continue;
      }
      if (ch === ")") {
        if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
          return null;
        }
        parenDepth = Math.max(0, parenDepth - 1);
        continue;
      }
      if (ch === "[") {
        bracketDepth += 1;
        continue;
      }
      if (ch === "]") {
        bracketDepth = Math.max(0, bracketDepth - 1);
        continue;
      }
      if (ch === "{") {
        braceDepth += 1;
        continue;
      }
      if (ch === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
        continue;
      }

      if (ch === "," && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        return null;
      }
    }

    const trimmedPrefixLength = argPrefix.match(/^\s*/)[0].length;
    const argStartIndex = argsStartIndex + trimmedPrefixLength;
    const argStartChar = line.charAt(argStartIndex);

    if (argStartChar === '"' || argStartChar === "'") {
      const quoteChar = argStartChar;
      let endIndex = line.length;
      let localEscaped = false;

      for (let i = argStartIndex + 1; i < line.length; i += 1) {
        const ch = line.charAt(i);
        if (localEscaped) {
          localEscaped = false;
        } else if (ch === "\\") {
          localEscaped = true;
        } else if (ch === quoteChar) {
          endIndex = i;
          break;
        }
      }

      return {
        isString: true,
        range: new monaco.Range(
          position.lineNumber,
          argStartIndex + 2,
          position.lineNumber,
          endIndex + 1,
        ),
        query: line.slice(argStartIndex + 1, Math.min(endIndex, position.column - 1)),
      };
    }

    const word = model.getWordUntilPosition(position);
    return {
      isString: false,
      range: new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      ),
      query: linePrefix.slice(argStartIndex).trim(),
    };
  }

  function normalizeFontSearchValue(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/["']/g, "")
      .replace(/[\s_-]+/g, "");
  }

  function buildFontEntryList(analyzer) {
    if (!analyzer) {
      return [];
    }

    if (typeof analyzer.getAllFontEntries === "function") {
      const entries = analyzer.getAllFontEntries();
      if (entries.length) {
        return entries;
      }
    }

    const fontMap =
      typeof analyzer.getAllFonts === "function"
        ? analyzer.getAllFonts()
        : {};

    return Object.keys(fontMap).map((name) => ({
      family: name,
      style: "",
      displayName: name,
      postScriptName: fontMap[name],
    }));
  }

  function getFontMatchScore(query, entry) {
    if (!query) {
      return 0;
    }

    const family = entry.family || "";
    const style = entry.style || "";
    const displayName = entry.displayName || family;
    const compactStyle = style.replace(/\s+/g, "");
    const candidates = [
      displayName,
      family,
      style,
      `${family} ${style}`.trim(),
      `${family}-${compactStyle}`.trim(),
      entry.postScriptName || "",
    ];

    let bestScore = Infinity;
    candidates.forEach((candidate) => {
      const normalized = normalizeFontSearchValue(candidate);
      if (!normalized) {
        return;
      }

      if (normalized === query) {
        bestScore = Math.min(bestScore, 0);
      } else if (normalized.indexOf(query) === 0) {
        bestScore = Math.min(bestScore, 1);
      } else if (normalized.includes(query)) {
        bestScore = Math.min(bestScore, 2);
      }
    });

    return bestScore;
  }

  function buildFontInsertText(context, name) {
    return context.isString ? name : `"${name}"`;
  }

  function collectMatchingFontFamilies(entries, query) {
    const familyGroups = Object.create(null);
    const filteredEntries = [];

    entries.forEach((entry) => {
      const score = getFontMatchScore(query, entry);
      if (score === Infinity) {
        return;
      }

      const familyName = entry.family || entry.displayName || "Unknown";
      if (!familyGroups[familyName]) {
        familyGroups[familyName] = {
          family: familyName,
          score,
          styles: [],
          styleSet: Object.create(null),
        };
      } else {
        familyGroups[familyName].score = Math.min(familyGroups[familyName].score, score);
      }

      if (entry.style && !familyGroups[familyName].styleSet[entry.style]) {
        familyGroups[familyName].styleSet[entry.style] = true;
        familyGroups[familyName].styles.push(entry.style);
      }

      filteredEntries.push({
        ...entry,
        score,
      });
    });

    return {
      families: Object.keys(familyGroups)
      .map((name) => familyGroups[name])
      .sort((a, b) => {
        if (a.score !== b.score) {
          return a.score - b.score;
        }
        return a.family.localeCompare(b.family);
      }),
      filteredEntries,
    };
  }

  function buildFontFamilySuggestion(context, group) {
    const documentation = group.styles.length
      ? `Styles: ${group.styles.slice().sort((a, b) => a.localeCompare(b)).join(", ")}`
      : "Available AE font family";

    return createSuggestion(context.range, {
      label: group.family,
      kind: monaco.languages.CompletionItemKind.Class,
      insertText: buildFontInsertText(context, group.family),
      detail: "Font family",
      documentation,
      filterText: `${group.family} ${group.styles.join(" ")}`,
      sortText: `0_${String(group.score)}_${group.family.toLowerCase()}`,
    });
  }

  function buildFontVariantSuggestion(context, group, entry) {
    const label = entry.displayName || group.family;
    const variantName = entry.style ? `${group.family} ${entry.style}` : label;

    if (label === group.family && !entry.style) {
      return null;
    }

    return createSuggestion(context.range, {
      label: variantName,
      kind: monaco.languages.CompletionItemKind.Value,
      insertText: buildFontInsertText(context, label),
      detail: entry.style ? `Style: ${entry.style}` : "Font variant",
      documentation: entry.postScriptName
        ? `PostScript: ${entry.postScriptName}`
        : "Available AE font variant",
      filterText: [
        variantName,
        label,
        `${group.family}-${(entry.style || "").replace(/\s+/g, "")}`,
        entry.postScriptName || "",
      ].join(" "),
      sortText: `1_${String(entry.score)}_${group.family.toLowerCase()}_${(entry.style || label).toLowerCase()}`,
    });
  }

  function buildFamilyFontSuggestions(entries, context, query) {
    const { families, filteredEntries } = collectMatchingFontFamilies(entries, query);
    const suggestions = [];

    families.forEach((group) => {
      suggestions.push(buildFontFamilySuggestion(context, group));

      filteredEntries
        .filter((entry) => (entry.family || entry.displayName || "Unknown") === group.family)
        .sort((a, b) => {
          if (a.score !== b.score) {
            return a.score - b.score;
          }
          return (a.displayName || "").localeCompare(b.displayName || "");
        })
        .forEach((entry) => {
          const suggestion = buildFontVariantSuggestion(context, group, entry);
          if (suggestion) {
            suggestions.push(suggestion);
          }
        });
    });

    return suggestions;
  }

  function buildFontSuggestions(context) {
    if (typeof monaco === "undefined") {
      return Promise.resolve([]);
    }

    return ensureFontAnalyzerReady().then((analyzer) => {
      const loadEntries =
        analyzer &&
        typeof analyzer.refreshFontMap === "function" &&
        typeof analyzer.getAllFontEntries === "function" &&
        analyzer.getAllFontEntries().length === 0
          ? Promise.resolve(analyzer.refreshFontMap()).then(() => buildFontEntryList(analyzer))
          : Promise.resolve(buildFontEntryList(analyzer));

      return loadEntries.then((entries) => {
        const query = normalizeFontSearchValue(context.query);
        return buildFamilyFontSuggestions(entries, context, query);
      });
    });
  }

  function getBindingOptions(globals) {
    const typeInference = getTypeInference();
    return {
      classBindingInfo: CLASS_BINDING_INFO,
      functionBindingInfo: FUNCTION_BINDING_INFO,
      getBindingInfo:
        typeInference && typeof typeInference.createBindingInfoFromInit === "function"
          ? typeInference.createBindingInfoFromInit
          : null,
      globals: globals || Object.create(null),
    };
  }

  function containsOffset(node, offset) {
    return !!node && typeof node.start === "number" && typeof node.end === "number"
      ? node.start <= offset && offset <= node.end
      : false;
  }

  function findChildContainingOffset(node, offset) {
    const semantics = getSemantics();
    let result = null;

    if (!semantics || typeof semantics.forEachChild !== "function") {
      return null;
    }

    semantics.forEachChild(node, (child) => {
      if (!result && containsOffset(child, offset)) {
        result = child;
      }
    });

    return result;
  }

  function descendIntoContainedChild(node, offset, scope, descend) {
    const child = findChildContainingOffset(node, offset);
    return child ? descend(child, scope) : scope;
  }

  function withFunctionScope(semantics, parentScope, node, options) {
    const scope = semantics.createScope(parentScope);

    if (node.id && node.id.type === "Identifier") {
      semantics.addBinding(scope, node.id.name, FUNCTION_BINDING_INFO);
    }

    if (node.type !== "ArrowFunctionExpression") {
      semantics.addBinding(scope, "arguments", ARGUMENTS_BINDING_INFO);
    }

    (node.params || []).forEach((param) => {
      semantics.addPatternBindings(scope, param, UNKNOWN_BINDING_INFO);
    });

    if (node.body && node.body.type === "BlockStatement") {
      semantics.collectHoistedBindings(node.body, scope, options);
      semantics.collectLexicalBindings(node.body.body || [], scope, options);
    }

    return scope;
  }

  function createScopeContextForOffset(program, offset) {
    const semantics = getSemantics();
    if (!program || !semantics) {
      return null;
    }

    const globals =
      typeof semantics.buildGlobalBindings === "function"
        ? semantics.buildGlobalBindings()
        : Object.create(null);
    const options = getBindingOptions(globals);
    const globalScope = semantics.createScope(null);

    semantics.collectHoistedBindings(program, globalScope, options);
    semantics.collectLexicalBindings(program.body || [], globalScope, options);

    function descend(node, scope) {
      if (!node) {
        return scope;
      }

      switch (node.type) {
        case "Program": {
          return descendIntoContainedChild(node, offset, scope, descend);
        }
        case "BlockStatement": {
          const blockScope = semantics.createScope(scope);
          semantics.collectLexicalBindings(node.body || [], blockScope, options);
          return descendIntoContainedChild(node, offset, blockScope, descend);
        }
        case "FunctionDeclaration":
        case "FunctionExpression":
        case "ArrowFunctionExpression": {
          const functionScope = withFunctionScope(semantics, scope, node, options);

          if (node.body && node.body.type === "BlockStatement") {
            if (containsOffset(node.body, offset)) {
              return descendIntoContainedChild(node.body, offset, functionScope, descend);
            }
          }

          return descendIntoContainedChild(node, offset, functionScope, descend);
        }
        case "CatchClause": {
          const catchScope = semantics.createScope(scope);
          semantics.addPatternBindings(catchScope, node.param, UNKNOWN_BINDING_INFO);

          if (node.body && node.body.type === "BlockStatement") {
            semantics.collectLexicalBindings(node.body.body || [], catchScope, options);

            if (containsOffset(node.body, offset)) {
              return descendIntoContainedChild(node.body, offset, catchScope, descend);
            }
          }

          return descendIntoContainedChild(node, offset, catchScope, descend);
        }
        case "ForStatement":
        case "ForInStatement":
        case "ForOfStatement": {
          const loopInit = node.type === "ForStatement" ? node.init : node.left;
          const loopScope = semantics.createLoopScope(scope, loopInit, options);
          return descendIntoContainedChild(node, offset, loopScope, descend);
        }
        case "SwitchStatement": {
          const switchScope = semantics.createScope(scope);
          semantics.collectLexicalBindingsFromCases(node.cases || [], switchScope, options);
          return descendIntoContainedChild(node, offset, switchScope, descend);
        }
        default: {
          return descendIntoContainedChild(node, offset, scope, descend);
        }
      }
    }

    return {
      globals,
      scope: descend(program, globalScope),
    };
  }

  function getMethodEntriesForReceiver(receiverType) {
    const registry = getRegistry();
    if (!registry || !receiverType) {
      return [];
    }

    const entries = [];
    const seen = Object.create(null);

    function pushEntry(name, info) {
      if (!name || seen[name]) {
        return;
      }

      seen[name] = true;
      entries.push({
        name,
        info: info || {},
      });
    }

    if (registry.instances && registry.instances[receiverType]) {
      Object.keys(registry.instances[receiverType]).forEach((name) => {
        pushEntry(name, registry.instances[receiverType][name]);
      });
    }

    if (registry.tables) {
      Object.keys(registry.tables).forEach((name) => {
        const info = registry.tables[name];
        const methodName = info && (info.alias || name);

        if (!info || info.type !== "instance_method" || info.receiver !== receiverType) {
          return;
        }

        pushEntry(methodName, info);
      });
    }

    return entries;
  }

  function buildMemberSuggestions(range, receiverType) {
    if (typeof monaco === "undefined" || !receiverType) {
      return [];
    }

    return getMethodEntriesForReceiver(receiverType).map((entry) =>
      createSuggestion(range, {
        label: entry.name,
        kind: monaco.languages.CompletionItemKind.Method,
        insertText: buildFunctionInsertText(entry.name, entry.info && entry.info.signatures),
        detail: `Momentum ${receiverType} method`,
        documentation: formatSignatureSummary(entry.info && entry.info.signatures),
        sortText: `0_${entry.name}`,
      }),
    );
  }

  function findMemberCompletionTarget(ast, cursorOffset) {
    const astApi = getAstApi();
    let target = null;

    if (!astApi || !ast) {
      return null;
    }

    astApi.walk(ast, (node) => {
      if (
        node &&
        node.type === "Identifier" &&
        node.name === MEMBER_COMPLETION_PLACEHOLDER &&
        node.parent &&
        node.parent.type === "MemberExpression" &&
        node.parent.property === node &&
        !node.parent.computed &&
        containsOffset(node.parent, cursorOffset)
      ) {
        target = node.parent;
        return false;
      }
    });

    return target;
  }

  function parseMemberObjectExpression(source) {
    const astApi = getAstApi();
    if (!astApi || typeof astApi.parse !== "function" || !source) {
      return null;
    }

    try {
      const program = astApi.parse(`(${source})`, AST_PARSE_OPTIONS);
      const statement = program && program.body && program.body[0];
      return statement && statement.expression ? statement.expression.expression : null;
    } catch (error) {
      return null;
    }
  }

  function extractMemberObjectSource(linePrefix) {
    const match = linePrefix.match(/([A-Za-z_$][\w$]*(?:\s*\([^()]*\))?(?:\s*\.\s*[A-Za-z_$][\w$]*(?:\s*\([^()]*\))?)*)\.\s*[A-Za-z_$\w]*$/);
    return match ? match[1] : "";
  }

  function getMemberCompletionContext(model, position) {
    const astApi = getAstApi();
    const typeInference = getTypeInference();
    if (!astApi || !getSemantics() || !typeInference) {
      return null;
    }

    const linePrefix = model
      .getLineContent(position.lineNumber)
      .slice(0, Math.max(0, position.column - 1));
    if (!/\.\s*[A-Za-z_$\w]*$/.test(linePrefix)) {
      return null;
    }

    const code = model.getValue();
    const cursorOffset = model.getOffsetAt(position);
    const word = model.getWordUntilPosition(position);
    const replacementStart = model.getOffsetAt({
      lineNumber: position.lineNumber,
      column: word.startColumn,
    });
    const patchedCode =
      code.slice(0, replacementStart) +
      MEMBER_COMPLETION_PLACEHOLDER +
      code.slice(cursorOffset);

    try {
      const ast = astApi.parse(patchedCode, AST_PARSE_OPTIONS);
      astApi.addParentLinks(ast);

      const member = findMemberCompletionTarget(ast, cursorOffset);
      if (member && member.object) {
        const context = createScopeContextForOffset(ast, member.object.start);
        const receiverType =
          context && context.scope && context.globals
            ? typeInference.normalizeReceiverType(
                typeInference.inferExpressionType(member.object, context.scope, context.globals),
              )
            : null;
        if (receiverType && typeInference.hasKnownMethodReceiver(receiverType)) {
          return {
            suggestions: buildMemberSuggestions(getCompletionRange(model, position), receiverType),
          };
        }
      }
    } catch (error) {
    }

    try {
      const fallbackContext = createScopeContextForOffset(
        astApi.parse(code, AST_PARSE_OPTIONS),
        cursorOffset,
      );
      const objectExpression = parseMemberObjectExpression(extractMemberObjectSource(linePrefix));
      if (
        fallbackContext &&
        objectExpression &&
        typeof astApi.addParentLinks === "function"
      ) {
        astApi.addParentLinks(objectExpression);
        const receiverType =
          fallbackContext && fallbackContext.scope && fallbackContext.globals
            ? typeInference.normalizeReceiverType(
                typeInference.inferExpressionType(
                  objectExpression,
                  fallbackContext.scope,
                  fallbackContext.globals,
                ),
              )
            : null;
        if (receiverType && typeInference.hasKnownMethodReceiver(receiverType)) {
          return {
            suggestions: buildMemberSuggestions(getCompletionRange(model, position), receiverType),
          };
        }
      }
    } catch (error) {
      return null;
    }

    return null;
  }

  function addCollectedNames(target, pattern, kind) {
    if (!pattern || !window.compilerGlobalBindingsPass) {
      return;
    }

    const names = [];
    window.compilerGlobalBindingsPass.collectNamesFromPattern(pattern, names);
    names.forEach((name) => {
      if (name && !target[name]) {
        target[name] = {
          kind: kind || "variable",
        };
      }
    });
  }

  function collectBindingsFromAst(code, cursorOffset) {
    const names = Object.create(null);
    const astApi = getAstApi();

    if (!astApi || typeof astApi.parse !== "function" || typeof astApi.walk !== "function") {
      return names;
    }

    try {
      const program = astApi.parse(code, AST_PARSE_OPTIONS);

      astApi.walk(program, (node) => {
        if (!node || typeof node.start !== "number" || node.start > cursorOffset) {
          return false;
        }

        if (node.type === "VariableDeclarator") {
          addCollectedNames(names, node.id, "variable");
          return;
        }

        if (node.type === "FunctionDeclaration" && node.id && node.id.name) {
          names[node.id.name] = {
            kind: "function",
          };
          (node.params || []).forEach((param) => addCollectedNames(names, param, "parameter"));
          return;
        }

        if (
          (node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") &&
          cursorOffset >= node.start &&
          cursorOffset <= node.end
        ) {
          (node.params || []).forEach((param) => addCollectedNames(names, param, "parameter"));
          return;
        }

        if (node.type === "CatchClause" && cursorOffset >= node.start && cursorOffset <= node.end) {
          addCollectedNames(names, node.param, "variable");
        }
      });
    } catch (error) {
      const fallbackPatterns = [
        /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
        /\bfunction\s+([A-Za-z_$][\w$]*)/g,
      ];

      fallbackPatterns.forEach((pattern) => {
        let match = pattern.exec(code);
        while (match) {
          if (!names[match[1]]) {
            names[match[1]] = {
              kind: pattern === fallbackPatterns[1] ? "function" : "variable",
            };
          }
          match = pattern.exec(code);
        }
      });
    }

    return names;
  }

  function buildUserBindingSuggestions(model, position, range, excludedNames) {
    if (typeof monaco === "undefined") {
      return [];
    }

    const code = model.getValue();
    const cursorOffset = model.getOffsetAt(position);
    const bindings = collectBindingsFromAst(code, cursorOffset);

    return Object.keys(bindings)
      .filter((name) => !(excludedNames && excludedNames[name]))
      .map((name) => {
        const binding = bindings[name] || {};
        const isFunction = binding.kind === "function";
        const detail =
          binding.kind === "parameter"
            ? "Current scope parameter"
            : isFunction
              ? "Current file function"
              : "Current file binding";

        return createSuggestion(range, {
          label: name,
          kind: isFunction
            ? monaco.languages.CompletionItemKind.Function
            : monaco.languages.CompletionItemKind.Variable,
          insertText: isFunction ? `${name}($0)` : name,
          detail,
          sortText: `2_${name}`,
        });
      });
  }

  function createController() {
    let completionProviderDisposable = null;

    function configure() {
      if (
        typeof monaco === "undefined" ||
        !monaco.languages ||
        !monaco.languages.typescript ||
        !monaco.languages.registerCompletionItemProvider
      ) {
        return;
      }

      monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
        allowNonTsExtensions: true,
        noLib: true,
        target: monaco.languages.typescript.ScriptTarget.ES2020,
      });

      if (completionProviderDisposable && typeof completionProviderDisposable.dispose === "function") {
        completionProviderDisposable.dispose();
      }

      completionProviderDisposable = monaco.languages.registerCompletionItemProvider("javascript", {
        triggerCharacters: [
          ".",
          "(",
          ",",
          "-",
          "'",
          "\"",
          ..."_$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
        ],
        provideCompletionItems(model, position) {
          const textFontContext = getTextFontFirstArgumentContext(model, position);
          if (textFontContext) {
            return buildFontSuggestions(textFontContext).then((fontSuggestions) => {
              const bindingSuggestions = buildUserBindingSuggestions(
                model,
                position,
                textFontContext.range,
              );
              return {
                suggestions: fontSuggestions.concat(bindingSuggestions),
              };
            });
          }

          const memberContext = getMemberCompletionContext(model, position);
          if (memberContext && memberContext.suggestions) {
            return {
              suggestions: memberContext.suggestions,
            };
          }

          const range = getCompletionRange(model, position);
          const momentumSuggestions = buildMomentumSuggestions(range);
          const excludedNames = Object.create(null);
          momentumSuggestions.forEach((suggestion) => {
            excludedNames[suggestion.label] = true;
          });

          return {
            suggestions: momentumSuggestions.concat(
              buildUserBindingSuggestions(model, position, range, excludedNames)
            ),
          };
        },
      });
    }

    return {
      configure,
    };
  }

  return {
    createController,
  };
})();
