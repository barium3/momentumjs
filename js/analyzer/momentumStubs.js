/**
 * Momentum 前端运行时 stub 集合
 * 用于在浏览器侧 P5Runtime 中“假实现”一些自定义控制器函数，
 * 避免在完整分析阶段因为找不到这些函数而报错。
 *
 * 注意：这里只实现默认值行为，不涉及 AE 表达式或真实控件逻辑。
 */
(function (window) {
  "use strict";

  /**
   * 安装 Momentum 自定义辅助函数的运行时 stub
   * 当前主要包括：
   *   - createPoint(defaultX, defaultY)
   *   - createAngle(defaultDegrees)
   */
  function installMomentumStubs() {
    if (!window.__momentumStubs) {
      window.__momentumStubs = {};
    }

    /**
     * createPoint(defaultX, defaultY)
     *
     * 在浏览器侧，我们只能使用默认值来“假实现”点控件：
     *   var pt = createPoint(100, 200);
     *   pt.value() -> [100, 200]
     *   pt.x()     -> 100
     *   pt.y()     -> 200
     *
     * 如果未传入参数，则默认 [0, 0]。
     */
    if (typeof window.createPoint === "undefined") {
      window.createPoint = function (defaultX, defaultY) {
        var x = defaultX === undefined ? 0 : defaultX;
        var y = defaultY === undefined ? 0 : defaultY;

        return {
          value: function () {
            return [x, y];
          },
          x: function () {
            return x;
          },
          y: function () {
            return y;
          },
        };
      };
      window.__momentumStubs.createPoint = true;
    }

    /**
     * createAngle(defaultDegrees)
     *
     * 浏览器侧最小实现的角度控制器：
     *   var ang = createAngle(45);
     *   ang.value()   -> 45（度）
     *   ang.degrees() -> 45
     *   ang.radians() -> 45 * Math.PI / 180
     *
     * 注意：这里只使用传入的默认值，不和真实 UI 交互。
     */
    if (typeof window.createAngle === "undefined") {
      window.createAngle = function (defaultDegrees) {
        var deg = defaultDegrees === undefined ? 0 : defaultDegrees;

        return {
          value: function () {
            return deg;
          },
          degrees: function () {
            return deg;
          },
          radians: function () {
            return deg * Math.PI / 180;
          },
        };
      };
      window.__momentumStubs.createAngle = true;
    }
  }

  // 挂到全局，供 runtime.js 调用
  window.installMomentumStubs = installMomentumStubs;
})(window);

