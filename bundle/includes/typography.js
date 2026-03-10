// ----------------------------------------
// Typography / Text helpers
// ----------------------------------------
// 负责两件事：
// 1. 在 engine 表达式内维护 p5 风格的文本状态与排版函数
// 2. 在 AE 侧创建文本图层，并只消费 engine 预计算后的文本结果

/**
 * 生成文本状态和排版辅助函数。
 */
function getTextStateLib() {
  return [
    "// Text state",
    "var _textSize = 12;",
    "var _textLeading = _textSize * 1.2;",
    "var _textLeadingExplicit = false;",
    "",
    "// Font state",
    'var _textFontName = "ArialMT";',
    'var _textFontFamily = "Arial";',
    'var _textStyle = "NORMAL";',
    "",
    "var WORD = 'WORD';",
    "var CHAR = 'CHAR';",
    "var _textWrap = WORD;",
    "",
    "var NORMAL = 'NORMAL';",
    "var BOLD = 'BOLD';",
    "var ITALIC = 'ITALIC';",
    "var BOLDITALIC = 'BOLDITALIC';",
    "",
    "function _syncTextLeading() {",
    "  if (!_textLeadingExplicit) _textLeading = _textSize * 1.2;",
    "}",
    "",
    "function _setTextSizeValue(s) {",
    "  _textSize = s;",
    "  _syncTextLeading();",
    "}",
    "",
    "function textSize(s) {",
    "  if (s === undefined) { return _textSize; }",
    "  _setTextSizeValue(s);",
    "}",
    "",
    "function _normalizeTextFontInput(f) {",
    "  var cfg = { name: null, family: null };",
    "  if (typeof f === 'string') {",
    "    cfg.name = f;",
    "    cfg.family = f;",
    "  } else if (f && typeof f === 'object') {",
    "    if (typeof f.postscript === 'string') { cfg.name = f.postscript; }",
    "    if (typeof f.family === 'string') { cfg.family = f.family; }",
    "    if (!cfg.name && typeof f.name === 'string') { cfg.name = f.name; }",
    "    if (!cfg.family && cfg.name) { cfg.family = cfg.name; }",
    "  }",
    "  return cfg;",
    "}",
    "",
    "function textFont(f, s) {",
    "  if (f === undefined) return _textFontName;",
    "  var cfg = _normalizeTextFontInput(f);",
    "  if (cfg.name) { _textFontName = cfg.name; }",
    "  if (cfg.family) { _textFontFamily = cfg.family; }",
    "  if (s !== undefined) _setTextSizeValue(s);",
    "}",
    "",
    "function textStyle(style) {",
    "  if (style === undefined) return _textStyle;",
    "  var s = String(style);",
    "  s = s.toUpperCase();",
    "  if (s === 'NORMAL' || s === 'BOLD' || s === 'ITALIC' || s === 'BOLDITALIC') {",
    "    _textStyle = s;",
    "  }",
    "  return _textStyle;",
    "}",
    "",
    "function textLeading(leading) {",
    "  if (leading === undefined) { return _textLeading; }",
    "  _textLeading = leading;",
    "  _textLeadingExplicit = true;",
    "}",
    "",
    "function textWrap(mode) {",
    "  if (mode === undefined) { return _textWrap; }",
    "  if (mode === WORD || mode === CHAR || mode === 'WORD' || mode === 'CHAR') {",
    "    _textWrap = String(mode);",
    "  }",
    "  return _textWrap;",
    "}",
    "",
    "var _textAlignH = LEFT;",
    "var _textAlignV = BASELINE;",
    "",
    "function textAlign(h, v) {",
    "  if (h === undefined) { return { h: _textAlignH, v: _textAlignV }; }",
    "  if (typeof h === 'number' && (h === LEFT || h === CENTER || h === RIGHT)) {",
    "    _textAlignH = h;",
    "  }",
    "  if (v !== undefined && typeof v === 'number') {",
    "    if (v === TOP || v === CENTER || v === BOTTOM || v === BASELINE) {",
    "      _textAlignV = v;",
    "    }",
    "  }",
    "  return { h: _textAlignH, v: _textAlignV };",
    "}",
    "",
    "function _fontMetrics(fontFamily) {",
    "  var key = fontFamily || _textFontFamily;",
    "  return (_fm && _fm[key]) || null;",
    "}",
    "",
    "function _textAscentFor(fontFamily, size) {",
    "  var metrics = _fontMetrics(fontFamily);",
    "  if (metrics && metrics.ascent !== undefined) {",
    "    return metrics.ascent * size;",
    "  }",
    "  return size * 0.8;",
    "}",
    "",
    "function _textDescentFor(fontFamily, size) {",
    "  var metrics = _fontMetrics(fontFamily);",
    "  if (metrics && metrics.descent !== undefined) {",
    "    return metrics.descent * size;",
    "  }",
    "  return size * 0.2;",
    "}",
    "",
    "function _normText(str) {",
    '  var r = (str === undefined || str === null) ? "" : String(str);',
    '  r = r.split("\\r\\n").join("\\n").split("\\r").join("\\n").split("\\n").join("\\r");',
    "  return r;",
    "}",
    "",
    "function _charFactor(ch) {",
    '  if (ch === " ") return 0.33;',
    "  var code = ch.charCodeAt(0);",
    "  if (code <= 0x007f) return 0.55;",
    "  return 1.0;",
    "}",
    "",
    "function _tok(line, wrap) {",
    "  var tokens = [];",
    "  if (wrap === 'CHAR') {",
    "    for (var ci = 0; ci < line.length; ci++) tokens.push(line.charAt(ci));",
    "    return tokens;",
    "  }",
    '  var buf = "";',
    "  for (var i = 0; i < line.length; i++) {",
    "    var ch = line.charAt(i);",
    "    var code = ch.charCodeAt(0);",
    "    if (code <= 0x007f) {",
    '      if (ch === " ") {',
    "        if (buf.length > 0) { tokens.push(buf); buf = ''; }",
    "        tokens.push(ch);",
    "      } else {",
    "        buf += ch;",
    "      }",
    "    } else {",
    "      if (buf.length > 0) { tokens.push(buf); buf = ''; }",
    "      tokens.push(ch);",
    "    }",
    "  }",
    "  if (buf.length > 0) tokens.push(buf);",
    "  return tokens;",
    "}",
    "",
    "function _measureChars(s, size) {",
    "  var w = 0;",
    "  for (var i = 0; i < s.length; i++) w += _charFactor(s.charAt(i)) * size;",
    "  return w;",
    "}",
    "",
    "function _wrapLine(line, wpx, wrap, size) {",
    "  var tokens = _tok(line, wrap);",
    "  if (!wpx || wpx <= 0) {",
    "    var out0 = [];",
    "    for (var k = 0; k < tokens.length; k++) {",
    "      var tk0 = tokens[k];",
    '      if (tk0 === " ") continue;',
    "      if (tk0 && tk0.length > 0) out0.push(tk0);",
    "    }",
    '    if (out0.length === 0) return [""];',
    "    return out0;",
    "  }",
    "  var out = [];",
    '  var cur = "";',
    "  var curW = 0;",
    "  for (var i = 0; i < tokens.length; i++) {",
    "    var tk = tokens[i];",
    "    var tw = _measureChars(tk, size);",
    "    if (cur.length > 0 && (curW + tw) > wpx) {",
    '      var trimmed = cur.replace(/^ +/, "");',
    "      if (trimmed.length > 0) out.push(trimmed);",
    "      cur = '';",
    "      curW = 0;",
    "    }",
    "    if (tw > wpx) {",
    "      if (cur.length > 0) {",
    '        var trimmed2 = cur.replace(/^ +/, "");',
    "        if (trimmed2.length > 0) out.push(trimmed2);",
    "        cur = '';",
    "        curW = 0;",
    "      }",
    '      if (tk !== " ") {',
    '        var tkTrim = tk.replace(/^ +/, "");',
    "        if (tkTrim.length > 0) out.push(tkTrim);",
    "      }",
    "    } else {",
    "      cur += tk;",
    "      curW += tw;",
    "    }",
    "  }",
    "  if (cur.length > 0) {",
    '    var trimmedLast = cur.replace(/^ +/, "");',
    "    if (trimmedLast.length > 0) out.push(trimmedLast);",
    "  }",
    "  return out;",
    "}",
    "",
    "function _wrapText(str, wpx, wrap, size) {",
    "  var paras = _normText(str).split('\\r');",
    "  var lines = [];",
    "  for (var p = 0; p < paras.length; p++) {",
    '    if (paras[p] === "") { lines.push(""); continue; }',
    "    var wrapped = _wrapLine(paras[p], wpx, wrap, size);",
    "    for (var j = 0; j < wrapped.length; j++) lines.push(wrapped[j]);",
    "  }",
    "  return lines;",
    "}",
    "",
    "function _layoutText(str, size, leading, wrap, wh, alignV, fontFamily) {",
    "  var maxW = (wh && wh.length > 0) ? wh[0] : Infinity;",
    "  var maxH = (wh && wh.length > 1) ? wh[1] : null;",
    "  var lines = _wrapText(str, (typeof maxW === 'number' && maxW === maxW) ? maxW : Infinity, wrap, size);",
    "  if (typeof maxH === 'number' && maxH === maxH && maxH <= 0) lines = [];",
    "  var lineLeading = (leading !== null && leading !== undefined && leading === leading && leading > 0) ? leading : (size * 1.2);",
    "  if (typeof maxH === 'number' && maxH === maxH && maxH > 0) {",
    "    var maxLines = Math.floor(maxH / lineLeading);",
    "    if (maxLines <= 0) lines = [];",
    "    else if (lines.length > maxLines) lines = lines.slice(0, maxLines);",
    "  }",
    "  var ascent = _textAscentFor(fontFamily, size);",
    "  var descent = _textDescentFor(fontFamily, size);",
    "  var baselineShift = 0;",
    "  if (alignV === BOTTOM) baselineShift = descent;",
    "  else if (alignV === TOP) baselineShift = -ascent;",
    "  else if (alignV === CENTER) baselineShift = (descent - ascent) / 2;",
    "  return {",
    "    text: lines.join('\\r'),",
    "    leading: lineLeading,",
    "    baselineShift: baselineShift,",
    "    ascent: ascent,",
    "    descent: descent",
    "  };",
    "}",
    "",
    "function textWidth(str) {",
    "  if (str === undefined || str === null) { return 0; }",
    "  var s = String(str);",
    "  if (s.length === 0) { return 0; }",
    "  var normalized = s.split(/\\r\\n|\\r|\\n/);",
    "  if (normalized.length === 1) return _measureStringWidth(s);",
    "  var maxW = 0;",
    "  for (var lineIdx = 0; lineIdx < normalized.length; lineIdx++) {",
    "    var line = normalized[lineIdx];",
    "    if (line.length > 0) {",
    "      var lineW = _measureStringWidth(line);",
    "      if (lineW > maxW) {",
    "        maxW = lineW;",
    "      }",
    "    }",
    "  }",
    "  return maxW;",
    "}",
    "",
    "function _measureStringWidth(s) {",
    "  if (!s || s.length === 0) { return 0; }",
    "  var fontKey = _textFontFamily;",
    "  var metrics = _fontMetrics(fontKey);",
    "  if (metrics && metrics.charWidths) {",
    "    var charWidths = metrics.charWidths;",
    "    var w = 0;",
    "    for (var i = 0; i < s.length; i++) {",
    "      var ch = s.charAt(i);",
    "      var ratio = charWidths[ch];",
    "      w += (ratio !== undefined ? ratio : 0.55) * _textSize;",
    "    }",
    "    return w;",
    "  }",
    "  return _measureChars(s, _textSize);",
    "}",
    "",
    "function textAscent() {",
    "  return _textAscentFor(_textFontFamily, _textSize);",
    "}",
    "",
    "function textDescent() {",
    "  return _textDescentFor(_textFontFamily, _textSize);",
    "}"
  ].join("\n");
}

