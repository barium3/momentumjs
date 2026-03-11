// Shared registry lookup helpers for analyzer modules.
// Compiler core owns registry metadata access; analyzer uses these wrappers
// to preserve older global function names and cache-aware call sites.

var functionRegistry;

function initRegistryUtils(registry) {
  functionRegistry = registry || window.functionRegistry || null;
  if (functionRegistry && typeof window !== "undefined") {
    window.functionRegistry = functionRegistry;
  }
}

function buildCategoryMappings(category, deps) {
  return window.compilerSymbols.buildCategoryMappings(category, deps);
}

function getCategoryFunctionNames(category) {
  var names = window.compilerSymbols.getCategoryFunctionNames(category);
  if (!names || names.length === 0) {
    throw new Error(`[Runtime] functionRegistry.${category} not found!`);
  }
  return names;
}

function getTransformFunctionNames() {
  return window.compilerSymbols.getTransformFunctionNames();
}

function getColorFunctionNames() {
  return window.compilerSymbols.getColorFunctionNames();
}

function getEnvironmentFunctionNames() {
  return window.compilerSymbols.getEnvironmentFunctionNames();
}

function getRenderFunctionNames() {
  var names = window.compilerSymbols.getRenderFunctionNames();
  if (!names || names.length === 0) {
    throw new Error("[Runtime] functionRegistry.getRenderFunctions not found!");
  }
  return names;
}

function getShapeTypeMap(cache) {
  if (cache && cache._shapeTypeMapCache) {
    return cache._shapeTypeMapCache;
  }

  var map = window.compilerSymbols.getShapeTypeMap();
  if (!map || Object.keys(map).length === 0) {
    throw new Error("[Runtime] functionRegistry.shapes not found!");
  }

  if (cache) {
    cache._shapeTypeMapCache = map;
  }
  return map;
}

function getShapeBuilders(shapeName) {
  var registry = functionRegistry || window.functionRegistry || null;
  if (!registry || !registry.shapes || !registry.shapes[shapeName]) {
    return null;
  }
  return registry.shapes[shapeName].builders || null;
}

function getBuilderInfo(funcName) {
  return window.compilerSymbols.getBuilderInfo(funcName);
}
