window.momentumEditorAutocomplete = (function () {
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
      suggestions.push({
        label: name,
        kind,
        insertText,
        insertTextRules:
          kind === monaco.languages.CompletionItemKind.Function ||
          kind === monaco.languages.CompletionItemKind.Method
            ? getCompletionInsertTextRule()
            : undefined,
        detail: categoryName ? `Momentum ${categoryName}` : "Momentum",
        documentation: formatSignatureSummary(item && item.signatures),
        range,
        sortText: `0_${name}`,
      });
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
        label: entry.label,
        kind: monaco.languages.CompletionItemKind.Snippet,
        insertText: entry.insertText,
        insertTextRules: entry.insertTextRules,
        detail: entry.detail,
        documentation: entry.documentation,
        range,
        sortText: `1_${entry.label}`,
      });
    });

    return suggestions;
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
    const astApi = window.compilerAst;

    if (!astApi || typeof astApi.parse !== "function" || typeof astApi.walk !== "function") {
      return names;
    }

    try {
      const program = astApi.parse(code, {
        ecmaVersion: 2020,
        sourceType: "script",
        locations: true,
      });

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

        return {
          label: name,
          kind: isFunction
            ? monaco.languages.CompletionItemKind.Function
            : monaco.languages.CompletionItemKind.Variable,
          insertText: isFunction ? `${name}($0)` : name,
          insertTextRules: isFunction ? getCompletionInsertTextRule() : undefined,
          detail:
            binding.kind === "parameter"
              ? "Current scope parameter"
              : isFunction
                ? "Current file function"
                : "Current file binding",
          range,
          sortText: `2_${name}`,
        };
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
          ..."_$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
        ],
        provideCompletionItems(model, position) {
          const linePrefix = model
            .getLineContent(position.lineNumber)
            .slice(0, Math.max(0, position.column - 1));

          if (/\.\s*[A-Za-z_$\w]*$/.test(linePrefix)) {
            return { suggestions: [] };
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
