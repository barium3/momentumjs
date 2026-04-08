// loadImage(path) reads from the user/ root directory.
// On macOS, user/ is usually at:
// ~/Library/Application Support/Adobe/CEP/extensions/momentumjs/user/
// On Windows, user/ is usually at:
// %AppData%/Adobe/CEP/extensions/momentumjs/user/
// For example, "examples/img/td_1.jpg" points to:
// user/examples/img/td_1.jpg.

let img;

function preload() {
  img = loadImage("examples/img/td_1.jpg");
}

function setup() {
  createCanvas(420, 180);
}

function draw() {
  var t = frameCount * 0.03;
  var pulse = 0.5 + 0.5 * sin(t * 1.4);

  background(0);

  tint(255, 230, 70);
  image(img, 30 + sin(t) * 10, 34, 112, 112);

  tint(255, 0, 170);
  image(img, 162, 40 + cos(t * 1.2) * 10, 88, 88);

  tint(150 + pulse * 105, 70, 255 - pulse * 95);
  image(img, 272, 32, 118, 118);

  noTint();
}
