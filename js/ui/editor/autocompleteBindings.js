// Owns AST scope, member-method, and user-binding completions.
window.momentumEditorBindingCompletions = (function () {
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

  function getRegistry() {
    return window.compilerSymbols.getRegistry();
  }

  function getAstApi() {
    return window.compilerAst;
  }

  function getSemantics() {
    return window.compilerSemantics;
  }

  function getTypeInference() {
    return window.compilerTypeInference;
  }

  function createService(options) {
    const {
      buildFunctionInsertText,
      createSuggestion,
      formatSignatureSummary,
      getCompletionRange,
      hasFollowingCallParen,
      isReplacingExistingArgumentValue,
    } = options;

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

    function buildMemberSuggestions(range, receiverType, model, options) {
      if (typeof monaco === "undefined" || !receiverType) {
        return [];
      }

      const hasTrailingParen = hasFollowingCallParen(model, range);
      const suppressCallParens = !!(options && options.suppressCallParens);

      return getMethodEntriesForReceiver(receiverType).map((entry) =>
        createSuggestion(range, {
          label: entry.name,
          kind: monaco.languages.CompletionItemKind.Method,
          insertText: buildFunctionInsertText(entry.name, entry.info && entry.info.signatures, {
            hasFollowingCallParen: hasTrailingParen || suppressCallParens,
          }),
          detail: `Momentum ${receiverType} method`,
          documentation: formatSignatureSummary(entry.info && entry.info.signatures),
          preselect: suppressCallParens,
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
              suggestions: buildMemberSuggestions(getCompletionRange(model, position), receiverType, model, {
                suppressCallParens: isReplacingExistingArgumentValue(model, position),
              }),
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
              suggestions: buildMemberSuggestions(getCompletionRange(model, position), receiverType, model, {
                suppressCallParens: isReplacingExistingArgumentValue(model, position),
              }),
            };
          }
        }
      } catch (error) {
        return null;
      }

      return null;
    }

    function addCollectedNames(target, pattern, kind) {
      if (!pattern) {
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

    function buildUserBindingSuggestions(model, position, range, excludedNames, options) {
      if (typeof monaco === "undefined") {
        return [];
      }

      const code = model.getValue();
      const cursorOffset = model.getOffsetAt(position);
      const bindings = collectBindingsFromAst(code, cursorOffset);
      const hasTrailingParen = hasFollowingCallParen(model, range);
      const suppressCallParens = !!(options && options.suppressCallParens);

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
            insertText: isFunction
              ? buildFunctionInsertText(name, [], {
                  hasFollowingCallParen: hasTrailingParen || suppressCallParens,
                })
              : name,
            detail,
            preselect: suppressCallParens && isFunction,
            sortText: `2_${name}`,
          });
        });
    }


    return {
      buildUserBindingSuggestions,
      getMemberCompletionContext,
    };
  }

  return { createService };
})();
