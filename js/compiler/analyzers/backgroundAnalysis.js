window.compilerBackgroundAnalysisPass = (function () {
  function analyze(drawEntry) {
    return {
      backgroundInDrawCondition: hasConditionalBackground(drawEntry),
    };
  }

  function hasConditionalBackground(drawEntry) {
    if (!drawEntry || !drawEntry.bodyNode) return false;

    var root =
      drawEntry.bodyNode.type === "BlockStatement"
        ? drawEntry.bodyNode
        : drawEntry.node;

    if (!root) return false;

    var found = false;

    function walk(node, inConditional) {
      if (!node || found) return;

      switch (node.type) {
        case "CallExpression": {
          var calleeName = window.compilerAst.getCalleeName(node.callee);
          if (calleeName === "background" && inConditional) {
            found = true;
          }
          break;
        }
        case "IfStatement":
          if (node.test) walk(node.test, true);
          if (node.consequent) walk(node.consequent, true);
          if (node.alternate) walk(node.alternate, true);
          return;
        case "ConditionalExpression":
          if (node.test) walk(node.test, true);
          if (node.consequent) walk(node.consequent, true);
          if (node.alternate) walk(node.alternate, true);
          return;
        case "LogicalExpression":
          if (node.left) walk(node.left, inConditional);
          if (node.right) walk(node.right, true);
          return;
      }

      for (var key in node) {
        if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
        if (
          key === "type" ||
          key === "start" ||
          key === "end" ||
          key === "loc" ||
          key === "parent"
        ) {
          continue;
        }

        var child = node[key];
        if (!child) continue;

        if (Array.isArray(child)) {
          for (var i = 0; i < child.length; i++) {
            if (child[i] && typeof child[i] === "object") {
              walk(child[i], inConditional);
              if (found) return;
            }
          }
        } else if (typeof child === "object" && child.type) {
          walk(child, inConditional);
        }
      }
    }

    walk(root, false);
    return found;
  }

  return {
    analyze: analyze,
  };
})();
