(function () {
  var extensionRoot = new File($.fileName).parent.parent.fsName;
  $.evalFile(extensionRoot + "/bundle/movement.js");
  $.evalFile(extensionRoot + "/user/非遗.js");
})();
