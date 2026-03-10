// ----------------------------------------
// Image helpers
// ----------------------------------------
// 负责两件事：
// 1. 生成 engine 侧的 image/loadImage/imageMode/tint 运行时
// 2. 在 AE 侧导入图片素材并创建对应图层

/**
 * 生成 image 表达式库。
 */
function getImageLib(deps) {
  if (!deps || !deps.image) return "";

  return [
    "// Image runtime",
    "var _momentumImageMetadata = _imd || {};",
    "function _sanitizeImageSampleKey(path) {",
    "  return String(path || '').replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\\d)/, '_$1');",
    "}",
    "function _getImageSampleLayer(path) {",
    "  var compName = thisComp.name + '_footage';",
    "  var layerName = '__imgsrc__' + _sanitizeImageSampleKey(path);",
    "  try { return comp(compName).layer(layerName); } catch (e) { return null; }",
    "}",
    "function _sampleImagePixel(path, x, y) {",
    "  var layer = _getImageSampleLayer(path);",
    "  if (!layer) return [0, 0, 0, 0];",
    "  var sx = Math.floor(x !== undefined ? x : 0) + 0.5;",
    "  var sy = Math.floor(y !== undefined ? y : 0) + 0.5;",
    "  var c = layer.sampleImage([sx, sy], [0.5, 0.5], true, time);",
    "  return [c[0], c[1], c[2], c[3]];",
    "}",
    "function _imageSizeValue(value, fallback) {",
    "  return value !== undefined ? value : fallback;",
    "}",
    "function _makeImageGet(img) {",
    "  return function (x, y, w, h) {",
    "    if (arguments.length >= 4) {",
    "      return _createImageObject(",
    "        img._momentumPath,",
    "        Math.max(0, Math.floor(w !== undefined ? w : 0)),",
    "        Math.max(0, Math.floor(h !== undefined ? h : 0)),",
    "        img._momentumSourceWidth,",
    "        img._momentumSourceHeight",
    "      );",
    "    }",
    "    var currentW = img.width || 0;",
    "    var currentH = img.height || 0;",
    "    var sourceW = _imageSizeValue(img._momentumSourceWidth, currentW);",
    "    var sourceH = _imageSizeValue(img._momentumSourceHeight, currentH);",
    "    if (currentW <= 0 || currentH <= 0 || sourceW <= 0 || sourceH <= 0) return [0, 0, 0, 0];",
    "    var sampleX = (Number(x) || 0) * sourceW / currentW;",
    "    var sampleY = (Number(y) || 0) * sourceH / currentH;",
    "    return _sampleImagePixel(img._momentumPath, sampleX, sampleY);",
    "  };",
    "}",
    "function _makeImageResize(img) {",
    "  return function (w, h) {",
    "    var currentW = img.width || 0;",
    "    var currentH = img.height || 0;",
    "    var nextW = (w !== undefined && w !== null) ? Math.round(Number(w)) : null;",
    "    var nextH = (h !== undefined && h !== null) ? Math.round(Number(h)) : null;",
    "    var hasW = nextW !== null && !isNaN(nextW);",
    "    var hasH = nextH !== null && !isNaN(nextH);",
    "    if (!hasW && !hasH) return;",
    "    if (hasW && nextW < 0) nextW = 0;",
    "    if (hasH && nextH < 0) nextH = 0;",
    "    if (hasW && hasH) {",
    "      if (nextW === 0 && nextH === 0) return;",
    "      if (nextW === 0) {",
    "        if (currentW <= 0 || currentH <= 0) return;",
    "        nextW = Math.round(currentW * nextH / currentH);",
    "      } else if (nextH === 0) {",
    "        if (currentW <= 0 || currentH <= 0) return;",
    "        nextH = Math.round(currentH * nextW / currentW);",
    "      }",
    "    } else if (hasW) {",
    "      if (currentW <= 0 || currentH <= 0) return;",
    "      nextH = Math.round(currentH * nextW / currentW);",
    "    } else {",
    "      if (currentW <= 0 || currentH <= 0) return;",
    "      nextW = Math.round(currentW * nextH / currentH);",
    "    }",
    "    img.width = Math.max(0, nextW);",
    "    img.height = Math.max(0, nextH);",
    "  };",
    "}",
    "function _createImageObject(path, width, height, sourceWidth, sourceHeight) {",
    "  var img = {",
    "    width: width,",
    "    height: height,",
    "    _momentumPath: path,",
    "    _momentumSourceWidth: _imageSizeValue(sourceWidth, width),",
    "    _momentumSourceHeight: _imageSizeValue(sourceHeight, height)",
    "  };",
    "  img.get = _makeImageGet(img);",
    "  img.resize = _makeImageResize(img);",
    "  return img;",
    "}",
    "function loadImage(path) {",
    "  var key = String(path || '');",
    "  var meta = _momentumImageMetadata[key] || _momentumImageMetadata[String(key).replace(/\\\\/g, '/')] || null;",
    "  var width = meta && meta.width !== undefined ? meta.width : 0;",
    "  var height = meta && meta.height !== undefined ? meta.height : 0;",
    "  return _createImageObject(key, width, height, width, height);",
    "}",
    "function _resolveImagePlacement(x, y, w, h, iw, ih, mode) {",
    "  var drawW, drawH, cx, cy;",
    "  if (mode === CORNERS) {",
    "    var x2 = (w !== undefined && w !== null) ? w : x + iw;",
    "    var y2 = (h !== undefined && h !== null) ? h : y + ih;",
    "    drawW = x2 - x;",
    "    drawH = y2 - y;",
    "    cx = x + drawW / 2;",
    "    cy = y + drawH / 2;",
    "  } else {",
    "    drawW = (w !== undefined && w !== null) ? w : iw;",
    "    drawH = (h !== undefined && h !== null) ? h : ih;",
    "    if (mode === CENTER) {",
    "      cx = x;",
    "      cy = y;",
    "    } else {",
    "      cx = x + drawW / 2;",
    "      cy = y + drawH / 2;",
    "    }",
    "  }",
    "  return { cx: cx, cy: cy, drawW: drawW, drawH: drawH };",
    "}",
    "function _recordImage(callsiteId, path, cx, cy, drawW, drawH, iw, ih) {",
    "  if (!_render) return;",
    "  var ref = _nextShapeRef('image', callsiteId);",
    "  var slotKey = ref.slotKey;",
    "  var finalW = (drawW !== undefined && drawW !== null) ? drawW : iw;",
    "  var finalH = (drawH !== undefined && drawH !== null) ? drawH : ih;",
    "  _shapes.push({",
    "    slotKey: slotKey,",
    "    type: 'image',",
    "    pos: _applyTransform(cx, cy),",
    "    size: [finalW * _scaleX, finalH * _scaleY],",
    "    drawW: finalW,",
    "    drawH: finalH,",
    "    natW: iw,",
    "    natH: ih,",
    "    sx: _scaleX,",
    "    sy: _scaleY,",
    "    rot: _rotation * (180 / Math.PI),",
    "    src: path,",
    "    imageMode: _imageMode,",
    "    fillOpacity: _fillColor ? _fillColor[3] * 100 : 100,",
    "    tintColor: _tintColor",
    "  });",
    "}",
    "var _imageMode = CORNER;",
    "function imageMode(mode) { _imageMode = mode; }",
    "var _tintColor = null;",
    "function tint() { _tintColor = color.apply(null, arguments); }",
    "function noTint() { _tintColor = null; }",
    "function _image() {",
    "  var __shapeArgs = _consumeShapeArgs(arguments);",
    "  var __vals = __shapeArgs.values;",
    "  var callsiteId = __shapeArgs.callsiteId;",
    "  var img = __vals[0];",
    "  var x = __vals[1];",
    "  var y = __vals[2];",
    "  var w = __vals[3];",
    "  var h = __vals[4];",
    "  if (!img) return;",
    "  var iw = img.width || 0;",
    "  var ih = img.height || 0;",
    "  var sourceW = _imageSizeValue(img._momentumSourceWidth, iw);",
    "  var sourceH = _imageSizeValue(img._momentumSourceHeight, ih);",
    "  var placement = _resolveImagePlacement(x, y, w, h, iw, ih, _imageMode);",
    "  _recordImage(callsiteId, img._momentumPath || '', placement.cx, placement.cy, placement.drawW, placement.drawH, sourceW, sourceH);",
    "}",
    "function image(img, x, y, w, h) { return _image(img, x, y, w, h); }"
  ].join("\n");
}