/**
 * 生成 engine 侧的 `_text()`，负责把文本排版结果写入 `_shapes`。
 */
function getTextShapeLib() {
  return [
    "function _text() {",
    "  if(!_render){return;}",
    "  var __shapeArgs = _consumeShapeArgs(arguments);",
    "  var __vals = __shapeArgs.values;",
    "  var callsiteId = __shapeArgs.callsiteId;",
    "  var str = __vals[0];",
    "  var x = __vals[1];",
    "  var y = __vals[2];",
    "  if (str === undefined || str === null) { return; }",
    "  var maxWidth = __vals.length > 3 ? __vals[3] : undefined;",
    "  var maxHeight = __vals.length > 4 ? __vals[4] : undefined;",
    "  var ref = _nextShapeRef('text', callsiteId);",
    "  var slotKey = ref.slotKey;",
    "  ",
    "  // 统一转成左上角 + 盒子尺寸，供 engine 侧换行/裁剪使用",
    "  var finalX = x;",
    "  var finalY = y;",
    "  var finalWH = null;",
    "  var rectMode = null;",
    "  ",
    "  if (maxWidth !== undefined) {",
    "    rectMode = (typeof _rectMode !== 'undefined') ? _rectMode : 2;",
    "    var w = maxWidth;",
    "    var h = (maxHeight !== undefined) ? maxHeight : ((rectMode === 3) ? (y + 10000) : 10000);",
    "    if (!(w===w)) w = 0;",
    "    if (!(h===h)) h = 0;",
    "    var boxW = w, boxH = h;",
    "    if (rectMode === 0) {",
    "      // CENTER: x,y 是中心，w,h 是宽高",
    "      finalX = x - w * 0.5;",
    "      finalY = y - h * 0.5;",
    "      boxW = w; boxH = h;",
    "    } else if (rectMode === 1) {",
    "      // RADIUS: x,y 是中心，w,h 是半宽/半高",
    "      finalX = x - w;",
    "      finalY = y - h;",
    "      boxW = w * 2; boxH = h * 2;",
    "    } else if (rectMode === 3) {",
    "      // CORNERS: x,y 是一个角，w,h 是另一个角(x2,y2)",
    "      var x1 = x, y1 = y, x2 = w, y2 = h;",
    "      finalX = Math.min(x1, x2);",
    "      finalY = Math.min(y1, y2);",
    "      boxW = Math.abs(x2 - x1);",
    "      boxH = Math.abs(y2 - y1);",
    "    } else {",
    "      // CORNER(2): x,y 是左上角，w,h 是宽高",
    "      finalX = x;",
    "      finalY = y;",
    "      boxW = w; boxH = h;",
    "    }",
    "    if (!(boxW===boxW)) boxW = 0;",
    "    if (!(boxH===boxH)) boxH = 0;",
    "    var ws = boxW, hs = boxH;",
    "    if (typeof _scaleX !== 'undefined') { var sx = Math.abs(_scaleX); if (sx === sx) { ws = boxW * sx; } }",
    "    if (typeof _scaleY !== 'undefined') { var sy = Math.abs(_scaleY); if (sy === sy) { hs = boxH * sy; } }",
    "    if (!(ws===ws)) ws = boxW;",
    "    if (!(hs===hs)) hs = boxH;",
    "    finalWH = [ws, hs];",
    "    ",
    "  }",
    "  ",
    "  var p = _applyTransform(finalX, finalY);",
    "  var c2 = _encodeColorState();",
    "  var hasFill = !(c2[0][0] < 0);",
    "  var fillColor, fillOp;",
    "  if (!_hasUserFill && hasFill) {",
    "    fillColor = _defaultTextFillColor;",
    "    fillOp = _defaultTextFillColor[3] * 100;",
    "  } else {",
    "    fillColor = hasFill ? [c2[0][0], c2[0][1], c2[1][0], c2[1][1]] : null;",
    "    fillOp = hasFill ? c2[4][0] : 0;",
    "  }",
    "  var hasStrokeGlobal = !(c2[2][0] < 0);",
    "  var hasStroke, strokeColor, strokeOp;",
    "  if (!_hasUserStroke) {",
    "    hasStroke = false;",
    "    strokeColor = null;",
    "    strokeOp = 0;",
    "  } else {",
    "    hasStroke = hasStrokeGlobal;",
    "    strokeColor = hasStroke ? [c2[2][0], c2[2][1], c2[3][0], c2[3][1]] : null;",
    "    strokeOp = hasStroke ? c2[4][1] : 0;",
    "  }",
    "  var sw = c2[5][0];",
    "  var originalPos = _applyTransform(x, y);",
    "  var leading = (typeof _textLeading !== 'undefined') ? _textLeading : null;",
    "  var wrap = (typeof _textWrap !== 'undefined') ? _textWrap : 'WORD';",
    "  var fontFamily = (typeof _textFontFamily === 'string' && _textFontFamily) ? _textFontFamily : 'Arial';",
    "  var fontName = (typeof _textFontName === 'string' && _textFontName) ? _textFontName : 'ArialMT';",
    "  var fontSize = _textSize;",
    "  var fontStyle = (typeof _textStyle === 'string' && _textStyle) ? _textStyle : 'NORMAL';",
    "  var fauxBold = (fontStyle === 'BOLD' || fontStyle === 'BOLDITALIC');",
    "  var fauxItalic = (fontStyle === 'ITALIC' || fontStyle === 'BOLDITALIC');",
    "  var layout = _layoutText(String(str), fontSize, leading, wrap, finalWH, _textAlignV, fontFamily);",
    "  _shapes.push({",
    '    slotKey:slotKey, type:"text",',
    "    pos:p,",
    "    originalPos:originalPos,",
    "    text:layout.text,",
    "    size:fontSize,",
    "    wh:finalWH,",
    "    rectMode:rectMode,",
    "    leading:layout.leading,",
    "    baselineShift:layout.baselineShift,",
    "    wrap:wrap,",
    "    fontFamily:fontFamily,",
    "    fontName:fontName,",
    "    fontSize:fontSize,",
    "    fontStyle:fontStyle,",
    "    fauxBold:fauxBold,",
    "    fauxItalic:fauxItalic,",
    "    fillColor:fillColor, strokeColor:strokeColor,",
    "    fillOpacity:fillOp, strokeOpacity:strokeOp,",
    "    strokeWeight:sw,",
    "    alignment:{h:_textAlignH, v:_textAlignV}",
    "  });",
    "}",
    "function text(){ return _text.apply(this, arguments); }"
  ].join("\n");
}

