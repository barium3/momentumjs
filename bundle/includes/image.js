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
  lines.push(
    "var _momentumImageMetadata = (_ctx && _ctx.imageMetadata) ? _ctx.imageMetadata : {};",
  );
  lines.push("function _sanitizeImageSampleKey(path) {");
  lines.push(
    "  return String(path || '').replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\\d)/, '_$1');",
  );
  lines.push("}");
  lines.push("function _getImageSampleCompName() {");
  lines.push("  return thisComp.name + '_footage';");
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
  lines.push("function _makeImageResize(img) {");
  lines.push("  return function (w, h) {");
  lines.push("    var currentW = img.width || 0;");
  lines.push("    var currentH = img.height || 0;");
  lines.push(
    "    var nextW = (w !== undefined && w !== null) ? Math.round(Number(w)) : null;",
  );
  lines.push(
    "    var nextH = (h !== undefined && h !== null) ? Math.round(Number(h)) : null;",
  );
  lines.push("    var hasW = nextW !== null && !isNaN(nextW);");
  lines.push("    var hasH = nextH !== null && !isNaN(nextH);");
  lines.push("    if (!hasW && !hasH) return;");
  lines.push("    if (hasW && nextW < 0) nextW = 0;");
  lines.push("    if (hasH && nextH < 0) nextH = 0;");
  lines.push("    if (hasW && hasH) {");
  lines.push("      if (nextW === 0 && nextH === 0) return;");
  lines.push("      if (nextW === 0) {");
  lines.push("        if (currentW <= 0 || currentH <= 0) return;");
  lines.push("        nextW = Math.round(currentW * nextH / currentH);");
  lines.push("      } else if (nextH === 0) {");
  lines.push("        if (currentW <= 0 || currentH <= 0) return;");
  lines.push("        nextH = Math.round(currentH * nextW / currentW);");
  lines.push("      }");
  lines.push("    } else if (hasW) {");
  lines.push("      if (currentW <= 0 || currentH <= 0) return;");
  lines.push("      nextH = Math.round(currentH * nextW / currentW);");
  lines.push("    } else {");
  lines.push("      if (currentW <= 0 || currentH <= 0) return;");
  lines.push("      nextW = Math.round(currentW * nextH / currentH);");
  lines.push("    }");
  lines.push("    img.width = Math.max(0, nextW);");
  lines.push("    img.height = Math.max(0, nextH);");
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
  lines.push("  img.resize = _makeImageResize(img);");
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

  lines.push("function _resolveImagePlacement(x, y, w, h, iw, ih, mode) {");
  lines.push("  var drawW, drawH, cx, cy;");
  lines.push("  if (mode === CORNERS) {");
  lines.push("    var x2 = (w !== undefined && w !== null) ? w : x + iw;");
  lines.push("    var y2 = (h !== undefined && h !== null) ? h : y + ih;");
  lines.push("    drawW = x2 - x;");
  lines.push("    drawH = y2 - y;");
  lines.push("    cx = x + drawW / 2;");
  lines.push("    cy = y + drawH / 2;");
  lines.push("  } else {");
  lines.push("    drawW = (w !== undefined && w !== null) ? w : iw;");
  lines.push("    drawH = (h !== undefined && h !== null) ? h : ih;");
  lines.push("    if (mode === CENTER) {");
  lines.push("      cx = x;");
  lines.push("      cy = y;");
  lines.push("    } else {");
  lines.push("      cx = x + drawW / 2;");
  lines.push("      cy = y + drawH / 2;");
  lines.push("    }");
  lines.push("  }");
  lines.push("  return { cx: cx, cy: cy, drawW: drawW, drawH: drawH };");
  lines.push("}");
  lines.push("");

  lines.push("function _recordImage(path, cx, cy, drawW, drawH, iw, ih) {");
  lines.push("  if (!_render) { return; }");
  lines.push("  _imageCount++;");
  lines.push("  var m = _imageCount;");
  lines.push("  var id = _shapeTypeCode.image * 10000 + m;");
  lines.push(
    "  var finalW = (drawW !== undefined && drawW !== null) ? drawW : iw;",
  );
  lines.push(
    "  var finalH = (drawH !== undefined && drawH !== null) ? drawH : ih;",
  );
  lines.push("  var pos = _applyTransform(cx, cy);");
  lines.push("  var rot = _rotation * (180 / Math.PI);");
  lines.push("  _shapes.push({");
  lines.push("    id: id,");
  lines.push("    type: 'image',");
  lines.push("    pos: pos,");
  lines.push("    size: [finalW * _scaleX, finalH * _scaleY],");
  lines.push("    drawW: finalW,");
  lines.push("    drawH: finalH,");
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

  lines.push("var _imageMode = CORNER;");
  lines.push("function imageMode(mode) { _imageMode = mode; }");

  lines.push("var _tintColor = null;");
  lines.push("function tint() {");
  lines.push("  var c = color.apply(null, arguments);");
  lines.push("  _tintColor = c;");
  lines.push("}");
  lines.push("function noTint() { _tintColor = null; }");

  lines.push("function _image(img, x, y, w, h) {");
  lines.push("  if (!img) return;");
  lines.push("  var path = img._momentumPath || '';");
  lines.push("  var iw = img.width || 0;");
  lines.push("  var ih = img.height || 0;");
  lines.push(
    "  var sourceW = img._momentumSourceWidth !== undefined ? img._momentumSourceWidth : iw;",
  );
  lines.push(
    "  var sourceH = img._momentumSourceHeight !== undefined ? img._momentumSourceHeight : ih;",
  );
  lines.push(
    "  var placement = _resolveImagePlacement(x, y, w, h, iw, ih, _imageMode);",
  );
  lines.push(
    "  _recordImage(path, placement.cx, placement.cy, placement.drawW, placement.drawH, sourceW, sourceH);",
  );
  lines.push("}");
  lines.push("");
  lines.push("function image(img, x, y, w, h) {");
  lines.push("  return _image(img, x, y, w, h);");
  lines.push("}");

  return lines.join("\n");
}

