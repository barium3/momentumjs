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
        error("m.loadImage(), selected item is not a supported image format");
      }
    } else if (item.mainSource instanceof SolidSource) {
      return item; // Solid can also be treated as an "image"
    } else {
      error("m.loadImage(), selected footage item is not an image");
    }
  } else if (item instanceof CompItem) {
    return item; // Composition can also be used as a layer
  } else {
    error("m.loadImage(), invalid source file/project item");
  }
};

pub.image = function (img, x, y, width, height) {
  var comp;

  // Check parameters
  if (arguments.length < 3) {
    error(
      "m.image(), incorrect number of arguments! At least need image object and position (x, y)"
    );
  }

  // Check if img is a valid item
  if (!(img instanceof FootageItem) && !(img instanceof CompItem)) {
    error("m.image(), invalid image object");
  }

  // Get or create composition
  if (app.project.activeItem && app.project.activeItem instanceof CompItem) {
    comp = app.project.activeItem;
  } else {
    comp = m.composition(); // Create new composition with default settings
  }

  // Create layer
  var imageLayer = comp.layers.add(img);

  // Save original currPosition and currLayerScale
  var originalPosition = currPosition;
  var originalLayerScale = currLayerScale;

  // Calculate new currPosition and currLayerScale
  currPosition = m.add(currPosition, [x, y]);
  if (width !== undefined && height !== undefined) {
    var newScale = calculateScale(imageLayer, width, height);
    currLayerScale = [
      m.mul(m.div(currLayerScale[0], 100), newScale[0]),
      m.mul(m.div(currLayerScale[1], 100), newScale[1]),
    ];
  }

  // Apply current layer properties
  m.setLayerProperties(imageLayer);

  // Restore original currPosition and currLayerScale
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
