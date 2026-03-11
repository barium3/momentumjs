window.compilerEnvironmentConfigPass = (function () {
  function parseDurationArgs(args, frameRate) {
    var items = Array.isArray(args) ? args : [];
    var fps = frameRate || 30;

    if (!items.length) {
      return null;
    }

    if (items.length === 1) {
      var seconds = window.compilerAst.getStaticNumber(items[0]);
      if (seconds !== null && seconds > 0) {
        return seconds;
      }

      var timecode = window.compilerAst.getStringLiteralValue(items[0]);
      if (timecode) {
        return timecode;
      }

      return null;
    }

    var nums = [];
    for (var i = 0; i < items.length && i < 4; i++) {
      var value = window.compilerAst.getStaticNumber(items[i]);
      if (value === null) {
        return null;
      }
      nums.push(value);
    }

    if (nums.length !== items.length || nums.length < 2 || nums.length > 4) {
      return null;
    }

    if (nums.length === 2) {
      return nums[0] + nums[1] / fps;
    }
    if (nums.length === 3) {
      return nums[0] * 60 + nums[1] + nums[2] / fps;
    }

    return nums[0] * 3600 + nums[1] * 60 + nums[2] + nums[3] / fps;
  }

  function readCallConfig(node, config, options) {
    if (!node || node.type !== "ExpressionStatement" || !node.expression) {
      return;
    }

    var parseDuration =
      !options || options.parseDuration !== false;
    var expr = node.expression;
    var name = window.compilerAst.getCalleeName(expr.callee);
    if (!name) return;

    if (name === "createCanvas") {
      var width = window.compilerAst.getStaticNumber(expr.arguments && expr.arguments[0]);
      var height = window.compilerAst.getStaticNumber(expr.arguments && expr.arguments[1]);
      if (width !== null) config.width = width;
      if (height !== null) config.height = height;
      return;
    }

    if (name === "frameRate") {
      var fps = window.compilerAst.getStaticNumber(expr.arguments && expr.arguments[0]);
      if (fps !== null) config.frameRate = fps;
      return;
    }

    if (parseDuration && name === "duration") {
      var parsedDuration = parseDurationArgs(
        expr.arguments,
        config.frameRate || 30,
      );
      if (parsedDuration !== null) {
        config.duration = parsedDuration;
      }
    }
  }

  function analyze(program, entries) {
    var config = {
      width: null,
      height: null,
      frameRate: null,
      duration: null,
    };

    if (!program || !Array.isArray(program.body)) {
      return config;
    }

    for (var i = 0; i < program.body.length; i++) {
      readCallConfig(program.body[i], config, { parseDuration: false });
    }

    var setupEntry = entries && entries.setup ? entries.setup : null;
    if (setupEntry && setupEntry.bodyNode && setupEntry.bodyNode.type === "BlockStatement") {
      for (var j = 0; j < (setupEntry.bodyNode.body || []).length; j++) {
        readCallConfig(setupEntry.bodyNode.body[j], config, { parseDuration: false });
      }
    }

    for (var k = 0; k < program.body.length; k++) {
      readCallConfig(program.body[k], config, { parseDuration: true });
    }

    if (setupEntry && setupEntry.bodyNode && setupEntry.bodyNode.type === "BlockStatement") {
      for (var x = 0; x < (setupEntry.bodyNode.body || []).length; x++) {
        readCallConfig(setupEntry.bodyNode.body[x], config, { parseDuration: true });
      }
    }

    return config;
  }

  return {
    analyze: analyze,
  };
})();
