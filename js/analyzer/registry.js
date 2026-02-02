/**
 * Registry 工具方法
 * 从 functionRegistry 获取函数和类型信息
 */

// 需要从外部获取 functionRegistry
var functionRegistry;

/**
 * 初始化 registry（由 P5Runtime 调用）
 */
function initRegistry(registry) {
  functionRegistry = registry;
}

/**
 * 从 registry 构建函数映射
 * @param {string} category - 类别名称（shapes, transforms, colors, math）
 * @param {Array<string>} deps - 依赖列表
 * @returns {Object} 函数映射对象
 */
function buildCategoryMappings(category, deps) {
  if (!functionRegistry[category]) {
    throw new Error(`[P5Runtime] functionRegistry.${category} not found!`);
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

/**
 * 获取指定类别的函数名列表
 * @param {string} category - 类别名称
 * @returns {Array<string>} 函数名列表
 */
function getCategoryFunctionNames(category) {
  if (!functionRegistry[category]) {
    throw new Error(`[P5Runtime] functionRegistry.${category} not found!`);
  }
  return Object.keys(functionRegistry[category]);
}

/**
 * 获取变换函数名列表
 */
function getTransformFunctionNames() {
  return getCategoryFunctionNames("transforms");
}

/**
 * 获取颜色函数名列表
 */
function getColorFunctionNames() {
  return getCategoryFunctionNames("colors");
}

/**
 * 获取环境函数名列表
 */
function getEnvironmentFunctionNames() {
  return getCategoryFunctionNames("environment");
}

/**
 * 获取形状类型映射（将 circle/square 映射到 ellipse/rect）
 * @param {Object} cache - 缓存对象（用于避免重复计算）
 * @returns {Object} 形状类型映射
 */
function getShapeTypeMap(cache) {
  if (cache && cache._shapeTypeMapCache) {
    return cache._shapeTypeMapCache;
  }
  if (!functionRegistry.shapes) {
    throw new Error("[P5Runtime] functionRegistry.shapes not found!");
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
