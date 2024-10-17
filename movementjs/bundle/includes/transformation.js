pub.translate = function (x, y, z) {
  if (arguments.length == 3) {
    currPosition = [x, y, z];
  } else if (arguments.length == 2) {
    currPosition = [x, y];
  }
};

pub.layerRotate = function (x, y, z) {
  if (arguments.length == 3) {
    currLayerRotation = [x, y, z];
  } else if (arguments.length == 1) {
    currLayerRotation = [x];
  }
};

pub.layerScale = function (w, h, s) {
  if (arguments.length == 3) {
    currLayerScale = [w, h, s];
  } else if (arguments.length == 2) {
    currLayerScale = [w, h];
  }
};

pub.rotate = function (x) {
  currRotation = [x];
};

pub.scale = function (w, h) {
  currScale = [w, h];
};

pub.anchor = function (x, y) {
  if (arguments.length !== 2)
    error("m.anchor(), 参数数量不正确！使用: x, y");
  currAnchor = [x, y];
};

pub.layerAnchor = function (x, y, z) {
  if (arguments.length === 2) {
    currLayerAnchor = [x, y];
  } else if (arguments.length === 3) {
    currLayerAnchor = [x, y, z];
  } else {
    error("m.layerAnchor(), 参数数量不正确！使用: x, y 或 x, y, z");
  }
};