/**
 * 文本 Position 表达式。
 * 带 `wh` 时按伪 box 处理；否则保留点文本的 rectMode 语义。
 */
function _getTextPositionExpr(indexFind) {
  return [
    indexFind,
    "var rm = shape && shape.rectMode;",
    "if (rm === null || rm === undefined) { rm = 2; }",
    "var pos = shape && shape.pos;",
    "var originalPos = shape && shape.originalPos;",
    "var wh = (shape && shape.wh) ? shape.wh : null;",
    "var hasPseudoBox = (wh && wh.length > 0 && typeof wh[0] === 'number' && wh[0] === wh[0]);",
    "",
    "if (hasPseudoBox) {",
    "  if (!pos || pos.length < 2) {",
    "    [-9999, -9999]",
    "  } else {",
    "    [pos[0], pos[1]]",
    "  }",
    "} else {",
    "  if (rm === 0) {",
    "    var p0 = originalPos;",
    "    if (!p0 || p0.length < 2) {",
    "      [-9999, -9999]",
    "    } else {",
    "      [p0[0], p0[1]]",
    "    }",
    "  } else {",
    "    var p1 = pos;",
    "    if (!p1 || p1.length < 2) {",
    "      [-9999, -9999]",
    "    } else {",
    "      [p1[0], p1[1]]",
    "    }",
    "  }",
    "}"
  ].join("\n");
}

