class P5Analyzer {
  constructor() {
    this.runtime = new P5Runtime();
  }

  async analyzeDependencies(code) {
    return await this.runtime.analyzeDependencies(code);
  }

  async fullAnalyze(code) {
    const renderResult = await this.runtime.execute(code);
    const depsResult = await this.analyzeDependencies(code);

    return {
      loopExecutions: renderResult.loopExecutions,
      dependencies: depsResult,
      error: null,
      fallback: false,
    };
  }

  async analyzeSetupAndDraw(
    setupCode,
    drawCode,
    globalCode,
    setupFullCode,
    drawFullCode,
    preloadFullCode,
  ) {
    const result = await this.runtime.executeSetupAndDraw(
      setupCode,
      drawCode,
      globalCode,
      setupFullCode,
      drawFullCode,
      preloadFullCode,
    );

    const setupRenderLayers = (result.setupResult.renderOrder || []).slice();
    const drawRenderLayers = (result.drawResult.renderOrder || []).slice();
    const drawBackgroundHasAlpha = !!(
      result.drawResult.background && result.drawResult.background.hasAlpha
    );

    let rawDrawBackgroundCount = 0;
    if (Array.isArray(drawRenderLayers) && drawRenderLayers.length > 0) {
      for (let i = 0; i < drawRenderLayers.length; i++) {
        const item = drawRenderLayers[i];
        let type = item && typeof item === "object" ? item.type || null : null;

        if (!type) continue;

        if (
          typeof functionRegistry !== "undefined" &&
          functionRegistry.getShapeInfo
        ) {
          const info = functionRegistry.getShapeInfo(type);
          if (info && info.baseType) {
            type = info.baseType;
          }
        }

        if (type === "background") {
          rawDrawBackgroundCount++;
        }
      }
    }

    const hasAnyDrawBackground = rawDrawBackgroundCount > 0;

    const drawBackgroundConditionalInDraw =
      this.hasBackgroundInDrawCondition(drawCode);

    let drawBackgroundCount = 0;
    if (hasAnyDrawBackground && !drawBackgroundConditionalInDraw) {
      drawBackgroundCount = rawDrawBackgroundCount;
    }

    const drawNeedsEcho =
      !hasAnyDrawBackground ||
      drawBackgroundHasAlpha ||
      drawBackgroundConditionalInDraw;

    return {
      setupRenderLayers: setupRenderLayers,
      drawRenderLayers: drawRenderLayers,
      drawBackgroundCount: drawBackgroundCount,
      drawNeedsEcho: drawNeedsEcho,
      error: null,
      fallback: false,
    };
  }

  hasBackgroundInDrawCondition(drawCode) {
    if (!drawCode || !drawCode.trim()) return false;

    if (typeof acorn === "undefined") {
      return false;
    }

    let ast;
    try {
      const wrapped = `function __momentum_temp_draw__() {\n${drawCode}\n}`;
      ast = acorn.parse(wrapped, { ecmaVersion: 2020, locations: false });
    } catch (e) {
      console.error("[P5Analyzer] drawCode AST 解析失败:", e);
      return false;
    }

    let drawFn = null;
    if (ast && Array.isArray(ast.body)) {
      for (let i = 0; i < ast.body.length; i++) {
        const node = ast.body[i];
        if (
          node &&
          node.type === "FunctionDeclaration" &&
          node.id &&
          node.id.name === "__momentum_temp_draw__"
        ) {
          drawFn = node;
          break;
        }
      }
    }

    if (!drawFn || !drawFn.body) {
      return false;
    }

    let hasConditionalBackground = false;

    function walk(node, inConditional) {
      if (!node || hasConditionalBackground) return;

      switch (node.type) {
        case "CallExpression": {
          let calleeName = null;
          const callee = node.callee;
          if (callee && callee.type === "Identifier") {
            calleeName = callee.name;
          } else if (
            callee &&
            callee.type === "MemberExpression" &&
            callee.property &&
            callee.property.type === "Identifier"
          ) {
            calleeName = callee.property.name;
          }

          if (calleeName === "background" && inConditional) {
            hasConditionalBackground = true;
            return;
          }
          break;
        }
        case "IfStatement": {
          if (node.test) walk(node.test, inConditional || true);
          if (node.consequent) walk(node.consequent, true);
          if (node.alternate) walk(node.alternate, true);
          return;
        }
        case "ConditionalExpression": {
          if (node.test) walk(node.test, inConditional || true);
          if (node.consequent) walk(node.consequent, true);
          if (node.alternate) walk(node.alternate, true);
          return;
        }
        case "LogicalExpression": {
          if (node.left) walk(node.left, inConditional);
          if (node.right) {
            walk(node.right, true);
          }
          return;
        }
        default:
          break;
      }

      for (const key in node) {
        if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
        const child = node[key];
        if (!child) continue;

        if (Array.isArray(child)) {
          for (let i = 0; i < child.length; i++) {
            const c = child[i];
            if (c && typeof c === "object") {
              walk(c, inConditional);
              if (hasConditionalBackground) return;
            }
          }
        } else if (typeof child === "object" && child.type) {
          walk(child, inConditional);
        }
      }
    }

    walk(drawFn.body, false);
    return hasConditionalBackground;
  }

  destroy() {
    if (this.runtime) {
      this.runtime.destroy();
    }
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = P5Analyzer;
}

window.P5Analyzer = P5Analyzer;
