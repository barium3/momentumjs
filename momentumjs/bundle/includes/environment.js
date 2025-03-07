pub.composition = function () {
  var name = "新合成";
  var width = 1920;
  var height = 1080;
  var pixelAspect = 1;
  var duration = 10;
  var frameRate = 30;

  switch (arguments.length) {
    case 6:
      frameRate = arguments[5];
    case 5:
      duration = arguments[4];
    case 4:
      pixelAspect = arguments[3];
    case 3:
      height = arguments[2];
      width = arguments[1];
      name = arguments[0];
      break;
    case 2:
      width = arguments[0];
      height = arguments[1];
      break;
    case 1:
      name = arguments[0];
      break;
    case 0:
      break;
    default:
      error("m.composition(): 参数数量不正确。最多支持6个参数。");
  }

  var comp = app.project.items.addComp(
    name,
    width,
    height,
    pixelAspect,
    duration,
    frameRate
  );

  comp.openInViewer();

  return comp;
};

pub.layer = function (type, content) {
  var comp;

  // 检查是否存在活动合成
  if (app.project.activeItem && app.project.activeItem instanceof CompItem) {
    comp = app.project.activeItem;
  } else {
    // 如果没有活动合成,创建一个新的默认合成
    comp = m.composition();
  }

  var newLayer;

  switch (type.toLowerCase()) {
    case "text":
      if (currBoxSize == null) {
        newLayer = comp.layers.addText(content || "新文本图层");
      } else {
        newLayer = comp.layers.addBoxText(currBoxSize);
      }

      break;
    case "shape":
      newLayer = comp.layers.addShape();
      newLayer.name = content || "新形状图层";
      break;
    default:
      error("m.layer(): 不支持的图层类型。请使用 'text' 或 'shape'。");
  }

  // 应用当前的叠加模式
  if (typeof currBlendMode !== "undefined") {
    newLayer.blendingMode = currBlendMode;
  }

  // 应用变换
  m.setLayerProperties(newLayer);

  // 返回创建的图层
  return newLayer;
};

// layerTransform的变量调整需要在创建layer之前
pub.setLayerProperties = function (layer) {
  var layerRotation = currLayerRotation;
  var layerScale = currLayerScale;
  var layerOpacity = currLayerOpacity;
  var layerAnchor = currLayerAnchor;
  var transform = layer.transform;
  var position =
    layer instanceof TextLayer
      ? m.add(textPosition, currPosition)
      : currPosition;

  // 检查是否需要使用3D变换
  var use3D =
    layerAnchor.length > 2 ||
    position.length > 2 ||
    layerScale.length > 2 ||
    layerRotation.length > 1;

  if (use3D) {
    layer.threeDLayer = true;

    m.handlePropertyValue(transform.anchorPoint, layerAnchor);
    m.handlePropertyValue(transform.position, position);
    m.handlePropertyValue(transform.scale, layerScale);

    if (layerRotation.length === 1) {
      m.handlePropertyValue(transform.zRotation, layerRotation);
    } else {
      m.handlePropertyValue(transform.xRotation, layerRotation[0]);
      m.handlePropertyValue(transform.yRotation, layerRotation[1]);
      m.handlePropertyValue(transform.zRotation, layerRotation[2]);
    }
  } else {
    // 2D变换
    m.handlePropertyValue(transform.anchorPoint, layerAnchor);
    m.handlePropertyValue(transform.position, position);
    m.handlePropertyValue(transform.scale, layerScale);
    m.handlePropertyValue(
      transform.rotation,
      layerRotation[0] || layerRotation
    );
  }

  // 设置不透明度
  m.handlePropertyValue(layer.opacity, layerOpacity);
};

pub.handlePropertyValue = function (property, value) {
  var controllable = currControllable;
  if (value instanceof Array) {
    if (isArrayOfStrings(value)) {
      var zeroValue = property.value;
      zeroValue = value.map(function () {
        return 0;
      });
      property.setValue(zeroValue);
      // 如果数组中所有元素都是字符串，则将其作为表达式处理,value设置为0
      var expression = controllable ? customProperty + "+" : "";
      expression += "[" + value.join(", ") + "]";
      property.expression = expression;
    } else {
      // 否则，将数组作为普通值设置
      property.setValue(value);
    }
  } else if (typeof value === "string") {
    var zeroValue = property.value;
    zeroValue = value.map(function () {
      return 0;
    });
    property.setValue(zeroValue);
    var expression = controllable ? customProperty + "+" : "";
    expression += value;
    property.expression = expression;
  } else {
    property.setValue(value);
  }
};

pub.controllable = function (value) {
  if (typeof value === "boolean") {
    currControllable = value;
  } else {
    error("m.controllable(): 参数必须是布尔值 (true 或 false)。");
  }
};

