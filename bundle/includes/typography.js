// ----------------------------------------
// Typography / Text helpers
// ----------------------------------------
//
// 负责在表达式侧注入与文本相关的状态和函数：
// - textSize
// - _text 渲染函数（生成语义化 JSON，后续由 shape.js -> AE Text Layer 渲染）
//
// 该模块不直接依赖 AE 对象，只拼接表达式字符串，供 getShapeLib / getTypographyLib 使用。

/**
 * 生成文本状态相关的表达式代码：
 * - _textSize
 * - textSize()
 * - _textLeading (默认值为字体大小的 1.2 倍，与 p5.js 一致)
 * - textLeading()
 */
function getTextStateLib() {
  return [
    "// Text state (p5-style, minimal first batch)",
    "var _textSize = 12;", // 默认字号，与 p5 默认 textSize 一致
    "var _textLeading = _textSize * 1.2;", // 默认行距，与 p5 默认 textLeading 一致（字体大小的 1.2 倍）
    "var _textLeadingExplicit = false;", // 标记 textLeading 是否被显式设置过
    "",
    "// textFont / textStyle 状态（p5 风格 + AE 友好的扩展）",
    "// - _textFontName: 传给 AE style.setFont 的字体名称（推荐使用 PostScript name）",
    "// - _textFontFamily: 用于 fontMetrics 查表的 family 名（缺省时退回 Arial）",
    "// - _textStyle: p5 风格样式常量：NORMAL / BOLD / ITALIC / BOLDITALIC",
    'var _textFontName = "Arial";',
    'var _textFontFamily = "Arial";',
    'var _textStyle = "NORMAL";',
    "",
    "// textWrap constants (p5.js compatible)",
    "var WORD = 'WORD';",
    "var CHAR = 'CHAR';",
    "// 默认换行策略：p5.js 默认为 WORD",
    "var _textWrap = WORD;",
    "",
    "function textSize(s) {",
    "  if (s === undefined) { return _textSize; }",
    "  _textSize = s;",
    "  // 当 textSize 改变时，如果 textLeading 未被显式设置，则自动更新为默认值（textSize * 1.2）",
    "  if (!_textLeadingExplicit) {",
    "    _textLeading = _textSize * 1.2;",
    "  }",
    "}",
    "",
    "// textFont(font | config, [size])",
    "// - 字符串：直接作为 AE 的字体名称（推荐传 PostScript name），同时作为 family 用于 metrics",
    "// - 对象：{ postscript, family, name }",
    "//   - postscript: 作为 AE setFont 的首选名称",
    "//   - family: 作为 fontMetrics 的 family key，便于跨机保持稳定",
    "//   - name: 备用字段，当 postscript 不存在时可用作 setFont 名称",
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
    "  // 无参：返回当前字体名称（兼容 p5 行为）",
    "  if (f === undefined) {",
    "    return _textFontName;",
    "  }",
    "  var cfg = _normalizeTextFontInput(f);",
    "  if (cfg.name) { _textFontName = cfg.name; }",
    "  if (cfg.family) { _textFontFamily = cfg.family; }",
    "  // 可选：第二个参数 size 等价于 textSize(size)",
    "  if (s !== undefined) {",
    "    _textSize = s;",
    "    if (!_textLeadingExplicit) {",
    "      _textLeading = _textSize * 1.2;",
    "    }",
    "  }",
    "}",
    "",
    "// textStyle(style)",
    "// - 支持 NORMAL / BOLD / ITALIC / BOLDITALIC（大小写不敏感，也接受 p5 常量）",
    "function textStyle(style) {",
    "  if (style === undefined) {",
    "    return _textStyle;",
    "  }",
    "  var s = String(style);",
    "  // 允许传入 p5 的常量（例如 BOLD），此处统一转大写字符串比较",
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
    "  _textLeadingExplicit = true;", // 标记已被显式设置
    "}",
    "",
    "function textWrap(mode) {",
    "  if (mode === undefined) { return _textWrap; }",
    "  // 与 p5.js 一致：仅支持 WORD / CHAR；忽略非法输入",
    "  if (mode === WORD || mode === CHAR || mode === 'WORD' || mode === 'CHAR') {",
    "    _textWrap = String(mode);",
    "  }",
    "  return _textWrap;",
    "}",
    "",
    "// textAlign 对齐常量（p5.js 兼容）",
    "var LEFT = 'LEFT';",
    "var CENTER = 'CENTER';",
    "var RIGHT = 'RIGHT';",
    "var TOP = 'TOP';",
    "var BOTTOM = 'BOTTOM';",
    "var BASELINE = 'BASELINE';",
    "",
    "// textAlign 状态变量",
    "var _textAlignH = LEFT;",
    "var _textAlignV = BASELINE;",
    "",
    "function textAlign(h, v) {",
    "  // 无参：返回当前对齐 {h, v}",
    "  if (h === undefined) { return { h: _textAlignH, v: _textAlignV }; }",
    "  // 水平对齐",
    "  var hStr = String(h).toUpperCase();",
    "  if (hStr === 'LEFT' || hStr === 'CENTER' || hStr === 'RIGHT') {",
    "    _textAlignH = hStr;",
    "  }",
    "  // 垂直对齐（可选）",
    "  if (v !== undefined) {",
    "    var vStr = String(v).toUpperCase();",
    "    if (vStr === 'TOP' || vStr === 'CENTER' || vStr === 'BOTTOM' || vStr === 'BASELINE') {",
    "      _textAlignV = vStr;",
    "    }",
    "  }",
    "  return { h: _textAlignH, v: _textAlignV };",
    "}",
  ].join("\n");
}

