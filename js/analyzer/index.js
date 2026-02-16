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
   * 主分析方法
   * @param {string} code - 用户 p5.js 代码
   * @returns {Object} 分析结果
   */
  async analyze(code) {
    // 运行时分析：执行代码并统计渲染函数调用
    const result = await this.runtime.execute(code);

    // 按执行顺序构建 renderLayers（保证图层顺序与代码调用顺序一致）
    let renderLayers;
    if (result.renderOrder && result.renderOrder.length > 0) {
      // 统计 renderOrder 中每个类型的数量，同时保持首次出现的顺序
      const typeCounts = {};
      const typeOrder = [];
      result.renderOrder.forEach((type) => {
        if (!typeCounts[type]) {
          typeCounts[type] = 0;
          typeOrder.push(type);
        }
        typeCounts[type]++;
      });
      renderLayers = typeOrder.map((type) => ({ type, count: typeCounts[type] }));
    } else {
      renderLayers = Object.entries(result.renderCounts)
        .filter(([, count]) => count > 0)
        .map(([type, count]) => ({ type, count }));
    }

    return {
      renderLayers: renderLayers,
      runtimeCounts: result.renderCounts,
      loopExecutions: result.loopExecutions,
      error: null,
      fallback: false,
    };
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
   * 完整分析：同时获取 renderLayers 和依赖信息
   * @param {string} code - 用户 p5.js 代码
   * @returns {Promise<Object>} 完整分析结果
   */
  async fullAnalyze(code) {
    // 并行执行渲染统计和依赖分析
    const [renderResult, depsResult] = await Promise.all([
      this.analyze(code),
      this.analyzeDependencies(code),
    ]);

    return {
      renderLayers: renderResult.renderLayers,
      runtimeCounts: renderResult.runtimeCounts,
      loopExecutions: renderResult.loopExecutions,
      dependencies: depsResult,
      error: null,
      fallback: false,
    };
  }

  /**
   * AST 分析：检测 draw 代码中是否有 background 调用且没有不透明度参数
   * background 调用格式：
   * - background(gray) - 1个参数，没有不透明度
   * - background(gray, a) - 2个参数，有不透明度
   * - background(v1, v2, v3) - 3个参数，没有不透明度
   * - background(v1, v2, v3, a) - 4个参数，有不透明度
   * - background(c) - 1个参数，c可能是color()的结果（可能包含不透明度）
   * 
   * 如果检测到 background 调用且参数数量是 1 或 3（没有不透明度参数），返回 true
   * @param {string} drawCode - draw函数代码
   * @returns {boolean} 是否有 background 调用且没有不透明度参数
   */
  hasBackgroundWithoutOpacity(drawCode) {
    if (!drawCode) return false;
    
    // 匹配 background( 调用，提取参数部分
    // 使用正则表达式匹配 background( 到对应的 )
    const backgroundPattern = /\bbackground\s*\(/g;
    const matches = [];
    let match;
    
    while ((match = backgroundPattern.exec(drawCode)) !== null) {
      const startPos = match.index + match[0].length;
      let depth = 1;
      let i = startPos;
      let paramStr = "";
      
      // 找到匹配的右括号
      while (i < drawCode.length && depth > 0) {
        const char = drawCode[i];
        if (char === '(') depth++;
        else if (char === ')') depth--;
        else if (depth === 1) paramStr += char;
        i++;
      }
      
      if (depth === 0) {
        // 解析参数：去除空白，按逗号分割
        const params = paramStr.split(',').map(p => p.trim()).filter(p => p.length > 0);
        const paramCount = params.length;
        
        // 如果参数数量是 1 或 3，认为没有不透明度参数
        // 注意：background(c) 中 c 可能是 color() 的结果，但为了简化，我们假设单参数时没有不透明度
        if (paramCount === 1 || paramCount === 3) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * 分别分析 setup 和 draw 中的 shape 调用
   * @param {string} setupCode - setup函数代码
   * @param {string} drawCode - draw函数代码
   * @param {string} globalCode - 全局代码
   * @returns {Promise<Object>} 分析结果，包含setupRenderLayers和drawRenderLayers
   */
  async analyzeSetupAndDraw(setupCode, drawCode, globalCode) {
    // 分别执行setup和draw代码
    const result = await this.runtime.executeSetupAndDraw(setupCode, drawCode, globalCode);

    // 构建setup的renderLayers
    let setupRenderLayers = [];
    if (result.setupResult.renderOrder && result.setupResult.renderOrder.length > 0) {
      // 统计 renderOrder 中每个类型的数量，同时保持首次出现的顺序
      const typeCounts = {};
      const typeOrder = [];
      result.setupResult.renderOrder.forEach((type) => {
        if (!typeCounts[type]) {
          typeCounts[type] = 0;
          typeOrder.push(type);
        }
        typeCounts[type]++;
      });
      setupRenderLayers = typeOrder.map((type) => ({ type, count: typeCounts[type] }));
    } else {
      setupRenderLayers = Object.entries(result.setupResult.renderCounts)
        .filter(([, count]) => count > 0)
        .map(([type, count]) => ({ type, count }));
    }

    // 构建draw的renderLayers
    let drawRenderLayers = [];
    if (result.drawResult.renderOrder && result.drawResult.renderOrder.length > 0) {
      // 统计 renderOrder 中每个类型的数量，同时保持首次出现的顺序
      const typeCounts = {};
      const typeOrder = [];
      result.drawResult.renderOrder.forEach((type) => {
        if (!typeCounts[type]) {
          typeCounts[type] = 0;
          typeOrder.push(type);
        }
        typeCounts[type]++;
      });
      drawRenderLayers = typeOrder.map((type) => ({ type, count: typeCounts[type] }));
    } else {
      drawRenderLayers = Object.entries(result.drawResult.renderCounts)
        .filter(([, count]) => count > 0)
        .map(([type, count]) => ({ type, count }));
    }

    // AST 分析：检测 draw 中是否有 background 调用且没有不透明度参数
    const hasBackgroundWithoutOpacity = this.hasBackgroundWithoutOpacity(drawCode);

    return {
      setupRenderLayers: setupRenderLayers,
      drawRenderLayers: drawRenderLayers,
      setupRuntimeCounts: result.setupResult.renderCounts,
      drawRuntimeCounts: result.drawResult.renderCounts,
      hasBackgroundWithoutOpacity: hasBackgroundWithoutOpacity,
      error: null,
      fallback: false,
    };
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



