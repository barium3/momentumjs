// Collects textFont usage and resolves font metrics for analysis/runtime.

class FontAnalyzer {
  constructor() {
    this.fontMap = {};
    this.reverseMap = {};
    this.metricsCache = {};
    this.textWidthCache = {};
    this.isLoaded = false;
    this.loading = false;
    this.defaultFont = "Arial";
  }

  collectFontsFromAST(code) {
    const fonts = new Set();

    if (!code || !code.trim()) {
      return fonts;
    }

    if (typeof acorn === "undefined") {
      console.warn("[FontAnalyzer] acorn not available, falling back to regex");
      return this._collectFontsFromRegex(code);
    }

    try {
      const ast = acorn.parse(code, {
        ecmaVersion: 2020,
        sourceType: "script",
      });
      const result = this._walkAST(fonts, ast);
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

  _walkAST(fonts, node) {
    const result = { hasText: false };
    if (!node || typeof node !== "object") return result;
    walkAst(node, (child) => {
      if (child.type !== "CallExpression" || !child.callee) {
        return;
      }
      const funcName = getAstCalleeName(child.callee);
      if (
        funcName === "textFont" &&
        child.arguments &&
        child.arguments.length > 0
      ) {
        const arg = child.arguments[0];
        if (arg.type === "Literal" && typeof arg.value === "string") {
          fonts.add(arg.value);
        }
      }
      if (funcName === "text") {
        result.hasText = true;
      }
    });

    return result;
  }

  _collectFontsFromRegex(code) {
    const fonts = new Set();

    const fontRegex = /textFont\s*\(\s*(["'])([^"']+)\1/g;
    let match;
    while ((match = fontRegex.exec(code)) !== null) {
      fonts.add(match[2]);
    }

    const hasText = /text\s*\(/.test(code);
    if (hasText && fonts.size === 0) {
      fonts.add(this.defaultFont);
    }

    return fonts;
  }

  async collectFontMetricsFromCode(code) {
    const fonts = this.collectFontsFromAST(code);

    if (fonts.size === 0) {
      return {};
    }

    const metricsMap = {};

    for (const fontName of fonts) {
      if (this.metricsCache[fontName]) {
        metricsMap[fontName] = this.metricsCache[fontName];
        continue;
      }

      const psName = await this.getPostScriptName(fontName);
      const actualFontName = psName || fontName;

      const metrics = await this.getFontMetrics(actualFontName, 100);
      if (metrics) {
        this.metricsCache[fontName] = metrics;
        metricsMap[fontName] = metrics;
      }
    }

    return metricsMap;
  }

  async init() {
    if (this.isLoaded || this.loading) return;

    this.loading = true;

    try {
      const map = await this.loadFontMapFromAE();
      if (map) {
        this.fontMap = map;
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

  async getFontMetrics(fontName, fontSize) {
    return new Promise((resolve) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      const measureSize = 100;
      ctx.font = `${measureSize}px "${fontName}"`;

      const charWidths = {};
      const chars =
        " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        const width = ctx.measureText(ch).width;
        charWidths[ch] = width / measureSize;
      }

      let ascent, descent;

      const fontBoxMetrics = ctx.measureText("Hg");
      if (fontBoxMetrics.fontBoundingBoxAscent !== undefined) {
        ascent = fontBoxMetrics.fontBoundingBoxAscent / measureSize;
      } else {
        ascent = 0.8;
      }

      if (fontBoxMetrics.fontBoundingBoxDescent !== undefined) {
        descent = fontBoxMetrics.fontBoundingBoxDescent / measureSize;
      } else {
        descent = 0.2;
      }

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

  async getTextWidth(fontName, fontSize, text) {
    if (!text) return 0;

    const metrics = await this.getFontMetrics(fontName, fontSize);
    if (!metrics) {
      return text.length * fontSize * 0.55;
    }

    const charWidths = metrics.charWidths || {};
    let width = 0;

    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i);
      width += charWidths[ch] || fontSize * 0.55;
    }

    return width;
  }

  async getAscent(fontName, fontSize) {
    const metrics = await this.getFontMetrics(fontName, fontSize);
    return metrics ? metrics.ascent : fontSize * 0.8;
  }

  async getDescent(fontName, fontSize) {
    const metrics = await this.getFontMetrics(fontName, fontSize);
    return metrics ? metrics.descent : fontSize * 0.2;
  }

  getFontMetricsSync(fontName, fontSize) {
    const key = `${fontName}_${fontSize}`;
    return this.metricsCache[key] || null;
  }

  loadFontMapFromAE() {
    return new Promise((resolve) => {
      // Query the AE font catalog once and cache the displayName -> postScriptName map.
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
        resolve({});
      }
    });
  }

  async getPostScriptName(displayName) {
    if (!displayName) return null;

    const psName = await this.querySingleFont(displayName);
    if (psName) {
      this.fontMap[displayName] = psName;
      this.reverseMap[psName] = displayName;
      return psName;
    }

    if (this.fontMap[displayName]) {
      return this.fontMap[displayName];
    }

    if (!this.isLoaded && !this.loading) {
      await this.init();
      return this.fontMap[displayName] || null;
    }

    return null;
  }

  querySingleFont(displayName) {
    return new Promise((resolve) => {
      const escapedName = displayName.replace(/"/g, '\\"');

      const script = `
        (function() {
          try {
            if (!app.fonts || !app.fonts.getFontsByFamilyNameAndStyleName) {
              return null;
            }

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

  getDisplayName(postScriptName) {
    return this.reverseMap[postScriptName] || null;
  }

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