/**
 * 生成 _text 渲染函数表达式代码：
 * - 读取当前变换矩阵和颜色状态
 * - 将语义化文本对象推入 _shapes
 *
 * 依赖：
 * - _render, _shapeTypeCode.text
 * - _applyTransform, _encodeColorState
 * - _shapes 数组
 */
function getTextShapeLib() {
  return [
    "var _textCount = 0;",
    "",
    "function _text(str, x, y) {",
    "  if(!_render){return;}",
    "  if (str === undefined || str === null) { return; }",
    "  var maxWidth = arguments.length > 3 ? arguments[3] : undefined;",
    "  var maxHeight = arguments.length > 4 ? arguments[4] : undefined;",
    "  _textCount++;",
    "  var m = _textCount;",
    "  var id = _shapeTypeCode.text * 10000 + m;",
    "  ",
    "  // 根据 rectMode 计算位置和 wh 尺寸（用于表达式侧换行/裁剪）",
    "  var finalX = x;",
    "  var finalY = y;",
    "  var finalWH = null;",
    "  var rectMode = null;",
    "  ",
    "  if (maxWidth !== undefined) {",
    "    rectMode = (typeof _rectMode !== 'undefined') ? _rectMode : 2;",
    "    var w = maxWidth;",
    "    // CORNERS(3): 第四/五参是 x2,y2；如果没传 y2，默认用 y+10000（保持原有“无限高”语义）",
    "    var h = (maxHeight !== undefined) ? maxHeight : ((rectMode === 3) ? (y + 10000) : 10000);",
    "    if (!(w===w)) w = 0;",
    "    if (!(h===h)) h = 0;",
    "    // 注意：_applyTransform 会把坐标按 _scaleX/_scaleY 缩放，但文本图层本身不会跟随缩放，",
    "    // 所以用于换行/裁剪的宽高也需要乘上 scale。",
    "    // 同时：表达式侧会做“1 word/line”下限，不会再退化到逐字符换行。",
    "    // 统一先把输入转成：左上角(finalX,finalY) + 盒子尺寸(boxW,boxH)",
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
    "    // 计算缩放后的 wh 尺寸（用于表达式侧换行/裁剪）",
    "    var ws = boxW, hs = boxH;",
    "    if (typeof _scaleX !== 'undefined') { var sx = Math.abs(_scaleX); if (sx === sx) { ws = boxW * sx; } }",
    "    if (typeof _scaleY !== 'undefined') { var sy = Math.abs(_scaleY); if (sy === sy) { hs = boxH * sy; } }",
    "    if (!(ws===ws)) ws = boxW;",
    "    if (!(hs===hs)) hs = boxH;",
    "    finalWH = [ws, hs];",
    "    ",
    "  }",
    "  ",
    "  // pos: 用于 CORNER 模式的 Position 表达式",
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
    "  // originalPos: 用于 CENTER 模式的 Position 表达式",
    "  var originalPos = _applyTransform(x, y);",
    "  var leading = (typeof _textLeading !== 'undefined') ? _textLeading : null;",
    "  var wrap = (typeof _textWrap !== 'undefined') ? _textWrap : 'WORD';",
    "  // 添加字体信息，供 baseline shift / AE 字体设置使用",
    "  // - fontFamily: 用于 fontMetrics 查表的 family 名称（默认 Arial）",
    "  // - fontName:   传给 AE style.setFont 的具体字体名称（推荐 PostScript name）",
    "  // - fontSize:   文本字号",
    "  // - fontStyle:  p5 风格样式字符串：NORMAL / BOLD / ITALIC / BOLDITALIC",
    "  // - fauxBold / fauxItalic: 是否启用 AE 的假粗体 / 假斜体（由 textStyle 控制）",
    "  var fontFamily = (typeof _textFontFamily === 'string' && _textFontFamily) ? _textFontFamily : 'Arial';",
    "  var fontName = (typeof _textFontName === 'string' && _textFontName) ? _textFontName : fontFamily;",
    "  var fontSize = _textSize;",
    "  var fontStyle = (typeof _textStyle === 'string' && _textStyle) ? _textStyle : 'NORMAL';",
    "  var fauxBold = (fontStyle === 'BOLD' || fontStyle === 'BOLDITALIC');",
    "  var fauxItalic = (fontStyle === 'ITALIC' || fontStyle === 'BOLDITALIC');",
    "  _shapes.push({",
    '    id:id, type:"text",',
    "    pos:p,",
    "    originalPos:originalPos,",
    "    text:String(str),",
    "    size:_textSize,",
    "    wh:finalWH,",
    "    rectMode:rectMode,",
    "    leading:leading,",
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
  ].join("\n");
}

