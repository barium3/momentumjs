/**
 * FontAnalyzer - 字体分析器
 *
 * 功能：
 * 1. 从 AE 获取系统字体列表
 * 2. 构建 displayName → PostScript 名称 的映射表
 * 3. 获取字体度量数据 (ascent, descent, 字符宽度)
 * 4. 计算文本宽度
 *
 * 使用方式：
 *   const analyzer = new FontAnalyzer();
 *   const psName = await analyzer.getPostScriptName("Arial");
 *   const metrics = await analyzer.getFontMetrics("Arial", 24);
 *   const width = await analyzer.getTextWidth("Arial", 24, "Hello");
 */

class FontAnalyzer {
  constructor() {
    // 缓存：displayName → PostScript 名称
    this.fontMap = {};

    // 缓存：PostScript → displayName（反向映射）
    this.reverseMap = {};

    // 缓存：字体度量数据 { "fontName": { ascent, descent, baselineOffsetRatio, charWidths } }
    // 注意：存储时只用字体名作为 key，因为度量数据是比例值，与字号无关
    this.metricsCache = {};

    // 缓存：文本宽度计算结果
    this.textWidthCache = {};

    // 加载状态
    this.isLoaded = false;

    // 加载中标记
    this.loading = false;

    // 默认字体（当代码中有 text() 但没有 textFont() 时使用）
    this.defaultFont = "Arial";
  }

  // ========================================
  // AST 字体收集（使用 acorn 解析）
  // ========================================

  /**
   * 从代码中通过 AST 收集 textFont() 调用的字体
   * 同时检测 text() 调用，如果没有 textFont 则需要默认字体
   * @param {string} code - 用户代码
   * @returns {Set<string>} 字体名称集合
   */
  collectFontsFromAST(code) {
    const fonts = new Set();

    if (!code || !code.trim()) {
      return fonts;
    }

    // 检查 acorn 是否可用
    if (typeof acorn === "undefined") {
      console.warn("[FontAnalyzer] acorn not available, falling back to regex");
      return this._collectFontsFromRegex(code);
    }

    try {
      const ast = acorn.parse(code, {
        ecmaVersion: 2020,
        sourceType: "script",
      });
      // 返回 { fonts: Set, hasText: boolean }
      const result = this._walkAST(fonts, ast);

      // 如果有 text() 调用但没有 textFont()，添加默认字体
      if (result.hasText && fonts.size === 0) {
        fonts.add(this.defaultFont);
      }
    } catch (e) {
      console.warn(
        "[FontAnalyzer] AST parse failed, falling back to regex:",
        e.message,
      );
      return this._collectFontsFromRegex(code);
    }

    return fonts;
  }

  /**
   * 遍历 AST 收集 textFont 调用
   * 同时检测是否使用了 text() 函数
   * @private
   */
  _walkAST(fonts, node) {
    const result = { hasText: false };

    if (!node || typeof node !== "object") return result;

    // 检查 CallExpression: textFont(...) 或 text(...)
    if (node.type === "CallExpression" && node.callee) {
      const funcName = node.callee.name;

      // 检测 textFont("字体名")
      if (
        funcName === "textFont" &&
        node.arguments &&
        node.arguments.length > 0
      ) {
        const arg = node.arguments[0];
        // 只处理字符串字面量
        if (arg.type === "Literal" && typeof arg.value === "string") {
          fonts.add(arg.value);
        }
      }

      // 检测 text() 调用
      if (funcName === "text") {
        result.hasText = true;
      }
    }

    // 递归遍历子节点
    for (const key in node) {
      if (
        key === "parent" ||
        key === "type" ||
        key === "start" ||
        key === "end" ||
        key === "loc"
      )
        continue;
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach((c) => {
          const childResult = this._walkAST(fonts, c);
          if (childResult.hasText) {
            result.hasText = true;
          }
        });
      } else if (child && typeof child === "object") {
        const childResult = this._walkAST(fonts, child);
        if (childResult.hasText) {
          result.hasText = true;
        }
      }
    }

