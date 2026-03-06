/**
 * ImageAnalyzer - 图片分析器
 *
 * 功能：
 * 1. 从代码中收集 loadImage() 调用的图片路径
 * 2. 通过 AE 脚本加载图片并获取尺寸信息
 * 3. 将图片添加到 p5.js runtime 环境
 *
 * 使用方式：
 *   const analyzer = new ImageAnalyzer();
 *   const images = analyzer.collectImagesFromCode(code);
 *   const loadedImages = await analyzer.loadImagesFromAE(images);
 */

class ImageAnalyzer {
  constructor() {
    // 缓存：图片路径 -> { width, height, loaded }
    this.imageCache = {};

    // 加载状态
    this.isLoaded = false;

    // 用户目录路径（从 AE 获取）
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
  // 从 AE 加载图片
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
      // 方法1：直接使用前端已获取的 extensionPath
      if (window.extensionPath) {
        this.userDirectory = window.extensionPath + "/user";
        console.log(
          "[ImageAnalyzer] User directory from extensionPath:",
          this.userDirectory,
        );
        resolve(this.userDirectory);
        return;
      }

      // 方法2：通过 AE 脚本获取（备用）
      const script = `
        (function() {
          try {
            // 尝试从 JSX 文件位置推断
            var startPath = "";
            try {
              startPath = File($.fileName).parent.fsName;
            } catch(e) {}
            
            if (startPath) {
              var dir = new Folder(startPath);
              for (var i = 0; i < 4; i++) {
                if (!dir || !dir.exists) break;
                var userCheck = new Folder(dir.fsName + "/user");
                if (userCheck.exists) {
                  return dir.fsName + "/user";
                }
                dir = dir.parent;
              }
            }
            
            return null;
          } catch (e) {
            return null;
          }
        })();
      `;

      if (typeof csInterface !== "undefined") {
        csInterface.evalScript(script, (result) => {
          console.log("[ImageAnalyzer] User directory from AE:", result);
          this.userDirectory = result || null;
          resolve(this.userDirectory);
        });
      } else {
        resolve(null);
      }
    });
  }

  /**
   * 从 AE 加载多个图片
   * - 命中 imageCache 的路径直接返回，不再请求 AE
   * - 未命中的路径合并为一次 evalScript 批量请求
   * @param {Set<string>} imagePaths - 图片路径集合（如 "apple.png", "images/photo.jpg"）
   * @returns {Promise<Object>} { "apple.png": { width, height, path, success }, ... }
   */
  async loadImagesFromAE(imagePaths) {
    const userDir = await this._getUserDirectory();
    if (!userDir) {
      console.error("[ImageAnalyzer] Cannot get user directory");
      return {};
    }

    const results = {};
    const uncachedPaths = [];

    for (const relativePath of imagePaths) {
      // 命中缓存：直接复用，不打 AE
      if (this.imageCache[relativePath]) {
        results[relativePath] = this.imageCache[relativePath];
        console.log(`[ImageAnalyzer] Cache hit: ${relativePath}`);
        continue;
      }

      const sep = userDir.includes("\\") || userDir.includes(":") ? "\\" : "/";
      uncachedPaths.push({
        rel: relativePath,
        full: userDir + sep + relativePath,
      });
    }

    // 未命中缓存的路径批量发给 AE，一次 evalScript 拿回所有结果
    if (uncachedPaths.length > 0) {
      const batchResults = await this._loadAllImagesFromAE(uncachedPaths);

      for (const { rel } of uncachedPaths) {
        const info = batchResults[rel] || {
          success: false,
          error: "No result returned from AE",
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
   * 批量从 AE 获取多张图片的尺寸信息，只发一次 evalScript。
   * AE 端先查已有 footage，找不到才 importFile，避免重复导入。
   * @private
   * @param {Array<{rel: string, full: string}>} paths - 路径列表
   * @returns {Promise<Object>} { "apple.png": { width, height, path, success, error }, ... }
   */
  _loadAllImagesFromAE(paths) {
    return new Promise((resolve) => {
      if (typeof csInterface === "undefined") {
        const fallback = {};
        for (const { rel } of paths) {
          fallback[rel] = {
            success: false,
            error: "csInterface not available",
          };
        }
        resolve(fallback);
        return;
      }

      // 将路径数组序列化为 JS 字面量嵌入脚本
      const pathsLiteral = JSON.stringify(paths);

      const script = `
        (function() {
          try {
            var paths = ${pathsLiteral};
            var results = {};

            if (!app.project) {
              for (var k = 0; k < paths.length; k++) {
                results[paths[k].rel] = { success: false, error: "No project available" };
              }
              return JSON.stringify(results);
            }

            for (var i = 0; i < paths.length; i++) {
              var rel  = paths[i].rel;
              var full = paths[i].full;
              try {
                var file = new File(full);
                if (!file.exists) {
                  results[rel] = { success: false, error: "File not found: " + full };
                  continue;
                }

                // 先在项目中查找同名 footage，避免重复导入
                var footageItem = null;
                var fileName = file.name;
                for (var j = 1; j <= app.project.numItems; j++) {
                  var item = app.project.item(j);
                  if (item instanceof FootageItem && item.name === fileName) {
                    footageItem = item;
                    break;
                  }
                }
                if (!footageItem) {
                  footageItem = app.project.importFile(new ImportOptions(file));
                }

                if (!footageItem) {
                  results[rel] = { success: false, error: "Failed to import: " + full };
                  continue;
                }

                results[rel] = {
                  success: true,
                  width:  footageItem.width,
                  height: footageItem.height,
                  name:   footageItem.name,
                  path:   full
                };
              } catch (e) {
                results[rel] = { success: false, error: e.message };
              }
            }

            return JSON.stringify(results);
          } catch (e) {
            return JSON.stringify({ _batchError: e.message });
          }
        })();
      `;

      csInterface.evalScript(script, (result) => {
        try {
          const data = JSON.parse(result || "{}");
          if (data._batchError) {
            console.error("[ImageAnalyzer] Batch AE error:", data._batchError);
            const fallback = {};
            for (const { rel } of paths) {
              fallback[rel] = { success: false, error: data._batchError };
            }
            resolve(fallback);
          } else {
            resolve(data);
          }
        } catch (e) {
          const fallback = {};
          for (const { rel } of paths) {
            fallback[rel] = {
              success: false,
              error: "Failed to parse AE result: " + e.message,
            };
          }
          resolve(fallback);
        }
      });
    });
  }

  // ========================================
  // 添加到 p5 Runtime
  // ========================================

  /**
   * 将加载的图片添加到 p5.js runtime 环境
   * @param {Object} loadedImages - loadImagesFromAE 返回的结果
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