// 辅助函数：检查是否为字符串数组
function isArrayOfStrings(arr) {
  for (var i = 0; i < arr.length; i++) {
    if (typeof arr[i] == "string") {
      return true;
    }
  }
  return false;
}

pub.getAELanguage = function () {
  var language = app.isoLanguage;
  return language;
};

pub.checkCompAndLayer = function (layerName, layerTypes) {
  var comp;
  var layer;

  // 确保 layerTypes 是一个数组
  if (!Array.isArray(layerTypes)) {
    layerTypes = [layerTypes];
  }

  // 检查或创建合成
  if (app.project.numItems == 0) {
    comp = m.composition();
  } else {
    // 遍历所有项目，查找第一个合成
    for (var i = 1; i <= app.project.numItems; i++) {
      var item = app.project.item(i);
      if (item instanceof CompItem) {
        comp = item;
        break;
      }
    }
    // 如果没有找到合成，创建一个新的默认合成
    if (!comp) {
      comp = m.composition();
    }
  }

  if (comp) {
    comp.openInViewer();
  } else {
    error("无法创建或找到合适的合成");
  }

  // 检查或创建图层
  if (comp.numLayers == 0) {
    layer = createLayerByType(comp, layerName, layerTypes[0]);
  } else {
    // 检查最顶层的图层是否为所需类型之一
    var topLayer = comp.layer(1);
    var isMatch = false;
    for (var i = 0; i < layerTypes.length; i++) {
      if (isLayerTypeMatch(topLayer, layerTypes[i])) {
        isMatch = true;
        break;
      }
    }

    if (isMatch) {
      layer = topLayer;
    } else {
      layer = createLayerByType(comp, layerName, layerTypes[0]);
    }
  }

  return { comp: comp, layer: layer };
};

function createLayerByType(comp, layerName, layerType) {
  switch (layerType) {
    case "shape":
      return m.layer("shape", layerName);
    case "text":
      return m.layer("text", layerName);
    case "solid":
      return comp.layers.addSolid(
        [1, 1, 1],
        layerName,
        comp.width,
        comp.height,
        1
      );
    case "null":
      return comp.layers.addNull();
    default:
      error("不支持的图层类型：" + layerType);
  }
}

function isLayerTypeMatch(layer, layerType) {
  switch (layerType) {
    case "shape":
      return layer.matchName === "ADBE Vector Layer";
    case "text":
      return layer instanceof TextLayer;
    case "solid":
      return layer instanceof AVLayer && layer.source instanceof SolidSource;
    case "null":
      return layer.nullLayer;
    default:
      return false;
  }
}

pub.item = function (identifier) {
  // 如果identifier是数字，通过索引查找
  if (typeof identifier === "number") {
    if (identifier > 0 && identifier <= app.project.numItems) {
      return app.project.item(identifier);
    } else {
      error("m.item(), 无效的项目索引");
    }
  }

  // 如果identifier是字符串，可能是名称或文件路径
  if (typeof identifier === "string") {
    // 尝试通过名称查找
    for (var i = 1; i <= app.project.numItems; i++) {
      var item = app.project.item(i);
      if (item.name === identifier) {
        return item;
      }
    }

    // 如果通过名称没找到，尝试通过文件路径查找
    var file = new File(identifier);
    if (file.exists) {
      for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (
          item instanceof FootageItem &&
          item.file &&
          item.file.fsName === file.fsName
        ) {
          return item;
        }
      }

      // 如果文件存在但项目中没有，尝试导入
      try {
        return app.project.importFile(new ImportOptions(file));
      } catch (e) {
        error("m.item(), 无法导入文件: " + e.message);
      }
    }
  }

  // 如果identifier是"selected"，返回选中的项目
  if (identifier === "selected") {
    var selectedItems = app.project.selection;
    if (selectedItems.length > 0) {
      return selectedItems[0]; // 返回第一个选中的项目
    } else {
      error("m.item(), 没有选中的项目");
    }
  }

  // 如果identifier是File对象，先查找是否已存在，如果不存在则导入
  if (identifier instanceof File) {
    for (var i = 1; i <= app.project.numItems; i++) {
      var item = app.project.item(i);
      if (
        item instanceof FootageItem &&
        item.file &&
        item.file.fsName === identifier.fsName
      ) {
        return item;
      }
    }

    try {
      return app.project.importFile(new ImportOptions(identifier));
    } catch (e) {
      error("m.item(), 无法导入文件: " + e.message);
    }
  }

  // 如果都没找到，返回null或抛出错误
  error("m.item(), 未找到匹配的项目");
};

pub.background = function () {
  var args = Array.prototype.slice.call(arguments);
  var solidColor = m.color.apply(null, args);

  // 检查或创建合成和图层
  var result = m.checkCompAndLayer("背景层", "solid");

  // 设置图层颜色
  result.layer.source.mainSource.color = [
    solidColor[0],
    solidColor[1],
    solidColor[2],
  ];

  // 返回创建的纯色层
  return result.layer;
};
