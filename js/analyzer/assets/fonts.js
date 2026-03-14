// Collects textFont usage and resolves font metrics for analysis/runtime.

class FontAnalyzer {
  constructor() {
    this.fontMap = {};
    this.fontEntries = [];
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
    return await this.collectFontMetricsFromNames(fonts);
  }

  async collectFontMetricsFromNames(fontNames) {
    const fonts = this._normalizeFontNames(fontNames);

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

  _normalizeFontNames(fontNames) {
    if (fontNames instanceof Set) {
      return fontNames;
    }

    if (Array.isArray(fontNames)) {
      return new Set(fontNames.filter(Boolean));
    }

    return new Set();
  }

  async init() {
    if (this.isLoaded || this.loading) return;

    this.loading = true;

    try {
      this._applyFontCatalog(await this.loadFontCatalogFromAE());
    } catch (e) {
    } finally {
      this.loading = false;
    }
  }

  _getCepInterface() {
    return typeof window !== "undefined" ? window.csInterface || null : null;
  }

  _parseFontEntries(result) {
    try {
      const entries = JSON.parse(result || "[]");
      return Array.isArray(entries) ? entries : [];
    } catch (e) {
      return [];
    }
  }

  _applyFontCatalog(entries) {
    const nextEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
    const nextMap = {};
    const nextReverseMap = {};

    function remember(label, psName) {
      if (!label || !psName || nextMap[label]) {
        return;
      }
      nextMap[label] = psName;
    }

    nextEntries.forEach((entry) => {
      const family = entry.family || "";
      const style = entry.style || "";
      const displayName = entry.displayName || family || entry.postScriptName || "";
      const postScriptName = entry.postScriptName || "";

      remember(displayName, postScriptName);
      remember(family, postScriptName);

      if (family && style) {
        remember(`${family} ${style}`, postScriptName);
        remember(`${family}-${style.replace(/\s+/g, "")}`, postScriptName);
      }

      if (postScriptName && !nextReverseMap[postScriptName]) {
        nextReverseMap[postScriptName] = displayName;
      }
    });

    this.fontEntries = nextEntries;
    this.fontMap = nextMap;
    this.reverseMap = nextReverseMap;
    this.isLoaded = nextEntries.length > 0 || Object.keys(nextMap).length > 0;
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

  loadFontCatalogFromAE() {
    return new Promise((resolve) => {
      const cep = this._getCepInterface();
      const fallbackScript = `
        (function() {
          try {
            if (!app.fonts || !app.fonts.allFonts) {
              return JSON.stringify([]);
            }

            var entries = [];
            var seen = {};
            var groups = app.fonts.allFonts;

            function remember(entry) {
              var key = [
                entry.family || "",
                entry.style || "",
                entry.displayName || "",
                entry.postScriptName || ""
              ].join("|");

              if (!entry.displayName || !entry.postScriptName || seen[key]) {
                return;
              }

              seen[key] = true;
              entries.push(entry);
            }

            for (var i = 0; i < groups.length; i++) {
              var group = groups[i];
              if (!group || !group.length) {
                continue;
              }

              for (var j = 0; j < group.length; j++) {
                var font = group[j];
                if (!font) {
                  continue;
                }

                var familyName = font.familyName || "";
                var styleName = font.styleName || "";
                var postScriptName = font.postScriptName || "";
                var displayName = familyName;

                if (familyName && styleName) {
                  displayName = familyName + " " + styleName;
                } else if (!displayName) {
                  displayName = postScriptName;
                }

                remember({
                  family: familyName,
                  style: styleName,
                  displayName: displayName,
                  postScriptName: postScriptName
                });
              }
            }

            return JSON.stringify(entries);
          } catch (e) {
            return JSON.stringify([]);
          }
        })();
      `;

      if (cep && typeof cep.evalScript === "function") {
        cep.evalScript(
          "typeof getAvailableFontCatalog === 'function' ? getAvailableFontCatalog() : '[]'",
          (result) => {
            const entries = this._parseFontEntries(result);
            if (entries.length > 0) {
              resolve(entries);
              return;
            }

            cep.evalScript(fallbackScript, (fallbackResult) => {
              resolve(this._parseFontEntries(fallbackResult));
            });
          },
        );
      } else {
        resolve([]);
      }
    });
  }

  loadFontMapFromAE() {
    return this.loadFontCatalogFromAE().then((entries) => {
      const map = {};
      (entries || []).forEach((entry) => {
        if (entry && entry.displayName && entry.postScriptName && !map[entry.displayName]) {
          map[entry.displayName] = entry.postScriptName;
        }
      });
      return map;
    });
  }

  async refreshFontMap() {
    try {
      this._applyFontCatalog(await this.loadFontCatalogFromAE());
    } catch (e) {
    }
    return { ...this.fontMap };
  }

  async getPostScriptName(displayName) {
    if (!displayName) return null;

    if (this.fontMap[displayName]) {
      return this.fontMap[displayName];
    }

    const psName = await this.querySingleFont(displayName);
    if (psName) {
      this.fontMap[displayName] = psName;
      this.reverseMap[psName] = displayName;
      return psName;
    }

    if (!this.isLoaded && !this.loading) {
      await this.init();
      return this.fontMap[displayName] || null;
    }

    return null;
  }

  querySingleFont(displayName) {
    return new Promise((resolve) => {
      const cep = this._getCepInterface();
      const escapedName = displayName.replace(/"/g, '\\"');

      const script = `
        (function() {
          try {
            if (!app.fonts || !app.fonts.getFontsByFamilyNameAndStyleName) {
              return null;
            }

            var name = "${escapedName}";
            var dashIndex = name.lastIndexOf("-");
            var familyName = name;
            var styles = ["Regular", "Bold", "Italic", "Bold Italic", ""];

            if (dashIndex > 0) {
              familyName = name.slice(0, dashIndex);
              styles.unshift(name.slice(dashIndex + 1).replace(/([a-z])([A-Z])/g, "$1 $2"));
            } else if (name.indexOf(" ") > 0) {
              var parts = name.split(/\\s+/);
              for (var i = parts.length - 1; i > 0; i--) {
                var testFamily = parts.slice(0, i).join(" ");
                var testStyle = parts.slice(i).join(" ");
                if (testStyle) {
                  var matchedFonts = app.fonts.getFontsByFamilyNameAndStyleName(testFamily, testStyle);
                  if (matchedFonts && matchedFonts.length > 0) {
                    return matchedFonts[0].postScriptName;
                  }
                }
              }
            }

            for (var j = 0; j < styles.length; j++) {
              var fonts = app.fonts.getFontsByFamilyNameAndStyleName(familyName, styles[j]);
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

      if (cep && typeof cep.evalScript === "function") {
        cep.evalScript(script, (result) => {
          try {
            resolve(result && result !== "null" ? result : null);
          } catch (e) {
            resolve(null);
          }
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

  getAllFontEntries() {
    return this.fontEntries.map((entry) => ({ ...entry }));
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