/**
 * 文本 Anchor Point 表达式。
 * 带 `wh` 时对齐到文本内容；否则保留 AE 点文本默认锚点。
 */
function _getAnchorPointExpr(indexFind) {
  return [
    indexFind,
    "var rm = shape && shape.rectMode;",
    "if (rm === null || rm === undefined) { rm = 2; }",
    "var wh = (shape && shape.wh) ? shape.wh : null;",
    "var hasPseudoBox = (wh && wh.length > 0 && typeof wh[0] === 'number' && wh[0] === wh[0]);",
    "if (hasPseudoBox) {",
    "  var r = sourceRectAtTime(time, false);",
    "  if (rm === 0 || rm === 1) {",
    "    var w = (wh && wh.length > 0 && typeof wh[0] === 'number') ? wh[0] : 0;",
    "    var h = (wh && wh.length > 1 && typeof wh[1] === 'number') ? wh[1] : 0;",
    "    [r.left + r.width/2 - w/2, r.top + r.height/2 - h/2]",
    "  } else {",
    "    [r.left, r.top]",
    "  }",
    "} else {",
    "  value",
    "}"
  ].join("\n");
}

/**
 * 排版/文本相关表达式库（按需注入）
 *
 * 目前职责：
 * - 在使用 text() 或 textSize 或 textLeading 时注入：
 *   - 文本状态 textSize、textLeading 及内部状态变量
 *   - _text 渲染函数（向 _shapes 推入 text 语义对象）
 *
 * 依赖：
 * - 需要在 getShapeLib 之后执行，以便复用其中的 slotKey 绑定辅助函数。
 *
 * @param {Object} deps - 依赖对象：
 *   - deps.text: 是否使用了 text() 形状
 *   - deps.textSize: 是否使用了 textSize 函数
 *   - deps.textLeading: 是否使用了 textLeading 函数
 */
