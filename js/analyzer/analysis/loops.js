// Rewrites render-driving uncertain loops into a max-bound analysis variant.

class LoopAnalyzer {
  constructor() {
    if (typeof getRenderFunctionNames === "function") {
      this.renderFunctions = getRenderFunctionNames();
    } else {
      throw new Error(
        "[LoopAnalyzer] functionRegistry not found. Please ensure registry.js is loaded.",
      );
    }
    this.uncertainProviders = this._createUncertainProviders();
  }

  buildMaxCode(code) {
    if (!code || !code.trim() || typeof acorn === "undefined") {
      return code;
    }

    let ast;
    try {
      ast = acorn.parse(code, { ecmaVersion: 2020, locations: false });
    } catch (e) {
      console.error("[LoopAnalyzer] AST 解析失败:", e);
      return code;
    }

    addAstParentLinks(ast, null);

    var controllerBounds = this._collectControllerBounds(ast);
    var frameCountMax = this._resolveFrameCountMax(ast);
    var variableDefs = this._collectVariableDefs(ast);
    var context = {
      code: code,
      controllerBounds: controllerBounds,
      frameCountMax: frameCountMax,
      variableDefs: variableDefs,
      warnings: [],
    };

    var renderCalls = this._collectRenderCalls(ast);
    var callGraph = this._buildFunctionCallGraph(ast);
    if (!renderCalls.length) {
      return code;
    }

    var replacementMap = new Map();
    for (var i = 0; i < renderCalls.length; i++) {
      var loops = this._findAffectingLoops(renderCalls[i], callGraph);
      for (var j = 0; j < loops.length; j++) {
        var rewriteResult = this._rewriteLoop(loops[j], context);
        var replacements = rewriteResult ? rewriteResult.replacements : null;
        if (replacements && replacements.length) {
          for (var r = 0; r < replacements.length; r++) {
            var repl = replacements[r];
            replacementMap.set(repl.start + ":" + repl.end, repl);
          }
        }
      }
    }

    if (replacementMap.size === 0) {
      return code;
    }

    return this._applyReplacements(code, Array.from(replacementMap.values()));
  }

  _slice(code, node) {
    if (!node) return "";
    return code.slice(node.start, node.end);
  }

  _applyReplacements(code, replacements) {
    if (!replacements || !replacements.length) return code;

    replacements.sort(function (a, b) {
      return b.start - a.start;
    });

    var out = code;
    for (var i = 0; i < replacements.length; i++) {
      var repl = replacements[i];
      out = out.slice(0, repl.start) + repl.text + out.slice(repl.end);
    }
    return out;
  }

  _collectRenderCalls(ast) {
    var calls = [];
    var self = this;

    walkAst(ast, function (node) {
      if (node.type !== "CallExpression") return;
      var funcName = getAstCalleeName(node.callee);
      if (funcName && self.renderFunctions.indexOf(funcName) !== -1) {
        calls.push({
          node: node,
          funcName: funcName,
          functionScope: self._findFunctionScope(node),
        });
      }
    });

    return calls;
  }

