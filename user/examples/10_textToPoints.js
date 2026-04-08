// ----------------------------------------
// loadFont(path) reads from the user/ root directory.
// On macOS, user/ is usually at:
// ~/Library/Application Support/Adobe/CEP/extensions/momentumjs/user/
// On Windows, user/ is usually at:
// %AppData%/Adobe/CEP/extensions/momentumjs/user/
// For example, "examples/font/Futura.ttc" points to:
// user/examples/font/Futura.ttc.
// ----------------------------------------
// Font loading and textToPoints(...) are Bitmap-only.
// ----------------------------------------
// createColorPicker(r, g, b) creates a color controller in After Effects.
// Use picker.color() for fill()/stroke(), or picker.value() for a hex string.
// Like other controllers, color pickers can be adjusted and keyframed in AE.
// ----------------------------------------

let futura;
let points = [];
let yellowCtrl;
let magentaCtrl;
let purpleCtrl;

function preload() {
  futura = loadFont("examples/font/Futura.ttc");
}

function setup() {
  createCanvas(300, 300);
  yellowCtrl = createColorPicker(255, 230, 70);
  magentaCtrl = createColorPicker(255, 0, 170);
  purpleCtrl = createColorPicker(150, 70, 250);
  points = futura.textToPoints("M", 45, 232, 220, {
    sampleFactor: 0.05,
    simplifyThreshold: 0
  });
}

function draw() {
  background(0);
  var palette = [
    yellowCtrl.color(),
    magentaCtrl.color(),
    purpleCtrl.color(),
  ];

  noStroke();
  noFill();
  for (var i = 0; i < points.length; i += 1) {
    var p = points[i];
    var size = 6 + abs(sin(frameCount * 0.04 + i * 0.12)) * 44;
    var swatch = palette[i % palette.length];
    stroke(swatch);
    ellipse(p.x, p.y, size);
  }

  fill(100);
  textSize(14);
  textAlign(CENTER, CENTER);
}
