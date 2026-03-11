window.compilerSymbols = (function () {
  function getRegistry() {
    return typeof window !== "undefined" ? window.functionRegistry || null : null;
  }

  function getCategoryData(category) {
    var registry = getRegistry();
    return registry && registry[category] ? registry[category] : null;
  }

  function getCategoryFunctionNames(category) {
    var data = getCategoryData(category);
    return data ? Object.keys(data) : [];
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

  function getShapeNames() {
    var registry = getRegistry();
    var names = [];

    if (!registry || !registry.shapes) {
      return names;
    }

    for (var shapeName in registry.shapes) {
      if (!Object.prototype.hasOwnProperty.call(registry.shapes, shapeName)) {
        continue;
      }

      names.push(shapeName);
      var info = registry.shapes[shapeName];
      if (!info || !info.builders) continue;

      for (var builderName in info.builders) {
        if (Object.prototype.hasOwnProperty.call(info.builders, builderName)) {
          if (names.indexOf(builderName) === -1) {
            names.push(builderName);
          }
        }
      }
    }

    return names;
  }

  function getRenderFunctionNames() {
    var registry = getRegistry();
    if (!registry || typeof registry.getRenderFunctions !== "function") {
      return [];
    }
    return registry.getRenderFunctions();
  }

  function getShapeTypeMap() {
    var registry = getRegistry();
    var map = {};

    if (!registry || !registry.shapes) {
      return map;
    }

    for (var name in registry.shapes) {
      if (Object.prototype.hasOwnProperty.call(registry.shapes, name)) {
        map[name] = registry.shapes[name].baseType || name;
      }
    }

    return map;
  }

  function getBuilderInfo(funcName) {
    var registry = getRegistry();
    if (!registry || !registry.shapes) {
      return null;
    }

    for (var shapeName in registry.shapes) {
      if (!Object.prototype.hasOwnProperty.call(registry.shapes, shapeName)) {
        continue;
      }

      var shapeInfo = registry.shapes[shapeName];
      if (shapeInfo.builders && shapeInfo.builders[funcName]) {
        return {
          shapeName: shapeName,
          role: shapeInfo.builders[funcName].role,
          baseType: shapeInfo.baseType || shapeName,
        };
      }
    }

    return null;
  }

  function getShapeInfo(name) {
    var registry = getRegistry();
    if (!registry || typeof registry.getShapeInfo !== "function") {
      return null;
    }
    return registry.getShapeInfo(name);
  }

  function getTableInstanceMethods() {
    var registry = getRegistry();
    if (!registry || typeof registry.getTableInstanceMethods !== "function") {
      return null;
    }
    return registry.getTableInstanceMethods();
  }

  function buildCategoryMappings(category, deps) {
    var data = getCategoryData(category);
    var mappings = {};
    if (!data) {
      return mappings;
    }

    for (var name in data) {
      if (Object.prototype.hasOwnProperty.call(data, name)) {
        mappings[name] = {
          internal: data[name].internal,
          deps: deps || [],
        };
      }
    }

    return mappings;
  }

  function getCategoryInfo() {
    var registry = getRegistry();
    var infoMap = {};
    var categories = [
      "math",
      "environment",
      "colors",
      "controllers",
      "typography",
      "data",
      "images",
      "tables",
    ];

    if (!registry) {
      return infoMap;
    }

    for (var i = 0; i < categories.length; i++) {
      var category = categories[i];
      var data = registry[category];
      if (!data) continue;

      var info = {
        functions: {},
        constants: {},
        variables: {},
        namespaces: {},
      };

      for (var name in data) {
        if (!Object.prototype.hasOwnProperty.call(data, name)) continue;
        var item = data[name] || {};
        if (item.type === "constant") {
          info.constants[name] = true;
        } else if (item.type === "variable") {
          info.variables[name] = true;
        } else if (item.type === "namespace") {
          info.namespaces[name] = true;
        } else {
          info.functions[name] = true;
        }
      }

      infoMap[category] = info;
    }

    return infoMap;
  }

  return {
    buildCategoryMappings: buildCategoryMappings,
    getBuilderInfo: getBuilderInfo,
    getCategoryData: getCategoryData,
    getCategoryFunctionNames: getCategoryFunctionNames,
    getCategoryInfo: getCategoryInfo,
    getColorFunctionNames: getColorFunctionNames,
    getEnvironmentFunctionNames: getEnvironmentFunctionNames,
    getRegistry: getRegistry,
    getRenderFunctionNames: getRenderFunctionNames,
    getShapeInfo: getShapeInfo,
    getShapeNames: getShapeNames,
    getShapeTypeMap: getShapeTypeMap,
    getTableInstanceMethods: getTableInstanceMethods,
    getTransformFunctionNames: getTransformFunctionNames,
  };
})();