function getTypographyLib(deps) {
  if (!deps) deps = {};
  var parts = [];

  // 只要用到 text() 或相关文本函数，就注入文本状态
  if (
    deps.text ||
    deps.textSize ||
    deps.textLeading ||
    deps.textWrap ||
    deps.textFont ||
    deps.textStyle ||
    deps.textAlign ||
    deps.textWidth ||
    deps.textAscent ||
    deps.textDescent ||
    deps.WORD ||
    deps.CHAR ||
    deps.LEFT ||
    deps.CENTER ||
    deps.RIGHT ||
    deps.TOP ||
    deps.BOTTOM ||
    deps.BASELINE
  ) {
    parts.push(getTextStateLib());
  }

  // 只要用到 text()，就注入 _text 形状渲染函数
  if (deps.text) {
    parts.push(getTextShapeLib());
  }

  return parts.join("\n");
}

/**
 * 创建 AE 文本图层，并绑定内容、位置和样式表达式。
 */
function createTextLayerFromContext(index, slotKey, mainCompName) {
  if (typeof engineComp === "undefined" || !engineComp || !engineComp.layers) {
    return null;
  }

  var layer = engineComp.layers.addText("");

  layer.name = "Text_" + index;

  // 统一文字图层的 Fill/Stroke 绘制顺序，避免继承用户上一次手动创建文本的设置。
  try {
    var textGroup = layer.property("Text");
    if (textGroup) {
      var fillStrokeProp = null;

      fillStrokeProp =
        textGroup.property("Fill & Stroke") ||
        textGroup.property("Fill and Stroke") ||
        textGroup.property("填充和描边") ||
        textGroup.property("ADBE Text Fill and Stroke");

      if (!fillStrokeProp) {
        var moreOptions =
          textGroup.property("More Options") ||
          textGroup.property("更多选项") ||
          textGroup.property("ADBE Text More Options");
        if (moreOptions) {
          fillStrokeProp =
            moreOptions.property("Fill & Stroke") ||
            moreOptions.property("Fill and Stroke") ||
            moreOptions.property("填充和描边") ||
            moreOptions.property("ADBE Text Fill and Stroke");
        }
      }

      if (fillStrokeProp && fillStrokeProp.setValue) {
        fillStrokeProp.setValue(2);
      }
    }
  } catch (e) {
    // 老版本或精简版 AE 可能没有该属性，忽略即可。
  }

  var textProp = layer.property("Source Text");
  var transform = layer.property("Transform");

  // 清理段落边距，避免继承用户手动创建文本时留下的缩进配置。
  try {
    if (textProp && textProp.value !== undefined) {
      var baseDoc = textProp.value;
      if (baseDoc) {
        if (baseDoc.leftMargin !== undefined) baseDoc.leftMargin = 0;
        if (baseDoc.rightMargin !== undefined) baseDoc.rightMargin = 0;
        if (baseDoc.firstLineLeftMargin !== undefined)
          baseDoc.firstLineLeftMargin = 0;
        if (baseDoc.spaceBefore !== undefined) baseDoc.spaceBefore = 0;
        if (baseDoc.spaceAfter !== undefined) baseDoc.spaceAfter = 0;
        textProp.setValue(baseDoc);
      }
    }
  } catch (e) {
    // 某些环境不支持这些字段，忽略即可。
  }

  var indexFind = _getSlotFindExpr(slotKey, mainCompName);

  // 文本内容和排版已在 engine 侧预计算，这里只消费最终结果。
  textProp.expression = [
    indexFind,
    "var t = shape && shape.text;",
    "var s = shape && shape.size || 12;",
    'var finalText = (t === undefined ? "" : String(t));',
    "var leading = shape && shape.leading !== undefined && shape.leading !== null ? shape.leading : null;",
    "var fontName = shape && shape.fontName ? String(shape.fontName) : 'ArialMT';",
    "var fauxBold = !!(shape && shape.fauxBold);",
    "var fauxItalic = !!(shape && shape.fauxItalic);",
    "var baselineShift = shape && shape.baselineShift !== undefined ? shape.baselineShift : 0;",
    "var textStyle = style.setText(finalText)",
    "  .setFontSize(s)",
    "  .setFont(fontName)",
    "  .setVerticalScaling(100)",
    "  .setHorizontalScaling(100)",
    "  .setBaselineShift(baselineShift)",
    "  .setAutoLeading(false);",
    "try {",
    "  textStyle = textStyle.setFauxBold(fauxBold);",
    "} catch (e) {}",
    "try {",
    "  textStyle = textStyle.setFauxItalic(fauxItalic);",
    "} catch (e) {}",
    "if (leading !== null) {",
    "  textStyle = textStyle.setLeading(leading);",
    "}",
    "var hAlign = shape && shape.alignment && shape.alignment.h !== undefined ? shape.alignment.h : 0;",
    "try {",
    "  if (hAlign === 0) {",
    "    textStyle = textStyle.setJustification('alignCenter');",
    "  } else if (hAlign === 2) {",
    "    textStyle = textStyle.setJustification('alignRight');",
    "  } else {",
    "    textStyle = textStyle.setJustification('alignLeft');",
    "  }",
    "} catch (e) {}",
    "textStyle;"
  ].join("\n");

  transform.property("Position").expression = _getPositionExpr(indexFind);
  transform.property("Anchor Point").expression =
    _getAnchorPointExpr(indexFind);

  // 样式（填充/描边）
  attachTextStyleExpressions(layer, slotKey, mainCompName);

  return layer;
}

