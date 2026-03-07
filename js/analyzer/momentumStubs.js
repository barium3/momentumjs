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
  function installMomentumStubs(options) {
    options = options || {};
    var mode = options.mode || "execution";

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
            return (deg * Math.PI) / 180;
          },
        };
      };
      window.__momentumStubs.createAngle = true;
    }

    /**
     * image(img, x, y, [w, h])
     *
     * 浏览器侧 stub：仅在分析阶段使用，不做实际渲染。
     * 实际的渲染记录由 runtime.js 中的 image 包装器完成。
     */
    if (typeof window.image === "undefined") {
      window.image = function () {};
      window.__momentumStubs.image = true;
    }

    /**
     * imageMode(mode)
     */
    if (typeof window.imageMode === "undefined") {
      window.imageMode = function () {};
      window.__momentumStubs.imageMode = true;
    }

    /**
     * tint / noTint
     */
    if (typeof window.tint === "undefined") {
      window.tint = function () {};
      window.__momentumStubs.tint = true;
    }
    if (typeof window.noTint === "undefined") {
      window.noTint = function () {};
      window.__momentumStubs.noTint = true;
    }

    /**
     * preload()
     *
     * p5.js 的 preload 钩子：用户在其中调用 loadImage 等异步加载函数。
     * 在浏览器侧 stub 中，preload 只是一个空函数占位，
     * 实际的图片数据已由 codeExecutor 通过 AE 提前加载完毕。
     */
    if (typeof window.preload === "undefined") {
      window.preload = function () {};
      window.__momentumStubs.preload = true;
    }

    /**
     * loadImage(path)
     *
     * 浏览器侧 stub 实现：
     * - 在代码分析阶段，返回一个占位对象
     * - 执行阶段会由 runtime 中的真实 p5.loadImage 包装器接管
     * - 这里的 stub 只用于分析/降级场景
     *
     * 返回的对象需要有以下属性：
     *   - width: 图片宽度
     *   - height: 图片高度
     */
    // loadImage 必须始终使用 Momentum stub（不能用 p5 原生版本）
    // p5 的 loadImage 是异步的，不返回 _momentumPath，会导致 image() 无法获取路径
    // 即使 exposeP5Functions 已经设置了 window.loadImage，这里也要覆盖它
    if (mode !== "execution" || typeof window.loadImage === "undefined") {
      window.loadImage = function (path) {
        // 返回一个占位对象
        // 执行模式下会改由真实 p5.loadImage 处理；
        // 这里保留分析/回退场景的占位返回值
        // 变量名基于图片路径生成，例如：
        //   loadImage("apple.png") -> window.apple_png
        //   loadImage("images/photo.jpg") -> window.images_photo_jpg
        var varName = path
          .replace(/[^a-zA-Z0-9_]/g, "_")
          .replace(/^(\d)/, "_$1");

        // 尝试从已加载的图片缓存中获取
        if (
          window.__momentumLoadedImages &&
          window.__momentumLoadedImages[path]
        ) {
          return window.__momentumLoadedImages[path];
        }

        // 如果已有全局变量（由 ImageAnalyzer 注入），返回它
        if (window[varName]) {
          return window[varName];
        }

        // 否则返回占位对象（尺寸为 0）
        var img = {
          width: 0,
          height: 0,
          _momentumPath: path,
          _momentumResolvedUrl: null,
          _momentumFullPath: null,
          _momentumReady: false,
          _placeholder: true,
          get: function (x, y, w, h) {
            if (arguments.length >= 4) {
              return {
                width: Math.max(0, Math.floor(Number(w) || 0)),
                height: Math.max(0, Math.floor(Number(h) || 0)),
                _momentumPath: path,
                _momentumResolvedUrl: null,
                _momentumFullPath: null,
                _momentumReady: false,
                _placeholder: true,
                get: function () {
                  return [0, 0, 0, 0];
                },
              };
            }
            return [0, 0, 0, 0];
          },
        };
        return img;
      };
      window.__momentumStubs.loadImage = true;
    }

  }

  // 挂到全局，供 runtime.js 调用
  window.installMomentumStubs = installMomentumStubs;
})(window);
