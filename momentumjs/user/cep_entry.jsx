(function () {
  var extensionRoot = new File($.fileName).parent.parent.fsName;
  $.evalFile(extensionRoot + "/bundle/momentum.js");
  $.evalFile(extensionRoot + "/user/非遗.js");
})();
