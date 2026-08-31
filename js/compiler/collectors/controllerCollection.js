window.compilerControllerCollectionPass = (function () {
  var CALLSITE_PREFIX = "__mcc_";
  var FACTORIES = {
    createSlider: true,
    createAngle: true,
    createColorPicker: true,
    createCheckbox: true,
    createSelect: true,
    createPoint: true,
  };
  var SELECT_METHODS = {
    option: true,
    selected: true,
  };

  function isFactoryName(name) {
    return !!FACTORIES[String(name || "")];
  }

  function programFrom(input) {
    if (!input) return null;
    if (input.type === "Program") return input;
    return input.rawAst || input.ast || null;
  }

  function bindingName(node) {
    if (!node || typeof node !== "object") return "";
    if (node.type === "Identifier") return node.name || "";
    if (
      node.type === "MemberExpression" &&
      !node.computed &&
      node.property &&
      node.property.type === "Identifier"
    ) {
      var owner = bindingName(node.object);
      return owner ? owner + "." + node.property.name : "";
    }
    return "";
  }

  function ownerBinding(expression) {
    var owner = expression && expression.parent;
    if (owner && owner.type === "VariableDeclarator" && owner.init === expression) {
      return bindingName(owner.id);
    }
    if (owner && owner.type === "AssignmentExpression" && owner.right === expression) {
      return bindingName(owner.left);
    }
    return "";
  }

  function selectMethod(call) {
    var callee = call && call.type === "CallExpression" ? call.callee : null;
    return callee &&
      callee.type === "MemberExpression" &&
      !callee.computed &&
      callee.property &&
      callee.property.type === "Identifier" &&
      SELECT_METHODS[callee.property.name]
      ? callee.property.name
      : "";
  }

  function readSelectChain(call) {
    var cursor = call;
    var steps = [];
    var method = selectMethod(cursor);
    while (method) {
      steps.unshift({
        method: method,
        args: cursor.arguments || [],
        sourceEnd: Number(cursor.end) || 0,
      });
      cursor = cursor.callee.object;
      method = selectMethod(cursor);
    }
    return { root: cursor, steps: steps };
  }

  function readFactorySelectChain(factoryCall) {
    var cursor = factoryCall;
    var steps = [];
    while (true) {
      var member = cursor && cursor.parent;
      var call = member && member.parent;
      if (
        !member ||
        member.type !== "MemberExpression" ||
        member.object !== cursor ||
        member.computed ||
        !member.property ||
        member.property.type !== "Identifier" ||
        !SELECT_METHODS[member.property.name] ||
        !call ||
        call.type !== "CallExpression" ||
        call.callee !== member
      ) {
        break;
      }
      steps.push({
        method: member.property.name,
        args: call.arguments || [],
        sourceEnd: Number(call.end) || 0,
      });
      cursor = call;
    }
    return { outer: cursor, steps: steps };
  }

  function isInnerSelectCall(call) {
    var member = call && call.parent;
    var outer = member && member.parent;
    return !!(
      member &&
      member.type === "MemberExpression" &&
      member.object === call &&
      !member.computed &&
      member.property &&
      member.property.type === "Identifier" &&
      SELECT_METHODS[member.property.name] &&
      outer &&
      outer.type === "CallExpression" &&
      outer.callee === member
    );
  }

  function literalValue(node) {
    if (!node) return undefined;
    if (node.type === "Literal") return node.value;
    if (node.type === "Identifier") {
      if (node.name === "undefined") return undefined;
      if (node.name === "true") return true;
      if (node.name === "false") return false;
      return undefined;
    }
    if (node.type === "UnaryExpression") {
      var nested = literalValue(node.argument);
      if (typeof nested !== "number") return undefined;
      if (node.operator === "+") return +nested;
      if (node.operator === "-") return -nested;
      return undefined;
    }
    if (node.type === "ArrayExpression") {
      return (node.elements || []).map(literalValue);
    }
    return undefined;
  }

  function numberArg(args, index, fallback) {
    var value = literalValue(args[index]);
    return typeof value === "number" && isFinite(value) ? value : fallback;
  }

  function stringArg(args, index, fallback) {
    var value = literalValue(args[index]);
    return typeof value === "string" ? value : fallback;
  }

  function booleanArg(args, index, fallback) {
    var value = literalValue(args[index]);
    return typeof value === "boolean" ? value : fallback;
  }

  function callsiteId(node, factory) {
    var safeName = String(factory || "controller").replace(/[^\w$]/g, "_");
    var start = node && node.loc && node.loc.start;
    return start && typeof start.line === "number" && typeof start.column === "number"
      ? CALLSITE_PREFIX + safeName + "_" + start.line + "_" + start.column
      : CALLSITE_PREFIX + safeName;
  }

  function colorConfig(args) {
    if (!args.length) return { type: "color", value: [255, 255, 255, 255] };
    if (args.length === 1) {
      var value = literalValue(args[0]);
      if (typeof value === "string" || Array.isArray(value)) {
        return { type: "color", value: value };
      }
    }
    return {
      type: "color",
      value: [
        numberArg(args, 0, 255),
        numberArg(args, 1, 255),
        numberArg(args, 2, 255),
        numberArg(args, 3, 255),
      ],
    };
  }

  function selectConfig(steps) {
    var config = { type: "select", options: [], value: 0 };
    for (var index = 0; index < steps.length; index++) {
      var step = steps[index];
      if (step.method === "option") {
        var label = stringArg(step.args, 0, "");
        var explicitValue = literalValue(step.args[1]);
        config.options.push({
          label: label,
          value: explicitValue !== undefined ? explicitValue : label,
        });
      } else if (step.method === "selected") {
        var selected = literalValue(step.args[0]);
        if (typeof selected === "number" && isFinite(selected)) {
          config.value = Math.max(0, Math.floor(selected));
        } else {
          for (var optionIndex = 0; optionIndex < config.options.length; optionIndex++) {
            var option = config.options[optionIndex];
            if (option.value === selected || option.label === selected) {
              config.value = optionIndex;
              break;
            }
          }
        }
      }
    }
    return config;
  }

  function staticConfig(entry) {
    var args = entry.argNodes;
    var config = null;
    if (entry.factory === "createSlider") {
      config = {
        type: "slider",
        min: numberArg(args, 0, 0),
        max: numberArg(args, 1, 100),
        value: numberArg(args, 2, numberArg(args, 0, 0)),
        step: numberArg(args, 3, 0),
      };
    } else if (entry.factory === "createAngle") {
      config = { type: "angle", value: numberArg(args, 0, 0) };
    } else if (entry.factory === "createColorPicker") {
      config = colorConfig(args);
    } else if (entry.factory === "createCheckbox") {
      config = { type: "checkbox", value: booleanArg(args, 1, false) };
      var checkboxLabel = stringArg(args, 0, "");
      if (checkboxLabel) config.label = checkboxLabel;
    } else if (entry.factory === "createSelect") {
      config = selectConfig(entry.selectSteps);
    } else if (entry.factory === "createPoint") {
      config = {
        type: "point",
        value: [numberArg(args, 0, 0), numberArg(args, 1, 0)],
      };
    }
    if (!config) return null;
    config.id = callsiteId(entry.callNode, entry.factory);
    if (entry.binding) config.label = entry.binding;
    return config;
  }

  function analyze(input) {
    var program = programFrom(input);
    if (!program || !window.compilerAst) {
      return { declarations: [], configs: [], fingerprint: "[]" };
    }
    var entries = [];
    window.compilerAst.walk(program, function (node) {
      if (
        !node ||
        node.type !== "CallExpression" ||
        !node.callee ||
        node.callee.type !== "Identifier" ||
        !isFactoryName(node.callee.name)
      ) {
        return;
      }
      var chain = node.callee.name === "createSelect"
        ? readFactorySelectChain(node)
        : { outer: node, steps: [] };
      entries.push({
        factory: node.callee.name,
        binding: ownerBinding(chain.outer),
        argNodes: node.arguments || [],
        selectSteps: chain.steps,
        sourceStart: Number(node.start) || 0,
        callNode: node,
      });
    });

    entries.sort(function (left, right) { return left.sourceStart - right.sourceStart; });
    var selectsByBinding = Object.create(null);
    for (var index = 0; index < entries.length; index++) {
      if (entries[index].factory === "createSelect" && entries[index].binding) {
        selectsByBinding[entries[index].binding] = entries[index];
      }
    }

    window.compilerAst.walk(program, function (node) {
      if (!selectMethod(node) || isInnerSelectCall(node)) return;
      var chain = readSelectChain(node);
      var entry = selectsByBinding[bindingName(chain.root)];
      if (entry) entry.selectSteps = entry.selectSteps.concat(chain.steps);
    });

    var declarations = [];
    var configs = [];
    for (var entryIndex = 0; entryIndex < entries.length; entryIndex++) {
      var entry = entries[entryIndex];
      entry.selectSteps.sort(function (left, right) {
        return left.sourceEnd - right.sourceEnd;
      });
      var declaration = {
        factory: entry.factory,
        args: window.compilerAst.canonicalValue(entry.argNodes),
        selectSteps: entry.selectSteps.map(function (step) {
          return {
            method: step.method,
            args: window.compilerAst.canonicalValue(step.args),
          };
        }),
      };
      declarations.push(declaration);
      var config = staticConfig(entry);
      if (config) configs.push(config);
    }
    return {
      declarations: declarations,
      configs: configs,
      fingerprint: window.compilerAst.canonicalValue(declarations),
    };
  }

  return {
    analyze: analyze,
    callsiteId: callsiteId,
    callsitePrefix: CALLSITE_PREFIX,
    isFactoryName: isFactoryName,
  };
})();
