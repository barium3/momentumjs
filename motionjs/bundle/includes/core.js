var init = function () {
  glob.b = pub;

  // welcome();

  // -- init internal state vars --
  startTime = Date.now();
  currStrokeWeight = 1;
  currStrokeTint = 100;
  currFillTint = 100;
  // currCanvasMode = pub.PAGE;
  // currColorMode = pub.RGB;
};
