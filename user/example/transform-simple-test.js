// 简单测试: scale, translate, rotate
function setup() {
  size(1280, 720);
}

function draw() {
  background(240);

  // 1. translate - 平移
  translate(200, 200);
  fill(255, 100, 100);
  rect(0, 0, 80, 80);

  // 2. rotate - 旋转 (在 translate 基础上)
  push();
  translate(200, 0);
  rotate(PI / 4);
  fill(100, 255, 100);
  rect(-40, -40, 80, 80);
  pop();

  // 3. scale - 缩放
  push();
  translate(500, 0);
  scale(1.5);
  fill(100, 100, 255);
  rect(-40, -40, 80, 80);
  pop();

  // 4. 组合: translate + rotate + scale
  push();
  translate(700, 0);
  rotate(PI / 6);
  scale(0.8);
  fill(255, 200, 100);
  rect(-40, -40, 80, 80);
  pop();
}
