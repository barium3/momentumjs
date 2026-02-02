// @filename: function-with-loop-test
// 函数内部使用循环的测试

function setup() {
  size(800, 400);
  noStroke();
}

function draw() {
  // 调用带循环的函数
  drawRowOfCircles(100, 100, 5, 40);
  drawRowOfRectangles(100, 250, 4, 50);
}

// 绘制一行圆形的函数
function drawRowOfCircles(startX, y, count, size) {
  for (let i = 0; i < count; i++) {
    fill(255, 100 + i * 30, 100);
    ellipse(startX + i * 80, y, size, size);
  }
}

// 绘制一行矩形的函数
function drawRowOfRectangles(startX, y, count, size) {
  for (let i = 0; i < count; i++) {
    fill(100, 150, 255);
    rect(startX + i * 80, y - size / 2, size, size);
  }
}