/**
 * text 数据结构：
 * {
 *   slotKey,
 *   type: "text",
 *   pos,                // [x, y] 根据 rectMode 计算后的位置（用于 CORNER 模式）
 *   originalPos,        // [x, y] 原始位置（用于 CENTER 模式）
 *   text,               // 文本内容
 *   size,               // 文本字号
 *   wh,                 // 伪文本框尺寸 [width, height]（用于 engine 侧换行/裁剪）
 *   rectMode,           // rectMode 值（0=CENTER, 1=RADIUS, 2=CORNER, 3=CORNERS）
 *   leading,            // 行距
 *   fontFamily,         // 字体 family 名（用于 fontMetrics 查表）
 *   fontName,           // 传给 AE style.setFont 的具体字体名称（推荐 PostScript name）
 *   fontSize,           // 文本字号（与 size 一致，用于 baseline shift 计算）
 *   fontStyle,          // p5 风格样式：NORMAL / BOLD / ITALIC / BOLDITALIC
 *   fauxBold, fauxItalic, // AE 假粗体 / 假斜体开关（由 textStyle 控制）
 *   fillColor, strokeColor,
 *   fillOpacity, strokeOpacity,
 *   strokeWeight
 * }
 *
 * 作为 shape.js 的统一入口函数，被 shapeCreators.text 调用。
 */
