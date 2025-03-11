pub.addKeyframe = function (target, property, time, value) {
  if (arguments.length !== 4) {
    error(
      "m.addKeyframe(), 参数数量不正确！使用: target, property, time, value"
    );
  }

  var prop = findProperty(target, property);
  if (!prop) {
    error("m.addKeyframe(), 无法找到指定的属性: " + property);
  }

  // 如果属性还没有关键帧，先设置初始值
  if (!prop.numKeys) {
    prop.setValue(prop.value);
  }

  // 添加关键帧
  prop.setValueAtTime(time, value);
};

var shapePropertyMap = {
  // 通用变换属性
  position: "transform.position",
  scale: "transform.scale",
  rotation: "transform.rotation",
  opacity: "transform.opacity",
  anchor: "transform.anchorPoint",

  // 填充和描边属性
  fillColor: "contents.Fill 1.color",
  strokeColor: "contents.Stroke 1.color",
  strokeWidth: "contents.Stroke 1.strokeWidth",

  // 特定形状属性
  size: "contents.1.size", // 适用于矩形和椭圆
  points: "contents.1.points", // 适用于多边形
  outerRadius: "contents.1.outerRadius", // 适用于多边形
  innerRadius: "contents.1.innerRadius", // 适用于星形
  path: "contents.1.path", // 适用于自定义路径

  // 特定效果属性（如果添加了这些效果）
  roundness: "contents.1.roundness", // 适用于矩形的圆角
  starRatio: "contents.1.starRatio", // 适用于星形
};

function findProperty(target, property) {
  // 简单属性映射
  var propertyPath = shapePropertyMap[property.toLowerCase()] || property;

  var parts = propertyPath.split(".");
  var current = target;

  for (var i = 0; i < parts.length; i++) {
    if (current instanceof PropertyGroup) {
      current = current.property(parts[i]);
    } else if (
      current instanceof ShapeLayer &&
      parts[i].toLowerCase() === "contents"
    ) {
      current = current.property("Contents");
    } else if (
      current &&
      current.property &&
      typeof current.property === "function"
    ) {
      current = current.property(parts[i]);
    } else {
      current = current[parts[i]];
    }

    if (!current) {
      // 如果是填充颜色但没找到，尝试查找第一个填充属性
      if (property.toLowerCase() === "fillcolor" && i === parts.length - 1) {
        var contents = target.property("Contents");
        for (var j = 1; j <= contents.numProperties; j++) {
          var prop = contents.property(j);
          if (prop.matchName === "ADBE Vector Graphic - Fill") {
            return prop.property("Color");
          }
        }
      }
      // 特殊处理多边形的点数
      if (property.toLowerCase() === "points" && i === parts.length - 1) {
        var contents = target.property("Contents");
        for (var j = 1; j <= contents.numProperties; j++) {
          var prop = contents.property(j);
          if (prop.matchName === "ADBE Vector Shape - Star") {
            return prop.property("Points");
          }
        }
      }
      return null;
    }
  }

  return current;
}
