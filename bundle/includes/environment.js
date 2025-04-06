pub.composition = function () {
  var name = "New Composition";
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
      error(
        "m.composition(): Incorrect number of arguments. Maximum 6 parameters supported."
      );
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

  // Check if there is an active composition
  if (app.project.activeItem && app.project.activeItem instanceof CompItem) {
    comp = app.project.activeItem;
  } else {
    // If no active composition, create a new default composition
    comp = m.composition();
  }

  var newLayer;

  switch (type.toLowerCase()) {
    case "text":
      if (currBoxSize == null) {
        newLayer = comp.layers.addText(content || "New Text Layer");
      } else {
        newLayer = comp.layers.addBoxText(currBoxSize);
      }

      break;
    case "shape":
      newLayer = comp.layers.addShape();
      newLayer.name = content || "New Shape Layer";
      break;
    default:
      error("m.layer(): Unsupported layer type. Please use 'text' or 'shape'.");
  }

  // Apply current blending mode
  if (typeof currBlendMode !== "undefined") {
    newLayer.blendingMode = currBlendMode;
  }

  // Apply transformations
  m.setLayerProperties(newLayer);

  // Return created layer
  return newLayer;
};

// layerTransform variables need to be adjusted before creating the layer
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

  // Check if 3D transform is needed
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
    // 2D transform
    m.handlePropertyValue(transform.anchorPoint, layerAnchor);
    m.handlePropertyValue(transform.position, position);
    m.handlePropertyValue(transform.scale, layerScale);
    m.handlePropertyValue(
      transform.rotation,
      layerRotation[0] || layerRotation
    );
  }

  // Set opacity
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
      // If all elements in the array are strings, treat them as expressions, value set to 0
      var expression = controllable ? customProperty + "+" : "";
      expression += "[" + value.join(", ") + "]";
      property.expression = expression;
    } else {
      // Otherwise, set array as regular value
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
    error("m.controllable(): Parameter must be a boolean (true or false).");
  }
};

// Helper function: Check if it's an array of strings
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

  // Ensure layerTypes is an array
  if (!Array.isArray(layerTypes)) {
    layerTypes = [layerTypes];
  }

  // Check or create composition
  if (app.project.numItems == 0) {
    comp = m.composition();
  } else {
    // Iterate through all items, find the first composition
    for (var i = 1; i <= app.project.numItems; i++) {
      var item = app.project.item(i);
      if (item instanceof CompItem) {
        comp = item;
        break;
      }
    }
    // If no composition found, create a new default composition
    if (!comp) {
      comp = m.composition();
    }
  }

  if (comp) {
    comp.openInViewer();
  } else {
    error("Unable to create or find suitable composition");
  }

  // Check or create layer
  if (comp.numLayers == 0) {
    layer = createLayerByType(comp, layerName, layerTypes[0]);
  } else {
    // Check if the top layer is one of the required types
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
      error("Unsupported layer type: " + layerType);
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
  // If identifier is a number, find by index
  if (typeof identifier === "number") {
    if (identifier > 0 && identifier <= app.project.numItems) {
      return app.project.item(identifier);
    } else {
      error("m.item(), Invalid project index");
    }
  }

  // If identifier is a string, it could be a name or file path
  if (typeof identifier === "string") {
    // Try finding by name
    for (var i = 1; i <= app.project.numItems; i++) {
      var item = app.project.item(i);
      if (item.name === identifier) {
        return item;
      }
    }

    // If not found by name, try finding by file path
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

      // If file exists but project has no, try importing
      try {
        return app.project.importFile(new ImportOptions(file));
      } catch (e) {
        error("m.item(), Unable to import file: " + e.message);
      }
    }
  }

  // If identifier is "selected", return selected item
  if (identifier === "selected") {
    var selectedItems = app.project.selection;
    if (selectedItems.length > 0) {
      return selectedItems[0]; // Return first selected item
    } else {
      error("m.item(), No selected item");
    }
  }

  // If identifier is File object, first check if it exists, if not then import
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
      error("m.item(), Unable to import file: " + e.message);
    }
  }

  // If none found, return null or throw error
  error("m.item(), No matching project found");
};

pub.background = function () {
  var args = Array.prototype.slice.call(arguments);
  var solidColor = m.color.apply(null, args);

  // Check or create composition and layer
  var result = m.checkCompAndLayer("Background Layer", "solid");

  // Set layer color
  result.layer.source.mainSource.color = [
    solidColor[0],
    solidColor[1],
    solidColor[2],
  ];

  // Return created solid layer
  return result.layer;
};
