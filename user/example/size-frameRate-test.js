// @filename size-frameRate-test
// 测试 size() 和 frameRate() 函数

function setup() {
  // 设置合成大小为 1280x720，帧率为 60
  size(1280, 720);
  frameRate(60);
}

function draw() {
  // 设置背景颜色
  background(50, 100, 150);

  // 绘制一个椭圆
  fill(255, 200, 100);
  ellipse(640, 360, 300, 200);
}
