/**
 * P5Analyzer - p5.js 代码分析器
 *
 * 功能：
 * 1. 使用运行时分析执行用户代码，统计渲染函数调用次数
 * 2. 分析代码依赖，确定需要注入的库函数
 * 3. 生成 renderLayers 数据传递给 After Effects
 */

class P5Analyzer {
  constructor() {
    // 运行时分析器
    this.runtime = new P5Runtime();
  }

  /**
   * 分析代码依赖
   * @param {string} code - 用户 p5.js 代码
   * @returns {Promise<Object>} 依赖分析结果
   */
  async analyzeDependencies(code) {
    return await this.runtime.analyzeDependencies(code);
  }

  /**
   * 完整分析：同时获取渲染统计和依赖信息
   * @param {string} code - 用户 p5.js 代码
   * @returns {Promise<Object>} 完整分析结果
   */
  async fullAnalyze(code) {
    // 运行时分析：执行代码并统计渲染函数调用
    const renderResult = await this.runtime.execute(code);
    // 分析依赖
    const depsResult = await this.analyzeDependencies(code);

    return {
      loopExecutions: renderResult.loopExecutions,
      dependencies: depsResult,
      error: null,
      fallback: false,
    };
  }

  /**
   * 分别分析 setup 和 draw 中的 shape 调用
   * @param {string} setupCode - setup函数代码
   * @param {string} drawCode - draw函数代码
   * @param {string} globalCode - 全局代码
   * @returns {Promise<Object>} 分析结果，包含 setupRenderLayers / drawRenderLayers
   *          以及用于 Echo 决策的 drawBackgroundCount / drawNeedsEcho
   */
  async analyzeSetupAndDraw(setupCode, drawCode, globalCode) {
    // 分别执行setup和draw代码
    const result = await this.runtime.executeSetupAndDraw(
      setupCode,
      drawCode,
      globalCode,
    );

    // 构建setup的renderLayers：直接使用完整的调用顺序
    const setupRenderLayers = (result.setupResult.renderOrder || []).slice();

    // 构建draw的renderLayers：直接使用完整的调用顺序
    const drawRenderLayers = (result.drawResult.renderOrder || []).slice();

    // 统计 draw 中 background 是否显式带 alpha 参数（运行时检测）
    const drawBackgroundHasAlpha = !!(
      result.drawResult.background && result.drawResult.background.hasAlpha
    );

    // 统计 draw 中 background 的静态调用次数（按基础类型归一化）
    let rawDrawBackgroundCount = 0;
    if (Array.isArray(drawRenderLayers) && drawRenderLayers.length > 0) {
      for (let i = 0; i < drawRenderLayers.length; i++) {
        const item = drawRenderLayers[i];
        let type = null;

        if (item && typeof item === "object") {
          type = item.type || null;
        } else if (typeof item === "string") {
          type = item;
        }

        if (!type) continue;

        // 归一化到基础类型（与后端 processRenderLayers 保持一致）
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

    // 静态分析：draw 中是否存在被条件(if/三元/逻辑运算)控制的 background 调用
    const drawBackgroundConditionalInDraw =
      this.hasBackgroundInDrawCondition(drawCode);

    // 提供给 AE Echo 表达式使用的「每帧 background 调用次数」：
    // - 情况1：draw 中没有任何 background -> 0（交给 Echo 走“无 background 拖尾”逻辑）
    // - 情况2：存在 background 且它们不在条件里 -> 使用静态计数（视为每帧都会执行）
    // - 情况3：存在 background 且出现在条件分支里 -> 0（保守处理为“可能并非每帧清屏”）
    let drawBackgroundCount = 0;
    if (hasAnyDrawBackground && !drawBackgroundConditionalInDraw) {
      drawBackgroundCount = rawDrawBackgroundCount;
    }

    // 第一级决策：是否需要挂 Echo 效果（交由 AE 侧决定是否添加 Echo）
    // - 没有任何 background：需要 Echo（用于纯拖尾）
    // - 有透明 background（显式 alpha）：需要 Echo（用于 alpha 拖尾）
    // - background 在条件里：需要 Echo（因为可能不是每帧都清屏）
    // - 其余情况（每帧实心 background 清屏）：不需要 Echo
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

  /**
   * 静态判断 draw 代码中是否存在被条件控制的 background 调用
   * - 只分析 draw 函数体本身，不跨函数追踪调用链（足以覆盖大部分直接写在 draw 里的情况）
   * - 条件包括：if / 条件运算符(?:) / 短路逻辑表达式(&& / ||) 等
   * @param {string} drawCode - 用户在 draw 中填写的代码片段（函数体内容）
   * @returns {boolean}
   */
  hasBackgroundInDrawCondition(drawCode) {
    if (!drawCode || !drawCode.trim()) return false;

    if (typeof acorn === "undefined") {
      // 在极端情况下 acorn 不可用时，保守返回 false，避免误判
      return false;
    }

    let ast;
    try {
      // 将 draw 代码包裹进一个临时函数，便于解析为合法的 Program
      const wrapped = `function __momentum_temp_draw__() {\n${drawCode}\n}`;
      ast = acorn.parse(wrapped, { ecmaVersion: 2020, locations: false });
    } catch (e) {
      console.error("[P5Analyzer] drawCode AST 解析失败:", e);
      return false;
    }

    // 找到临时的 draw 函数节点
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
            // 右侧表达式在短路逻辑中是条件执行的
            walk(node.right, true);
          }
          return;
        }
        default:
          break;
      }

      // 通用遍历：递归处理子节点
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

  /**
   * 清理资源
   */
  destroy() {
    if (this.runtime) {
      this.runtime.destroy();
    }
  }
}

// 导出类
if (typeof module !== "undefined" && module.exports) {
  module.exports = P5Analyzer;
}

// 全局可用
window.P5Analyzer = P5Analyzer;
