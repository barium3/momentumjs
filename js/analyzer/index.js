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
   * @returns {Promise<Object>} 分析结果，包含setupRenderLayers和drawRenderLayers
   */
  async analyzeSetupAndDraw(setupCode, drawCode, globalCode) {
    // 分别执行setup和draw代码
    const result = await this.runtime.executeSetupAndDraw(setupCode, drawCode, globalCode);

    // 构建setup的renderLayers：直接使用完整的调用顺序
    const setupRenderLayers = (result.setupResult.renderOrder || []).slice();

    // 构建draw的renderLayers：直接使用完整的调用顺序
    const drawRenderLayers = (result.drawResult.renderOrder || []).slice();

    // 统计 background 是否显式带 alpha 参数（分别针对 setup / draw）
    const setupBackgroundHasAlpha =
      !!(result.setupResult.background && result.setupResult.background.hasAlpha);
    const drawBackgroundHasAlpha =
      !!(result.drawResult.background && result.drawResult.background.hasAlpha);

    return {
      setupRenderLayers: setupRenderLayers,
      drawRenderLayers: drawRenderLayers,
      setupBackgroundHasAlpha: setupBackgroundHasAlpha,
      drawBackgroundHasAlpha: drawBackgroundHasAlpha,
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



