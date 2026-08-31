// Persistent ordering for root and nested file-tree entries.
window.fileOrder = (function () {
  const Entry = window.fileEntry;
  const STORAGE_KEY = "momentum.fileTreeOrder.v1";
  let orderByFolder = null;

  function getState() {
    if (orderByFolder) {
      return orderByFolder;
    }
    orderByFolder = {};
    try {
      const storedValue = window.localStorage
        ? window.localStorage.getItem(STORAGE_KEY)
        : "";
      const parsedValue = storedValue ? JSON.parse(storedValue) : null;
      if (
        parsedValue &&
        typeof parsedValue === "object" &&
        !Array.isArray(parsedValue)
      ) {
        orderByFolder = parsedValue;
      }
    } catch (_error) {}
    return orderByFolder;
  }

  function save() {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(getState()));
      }
    } catch (_error) {}
  }

  function getFolderOrder(folderPath) {
    const normalizedFolderPath = Entry.normalizePath(folderPath);
    const state = getState();
    if (!Array.isArray(state[normalizedFolderPath])) {
      state[normalizedFolderPath] = [];
    }
    return state[normalizedFolderPath];
  }

  function setFolderOrder(folderPath, orderedPaths) {
    getState()[Entry.normalizePath(folderPath)] = orderedPaths.slice();
  }

  function promote(entryPath, folderPath) {
    const normalizedEntryPath = Entry.normalizePath(entryPath);
    const order = getFolderOrder(folderPath).filter(function (path) {
      return Entry.normalizePath(path) !== normalizedEntryPath;
    });
    order.unshift(normalizedEntryPath);
    setFolderOrder(folderPath, order);
    save();
  }

  function place(entryPath, folderPath, referencePath, position) {
    const normalizedEntryPath = Entry.normalizePath(entryPath);
    const normalizedReferencePath = Entry.normalizePath(referencePath);
    const order = getFolderOrder(folderPath).filter(function (path) {
      return Entry.normalizePath(path) !== normalizedEntryPath;
    });
    let insertionIndex = 0;

    if (position === "before" || position === "after") {
      const referenceIndex = order.indexOf(normalizedReferencePath);
      if (referenceIndex !== -1) {
        insertionIndex = referenceIndex + (position === "after" ? 1 : 0);
      }
    } else if (position === "end") {
      insertionIndex = order.length;
    }

    order.splice(insertionIndex, 0, normalizedEntryPath);
    setFolderOrder(folderPath, order);
    save();
  }

  function replacePath(previousPath, nextPath) {
    const previousState = getState();
    const migratedState = {};

    Object.keys(previousState).forEach(function (folderPath) {
      const folderOrder = Array.isArray(previousState[folderPath])
        ? previousState[folderPath]
        : [];
      const migratedFolderPath = Entry.isPathInside(folderPath, previousPath)
        ? Entry.replacePathPrefix(folderPath, previousPath, nextPath)
        : folderPath;
      migratedState[migratedFolderPath] = folderOrder.map(function (entryPath) {
        return Entry.isPathInside(entryPath, previousPath)
          ? Entry.replacePathPrefix(entryPath, previousPath, nextPath)
          : entryPath;
      });
    });

    orderByFolder = migratedState;
    save();
  }

  function remove(entry) {
    const normalizedEntryPath = Entry.normalizePath(entry.path);
    const entryIsFolder = Entry.isFolder(entry);
    const state = getState();

    Object.keys(state).forEach(function (folderPath) {
      if (entryIsFolder && Entry.isPathInside(folderPath, normalizedEntryPath)) {
        delete state[folderPath];
        return;
      }
      state[folderPath] = state[folderPath].filter(function (path) {
        return entryIsFolder
          ? !Entry.isPathInside(path, normalizedEntryPath)
          : Entry.normalizePath(path) !== normalizedEntryPath;
      });
    });
    save();
  }

  function move(
    previousPath,
    nextPath,
    sourceFolderPath,
    targetFolderPath,
    referencePath,
    position,
  ) {
    replacePath(previousPath, nextPath);
    const normalizedNextPath = Entry.normalizePath(nextPath);
    const sourceOrder = getFolderOrder(sourceFolderPath).filter(
      function (path) {
        return Entry.normalizePath(path) !== normalizedNextPath;
      },
    );
    setFolderOrder(sourceFolderPath, sourceOrder);
    place(
      normalizedNextPath,
      targetFolderPath,
      referencePath,
      position,
    );
  }

  function applyTree(items, folderPath, isNested) {
    const storedOrder = getFolderOrder(folderPath);
    const currentPaths = items.map(function (item) {
      return Entry.normalizePath(item.path);
    });
    const reconciledOrder = storedOrder.filter(function (path) {
      return currentPaths.indexOf(Entry.normalizePath(path)) !== -1;
    });
    const unorderedItems = items
      .filter(function (item) {
        return reconciledOrder.indexOf(Entry.normalizePath(item.path)) === -1;
      })
      .sort(function (a, b) {
        return a.name.localeCompare(b.name);
      });

    unorderedItems.forEach(function (item) {
      reconciledOrder.push(Entry.normalizePath(item.path));
    });
    setFolderOrder(folderPath, reconciledOrder);
    items.sort(function (a, b) {
      return (
        reconciledOrder.indexOf(Entry.normalizePath(a.path)) -
        reconciledOrder.indexOf(Entry.normalizePath(b.path))
      );
    });
    items.forEach(function (item) {
      if (Entry.isFolder(item)) {
        applyTree(item.children || [], item.path, true);
      }
    });
    if (!isNested) {
      save();
    }
  }

  return {
    applyTree: applyTree,
    move: move,
    place: place,
    promote: promote,
    remove: remove,
    replacePath: replacePath,
  };
})();
