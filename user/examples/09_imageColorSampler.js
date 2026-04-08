// ----------------------------------------
// createPoint(x, y) creates a draggable point controller in After Effects.
// Read its position with point.value(), which returns [x, y].
// ----------------------------------------
// This example samples color with img.get(...), so it works as an image sampling demo.
// ----------------------------------------
// loadImage(path) reads from the user/ root directory.
// On macOS, user/ is usually at:
// ~/Library/Application Support/Adobe/CEP/extensions/momentumjs/user/
// On Windows, user/ is usually at:
// %AppData%/Adobe/CEP/extensions/momentumjs/user/
// For example, "examples/img/td_2.jpg" points to:
// user/examples/img/td_2.jpg.
// ----------------------------------------

let img;
let samplePoint;

function preload() {
  img = loadImage("examples/img/td_2.jpg");
}

function setup() {
  createCanvas(378, 300);
  rectMode(CENTER);
  samplePoint = createPoint(width * 0.5, height * 0.5);
}

function draw() {
  var pos = samplePoint.value();
  var px = constrain(pos[0], 0, width);
  var py = constrain(pos[1], 0, height);
  var sampleX = floor((px / width) * (img.width - 1));
  var sampleY = floor((py / height) * (img.height - 1));

  background(0);
  image(img, 0, 0, width, height);

  var picked = img.get(sampleX, sampleY);

  noStroke();
  fill(picked);
  rect(px, py, 100, 100);
}