/**
 * 生成 Position 表达式（统一点文本 + 伪 box 支持）
 *
 * 逻辑：
 * - 对于带 wh 的「伪 box」文本：
 *   - rectMode=CORNER(2)：shape.pos 视为左上角坐标，直接作为 Position
 *   - rectMode=CENTER(0)：shape.pos 视为盒子中心坐标
 *   - rectMode=RADIUS(1)：shape.pos 视为盒子中心坐标（w,h 为半宽/半高）
 *   - rectMode=CORNERS(3)：shape.pos 视为左上角坐标（由 x1,y1,x2,y2 计算得到）
 *   - 最终 Position 始终代表「文本内容左上角」，与 _getAnchorPointExpr 保持一致
 * - 对于普通点文本（无 wh）：
 *   - 保持原有逻辑：rectMode=0 用 originalPos，其他模式用 pos
 *
 * @param {string} indexFind - index 查找表达式（需要在表达式内提供 shape 变量）
 * @returns {string} Position 表达式
 */
function _getTextPositionExpr(indexFind) {
  return [
    indexFind,
    "var rm = shape && shape.rectMode;",
    "// 默认：CORNER(2)",
    "if (rm === null || rm === undefined) { rm = 2; }",
    "var pos = shape && shape.pos;",
    "var originalPos = shape && shape.originalPos;",
    "var wh = (shape && shape.wh) ? shape.wh : null;",
    "// 只要传了 w/h（即 wh 存在），就认为是“伪 box”。即使 w=0 也不能回退到 AE 默认锚点语义，避免 Anchor 回跳。",
    "var hasPseudoBox = (wh && wh.length > 0 && typeof wh[0] === 'number' && wh[0] === wh[0]);",
    "",
    "// 伪 box：Position 直接使用传入的 pos（x,y 语义由 rectMode 决定），Anchor Point 内部做对齐",
    "if (hasPseudoBox) {",
    "  if (!pos || pos.length < 2) {",
    "    [-9999, -9999]",
    "  } else {",
    "    [pos[0], pos[1]]",
    "  }",
    "} else {",
    "  // 非伪 box：保留原有点文本 rectMode 语义",
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
    "}",
  ].join("\n");
}

