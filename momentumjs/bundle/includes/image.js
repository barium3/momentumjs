pub.loadImage = function (source) {
  var item = m.item(source);

  if (item instanceof FootageItem) {
    if (item.mainSource instanceof FileSource) {
      var fileExtension = item.file.name.split(".").pop().toLowerCase();
      var imageExtensions = [
        "jpg",
        "jpeg",
        "png",
        "gif",
        "tif",
        "tiff",
        "psd",
        "ai",
        "pdf",
        "bmp",
        "tga",
      ];

      if (imageExtensions.indexOf(fileExtension) !== -1) {
        return item;
      } else {
        error("m.loadImage(), 所选项目不是支持的图片格式");
      }
    } else if (item.mainSource instanceof SolidSource) {
      return item; // 纯色也可以被视为"图片"
    } else {
      error("m.loadImage(), 所选素材项目不是图片");
    }
  } else if (item instanceof CompItem) {
    return item; // 合成也可以被用作图层
  } else {
    error("m.loadImage(), 无效的源文件/项目项");
  }
};

pub.image = function (img, x, y, width, height) {
  var comp;

  // 检查参数
  if (arguments.length < 3) {
    error("m.image(), 参数数量不正确！至少需要图片对象和位置 (x, y)");
  }

  // 检查img是否为有效的项目
  if (!(img instanceof FootageItem) && !(img instanceof CompItem)) {
    error("m.image(), 无效的图片对象");
  }

  // 获取或创建合成
  if (app.project.activeItem && app.project.activeItem instanceof CompItem) {
    comp = app.project.activeItem;
  } else {
    comp = m.composition(); // 使用默认设置创建新合成
  }

  // 创建图层
  var imageLayer = comp.layers.add(img);

  // 保存原始的 currPosition 和 currLayerScale
  var originalPosition = currPosition;
  var originalLayerScale = currLayerScale;

  // 计算新的 currPosition 和 currLayerScale
  currPosition = m.add(currPosition, [x, y]);
  if (width !== undefined && height !== undefined) {
    var newScale = calculateScale(imageLayer, width, height);
    currLayerScale = [
      m.mul(m.div(currLayerScale[0], 100), newScale[0]),
      m.mul(m.div(currLayerScale[1], 100), newScale[1]),
    ];
  }

  // 应用当前的图层属性
  m.setLayerProperties(imageLayer);

  // 恢复原始的 currPosition 和 currLayerScale
  currPosition = originalPosition;
  currLayerScale = originalLayerScale;

  return imageLayer;
};

function calculateScale(layer, targetWidth, targetHeight) {
  var originalWidth = layer.source.width;
  var originalHeight = layer.source.height;

  var scaleX = m.mul(m.div(targetWidth, originalWidth), 100);
  var scaleY = m.mul(m.div(targetHeight, originalHeight), 100);

  return [scaleX, scaleY];
}
