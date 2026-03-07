// ----------------------------------------
// Image - 图像绘制库
// 包含：
//   1. getImageLib()        — AE 表达式端：生成 _image / imageMode / tint / image 函数代码
//   2. createImageFromContext() — AE 脚本端：导入 footage、创建图层、绑定表达式
//   3. _getUserDirectory()  — 获取 user/ 目录绝对路径
//   4. _getOrImportFootage() — 查找或导入 footage
// ----------------------------------------

/**
 * 获取图像函数库代码
 * @param {Object} deps - 依赖对象 { image: true }
 * @returns {string} 图像函数库代码
 */
function getImageLib(deps) {
  if (!deps || !deps.image) return "";

  var lines = [];
  lines.push("// Image 库");
  // 注意：_imageCount 计数器由 core.js 的 buildExpression 统一生成，此处不需要重复声明
  lines.push(
    "var _momentumImageMetadata = (_ctx && _ctx.imageMetadata) ? _ctx.imageMetadata : {};",
  );
  lines.push("function _sanitizeImageSampleKey(path) {");
  lines.push(
    "  return String(path || '').replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\\d)/, '_$1');",
  );
  lines.push("}");
  lines.push("function _getImageSampleCompName() {");
  lines.push("  return thisComp.name + '_image';");
  lines.push("}");
  lines.push("function _getImageSampleLayer(path) {");
  lines.push("  var compName = _getImageSampleCompName();");
  lines.push("  var layerName = '__imgsrc__' + _sanitizeImageSampleKey(path);");
  lines.push(
    "  try { return comp(compName).layer(layerName); } catch (e) { return null; }",
  );
  lines.push("}");
  lines.push("function _sampleImagePixel(path, x, y) {");
  lines.push("  var layer = _getImageSampleLayer(path);");
  lines.push("  if (!layer) return [0, 0, 0, 0];");
  lines.push("  var sx = Math.floor(x !== undefined ? x : 0) + 0.5;");
  lines.push("  var sy = Math.floor(y !== undefined ? y : 0) + 0.5;");
  lines.push("  var c = layer.sampleImage([sx, sy], [0.5, 0.5], true, time);");
  lines.push("  return [c[0], c[1], c[2], c[3]];");
  lines.push("}");
  lines.push("function _makeImageGet(img) {");
  lines.push("  return function (x, y, w, h) {");
  lines.push("    if (arguments.length >= 4) {");
  lines.push("      return _createImageObject(");
  lines.push("        img._momentumPath,");
  lines.push("        Math.max(0, Math.floor(w !== undefined ? w : 0)),");
  lines.push("        Math.max(0, Math.floor(h !== undefined ? h : 0)),");
  lines.push("        img._momentumSourceWidth,");
  lines.push("        img._momentumSourceHeight");
  lines.push("      );");
  lines.push("    }");
  lines.push("    var currentW = img.width || 0;");
  lines.push("    var currentH = img.height || 0;");
  lines.push(
    "    var sourceW = img._momentumSourceWidth !== undefined ? img._momentumSourceWidth : currentW;",
  );
  lines.push(
    "    var sourceH = img._momentumSourceHeight !== undefined ? img._momentumSourceHeight : currentH;",
  );
  lines.push(
    "    if (currentW <= 0 || currentH <= 0 || sourceW <= 0 || sourceH <= 0) return [0, 0, 0, 0];",
  );
  lines.push("    var sampleX = (Number(x) || 0) * sourceW / currentW;");
  lines.push("    var sampleY = (Number(y) || 0) * sourceH / currentH;");
  lines.push(
    "    return _sampleImagePixel(img._momentumPath, sampleX, sampleY);",
  );
  lines.push("  };");
  lines.push("}");
  lines.push(
    "function _createImageObject(path, width, height, sourceWidth, sourceHeight) {",
  );
  lines.push("  var img = {");
  lines.push("    width: width,");
  lines.push("    height: height,");
  lines.push("    _momentumPath: path,");
  lines.push(
    "    _momentumSourceWidth: sourceWidth !== undefined ? sourceWidth : width,",
  );
  lines.push(
    "    _momentumSourceHeight: sourceHeight !== undefined ? sourceHeight : height",
  );
  lines.push("  };");
  lines.push("  img.get = _makeImageGet(img);");
  lines.push("  return img;");
  lines.push("}");
  lines.push("function loadImage(path) {");
  lines.push("  var key = String(path || '');");
  lines.push(
    "  var meta = _momentumImageMetadata[key] || _momentumImageMetadata[String(key).replace(/\\\\/g, '/')] || null;",
  );
  lines.push(
    "  var width = meta && meta.width !== undefined ? meta.width : 0;",
  );
  lines.push(
    "  var height = meta && meta.height !== undefined ? meta.height : 0;",
  );
  lines.push("  return _createImageObject(key, width, height, width, height);");
  lines.push("}");

  // _image() 核心函数：将图片数据写入 _shapes
  // x, y   — 各模式下的原始参考点（CORNER/CORNERS=左上角，CENTER=中心），不做预转换。
  // w, h   — 已折算的绘制宽高（CORNERS 模式下已完成 x2-x1 / y2-y1）。
  // rawW/rawH — image() 传入的原始第三、四参数：
  //             CORNERS: rawW=x2, rawH=y2（右下角坐标）
  //             其他:    rawW=drawW, rawH=drawH（绘制宽高）
  //   Scale 表达式凭 rawW/rawH + rawX/rawY + imageMode 自行计算正确比例，
  //   避免依赖已合并 _scaleX/_scaleY 的 size 字段带来的不准确。
  lines.push("function _image(path, x, y, w, h, iw, ih, rawW, rawH) {");
  lines.push("  if (!_render) { return; }");
  lines.push("  _imageCount++;");
  lines.push("  var m = _imageCount;");
  lines.push("  var id = _shapeTypeCode.image * 10000 + m;");
  lines.push("  var drawW = (w !== undefined && w !== null) ? w : iw;");
  lines.push("  var drawH = (h !== undefined && h !== null) ? h : ih;");
  lines.push("  var pos = _applyTransform(x, y);");
  lines.push("  var rot = _rotation * (180 / Math.PI);");
  lines.push("  _shapes.push({");
  lines.push("    id: id,");
  lines.push("    type: 'image',");
  lines.push("    pos: pos,");
  lines.push("    size: [drawW * _scaleX, drawH * _scaleY],");
  lines.push("    rawX: x,");
  lines.push("    rawY: y,");
  lines.push("    rawW: (rawW !== undefined && rawW !== null) ? rawW : drawW,");
  lines.push("    rawH: (rawH !== undefined && rawH !== null) ? rawH : drawH,");
  lines.push("    natW: iw,");
  lines.push("    natH: ih,");
  lines.push("    sx: _scaleX,");
  lines.push("    sy: _scaleY,");
  lines.push("    rot: rot,");
  lines.push("    src: path,");
  lines.push("    imageMode: _imageMode,");
  lines.push("    fillOpacity: _fillColor ? _fillColor[3] * 100 : 100,");
  lines.push("    tintColor: _tintColor,");
  lines.push("  });");
  lines.push("}");

  // imageMode() 控制图像锚点模式（与 p5.js 完全对应）
  // CORNER(2, 默认): x,y 是左上角，w,h 是宽高
  // CORNERS(3):      x,y 是左上角，w,h 是右下角坐标
  // CENTER(0):       x,y 是中心点，w,h 是宽高
  lines.push("var _imageMode = CORNER;"); // 默认 CORNER=2
  lines.push("function imageMode(mode) { _imageMode = mode; }");

  // tint / noTint（记录着色，留给图层表达式使用）
  lines.push("var _tintColor = null;");
  lines.push("function tint() {");
  lines.push("  var c = color.apply(null, arguments);");
  lines.push("  _tintColor = c;");
  lines.push("}");
  lines.push("function noTint() { _tintColor = null; }");

  // 对外暴露的 image() 函数（与 p5.js 完全兼容）
  // image(img, x, y)           — CORNER/CENTER 模式，尺寸取图片原始大小
  // image(img, x, y, w, h)     — CORNER/CENTER 模式，指定宽高
  // image(img, x, y, x2, y2)   — CORNERS 模式，(x,y) 左上角，(x2,y2) 右下角
  //
  // 参考点直接传给 _image，不做 cx/cy 预转换：
  //   CORNER / CORNERS → 传左上角 (x, y)，AE 锚点设为 [0,0]
  //   CENTER           → 传中心点 (x, y)，AE 锚点设为 [fw/2, fh/2]
  lines.push("function image(img, x, y, w, h) {");
  lines.push("  if (!img) return;");
  lines.push("  var path = img._momentumPath || '';");
  lines.push("  var iw = img.width || 0;");
  lines.push("  var ih = img.height || 0;");
  lines.push("  var refX = x, refY = y, drawW, drawH;");
  lines.push("  if (_imageMode === CORNERS) {");
  // CORNERS: w/h 是右下角坐标 x2/y2，先算出绘制宽高给 _image，
  // 再把原始 x2/y2 作为 rawW/rawH 传入，Scale 表达式用 (x2-x1)/fw*100 计算比例。
  lines.push("    var x2 = (w !== undefined && w !== null) ? w : x + iw;");
  lines.push("    var y2 = (h !== undefined && h !== null) ? h : y + ih;");
  lines.push("    drawW = x2 - x;");
  lines.push("    drawH = y2 - y;");
  lines.push("    _image(path, refX, refY, drawW, drawH, iw, ih, x2, y2);");
  lines.push("  } else {");
  // CORNER（默认）和 CENTER：rawW/rawH 就是绘制宽高本身
  lines.push("    drawW = (w !== undefined && w !== null) ? w : iw;");
  lines.push("    drawH = (h !== undefined && h !== null) ? h : ih;");
  lines.push(
    "    _image(path, refX, refY, drawW, drawH, iw, ih, drawW, drawH);",
  );
  lines.push("  }");
  lines.push("}");

  return lines.join("\n");
}

