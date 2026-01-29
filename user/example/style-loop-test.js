// @filename: style-loop-test
// 测试 for 循环中使用 fill 和 stroke 等样式函数

function setup() {
  size(800, 400);
  background(40);
}

function draw() {
  // 测试：循环中使用 fill，每个椭圆不同颜色
  for (let i = 0; i < 5; i++) {
    fill(255, 100 + i * 30, 100);  // 红色分量递减，绿色分量递增
    noStroke();
    ellipse(100 + i * 80, 150, 50, 50);
  }
  
  // 测试：循环中使用 fill + stroke
  for (let i = 0; i < 4; i++) {
    fill(100, 200, 255);
    stroke(255, 200, 100);
    strokeWeight(2);
    rect(100 + i * 80, 250, 40, 40);
  }
}
