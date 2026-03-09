// Collects loadImage() paths and resolves frontend image metadata.

class ImageAnalyzer {
  constructor() {
    this.imageCache = {};
    this.isLoaded = false;
    this.userDirectory = null;
  }

  collectImagesFromCode(code) {
    const images = new Set();

    if (!code || !code.trim()) {
      return images;
    }

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

  _walkASTForImages(images, node) {
    walkAst(node, (child) => {
      if (child.type !== "CallExpression" || !child.callee) {
        return;
      }
      const funcName = getAstCalleeName(child.callee);
      if (
        funcName === "loadImage" &&
        child.arguments &&
        child.arguments.length > 0
      ) {
        const arg = child.arguments[0];
        if (arg.type === "Literal" && typeof arg.value === "string") {
          images.add(arg.value);
        }
      }
    });
  }

  _collectImagesFromRegex(code) {
    const images = new Set();
    const regex = /loadImage\s*\(\s*(["'])([^"']+)\1\s*\)/g;
    let match;

    while ((match = regex.exec(code)) !== null) {
      images.add(match[2]);
    }

    return images;
  }

  async _getUserDirectory() {
    if (this.userDirectory) {
      return this.userDirectory;
    }

    return new Promise((resolve) => {
      if (window.extensionPath) {
        this.userDirectory = window.extensionPath + "/user";
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
      if (this.imageCache[normalizedPath]) {
        results[normalizedPath] = this.imageCache[normalizedPath];
        continue;
      }

      uncachedPaths.push({
        rel: normalizedPath,
        full: this._joinUserPath(userDir, normalizedPath),
      });
    }

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

  addToP5Runtime(loadedImages, p) {
    if (!p || !loadedImages) return;

    for (const [relativePath, imageInfo] of Object.entries(loadedImages)) {
      if (!imageInfo.success) continue;

      try {
        const img = {
          width: imageInfo.width,
          height: imageInfo.height,
          _momentumPath: relativePath,
          _momentumFullPath: imageInfo.path,
        };

        const varName = relativePath
          .replace(/[^a-zA-Z0-9_]/g, "_")
          .replace(/^(\d)/, "_$1");

        window[varName] = img;
      } catch (e) {
        console.error(
          `[ImageAnalyzer] Failed to add image to runtime: ${relativePath}`,
          e,
        );
      }
    }
  }

  getImageInfo(relativePath) {
    return this.imageCache[relativePath] || null;
  }

  getAllImages() {
    return { ...this.imageCache };
  }

  clearCache() {
    this.imageCache = {};
    this.isLoaded = false;
  }
}

// 全局可用
window.ImageAnalyzer = ImageAnalyzer;