function _sanitizeImageSampleLayerName(path) {
  return (
    "__imgsrc__" +
    String(path || "")
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/^(\d)/, "_$1")
  );
}

function _getImageSampleCompName(targetComp) {
  var baseName =
    targetComp && targetComp.name ? targetComp.name : "Composition";
  return baseName + "_image";
}

function _getOrCreateImageSampleComp(compFolder, targetComp) {
  var compName = _getImageSampleCompName(targetComp);
  for (var i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    if (item && item instanceof CompItem && item.name === compName) {
      return item;
    }
  }

  var width = targetComp && targetComp.width ? Number(targetComp.width) : 1;
  var height = targetComp && targetComp.height ? Number(targetComp.height) : 1;
  if (!(width > 0)) width = 1;
  if (!(height > 0)) height = 1;

  var duration =
    targetComp && targetComp.duration
      ? targetComp.duration
      : DEFAULT_COMP_DURATION;
  var frameRate =
    targetComp && targetComp.frameRate ? targetComp.frameRate : 30;

  var sampleComp = app.project.items.addComp(
    compName,
    width,
    height,
    1,
    duration,
    frameRate,
  );
  if (compFolder) {
    sampleComp.parentFolder = compFolder;
  }
  setCompBackgroundColor(sampleComp, false);
  return sampleComp;
}