function _sanitizeFootageSampleLayerName(prefix, path) {
  return (
    String(prefix || "__ftg__") +
    String(path || "")
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/^(\d)/, "_$1")
  );
}

function _sanitizeImageSampleLayerName(path) {
  return _sanitizeFootageSampleLayerName("__imgsrc__", path);
}

function _getFootageSampleCompName(targetComp) {
  var baseName =
    targetComp && targetComp.name ? targetComp.name : "Composition";
  return baseName + "_footage";
}

function _getImageSampleCompName(targetComp) {
  return _getFootageSampleCompName(targetComp);
}

function _getOrCreateFootageSampleComp(compFolder, targetComp) {
  var compName = _getFootageSampleCompName(targetComp);
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

function _getOrCreateImageSampleComp(compFolder, targetComp) {
  return _getOrCreateFootageSampleComp(compFolder, targetComp);
}

function ensureFootageSampleLayer(
  relativePath,
  fullPath,
  compFolder,
  targetComp,
  layerPrefix,
  configureTransform,
) {
  if (!relativePath || !fullPath) return null;

  var sampleComp = _getOrCreateFootageSampleComp(compFolder, targetComp);
  if (!sampleComp) return null;

  var layerName = _sanitizeFootageSampleLayerName(layerPrefix, relativePath);
  for (var i = 1; i <= sampleComp.numLayers; i++) {
    var candidate = sampleComp.layer(i);
    if (candidate && candidate.name === layerName) {
      return candidate;
    }
  }

  var file = new File(fullPath);
  if (!file.exists) return null;

  var footageItem = _getOrImportFootage(file, compFolder);
  if (!footageItem) return null;

  var sampleLayer = sampleComp.layers.add(footageItem);
  sampleLayer.name = layerName;
  sampleLayer.shy = true;
  if (configureTransform !== false) {
    try {
      sampleLayer
        .property("Transform")
        .property("Anchor Point")
        .setValue([0, 0]);
    } catch (e) {}
    try {
      sampleLayer.property("Transform").property("Position").setValue([0, 0]);
    } catch (e2) {}
    try {
      sampleLayer.property("Transform").property("Scale").setValue([100, 100]);
    } catch (e3) {}
    try {
      sampleLayer.property("Transform").property("Rotation").setValue(0);
    } catch (e4) {}
  }
  sampleLayer.moveToEnd();
  return sampleLayer;
}

function ensureImageSampleLayers(imageMetadata, compFolder, targetComp) {
  if (!imageMetadata) return;

  for (var relativePath in imageMetadata) {
    if (!imageMetadata.hasOwnProperty(relativePath)) continue;
    var info = imageMetadata[relativePath];
    if (!info || !info.path) continue;
    ensureFootageSampleLayer(
      relativePath,
      info.path,
      compFolder,
      targetComp,
      "__imgsrc__",
      true,
    );
  }
}

// ----------------------------------------
// AE 脚本端：图片图层创建
// ----------------------------------------

/**
 * 在当前 engineComp 中为 image shape 创建 footage 图层。
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

  var imgLayer = engineComp.layers.add(footageItem);
  imgLayer.name = "Image_" + index;

  var fw = footageItem.width;
  var fh = footageItem.height;

  var indexFind = _getIdFindExpr(shapeId, mainCompName);

  imgLayer.property("Transform").property("Anchor Point").expression = [
    "[" + fw + " / 2, " + fh + " / 2]",
  ].join("\n");

  imgLayer.property("Transform").property("Position").expression = [
    indexFind,
    "var p = shape && shape.pos;",
    "p ? [p[0], p[1]] : [thisComp.width/2, thisComp.height/2]",
  ].join("\n");

  imgLayer.property("Transform").property("Scale").expression = [
    indexFind,
    "var fw = " + fw + ", fh = " + fh + ";",
    "if (!shape || fw === 0 || fh === 0) { [100, 100]; } else {",
    "  var drawW = shape.drawW !== undefined ? shape.drawW : (shape.natW || fw);",
    "  var drawH = shape.drawH !== undefined ? shape.drawH : (shape.natH || fh);",
    "  var natW = shape.natW || fw, natH = shape.natH || fh;",
    "  var sx = shape.sx !== undefined ? shape.sx : 1;",
    "  var sy = shape.sy !== undefined ? shape.sy : 1;",
    "  [drawW * sx / natW * 100, drawH * sy / natH * 100];",
    "}",
  ].join("\n");

  imgLayer.property("Transform").property("Rotation").expression = [
    indexFind,
    "var r = shape && shape.rot;",
    "r !== undefined ? r : 0",
  ].join("\n");

  imgLayer.property("Transform").property("Opacity").expression = [
    indexFind,
    "var t = shape && shape.tintColor;",
    "var o = shape && shape.fillOpacity;",
    "var tintAlpha = t && t[3] !== undefined ? t[3] : 1;",
    "var fillAlpha = o !== undefined ? o / 100 : 1;",
    "tintAlpha * fillAlpha * 100",
  ].join("\n");

  var tintEffect = imgLayer.Effects.addProperty("ADBE Tint");
  tintEffect.property(2).expression = [
    indexFind,
    "var t = shape && shape.tintColor;",
    "if (!t) [255, 255, 255, 255];",
    "else if (t.length === 1) [t[0] * 255, t[0] * 255, t[0] * 255, 255];",
    "else if (t.length === 2) [t[0] * 255, t[0] * 255, t[0] * 255, t[1] * 255];",
    "else [t[0] * 255, t[1] * 255, t[2] * 255, (t[3] !== undefined ? t[3] * 255 : 255)]",
  ].join("\n");
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
  var targetPath = String(file.fsName || "").replace(/\\/g, "/");
  var nameMatch = null;
  for (var i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    if (!(item instanceof FootageItem) || item.name !== name) {
      continue;
    }

    try {
      var itemPath =
        item.file && item.file.fsName
          ? String(item.file.fsName).replace(/\\/g, "/")
          : null;
      if (itemPath && targetPath && itemPath === targetPath) {
        return item;
      }
    } catch (e) {}

    if (!nameMatch) {
      nameMatch = item;
    }
  }
  if (nameMatch) return nameMatch;
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
