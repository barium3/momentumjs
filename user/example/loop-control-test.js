var phase = 0;

function setup() {
  createCanvas(180, 120);
}

function draw() {
  background(240);

  fill(40, 120, 255);
  ellipse(frameCount * 8, 25, 12, 12);

  if (phase === 0 && frameCount >= 5) {
    noLoop();
    phase = 1;
  }

  if (phase === 1) {
    fill(255, 140, 40);
    ellipse(50, 60, 14, 14);

    if (!isLooping()) {
      redraw();
      phase = 2;
    }
  }

  if (phase === 2) {
    fill(40, 180, 90);
    ellipse(90, 60, 14, 14);
    loop();
    phase = 3;
  }

  if (phase === 3) {
    fill(180, 60, 180);
    ellipse(frameCount * 8, 95, 12, 12);
  }
}