function ensureImageSampleLayers(imageMetadata, compFolder, targetComp) {
  if (!imageMetadata) return;

  for (var relativePath in imageMetadata) {
    if (!imageMetadata.hasOwnProperty(relativePath)) continue;
    var info = imageMetadata[relativePath];
    if (!info || !info.path) continue;

    var sampleComp = _getOrCreateImageSampleComp(compFolder, targetComp);
    if (!sampleComp) continue;

    var layerName = _sanitizeImageSampleLayerName(relativePath);
    var existingLayer = null;
    for (var i = 1; i <= sampleComp.numLayers; i++) {
      var candidate = sampleComp.layer(i);
      if (candidate && candidate.name === layerName) {
        existingLayer = candidate;
        break;
      }
    }
    if (existingLayer) continue;

    var file = new File(info.path);
    if (!file.exists) continue;

    var footageItem = _getOrImportFootage(file, compFolder);
    if (!footageItem) continue;

    var sampleLayer = sampleComp.layers.add(footageItem);
    sampleLayer.name = layerName;
    sampleLayer.shy = true;
    sampleLayer.property("Transform").property("Anchor Point").setValue([0, 0]);
    sampleLayer.property("Transform").property("Position").setValue([0, 0]);
    sampleLayer.property("Transform").property("Scale").setValue([100, 100]);
    sampleLayer.property("Transform").property("Rotation").setValue(0);
    sampleLayer.moveToEnd();
  }
}

