/**
 * ImageAnalyzer - 图片分析器
 *
 * 功能：
 * 1. 从代码中收集 loadImage() 调用的图片路径
 * 2. 在前端读取 user/ 下图片并获取尺寸信息
 * 3. 将图片元数据添加到 p5.js runtime 环境
 *
 * 使用方式：
 *   const analyzer = new ImageAnalyzer();
 *   const images = analyzer.collectImagesFromCode(code);
 *   const loadedImages = await analyzer.loadImagesFromFrontend(images);
 */

class ImageAnalyzer {
  constructor() {
    // 缓存：图片路径 -> { width, height, loaded }
    this.imageCache = {};

    // 加载状态
    this.isLoaded = false;

    // 用户目录路径（前端推导）
    this.userDirectory = null;
  }

  // ========================================
  // AST 图片路径收集
  // ========================================

  /**
   * 从代码中通过 AST 收集 loadImage() 调用的图片路径
   * @param {string} code - 用户代码
   * @returns {Set<string>} 图片路径集合
   */
  collectImagesFromCode(code) {
    const images = new Set();

    if (!code || !code.trim()) {
      return images;
    }

    // 检查 acorn 是否可用
    if (typeof acorn === "undefined") {
      console.warn(
        "[ImageAnalyzer] acorn not available, falling back to regex",
      );
      return this._collectImagesFromRegex(code);
    }

    try {
      const ast = acorn.parse(code, {
        ecmaVersion: 2020,
        sourceType: "script",
      });
      this._walkASTForImages(images, ast);
    } catch (e) {
      console.warn(
        "[ImageAnalyzer] AST parse failed, falling back to regex:",
        e.message,
      );
      return this._collectImagesFromRegex(code);
    }

    return images;
  }

  /**
   * 通过 AST 遍历收集 loadImage 调用
   * @private
   */
  _walkASTForImages(images, node) {
    if (!node || typeof node !== "object") return;

    // 检查 CallExpression: loadImage(...)
    if (node.type === "CallExpression" && node.callee) {
      const funcName = node.callee.name;

      // 检测 loadImage("path") 或 loadImage('path')
      if (
        funcName === "loadImage" &&
        node.arguments &&
        node.arguments.length > 0
      ) {
        const arg = node.arguments[0];
        // 只处理字符串字面量
        if (arg.type === "Literal" && typeof arg.value === "string") {
          images.add(arg.value);
        }
      }
    }

    // 递归遍历子节点
    for (const key in node) {
      if (key === "parent" || key === "loc" || key === "range") continue;

      const child = node[key];
      if (!child) continue;

      if (Array.isArray(child)) {
        for (let i = 0; i < child.length; i++) {
          this._walkASTForImages(images, child[i]);
        }
      } else if (typeof child === "object" && child.type) {
        this._walkASTForImages(images, child);
      }
    }
  }

