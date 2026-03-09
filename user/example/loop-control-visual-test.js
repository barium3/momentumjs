var phase = 0;
var pausedX = 0;

function setup() {
  createCanvas(240, 140);
  noStroke();
}

function draw() {
  background(245);

  fill(220);
  rect(20, 34, 200, 2);
  rect(20, 104, 200, 2);

  // 1. 蓝球先在上轨道移动
  fill(60, 120, 255);
  ellipse(20 + frameCount * 10, 35, 14, 14);

  if (phase === 0 && frameCount >= 6) {
    pausedX = 20 + frameCount * 10;
    noLoop();
    phase = 1;
  }

  // 2. noLoop 后，橙球出现在停住的位置
  if (phase >= 1) {
    fill(255, 140, 60);
    ellipse(pausedX, 70, 16, 16);
  }

  // 3. redraw 后，绿球会额外出现一次
  if (phase === 1) {
    redraw();
    phase = 2;
  }

  if (phase >= 2) {
    fill(60, 185, 90);
    ellipse(pausedX + 36, 70, 16, 16);
  }

  // 4. loop 后，下轨道的紫球重新开始移动
  if (phase === 2) {
    loop();
    phase = 3;
  }

  if (phase >= 3) {
    fill(170, 80, 220);
    ellipse(20 + (frameCount - 6) * 10, 105, 14, 14);
  }
}