/**
 * 生成 Anchor Point 表达式（统一点文本模式）
 *
 * 逻辑（已无真正 boxText，只区分是否带有 wh 的「伪 box」）：
 * - 如果 shape.wh 存在并且宽度 > 0：视为「伪 box」文本
 *   - 使用 sourceRectAtTime() 将锚点对齐到文本内容左上角
 *   - 这样 engine 侧传入的 x,y 可以被当作「文本内容左上角」坐标使用
 * - 其他情况：保持 AE 默认锚点（通常是首字符左下角基线附近）
 *
 * @param {string} indexFind - index 查找表达式（需要在表达式内提供 shape 变量）
 * @returns {string} Anchor Point 表达式
 */
function _getAnchorPointExpr(indexFind) {
  return [
    indexFind,
    "var rm = shape && shape.rectMode;",
    "// 默认：CORNER(2)",
    "if (rm === null || rm === undefined) { rm = 2; }",
    "var wh = (shape && shape.wh) ? shape.wh : null;",
    "// 只要传了 w/h（即 wh 存在），就认为是“伪 box”。w=0 时也保持对齐，避免锚点回跳到首字母左下角。",
    "var hasPseudoBox = (wh && wh.length > 0 && typeof wh[0] === 'number' && wh[0] === wh[0]);",
    "// 带 wh: 视为伪 box，锚点按 rectMode 对齐到文本内容（用 sourceRectAtTime）",
    "if (hasPseudoBox) {",
    "  var r = sourceRectAtTime(time, false);",
    "  if (rm === 0 || rm === 1) {",
    "    // CENTER(0) / RADIUS(1)：Position 仍然是盒子左上(x,y)，用锚点偏移模拟“盒子内居中”",
    "    var w = (wh && wh.length > 0 && typeof wh[0] === 'number') ? wh[0] : 0;",
    "    var h = (wh && wh.length > 1 && typeof wh[1] === 'number') ? wh[1] : 0;",
    "    // 让“内容中心”落在 (x + w/2, y + h/2) 上，而 Position 固定在 (x, y)",
    "    [r.left + r.width/2 - w/2, r.top + r.height/2 - h/2]",
    "  } else {",
    "    // CORNER(2) / CORNERS(3) 等：锚点对齐到内容左上，这样 Position=x,y 就是视觉左上",
    "    [r.left, r.top]",
    "  }",
    "} else {",
    "  // 不带 wh: 纯点文本，保持 AE 默认锚点（通常为首字符左下角）",
    "  value",
    "}",
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
 * - 需要在 getShapeLib 之前或之后执行均可，但要求 _shapeTypeCode 已定义，
 *   以便 _text 使用 _shapeTypeCode.text 生成稳定 id。
 *
 * @param {Object} deps - 依赖对象：
 *   - deps.text: 是否使用了 text() 形状
 *   - deps.textSize: 是否使用了 textSize 函数
 *   - deps.textLeading: 是否使用了 textLeading 函数
 */
function getTypographyLib(deps) {
  if (!deps) deps = {};
  var parts = [];

  // 只要用到 text() 或 textSize 或 textLeading，就注入文本状态
  if (
    deps.text ||
    deps.textSize ||
    deps.textLeading ||
    deps.textWrap ||
    deps.textFont ||
    deps.textStyle ||
    deps.textAlign ||
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
 * 根据 text 语义对象创建 AE 文本图层，并绑定内容/位置/样式表达式。
 *
 * 说明：
 * - 封装 AE 相关逻辑，供 shape.js 的 createShapeLayers 通过统一入口调用
 * - 内部复用 shape.js 中的 _getIdFindExpr / _getPositionExpr 和本文件的 attachTextStyleExpressions
 *
 * @param {number} index - 文本在 shapeQueue 中的索引
 * @param {number} shapeId - 与 runtime 对齐的 shape.id
 * @param {string} mainCompName - 主合成名称，可选
 * @param {Object} shapeData - 前端已经判定好的 text 语义对象（点文本为主）
 */
function createTextLayerFromContext(index, shapeId, mainCompName, shapeData) {
  if (typeof engineComp === "undefined" || !engineComp || !engineComp.layers) {
    return null;
  }

  // 仅保留点文本逻辑：统一创建 Point Text 图层
  var layer = engineComp.layers.addText("");

  layer.name = "Text_" + index;

  // 为新建文字图层设置「填充和描边」模式为「全部填充在全部描边之上」
  // 对应 Character 面板中的下拉选项，等价于所有填充统一叠在所有描边之上
  // 说明：
  // - 这是 Text 组下的枚举属性，可能在 More Options 下，也可能直接在 Text 下
  // - 不同 AE 版本/语言下 UI 文本不同，但内部 matchName 和枚举值是固定的
  // - 枚举值：0=每字符调板, 1=全部填充在全部描边之上, 2=全部描边在全部填充之上
  // - 如果当前 AE 版本不存在该属性，则静默忽略
  try {
    var textGroup = layer.property("Text");
    if (textGroup) {
      var fillStrokeProp = null;

      // 尝试路径1：直接在 Text 下查找
      fillStrokeProp =
        textGroup.property("Fill & Stroke") ||
        textGroup.property("Fill and Stroke") ||
        textGroup.property("填充和描边") ||
        textGroup.property("ADBE Text Fill and Stroke");

      // 尝试路径2：在 More Options 下查找
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

      // 设置枚举值：2 = 全部填充在全部描边之上
      if (fillStrokeProp && fillStrokeProp.setValue) {
        fillStrokeProp.setValue(2);
      }
    }
  } catch (e) {
    // 兼容老版本或精简版 AE：如果属性不存在，安全失败，不中断后续逻辑
  }

  var textProp = layer.property("Source Text");
  var transform = layer.property("Transform");

  // 规范化段落默认值，避免继承用户上一次手动输入的段落缩进 / 间距设置
  // 例如：首行缩进 50 像素会导致通过表达式创建的文本也默认带 50 像素缩进。
  try {
    if (textProp && textProp.value !== undefined) {
      var baseDoc = textProp.value;
      // TextDocument 在 ExtendScript 里是一个普通对象，这里用鸭子类型判断并安全写入
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
    // 某些精简版 / 特殊环境可能不支持这些属性，安全失败即可
  }

  var indexFind = _getIdFindExpr(shapeId, mainCompName);

  // Baseline Shift 表达式：
  // - 从 engine JSON 的 _ctx.fontMetrics 中读取 baselineOffsetRatio
  // - 根据字体名称和字号查找对应的 metrics（key: "fontFamily_fontSize"）
  // - 如果找不到对应的 metrics，baselineOffsetRatio 为 0（不偏移）
  // - 与 textSize 组合：baselineShift ≈ baselineOffsetRatio * textSize
  // - 这样在不同字号下 baseline 相对位置保持稳定，同时在缩放图层时整体一起缩放
  // - 当字体切换时，表达式会动态从 JSON 中读取新的 metrics
  // 点文本模式：
  // - 直接使用 shape.size 作为字号
  // - 支持 leading 设置（从 shape.leading 读取）
  // - 可选读取 shape.wh 做表达式侧换行/裁剪
  textProp.expression = [
    indexFind,
    "var t = shape && shape.text;",
    "var s = shape && shape.size || 12;",
    'var _t = (t === undefined ? "" : String(t));',
    "var wrap = shape && shape.wrap ? String(shape.wrap) : 'WORD';",
    "var leading = shape && shape.leading !== undefined && shape.leading !== null ? shape.leading : null;",
    "var fontFamily = shape && shape.fontFamily ? String(shape.fontFamily) : 'Arial';",
    "var fontName = shape && shape.fontName ? String(shape.fontName) : fontFamily;",
    "var fontStyle = shape && shape.fontStyle ? String(shape.fontStyle) : 'NORMAL';",
    "var fauxBold = !!(shape && shape.fauxBold);",
    "var fauxItalic = !!(shape && shape.fauxItalic);",
    "// wh: [w, h] 由 engine 侧（_text / text(str,x,y,w,h)）传入，用于点文本换行/裁剪",
    "var wh = (shape && shape.wh) ? shape.wh : null;",
    "var maxW = (wh && wh.length > 0) ? wh[0] : null;",
    "var maxH = (wh && wh.length > 1) ? wh[1] : null;",
    "",
    "function _normNewlines(str) {",
    '  var r = (str === undefined || str === null) ? "" : String(str);',
    "  // AE 以 \\r 作为换行符，这里统一把 \\n / \\r\\n 都归一为 \\r",
    '  r = r.split("\\r\\n").join("\\n");',
    '  r = r.split("\\r").join("\\n");',
    '  r = r.split("\\n").join("\\r");',
    "  return r;",
    "}",
    "",
    "function _charFactor(ch) {",
    '  if (ch === " ") return 0.33;',
    "  var code = ch.charCodeAt(0);",
    "  // ASCII 字符大致按 0.55em 估算，非 ASCII（含 CJK）按 1em 估算",
    "  if (code <= 0x007f) return 0.55;",
    "  return 1.0;",
    "}",
    "",
    "// 将一行拆成 token（与 p5.js textWrap 对齐）：",
    "// - wrap='WORD'：西文按空格分词（保留空格 token）；非 ASCII（含 CJK）按字符作为 token",
    "// - wrap='CHAR'：所有字符逐字符作为 token（含空格）",
    "function _tokenize(line) {",
    "  var tokens = [];",
    "  if (wrap === 'CHAR') {",
    "    for (var ci = 0; ci < line.length; ci++) {",
    "      tokens.push(line.charAt(ci));",
    "    }",
    "    return tokens;",
    "  }",
    "  // 默认：WORD",
    '  var buf = "";',
    "  for (var i = 0; i < line.length; i++) {",
    "    var ch = line.charAt(i);",
    "    var code = ch.charCodeAt(0);",
    "    if (code <= 0x007f) {",
    "      // ASCII 区：按空格区分单词",
    '      if (ch === " ") {',
    "        if (buf.length > 0) {",
    "          tokens.push(buf);",
    '          buf = "";',
    "        }",
    "        tokens.push(ch);",
    "      } else {",
    "        buf += ch;",
    "      }",
    "    } else {",
    "      // 非 ASCII：先冲掉缓冲的西文单词，再按字符推入（按字截断）",
    "      if (buf.length > 0) {",
    "        tokens.push(buf);",
    '        buf = "";',
    "      }",
    "      tokens.push(ch);",
    "    }",
    "  }",
    "  if (buf.length > 0) {",
    "    tokens.push(buf);",
    "  }",
    "  return tokens;",
    "}",
    "",
    "function _measureToken(token) {",
    "  var w = 0;",
    "  for (var i = 0; i < token.length; i++) {",
    "    w += _charFactor(token.charAt(i)) * s;",
    "  }",
    "  return w;",
    "}",
    "",
    "function _wrapLine(line, wpx) {",
    "  var tokens = _tokenize(line);",
    "  // 一行一个 word 是底线：当宽度 <= 0（例如 scale 缩到 0）时，强制每个 word 单独成行",
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
    "    var tw = _measureToken(tk);",
    "    // 如果当前行非空且再加上该 token 会溢出，则先换行",
    "    if (cur.length > 0 && (curW + tw) > wpx) {",
    "      // 去掉行首空格",
    '      var trimmed = cur.replace(/^ +/, "");',
    "      if (trimmed.length > 0) out.push(trimmed);",
    '      cur = "";',
    "      curW = 0;",
    "    }",
    "    // 如果单个 token 自身宽度已经超过 wpx：",
    "    // - 不再退化为按字符截断（避免缩放过小导致“一行一个字”）",
    "    // - 直接让该 token 独占一行（允许溢出），这就是“一行一个 word”的下限",
    "    if (tw > wpx) {",
    "      if (cur.length > 0) {",
    '        var trimmed2 = cur.replace(/^ +/, "");',
    "        if (trimmed2.length > 0) out.push(trimmed2);",
    '        cur = "";',
    "        curW = 0;",
    "      }",
    '      if (tk !== " ") {',
    '        var tkTrim = tk.replace(/^ +/, "");',
    "        if (tkTrim.length > 0) {",
    "          out.push(tkTrim);",
    "        }",
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
    "function _wrapText(str, wpx) {",
    "  var normalized = _normNewlines(str);",
    '  var paras = normalized.split("\\r");',
    "  var lines = [];",
    "  for (var p = 0; p < paras.length; p++) {",
    "    // 显式保留用户输入的空行（例如连续换行）",
    '    if (paras[p] === "") {',
    '      lines.push("");',
    "      continue;",
    "    }",
    "    var wrapped = _wrapLine(paras[p], wpx);",
    "    for (var j = 0; j < wrapped.length; j++) {",
    "      lines.push(wrapped[j]);",
    "    }",
    "  }",
    "  return lines;",
    "}",
    "",
    'var _lines = _wrapText(_t, (typeof maxW === "number" && maxW === maxW) ? maxW : null);',
    "",
    "// 高度为 0 或负数：不显示任何字符（而不是“无限高/全显示”）",
    'if (typeof maxH === "number" && maxH === maxH && maxH <= 0) {',
    "  _lines = [];",
    "}",
    "",
    "// 按高度裁剪行数：maxLines = floor(h / leadingPx)",
    'if (typeof maxH === "number" && maxH === maxH && maxH > 0) {',
    "  var ldg = (leading !== null && leading !== undefined && leading === leading && leading > 0) ? leading : (s * 1.2);",
    "  var maxLines = Math.floor(maxH / ldg);",
    "  // 允许裁剪到 0 行：当 0 < h < leading 时应不显示任何字符",
    "  if (maxLines <= 0) {",
    "    _lines = [];",
    "  } else if (_lines.length > maxLines) {",
    "    _lines = _lines.slice(0, maxLines);",
    "  }",
    "}",
    "",
    'var finalText = _lines.join("\\r");',
    "var textStyle = style.setText(finalText)",
    "  .setFontSize(s)",
    "  .setFont(fontName)",
    "  .setVerticalScaling(100)",
    "  .setHorizontalScaling(100)",
    "  .setBaselineShift(0)",
    "  .setAutoLeading(false);",
    "// textStyle(style) 仅控制 fauxBold / fauxItalic，不尝试推导具体字体变体，保证跨机稳定",
    "try {",
    "  textStyle = textStyle.setFauxBold(fauxBold);",
    "} catch (e) {}",
    "try {",
    "  textStyle = textStyle.setFauxItalic(fauxItalic);",
    "} catch (e) {}",
    "if (leading !== null) {",
    "  textStyle = textStyle.setLeading(leading);",
    "}",
    "// 水平对齐：使用 TextStyle.setJustification()",
    "var hAlign = shape && shape.alignment && shape.alignment.h ? shape.alignment.h : 'LEFT';",
    "try {",
    "  if (hAlign === 'CENTER') {",
    "    textStyle = textStyle.setJustification('alignCenter');",
    "  } else if (hAlign === 'RIGHT') {",
    "    textStyle = textStyle.setJustification('alignRight');",
    "  } else {",
    "    textStyle = textStyle.setJustification('alignLeft');",
    "  }",
    "} catch (e) {}",
    "textStyle;",
  ].join("\n");

  // 位置
  // 说明：
  // - 统一为点文本图层
  // - Position 始终由 _getTextPositionExpr 控制（内部仍兼容 rectMode / originalPos 字段）
  // - Anchor Point 使用 _getAnchorPointExpr：
  //   - 对于带 wh 的伪 box：锚点对齐到文本内容左上角，使 x,y 可作为左上角坐标使用
  //   - 对于普通点文本：保持 AE 默认锚点（首字符左下角）
  transform.property("Position").expression = _getTextPositionExpr(indexFind);

  // 锚点：统一挂在点文本上，由表达式内部根据是否带 wh 决定是否对齐到文本左上角
  transform.property("Anchor Point").expression =
    _getAnchorPointExpr(indexFind);

  // 样式（填充/描边）
  attachTextStyleExpressions(layer, shapeId, mainCompName);

  return layer;
}

/**
 * text 数据结构（语义化 JSON）:
 * {
 *   id,
 *   type: "text",
 *   pos,                // [x, y] 根据 rectMode 计算后的位置（用于 CORNER 模式）
 *   originalPos,        // [x, y] 原始位置（用于 CENTER 模式）
 *   text,               // 文本内容
 *   size,               // 文本字号
 *   wh,                 // 伪文本框尺寸 [width, height]（用于表达式侧换行/裁剪）
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
function createTextFromContext(index, shapeId, mainCompName, shapeData) {
  if (typeof createTextLayerFromContext === "function") {
    return createTextLayerFromContext(index, shapeId, mainCompName, shapeData);
  }
}

/**
 * 为已有文本图层添加样式属性并绑定表达式：
 * - 填充颜色 / 透明度
 * - 描边颜色 / 透明度 / 宽度
 *
 * 说明：
 * - 复用 shape.js 中的 _getIdFindExpr / _getFillColorExpr / _getFillOpacityExpr /
 *   _getStrokeColorExpr / _getStrokeOpacityExpr / _getStrokeWidthExpr
 * - 这里只负责 AE 侧：创建 / 获取 Text 属性并挂表达式
 *
 * @param {TextLayer} layer - AE 文本图层
 * @param {number} shapeId - 与 runtime 对齐的 shape.id
 * @param {string} mainCompName - 主合成名称，可选
 */
function attachTextStyleExpressions(layer, shapeId, mainCompName) {
  if (!layer || !layer.property) {
    return;
  }

  // Text 组
  var textGroup = layer.property("Text");
  if (!textGroup) {
    return;
  }

  // 通过“动画制作工具（Text Animator）”创建颜色 / 描边入口，
  // 再在这些入口属性上挂表达式，避免直接依赖某些不可加表达式的 UI 入口。

  var indexFind = _getIdFindExpr(shapeId, mainCompName);

  // Animators 组
  var animatorsGroup = textGroup.property("ADBE Text Animators");
  if (!animatorsGroup) {
    return;
  }

  // 创建一个专用的 Animator 作为颜色 / 描边入口
  var animator = animatorsGroup.addProperty("ADBE Text Animator");
  if (!animator) {
    return;
  }
  try {
    animator.name = "Momentum_ColorStroke";
  } catch (e) {
    // 部分版本可能不允许改名，忽略即可
  }

  // 让该 Animator 作用于整段文本
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

  // 填充相关入口（Animator 内部的 Fill Color / Opacity），让 text() 跟随当前 fill() 状态
  var animFillColor = animatorProps.addProperty("ADBE Text Fill Color");
  if (animFillColor) {
    animFillColor.expression = _getFillColorExpr(indexFind);
  }
  var animFillOpacity = animatorProps.addProperty("ADBE Text Fill Opacity");
  if (animFillOpacity) {
    animFillOpacity.expression = _getFillOpacityExpr(indexFind);
  }

  // 描边相关入口（Animator 内部的 Stroke Color / Opacity / Width）
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
    // 第二个参数 scale=1：保持与 p5 strokeWeight 对齐
    animStrokeWidth.expression = _getStrokeWidthExpr(indexFind, 1);
  }
}
