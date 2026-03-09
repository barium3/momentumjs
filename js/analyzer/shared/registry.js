// Shared registry lookup helpers for analyzer modules.

var functionRegistry;

function initRegistryUtils(registry) {
  functionRegistry = registry;
}

function buildCategoryMappings(category, deps) {
  if (!functionRegistry || !functionRegistry[category]) {
    throw new Error(`[Runtime] functionRegistry.${category} not found!`);
  }
  var mappings = {};
  var categoryData = functionRegistry[category];
  for (var name in categoryData) {
    if (categoryData.hasOwnProperty(name)) {
      mappings[name] = {
        internal: categoryData[name].internal,
        deps: deps,
      };
    }
  }
  return mappings;
}

function getCategoryFunctionNames(category) {
  if (!functionRegistry || !functionRegistry[category]) {
    throw new Error(`[Runtime] functionRegistry.${category} not found!`);
  }
  return Object.keys(functionRegistry[category]);
}

function getTransformFunctionNames() {
  return getCategoryFunctionNames("transforms");
}

function getColorFunctionNames() {
  return getCategoryFunctionNames("colors");
}

function getEnvironmentFunctionNames() {
  return getCategoryFunctionNames("environment");
}

function getRenderFunctionNames() {
  if (!functionRegistry || typeof functionRegistry.getRenderFunctions !== "function") {
    throw new Error("[Runtime] functionRegistry.getRenderFunctions not found!");
  }
  return functionRegistry.getRenderFunctions();
}

function getShapeTypeMap(cache) {
  if (cache && cache._shapeTypeMapCache) {
    return cache._shapeTypeMapCache;
  }
  if (!functionRegistry || !functionRegistry.shapes) {
    throw new Error("[Runtime] functionRegistry.shapes not found!");
  }
  var map = {};
  for (var name in functionRegistry.shapes) {
    if (functionRegistry.shapes.hasOwnProperty(name)) {
      var info = functionRegistry.shapes[name];
      map[name] = info.baseType || name;
    }
  }
  if (cache) {
    cache._shapeTypeMapCache = map;
  }
  return map;
}

function getShapeBuilders(shapeName) {
  if (
    !functionRegistry ||
    !functionRegistry.shapes ||
    !functionRegistry.shapes[shapeName]
  ) {
    return null;
  }
  return functionRegistry.shapes[shapeName].builders || null;
}

function getBuilderInfo(funcName) {
  if (!functionRegistry || !functionRegistry.shapes) {
    return null;
  }
  for (var shapeName in functionRegistry.shapes) {
    if (functionRegistry.shapes.hasOwnProperty(shapeName)) {
      var shapeInfo = functionRegistry.shapes[shapeName];
      if (shapeInfo.builders && shapeInfo.builders[funcName]) {
        return {
          shapeName: shapeName,
          role: shapeInfo.builders[funcName].role,
          baseType: shapeInfo.baseType || shapeName,
        };
      }
    }
  }
  return null;
}
