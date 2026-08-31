// Canonical file-tree entry and path helpers shared by file UI modules.
window.fileEntry = (function () {
  const FILE_KIND = "file";
  const FOLDER_KIND = "folder";

  function normalizePath(entryPath) {
    return String(entryPath || "")
      .replace(/\\/g, "/")
      .replace(/\/+$/, "");
  }

  function requireKind(value) {
    if (value && (value.kind === FILE_KIND || value.kind === FOLDER_KIND)) {
      return value.kind;
    }
    throw new TypeError("File entries must declare kind as file or folder.");
  }

  function create(value) {
    const source = value;
    const kind = requireKind(source);
    const path = normalizePath(source.path);
    if (typeof source.name !== "string" || !path) {
      throw new TypeError("File entries must include a name and path.");
    }
    const entry = {
      kind: kind,
      name: source.name,
      path: path,
    };
    if (kind === FOLDER_KIND) {
      if (source.children !== undefined && !Array.isArray(source.children)) {
        throw new TypeError("Folder entries must provide children as an array.");
      }
      entry.children = normalizeTree(source.children || []);
    }
    return entry;
  }

  function normalizeTree(entries) {
    return (Array.isArray(entries) ? entries : []).map(function (entry) {
      return create(entry);
    });
  }

  function isFolder(entry) {
    return requireKind(entry) === FOLDER_KIND;
  }

  function isPathInside(candidatePath, entryPath) {
    const normalizedCandidate = normalizePath(candidatePath);
    const normalizedEntry = normalizePath(entryPath);
    return Boolean(
      normalizedCandidate &&
        normalizedEntry &&
        (normalizedCandidate === normalizedEntry ||
          normalizedCandidate.indexOf(normalizedEntry + "/") === 0),
    );
  }

  function replacePathPrefix(candidatePath, previousPath, nextPath) {
    const normalizedCandidate = normalizePath(candidatePath);
    const normalizedPrevious = normalizePath(previousPath);
    const normalizedNext = normalizePath(nextPath);
    return normalizedNext + normalizedCandidate.substring(normalizedPrevious.length);
  }

  function getParentPath(entryPath) {
    const normalizedPath = normalizePath(entryPath);
    const separatorIndex = normalizedPath.lastIndexOf("/");
    return separatorIndex > 0 ? normalizedPath.substring(0, separatorIndex) : "";
  }

  function getExtension(entryPath) {
    const name = normalizePath(entryPath).split("/").pop() || "";
    const extensionIndex = name.lastIndexOf(".");
    return extensionIndex > 0 ? name.substring(extensionIndex + 1).toLowerCase() : "";
  }

  function toHostDescriptor(entry) {
    const normalizedEntry = create(entry);
    return {
      kind: normalizedEntry.kind,
      name: normalizedEntry.name,
      path: normalizedEntry.path,
    };
  }

  return {
    FILE_KIND: FILE_KIND,
    FOLDER_KIND: FOLDER_KIND,
    create: create,
    getExtension: getExtension,
    getParentPath: getParentPath,
    isFolder: isFolder,
    isPathInside: isPathInside,
    normalizePath: normalizePath,
    replacePathPrefix: replacePathPrefix,
    toHostDescriptor: toHostDescriptor,
  };
})();
