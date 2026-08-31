import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function createContext(extra = {}) {
  const context = {
    clearTimeout,
    console,
    Promise,
    setTimeout,
    ...extra,
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(read("js/ui/files/fileEntry.js"), context, {
    filename: "fileEntry.js",
  });
  vm.runInNewContext(read("js/ui/files/fileTypes.js"), context, {
    filename: "fileTypes.js",
  });
  return context;
}

const modelContext = createContext();
const Entry = modelContext.fileEntry;
const FileTypes = modelContext.fileTypes;

assert.deepEqual(
  JSON.parse(JSON.stringify(Entry.create({
    kind: "file",
    name: "新 文件.js",
    path: "/项目 目录/新 文件.js",
  }))),
  {
    kind: "file",
    name: "新 文件.js",
    path: "/项目 目录/新 文件.js",
  },
  "canonical entries must preserve Unicode and spaces",
);
assert.equal(FileTypes.getLanguage("新 文件.JS"), "javascript");
assert.equal(FileTypes.getIconClass("photo.png"), "fa-file-image");
assert.equal(FileTypes.isImage("photo.png"), true);
assert.equal(FileTypes.isImage("vector.svg"), false);
assert.equal(FileTypes.canAutoOpen("notes.md"), true);
assert.equal(FileTypes.isRunnable("sketch.js"), true);
assert.equal(FileTypes.isRunnable("host.jsx"), false);
assert.throws(
  () => Entry.create({
    isFolder: true,
    name: "Legacy Folder",
    path: "/Legacy Folder",
  }),
  /declare kind/,
  "legacy isFolder entries must be rejected instead of inferred",
);

const orderStorage = new Map();
const orderContext = createContext({
  localStorage: {
    getItem(key) {
      return orderStorage.get(key) || null;
    },
    setItem(key, value) {
      orderStorage.set(key, String(value));
    },
  },
});
vm.runInNewContext(read("js/ui/files/fileOrder.js"), orderContext, {
  filename: "fileOrder.js",
});
orderContext.fileOrder.promote("/root/b.js", "/root");
const orderedEntries = [
  { kind: "file", name: "a.js", path: "/root/a.js" },
  { kind: "file", name: "b.js", path: "/root/b.js" },
];
orderContext.fileOrder.applyTree(orderedEntries, "/root");
assert.deepEqual(
  orderedEntries.map((entry) => entry.name),
  ["b.js", "a.js"],
  "the extracted file-order module must preserve promoted entries",
);

const activeModel = {
  language: "plaintext",
  value: "",
  getLanguageId() {
    return this.language;
  },
  getValue() {
    return this.value;
  },
  setValue(value) {
    this.value = value;
  },
};
const activeElements = {
  "current-filename": {
    textContent: "",
    title: "",
    classList: { toggle() {} },
    setAttribute() {},
  },
  editor: { style: {} },
  "editor-container": { appendChild() {} },
};
const activeFileListeners = [];
const activeFileHandlers = {};
let activeEditorChange = null;
let activeEditorReadOnly = false;
const immediateWrites = [];
const activeContext = createContext({
  addEventListener(type, listener) {
    activeFileListeners.push(type);
    activeFileHandlers[type] = listener;
  },
  console: { error() {} },
  csInterface: { getSystemPath: () => "/extension" },
  consoleManager: { clearConsole() {} },
  debugTraceManager: { stopAndClear() {} },
  document: {
    getElementById(id) {
      return activeElements[id] || null;
    },
  },
  editorManager: {
    editor: {
      focus() {},
      getModel: () => activeModel,
      getValue: () => activeModel.value,
      onDidChangeModelContent(listener) { activeEditorChange = listener; },
      updateOptions(options) {
        if (typeof options.readOnly === "boolean") {
          activeEditorReadOnly = options.readOnly;
        }
      },
    },
    setRunEnabled() {},
  },
  fileTreeUI: { clearSelectedFiles() {}, selectFile() {} },
  fileOrder: { promote() {} },
  fileSystem: {
    writeTextFileNow(filePath, content) {
      immediateWrites.push({ content, filePath });
      return { path: filePath };
    },
  },
  localStorage: null,
  monaco: {
    editor: {
      setModelLanguage(model, language) {
        model.language = language;
      },
    },
  },
  SystemPath: { EXTENSION: "extension" },
  workspaceManager: {
    showEditor() {},
    showImage() {},
  },
});
vm.runInNewContext(read("js/ui/files/activeFile.js"), activeContext, {
  filename: "activeFile.js",
});
assert.deepEqual(
  activeFileListeners,
  [],
  "loading Active File must not install global listeners",
);
activeContext.activeFile.init();
activeContext.activeFile.init();
assert.deepEqual(
  activeFileListeners,
  ["momentum:editor-ready", "blur", "beforeunload", "pagehide"],
  "Active File init must install each global listener once",
);
activeFileHandlers["momentum:editor-ready"]();
assert.equal(typeof activeEditorChange, "function");
assert.equal(typeof activeContext.activeFile.persist, "function");
assert.match(activeContext.activeFile.getDefaultContent("sketch.js"), /setup/);
activeContext.activeFile.beginDraft({
  fileName: "sketch.js",
  folderPath: "/user",
});
const activeCreation = activeContext.activeFile.prepareCreation("sketch.js");
assert.match(activeCreation.content, /draw/);
assert.equal(
  activeContext.activeFile.acceptCreation(
    { kind: "file", name: "sketch.js", path: "/user/sketch.js" },
    activeCreation,
  ),
  true,
);
activeModel.value = "// final keystroke 中文";
activeEditorChange();
assert.equal(
  activeFileHandlers.beforeunload(),
  true,
  "closing the panel must synchronously persist the latest editor revision",
);
assert.deepEqual(immediateWrites, [{
  content: "// final keystroke 中文",
  filePath: "/user/sketch.js",
}]);
activeFileHandlers.pagehide();
assert.equal(
  immediateWrites.length,
  1,
  "duplicate lifecycle events must not rewrite an already persisted revision",
);
const workingImmediateWrite = activeContext.fileSystem.writeTextFileNow;
activeModel.value = "// retry after failure";
activeEditorChange();
activeContext.fileSystem.writeTextFileNow = () => {
  throw new Error("simulated synchronous write failure");
};
assert.equal(
  activeFileHandlers.beforeunload(),
  false,
  "a failed lifecycle write must keep the revision marked as unsaved",
);
assert.match(activeElements["current-filename"].title, /could not sync/);
activeContext.fileSystem.writeTextFileNow = workingImmediateWrite;
assert.equal(activeFileHandlers.beforeunload(), true);
assert.deepEqual(immediateWrites.at(-1), {
  content: "// retry after failure",
  filePath: "/user/sketch.js",
});
assert.equal(activeContext.activeFile.getSelectionPath(), "/user/sketch.js");
activeContext.activeFile.handleRelocation(
  { kind: "file", name: "sketch.js", path: "/user/sketch.js" },
  { kind: "file", name: "renamed.js", path: "/user/renamed.js" },
);
assert.equal(activeContext.activeFile.getSelectionPath(), "/user/renamed.js");

let resolveSlowRead = null;
let resolveFastRead = null;
activeContext.fileSystem.readTextFile = (filePath) => new Promise((resolve) => {
  if (filePath === "/user/slow.js") {
    resolveSlowRead = resolve;
  } else if (filePath === "/user/fast.js") {
    resolveFastRead = resolve;
  } else {
    resolve("");
  }
});

let slowOpenSettled = false;
const slowOpen = activeContext.activeFile.open("/user/slow.js", "slow.js")
  .then((succeeded) => {
    slowOpenSettled = true;
    return succeeded;
  });
await Promise.resolve();
assert.equal(typeof resolveSlowRead, "function");
assert.equal(
  slowOpenSettled,
  false,
  "opening a text file must remain pending until its disk read completes",
);

const fastOpen = activeContext.activeFile.open("/user/fast.js", "fast.js");
await Promise.resolve();
assert.equal(typeof resolveFastRead, "function");
resolveFastRead("// fast file");
assert.equal(await fastOpen, true);
assert.equal(activeModel.value, "// fast file");
assert.equal(activeContext.activeFile.getCurrentPath(), "/user/fast.js");

resolveSlowRead("// stale slow file");
assert.equal(
  await slowOpen,
  false,
  "a superseded disk read must not report that its file opened",
);
assert.equal(
  activeModel.value,
  "// fast file",
  "a late disk read must not replace the newer file contents",
);

activeContext.fileSystem.readTextFile = () => Promise.reject(
  new Error("simulated disk read failure"),
);
assert.equal(
  await activeContext.activeFile.open("/user/unreadable.js", "unreadable.js"),
  false,
  "a failed disk read must not report that its file opened",
);
assert.equal(activeModel.value, "// Unable to read file.");
assert.equal(
  activeEditorReadOnly,
  true,
  "a failed disk read must leave the error placeholder read-only",
);

let resolveDraftCreation = null;
let draftCreationCalls = 0;
let draftCreationSnapshot = null;
activeContext.fileSystem.createFile = (folderPath, fileName, content) => {
  draftCreationCalls += 1;
  draftCreationSnapshot = { content, fileName, folderPath };
  return new Promise((resolve) => { resolveDraftCreation = resolve; });
};
activeContext.activeFile.beginDraft({
  content: "// draft",
  fileName: "draft.js",
  folderPath: "/user",
});
activeModel.value = "// first draft revision";
activeEditorChange();
const draftCreation = activeContext.activeFile.cancelDraft();
assert.equal(typeof resolveDraftCreation, "function");
assert.deepEqual(draftCreationSnapshot, {
  content: "// first draft revision",
  fileName: "draft.js",
  folderPath: "/user",
});
activeModel.value = "// latest draft revision";
activeEditorChange();
const overlappingDraftSave = activeContext.activeFile.persist();
assert.equal(
  draftCreationCalls,
  1,
  "overlapping draft saves must share one file creation",
);
resolveDraftCreation({
  kind: "file",
  name: "draft.js",
  path: "/user/draft.js",
});
assert.equal(await draftCreation, true);
assert.equal(await overlappingDraftSave, true);
assert.deepEqual(immediateWrites.at(-1), {
  content: "// latest draft revision",
  filePath: "/user/draft.js",
});
assert.equal(activeContext.activeFile.getCurrentPath(), "/user/draft.js");

let nextHostResponse = "";
let lastEvalScript = "";
let failCepWrite = false;
const cepTextWrites = [];
const hostContext = createContext({
  cep: {
    encoding: { UTF8: "UTF8" },
    fs: {
      writeFile(filePath, content, encoding) {
        if (failCepWrite) {
          return { err: 5 };
        }
        cepTextWrites.push({ content, encoding, filePath });
        return { err: 0 };
      },
    },
  },
  csInterface: {
    evalScript(script, callback) {
      lastEvalScript = script;
      callback(nextHostResponse);
    },
  },
});
vm.runInNewContext(read("js/ui/files/fileSystem.js"), hostContext, {
  filename: "fileSystem.js",
});

const syncWriteResult = hostContext.fileSystem.writeTextFileNow(
  "/项目 目录/立即 保存.js",
  "// 最后一次修改",
);
assert.equal(syncWriteResult.path, "/项目 目录/立即 保存.js");
assert.deepEqual(cepTextWrites.at(-1), {
  content: "// 最后一次修改",
  encoding: "UTF8",
  filePath: "/项目 目录/立即 保存.js",
});
failCepWrite = true;
assert.throws(
  () => hostContext.fileSystem.writeTextFileNow("/target/fail.js", "x"),
  /Could not write file/,
);
failCepWrite = false;

nextHostResponse = JSON.stringify({
  ok: true,
  data: {
    kind: "file",
    name: "新 文件.js",
    path: "/项目 目录/新 文件.js",
  },
  error: null,
});
const createdEntry = await hostContext.fileSystem.createFile(
  "/项目 目录",
  "新 文件.js",
  "// 中文内容",
);
assert.equal(createdEntry.path, "/项目 目录/新 文件.js");
const bridgeMatch = lastEvalScript.match(
  /^projectFileCommand\("([^"]*)", "([^"]*)"\)$/,
);
assert.ok(bridgeMatch, "file host calls must use the encoded command bridge");
assert.equal(decodeURIComponent(bridgeMatch[1]), "createFile");
assert.deepEqual(JSON.parse(decodeURIComponent(bridgeMatch[2])), {
  content: "// 中文内容",
  folderPath: "/项目 目录",
  name: "新 文件.js",
});

nextHostResponse = JSON.stringify({
  ok: true,
  data: { kind: "file", name: "missing-path.js", path: "" },
  error: null,
});
await assert.rejects(
  hostContext.fileSystem.createFile("/target", "missing-path.js", ""),
  /invalid file entry/,
  "invalid host entries must not silently become empty entries",
);

nextHostResponse = JSON.stringify({
  ok: false,
  data: { changed: true, copiedPath: "/target/Folder" },
  error: "Folder copied but source cleanup failed.",
});
await assert.rejects(
  hostContext.fileSystem.moveEntry(
    { kind: "folder", name: "Folder", path: "/source/Folder" },
    "/target",
  ),
  (error) => error.data?.changed === true && error.data.copiedPath === "/target/Folder",
  "partial host mutations must preserve changed-path metadata",
);

function createMockCepFileSystem() {
  const folders = new Set(["/target"]);
  const files = new Set();
  return {
    folders,
    files,
    api: {
      stat(path) {
        if (folders.has(path)) {
          return {
            err: 0,
            data: {
              isDirectory: true,
              isFile: false,
            },
          };
        }
        if (files.has(path)) {
          return {
            err: 0,
            data: {
              isDirectory: false,
              isFile: true,
            },
          };
        }
        return { err: 1 };
      },
      makedir(path) {
        if (folders.has(path) || files.has(path)) {
          return { err: 1 };
        }
        folders.add(path);
        return { err: 0 };
      },
      readdir(path) {
        if (!folders.has(path)) {
          return { err: 1 };
        }
        const prefix = path + "/";
        const names = [...folders, ...files]
          .filter((candidate) => candidate.startsWith(prefix))
          .map((candidate) => candidate.substring(prefix.length))
          .filter((name) => name && !name.includes("/"));
        return { err: 0, data: names };
      },
      deleteFile(path) {
        if (files.delete(path)) {
          return { err: 0 };
        }
        const prefix = path + "/";
        const hasChildren = [...folders, ...files].some(
          (candidate) => candidate.startsWith(prefix),
        );
        if (!hasChildren && folders.delete(path)) {
          return { err: 0 };
        }
        return { err: 1 };
      },
      writeFile(path) {
        if (path.endsWith("broken.png")) {
          return { err: 1 };
        }
        files.add(path);
        return { err: 0 };
      },
    },
  };
}

class MockFileReader {
  readAsDataURL() {
    this.result = "data:application/octet-stream;base64,AA==";
    this.onload();
  }
}

const cepFileSystem = createMockCepFileSystem();
const dropContext = createContext({
  FileReader: MockFileReader,
  cep: {
    encoding: { Base64: "Base64" },
    fs: cepFileSystem.api,
  },
});
dropContext.fileSystem = {};
vm.runInNewContext(read("js/ui/files/fileDrop.js"), dropContext, {
  filename: "fileDrop.js",
});

const successfulDrop = await dropContext.fileDrop.importCapturedDrop(
  {
    entries: [
      {
        file: { name: "图 片.png" },
        isDirectory: false,
        isFile: true,
        name: "图 片.png",
      },
    ],
    files: [],
    nativeEntries: [],
    useNativeEntries: false,
  },
  "/target",
);
assert.equal(successfulDrop.ok, true);
assert.equal(successfulDrop.entries[0].path, "/target/图 片.png");
assert.equal(cepFileSystem.files.has("/target/图 片.png"), true);

const duplicateDrop = await dropContext.fileDrop.importCapturedDrop(
  {
    entries: [
      {
        file: { name: "图 片.png" },
        isDirectory: false,
        isFile: true,
        name: "图 片.png",
      },
    ],
    files: [],
    nativeEntries: [],
    useNativeEntries: false,
  },
  "/target",
);
assert.equal(duplicateDrop.entries[0].path, "/target/图 片 2.png");

const failedFolderDrop = await dropContext.fileDrop.importCapturedDrop(
  {
    entries: [
      {
        isDirectory: true,
        isFile: false,
        name: "Broken Folder",
        createReader() {
          let read = false;
          return {
            readEntries(callback) {
              if (read) {
                callback([]);
                return;
              }
              read = true;
              callback([
                {
                  isDirectory: false,
                  isFile: true,
                  name: "copied-before-failure.png",
                  file(resolve) {
                    resolve({ name: "copied-before-failure.png" });
                  },
                },
                {
                  isDirectory: false,
                  isFile: true,
                  name: "broken.png",
                  file(resolve) {
                    resolve({ name: "broken.png" });
                  },
                },
              ]);
            },
          };
        },
      },
    ],
    files: [],
    nativeEntries: [],
    useNativeEntries: false,
  },
  "/target",
);
assert.equal(failedFolderDrop.ok, false);
assert.equal(
  cepFileSystem.folders.has("/target/Broken Folder"),
  false,
  "failed browser folder imports must remove the partial target",
);
assert.equal(
  cepFileSystem.files.has(
    "/target/Broken Folder/copied-before-failure.png",
  ),
  false,
  "rollback must remove children copied before a later failure",
);

const hostFiles = new Set(["/target/新 文件.js"]);
const hostFolders = new Set([
  "/destination",
  "/target",
  "/target/新 文件夹",
]);
const hostContents = new Map([["/target/新 文件.js", "original"]]);
const parentPath = (path) => path.substring(0, path.lastIndexOf("/")) || "/";
class MockHostFile {
  constructor(path) {
    this.fsName = String(path);
    this.name = this.fsName.split("/").pop();
  }
  get exists() {
    return hostFiles.has(this.fsName);
  }
  get parent() {
    return new MockHostFolder(parentPath(this.fsName));
  }
  open(mode) {
    if (mode === "w") {
      hostFiles.add(this.fsName);
      hostContents.set(this.fsName, "");
      return true;
    }
    return this.exists;
  }
  write(content) {
    hostContents.set(this.fsName, String(content));
  }
  close() {}
  copy(target) {
    if (!this.exists) {
      return false;
    }
    hostFiles.add(target.fsName);
    hostContents.set(target.fsName, hostContents.get(this.fsName) || "");
    return true;
  }
  remove() {
    hostContents.delete(this.fsName);
    return hostFiles.delete(this.fsName);
  }
  rename(nextName) {
    if (!this.exists) {
      return false;
    }
    const nextPath = this.parent.fsName + "/" + nextName;
    const content = hostContents.get(this.fsName) || "";
    hostFiles.delete(this.fsName);
    hostContents.delete(this.fsName);
    hostFiles.add(nextPath);
    hostContents.set(nextPath, content);
    return true;
  }
}
MockHostFile.decode = (value) => String(value);
class MockHostFolder {
  constructor(path) {
    this.fsName = String(path);
    this.name = this.fsName.split("/").pop();
  }
  get exists() {
    return hostFolders.has(this.fsName);
  }
  get parent() {
    return new MockHostFolder(parentPath(this.fsName));
  }
  create() {
    hostFolders.add(this.fsName);
    return true;
  }
  getFiles() {
    const prefix = this.fsName + "/";
    const children = [];
    hostFolders.forEach((path) => {
      if (path.startsWith(prefix) && !path.substring(prefix.length).includes("/")) {
        children.push(new MockHostFolder(path));
      }
    });
    hostFiles.forEach((path) => {
      if (path.startsWith(prefix) && !path.substring(prefix.length).includes("/")) {
        children.push(new MockHostFile(path));
      }
    });
    return children;
  }
  remove() {
    return hostFolders.delete(this.fsName);
  }
}
const jsxContext = vm.createContext({
  confirm: () => true,
  File: MockHostFile,
  Folder: MockHostFolder,
  JSON,
  String,
  decodeURIComponent,
  encodeURIComponent,
});
vm.runInContext(read("jsx/plugin/projectFiles.jsx"), jsxContext, {
  filename: "projectFiles.jsx",
});
const uniqueFile = jsxContext._momentumResolveUniqueFile(
  new MockHostFolder("/target"),
  "新 文件.js",
  "",
);
assert.equal(uniqueFile.ok, true);
assert.equal(uniqueFile.name, "新 文件 2.js");
const uniqueFolder = jsxContext._momentumResolveUniqueFolder(
  new MockHostFolder("/target"),
  "新 文件夹",
  "",
);
assert.equal(uniqueFolder.ok, true);
assert.equal(uniqueFolder.name, "新 文件夹 2");

const createResponse = JSON.parse(
  jsxContext.projectFileCommand(
    encodeURIComponent("createFile"),
    encodeURIComponent(JSON.stringify({
      content: "// 中文内容",
      folderPath: "/target",
      name: "新 文件.js",
    })),
  ),
);
assert.equal(createResponse.ok, true);
assert.equal(createResponse.data.kind, "file");
assert.equal(createResponse.data.path, "/target/新 文件 2.js");
assert.equal(hostContents.get(createResponse.data.path), "// 中文内容");

const renameResponse = JSON.parse(
  jsxContext.projectFileCommand(
    encodeURIComponent("renameEntry"),
    encodeURIComponent(JSON.stringify({
      entry: createResponse.data,
      name: "改 名.js",
    })),
  ),
);
assert.equal(renameResponse.ok, true);
assert.equal(renameResponse.data.path, "/target/改 名.js");

const moveResponse = JSON.parse(
  jsxContext.projectFileCommand(
    encodeURIComponent("moveEntry"),
    encodeURIComponent(JSON.stringify({
      entry: renameResponse.data,
      targetFolderPath: "/destination",
    })),
  ),
);
assert.equal(moveResponse.ok, true);
assert.equal(moveResponse.data.path, "/destination/改 名.js");

const deleteResponse = JSON.parse(
  jsxContext.projectFileCommand(
    encodeURIComponent("deleteEntry"),
    encodeURIComponent(JSON.stringify({ entry: moveResponse.data })),
  ),
);
assert.equal(deleteResponse.ok, true);
assert.equal(deleteResponse.data.deleted, true);
assert.equal(hostFiles.has("/destination/改 名.js"), false);

const legacyCommandResponse = JSON.parse(
  jsxContext.projectFileCommand(
    encodeURIComponent("renameEntry"),
    encodeURIComponent(JSON.stringify({
      entry: {
        isFolder: false,
        name: "新 文件.js",
        path: "/target/新 文件.js",
      },
      name: "legacy.js",
    })),
  ),
);
assert.equal(
  legacyCommandResponse.ok,
  false,
  "the host boundary must reject legacy isFolder descriptors",
);

jsxContext._momentumMoveProjectEntry = () => {
  const error = new Error("Folder copied but source cleanup failed.");
  error.data = {
    changed: true,
    copiedPath: "/target/新 文件夹 2",
  };
  throw error;
};
const partialMoveResponse = JSON.parse(
  jsxContext.projectFileCommand(
    encodeURIComponent("moveEntry"),
    encodeURIComponent(JSON.stringify({
      entry: {
        kind: "folder",
        name: "新 文件夹",
        path: "/source/新 文件夹",
      },
      targetFolderPath: "/target",
    })),
  ),
);
assert.equal(partialMoveResponse.ok, false);
assert.equal(partialMoveResponse.data.changed, true);
assert.equal(partialMoveResponse.data.copiedPath, "/target/新 文件夹 2");

const indexHtml = read("index.html");
const jsxMain = read("jsx/main.jsx");
const managerSource = read("js/ui/files/fileManager.js");
const treeSource = read("js/ui/files/fileTree.js");
const activeSource = read("js/ui/files/activeFile.js");
const fileSystemSource = read("js/ui/files/fileSystem.js");
const hostSource = read("jsx/plugin/projectFiles.jsx");
assert.ok(
  indexHtml.indexOf("fileTypes.js") < indexHtml.indexOf("fileTree.js"),
  "the type registry must load before file UI consumers",
);
assert.ok(
  indexHtml.indexOf("fileOrder.js") < indexHtml.indexOf("activeFile.js") &&
    indexHtml.indexOf("activeFile.js") < indexHtml.indexOf("fileManager.js"),
  "flat file modules must load in dependency order",
);
assert.ok(
  (managerSource.match(/runFileMutation\(\{/g) || []).length >= 5,
  "create, rename, delete, move, and import must share one mutation pipeline",
);
assert.doesNotMatch(managerSource, /IMAGE_EXTENSIONS|LANGUAGE_BY_EXTENSION/);
assert.doesNotMatch(treeSource, /FILE_ICON_BY_EXTENSION/);
assert.doesNotMatch(managerSource, /imageContainer\.innerHTML\s*=\s*['"]<img/);
assert.doesNotMatch(
  activeSource,
  /autoSaveWriteChain|queuedRevision|latestWrite|queueCurrentFileWrite|function queueWrite/,
  "synchronous text saves must not retain the old asynchronous write queue",
);
assert.doesNotMatch(
  fileSystemSource,
  /\bwriteTextFile:\s*function/,
  "the removed Promise wrapper must not survive beside writeTextFileNow",
);
assert.doesNotMatch(hostSource, /function executeUserCode\(/);
assert.doesNotMatch(hostSource, /\$\.writeln\(/);
assert.doesNotMatch(hostSource, /\bisFolder\b|_momentumParseCommandResult/);
assert.doesNotMatch(
  hostSource,
  /_momentumWriteTextFileData|action === "writeTextFile"/,
  "text writes must not retain the old asynchronous host command",
);
assert.doesNotMatch(
  hostSource,
  /function (readFileSegment|getActiveCompTimeInfo|getAvailableFontCatalog)\(/,
  "projectFiles.jsx must contain only project file-system responsibilities",
);
assert.match(
  jsxMain,
  /projectFiles\.jsx[\s\S]*debugTrace\.jsx[\s\S]*fontCatalog\.jsx/,
  "the flat JSX modules must all be loaded explicitly",
);
assert.doesNotMatch(
  indexHtml + managerSource + treeSource + jsxMain,
  /entryModel|fileTypeRegistry|fileHostService|externalDropIO|projectIO\.jsx/,
  "removed module names must not survive as compatibility aliases",
);

console.log("File workflow checks passed.");