function _sanitizeFootageSampleLayerName(prefix, path) {
  return (
    String(prefix || "__ftg__") +
    String(path || "")
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/^(\d)/, "_$1")
  );
}

function _getFootageSampleCompName(targetComp) {
  var baseName =
    targetComp && targetComp.name ? targetComp.name : "Composition";
  return baseName + "_footage";
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
    frameRate
  );
  if (compFolder) {
    sampleComp.parentFolder = compFolder;
  }
  setCompBackgroundColor(sampleComp, false);
  return sampleComp;
}

function ensureFootageSampleLayer(
  relativePath,
  fullPath,
  compFolder,
  targetComp,
  layerPrefix,
  configureTransform
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
      true
    );
  }
}

/**
 * 为 image shape 创建 AE 图层并绑定表达式。
 */
function createImageFromContext(
  index,
  slotKey,
  mainCompName,
  shapeData,
  compFolder
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

  var indexFind = _getSlotFindExpr(slotKey, mainCompName);

  imgLayer.property("Transform").property("Anchor Point").expression = [
    "[" + fw + " / 2, " + fh + " / 2]"
  ].join("\n");

  imgLayer.property("Transform").property("Position").expression = [
    indexFind,
    "var p = shape && shape.pos;",
    "p ? [p[0], p[1]] : [thisComp.width/2, thisComp.height/2];"
  ].join("\n");

  imgLayer.property("Transform").property("Scale").expression = [
    indexFind,
    "var fw = " + fw + ", fh = " + fh + ";",
    "if (!shape || fw === 0 || fh === 0) [100, 100]; else {",
    "  var drawW = shape.drawW !== undefined ? shape.drawW : (shape.natW || fw);",
    "  var drawH = shape.drawH !== undefined ? shape.drawH : (shape.natH || fh);",
    "  var natW = shape.natW || fw, natH = shape.natH || fh;",
    "  var sx = shape.sx !== undefined ? shape.sx : 1;",
    "  var sy = shape.sy !== undefined ? shape.sy : 1;",
    "  [drawW * sx / natW * 100, drawH * sy / natH * 100];",
    "}"
  ].join("\n");

  imgLayer.property("Transform").property("Rotation").expression = [
    indexFind,
    "var r = shape && shape.rot;",
    "r !== undefined ? r : 0;"
  ].join("\n");

  imgLayer.property("Transform").property("Opacity").expression = [
    indexFind,
    "var t = shape && shape.tintColor;",
    "var o = shape && shape.fillOpacity;",
    "var tintAlpha = t && t[3] !== undefined ? t[3] : 1;",
    "var fillAlpha = o !== undefined ? o / 100 : 1;",
    "tintAlpha * fillAlpha * 100;"
  ].join("\n");

  var tintEffect = imgLayer.Effects.addProperty("ADBE Tint");
  tintEffect.property(2).expression = [
    indexFind,
    "var t = shape && shape.tintColor;",
    "if (!t) [255, 255, 255, 255];",
    "else if (t.length === 1) [t[0] * 255, t[0] * 255, t[0] * 255, 255];",
    "else if (t.length === 2) [t[0] * 255, t[0] * 255, t[0] * 255, t[1] * 255];",
    "else [t[0] * 255, t[1] * 255, t[2] * 255, (t[3] !== undefined ? t[3] * 255 : 255)]"
  ].join("\n");
  tintEffect.property(3).setValue(100);
}

// 获取扩展内 user/ 目录。
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

// 优先按绝对路径复用已导入素材，避免重复导入。
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