// ----------------------------------------
// AE 脚本端：图片图层创建
// ----------------------------------------

/**
 * 在当前 engineComp 中为 image shape 创建 footage 图层
 *
 * shapeData 格式（来自前端 renderLayers）：
 * {
 *   id,
 *   type: "image",
 *   src: "apple.png",      // 相对于 user/ 目录的路径
 *   width: 1200,           // 原始图片宽度（px）
 *   height: 630,           // 原始图片高度（px）
 *   drawW: 400,            // 绘制宽度
 *   drawH: 210,            // 绘制高度
 * }
 *
 * 实现方案：
 *   脚本负责导入 footage 并创建图层，
 *   表达式负责驱动 Position / Scale / Rotation / Opacity。
 */
function createImageFromContext(
  index,
  shapeId,
  mainCompName,
  shapeData,
  compFolder,
) {
  var src = shapeData && shapeData.src ? shapeData.src : null;
  if (!src) return;

  var userDir = _getUserDirectory();
  var filePath = userDir + "/" + src;
  var file = new File(filePath);
  if (!file.exists) return;

  var footageItem = _getOrImportFootage(file, compFolder);
  if (!footageItem) return;

  // 在当前合成中添加 footage 图层
  var imgLayer = engineComp.layers.add(footageItem);
  imgLayer.name = "Image_" + index;

  var fw = footageItem.width;
  var fh = footageItem.height;

  var indexFind = _getIdFindExpr(shapeId, mainCompName);

  // Anchor Point（表达式驱动，与 imageMode 保持一致）：
  //   CENTER  (0) → 锚点在图层中心 [fw/2, fh/2]（层坐标），Position = 中心
  //   CORNER  (2) → 锚点在左上角  [0, 0]（层坐标），Position = 左上角
  //   CORNERS (3) → 同 CORNER
  imgLayer.property("Transform").property("Anchor Point").expression = [
    indexFind,
    "var mode = shape && shape.imageMode !== undefined ? shape.imageMode : 2;",
    "(mode === 0) ? [" + fw + " / 2, " + fh + " / 2] : [0, 0]",
  ].join("\n");

  // Position：直接读取 shape.pos（各 imageMode 下的原始参考点，已经过 _applyTransform）
  //   CORNER/CORNERS → pos 是左上角在画布中的坐标
  //   CENTER         → pos 是中心点在画布中的坐标
  imgLayer.property("Transform").property("Position").expression = [
    indexFind,
    "var p = shape && shape.pos;",
    "var mode = shape && shape.imageMode !== undefined ? shape.imageMode : 2;",
    "p ? [p[0], p[1]] : (mode === 0 ? [thisComp.width/2, thisComp.height/2] : [0, 0])",
  ].join("\n");

  // Scale：在表达式内按 imageMode 从原始坐标直接计算绘制尺寸，再除以 footage 原始尺寸。
  //   CORNERS (3): rawW=x2, rawH=y2（右下角坐标） → drawW = x2 - rawX, drawH = y2 - rawY
  //   CORNER  (2) / CENTER (0): rawW/rawH 即绘制宽高 → drawW = rawW, drawH = rawH
  //   shape.sx / shape.sy 携带用户 scale() 变换系数，确保缩放正确。
  imgLayer.property("Transform").property("Scale").expression = [
    indexFind,
    "var fw = " + fw + ", fh = " + fh + ";",
    "if (!shape || fw === 0 || fh === 0) { [100, 100]; } else {",
    "  var mode = shape.imageMode !== undefined ? shape.imageMode : 2;",
    "  var rX = shape.rawX, rY = shape.rawY;",
    "  var rW = shape.rawW, rH = shape.rawH;",
    "  var natW = shape.natW || fw, natH = shape.natH || fh;",
    "  var sx = shape.sx !== undefined ? shape.sx : 1;",
    "  var sy = shape.sy !== undefined ? shape.sy : 1;",
    "  var drawW, drawH;",
    "  if (mode === 3) {",
    "    var x2 = (rW !== undefined && rW !== null) ? rW : (rX + natW);",
    "    var y2 = (rH !== undefined && rH !== null) ? rH : (rY + natH);",
    "    drawW = x2 - rX;",
    "    drawH = y2 - rY;",
    "  } else {",
    "    drawW = (rW !== undefined && rW !== null) ? rW : natW;",
    "    drawH = (rH !== undefined && rH !== null) ? rH : natH;",
    "  }",
    "  [drawW * sx / fw * 100, drawH * sy / fh * 100];",
    "}",
  ].join("\n");

  // Rotation
  imgLayer.property("Transform").property("Rotation").expression = [
    indexFind,
    "var r = shape && shape.rot;",
    "r !== undefined ? r : 0",
  ].join("\n");

  // Opacity - tintColor[3] 和 fillOpacity 相乘（与 p5.js 行为一致）
  imgLayer.property("Transform").property("Opacity").expression = [
    indexFind,
    "var t = shape && shape.tintColor;",
    "var o = shape && shape.fillOpacity;",
    "var tintAlpha = t && t[3] !== undefined ? t[3] : 1;",
    "var fillAlpha = o !== undefined ? o / 100 : 1;",
    "tintAlpha * fillAlpha * 100",
  ].join("\n");

  // Tint - 使用「色调」效果（ADBE Tint，界面里的"色调"）
  var tintEffect = imgLayer.Effects.addProperty("ADBE Tint");
  // 用索引 2 访问"映射白色到"（AE 效果属性通常索引从 1 开始）
  // tintColor 格式: [r, g, b, a]，值范围 0-1
  tintEffect.property(2).expression = [
    indexFind,
    "var t = shape && shape.tintColor;",
    "if (!t) [255, 255, 255, 255];",
    "else if (t.length === 1) [t[0] * 255, t[0] * 255, t[0] * 255, 255];",
    "else if (t.length === 2) [t[0] * 255, t[0] * 255, t[0] * 255, t[1] * 255];",
    "else [t[0] * 255, t[1] * 255, t[2] * 255, (t[3] !== undefined ? t[3] * 255 : 255)]",
  ].join("\n");
  // Amount: 着色强度，100% 确保颜色完全应用
  tintEffect.property(3).setValue(100);
}

