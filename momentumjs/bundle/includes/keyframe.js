pub.addKeyframe = function (target, property, time, value) {
  if (arguments.length !== 4) {
    error(
      "m.addKeyframe(), incorrect number of arguments! Usage: target, property, time, value"
    );
  }

  var prop = findProperty(target, property);
  if (!prop) {
    error("m.addKeyframe(), cannot find specified property: " + property);
  }

  // If the property doesn't have keyframes yet, set initial value
  if (!prop.numKeys) {
    prop.setValue(prop.value);
  }

  // Add keyframe
  prop.setValueAtTime(time, value);
};

var shapePropertyMap = {
  // General transform properties
  position: "transform.position",
  scale: "transform.scale",
  rotation: "transform.rotation",
  opacity: "transform.opacity",
  anchor: "transform.anchorPoint",

  // Fill and stroke properties
  fillColor: "contents.Fill 1.color",
  strokeColor: "contents.Stroke 1.color",
  strokeWidth: "contents.Stroke 1.strokeWidth",

  // Specific shape properties
  size: "contents.1.size", // For rectangles and ellipses
  points: "contents.1.points", // For polygons
  outerRadius: "contents.1.outerRadius", // For polygons
  innerRadius: "contents.1.innerRadius", // For stars
  path: "contents.1.path", // For custom paths

  // Specific effect properties (if added)
  roundness: "contents.1.roundness", // For rectangle roundness
  starRatio: "contents.1.starRatio", // For stars
};

function findProperty(target, property) {
  // Simple property mapping
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
      // If it's fill color but not found, try to find the first fill property
      if (property.toLowerCase() === "fillcolor" && i === parts.length - 1) {
        var contents = target.property("Contents");
        for (var j = 1; j <= contents.numProperties; j++) {
          var prop = contents.property(j);
          if (prop.matchName === "ADBE Vector Graphic - Fill") {
            return prop.property("Color");
          }
        }
      }
      // Special handling for polygon points
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
