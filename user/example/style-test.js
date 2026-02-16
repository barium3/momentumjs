// @filename: style-test
// 测试 fill, stroke, strokeWeight 等样式函数

function setup() {
  size(800, 400);
  background(50);
}

function draw() {
  // 测试 fill - 红色椭圆
  fill(255, 100, 100);
  noStroke();
  ellipse(100, 150, 60, 60);
  
  // 测试 fill + stroke - 绿色矩形
  fill(100, 255, 100);
  stroke(0, 0, 255);
  strokeWeight(3);
  rect(200, 120, 60, 60);
  
  // 测试 noFill + stroke - 蓝色描边圆
  noFill();
  stroke(100, 100, 255);
  strokeWeight(2);
  ellipse(350, 150, 60, 60);
  
  // 测试 translate + rotate
  push();
  translate(500, 150);
  rotate(45 * Math.PI / 180);
  fill(255, 255, 0);
  noStroke();
  rect(-30, -30, 60, 60);
  pop();
}
