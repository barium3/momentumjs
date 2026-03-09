var phase = 0;
var stoppedX = 0;

function setup() {
  createCanvas(220, 120);
  noStroke();
}

function draw() {
  background(245);

  fill(50, 120, 255);
  ellipse(20 + frameCount * 8, 30, 14, 14);

  if (phase === 0 && frameCount >= 6) {
    stoppedX = 20 + frameCount * 8;
    noLoop();
    phase = 1;
  }

  if (phase >= 1) {
    fill(255, 150, 50);
    ellipse(stoppedX, 60, 16, 16);
  }

  if (phase === 1 && isLooping() === false) {
    redraw();
    phase = 2;
  }

  if (phase >= 2) {
    fill(60, 180, 90);
    ellipse(stoppedX + 36, 60, 16, 16);
  }

  if (phase === 2) {
    loop();
    phase = 3;
  }

  if (phase >= 3) {
    fill(180, 80, 220);
    ellipse(20 + (frameCount - 6) * 8, 92, 14, 14);
  }
}
