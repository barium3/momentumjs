window.compilerCodeCueSafety = (function () {
  const SAFETY_VERSION = 7;
  const OMITTED_AST_KEYS = {
    start: true,
    end: true,
    loc: true,
    range: true,
    raw: true,
    parent: true,
  };
  const LIFECYCLE_CALLS = {
    createCanvas: true,
    pixelDensity: true,
    frameRate: true,
    duration: true,
    noLoop: true,
    loop: true,
    redraw: true,
    loadImage: true,
    loadFont: true,
    loadJSON: true,
    loadStrings: true,
    loadTable: true,
    loadXML: true,
    eval: true,
    Function: true,
  };
  const ENTRYPOINT_NAMES = {
    draw: true,
    setup: true,
    preload: true,
  };
  const DYNAMIC_CALLS = {
    eval: true,
    Function: true,
  };

  function normalizeSource(input) {
    let source = String(input == null ? "" : input);
    if (source.charCodeAt(0) === 0xfeff) {
      source = source.slice(1);
    }
    return source.replace(/\r\n?/g, "\n").replace(/\n+$/g, "");
  }

  function hashText(input) {
    const text = String(input == null ? "" : input);
    let first = 2166136261;
    let second = 5381;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      first ^= code;
      first = Math.imul(first, 16777619);
      second = Math.imul(second, 33) ^ code;
    }
    return `${(first >>> 0).toString(16).padStart(8, "0")}${
      (second >>> 0).toString(16).padStart(8, "0")
    }`;
  }

  function canonicalValue(value) {
    return window.compilerAst.canonicalValue(value);
  }

  function parseSource(source) {
    if (typeof acorn === "undefined") return null;
    try {
      return acorn.parse(source, {
        ecmaVersion: 2020,
        sourceType: "script",
        allowHashBang: true,
      });
    } catch (_parseError) {
      return null;
    }
  }

  function isStandardFunctionDeclaration(node) {
    return !!(
      node &&
      node.type === "FunctionDeclaration" &&
      node.id &&
      node.id.type === "Identifier" &&
      node.id.name &&
      !node.async &&
      !node.generator
    );
  }

  function isStandardFunctionExpression(node) {
    return !!(
      node &&
      node.type === "FunctionExpression" &&
      !node.async &&
      !node.generator
    );
  }

  function isStandardClassDeclaration(node) {
    return !!(
      node &&
      node.type === "ClassDeclaration" &&
      node.id &&
      node.id.type === "Identifier" &&
      node.id.name
    );
  }

  function isPatchableClassDeclaration(node) {
    if (!isStandardClassDeclaration(node)) return false;
    if (
      node.superClass &&
      (node.superClass.type !== "Identifier" || !node.superClass.name)
    ) {
      return false;
    }
    const elements = node.body && Array.isArray(node.body.body) ? node.body.body : [];
    return elements.every((element) => !!(
      element &&
      element.type === "MethodDefinition" &&
      !element.computed &&
      element.value &&
      isStandardFunctionExpression(element.value)
    ));
  }

  function collectTopLevelPatchBindings(program) {
    const bindings = Object.create(null);
    let duplicateName = "";
    const addBinding = (descriptor) => {
      if (!descriptor || !descriptor.name || duplicateName) return;
      if (bindings[descriptor.name]) {
        duplicateName = descriptor.name;
        return;
      }
      bindings[descriptor.name] = descriptor;
    };
    const body = program && Array.isArray(program.body) ? program.body : [];
    for (let index = 0; index < body.length; index += 1) {
      const node = body[index];
      if (isStandardFunctionDeclaration(node)) {
        addBinding({
          name: node.id.name,
          type: "function",
          form: "function-declaration",
          node,
          valueNode: node,
          statement: node,
          variableKind: "",
        });
        continue;
      }
      if (isPatchableClassDeclaration(node)) {
        addBinding({
          name: node.id.name,
          type: "class",
          form: "class-declaration",
          node,
          valueNode: node,
          statement: node,
          variableKind: "",
        });
        continue;
      }
      if (
        !node ||
        node.type !== "VariableDeclaration" ||
        (node.kind !== "var" && node.kind !== "let")
      ) {
        continue;
      }
      (node.declarations || []).forEach((declaration) => {
        if (
          !declaration ||
          !declaration.id ||
          declaration.id.type !== "Identifier" ||
          ENTRYPOINT_NAMES[declaration.id.name] ||
          !isStandardFunctionExpression(declaration.init)
        ) {
          return;
        }
        addBinding({
          name: declaration.id.name,
          type: "function",
          form: "function-expression",
          node: declaration,
          valueNode: declaration.init,
          statement: node,
          variableKind: node.kind,
        });
      });
    }
    return { bindings, duplicateName };
  }

  function functionShell(binding) {
    const node = binding && binding.valueNode;
    return {
      type: "MomentumPatchableFunction",
      name: binding ? binding.name : "",
      async: false,
      generator: false,
      params: binding && binding.name === "draw"
        ? (node && node.params || [])
        : "soft-helper-signature",
    };
  }

  function isPurePrimitiveExpression(node) {
    if (!node) return false;
    if (node.type === "Literal") {
      return (
        node.value === null ||
        typeof node.value === "number" ||
        typeof node.value === "string" ||
        typeof node.value === "boolean"
      );
    }
    if (
      node.type === "UnaryExpression" &&
      (node.operator === "+" || node.operator === "-" ||
        node.operator === "!" || node.operator === "~" || node.operator === "void")
    ) {
      return isPurePrimitiveExpression(node.argument);
    }
    if (
      node.type === "BinaryExpression" &&
      node.operator !== "in" &&
      node.operator !== "instanceof"
    ) {
      return isPurePrimitiveExpression(node.left) && isPurePrimitiveExpression(node.right);
    }
    if (node.type === "ConditionalExpression") {
      return (
        isPurePrimitiveExpression(node.test) &&
        isPurePrimitiveExpression(node.consequent) &&
        isPurePrimitiveExpression(node.alternate)
      );
    }
    if (node.type === "TemplateLiteral" && (node.expressions || []).length === 0) {
      return true;
    }
    return false;
  }

  function isPureJsonConfigExpression(node) {
    if (isPurePrimitiveExpression(node)) return true;
    if (node && node.type === "ArrayExpression") {
      return (node.elements || []).every(
        (element) => !!element && element.type !== "SpreadElement" &&
          isPureJsonConfigExpression(element)
      );
    }
    if (node && node.type === "ObjectExpression") {
      return (node.properties || []).every((property) => {
        if (
          !property ||
          property.type !== "Property" ||
          property.kind !== "init" ||
          property.computed ||
          property.method ||
          property.shorthand
        ) {
          return false;
        }
        const keyName = property.key && property.key.type === "Identifier"
          ? property.key.name
          : (property.key && property.key.type === "Literal" ? property.key.value : "");
        return keyName !== "__proto__" && isPureJsonConfigExpression(property.value);
      });
    }
    return false;
  }

  function configExpressionShape(node) {
    if (node && node.type === "ArrayExpression") return "array";
    if (node && node.type === "ObjectExpression") return "object";
    return "primitive";
  }

  function memberRootIdentifier(node) {
    let current = node;
    while (current && current.type === "MemberExpression") {
      current = current.object;
    }
    return current && current.type === "Identifier" ? current.name : "";
  }

  function objectPropertyKey(property) {
    if (!property || property.computed) return null;
    if (property.key && property.key.type === "Identifier") return property.key.name;
    if (property.key && property.key.type === "Literal") {
      return String(property.key.value);
    }
    return null;
  }

  function uniformConfigElementShape(nodes) {
    const values = Array.isArray(nodes) ? nodes.filter(Boolean) : [];
    if (values.length === 0) return "";
    const shape = configExpressionShape(values[0]);
    return values.every((node) => configExpressionShape(node) === shape) ? shape : "";
  }

  function resolveConfigMemberShape(initNode, memberNode) {
    const accesses = [];
    let currentMember = memberNode;
    while (currentMember && currentMember.type === "MemberExpression") {
      if (currentMember.computed) {
        const property = currentMember.property;
        if (property && property.type === "Literal") {
          accesses.unshift({ dynamic: false, key: String(property.value) });
        } else {
          accesses.unshift({ dynamic: true, key: "" });
        }
      } else if (currentMember.property && currentMember.property.type === "Identifier") {
        accesses.unshift({ dynamic: false, key: currentMember.property.name });
      } else {
        return "";
      }
      currentMember = currentMember.object;
    }

    let currentValue = initNode;
    for (let index = 0; index < accesses.length; index += 1) {
      const access = accesses[index];
      const isLast = index === accesses.length - 1;
      if (currentValue && currentValue.type === "ArrayExpression") {
        if (!access.dynamic && access.key === "length") {
          return isLast ? "primitive" : "";
        }
        if (access.dynamic) {
          return isLast ? uniformConfigElementShape(currentValue.elements) : "";
        }
        const numericIndex = Number(access.key);
        if (!Number.isInteger(numericIndex) || numericIndex < 0) return "";
        currentValue = currentValue.elements[numericIndex] || null;
        continue;
      }
      if (currentValue && currentValue.type === "ObjectExpression") {
        if (access.dynamic) {
          const values = (currentValue.properties || []).map((property) => property.value);
          return isLast ? uniformConfigElementShape(values) : "";
        }
        const property = (currentValue.properties || []).find(
          (candidate) => objectPropertyKey(candidate) === access.key
        );
        currentValue = property ? property.value : null;
        continue;
      }
      return "";
    }
    return currentValue ? configExpressionShape(currentValue) : "";
  }

  function collectWrittenIdentifierNames(program) {
    const written = Object.create(null);
    const markPattern = (pattern) => {
      collectPatternNames(pattern, (name) => { written[name] = true; });
    };
    walkAst(program, (node) => {
      if (node.type === "AssignmentExpression") {
        markPattern(node.left);
        if (node.left && node.left.type === "MemberExpression") {
          const rootName = memberRootIdentifier(node.left);
          if (rootName) written[rootName] = true;
        }
        if (
          node.left &&
          node.left.type === "MemberExpression" &&
          !node.left.computed &&
          node.left.object &&
          node.left.object.type === "Identifier" &&
          (node.left.object.name === "window" || node.left.object.name === "globalThis") &&
          node.left.property &&
          node.left.property.type === "Identifier"
        ) {
          written[node.left.property.name] = true;
        }
      } else if (node.type === "UpdateExpression") {
        markPattern(node.argument);
        if (node.argument && node.argument.type === "MemberExpression") {
          const rootName = memberRootIdentifier(node.argument);
          if (rootName) written[rootName] = true;
        }
      } else if (
        node.type === "UnaryExpression" &&
        node.operator === "delete" &&
        node.argument &&
        node.argument.type === "MemberExpression"
      ) {
        const rootName = memberRootIdentifier(node.argument);
        if (rootName) written[rootName] = true;
      } else if (node.type === "ForInStatement" || node.type === "ForOfStatement") {
        markPattern(node.left);
        if (node.left && node.left.type === "MemberExpression") {
          const rootName = memberRootIdentifier(node.left);
          if (rootName) written[rootName] = true;
        }
      }
      return null;
    }, null, null, "");
    return written;
  }

  function containsIdentifierReference(root, name) {
    let found = false;
    walkAst(root, (node, parent, key) => {
      if (
        !found &&
        node.type === "Identifier" &&
        node.name === name &&
        !isIgnoredIdentifierPosition(node, parent, key) &&
        !(parent && parent.type === "VariableDeclarator" && key === "id")
      ) {
        found = true;
      }
      return null;
    }, null, null, "");
    return found;
  }

  function hasUnsafeTopLevelConfigUse(program, name, declarationNode) {
    const body = program && Array.isArray(program.body) ? program.body : [];
    for (let index = 0; index < body.length; index += 1) {
      const statement = body[index];
      if (isStandardFunctionDeclaration(statement)) {
        if (
          (statement.id.name === "setup" || statement.id.name === "preload") &&
          containsIdentifierReference(statement, name)
        ) {
          return true;
        }
        continue;
      }
      if (isStandardClassDeclaration(statement)) {
        if (containsIdentifierReference(statement.superClass, name)) return true;
        const methods = statement.body && statement.body.body || [];
        for (let methodIndex = 0; methodIndex < methods.length; methodIndex += 1) {
          const method = methods[methodIndex];
          if (method && method.computed && containsIdentifierReference(method.key, name)) {
            return true;
          }
        }
        continue;
      }
      if (statement && statement.type === "VariableDeclaration") {
        const declarations = statement.declarations || [];
        for (let declarationIndex = 0;
             declarationIndex < declarations.length;
             declarationIndex += 1) {
          const declaration = declarations[declarationIndex];
          if (declaration.id && declaration.id.type === "Identifier" &&
              declaration.id.name === name) {
            continue;
          }
          if (
            isStandardFunctionExpression(declaration.init) &&
            declaration.id &&
            declaration.id.type === "Identifier" &&
            !ENTRYPOINT_NAMES[declaration.id.name]
          ) {
            continue;
          }
          if (containsIdentifierReference(declaration.init, name)) return true;
        }
        continue;
      }
      if (containsIdentifierReference(statement, name)) return true;
    }
    return false;
  }

  function hasUnsafeObjectConfigUse(program, name, declarationNode) {
    let unsafe = false;
    walkAst(program, (node, parent, key) => {
      if (unsafe) return null;
      if (
        (node.type === "CallExpression" || node.type === "NewExpression") &&
        node.callee &&
        node.callee.type === "MemberExpression" &&
        memberRootIdentifier(node.callee) === name
      ) {
        unsafe = true;
        return null;
      }
      if (
        node.type === "MemberExpression" &&
        memberRootIdentifier(node) === name &&
        !(parent && parent.type === "MemberExpression" && key === "object") &&
        resolveConfigMemberShape(declarationNode.init, node) !== "primitive"
      ) {
        unsafe = true;
        return null;
      }
      if (
        node.type !== "Identifier" ||
        node.name !== name ||
        isIgnoredIdentifierPosition(node, parent, key) ||
        (parent && parent.type === "VariableDeclarator" && key === "id" &&
          parent === declarationNode)
      ) {
        return null;
      }
      if (parent && parent.type === "MemberExpression" && key === "object") {
        return null;
      }
      unsafe = true;
      return null;
    }, null, null, "");
    return unsafe;
  }

  function collectSoftGlobalBindings(program) {
    const counts = Object.create(null);
    const candidates = Object.create(null);
    const written = collectWrittenIdentifierNames(program);
    const body = program && Array.isArray(program.body) ? program.body : [];
    body.forEach((statement) => {
      if (!statement || statement.type !== "VariableDeclaration") return;
      (statement.declarations || []).forEach((declaration) => {
        if (declaration.id && declaration.id.type === "Identifier") {
          counts[declaration.id.name] = (counts[declaration.id.name] || 0) + 1;
        }
      });
    });
    body.forEach((statement) => {
      if (
        !statement ||
        statement.type !== "VariableDeclaration"
      ) {
        return;
      }
      (statement.declarations || []).forEach((declaration) => {
        if (!declaration.id || declaration.id.type !== "Identifier") return;
        const name = declaration.id.name;
        const shape = configExpressionShape(declaration.init);
        const supportsKind =
          statement.kind === "var" ||
          statement.kind === "let" ||
          (statement.kind === "const" && shape !== "primitive");
        if (
          !supportsKind ||
          counts[name] !== 1 ||
          written[name] ||
          !isPureJsonConfigExpression(declaration.init) ||
          hasUnsafeTopLevelConfigUse(program, name, statement) ||
          (shape !== "primitive" && hasUnsafeObjectConfigUse(program, name, declaration))
        ) {
          return;
        }
        candidates[name] = {
          name,
          kind: statement.kind,
          declaration,
          statement,
          init: declaration.init,
          shape,
        };
      });
    });
    return candidates;
  }

  function variableDeclarationShell(node, softGlobals, patchBindings) {
    const declarations = [];
    (node.declarations || []).forEach((declaration) => {
      const name = declaration.id && declaration.id.type === "Identifier"
        ? declaration.id.name
        : "";
      if (name && softGlobals[name]) return;
      const patchBinding = name && patchBindings[name];
      if (
        patchBinding &&
        patchBinding.form === "function-expression" &&
        patchBinding.node === declaration
      ) {
        declarations.push({
          type: "VariableDeclarator",
          id: declaration.id,
          init: { type: "MomentumPatchableFunctionExpression", name },
        });
        return;
      }
      declarations.push(declaration);
    });
    if (declarations.length === 0) return null;
    return {
      type: "VariableDeclaration",
      kind: node.kind,
      declarations,
    };
  }

  function buildContextCanonical(program, softGlobals, patchBindings) {
    const body = program && Array.isArray(program.body) ? program.body : [];
    const contextBody = [];
    body.forEach((node) => {
      if (isStandardFunctionDeclaration(node)) {
        if (node.id.name === "setup" || node.id.name === "preload") {
          contextBody.push(node);
        } else if (node.id.name === "draw") {
          contextBody.push(functionShell(patchBindings[node.id.name]));
        }
        return;
      }
      if (isPatchableClassDeclaration(node) && patchBindings[node.id.name]) return;
      if (node && node.type === "VariableDeclaration") {
        const shell = variableDeclarationShell(node, softGlobals, patchBindings);
        if (shell) contextBody.push(shell);
        return;
      }
      contextBody.push(node);
    });
    const bindingShape = Object.keys(patchBindings).sort().map((name) => {
      const binding = patchBindings[name];
      return {
        name,
        type: binding.type,
        form: binding.form,
        variableKind: binding.variableKind || "",
        lifecycle: name === "setup" || name === "preload"
          ? ""
          : collectLifecycleFingerprint(binding.valueNode),
      };
    });
    const frozenGlobals = Object.keys(softGlobals).sort().map((name) => {
      const binding = softGlobals[name];
      return {
        name,
        kind: binding.kind,
        shape: binding.shape,
        init: binding.init,
      };
    });
    return canonicalValue({
      program: {
        type: "Program",
        sourceType: program.sourceType,
        body: contextBody,
      },
      bindingShape,
      frozenGlobals,
    });
  }

  function isIgnoredIdentifierPosition(node, parent, key) {
    if (!parent) return false;
    if (parent.type === "VariableDeclarator" && key === "id") {
      return true;
    }
    if (
      (parent.type === "FunctionDeclaration" ||
        parent.type === "FunctionExpression" ||
        parent.type === "ClassDeclaration" ||
        parent.type === "ClassExpression") &&
      key === "id"
    ) {
      return true;
    }
    if (parent.type === "MemberExpression" && key === "property" && !parent.computed) {
      return true;
    }
    if (
      (parent.type === "Property" || parent.type === "MethodDefinition") &&
      key === "key" &&
      !parent.computed &&
      !parent.shorthand
    ) {
      return true;
    }
    if (
      (parent.type === "LabeledStatement" ||
        parent.type === "BreakStatement" ||
        parent.type === "ContinueStatement") &&
      key === "label"
    ) {
      return true;
    }
    return false;
  }

  function walkAst(node, visitor, state, parent, key) {
    if (!node || typeof node !== "object") return;
    const nextState = visitor(node, parent || null, key || "", state) || state;
    const keys = Object.keys(node);
    for (let index = 0; index < keys.length; index += 1) {
      const childKey = keys[index];
      if (OMITTED_AST_KEYS[childKey]) continue;
      const child = node[childKey];
      if (Array.isArray(child)) {
        for (let childIndex = 0; childIndex < child.length; childIndex += 1) {
          walkAst(child[childIndex], visitor, nextState, node, childKey);
        }
      } else if (child && typeof child === "object") {
        walkAst(child, visitor, nextState, node, childKey);
      }
    }
  }

  function isFunctionNode(node) {
    return !!(
      node &&
      (node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression")
    );
  }

  function collectPatternNames(pattern, callback) {
    if (!pattern) return;
    if (pattern.type === "Identifier") {
      callback(pattern.name);
      return;
    }
    if (pattern.type === "RestElement") {
      collectPatternNames(pattern.argument, callback);
      return;
    }
    if (pattern.type === "AssignmentPattern") {
      collectPatternNames(pattern.left, callback);
      return;
    }
    if (pattern.type === "ArrayPattern") {
      (pattern.elements || []).forEach((element) => collectPatternNames(element, callback));
      return;
    }
    if (pattern.type === "ObjectPattern") {
      (pattern.properties || []).forEach((property) => {
        if (property.type === "RestElement") {
          collectPatternNames(property.argument, callback);
        } else {
          collectPatternNames(property.value, callback);
        }
      });
    }
  }

  function createLexicalScope(parent) {
    return { parent: parent || null, bindings: Object.create(null) };
  }

  function addBinding(scope, name, kind) {
    if (scope && name) scope.bindings[name] = kind || "local";
  }

  function collectVarBindings(node, scope, isRoot) {
    if (!node || typeof node !== "object") return;
    if (!isRoot && isFunctionNode(node)) return;
    if (node.type === "VariableDeclaration" && node.kind === "var") {
      (node.declarations || []).forEach((declaration) => {
        collectPatternNames(declaration.id, (name) => addBinding(scope, name, "local"));
      });
    }
    Object.keys(node).forEach((key) => {
      if (OMITTED_AST_KEYS[key]) return;
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach((entry) => collectVarBindings(entry, scope, false));
      } else if (child && typeof child === "object") {
        collectVarBindings(child, scope, false);
      }
    });
  }

  function collectDirectLexicalBindings(body, scope, changed, topLevel) {
    (Array.isArray(body) ? body : []).forEach((statement) => {
      if (!statement) return;
      if (statement.type === "VariableDeclaration" && statement.kind !== "var") {
        (statement.declarations || []).forEach((declaration) => {
          collectPatternNames(declaration.id, (name) => addBinding(scope, name, "local"));
        });
      } else if (
        (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") &&
        statement.id
      ) {
        addBinding(
          scope,
          statement.id.name,
          topLevel && changed[statement.id.name] ? "changed-top-level" : "local"
        );
      }
    });
  }

  function resolveBinding(scope, name) {
    for (let current = scope; current; current = current.parent) {
      if (Object.prototype.hasOwnProperty.call(current.bindings, name)) {
        return current.bindings[name];
      }
    }
    return "";
  }

  function findUnsafeFunctionReference(
    program,
    changedNames,
    patchableFunctions,
    patchBindings,
  ) {
    let unsafe = "";
    const changed = Object.create(null);
    changedNames.forEach((name) => { changed[name] = true; });
    const ownerByNode = new Map();
    Object.keys(patchBindings || {}).forEach((name) => {
      const binding = patchBindings[name];
      if (binding && binding.type === "function" && binding.valueNode) {
        ownerByNode.set(binding.valueNode, name);
      }
    });

    function visit(node, scope, owner, parent, key) {
      if (!node || typeof node !== "object" || unsafe) return;
      if (node.type === "Program") {
        const programScope = createLexicalScope(scope);
        collectVarBindings(node, programScope, true);
        collectDirectLexicalBindings(node.body, programScope, changed, true);
        changedNames.forEach((name) => {
          addBinding(programScope, name, "changed-top-level");
        });
        (node.body || []).forEach((child) => visit(child, programScope, "", node, "body"));
        return;
      }
      if (isFunctionNode(node)) {
        const nextOwner = ownerByNode.get(node) || owner;
        const functionScope = createLexicalScope(scope);
        if (node.type === "FunctionExpression" && node.id) {
          addBinding(functionScope, node.id.name, "local");
        }
        (node.params || []).forEach((parameter) => {
          collectPatternNames(parameter, (name) => addBinding(functionScope, name, "local"));
          if (parameter.type === "AssignmentPattern") {
            visit(parameter.right, functionScope, nextOwner, parameter, "right");
          }
        });
        collectVarBindings(node.body, functionScope, true);
        visit(node.body, functionScope, nextOwner, node, "body");
        return;
      }
      if (node.type === "BlockStatement") {
        const blockScope = createLexicalScope(scope);
        collectDirectLexicalBindings(node.body, blockScope, changed, false);
        (node.body || []).forEach((child) => visit(child, blockScope, owner, node, "body"));
        return;
      }
      if (node.type === "CatchClause") {
        const catchScope = createLexicalScope(scope);
        collectPatternNames(node.param, (name) => addBinding(catchScope, name, "local"));
        visit(node.body, catchScope, owner, node, "body");
        return;
      }
      if (
        node.type === "Identifier" &&
        changed[node.name] &&
        !isIgnoredIdentifierPosition(node, parent, key) &&
        resolveBinding(scope, node.name) === "changed-top-level"
      ) {
        const directCall = parent && parent.type === "CallExpression" && parent.callee === node;
        if (!patchableFunctions[owner] || !directCall) {
          unsafe = `function-reference-escaped:${node.name}`;
        }
        return;
      }
      Object.keys(node).forEach((childKey) => {
        if (OMITTED_AST_KEYS[childKey] || unsafe) return;
        const child = node[childKey];
        if (Array.isArray(child)) {
          child.forEach((entry) => visit(entry, scope, owner, node, childKey));
        } else if (child && typeof child === "object") {
          visit(child, scope, owner, node, childKey);
        }
      });
    }

    visit(program, null, "", null, "");
    return unsafe;
  }

  function lifecycleControlContext(node, projectedChildren) {
    if (!node || !node.type) return null;
    if (node.type === "IfStatement" || node.type === "ConditionalExpression") {
      return { test: canonicalValue(node.test) };
    }
    if (node.type === "WhileStatement" || node.type === "DoWhileStatement") {
      return { test: canonicalValue(node.test) };
    }
    if (node.type === "ForStatement") {
      return {
        init: canonicalValue(node.init),
        test: canonicalValue(node.test),
        update: canonicalValue(node.update),
      };
    }
    if (node.type === "ForInStatement" || node.type === "ForOfStatement") {
      return {
        left: canonicalValue(node.left),
        right: canonicalValue(node.right),
        await: !!node.await,
      };
    }
    if (node.type === "SwitchStatement") {
      return { discriminant: canonicalValue(node.discriminant) };
    }
    if (node.type === "SwitchCase") {
      return { test: canonicalValue(node.test) };
    }
    if (node.type === "LogicalExpression") {
      const context = { operator: node.operator };
      if (!projectedChildren.left) context.left = canonicalValue(node.left);
      if (!projectedChildren.right) context.right = canonicalValue(node.right);
      return context;
    }
    if (node.type === "CallExpression" || node.type === "NewExpression") {
      return {
        callee: canonicalValue(node.callee),
        optional: !!node.optional,
      };
    }
    return null;
  }

  function lifecycleProjection(value) {
    if (!value || typeof value !== "object") return null;
    if (Array.isArray(value)) {
      const projected = value
        .map((entry) => lifecycleProjection(entry))
        .filter((entry) => entry !== null);
      return projected.length > 0 ? projected : null;
    }
    if (
      (value.type === "CallExpression" || value.type === "NewExpression") &&
      value.callee &&
      value.callee.type === "Identifier" &&
      (
        LIFECYCLE_CALLS[value.callee.name] ||
        window.compilerControllerCollectionPass.isFactoryName(value.callee.name)
      )
    ) {
      return {
        type: "MomentumLifecycleCall",
        syntax: canonicalValue(value),
      };
    }

    const projectedChildren = Object.create(null);
    Object.keys(value).forEach((key) => {
      if (OMITTED_AST_KEYS[key] || key === "type") return;
      const projected = lifecycleProjection(value[key]);
      if (projected !== null) projectedChildren[key] = projected;
    });
    const childKeys = Object.keys(projectedChildren);
    if (childKeys.length === 0) return null;

    const projection = { type: value.type || "MomentumAstObject" };
    childKeys.forEach((key) => { projection[key] = projectedChildren[key]; });
    const control = lifecycleControlContext(value, projectedChildren);
    if (control) projection.control = control;
    return projection;
  }

  function collectLifecycleFingerprint(functionNode) {
    if (!functionNode) return canonicalValue({ params: null, body: null });
    return canonicalValue({
      params: lifecycleProjection(functionNode.params || []),
      body: lifecycleProjection(functionNode.body),
    });
  }

  function findUnsafeChangedCode(previousNodes, nextNodes, bindingNames) {
    let unsafe = "";
    const nodeCount = Math.max(previousNodes.length, nextNodes.length);
    for (let functionIndex = 0; functionIndex < nodeCount; functionIndex += 1) {
      if (unsafe) return;
      const previousNode = previousNodes[functionIndex] || null;
      const functionNode = nextNodes[functionIndex] || null;
      const inspectNode = (root) => walkAst(
        root,
        (node) => {
          if (unsafe) return null;
          if (
            node.type === "WithStatement" ||
            node.type === "ImportExpression" ||
            node.type === "AwaitExpression" ||
            node.type === "YieldExpression"
          ) {
            unsafe = `dynamic-runtime-node:${node.type}`;
            return null;
          }
          if (
            (node.type === "CallExpression" || node.type === "NewExpression") &&
            node.callee &&
            node.callee.type === "Identifier" &&
            DYNAMIC_CALLS[node.callee.name]
          ) {
            unsafe = `dynamic-runtime-call:${node.callee.name}`;
            return null;
          }
          if (
            node.type === "AssignmentExpression" &&
            node.left &&
            node.left.type === "Identifier" &&
            ENTRYPOINT_NAMES[node.left.name]
          ) {
            unsafe = `entrypoint-assignment:${node.left.name}`;
            return null;
          }
          if (
            node.type === "UpdateExpression" &&
            node.argument &&
            node.argument.type === "Identifier" &&
            ENTRYPOINT_NAMES[node.argument.name]
          ) {
            unsafe = `entrypoint-update:${node.argument.name}`;
            return null;
          }
          if (
            node.type === "AssignmentExpression" &&
            node.left &&
            node.left.type === "MemberExpression" &&
            node.left.object &&
            node.left.object.type === "Identifier" &&
            (node.left.object.name === "window" || node.left.object.name === "globalThis")
          ) {
            unsafe = `global-environment-assignment:${node.left.object.name}`;
          }
          return null;
        },
        null,
        null,
        ""
      );
      if (functionNode) {
        (functionNode.params || []).forEach((parameter) => inspectNode(parameter));
        inspectNode(functionNode.body);
      }
      if (unsafe) return;

      if (
        collectLifecycleFingerprint(previousNode) !== collectLifecycleFingerprint(functionNode)
      ) {
        unsafe = `lifecycle-structure-changed:${
          bindingNames && bindingNames[functionIndex] || "binding"
        }`;
      }
    }
    return unsafe;
  }

  function hasTopLevelUseStrict(program) {
    const body = program && Array.isArray(program.body) ? program.body : [];
    for (let index = 0; index < body.length; index += 1) {
      const node = body[index];
      if (node && node.type === "ExpressionStatement" && node.directive === "use strict") {
        return true;
      }
      if (!node || node.type !== "ExpressionStatement" || !node.directive) {
        break;
      }
    }
    return false;
  }

  function bindingSource(description, binding) {
    const node = binding && binding.valueNode;
    return node ? description.source.slice(node.start, node.end) : "undefined";
  }

  function isDirectRuntimeBinding(binding) {
    return !!(binding && binding.form !== "function-declaration");
  }

  function buildAtomicTargetPatchSource(next, bindingNames) {
    const lines = ["(function(__momentumGlobal){"];
    const strictMode = next.strictMode;
    if (strictMode) lines.push('"use strict";');
    bindingNames.forEach((name, index) => {
      const nextBinding = next.patchBindings[name] || null;
      lines.push(`var __momentumNextBinding${index} = undefined;`);
      lines.push(`var __momentumAppliedBinding${index} = false;`);
      lines.push(
        `var __momentumHadBinding${index} = Object.prototype.hasOwnProperty.call(__momentumGlobal, ${JSON.stringify(name)});`
      );
      if (isDirectRuntimeBinding(nextBinding)) {
        lines.push(`var __momentumPreviousBinding${index} = ${name};`);
      } else {
        lines.push(
          `var __momentumPreviousBinding${index} = __momentumGlobal[${JSON.stringify(name)}];`
        );
      }
    });
    lines.push("try {");
    bindingNames.forEach((name, index) => {
      const nextBinding = next.patchBindings[name] || null;
      lines.push(
        `__momentumNextBinding${index} = ${bindingSource(next, nextBinding)};`
      );
      lines.push(
        `if (typeof __momentumNextBinding${index} !== "function") throw new Error("Invalid Momentum target binding");`
      );
      if (isDirectRuntimeBinding(nextBinding)) {
        lines.push(`${name} = __momentumNextBinding${index};`);
      } else {
        lines.push(
          `__momentumGlobal[${JSON.stringify(name)}] = __momentumNextBinding${index};`
        );
      }
      lines.push(`__momentumAppliedBinding${index} = true;`);
    });
    lines.push("} catch (__momentumPatchError) {");
    bindingNames.slice().reverse().forEach((name) => {
      const index = bindingNames.indexOf(name);
      const nextBinding = next.patchBindings[name] || null;
      lines.push(`if (__momentumAppliedBinding${index}) {`);
      if (isDirectRuntimeBinding(nextBinding)) {
        lines.push(`${name} = __momentumPreviousBinding${index};`);
      } else {
        lines.push(
          `if (__momentumHadBinding${index}) { __momentumGlobal[${JSON.stringify(name)}] = __momentumPreviousBinding${index}; } ` +
          `else if (!delete __momentumGlobal[${JSON.stringify(name)}]) { __momentumGlobal[${JSON.stringify(name)}] = undefined; }`
        );
      }
      lines.push("}");
    });
    lines.push("throw __momentumPatchError;");
    lines.push("}");
    lines.push("})(this);");
    return lines.join("\n");
  }

  function describeSource(sourceValue) {
    const source = normalizeSource(sourceValue);
    const program = parseSource(source);
    if (!program) return null;
    const collected = collectTopLevelPatchBindings(program);
    const softGlobals = collectSoftGlobalBindings(program);
    const overlappingName = Object.keys(softGlobals).find(
      (name) => !!collected.bindings[name]
    ) || "";
    const drawBinding = collected.bindings.draw || null;
    const draw = drawBinding && drawBinding.valueNode || null;
    const validDraw = !!(
      draw &&
      drawBinding.form === "function-declaration" &&
      isStandardFunctionDeclaration(draw) &&
      (draw.params || []).length === 0
    );
    const patchableFunctions = Object.create(null);
    Object.keys(collected.bindings).forEach((name) => {
      if (
        collected.bindings[name].type === "function" &&
        name !== "setup" &&
        name !== "preload"
      ) {
        patchableFunctions[name] = true;
      }
    });
    return {
      source,
      program,
      patchBindings: collected.bindings,
      duplicateName: collected.duplicateName || overlappingName,
      draw,
      validDraw,
      patchableFunctions,
      softGlobals,
      contextCanonical: buildContextCanonical(program, softGlobals, collected.bindings),
      semanticCanonical: canonicalValue(program),
      strictMode: hasTopLevelUseStrict(program),
    };
  }

  function metadataForDescription(description, mode, reason) {
    return {
      safetyVersion: SAFETY_VERSION,
      mode: mode || "restart",
      reason: reason || "",
      contextHash: description ? hashText(description.contextCanonical) : "",
      semanticHash: description ? hashText(description.semanticCanonical) : "",
      targetPatchSource: "",
      hasDraw: !!(description && description.validDraw),
    };
  }

  function buildRestartMetadata(sourceValue) {
    const description = describeSource(sourceValue);
    if (!description) {
      return {
        safetyVersion: SAFETY_VERSION,
        mode: "restart",
        reason: "parse-failed",
        contextHash: "",
        semanticHash: "",
        targetPatchSource: "",
        hasDraw: false,
      };
    }
    const reason = description.duplicateName
      ? `duplicate-function:${description.duplicateName}`
      : (!description.validDraw ? "unsupported-draw-entry" : "target-unavailable");
    return metadataForDescription(description, "restart", reason);
  }

  function buildTargetMetadata(sourceValue) {
    const next = describeSource(sourceValue);
    if (!next) return buildRestartMetadata(sourceValue);
    const restart = (reason) => metadataForDescription(next, "restart", reason);
    if (next.duplicateName) {
      return restart(`duplicate-function:${next.duplicateName}`);
    }
    if (!next.validDraw) {
      return restart("unsupported-draw-entry");
    }
    const bindingNames = Object.keys(next.patchBindings).filter(
      (name) => name !== "setup" && name !== "preload"
    ).sort();
    if (bindingNames.some((name) => next.patchBindings[name].type !== "function")) {
      return restart("unsupported-target-class");
    }
    const unsafeReference = findUnsafeFunctionReference(
      next.program,
      bindingNames,
      next.patchableFunctions,
      next.patchBindings,
    );
    if (unsafeReference) return restart(unsafeReference);
    const targetNodes = bindingNames.map((name) => {
      const binding = next.patchBindings[name];
      return binding && binding.valueNode || null;
    });
    const unsafeCode = findUnsafeChangedCode(
      targetNodes,
      targetNodes,
      bindingNames,
    );
    if (unsafeCode) return restart(unsafeCode);
    const metadata = metadataForDescription(next, "soft", "ast-target-patch");
    metadata.targetPatchSource = buildAtomicTargetPatchSource(next, bindingNames);
    return metadata;
  }

  return {
    SAFETY_VERSION,
    buildTargetMetadata,
  };
})();
