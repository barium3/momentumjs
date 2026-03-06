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

  // Opacity
  imgLayer.property("Transform").property("Opacity").expression = [
    indexFind,
    "var o = shape && shape.fillOpacity;",
    "o !== undefined ? o : 100",
  ].join("\n");
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
