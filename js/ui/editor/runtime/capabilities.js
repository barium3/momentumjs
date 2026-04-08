(function () {
  function getRegistry() {
    return typeof window !== "undefined" ? window.functionRegistry || null : null;
  }

  function normalizeRuntimeModes(info) {
    var modes = info && Array.isArray(info.runtimeModes) ? info.runtimeModes.slice() : [];
    for (var i = 0; i < modes.length; i += 1) {
      if (modes[i] === "scene") {
        modes[i] = "vector";
      }
    }
    return modes;
  }

  function isBitmapOnlyEntry(info) {
    var modes = normalizeRuntimeModes(info);
    return modes.indexOf("bitmap") !== -1 && modes.indexOf("vector") === -1;
  }

  function inferCallReturnType(node, variableTypes, registry) {
    if (!node || !registry) return null;

    if (node.type === "Identifier") {
      return variableTypes[node.name] || null;
    }

    if (node.type !== "CallExpression") {
      return null;
    }

    var callee = node.callee;
    if (callee && callee.type === "Identifier") {
      var entry = registry.getFunctionEntry ? registry.getFunctionEntry(callee.name) : null;
      return entry && entry.returns ? entry.returns : null;
    }

    if (
      callee &&
      callee.type === "MemberExpression" &&
      !callee.computed &&
      callee.property &&
      callee.property.type === "Identifier"
    ) {
      var receiverType = inferCallReturnType(callee.object, variableTypes, registry);
      if (!receiverType && callee.object && callee.object.type === "Identifier") {
        receiverType = variableTypes[callee.object.name] || null;
      }
      if (!receiverType || !registry.getMethodEntry) {
        return null;
      }
      var methodEntry = registry.getMethodEntry(receiverType, callee.property.name);
      return methodEntry && methodEntry.returns ? methodEntry.returns : null;
    }

    return null;
  }

  function createBitmapRequirementDetector() {
    function detect(code) {
      var registry = getRegistry();
      if (!registry || typeof acorn === "undefined") {
        return {
          requiresBitmap: false,
          functions: [],
        };
      }

      var ast;
      try {
        ast = acorn.parse(String(code || ""), {
          ecmaVersion: "latest",
          sourceType: "script",
          allowHashBang: true,
        });
      } catch (_error) {
        return {
          requiresBitmap: false,
          functions: [],
        };
      }

      var variableTypes = Object.create(null);
      var required = Object.create(null);

      function remember(name) {
        if (!name) return;
        required[name] = true;
      }

      function visit(node) {
        if (!node || typeof node.type !== "string") {
          return;
        }

        switch (node.type) {
          case "Program":
          case "BlockStatement":
            for (var i = 0; i < node.body.length; i += 1) {
              visit(node.body[i]);
            }
            return;

          case "ExpressionStatement":
            visit(node.expression);
            return;

          case "VariableDeclaration":
            for (var d = 0; d < node.declarations.length; d += 1) {
              visit(node.declarations[d]);
            }
            return;

          case "VariableDeclarator":
            if (node.init) {
              visit(node.init);
              if (node.id && node.id.type === "Identifier") {
                var declaredType = inferCallReturnType(node.init, variableTypes, registry);
                if (declaredType) {
                  variableTypes[node.id.name] = declaredType;
                }
              }
            }
            return;

          case "AssignmentExpression":
            visit(node.right);
            if (node.left && node.left.type === "Identifier") {
              var assignedType = inferCallReturnType(node.right, variableTypes, registry);
              if (assignedType) {
                variableTypes[node.left.name] = assignedType;
              }
            }
            return;

          case "CallExpression":
            if (node.callee && node.callee.type === "Identifier") {
              var functionEntry =
                registry.getFunctionEntry && registry.getFunctionEntry(node.callee.name);
              if (isBitmapOnlyEntry(functionEntry)) {
                remember(node.callee.name);
              }
            } else if (
              node.callee &&
              node.callee.type === "MemberExpression" &&
              !node.callee.computed &&
              node.callee.property &&
              node.callee.property.type === "Identifier"
            ) {
              var receiverType = inferCallReturnType(node.callee.object, variableTypes, registry);
              if (!receiverType && node.callee.object.type === "Identifier") {
                receiverType = variableTypes[node.callee.object.name] || null;
              }
              if (receiverType && registry.getMethodEntry) {
                var methodEntry =
                  registry.getMethodEntry(receiverType, node.callee.property.name);
                if (isBitmapOnlyEntry(methodEntry)) {
                  remember(receiverType + "." + node.callee.property.name);
                }
              }
            }

            visit(node.callee);
            for (var a = 0; a < node.arguments.length; a += 1) {
              visit(node.arguments[a]);
            }
            return;

          case "IfStatement":
            visit(node.test);
            visit(node.consequent);
            visit(node.alternate);
            return;

          case "ForStatement":
            visit(node.init);
            visit(node.test);
            visit(node.update);
            visit(node.body);
            return;

          case "ForInStatement":
          case "ForOfStatement":
            visit(node.left);
            visit(node.right);
            visit(node.body);
            return;

          case "WhileStatement":
          case "DoWhileStatement":
            visit(node.test);
            visit(node.body);
            return;

          case "ReturnStatement":
            visit(node.argument);
            return;

          case "FunctionDeclaration":
          case "FunctionExpression":
          case "ArrowFunctionExpression":
            visit(node.body);
            return;

          case "SequenceExpression":
            for (var s = 0; s < node.expressions.length; s += 1) {
              visit(node.expressions[s]);
            }
            return;

          case "ArrayExpression":
            for (var e = 0; e < node.elements.length; e += 1) {
              visit(node.elements[e]);
            }
            return;

          case "ObjectExpression":
            for (var p = 0; p < node.properties.length; p += 1) {
              var property = node.properties[p];
              if (property && property.value) {
                visit(property.value);
              }
            }
            return;

          case "ConditionalExpression":
            visit(node.test);
            visit(node.consequent);
            visit(node.alternate);
            return;

          case "UnaryExpression":
          case "UpdateExpression":
            visit(node.argument);
            return;

          case "BinaryExpression":
          case "LogicalExpression":
            visit(node.left);
            visit(node.right);
            return;

          case "MemberExpression":
            visit(node.object);
            if (node.computed) {
              visit(node.property);
            }
            return;
        }
      }

      visit(ast);

      var functions = Object.keys(required).sort();
      return {
        requiresBitmap: functions.length > 0,
        functions: functions,
      };
    }

    return {
      detectBitmapRequirements: detect,
    };
  }

  if (typeof window !== "undefined") {
    window.momentumRuntimeCapabilities = createBitmapRequirementDetector();
  }
})();