/**
 * 获取 user/ 目录的绝对路径
 * 优先从脚本文件位置向上查找含 user/ 子目录的扩展根目录，
 * 找不到时回退到硬编码路径（macOS/Windows 均可用）。
 * @private
 */
function _getUserDirectory() {
  var scriptFile = new File($.fileName);
  var dir = scriptFile;
  for (var i = 0; i < 6; i++) {
    dir = dir.parent;
    if (!dir || !dir.exists) break;
    var userFolder = new Folder(dir.fsName + "/user");
    if (userFolder.exists) {
      return dir.fsName + "/user";
    }
  }
}

/**
 * 在项目中查找已导入的同名 footage，找不到则重新导入。
 * 避免重复导入同一文件造成项目冗余。
 * 新导入的 footage 直接放入 compFolder（如果提供）。
 * @param {File} file - ExtendScript File 对象
 * @param {FolderItem} compFolder - 合成文件夹（可选）
 * @returns {FootageItem|null}
 * @private
 */
function _getOrImportFootage(file, compFolder) {
  var name = file.name;
  for (var i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    if (item instanceof FootageItem && item.name === name) {
      return item;
    }
  }
  try {
    var footage = app.project.importFile(new ImportOptions(file));
    if (footage && compFolder) {
      footage.parentFolder = compFolder;
    }
    return footage;
  } catch (e) {
    return null;
  }
}