    return result;
  }

  /**
   * 回退方案：使用正则表达式收集字体（当 AST 不可用时）
   * 同时检测是否有 text() 调用
   * @private
   */
  _collectFontsFromRegex(code) {
    const fonts = new Set();

    // 收集 textFont("字体名")
    const fontRegex = /textFont\s*\(\s*(["'])([^"']+)\1/g;
    let match;
    while ((match = fontRegex.exec(code)) !== null) {
      fonts.add(match[2]);
    }

    // 如果有 text() 但没有 textFont，添加默认字体
    const hasText = /text\s*\(/.test(code);
    if (hasText && fonts.size === 0) {
      fonts.add(this.defaultFont);
    }

    return fonts;
  }

  /**
   * 从代码中收集字体的度量数据
   * 自动调用 AST 收集字体，然后从 AE 获取度量
   * @param {string} code - 用户代码
   * @returns {Promise<Object>} { fontName: metrics }
   */
  async collectFontMetricsFromCode(code) {
    const fonts = this.collectFontsFromAST(code);

    if (fonts.size === 0) {
      return {};
    }

    const metricsMap = {};

    for (const fontName of fonts) {
      // 查缓存
      if (this.metricsCache[fontName]) {
        metricsMap[fontName] = this.metricsCache[fontName];
        continue;
      }

      // 获取 PostScript 名称
      const psName = await this.getPostScriptName(fontName);
      const actualFontName = psName || fontName;

      // 使用标准字号(100)获取度量数据（返回比例值）
      const metrics = await this.getFontMetrics(actualFontName, 100);
      if (metrics) {
        this.metricsCache[fontName] = metrics;
        metricsMap[fontName] = metrics;
      }
    }

    return metricsMap;
  }

  /**
   * 初始化：加载所有字体列表
   * @returns {Promise<void>}
   */
  async init() {
    if (this.isLoaded || this.loading) return;

    this.loading = true;

    try {
      const map = await this.loadFontMapFromAE();
      if (map) {
        this.fontMap = map;
        // 构建反向映射
        for (const [displayName, psName] of Object.entries(map)) {
          this.reverseMap[psName] = displayName;
        }
        this.isLoaded = true;
      }
    } catch (e) {
      console.error("[FontAnalyzer] Failed to load font map:", e);
    } finally {
      this.loading = false;
    }
  }

  /**
   * 获取字体度量数据（ascent, descent 等）
   * 使用 Canvas API 测量，返回比例值
   * @param {string} fontName - 字体名称（family 或 PostScript name）
   * @param {number} fontSize - 字号（仅用于缓存区分，实际返回比例值）
   * @returns {Promise<Object|null>} { ascent, descent, baselineOffsetRatio, charWidths }
   */
  async getFontMetrics(fontName, fontSize) {
    return new Promise((resolve) => {
      // 创建隐藏的 canvas 进行测量
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      // 使用标准字号 100 进行测量
      const measureSize = 100;
      ctx.font = `${measureSize}px "${fontName}"`;

      // 测量 ASCII 可打印字符的宽度
      const charWidths = {};
      const chars =
        " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        const width = ctx.measureText(ch).width;
        charWidths[ch] = width / measureSize; // 转为比例值
      }

      // 使用 Canvas TextMetrics 的字体设计框属性获取真实的 ascent/descent
      // - fontBoundingBoxAscent: baseline 到字体设计框顶部的距离
      // - fontBoundingBoxDescent: baseline 到字体设计框底部的距离
      let ascent, descent;

      // 测量 "Hg" 来获取字体设计框（覆盖上行和下行）
      const fontBoxMetrics = ctx.measureText("Hg");
      if (fontBoxMetrics.fontBoundingBoxAscent !== undefined) {
        ascent = fontBoxMetrics.fontBoundingBoxAscent / measureSize;
      } else {
        // 回退：使用经验值
        ascent = 0.8;
      }

      if (fontBoxMetrics.fontBoundingBoxDescent !== undefined) {
        descent = fontBoxMetrics.fontBoundingBoxDescent / measureSize;
      } else {
        // 回退：使用经验值
        descent = 0.2;
      }

      // 计算 baselineOffsetRatio（用于文本定位）
      // baselineOffset = descent / (ascent + descent)
      const baselineOffsetRatio = descent / (ascent + descent);

      const fontMetrics = {
        ascent: ascent,
        descent: descent,
        baselineOffsetRatio: baselineOffsetRatio,
        charWidths: charWidths,
        measureSize: measureSize,
      };

      resolve(fontMetrics);
    });
  }

  /**
   * 计算文本宽度
   * @param {string} fontName - 字体名称
   * @param {number} fontSize - 字号
   * @param {string} text - 要测量的文本
   * @returns {Promise<number>} 文本宽度（像素）
   */
  async getTextWidth(fontName, fontSize, text) {
    if (!text) return 0;

    // 先获取字体度量数据
    const metrics = await this.getFontMetrics(fontName, fontSize);
    if (!metrics) {
      // 回退到估算值
      return text.length * fontSize * 0.55;
    }

    const charWidths = metrics.charWidths || {};
    let width = 0;

    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i);
      width += charWidths[ch] || fontSize * 0.55; // 默认估算宽度
    }

    return width;
  }

  /**
   * 获取字体的 ascent 值
   * @param {string} fontName - 字体名称
   * @param {number} fontSize - 字号
   * @returns {Promise<number>}
   */
  async getAscent(fontName, fontSize) {
    const metrics = await this.getFontMetrics(fontName, fontSize);
    return metrics ? metrics.ascent : fontSize * 0.8;
  }

  /**
   * 获取字体的 descent 值
   * @param {string} fontName - 字体名称
   * @param {number} fontSize - 字号
   * @returns {Promise<number>}
   */
  async getDescent(fontName, fontSize) {
    const metrics = await this.getFontMetrics(fontName, fontSize);
    return metrics ? metrics.descent : fontSize * 0.2;
  }

  /**
   * 获取字体度量数据（同步版本，使用缓存或默认值）
   * @param {string} fontName - 字体名称
   * @param {number} fontSize - 字号
   * @returns {Object|null}
   */
  getFontMetricsSync(fontName, fontSize) {
    const key = `${fontName}_${fontSize}`;
    return this.metricsCache[key] || null;
  }

  /**
   * 从 AE 获取字体映射表
   * @private
   * @returns {Promise<Object>} { displayName: postScriptName, ... }
   */
  loadFontMapFromAE() {
    return new Promise((resolve) => {
      // AE 24.0+ 使用 app.fonts.allFonts
      // 返回格式：{ "Arial": "ArialMT", "Helvetica": "Helvetica", ... }
      const script = `
        (function() {
          try {
            if (!app.fonts || !app.fonts.allFonts) {
              return JSON.stringify({});
            }

            var map = {};
            var groups = app.fonts.allFonts;

            for (var i = 0; i < groups.length; i++) {
              var group = groups[i];
              if (group && group.length > 0) {
                var font = group[0];
                var displayName = font.familyName;
                var psName = font.postScriptName;

                // 避免重复覆盖（allFonts 已排序，第一个最准确）
                if (displayName && psName && !map[displayName]) {
                  map[displayName] = psName;
                }
              }
            }

            return JSON.stringify(map);
          } catch (e) {
            return JSON.stringify({});
          }
        })();
      `;

      if (typeof csInterface !== "undefined") {
        csInterface.evalScript(script, (result) => {
          try {
            const map = JSON.parse(result || "{}");
            resolve(map);
          } catch (e) {
            resolve({});
          }
        });
      } else {
        // 非 CEP 环境（如测试）
        resolve({});
      }
    });
  }

  /**
   * 根据字体显示名称获取 PostScript 名称
   * @param {string} displayName - 字体显示名称，如 "Arial", "Helvetica Neue"
   * @returns {Promise<string|null>} PostScript 名称，如未找到返回 null
   */
  async getPostScriptName(displayName) {
    if (!displayName) return null;

    // 尝试直接查询单个字体（更精确）
    const psName = await this.querySingleFont(displayName);
    if (psName) {
      // 缓存结果
      this.fontMap[displayName] = psName;
      this.reverseMap[psName] = displayName;
      return psName;
    }

    // 查缓存
    if (this.fontMap[displayName]) {
      return this.fontMap[displayName];
    }

    // 如果尚未加载完整列表，尝试加载
    if (!this.isLoaded && !this.loading) {
      await this.init();
      return this.fontMap[displayName] || null;
    }

    return null;
  }

  /**
   * 查询单个字体的 PostScript 名称
   * @private
   * @param {string} displayName - 字体显示名称
   * @returns {Promise<string|null>}
   */
  querySingleFont(displayName) {
    return new Promise((resolve) => {
      // 转义引号
      const escapedName = displayName.replace(/"/g, '\\"');

      const script = `
        (function() {
          try {
            if (!app.fonts || !app.fonts.getFontsByFamilyNameAndStyleName) {
              return null;
            }

            // 尝试多种常见样式
            var styles = ["Regular", "Bold", "Italic", "Bold Italic", ""];

            for (var i = 0; i < styles.length; i++) {
              var fonts = app.fonts.getFontsByFamilyNameAndStyleName("${escapedName}", styles[i]);
              if (fonts && fonts.length > 0) {
                return fonts[0].postScriptName;
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
          resolve(result && result !== "null" ? result : null);
        });
      } else {
        resolve(null);
      }
    });
  }

  /**
   * 根据 PostScript 名称获取显示名称
   * @param {string} postScriptName - PostScript 名称
   * @returns {string|null}
   */
  getDisplayName(postScriptName) {
    return this.reverseMap[postScriptName] || null;
  }

  /**
   * 获取所有已加载的字体映射
   * @returns {Object}
   */
  getAllFonts() {
    return { ...this.fontMap };
  }

  /**
   * 检查字体是否已加载
   * @returns {boolean}
   */
  hasLoaded() {
    return this.isLoaded;
  }
}

// 导出
if (typeof module !== "undefined" && module.exports) {
  module.exports = FontAnalyzer;
}

if (typeof window !== "undefined") {
  window.FontAnalyzer = FontAnalyzer;
}
