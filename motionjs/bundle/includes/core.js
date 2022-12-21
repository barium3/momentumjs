var init = function () {
  glob.m = pub;

  // welcome();

  // -- init internal state vars --
  startTime = Date.now();
  currStrokeWeight = 1;
  currStrokeTint = 100;
  currFillTint = 100;
  // currCanvasMode = pub.PAGE;
  // currColorMode = pub.RGB;
};

// var error = (pub.error = function (msg) {
//   println(ERROR_PREFIX + msg);
//   throw new Error(ERROR_PREFIX + msg);
// });

// var warning = (pub.warning = function (msg) {
//   println(WARNING_PREFIX + msg);
// });

// var clearConsole = function () {
//   var bt = new BridgeTalk();
//   bt.target = "estoolkit";
//   bt.body = "app.clc()"; // works just with cs6
//   bt.onError = function (errObj) {};
//   bt.onResult = function (resObj) {};
//   bt.send();
// };