function createTextFromContext(index, slotKey, mainCompName) {
  if (typeof createTextLayerFromContext === "function") {
    return createTextLayerFromContext(index, slotKey, mainCompName);
  }
}

/**
 * 为文本图层挂载填充与描边表达式。
 */
function attachTextStyleExpressions(layer, slotKey, mainCompName) {
  if (!layer || !layer.property) {
    return;
  }

  var textGroup = layer.property("Text");
  if (!textGroup) {
    return;
  }

  var indexFind = _getSlotFindExpr(slotKey, mainCompName);

  var animatorsGroup = textGroup.property("ADBE Text Animators");
  if (!animatorsGroup) {
    return;
  }

  var animator = animatorsGroup.addProperty("ADBE Text Animator");
  if (!animator) {
    return;
  }
  try {
    animator.name = "Momentum_ColorStroke";
  } catch (e) {
    // 部分版本不允许改名，忽略即可。
  }

  var selectorsGroup = animator.property("ADBE Text Selectors");
  if (selectorsGroup) {
    var rangeSelector = selectorsGroup.addProperty("ADBE Text Selector");
    if (rangeSelector) {
      var startProp = rangeSelector.property("ADBE Text Selector Start");
      var endProp = rangeSelector.property("ADBE Text Selector End");
      var offsetProp = rangeSelector.property("ADBE Text Selector Offset");
      if (startProp) startProp.setValue(0);
      if (endProp) endProp.setValue(100);
      if (offsetProp) offsetProp.setValue(0);
    }
  }

  var animatorProps = animator.property("ADBE Text Animator Properties");
  if (!animatorProps) {
    return;
  }

  var animFillColor = animatorProps.addProperty("ADBE Text Fill Color");
  if (animFillColor) {
    animFillColor.expression = _getFillColorExpr(indexFind);
  }
  var animFillOpacity = animatorProps.addProperty("ADBE Text Fill Opacity");
  if (animFillOpacity) {
    animFillOpacity.expression = _getFillOpacityExpr(indexFind);
  }

  var animStrokeColor = animatorProps.addProperty("ADBE Text Stroke Color");
  if (animStrokeColor) {
    animStrokeColor.expression = _getStrokeColorExpr(indexFind);
  }
  var animStrokeOpacity = animatorProps.addProperty("ADBE Text Stroke Opacity");
  if (animStrokeOpacity) {
    animStrokeOpacity.expression = _getStrokeOpacityExpr(indexFind);
  }
  var animStrokeWidth = animatorProps.addProperty("ADBE Text Stroke Width");
  if (animStrokeWidth) {
    animStrokeWidth.expression = _getStrokeWidthExpr(indexFind, 1);
  }
}
