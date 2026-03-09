// Shared AST helpers for analyzer modules.

function addAstParentLinks(node, parent) {
  if (!node || typeof node !== "object") return;
  node.parent = parent || null;

  for (var key in node) {
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
          addAstParentLinks(child[i], node);
        }
      }
    } else if (typeof child === "object" && child.type) {
      addAstParentLinks(child, node);
    }
  }
}

function walkAst(node, visitor) {
  if (!node || typeof node !== "object") return;
  if (visitor(node) === false) return;

  for (var key in node) {
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
          walkAst(child[i], visitor);
        }
      }
    } else if (typeof child === "object" && child.type) {
      walkAst(child, visitor);
    }
  }
}

function getAstCalleeName(callee) {
  if (!callee) return null;
  if (callee.type === "Identifier") {
    return callee.name;
  }
  if (
    callee.type === "MemberExpression" &&
    callee.property &&
    !callee.computed &&
    callee.property.type === "Identifier"
  ) {
    return callee.property.name;
  }
  return null;
}
