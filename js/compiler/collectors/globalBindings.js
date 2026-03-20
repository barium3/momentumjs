window.compilerGlobalBindingsPass = (function () {
  function collectNamesFromPattern(pattern, out) {
    if (!pattern || !out) return;

    switch (pattern.type) {
      case "Identifier":
        out.push(pattern.name);
        return;
      case "ObjectPattern":
        for (var i = 0; i < (pattern.properties || []).length; i++) {
          var prop = pattern.properties[i];
          if (!prop) continue;
          if (prop.type === "Property") {
            collectNamesFromPattern(prop.value, out);
          } else if (prop.type === "RestElement") {
            collectNamesFromPattern(prop.argument, out);
          }
        }
        return;
      case "ArrayPattern":
        for (var j = 0; j < (pattern.elements || []).length; j++) {
          if (pattern.elements[j]) collectNamesFromPattern(pattern.elements[j], out);
        }
        return;
      case "AssignmentPattern":
        collectNamesFromPattern(pattern.left, out);
        return;
      case "RestElement":
        collectNamesFromPattern(pattern.argument, out);
        return;
    }
  }

  function analyze(program) {
    var mutableNames = [];
    var numeric = {};
    var seen = Object.create(null);
    var excluded = {
      draw: true,
      preload: true,
      setup: true,
    };

    if (!program || !Array.isArray(program.body)) {
      return {
        mutableNames: mutableNames,
        numeric: numeric,
      };
    }

    for (var i = 0; i < program.body.length; i++) {
      var node = program.body[i];
      if (!node || node.type !== "VariableDeclaration") {
        continue;
      }

      for (var j = 0; j < (node.declarations || []).length; j++) {
        var decl = node.declarations[j];
        var bindingNames = [];
        collectNamesFromPattern(decl && decl.id, bindingNames);

        for (var k = 0; k < bindingNames.length; k++) {
          var name = bindingNames[k];
          if (!name || excluded[name] || seen[name]) continue;
          if (node.kind !== "const") {
            seen[name] = true;
            mutableNames.push(name);
          }
        }

        if (
          bindingNames.length === 1 &&
          !excluded[bindingNames[0]] &&
          decl &&
          decl.init &&
          !window.compilerAst.isFunctionLike(decl.init)
        ) {
          var value = window.compilerAst.getStaticNumber(decl.init, numeric);
          if (value !== null) {
            numeric[bindingNames[0]] = value;
          }
        }
      }
    }

    return {
      mutableNames: mutableNames,
      numeric: numeric,
    };
  }

  return {
    analyze: analyze,
    collectNamesFromPattern: collectNamesFromPattern,
  };
})();
