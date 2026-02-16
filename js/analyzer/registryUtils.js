/**
 * Registry 工具方法
 * 从 functionRegistry 获取函数和类型信息
 */

// 需要从外部获取 functionRegistry
var functionRegistry;

/**
 * 初始化 registryUtils（由 Runtime 调用）
 */
function initRegistryUtils(registry) {
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

/**
 * 获取指定类别的函数名列表
 * @param {string} category - 类别名称
 * @returns {Array<string>} 函数名列表
 */
function getCategoryFunctionNames(category) {
  if (!functionRegistry[category]) {
    throw new Error(`[Runtime] functionRegistry.${category} not found!`);
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

/**
 * 获取指定 shape 的构建器函数配置
 * @param {string} shapeName - shape 名称（如 "polygon"）
 * @returns {Object|null} 构建器函数配置对象，key 为函数名，value 为角色配置
 */
function getShapeBuilders(shapeName) {
  if (!functionRegistry || !functionRegistry.shapes || !functionRegistry.shapes[shapeName]) {
    return null;
  }
  return functionRegistry.shapes[shapeName].builders || null;
}

/**
 * 检查函数是否为某个 shape 的构建器函数
 * @param {string} funcName - 函数名
 * @returns {Object|null} 如果是指定 shape 的构建器，返回 { shapeName, role, baseType }，否则返回 null
 */
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