  /**
   * 回退方案：使用正则表达式收集图片路径
   * @private
   */
  _collectImagesFromRegex(code) {
    const images = new Set();
    // 匹配 loadImage("path") 或 loadImage('path')
    const regex = /loadImage\s*\(\s*(["'])([^"']+)\1\s*\)/g;
    let match;

    while ((match = regex.exec(code)) !== null) {
      images.add(match[2]);
    }

    return images;
  }

  // ========================================
  // 前端加载图片
  // ========================================

  /**
   * 获取用户目录路径
   * @private
   */
  async _getUserDirectory() {
    if (this.userDirectory) {
      return this.userDirectory;
    }

    return new Promise((resolve) => {
      if (window.extensionPath) {
        this.userDirectory = window.extensionPath + "/user";
        console.log(
          "[ImageAnalyzer] User directory from extensionPath:",
          this.userDirectory,
        );
        resolve(this.userDirectory);
        return;
      }

      resolve(null);
    });
  }

  _normalizeRelativePath(relativePath) {
    return String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  }

  _joinUserPath(userDir, relativePath) {
    const base = String(userDir || "").replace(/[\\/]+$/, "");
    const rel = this._normalizeRelativePath(relativePath);
    return base + "/" + rel;
  }

  _toFileUrl(fullPath) {
    const normalized = String(fullPath || "").replace(/\\/g, "/");
    const encoded = encodeURI(normalized);
    if (/^[A-Za-z]:\//.test(normalized)) {
      return "file:///" + encoded;
    }
    if (normalized.charAt(0) !== "/") {
      return "file:///" + encoded;
    }
    return "file://" + encoded;
  }

  _loadImageInfoFromFrontend(relativePath, fullPath) {
    return new Promise((resolve) => {
      const img = new Image();
      let settled = false;

      function finalize(result) {
        if (settled) return;
        settled = true;
        resolve(result);
      }

      img.onload = () => {
        finalize({
          success: true,
          width: img.naturalWidth || img.width || 0,
          height: img.naturalHeight || img.height || 0,
          name: relativePath.split("/").pop() || relativePath,
          path: fullPath,
        });
      };

      img.onerror = () => {
        finalize({
          success: false,
          error: "Failed to load image from frontend: " + relativePath,
          path: fullPath,
        });
      };

      img.src = this._toFileUrl(fullPath);
    });
  }

  /**
   * 从前端加载多个图片
   * - 命中 imageCache 的路径直接返回，不再请求 AE
   * - 未命中的路径通过浏览器 Image 批量读取尺寸
   * @param {Set<string>} imagePaths - 图片路径集合（如 "apple.png", "images/photo.jpg"）
   * @returns {Promise<Object>} { "apple.png": { width, height, path, success }, ... }
   */
  async loadImagesFromFrontend(imagePaths) {
    const userDir = await this._getUserDirectory();
    if (!userDir) {
      console.error("[ImageAnalyzer] Cannot get user directory");
      return {};
    }

    const results = {};
    const uncachedPaths = [];

    for (const relativePath of imagePaths) {
      const normalizedPath = this._normalizeRelativePath(relativePath);

      // 命中缓存：直接复用，不打 AE
      if (this.imageCache[normalizedPath]) {
        results[normalizedPath] = this.imageCache[normalizedPath];
        console.log(`[ImageAnalyzer] Cache hit: ${normalizedPath}`);
        continue;
      }

      uncachedPaths.push({
        rel: normalizedPath,
        full: this._joinUserPath(userDir, normalizedPath),
      });
    }

    // 未命中缓存的路径批量走前端加载
    if (uncachedPaths.length > 0) {
      const batchResults = await this._loadAllImagesFromFrontend(uncachedPaths);

      for (const { rel } of uncachedPaths) {
        const info = batchResults[rel] || {
          success: false,
          error: "No result returned from frontend",
        };
        results[rel] = info;

        if (info.success) {
          this.imageCache[rel] = info;
          console.log(
            `[ImageAnalyzer] Loaded image: ${rel} (${info.width}x${info.height})`,
          );
        } else {
          console.error(
            `[ImageAnalyzer] Failed to load image: ${rel} - ${info.error}`,
          );
        }
      }
    }

    this.isLoaded = true;
    return results;
  }

  /**
   * 批量从前端获取多张图片的尺寸信息。
   * @private
   * @param {Array<{rel: string, full: string}>} paths - 路径列表
   * @returns {Promise<Object>} { "apple.png": { width, height, path, success, error }, ... }
   */
  async _loadAllImagesFromFrontend(paths) {
    const results = {};
    const loaded = await Promise.all(
      paths.map(async ({ rel, full }) => {
        try {
          const info = await this._loadImageInfoFromFrontend(rel, full);
          return { rel, info };
        } catch (e) {
          return {
            rel,
            info: {
              success: false,
              error: e.message,
              path: full,
            },
          };
        }
      }),
    );

    for (const item of loaded) {
      results[item.rel] = item.info;
    }

    return results;
  }

  // ========================================
  // 添加到 p5 Runtime
  // ========================================

  /**
   * 将加载的图片添加到 p5.js runtime 环境
   * @param {Object} loadedImages - loadImagesFromFrontend 返回的结果
   * @param {Object} p - p5 实例
   */
  addToP5Runtime(loadedImages, p) {
    if (!p || !loadedImages) return;

    // 为每个加载成功的图片创建一个 p5.Image 对象
    for (const [relativePath, imageInfo] of Object.entries(loadedImages)) {
      if (!imageInfo.success) continue;

      try {
        // 创建假的 p5.Image 对象（仅包含必要属性）
        // p5.js 的 image 对象需要 width, height 属性
        const img = {
          width: imageInfo.width,
          height: imageInfo.height,
          _momentumPath: relativePath, // 记录原始路径
          _momentumFullPath: imageInfo.path, // 记录完整路径
        };

        // 注册到全局（变量名用图片文件名作为标识）
        // 例如：loadImage("apple.png") -> 全局变量 "apple_png"
        const varName = relativePath
          .replace(/[^a-zA-Z0-9_]/g, "_")
          .replace(/^(\d)/, "_$1");

        window[varName] = img;
        console.log(`[ImageAnalyzer] Added to runtime: ${varName}`);
      } catch (e) {
        console.error(
          `[ImageAnalyzer] Failed to add image to runtime: ${relativePath}`,
          e,
        );
      }
    }
  }

  // ========================================
  // 公共方法
  // ========================================

  /**
   * 获取缓存的图片信息
   * @param {string} relativePath - 图片相对路径
   * @returns {Object|null}
   */
  getImageInfo(relativePath) {
    return this.imageCache[relativePath] || null;
  }

  /**
   * 获取所有已加载的图片
   * @returns {Object}
   */
  getAllImages() {
    return { ...this.imageCache };
  }

  /**
   * 清理缓存
   */
  clearCache() {
    this.imageCache = {};
    this.isLoaded = false;
  }
}

// 全局可用
window.ImageAnalyzer = ImageAnalyzer;
