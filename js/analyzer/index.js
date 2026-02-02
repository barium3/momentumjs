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

    // 转换为 renderLayers 格式
    const renderLayers = Object.entries(result.renderCounts)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => ({ type, count }));

    return {
      renderLayers: renderLayers,
      runtimeCounts: result.renderCounts,
      loopExecutions: result.loopExecutions,
      error: null,
      fallback: false
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
      this.analyzeDependencies(code)
    ]);

    return {
      renderLayers: renderResult.renderLayers,
      runtimeCounts: renderResult.runtimeCounts,
      loopExecutions: renderResult.loopExecutions,
      dependencies: depsResult,
      error: null,
      fallback: false
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
if (typeof module !== 'undefined' && module.exports) {
  module.exports = P5Analyzer;
}

// 全局可用
window.P5Analyzer = P5Analyzer;
