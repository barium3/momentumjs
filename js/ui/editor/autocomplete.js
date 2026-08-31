// Registers Momentum-specific Monaco completion providers.
window.momentumEditorAutocomplete = (function () {
  const AST_PARSE_OPTIONS = {
    ecmaVersion: 2020,
    sourceType: "script",
    locations: true,
  };
  const fontCompletions = window.momentumEditorFontCompletions.createService({
    createSuggestion,
  });
  const bindingCompletions =
    window.momentumEditorBindingCompletions.createService({
      buildFunctionInsertText,
      createSuggestion,
      formatSignatureSummary,
      getCompletionRange,
      hasFollowingCallParen,
      isReplacingExistingArgumentValue,
    });
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
    return window.compilerSymbols.getRegistry();
  }

  function getAstApi() {
    return window.compilerAst;
  }

  function getCompletionInsertTextRule() {
    return monaco &&
      monaco.languages &&
      monaco.languages.CompletionItemInsertTextRule &&
      monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
      ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
      : 4;
  }

  function getSnippetInsertTextRule() {
    return getCompletionInsertTextRule();
  }

  function hasFollowingCallParen(model, range) {
    if (!model || !range || typeof range.endColumn !== "number") {
      return false;
    }

    const line = model.getLineContent(range.endLineNumber || range.startLineNumber);
    if (!line) {
      return false;
    }

    let index = Math.max(0, range.endColumn - 1);
    while (index < line.length) {
      const ch = line.charAt(index);
      if (!/\s/.test(ch)) {
        return ch === "(";
      }
      index += 1;
    }

    return false;
  }

  function isInsideExistingCallArguments(model, position) {
    function isInsideCallArgumentsByText() {
      if (!model || !position || typeof model.getValue !== "function" || typeof model.getOffsetAt !== "function") {
        return false;
      }

      const code = model.getValue();
      if (!code) {
        return false;
      }

      const offset = model.getOffsetAt(position);
      if (offset <= 0) {
        return false;
      }

      function previousNonWhitespaceIndex(index) {
        let i = index;
        while (i >= 0) {
          const ch = code.charAt(i);
          if (!/\s/.test(ch)) {
            return i;
          }
          i -= 1;
        }
        return -1;
      }

      function previousIdentifierToken(endIndex) {
        let i = endIndex;
        while (i >= 0 && /[A-Za-z0-9_$]/.test(code.charAt(i))) {
          i -= 1;
        }
        return code.slice(i + 1, endIndex + 1);
      }

      function isCallLikeParen(parenIndex) {
        const prevIndex = previousNonWhitespaceIndex(parenIndex - 1);
        if (prevIndex < 0) {
          return false;
        }

        const prevChar = code.charAt(prevIndex);
        if (/[A-Za-z0-9_$\]\)\}]/.test(prevChar)) {
          const token = /[A-Za-z0-9_$]/.test(prevChar)
            ? previousIdentifierToken(prevIndex)
            : "";
          if (token) {
            const lower = token.toLowerCase();
            if (
              lower === "if" ||
              lower === "for" ||
              lower === "while" ||
              lower === "switch" ||
              lower === "catch" ||
              lower === "function"
            ) {
              return false;
            }
          }
          return true;
        }

        return false;
      }

      const stack = [];
      let quote = null;
      let escaped = false;
      let lineComment = false;
      let blockComment = false;

      for (let i = 0; i < offset; i += 1) {
        const ch = code.charAt(i);
        const next = i + 1 < code.length ? code.charAt(i + 1) : "";

        if (lineComment) {
          if (ch === "\n") {
            lineComment = false;
          }
          continue;
        }

        if (blockComment) {
          if (ch === "*" && next === "/") {
            blockComment = false;
            i += 1;
          }
          continue;
        }

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

        if (ch === "/" && next === "/") {
          lineComment = true;
          i += 1;
          continue;
        }

        if (ch === "/" && next === "*") {
          blockComment = true;
          i += 1;
          continue;
        }

        if (ch === '"' || ch === "'" || ch === "`") {
          quote = ch;
          continue;
        }

        if (ch === "(") {
          stack.push({
            index: i,
            callLike: isCallLikeParen(i),
          });
          continue;
        }

        if (ch === ")") {
          if (stack.length) {
            stack.pop();
          }
        }
      }

      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].callLike) {
          return true;
        }
      }

      return false;
    }

    const astApi = getAstApi();
    if (!model || !position || !astApi || typeof astApi.parse !== "function" || typeof astApi.walk !== "function") {
      return isInsideCallArgumentsByText();
    }

    const code = model.getValue();
    if (!code) {
      return false;
    }

    const offset = model.getOffsetAt(position);
    let inside = false;

    try {
      const program = astApi.parse(code, AST_PARSE_OPTIONS);
      astApi.walk(program, (node) => {
        if (
          node &&
          (node.type === "CallExpression" || node.type === "NewExpression") &&
          node.callee &&
          typeof node.callee.end === "number" &&
          typeof node.end === "number" &&
          offset > node.callee.end &&
          offset < node.end - 1
        ) {
          inside = true;
          return false;
        }
      });
    } catch (_parseError) {
      return isInsideCallArgumentsByText();
    }

    return inside || isInsideCallArgumentsByText();
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

  function buildFunctionInsertText(name, signatures, options) {
    if (options && options.hasFollowingCallParen) {
      return name;
    }

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
      return `${name}($0)`;
    }

    return `${name}(${buildArgPlaceholderList(exactSignature.minArgs)})`;
  }

  function getEditorForModel(model) {
    return window.editorManager.editor &&
      window.editorManager.editor.getModel() === model
        ? window.editorManager.editor
        : null;
  }

  function getActiveSelectionRange(model, position) {
    const editor = getEditorForModel(model);
    const selection =
      editor && typeof editor.getSelection === "function"
        ? editor.getSelection()
        : null;

    if (
      selection &&
      typeof selection.isEmpty === "function" &&
      !selection.isEmpty() &&
      selection.startLineNumber === selection.endLineNumber &&
      selection.startLineNumber === position.lineNumber
    ) {
      const startColumn = Math.min(selection.startColumn, selection.endColumn);
      const endColumn = Math.max(selection.startColumn, selection.endColumn);

      if (startColumn <= position.column && position.column <= endColumn) {
        return new monaco.Range(
          position.lineNumber,
          startColumn,
          position.lineNumber,
          endColumn,
        );
      }
    }

    return null;
  }

  function isReplacingExistingArgumentValue(model, position) {
    return !!getActiveSelectionRange(model, position) && isInsideExistingCallArguments(model, position);
  }

  function getCompletionRange(model, position) {
    const selectionRange = getActiveSelectionRange(model, position);
    if (selectionRange) {
      return selectionRange;
    }

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
    const insertTextRules =
      typeof config.insertTextRules !== "undefined"
        ? config.insertTextRules
        : isCallable && typeof config.insertText === "string" && config.insertText.indexOf("$") >= 0
          ? getSnippetInsertTextRule()
          : undefined;

    return {
      label: config.label,
      kind: config.kind,
      insertText: config.insertText,
      insertTextRules,
      command: config.command,
      detail: config.detail,
      documentation: config.documentation,
      range,
      filterText: config.filterText,
      preselect: !!config.preselect,
      sortText: config.sortText,
    };
  }

  function buildMomentumSuggestions(range, model, options) {
    if (typeof monaco === "undefined") {
      return [];
    }

    const registry = getRegistry();
    if (!registry) {
      return [];
    }

    const suggestions = [];
    const seen = Object.create(null);
    const hasTrailingParen = hasFollowingCallParen(model, range);
    const suppressCallParens = !!(options && options.suppressCallParens);
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
      let insertTextRules;
      let command;

      if (type === "constant") {
        kind = monaco.languages.CompletionItemKind.Constant;
      } else if (type === "variable") {
        kind = monaco.languages.CompletionItemKind.Variable;
      } else if (type === "namespace") {
        kind = monaco.languages.CompletionItemKind.Module;
      } else if (type === "instance_method") {
        kind = monaco.languages.CompletionItemKind.Method;
      } else {
        insertText = buildFunctionInsertText(name, item && item.signatures, {
          hasFollowingCallParen: hasTrailingParen || suppressCallParens,
        });
        if (insertText.indexOf("$") >= 0) {
          insertTextRules = getSnippetInsertTextRule();
          if (name === "textFont") {
            command = {
              id: "editor.action.triggerSuggest",
              title: "Trigger Suggest",
            };
          }
        }
      }

      seen[name] = true;
      suggestions.push(
        createSuggestion(range, {
          label: name,
          kind,
          insertText,
          insertTextRules,
          command,
          detail: categoryName ? `Momentum ${categoryName}` : "Momentum",
          documentation: formatSignatureSummary(signatures),
          preselect: suppressCallParens && type !== "constant" && type !== "variable" && type !== "namespace",
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

  function configureJavaScriptDefaults() {
    const defaults =
      monaco &&
      monaco.languages &&
      monaco.languages.typescript &&
      monaco.languages.typescript.javascriptDefaults
        ? monaco.languages.typescript.javascriptDefaults
        : null;

    if (!defaults) {
      return;
    }

    defaults.setCompilerOptions({
      allowNonTsExtensions: true,
      noLib: true,
      target: monaco.languages.typescript.ScriptTarget.ES2020,
    });

    if (typeof defaults.setModeConfiguration === "function") {
      const currentModeConfiguration =
        defaults.modeConfiguration && typeof defaults.modeConfiguration === "object"
          ? defaults.modeConfiguration
          : {};

      defaults.setModeConfiguration({
        ...currentModeConfiguration,
        completionItems: false,
      });
    }
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

      configureJavaScriptDefaults();

      if (
        completionProviderDisposable &&
        typeof completionProviderDisposable.dispose === "function"
      ) {
        completionProviderDisposable.dispose();
      }

      completionProviderDisposable =
        monaco.languages.registerCompletionItemProvider("javascript", {
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
            const textFontContext = fontCompletions.getTextFontFirstArgumentContext(
              model,
              position,
            );
            if (textFontContext) {
              const suppressCallParens = isReplacingExistingArgumentValue(
                model,
                position,
              );
              return fontCompletions.buildFontSuggestions(textFontContext).then(
                (fontSuggestions) => {
                  const bindingSuggestions =
                    bindingCompletions.buildUserBindingSuggestions(
                    model,
                    position,
                    textFontContext.range,
                    null,
                    { suppressCallParens },
                  );
                  return {
                    suggestions: fontSuggestions.concat(bindingSuggestions),
                  };
                },
              );
            }

            const memberContext =
              bindingCompletions.getMemberCompletionContext(model, position);
            if (memberContext && memberContext.suggestions) {
              return {
                suggestions: memberContext.suggestions,
              };
            }

            const range = getCompletionRange(model, position);
            const suppressCallParens = isReplacingExistingArgumentValue(
              model,
              position,
            );
            const momentumSuggestions = buildMomentumSuggestions(range, model, {
              suppressCallParens,
            });
            const excludedNames = Object.create(null);
            momentumSuggestions.forEach((suggestion) => {
              excludedNames[suggestion.label] = true;
            });

            return {
              suggestions: momentumSuggestions.concat(
                bindingCompletions.buildUserBindingSuggestions(
                  model,
                  position,
                  range,
                  excludedNames,
                  { suppressCallParens },
                ),
              ),
            };
          },
        });
    }

    function dispose() {
      if (
        completionProviderDisposable &&
        typeof completionProviderDisposable.dispose === "function"
      ) {
        completionProviderDisposable.dispose();
      }
      completionProviderDisposable = null;
    }

    return {
      configure,
      dispose,
    };
  }

  return {
    createController,
  };
})();