  _findFunctionScope(node) {
    var current = node;
    while (current) {
      if (
        current.type === "FunctionDeclaration" ||
        current.type === "FunctionExpression" ||
        current.type === "ArrowFunctionExpression"
      ) {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  _getFunctionName(fnNode) {
    if (!fnNode) return null;

    if (fnNode.type === "FunctionDeclaration" && fnNode.id) {
      return fnNode.id.name;
    }

    if (
      fnNode.type === "FunctionExpression" ||
      fnNode.type === "ArrowFunctionExpression"
    ) {
      var parent = fnNode.parent;
      if (!parent) return null;

      if (
        parent.type === "VariableDeclarator" &&
        parent.id &&
        parent.id.type === "Identifier"
      ) {
        return parent.id.name;
      }

      if (
        parent.type === "AssignmentExpression" &&
        parent.left &&
        parent.left.type === "Identifier"
      ) {
        return parent.left.name;
      }

      if (parent.type === "Property" && parent.key) {
        return parent.key.name || parent.key.value || null;
      }
    }

    return null;
  }

  _buildFunctionCallGraph(ast) {
    var callSitesByName = new Map();
    var self = this;

    walkAst(ast, function (node) {
      if (node.type !== "CallExpression") return;
      var calleeName = getAstCalleeName(node.callee);

      if (!calleeName) return;

      var callerFunction = self._findFunctionScope(node);
      if (!callerFunction) return;

      if (!callSitesByName.has(calleeName)) {
        callSitesByName.set(calleeName, []);
      }
      callSitesByName.get(calleeName).push({
        callNode: node,
        callerFunction: callerFunction,
      });
    });

    return callSitesByName;
  }

  _findAffectingLoops(renderCall, callGraph) {
    var loops = [];
    var loopKeys = Object.create(null);
    var visitedFns = Object.create(null);
    var visitedCalls = Object.create(null);
    var self = this;

    function addLoopsFromNode(node) {
      var current = node;
      while (current) {
        if (
          current.type === "ForStatement" ||
          current.type === "ForOfStatement" ||
          current.type === "ForInStatement" ||
          current.type === "WhileStatement" ||
          current.type === "DoWhileStatement"
        ) {
          var key = current.start + ":" + current.end;
          if (!loopKeys[key]) {
            loopKeys[key] = true;
            loops.push(current);
          }
        }
        current = current.parent;
      }
    }

    function visitFunction(fnNode) {
      var fnName = self._getFunctionName(fnNode);
      if (!fnName || visitedFns[fnName]) return;
      visitedFns[fnName] = true;

      var callSites = callGraph.get(fnName) || [];
      for (var i = 0; i < callSites.length; i++) {
        var site = callSites[i];
        var key = site.callNode.start + ":" + site.callNode.end;
        if (visitedCalls[key]) continue;
        visitedCalls[key] = true;
        addLoopsFromNode(site.callNode.parent);
        visitFunction(site.callerFunction);
      }
    }

    addLoopsFromNode(renderCall.node.parent);
    if (renderCall.functionScope) {
      visitFunction(renderCall.functionScope);
    }

    return loops;
  }

  _loopHasUncertainValue(loopNode, context) {
    if (!loopNode) return false;
    if (loopNode.type === "ForStatement") {
      var forInfo = this._getForLoopInfo(loopNode, context);
      return (
        (loopNode.init && this._hasUncertainValue(loopNode.init, context)) ||
        (loopNode.test && this._hasUncertainValue(loopNode.test, context)) ||
        (loopNode.update &&
          this._hasUncertainValue(loopNode.update, context)) ||
        (forInfo &&
          forInfo.initDefs &&
          this._defsHaveUncertainValue(forInfo.initDefs, context))
      );
    }
    if (
      loopNode.type === "ForOfStatement" ||
      loopNode.type === "ForInStatement"
    ) {
      return loopNode.right && this._hasUncertainValue(loopNode.right, context);
    }
    if (
      loopNode.type === "WhileStatement" ||
      loopNode.type === "DoWhileStatement"
    ) {
      var whileInfo = this._getWhileLoopInfo(loopNode, context);
      return (
        (loopNode.test && this._hasUncertainValue(loopNode.test, context)) ||
        (whileInfo &&
          whileInfo.initDefs &&
          this._defsHaveUncertainValue(whileInfo.initDefs, context)) ||
        (whileInfo &&
          whileInfo.updateExpr &&
          this._hasUncertainValue(whileInfo.updateExpr, context))
      );
    }
    return false;
  }

  _defsHaveUncertainValue(defs, context) {
    if (!defs || !defs.length) return false;
    for (var i = 0; i < defs.length; i++) {
      if (
        defs[i] &&
        defs[i].expr &&
        this._hasUncertainValue(defs[i].expr, context)
      ) {
        return true;
      }
    }
    return false;
  }

  _warn(context, loopNode, reason) {
    if (!context || !context.warnings || !loopNode || !reason) return;
    context.warnings.push({
      start: loopNode.start,
      end: loopNode.end,
      type: loopNode.type,
      reason: reason,
      code: this._slice(context.code, loopNode),
    });
  }

  _collectControllerBounds(ast) {
    var bounds = Object.create(null);
    var self = this;

    function setBound(name, config) {
      if (!name || !config) return;
      bounds[name] = config;
    }

    walkAst(ast, function (node) {
      if (node.type === "VariableDeclarator") {
        if (!node.id || node.id.type !== "Identifier" || !node.init) return;
        var info = self._getControllerFactoryBounds(node.init);
        if (info) {
          setBound(node.id.name, info);
        }
        return;
      }

      if (node.type === "AssignmentExpression") {
        if (!node.left || node.left.type !== "Identifier" || !node.right)
          return;
        var assignInfo = self._getControllerFactoryBounds(node.right);
        if (assignInfo) {
          setBound(node.left.name, assignInfo);
        }
      }
    });

    return bounds;
  }

  _collectVariableDefs(ast) {
    var defs = Object.create(null);
    var self = this;

    function addDef(name, expr, node) {
      if (!name || !expr || !node) return;
      if (!defs[name]) defs[name] = [];
      defs[name].push({
        expr: expr,
        scope: self._getResolutionScope(node),
        start: node.start,
        conditionalRoot: self._getConditionalRoot(node),
      });
    }

    walkAst(ast, function (node) {
      if (node.type === "VariableDeclarator") {
        if (!node.id || node.id.type !== "Identifier" || !node.init) return;
        addDef(node.id.name, node.init, node);
        return;
      }

      if (node.type === "AssignmentExpression") {
        if (
          !node.left ||
          node.left.type !== "Identifier" ||
          !node.right ||
          node.operator !== "="
        ) {
          return;
        }
        addDef(node.left.name, node.right, node);
      }
    });

    return defs;
  }

  _getResolutionScope(node) {
    var current = node;
    while (current) {
      if (
        current.type === "FunctionDeclaration" ||
        current.type === "FunctionExpression" ||
        current.type === "ArrowFunctionExpression" ||
        current.type === "Program"
      ) {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  _getScopeChain(node) {
    var chain = [];
    var current = node;
    while (current) {
      if (
        current.type === "FunctionDeclaration" ||
        current.type === "FunctionExpression" ||
        current.type === "ArrowFunctionExpression" ||
        current.type === "Program"
      ) {
        chain.push(current);
      }
      current = current.parent;
    }
    return chain;
  }

  _getConditionalRoot(node) {
    var current = node.parent;
    while (current) {
      if (
        current.type === "IfStatement" ||
        current.type === "ConditionalExpression"
      ) {
        return current;
      }
      if (
        current.type === "FunctionDeclaration" ||
        current.type === "FunctionExpression" ||
        current.type === "ArrowFunctionExpression" ||
        current.type === "Program"
      ) {
        break;
      }
      current = current.parent;
    }
    return null;
  }

  _resolveIdentifierExpr(name, refNode, context) {
    var defs = this._resolveIdentifierDefs(name, refNode, context);
    if (!defs || !defs.length) return null;
    var exprs = [];
    for (var i = 0; i < defs.length; i++) {
      exprs.push(defs[i].expr);
    }
    return exprs.length === 1 ? exprs[0] : exprs;
  }

  _resolveIdentifierDefs(name, refNode, context) {
    if (!name || !refNode || !context || !context.variableDefs) return null;

    var defs = context.variableDefs[name];
    if (!defs || !defs.length) return null;

    var scopeChain = this._getScopeChain(refNode);
    var bestScopeIndex = Infinity;
    var candidates = [];

    for (var i = 0; i < defs.length; i++) {
      var def = defs[i];
      if (!def || !(def.start < refNode.start)) continue;

      var scopeIndex = scopeChain.indexOf(def.scope);
      if (scopeIndex === -1) continue;

      if (scopeIndex < bestScopeIndex) {
        bestScopeIndex = scopeIndex;
        candidates = [def];
      } else if (scopeIndex === bestScopeIndex) {
        candidates.push(def);
      }
    }

    if (!candidates.length) return null;

    var latestUnconditional = null;
    for (var j = 0; j < candidates.length; j++) {
      var candidate = candidates[j];
      if (candidate.conditionalRoot) continue;
      if (!latestUnconditional || candidate.start > latestUnconditional.start) {
        latestUnconditional = candidate;
      }
    }
    if (latestUnconditional) {
      return [latestUnconditional];
    }

    var grouped = Object.create(null);
    for (var k = 0; k < candidates.length; k++) {
      var current = candidates[k];
      var key = current.conditionalRoot
        ? current.conditionalRoot.start + ":" + current.conditionalRoot.end
        : "plain";
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(current);
    }

    var bestGroup = null;
    var bestGroupLatest = -1;
    for (var groupKey in grouped) {
      var group = grouped[groupKey];
      var latest = -1;
      for (var g = 0; g < group.length; g++) {
        if (group[g].start > latest) latest = group[g].start;
      }
      if (latest > bestGroupLatest) {
        bestGroupLatest = latest;
        bestGroup = group;
      }
    }

    if (!bestGroup || !bestGroup.length) return null;

    var exprs = [];
    for (var x = 0; x < bestGroup.length; x++) {
      exprs.push(bestGroup[x]);
    }
    return exprs;
  }

  _getControllerFactoryBounds(node) {
    if (!node || node.type !== "CallExpression") return null;
    var name = getAstCalleeName(node.callee);
    if (name === "createSlider") {
      var min = this._toNumber(node.arguments[0], 0);
      var max = this._toNumber(node.arguments[1], 100);
      return {
        type: "slider",
        min: min,
        max: max,
      };
    }

    if (name === "createAngle") {
      return {
        type: "angle",
        min: 0,
        max: 360,
      };
    }

    return null;
  }

  _resolveFrameCountMax(ast) {
    var fps = 30;
    var durationSeconds = null;
    var self = this;

    walkAst(ast, function (node) {
      if (node.type !== "CallExpression") return;
      var name = getAstCalleeName(node.callee);
      if (name === "frameRate") {
        fps = self._toNumber(node.arguments[0], fps);
        return;
      }
      if (name === "duration") {
        durationSeconds = self._parseDurationArgs(node.arguments, fps);
      }
    });

    if (durationSeconds === null || !(durationSeconds > 0)) {
      return 10;
    }

    return Math.max(0, Math.ceil(durationSeconds * fps));
  }

  _parseDurationArgs(args, fps) {
    if (!args || !args.length) return null;

    if (args.length === 1 && args[0].type === "Literal") {
      if (typeof args[0].value === "number") {
        return Number(args[0].value);
      }
      if (typeof args[0].value === "string") {
        return this._parseDurationTimecode(args[0].value, fps);
      }
    }

    var nums = [];
    for (var i = 0; i < args.length; i++) {
      var num = this._toNumber(args[i], null);
      if (num === null) return null;
      nums.push(num);
    }

    if (nums.length === 1) return nums[0];
    if (nums.length === 2) return nums[0] + nums[1] / fps;
    if (nums.length === 3) return nums[0] * 60 + nums[1] + nums[2] / fps;
    if (nums.length === 4) {
      return nums[0] * 3600 + nums[1] * 60 + nums[2] + nums[3] / fps;
    }

    return null;
  }

  _parseDurationTimecode(value, fps) {
    var parts = String(value).split(":");
    if (parts.length !== 3 && parts.length !== 4) return null;

    var nums = [];
    for (var i = 0; i < parts.length; i++) {
      var n = Number(parts[i]);
      if (!(n === n)) return null;
      nums.push(n);
    }

    if (nums.length === 3) {
      return nums[0] * 60 + nums[1] + nums[2] / fps;
    }

    return nums[0] * 3600 + nums[1] * 60 + nums[2] + nums[3] / fps;
  }

  _rewriteForLoop(loopNode, context) {
    var info = this._getForLoopInfo(loopNode, context);
    if (!info) return null;
    var loopContext = {
      code: context.code,
      controllerBounds: context.controllerBounds,
      frameCountMax: context.frameCountMax,
      variableDefs: context.variableDefs,
      loopVar: info.loopVar,
    };

    var initChanged = false;
    var testChanged = false;
    var updateChanged = false;
    var replacements = [];

    var initText = this._slice(context.code, loopNode.init);
    var testText = this._slice(context.code, loopNode.test);
    var updateText = this._slice(context.code, loopNode.update);

    if (info.initExpr && this._hasUncertainValue(info.initExpr, loopContext)) {
      var initMode = info.direction === "dec" ? "max" : "min";
      var rewrittenInit = this._rewriteExpr(
        info.initExpr,
        initMode,
        loopContext,
      );
      if (rewrittenInit.changed) {
        initText =
          this._slice(context.code, info.initPrefix) + rewrittenInit.text;
        initChanged = true;
      }
    }

    if (info.initDefs && info.initDefs.length) {
      var rewrittenInitDefs = [];
      for (var d = 0; d < info.initDefs.length; d++) {
        var def = info.initDefs[d];
        if (!def || !this._hasUncertainValue(def.expr, loopContext)) continue;
        var initDefRewrite = this._rewriteExpr(
          def.expr,
          info.direction === "dec" ? "max" : "min",
          loopContext,
        );
        if (initDefRewrite.changed) {
          rewrittenInitDefs.push({
            start: def.expr.start,
            end: def.expr.end,
            text: initDefRewrite.text,
          });
        }
      }
      if (rewrittenInitDefs.length) {
        for (var rd = 0; rd < rewrittenInitDefs.length; rd++) {
          replacements.push(rewrittenInitDefs[rd]);
        }
      }
    }

    if (
      info.boundExpr &&
      this._hasUncertainValue(info.boundExpr, loopContext)
    ) {
      var testMode = info.direction === "dec" ? "min" : "max";
      var rewrittenTest = this._rewriteExpr(
        info.boundExpr,
        testMode,
        loopContext,
      );
      if (rewrittenTest.changed) {
        if (info.loopVarOnLeft) {
          testText =
            this._slice(context.code, info.testLeft) +
            " " +
            info.testOperator +
            " " +
            rewrittenTest.text;
        } else {
          testText =
            rewrittenTest.text +
            " " +
            info.testOperator +
            " " +
            this._slice(context.code, info.testRight);
        }
        testChanged = true;
      }
    }

    if (
      info.updateExpr &&
      this._hasUncertainValue(info.updateExpr, loopContext)
    ) {
      var rewrittenUpdate = this._rewriteExpr(
        info.updateExpr,
        "step",
        loopContext,
      );
      if (rewrittenUpdate.changed) {
        updateText =
          this._slice(context.code, info.updatePrefix) + rewrittenUpdate.text;
        updateChanged = true;
      }
    }

    if (initChanged) {
      replacements.push({
        start: loopNode.init.start,
        end: loopNode.init.end,
        text: initText,
      });
    }
    if (testChanged) {
      replacements.push({
        start: loopNode.test.start,
        end: loopNode.test.end,
        text: testText,
      });
    }
    if (updateChanged) {
      replacements.push({
        start: loopNode.update.start,
        end: loopNode.update.end,
        text: updateText,
      });
    }

    return replacements;
  }

  _rewriteIterableLoop(loopNode, context) {
    if (
      !loopNode ||
      (loopNode.type !== "ForOfStatement" &&
        loopNode.type !== "ForInStatement") ||
      !loopNode.right
    ) {
      return null;
    }

    if (!this._hasUncertainValue(loopNode.right, context)) {
      return [];
    }

    var rewrittenRight = this._rewriteExpr(loopNode.right, "max", context);
    if (!rewrittenRight.changed) {
      return null;
    }

    return [
      {
        start: loopNode.right.start,
        end: loopNode.right.end,
        text: rewrittenRight.text,
      },
    ];
  }

  _rewriteLoop(loopNode, context) {
    if (!loopNode) return null;
    var needsRewrite = this._loopHasUncertainValue(loopNode, context);

    if (loopNode.type === "ForStatement") {
      var replacements = this._rewriteForLoop(loopNode, context);
      if (replacements === null && needsRewrite) {
        this._warn(context, loopNode, "unsupported for-loop structure");
      }
      return { replacements: replacements };
    }

    if (
      loopNode.type === "ForOfStatement" ||
      loopNode.type === "ForInStatement"
    ) {
      var iterableReplacements = this._rewriteIterableLoop(loopNode, context);
      if (iterableReplacements === null && needsRewrite) {
        this._warn(
          context,
          loopNode,
          loopNode.type === "ForOfStatement"
            ? "unsupported for...of iterable"
            : "unsupported for...in iterable",
        );
      }
      return { replacements: iterableReplacements };
    }

    if (
      loopNode.type === "WhileStatement" ||
      loopNode.type === "DoWhileStatement"
    ) {
      var whileReplacements = this._rewriteWhileLoop(loopNode, context);
      if (whileReplacements === null && needsRewrite) {
        this._warn(context, loopNode, "unsupported while/do-while structure");
      }
      return { replacements: whileReplacements };
    }

    if (needsRewrite) {
      this._warn(context, loopNode, "unknown loop type");
    }
    return { replacements: null };
  }

  _rewriteWhileLoop(loopNode, context) {
    var info = this._getWhileLoopInfo(loopNode, context);
    if (!info) return null;

    var loopContext = {
      code: context.code,
      controllerBounds: context.controllerBounds,
      frameCountMax: context.frameCountMax,
      variableDefs: context.variableDefs,
      loopVar: info.loopVar,
    };
    var replacements = [];
    var initMode = info.direction === "dec" ? "max" : "min";

    if (info.initDefs && info.initDefs.length) {
      for (var d = 0; d < info.initDefs.length; d++) {
        var def = info.initDefs[d];
        if (!def || !this._hasUncertainValue(def.expr, loopContext)) continue;
        var rewrittenInit = this._rewriteExpr(def.expr, initMode, loopContext);
        if (rewrittenInit.changed) {
          replacements.push({
            start: def.expr.start,
            end: def.expr.end,
            text: rewrittenInit.text,
          });
        }
      }
    }

    if (
      info.boundExpr &&
      this._hasUncertainValue(info.boundExpr, loopContext)
    ) {
      var testMode = info.direction === "dec" ? "min" : "max";
      var rewrittenTest = this._rewriteExpr(
        info.boundExpr,
        testMode,
        loopContext,
      );
      if (rewrittenTest.changed) {
        replacements.push({
          start: loopNode.test.start,
          end: loopNode.test.end,
          text: info.loopVarOnLeft
            ? this._slice(context.code, info.testLeft) +
              " " +
              info.testOperator +
              " " +
              rewrittenTest.text
            : rewrittenTest.text +
              " " +
              info.testOperator +
              " " +
              this._slice(context.code, info.testRight),
        });
      }
    }

    if (
      info.updateExpr &&
      this._hasUncertainValue(info.updateExpr, loopContext)
    ) {
      var rewrittenUpdate = this._rewriteExpr(
        info.updateExpr,
        "step",
        loopContext,
      );
      if (rewrittenUpdate.changed) {
        replacements.push({
          start: info.updateExpr.start,
          end: info.updateExpr.end,
          text: rewrittenUpdate.text,
        });
      }
    }

    return replacements;
  }

  _getForLoopInfo(loopNode, context) {
    if (!loopNode || loopNode.type !== "ForStatement") return null;
    if (!loopNode.test || !loopNode.update) return null;

    var loopVar = null;
    var initExpr = null;
    var initPrefix = null;
    var initDefs = null;

    if (!loopNode.init) {
      if (loopNode.test.type !== "BinaryExpression") return null;
      if (loopNode.test.left && loopNode.test.left.type === "Identifier") {
        loopVar = loopNode.test.left.name;
      } else if (
        loopNode.test.right &&
        loopNode.test.right.type === "Identifier"
      ) {
        loopVar = loopNode.test.right.name;
      }
      if (!loopVar) return null;
      initDefs = context
        ? this._resolveIdentifierDefs(loopVar, loopNode, context)
        : null;
    } else if (loopNode.init.type === "VariableDeclaration") {
      if (
        !loopNode.init.declarations ||
        loopNode.init.declarations.length !== 1 ||
        !loopNode.init.declarations[0].id ||
        loopNode.init.declarations[0].id.type !== "Identifier" ||
        !loopNode.init.declarations[0].init
      ) {
        return null;
      }
      loopVar = loopNode.init.declarations[0].id.name;
      initExpr = loopNode.init.declarations[0].init;
      initPrefix = {
        start: loopNode.init.start,
        end: initExpr.start,
      };
    } else if (loopNode.init.type === "AssignmentExpression") {
      if (
        !loopNode.init.left ||
        loopNode.init.left.type !== "Identifier" ||
        !loopNode.init.right
      ) {
        return null;
      }
      loopVar = loopNode.init.left.name;
      initExpr = loopNode.init.right;
      initPrefix = {
        start: loopNode.init.start,
        end: initExpr.start,
      };
    } else {
      return null;
    }

    if (loopNode.test.type !== "BinaryExpression") return null;
    var operator = loopNode.test.operator;
    if (
      operator !== "<" &&
      operator !== "<=" &&
      operator !== ">" &&
      operator !== ">="
    ) {
      return null;
    }

    var left = loopNode.test.left;
    var right = loopNode.test.right;
    var loopVarOnLeft =
      left && left.type === "Identifier" && left.name === loopVar;
    var loopVarOnRight =
      right && right.type === "Identifier" && right.name === loopVar;

    if (!loopVarOnLeft && !loopVarOnRight) return null;

    var direction = null;
    var updateExpr = null;
    var updatePrefix = null;

    if (loopNode.update.type === "UpdateExpression") {
      if (
        !loopNode.update.argument ||
        loopNode.update.argument.type !== "Identifier" ||
        loopNode.update.argument.name !== loopVar
      ) {
        return null;
      }
      direction = loopNode.update.operator === "++" ? "inc" : "dec";
    } else if (loopNode.update.type === "AssignmentExpression") {
      var assignmentInfo = this._getLoopAssignmentInfo(
        loopNode.update,
        loopVar,
      );
      if (!assignmentInfo) return null;
      direction = assignmentInfo.direction;
      updateExpr = assignmentInfo.expr;
      updatePrefix = assignmentInfo.prefix;
    } else {
      return null;
    }

    if (
      (direction === "inc" &&
        !(
          (loopVarOnLeft && (operator === "<" || operator === "<=")) ||
          (loopVarOnRight && (operator === ">" || operator === ">="))
        )) ||
      (direction === "dec" &&
        !(
          (loopVarOnLeft && (operator === ">" || operator === ">=")) ||
          (loopVarOnRight && (operator === "<" || operator === "<="))
        ))
    ) {
      return null;
    }

    return {
      loopVar: loopVar,
      direction: direction,
      initExpr: initExpr,
      initDefs: initDefs,
      initPrefix: initPrefix,
      boundExpr: loopVarOnLeft ? right : left,
      loopVarOnLeft: loopVarOnLeft,
      testLeft: left,
      testRight: right,
      testOperator: operator,
      updateExpr: updateExpr,
      updatePrefix: updatePrefix,
    };
  }

  _getWhileLoopInfo(loopNode, context) {
    if (
      !loopNode ||
      (loopNode.type !== "WhileStatement" &&
        loopNode.type !== "DoWhileStatement") ||
      !loopNode.test
    ) {
      return null;
    }

    if (loopNode.test.type !== "BinaryExpression") return null;
    var operator = loopNode.test.operator;
    if (
      operator !== "<" &&
      operator !== "<=" &&
      operator !== ">" &&
      operator !== ">="
    ) {
      return null;
    }

    var left = loopNode.test.left;
    var right = loopNode.test.right;
    var loopVar = null;
    var loopVarOnLeft = false;

    if (left && left.type === "Identifier") {
      loopVar = left.name;
      loopVarOnLeft = true;
    } else if (right && right.type === "Identifier") {
      loopVar = right.name;
      loopVarOnLeft = false;
    } else {
      return null;
    }

    var updateInfo = this._findLoopVarUpdate(loopNode.body, loopVar);
    if (!updateInfo) return null;

    var direction = updateInfo.direction;
    if (
      (direction === "inc" &&
        !(
          (loopVarOnLeft && (operator === "<" || operator === "<=")) ||
          (!loopVarOnLeft && (operator === ">" || operator === ">="))
        )) ||
      (direction === "dec" &&
        !(
          (loopVarOnLeft && (operator === ">" || operator === ">=")) ||
          (!loopVarOnLeft && (operator === "<" || operator === "<="))
        ))
    ) {
      return null;
    }

    var initDefs = this._resolveIdentifierDefs(loopVar, loopNode, context);

    return {
      loopVar: loopVar,
      direction: direction,
      initDefs: initDefs,
      boundExpr: loopVarOnLeft ? right : left,
      loopVarOnLeft: loopVarOnLeft,
      testLeft: left,
      testRight: right,
      testOperator: operator,
      updateExpr: updateInfo.expr,
    };
  }

  _findLoopVarUpdate(bodyNode, loopVar) {
    if (!bodyNode || !loopVar) return null;
    var updates = [];
    var self = this;

    walkAst(bodyNode, function (node) {
      if (
        node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression"
      ) {
        return false;
      }

      if (node.type === "UpdateExpression") {
        if (
          node.argument &&
          node.argument.type === "Identifier" &&
          node.argument.name === loopVar
        ) {
          updates.push({
            direction: node.operator === "++" ? "inc" : "dec",
            expr: {
              type: "Literal",
              value: 1,
              start: node.start,
              end: node.end,
            },
          });
        }
        return;
      }

      if (node.type === "AssignmentExpression") {
        var info = self._getLoopAssignmentInfo(node, loopVar);
        if (!info) return;
        updates.push({
          direction: info.direction,
          expr: info.expr || {
            type: "Literal",
            value: 1,
            start: node.start,
            end: node.end,
          },
        });
      }
    });

    if (!updates.length) return null;

    var direction = updates[0].direction;
    var exprs = [];
    for (var i = 0; i < updates.length; i++) {
      if (updates[i].direction !== direction) return null;
      exprs.push(updates[i].expr);
    }
    return {
      direction: direction,
      expr: exprs.length === 1 ? exprs[0] : exprs,
    };
  }

  _getLoopAssignmentInfo(node, loopVar) {
    if (
      !node ||
      node.type !== "AssignmentExpression" ||
      !node.left ||
      node.left.type !== "Identifier" ||
      node.left.name !== loopVar ||
      !node.right
    ) {
      return null;
    }

    if (node.operator === "+=" || node.operator === "-=") {
      return {
        direction: node.operator === "+=" ? "inc" : "dec",
        expr: node.right,
        prefix: {
          start: node.start,
          end: node.right.start,
        },
      };
    }

    if (node.operator !== "=" || node.right.type !== "BinaryExpression") {
      return null;
    }

    var left = node.right.left;
    var right = node.right.right;
    var operator = node.right.operator;
    var loopVarOnLeft =
      left && left.type === "Identifier" && left.name === loopVar;
    var loopVarOnRight =
      right && right.type === "Identifier" && right.name === loopVar;

    if (!loopVarOnLeft && !loopVarOnRight) return null;
    if (operator !== "+" && operator !== "-") return null;

    if (loopVarOnLeft && operator === "+") {
      return {
        direction: "inc",
        expr: right,
        prefix: {
          start: node.start,
          end: right.start,
        },
      };
    }

    if (loopVarOnLeft && operator === "-") {
      return {
        direction: "dec",
        expr: right,
        prefix: {
          start: node.start,
          end: right.start,
        },
      };
    }

    if (loopVarOnRight && operator === "+") {
      return {
        direction: "inc",
        expr: left,
        prefix: {
          start: node.start,
          end: left.start,
        },
      };
    }

    return null;
  }

  _hasUncertainValue(node, context) {
    return this._nodeHasUncertainValue(
      node,
      context,
      Object.create(null),
      context ? context.loopVar : null,
    );
  }

  _nodeHasUncertainValue(node, context, seen, excludeName) {
    if (!node) return false;

    var expanded = this._expandExpr(node, context, seen, excludeName);
    if (expanded !== node) {
      if (Array.isArray(expanded)) {
        for (var ex = 0; ex < expanded.length; ex++) {
          if (
            this._nodeHasUncertainValue(
              expanded[ex],
              context,
              seen,
              excludeName,
            )
          ) {
            return true;
          }
        }
        return false;
      }
      return this._nodeHasUncertainValue(expanded, context, seen, excludeName);
    }

    if (this._resolveUncertainLiteral(node, "max", context).matched) {
      return true;
    }

    for (var key in node) {
      if (
        key === "type" ||
        key === "start" ||
        key === "end" ||
        key === "loc" ||
        key === "parent"
      ) {
        continue;
      }
      var child = node[key];
      if (!child) continue;

      if (Array.isArray(child)) {
        for (var i = 0; i < child.length; i++) {
          if (
            child[i] &&
            typeof child[i] === "object" &&
            this._nodeHasUncertainValue(child[i], context, seen, excludeName)
          ) {
            return true;
          }
        }
      } else if (
        typeof child === "object" &&
        child.type &&
        this._nodeHasUncertainValue(child, context, seen, excludeName)
      ) {
        return true;
      }
    }

    return false;
  }

  _expandExpr(node, context, seen, excludeName) {
    if (!node || node.type !== "Identifier") return node;
    if (node.name === excludeName) return node;
    if (seen[node.name]) return node;

    seen[node.name] = true;
    var resolved = this._resolveIdentifierExpr(node.name, node, context);
    return resolved || node;
  }

  _rewriteExpr(node, mode, context) {
    var expanded = this._expandExpr(
      node,
      context,
      Object.create(null),
      context ? context.loopVar : null,
    );
    if (expanded !== node) {
      if (Array.isArray(expanded)) {
        return this._combineCandidateExprs(expanded, mode, context);
      }
      return this._rewriteExpr(expanded, mode, context);
    }

    var resolved = this._resolveUncertainLiteral(node, mode, context);
    if (resolved.matched) {
      return {
        text: resolved.text,
        changed: true,
      };
    }

    switch (node.type) {
      case "Literal":
      case "Identifier":
        return { text: this._slice(context.code, node), changed: false };
      case "BinaryExpression":
      case "LogicalExpression": {
        var left = this._rewriteExpr(node.left, mode, context);
        var right = this._rewriteExpr(node.right, mode, context);
        return {
          text: "(" + left.text + " " + node.operator + " " + right.text + ")",
          changed: left.changed || right.changed,
        };
      }
      case "UnaryExpression": {
        var arg = this._rewriteExpr(node.argument, mode, context);
        return {
          text: "(" + node.operator + arg.text + ")",
          changed: arg.changed,
        };
      }
      case "CallExpression": {
        var args = [];
        var changed = false;
        for (var i = 0; i < node.arguments.length; i++) {
          var argRes = this._rewriteExpr(node.arguments[i], mode, context);
          args.push(argRes.text);
          changed = changed || argRes.changed;
        }
        return {
          text:
            this._slice(context.code, node.callee) +
            "(" +
            args.join(", ") +
            ")",
          changed: changed,
        };
      }
      case "MemberExpression": {
        return { text: this._slice(context.code, node), changed: false };
      }
      case "ConditionalExpression": {
        var test = this._rewriteExpr(node.test, mode, context);
        var cons = this._rewriteExpr(node.consequent, mode, context);
        var alt = this._rewriteExpr(node.alternate, mode, context);
        return {
          text: "(" + test.text + " ? " + cons.text + " : " + alt.text + ")",
          changed: test.changed || cons.changed || alt.changed,
        };
      }
      default:
        return { text: this._slice(context.code, node), changed: false };
    }
  }

  _combineCandidateExprs(nodes, mode, context) {
    if (!nodes || !nodes.length) {
      return { text: "0", changed: false };
    }
    if (nodes.length === 1) {
      return this._rewriteExpr(nodes[0], mode, context);
    }

    var parts = [];
    var changed = false;
    for (var i = 0; i < nodes.length; i++) {
      var rewritten = this._rewriteExpr(nodes[i], mode, context);
      parts.push(rewritten.text);
      changed = changed || rewritten.changed;
    }

    var joiner = mode === "min" || mode === "step" ? "Math.min" : "Math.max";
    return {
      text: joiner + "(" + parts.join(", ") + ")",
      changed: true || changed,
    };
  }

  _createUncertainProviders() {
    var self = this;
    return [
      {
        name: "frameCount",
        match: function (node) {
          return (
            node && node.type === "Identifier" && node.name === "frameCount"
          );
        },
        rewrite: function (node, mode, context) {
          return String(self._boundFromRange(0, context.frameCountMax, mode));
        },
      },
      {
        name: "random",
        match: function (node) {
          return (
            node &&
            node.type === "CallExpression" &&
            getAstCalleeName(node.callee) === "random"
          );
        },
        rewrite: function (node, mode) {
          return String(self._resolveRandomReplacement(node.arguments, mode));
        },
      },
      {
        name: "controller",
        match: function (node, context) {
          var ref = self._getControllerReference(node, context);
          return !!ref;
        },
        rewrite: function (node, mode, context) {
          var ref = self._getControllerReference(node, context);
          if (!ref) return null;
          return String(
            self._resolveControllerReplacement(
              ref.controller,
              ref.methodName,
              mode,
            ),
          );
        },
      },
    ];
  }

  _resolveUncertainLiteral(node, mode, context) {
    if (!node) return { matched: false, text: null };

    for (var i = 0; i < this.uncertainProviders.length; i++) {
      var provider = this.uncertainProviders[i];
      if (!provider.match(node, context)) continue;
      return {
        matched: true,
        text: provider.rewrite(node, mode, context),
      };
    }

    return { matched: false, text: null };
  }

  _getControllerReference(node, context) {
    if (
      !node ||
      node.type !== "CallExpression" ||
      !node.callee ||
      node.callee.type !== "MemberExpression" ||
      !node.callee.object ||
      node.callee.object.type !== "Identifier" ||
      !node.callee.property ||
      node.callee.property.type !== "Identifier"
    ) {
      return null;
    }

    var objectName = node.callee.object.name;
    var methodName = node.callee.property.name;
    var controller =
      context && context.controllerBounds
        ? context.controllerBounds[objectName]
        : null;

    if (!controller) return null;
    return {
      controller: controller,
      methodName: methodName,
    };
  }

  _boundFromRange(min, max, mode) {
    if (mode === "min") return min;
    if (mode === "step") {
      if (min > 0) return min;
      if (max > 1) return 1;
      if (max > 0) return max;
      return 1;
    }
    return max;
  }

  _resolveRandomReplacement(args, mode) {
    var a = this._toNumber(args[0], 0);
    var hasB = args && args.length > 1;
    var b = hasB ? this._toNumber(args[1], a) : a;
    var lo = hasB ? Math.min(a, b) : 0;
    var hi = hasB ? Math.max(a, b) : Math.max(0, a);
    return this._boundFromRange(lo, hi, mode);
  }

  _resolveControllerReplacement(controller, methodName, mode) {
    var min = controller.min === undefined ? 0 : controller.min;
    var max = controller.max === undefined ? min : controller.max;

    if (controller.type === "angle" && methodName === "radians") {
      min = (min * Math.PI) / 180;
      max = (max * Math.PI) / 180;
    }
    return this._boundFromRange(min, max, mode);
  }

  _toNumber(node, fallback) {
    if (!node) return fallback;
    if (node.type === "Literal" && typeof node.value === "number") {
      return Number(node.value);
    }
    if (
      node.type === "UnaryExpression" &&
      node.operator === "-" &&
      node.argument &&
      node.argument.type === "Literal" &&
      typeof node.argument.value === "number"
    ) {
      return -Number(node.argument.value);
    }
    return fallback;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = LoopAnalyzer;
}

window.LoopAnalyzer = LoopAnalyzer;
